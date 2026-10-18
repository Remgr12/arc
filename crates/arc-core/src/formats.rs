//! Mesh and CAD file format import/export (STL, OBJ, DXF, glTF).
//!
//! All readers and writers are implemented by hand on top of `std` and
//! `serde_json` (no extra dependencies). Every parser validates its input and
//! reports malformed files as `Err(String)` instead of panicking.
//!
//! # Provided formats
//!
//! | Format | Import | Export |
//! |--------|--------|--------|
//! | STL binary + ASCII | [`parse_stl`] | [`export_stl_binary`], [`export_stl_ascii`] |
//! | Wavefront OBJ | [`parse_obj`] | [`export_obj`] |
//! | DXF (ENTITIES section) | [`parse_dxf`] | — |
//! | STEP (ISO 10303-21) | [`parse_step`] | [`export_step_iso_10303`] |
//! | glTF 2.0 (JSON) | — | [`export_gltf`] |

use std::collections::HashMap;
use std::path::Path;

use serde_json::json;

use crate::mesh::{MeshBuffer, tri_normal};

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

/// File formats understood by this module.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Format {
    /// Wavefront OBJ text.
    Obj,
    /// STL, binary variant (the default guess when content cannot be sniffed).
    Stl,
    /// STL, ASCII variant.
    StlAscii,
    /// AutoCAD DXF text (group-code pairs).
    Dxf,
    /// glTF 2.0 JSON (`.gltf`).
    Gltf,
    /// STEP (ISO 10303-21) text (`.step` / `.stp`).
    Step,
}

impl Format {
    /// Canonical lower-case file extension for this format.
    pub fn extension(&self) -> &'static str {
        match self {
            Format::Obj => "obj",
            Format::Stl | Format::StlAscii => "stl",
            Format::Dxf => "dxf",
            Format::Gltf => "gltf",
            Format::Step => "step",
        }
    }

    /// Guess a file's format from its extension (case-insensitive). `.stl`
    /// files are sniffed by content to choose [`Format::Stl`] vs
    /// [`Format::StlAscii`]; unreadable files fall back to the binary variant.
    /// Returns `None` for unknown or missing extensions.
    pub fn detect(path: &str) -> Option<Format> {
        let ext = Path::new(path).extension()?.to_str()?.to_ascii_lowercase();
        match ext.as_str() {
            "obj" => Some(Format::Obj),
            "dxf" => Some(Format::Dxf),
            "gltf" => Some(Format::Gltf),
            "step" | "stp" => Some(Format::Step),
            "stl" => {
                let ascii = std::fs::read(path)
                    .map(|bytes| looks_ascii_stl(&bytes))
                    .unwrap_or(false);
                Some(if ascii { Format::StlAscii } else { Format::Stl })
            }
            _ => None,
        }
    }
}

// ---------------------------------------------------------------------------
// STL
// ---------------------------------------------------------------------------

/// One STL triangle: a facet normal plus its three corner vertices.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct StlTriangle {
    /// Facet normal as stored in the file (may be `[0, 0, 0]`).
    pub normal: [f64; 3],
    /// The three corner vertices in winding order.
    pub vertices: [[f64; 3]; 3],
}

/// Parsed STL content (from binary or ASCII source).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct StlMesh {
    /// Solid name taken from the ASCII `solid` line or the binary header.
    pub name: Option<String>,
    /// Triangles in file order.
    pub triangles: Vec<StlTriangle>,
}

/// True when `bytes` has exactly the binary STL layout: at least 84 bytes and
/// a total length of `84 + 50 * triangle_count`, where the count is the
/// little-endian u32 at offset 80.
pub fn is_binary_stl(bytes: &[u8]) -> bool {
    if bytes.len() < 84 {
        return false;
    }
    let count = u32::from_le_bytes([bytes[80], bytes[81], bytes[82], bytes[83]]) as u64;
    bytes.len() as u64 == 84 + 50 * count
}

/// Heuristic: does this byte stream look like an ASCII STL? Streams with an
/// exact binary STL layout are never ASCII (a binary header may legally start
/// with the word `solid`). A leading UTF-8 BOM and whitespace are ignored.
pub fn looks_ascii_stl(bytes: &[u8]) -> bool {
    if is_binary_stl(bytes) {
        return false;
    }
    let body = match bytes.strip_prefix(&[0xEF, 0xBB, 0xBF][..]) {
        Some(rest) => rest,
        None => bytes,
    };
    let start = body
        .iter()
        .position(|&b| !b.is_ascii_whitespace())
        .unwrap_or(body.len());
    let head = &body[start..];
    head.len() >= 5
        && head[..5].eq_ignore_ascii_case(b"solid")
        && (head.len() == 5 || head[5].is_ascii_whitespace())
}

/// Parse an STL file, auto-detecting binary vs ASCII encoding.
///
/// Binary files are validated strictly (total length must equal
/// `84 + 50 * count`); ASCII files are parsed line by line (`facet normal` /
/// `vertex`, CRLF tolerant, n-vertex facets fan-triangulated). Malformed
/// input yields `Err`, never a panic.
pub fn parse_stl(bytes: &[u8]) -> Result<StlMesh, String> {
    if is_binary_stl(bytes) {
        parse_stl_binary(bytes)
    } else if looks_ascii_stl(bytes) {
        parse_stl_ascii(&String::from_utf8_lossy(bytes))
    } else {
        Err("not a recognizable STL: neither a valid binary layout nor an ASCII `solid` header".into())
    }
}

fn parse_stl_binary(bytes: &[u8]) -> Result<StlMesh, String> {
    // Length was validated by `is_binary_stl`, so the count is bounded by the
    // real file size; the reads below are additionally bounds-checked.
    let count = u32::from_le_bytes([bytes[80], bytes[81], bytes[82], bytes[83]]) as usize;
    let mut triangles = Vec::with_capacity(count);
    for i in 0..count {
        let base = 84 + i * 50;
        let word = |k: usize| -> f64 {
            match bytes.get(base + k * 4..base + k * 4 + 4) {
                Some(b) => f32::from_le_bytes([b[0], b[1], b[2], b[3]]) as f64,
                None => 0.0,
            }
        };
        let read3 = |k: usize| -> [f64; 3] { [word(k * 3), word(k * 3 + 1), word(k * 3 + 2)] };
        triangles.push(StlTriangle {
            normal: read3(0),
            vertices: [read3(1), read3(2), read3(3)],
        });
    }
    Ok(StlMesh {
        name: stl_header_name(&bytes[..80.min(bytes.len())]),
        triangles,
    })
}

/// Extract a printable solid name from a binary STL header (trailing NUL and
/// whitespace trimmed); an empty header yields `None`.
fn stl_header_name(header: &[u8]) -> Option<String> {
    let end = header.iter().position(|&b| b == 0).unwrap_or(header.len());
    let text = String::from_utf8_lossy(&header[..end]);
    let trimmed = text.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// Flush the accumulated vertices of one ASCII facet as a triangle fan.
/// Facets closed by `endfacet` (or any pending facet with vertices) must have
/// at least three vertices.
fn flush_facet(
    tris: &mut Vec<StlTriangle>,
    verts: &mut Vec<[f64; 3]>,
    normal: [f64; 3],
    explicit: bool,
    line_no: usize,
) -> Result<(), String> {
    if verts.len() >= 3 {
        for k in 1..verts.len() - 1 {
            tris.push(StlTriangle {
                normal,
                vertices: [verts[0], verts[k], verts[k + 1]],
            });
        }
    } else if explicit || !verts.is_empty() {
        return Err(format!(
            "line {line_no}: facet has {} vertex values (need at least 3)",
            verts.len()
        ));
    }
    verts.clear();
    Ok(())
}

/// Parse one float with a line-numbered error message.
fn num(tok: &str, line_no: usize, what: &str) -> Result<f64, String> {
    tok.parse::<f64>()
        .map_err(|_| format!("line {line_no}: invalid number `{tok}` in {what}"))
}

fn parse_stl_ascii(text: &str) -> Result<StlMesh, String> {
    let mut name: Option<String> = None;
    let mut triangles: Vec<StlTriangle> = Vec::new();
    let mut normal = [0.0f64; 3];
    let mut verts: Vec<[f64; 3]> = Vec::new();

    for (i, raw) in text.lines().enumerate() {
        let line_no = i + 1;
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        let mut tok = line.split_whitespace();
        let kw = tok.next().unwrap_or("").to_ascii_lowercase();
        match kw.as_str() {
            "solid" => {
                if name.is_none() {
                    let rest = tok.collect::<Vec<&str>>().join(" ");
                    if !rest.is_empty() {
                        name = Some(rest);
                    }
                }
            }
            "facet" => {
                flush_facet(&mut triangles, &mut verts, normal, false, line_no)?;
                let has_normal_kw = tok.next().map(|k| k.eq_ignore_ascii_case("normal"));
                if has_normal_kw != Some(true) {
                    return Err(format!("line {line_no}: expected `facet normal <x> <y> <z>`"));
                }
                let xs: Vec<&str> = tok.take(3).collect();
                if xs.len() != 3 {
                    return Err(format!("line {line_no}: `facet normal` needs 3 components"));
                }
                for (k, s) in xs.iter().enumerate() {
                    normal[k] = num(s, line_no, "facet normal")?;
                }
            }
            "vertex" => {
                let xs: Vec<&str> = tok.take(3).collect();
                if xs.len() != 3 {
                    return Err(format!("line {line_no}: `vertex` needs 3 components"));
                }
                let mut v = [0.0f64; 3];
                for (k, s) in xs.iter().enumerate() {
                    v[k] = num(s, line_no, "vertex")?;
                }
                verts.push(v);
            }
            "endfacet" => flush_facet(&mut triangles, &mut verts, normal, true, line_no)?,
            "endsolid" => flush_facet(&mut triangles, &mut verts, normal, false, line_no)?,
            "outer" | "loop" | "endloop" => {}
            _ => {}
        }
    }
    let last_line = text.lines().count();
    flush_facet(&mut triangles, &mut verts, normal, false, last_line)?;
    Ok(StlMesh { name, triangles })
}

// ---------------------------------------------------------------------------
// OBJ
// ---------------------------------------------------------------------------

/// Parsed Wavefront OBJ content.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ObjMesh {
    /// `v` vertex positions.
    pub positions: Vec<[f64; 3]>,
    /// `vn` normals (may be empty).
    pub normals: Vec<[f64; 3]>,
    /// Triangulated faces (n-gons are fan-triangulated), 0-based indices
    /// into `positions`.
    pub faces: Vec<Vec<u32>>,
}

/// Parse a Wavefront OBJ document.
///
/// Supported: `v`, `vn` and `f` lines (index forms `f v`, `f v/vt`,
/// `f v//vn`, `f v/vt/vn`), 1-based indexing, negative (relative) indices and
/// fan triangulation of n-gons. `#` comments, `vt` and unknown keywords are
/// ignored. Faces referencing out-of-range indices produce `Err`, never a
/// panic.
pub fn parse_obj(text: &str) -> Result<ObjMesh, String> {
    let mut mesh = ObjMesh::default();
    for (i, raw) in text.lines().enumerate() {
        let line_no = i + 1;
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let mut tok = line.split_whitespace();
        match tok.next().unwrap_or("") {
            "v" => mesh.positions.push(vertex3(&mut tok, line_no, "vertex")?),
            "vn" => mesh.normals.push(vertex3(&mut tok, line_no, "normal")?),
            "f" => {
                let mut corners: Vec<u32> = Vec::with_capacity(4);
                for c in tok {
                    corners.push(obj_corner(c, mesh.positions.len(), mesh.normals.len(), line_no)?);
                }
                if corners.len() < 3 {
                    return Err(format!(
                        "line {line_no}: face has {} corners (need at least 3)",
                        corners.len()
                    ));
                }
                for k in 1..corners.len() - 1 {
                    mesh.faces.push(vec![corners[0], corners[k], corners[k + 1]]);
                }
            }
            _ => {}
        }
    }
    Ok(mesh)
}

/// Parse three numeric components from the tokens after a keyword.
fn vertex3<'a>(
    tok: &mut impl Iterator<Item = &'a str>,
    line_no: usize,
    what: &str,
) -> Result<[f64; 3], String> {
    let xs: Vec<&str> = tok.take(3).collect();
    if xs.len() != 3 {
        return Err(format!("line {line_no}: `{what}` needs 3 components"));
    }
    Ok([
        num(xs[0], line_no, what)?,
        num(xs[1], line_no, what)?,
        num(xs[2], line_no, what)?,
    ])
}

/// Resolve one OBJ face corner (`v`, `v/vt`, `v//vn`, `v/vt/vn`) to a
/// 0-based position index. Texture indices are ignored; normal indices, when
/// present, are validated against the normal list.
fn obj_corner(tok: &str, pos_len: usize, normal_len: usize, line_no: usize) -> Result<u32, String> {
    let mut parts = tok.split('/');
    let vi = obj_index(parts.next().unwrap_or(""), pos_len, "vertex", line_no)?;
    let _vt = parts.next();
    if let Some(vn) = parts.next() {
        if !vn.is_empty() {
            obj_index(vn, normal_len, "normal", line_no)?;
        }
    }
    Ok(vi)
}

/// Apply OBJ 1-based / negative (relative) indexing rules with bounds checks.
fn obj_index(s: &str, len: usize, what: &str, line_no: usize) -> Result<u32, String> {
    let n: i64 = s
        .parse()
        .map_err(|_| format!("line {line_no}: invalid {what} index `{s}`"))?;
    if n == 0 {
        return Err(format!("line {line_no}: {what} index 0 is invalid"));
    }
    let idx = if n > 0 { n - 1 } else { len as i64 + n };
    if idx < 0 || idx as usize >= len {
        return Err(format!(
            "line {line_no}: {what} index {n} out of range (have {len})"
        ));
    }
    Ok(idx as u32)
}

// ---------------------------------------------------------------------------
// DXF
// ---------------------------------------------------------------------------

/// DXF `LINE` entity (10/20/30 start, 11/21/31 end).
#[derive(Debug, Clone, PartialEq)]
pub struct DxfLine {
    /// Start point.
    pub start: [f64; 3],
    /// End point.
    pub end: [f64; 3],
}

/// DXF `CIRCLE` entity (10/20/30 center, 40 radius).
#[derive(Debug, Clone, PartialEq)]
pub struct DxfCircle {
    /// Center point.
    pub center: [f64; 3],
    /// Radius (> 0).
    pub radius: f64,
}

/// DXF `ARC` entity: a circle plus start/end sweep angles in degrees
/// (group codes 50/51, counter-clockwise from +X).
#[derive(Debug, Clone, PartialEq)]
pub struct DxfArc {
    /// Center point.
    pub center: [f64; 3],
    /// Radius (> 0).
    pub radius: f64,
    /// Start angle in degrees.
    pub start_angle_deg: f64,
    /// End angle in degrees.
    pub end_angle_deg: f64,
}

/// DXF `LWPOLYLINE` entity: 2D vertices (10/20 pairs) and the closed bit of
/// the 70 flags value.
#[derive(Debug, Clone, PartialEq)]
pub struct DxfPolyline {
    /// True when the 70 flags value has the closed bit (1) set.
    pub closed: bool,
    /// Vertex XY coordinates in drawing order.
    pub vertices: Vec<[f64; 2]>,
}

/// Entities extracted from the `ENTITIES` section of a DXF document.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct DxfDrawing {
    /// `LINE` entities.
    pub lines: Vec<DxfLine>,
    /// `CIRCLE` entities.
    pub circles: Vec<DxfCircle>,
    /// `ARC` entities.
    pub arcs: Vec<DxfArc>,
    /// `LWPOLYLINE` entities.
    pub polylines: Vec<DxfPolyline>,
}

/// Parse a minimal subset of a DXF document: the group-code pairs of the
/// `ENTITIES` section, extracting `LINE`, `CIRCLE`, `ARC` and `LWPOLYLINE`
/// entities. Input is CRLF tolerant; unparseable or empty input yields `Err`.
/// Malformed individual entities are skipped rather than failing the file.
pub fn parse_dxf(text: &str) -> Result<DxfDrawing, String> {
    let pairs = group_pairs(text);
    if pairs.is_empty() {
        return Err("empty or unparseable DXF document".into());
    }
    let mut drawing = DxfDrawing::default();
    let mut in_entities = false;
    let mut scratch: Option<EntityScratch> = None;
    let mut i = 0usize;
    while i < pairs.len() {
        let (code, value) = &pairs[i];
        let value = value.trim();
        if *code == 0 {
            if let Some(s) = scratch.take() {
                s.finish(&mut drawing);
            }
            match value {
                "SECTION" => {
                    in_entities = matches!(
                        pairs.get(i + 1),
                        Some((2, name)) if name.trim().eq_ignore_ascii_case("ENTITIES")
                    );
                }
                "ENDSEC" => in_entities = false,
                "LINE" | "CIRCLE" | "ARC" | "LWPOLYLINE" if in_entities => {
                    scratch = Some(EntityScratch::new(value));
                }
                _ => {}
            }
        } else if let Some(s) = &mut scratch {
            s.ingest(*code, value);
        }
        i += 1;
    }
    if let Some(s) = scratch.take() {
        s.finish(&mut drawing);
    }
    Ok(drawing)
}

/// Read DXF group-code pairs: consecutive lines of integer code + value.
/// Blank lines are skipped; a line that does not parse as an integer code
/// triggers a one-line resync.
fn group_pairs(text: &str) -> Vec<(i32, String)> {
    let lines: Vec<&str> = text
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect();
    let mut pairs = Vec::new();
    let mut i = 0usize;
    while i < lines.len() {
        match lines[i].parse::<i32>() {
            Ok(code) => {
                pairs.push((code, lines.get(i + 1).copied().unwrap_or("").to_string()));
                i += 2;
            }
            Err(_) => i += 1,
        }
    }
    pairs
}

/// Accumulator for the group codes of the DXF entity being read.
struct EntityScratch<'a> {
    kind: &'a str,
    scalars: HashMap<i32, f64>,
    pending_x: Option<f64>,
    points: Vec<[f64; 2]>,
}

impl<'a> EntityScratch<'a> {
    fn new(kind: &'a str) -> Self {
        Self {
            kind,
            scalars: HashMap::new(),
            pending_x: None,
            points: Vec::new(),
        }
    }

    /// Ingest one group code/value pair. For `LWPOLYLINE`, repeating 10/20
    /// pairs collect vertices; everything else lands in the scalar map.
    fn ingest(&mut self, code: i32, value: &str) {
        let as_num = || value.parse::<f64>().ok();
        if self.kind == "LWPOLYLINE" {
            match code {
                10 => self.pending_x = as_num(),
                20 => {
                    if let (Some(x), Some(y)) = (self.pending_x.take(), as_num()) {
                        self.points.push([x, y]);
                    }
                }
                _ => {
                    if let Some(v) = as_num() {
                        self.scalars.insert(code, v);
                    }
                }
            }
        } else if let Some(v) = as_num() {
            self.scalars.insert(code, v);
        }
    }

    fn scalar(&self, code: i32) -> Option<f64> {
        self.scalars.get(&code).copied()
    }

    fn scalar_or(&self, code: i32, default: f64) -> f64 {
        self.scalar(code).unwrap_or(default)
    }

    /// Convert the accumulated groups into a drawing entity, or skip the
    /// entity when required coordinates are missing.
    fn finish(self, out: &mut DxfDrawing) {
        match self.kind {
            "LINE" => {
                let (Some(sx), Some(sy), Some(ex), Some(ey)) = (
                    self.scalar(10),
                    self.scalar(20),
                    self.scalar(11),
                    self.scalar(21),
                ) else {
                    return;
                };
                out.lines.push(DxfLine {
                    start: [sx, sy, self.scalar_or(30, 0.0)],
                    end: [ex, ey, self.scalar_or(31, 0.0)],
                });
            }
            "CIRCLE" => {
                let (Some(cx), Some(cy), Some(r)) =
                    (self.scalar(10), self.scalar(20), self.scalar(40))
                else {
                    return;
                };
                out.circles.push(DxfCircle {
                    center: [cx, cy, self.scalar_or(30, 0.0)],
                    radius: r,
                });
            }
            "ARC" => {
                let (Some(cx), Some(cy), Some(r)) =
                    (self.scalar(10), self.scalar(20), self.scalar(40))
                else {
                    return;
                };
                out.arcs.push(DxfArc {
                    center: [cx, cy, self.scalar_or(30, 0.0)],
                    radius: r,
                    start_angle_deg: self.scalar_or(50, 0.0),
                    end_angle_deg: self.scalar_or(51, 0.0),
                });
            }
            "LWPOLYLINE" => {
                if self.points.len() >= 2 {
                    let closed = (self.scalar_or(70, 0.0) as i64) & 1 == 1;
                    out.polylines.push(DxfPolyline {
                        closed,
                        vertices: self.points,
                    });
                }
            }
            _ => {}
        }
    }
}

// ---------------------------------------------------------------------------
// STEP (ISO 10303-21)
// ---------------------------------------------------------------------------

/// Mesh content recovered from a STEP (ISO 10303-21) file.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct StepMesh {
    /// Product name from the header `FILE_NAME` entry, when present.
    pub name: Option<String>,
    /// `CARTESIAN_POINT` coordinates in file order.
    pub positions: Vec<[f64; 3]>,
    /// Triangles built from three-point `POLY_LOOP` / `EDGE_LOOP` entries,
    /// as 0-based indices into `positions`.
    pub indices: Vec<[u32; 3]>,
}

impl StepMesh {
    /// Number of recovered triangles.
    pub fn tri_count(&self) -> usize {
        self.indices.len()
    }

    /// True when no triangles were recovered.
    pub fn is_empty(&self) -> bool {
        self.indices.is_empty()
    }
}

/// Parse a STEP (ISO 10303-21) document well enough to recover a faceted
/// mesh.
///
/// Extracts every `CARTESIAN_POINT` and turns each `POLY_LOOP` or
/// `EDGE_LOOP` whose argument group holds exactly three point references
/// into one triangle (references routed through `VERTEX_POINT` are followed
/// one hop). All other entity types — B-spline surfaces, topology shells,
/// product structure, … — are skipped without error. Whitespace and line
/// breaks may appear between any tokens; `/* ... */` comments are removed.
/// Input without a single parseable `#n =` entity instance yields `Err`,
/// never a panic.
pub fn parse_step(text: &str) -> Result<StepMesh, String> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let records = step_records(&strip_step_comments(text));
    if records.is_empty() {
        return Err("not a parseable STEP file: no `#n =` entity instances found".into());
    }

    let mut positions: Vec<[f64; 3]> = Vec::new();
    let mut point_index: HashMap<u64, u32> = HashMap::new();
    let mut vertex_point: HashMap<u64, u64> = HashMap::new();

    for (id, kind, body) in &records {
        if kind.eq_ignore_ascii_case("CARTESIAN_POINT") {
            if let Some(group) = first_top_group(body) {
                let reals = extract_reals(&group);
                if reals.len() >= 3 && !point_index.contains_key(id) {
                    point_index.insert(*id, positions.len() as u32);
                    positions.push([reals[0], reals[1], reals[2]]);
                }
            }
        } else if kind.eq_ignore_ascii_case("VERTEX_POINT") {
            // The point reference is a bare `#n`, not a parenthesized group.
            if let Some(&r) = extract_refs(body).first() {
                vertex_point.insert(*id, r);
            }
        }
    }

    let mut indices: Vec<[u32; 3]> = Vec::new();
    for (_, kind, body) in &records {
        let is_loop =
            kind.eq_ignore_ascii_case("POLY_LOOP") || kind.eq_ignore_ascii_case("EDGE_LOOP");
        if !is_loop {
            continue;
        }
        let Some(group) = first_top_group(body) else {
            continue;
        };
        let refs = extract_refs(&group);
        if refs.len() != 3 {
            continue;
        }
        let mut tri = [0u32; 3];
        let mut complete = true;
        for (k, &r) in refs.iter().enumerate() {
            // Direct point reference, or one hop through a VERTEX_POINT.
            let pid = vertex_point.get(&r).copied().unwrap_or(r);
            match point_index.get(&pid) {
                Some(&ix) => tri[k] = ix,
                None => {
                    complete = false;
                    break;
                }
            }
        }
        if complete {
            indices.push(tri);
        }
    }

    Ok(StepMesh {
        name: step_file_name(text),
        positions,
        indices,
    })
}

/// Remove `/* ... */` comments (replaced by a space) while leaving
/// single-quoted strings untouched; unterminated comments run to the end.
fn strip_step_comments(text: &str) -> String {
    let b = text.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0usize;
    while i < b.len() {
        match b[i] {
            b'\'' => {
                let end = skip_quoted_string(b, i);
                out.extend_from_slice(&b[i..end]);
                i = end;
            }
            b'/' if b.get(i + 1) == Some(&b'*') => {
                i += 2;
                while i + 1 < b.len() && !(b[i] == b'*' && b[i + 1] == b'/') {
                    i += 1;
                }
                i = (i + 2).min(b.len());
                out.push(b' ');
            }
            c => {
                out.push(c);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Scan `#n = TYPE(...);` entity instances. Returns `(id, type, argument
/// body)` triples in file order; the body excludes the outer parentheses.
/// Whitespace and line breaks between tokens are tolerated; text that does
/// not fit the pattern (including complex `#n = (...)` records) is skipped
/// without error.
fn step_records(text: &str) -> Vec<(u64, String, String)> {
    let b = text.as_bytes();
    let mut out = Vec::new();
    let mut i = 0usize;
    while i < b.len() {
        if b[i] != b'#' {
            if b[i] == b'\'' {
                i = skip_quoted_string(b, i);
            } else {
                i += 1;
            }
            continue;
        }
        let hash = i;
        i += 1;
        let digits = i;
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
        }
        if i == digits {
            i = hash + 1;
            continue;
        }
        let id: u64 = text[digits..i].parse().unwrap_or(u64::MAX);
        i = skip_ws(b, i);
        if i >= b.len() || b[i] != b'=' {
            i = hash + 1;
            continue;
        }
        i = skip_ws(b, i + 1);
        let name_start = i;
        while i < b.len() && (b[i].is_ascii_alphanumeric() || b[i] == b'_' || b[i] == b'!') {
            i += 1;
        }
        let name = text[name_start..i].trim_end_matches('!').to_string();
        i = skip_ws(b, i);
        if i >= b.len() || b[i] != b'(' {
            i = hash + 1;
            continue;
        }
        let Some((body, next)) = scan_balanced_parens(text, i) else {
            i = hash + 1;
            continue;
        };
        i = next;
        if i < b.len() && b[i] == b';' {
            i += 1;
        }
        if !name.is_empty() && id != u64::MAX {
            out.push((id, name, body));
        }
    }
    out
}

/// Skip ASCII whitespace starting at `i`, returning the index of the first
/// non-whitespace byte (or `b.len()`).
fn skip_ws(b: &[u8], mut i: usize) -> usize {
    while i < b.len() && b[i].is_ascii_whitespace() {
        i += 1;
    }
    i
}

/// Skip a single-quoted STEP string whose opening quote is at `i`; returns
/// the index just past the closing quote (or `b.len()` when unterminated).
/// A doubled `''` inside the string is an escaped apostrophe.
fn skip_quoted_string(b: &[u8], mut i: usize) -> usize {
    i += 1;
    while i < b.len() {
        if b[i] == b'\'' {
            if b.get(i + 1) == Some(&b'\'') {
                i += 2;
                continue;
            }
            return i + 1;
        }
        i += 1;
    }
    b.len()
}

/// Scan the balanced `(...)` group whose opening parenthesis is at `open`,
/// honoring quoted strings. Returns the text between the parentheses and the
/// index just past the closing parenthesis; `None` when unbalanced.
fn scan_balanced_parens(text: &str, open: usize) -> Option<(String, usize)> {
    let b = text.as_bytes();
    let mut depth = 0usize;
    let mut i = open;
    while i < b.len() {
        match b[i] {
            b'\'' => i = skip_quoted_string(b, i),
            b'(' => {
                depth += 1;
                i += 1;
            }
            b')' => {
                depth -= 1;
                i += 1;
                if depth == 0 {
                    return Some((text[open + 1..i - 1].to_string(), i));
                }
            }
            _ => i += 1,
        }
    }
    None
}

/// Inside of the first top-level `(...)` group in `s` (quoted strings are
/// skipped while searching), or `None` when there is no balanced group.
fn first_top_group(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut i = 0usize;
    while i < b.len() {
        match b[i] {
            b'\'' => i = skip_quoted_string(b, i),
            b'(' => return scan_balanced_parens(s, i).map(|(body, _)| body),
            _ => i += 1,
        }
    }
    None
}

/// Pull every numeric literal out of `s` (STEP integer/real syntax with
/// optional sign, fraction and exponent). Unparseable runs are ignored.
fn extract_reals(s: &str) -> Vec<f64> {
    let b = s.as_bytes();
    let mut out = Vec::new();
    let mut i = 0usize;
    while i < b.len() {
        let start = i;
        if b[i] == b'+' || b[i] == b'-' {
            i += 1;
        }
        let mut digits = false;
        while i < b.len() && (b[i].is_ascii_digit() || b[i] == b'.') {
            digits |= b[i].is_ascii_digit();
            i += 1;
        }
        if !digits {
            i = start + 1;
            continue;
        }
        let mut end = i;
        if i < b.len() && (b[i] == b'e' || b[i] == b'E') {
            let mut k = i + 1;
            if k < b.len() && (b[k] == b'+' || b[k] == b'-') {
                k += 1;
            }
            let exp_start = k;
            while k < b.len() && b[k].is_ascii_digit() {
                k += 1;
            }
            if k > exp_start {
                end = k;
            }
        }
        if let Ok(v) = s[start..end].parse::<f64>() {
            out.push(v);
        }
        i = end;
    }
    out
}

/// Pull every `#n` entity reference out of `s`.
fn extract_refs(s: &str) -> Vec<u64> {
    let b = s.as_bytes();
    let mut out = Vec::new();
    let mut i = 0usize;
    while i < b.len() {
        if b[i] == b'#' {
            let d = i + 1;
            let mut j = d;
            while j < b.len() && b[j].is_ascii_digit() {
                j += 1;
            }
            if j > d {
                out.push(s[d..j].parse().unwrap_or(u64::MAX));
                i = j;
                continue;
            }
        }
        i += 1;
    }
    out
}

/// First single-quoted string literal in `s`, with a doubled `''` unescaped
/// back to `'`; `None` when there is no closed string.
fn first_quoted(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut i = s.find('\'')? + 1;
    let mut out = Vec::new();
    while i < b.len() {
        if b[i] == b'\'' {
            if b.get(i + 1) == Some(&b'\'') {
                out.push(b'\'');
                i += 2;
                continue;
            }
            return Some(String::from_utf8_lossy(&out).into_owned());
        }
        out.push(b[i]);
        i += 1;
    }
    None
}

/// Best-effort product name from the header `FILE_NAME('x', ...)` entry
/// (case-insensitive); `None` when absent or empty.
fn step_file_name(text: &str) -> Option<String> {
    let pos = text.to_ascii_lowercase().find("file_name")?;
    let rest = &text[pos + "file_name".len()..];
    let group = first_top_group(rest.trim_start())?;
    first_quoted(&group).filter(|n| !n.is_empty())
}

// ---------------------------------------------------------------------------
// Exports (consume crate::mesh::MeshBuffer)
// ---------------------------------------------------------------------------

/// Iterate a non-indexed [`MeshBuffer`] as per-triangle vertex triples with
/// one normal each (the stored first-vertex normal when normals match the
/// positions, else computed). Trailing floats that do not form a complete
/// triangle are ignored.
fn mesh_triangles(mesh: &MeshBuffer) -> impl Iterator<Item = ([[f32; 3]; 3], [f32; 3])> + '_ {
    let has_normals = mesh.normals.len() == mesh.positions.len();
    (0..mesh.tri_count()).map(move |t| {
        let pf = &mesh.positions[t * 9..t * 9 + 9];
        let verts = [
            [pf[0], pf[1], pf[2]],
            [pf[3], pf[4], pf[5]],
            [pf[6], pf[7], pf[8]],
        ];
        let normal = if has_normals {
            let nf = &mesh.normals[t * 9..t * 9 + 9];
            [nf[0], nf[1], nf[2]]
        } else {
            let fv = verts.map(|v| v.map(|x| x as f64));
            tri_normal(fv[0], fv[1], fv[2]).map(|x| x as f32)
        };
        (verts, normal)
    })
}

/// Replace characters that would break line-oriented formats (newline, CR,
/// NUL) with spaces and trim the result.
fn sanitize_name(name: &str) -> String {
    name.chars()
        .map(|c| if c == '\n' || c == '\r' || c == '\0' { ' ' } else { c })
        .collect::<String>()
        .trim()
        .to_string()
}

/// Export a [`MeshBuffer`] as Wavefront OBJ text.
///
/// The non-indexed buffer is written one `v` line per corner (duplicates
/// kept), so face indices are simply `1, 2, 3, ...` per triangle. Per-vertex
/// normals are written when present (faces become `f v//vn`), otherwise plain
/// `f v` faces are emitted.
pub fn export_obj(mesh: &MeshBuffer, name: &str) -> String {
    let mut out = String::with_capacity(mesh.positions.len() * 12 + 64);
    out.push_str("# ");
    out.push_str(&sanitize_name(name));
    out.push('\n');
    let has_normals = mesh.normals.len() == mesh.positions.len();
    let vert_count = mesh.positions.len() / 3;
    for i in 0..vert_count {
        let p = &mesh.positions[i * 3..i * 3 + 3];
        out.push_str(&format!("v {} {} {}\n", p[0], p[1], p[2]));
    }
    if has_normals {
        for i in 0..vert_count {
            let n = &mesh.normals[i * 3..i * 3 + 3];
            out.push_str(&format!("vn {} {} {}\n", n[0], n[1], n[2]));
        }
    }
    for t in 0..mesh.tri_count() {
        let (a, b, c) = (t * 3 + 1, t * 3 + 2, t * 3 + 3);
        if has_normals {
            out.push_str(&format!("f {a}//{a} {b}//{b} {c}//{c}\n"));
        } else {
            out.push_str(&format!("f {a} {b} {c}\n"));
        }
    }
    out
}

/// Export a [`MeshBuffer`] as binary STL bytes: 80-byte header, u32 LE
/// triangle count, then 50 bytes per triangle (facet normal, three vertices,
/// u16 attribute byte count of 0; all floats little-endian).
pub fn export_stl_binary(mesh: &MeshBuffer) -> Vec<u8> {
    let tris = mesh.tri_count();
    let count = u32::try_from(tris).unwrap_or(u32::MAX);
    let mut out = Vec::with_capacity(84 + tris.saturating_mul(50));
    let mut header = [0u8; 80];
    header[..3].copy_from_slice(b"arc");
    out.extend_from_slice(&header);
    out.extend_from_slice(&count.to_le_bytes());
    for (verts, n) in mesh_triangles(mesh) {
        for v in [n, verts[0], verts[1], verts[2]] {
            for c in v {
                out.extend_from_slice(&c.to_le_bytes());
            }
        }
        out.extend_from_slice(&0u16.to_le_bytes());
    }
    out
}

/// Export a [`MeshBuffer`] as ASCII STL text (`solid` / `facet` structure).
pub fn export_stl_ascii(mesh: &MeshBuffer, name: &str) -> String {
    let mut out = String::with_capacity(mesh.positions.len() * 16 + 64);
    let solid = sanitize_name(name);
    if solid.is_empty() {
        out.push_str("solid\n");
    } else {
        out.push_str("solid ");
        out.push_str(&solid);
        out.push('\n');
    }
    for (verts, n) in mesh_triangles(mesh) {
        out.push_str(&format!("  facet normal {} {} {}\n", n[0], n[1], n[2]));
        out.push_str("    outer loop\n");
        for v in verts {
            out.push_str(&format!("      vertex {} {} {}\n", v[0], v[1], v[2]));
        }
        out.push_str("    endloop\n");
        out.push_str("  endfacet\n");
    }
    if solid.is_empty() {
        out.push_str("endsolid\n");
    } else {
        out.push_str("endsolid ");
        out.push_str(&solid);
        out.push('\n');
    }
    out
}

/// Export a [`MeshBuffer`] as a minimal glTF 2.0 document: one mesh of
/// non-indexed triangles, a single base64 data-URI buffer, `POSITION`
/// accessor (with the spec-required `min`/`max`) and `NORMAL` accessor when
/// the buffer carries matching normals. Empty meshes yield `Err`.
pub fn export_gltf(mesh: &MeshBuffer, name: &str) -> Result<String, String> {
    if mesh.tri_count() == 0 {
        return Err("cannot export an empty mesh to glTF".into());
    }
    let has_normals = mesh.normals.len() == mesh.positions.len();
    let vert_count = mesh.positions.len() / 3;

    let mut blob: Vec<u8> = Vec::with_capacity(mesh.positions.len() * 4);
    for &v in &mesh.positions {
        blob.extend_from_slice(&v.to_le_bytes());
    }
    let pos_len = blob.len();
    if has_normals {
        for &n in &mesh.normals {
            blob.extend_from_slice(&n.to_le_bytes());
        }
    }
    let norm_len = if has_normals { mesh.normals.len() * 4 } else { 0 };

    let mut min = [f64::INFINITY; 3];
    let mut max = [f64::NEG_INFINITY; 3];
    for i in 0..vert_count {
        for k in 0..3 {
            let v = mesh.positions[i * 3 + k] as f64;
            min[k] = min[k].min(v);
            max[k] = max[k].max(v);
        }
    }

    let (attributes, accessors, views) = if has_normals {
        (
            json!({ "POSITION": 0, "NORMAL": 1 }),
            vec![
                json!({ "bufferView": 0, "componentType": 5126, "count": vert_count, "type": "VEC3", "min": min, "max": max }),
                json!({ "bufferView": 1, "componentType": 5126, "count": vert_count, "type": "VEC3" }),
            ],
            vec![
                json!({ "buffer": 0, "byteOffset": 0, "byteLength": pos_len, "target": 34962 }),
                json!({ "buffer": 0, "byteOffset": pos_len, "byteLength": norm_len, "target": 34962 }),
            ],
        )
    } else {
        (
            json!({ "POSITION": 0 }),
            vec![
                json!({ "bufferView": 0, "componentType": 5126, "count": vert_count, "type": "VEC3", "min": min, "max": max }),
            ],
            vec![
                json!({ "buffer": 0, "byteOffset": 0, "byteLength": pos_len, "target": 34962 }),
            ],
        )
    };

    let label = sanitize_name(name);
    let doc = json!({
        "asset": { "version": "2.0", "generator": "arc-core" },
        "scene": 0,
        "scenes": [{ "nodes": [0] }],
        "nodes": [{ "mesh": 0, "name": label }],
        "meshes": [{ "name": label, "primitives": [{ "attributes": attributes, "mode": 4 }] }],
        "accessors": accessors,
        "bufferViews": views,
        "buffers": [{
            "byteLength": blob.len(),
            "uri": format!("data:application/octet-stream;base64,{}", base64_encode(&blob)),
        }],
    });
    serde_json::to_string(&doc).map_err(|e| format!("glTF serialization failed: {e}"))
}

/// Standard base64 encoding (RFC 4648 alphabet, padded). Dependency-free.
fn base64_encode(data: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let word = (b0 << 16) | (b1 << 8) | b2;
        let quad = [
            ALPHABET[(word >> 18) as usize & 63],
            ALPHABET[(word >> 12) as usize & 63],
            ALPHABET[(word >> 6) as usize & 63],
            ALPHABET[word as usize & 63],
        ];
        match chunk.len() {
            3 => {
                out.push(quad[0] as char);
                out.push(quad[1] as char);
                out.push(quad[2] as char);
                out.push(quad[3] as char);
            }
            2 => {
                out.push(quad[0] as char);
                out.push(quad[1] as char);
                out.push(quad[2] as char);
                out.push('=');
            }
            _ => {
                out.push(quad[0] as char);
                out.push(quad[1] as char);
                out.push_str("==");
            }
        }
    }
    out
}

/// Format one `f64` as a STEP real literal: the decimal point is mandatory,
/// so whole numbers gain a `.0` suffix. Non-finite values collapse to `0.`
/// (STEP has no `Inf`/`NaN` literals).
fn step_real(x: f64) -> String {
    if !x.is_finite() {
        return "0.".into();
    }
    let s = format!("{x}");
    if s.contains('.') || s.contains('e') || s.contains('E') {
        s
    } else {
        format!("{s}.0")
    }
}

/// Escape a string for a STEP single-quoted literal (apostrophes doubled;
/// newlines, CR and NUL are already handled by [`sanitize_name`]).
fn step_string(s: &str) -> String {
    s.replace('\'', "''")
}

/// UTC timestamp for the given Unix seconds, in the `YYYY-MM-DDThh:mm:ss`
/// shape expected by STEP `FILE_NAME` entries (civil-from-days algorithm).
fn iso_timestamp_at(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let mut y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    if m <= 2 {
        y += 1;
    }
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

/// Current UTC timestamp for STEP `FILE_NAME` header entries.
fn iso_timestamp() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    iso_timestamp_at(secs)
}

/// Export a [`MeshBuffer`] as a faceted B-rep in ISO 10303-21 (STEP) text.
///
/// Vertices are welded into `CARTESIAN_POINT` instances (ids `1..=n`); every
/// triangle becomes one `POLY_LOOP` of three point references wrapped in a
/// `FACE_OUTER_BOUND` and an `ADVANCED_FACE` (all faces share one helper
/// `PLANE` whose axis origin reuses the first mesh point, so no extra point
/// entity is emitted). Entity ids are sequential and every referenced id is
/// defined; the file terminates with the required `ENDSEC` /
/// `END-ISO-10303-21` footer.
pub fn export_step_iso_10303(mesh: &MeshBuffer, name: &str) -> String {
    let mut positions: Vec<[f64; 3]> = Vec::new();
    let mut lookup: HashMap<[i64; 3], usize> = HashMap::new();
    let mut tri_points: Vec<[usize; 3]> = Vec::with_capacity(mesh.tri_count());
    for (verts, _) in mesh_triangles(mesh) {
        let mut ids = [0usize; 3];
        for (k, v) in verts.into_iter().enumerate() {
            let v64 = v.map(|c| c as f64);
            let key = weld_key(v64);
            ids[k] = *lookup.entry(key).or_insert_with(|| {
                positions.push(v64);
                positions.len() - 1
            });
        }
        tri_points.push(ids);
    }
    let vert_count = positions.len();
    let tri_count = tri_points.len();
    // Entity ids: 1..=vert_count mesh points, then four helper entities for
    // the shared plane, then three entities per triangle (loop/bound/face).
    let dir_z = 1 + vert_count;
    let dir_x = dir_z + 1;
    let axis = dir_x + 1;
    let plane = axis + 1;
    let loop_base = plane + 1;

    let mut out = String::with_capacity(512 + vert_count * 64 + tri_count * 160);
    out.push_str("ISO-10303-21;\nHEADER;\n");
    out.push_str("FILE_DESCRIPTION(('Faceted B-rep exported by arc-core',''),'2;1');\n");
    out.push_str(&format!(
        "FILE_NAME('{}','{}',('arc'),('arc'),'arc-core','arc-core','');\n",
        step_string(&sanitize_name(name)),
        iso_timestamp(),
    ));
    out.push_str("FILE_SCHEMA(('MANIFOLD_SURFACE_SHAPE_REPRESENTATION'));\n");
    out.push_str("ENDSEC;\nDATA;\n");
    for (k, p) in positions.iter().enumerate() {
        out.push_str(&format!(
            "#{} = CARTESIAN_POINT('',({},{},{}));\n",
            1 + k,
            step_real(p[0]),
            step_real(p[1]),
            step_real(p[2])
        ));
    }
    if vert_count > 0 {
        // Shared helper plane referenced by every ADVANCED_FACE; its axis
        // origin reuses mesh point #1 so no extra CARTESIAN_POINT exists.
        out.push_str(&format!("#{dir_z} = DIRECTION('nz',(0.,0.,1.));\n"));
        out.push_str(&format!("#{dir_x} = DIRECTION('nx',(1.,0.,0.));\n"));
        out.push_str(&format!("#{axis} = AXIS2_PLACEMENT_3D('',#1,#{dir_z},#{dir_x});\n"));
        out.push_str(&format!("#{plane} = PLANE('',#{axis});\n"));
    }
    for (t, ids) in tri_points.iter().enumerate() {
        let base = loop_base + t * 3;
        let a = 1 + ids[0];
        let b = 1 + ids[1];
        let c = 1 + ids[2];
        let bound = base + 1;
        let face = base + 2;
        out.push_str(&format!("#{base} = POLY_LOOP('',(#{a},#{b},#{c}));\n"));
        out.push_str(&format!("#{bound} = FACE_OUTER_BOUND('',#{base},.T.);\n"));
        out.push_str(&format!("#{face} = ADVANCED_FACE('',(#{bound}),#{plane},.T.);\n"));
    }
    out.push_str("ENDSEC;\nEND-ISO-10303-21;\n");

    debug_assert!(
        step_all_refs_defined(&out),
        "STEP export left dangling references"
    );
    out
}

/// Consistency check for generated STEP text: every `#n` token that is not a
/// definition (`#n =`) must point at a defined entity id.
fn step_all_refs_defined(text: &str) -> bool {
    let b = text.as_bytes();
    let mut defined = std::collections::HashSet::new();
    let mut refs = Vec::new();
    let mut i = 0usize;
    while i < b.len() {
        if b[i] == b'#' {
            let d = i + 1;
            let mut j = d;
            while j < b.len() && b[j].is_ascii_digit() {
                j += 1;
            }
            if j > d {
                let id: u64 = text[d..j].parse().unwrap_or(u64::MAX);
                let k = skip_ws(b, j);
                if k < b.len() && b[k] == b'=' {
                    defined.insert(id);
                } else {
                    refs.push(id);
                }
                i = j;
                continue;
            }
        }
        i += 1;
    }
    refs.iter().all(|r| defined.contains(r))
}

// ---------------------------------------------------------------------------
// Triangle soup
// ---------------------------------------------------------------------------

/// Indexed triangle soup: welded vertex positions plus triangle indices.
/// Useful for turning imports (e.g. non-indexed STL) into compact mesh data.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct TriangleSoup {
    /// Unique welded vertex positions.
    pub positions: Vec<[f64; 3]>,
    /// Triangle index triples into `positions`.
    pub indices: Vec<[u32; 3]>,
}

impl TriangleSoup {
    /// Weld raw triangles into an indexed soup, merging vertices whose
    /// coordinates agree when snapped to a 1e-6 grid.
    pub fn from_triangles<I: IntoIterator<Item = [[f64; 3]; 3]>>(triangles: I) -> Self {
        let mut positions: Vec<[f64; 3]> = Vec::new();
        let mut indices: Vec<[u32; 3]> = Vec::new();
        let mut lookup: HashMap<[i64; 3], u32> = HashMap::new();
        for tri in triangles {
            let mut idx = [0u32; 3];
            for (k, v) in tri.into_iter().enumerate() {
                let key = weld_key(v);
                idx[k] = *lookup.entry(key).or_insert_with(|| {
                    positions.push(v);
                    (positions.len() - 1) as u32
                });
            }
            indices.push(idx);
        }
        Self { positions, indices }
    }

    /// Weld the triangles of an imported STL mesh into an indexed soup.
    pub fn from_stl(mesh: &StlMesh) -> Self {
        Self::from_triangles(mesh.triangles.iter().map(|t| t.vertices))
    }

    /// Number of triangles.
    pub fn tri_count(&self) -> usize {
        self.indices.len()
    }

    /// True when the soup has no triangles.
    pub fn is_empty(&self) -> bool {
        self.indices.is_empty()
    }
}

/// Merge several STL meshes into a single welded [`TriangleSoup`].
pub fn merge_stl(meshes: &[StlMesh]) -> TriangleSoup {
    TriangleSoup::from_triangles(
        meshes
            .iter()
            .flat_map(|m| m.triangles.iter().map(|t| t.vertices)),
    )
}

/// Snap a coordinate triple to the 1e-6 integer grid used for welding.
fn weld_key(v: [f64; 3]) -> [i64; 3] {
    [
        (v[0] * 1e6).round() as i64,
        (v[1] * 1e6).round() as i64,
        (v[2] * 1e6).round() as i64,
    ]
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mesh::MeshBuilder;

    fn tri_mesh() -> MeshBuffer {
        let mut b = MeshBuilder::new();
        b.push_tri([0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]);
        b.into_buffer()
    }

    #[test]
    fn stl_binary_round_trip() {
        let mesh = tri_mesh();
        let bytes = export_stl_binary(&mesh);
        assert!(is_binary_stl(&bytes));
        assert_eq!(bytes.len(), 84 + 50);
        let parsed = parse_stl(&bytes).expect("binary STL parses");
        assert_eq!(parsed.triangles.len(), 1);
        assert_eq!(parsed.name.as_deref(), Some("arc"));
        let t = &parsed.triangles[0];
        let expected = [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]];
        for (a, b) in t.vertices.iter().flatten().zip(expected.iter().flatten()) {
            assert!((a - b).abs() < 1e-6, "vertex mismatch {a} vs {b}");
        }
        assert!((t.normal[0] - 0.0).abs() < 1e-6);
        assert!((t.normal[2] - 1.0).abs() < 1e-6);
    }

    #[test]
    fn stl_binary_rejects_truncated_and_garbage() {
        let bytes = export_stl_binary(&tri_mesh());
        assert!(parse_stl(&bytes[..bytes.len() - 1]).is_err());
        assert!(parse_stl(&[]).is_err());
        assert!(parse_stl(b"random garbage bytes that are not an stl at all").is_err());
    }

    #[test]
    fn stl_ascii_parse() {
        let src = concat!(
            "solid test\n",
            "  facet normal 0 0 1\n",
            "    outer loop\n",
            "      vertex 0 0 0\n",
            "      vertex 1 0 0\n",
            "      vertex 0 1 0\n",
            "    endloop\n",
            "  endfacet\n",
            "endsolid test\n",
        );
        let parsed = parse_stl(src.as_bytes()).expect("ascii STL parses");
        assert_eq!(parsed.name.as_deref(), Some("test"));
        assert_eq!(parsed.triangles.len(), 1);
        let t = &parsed.triangles[0];
        assert_eq!(t.normal, [0.0, 0.0, 1.0]);
        assert_eq!(t.vertices[0], [0.0, 0.0, 0.0]);
        assert_eq!(t.vertices[1], [1.0, 0.0, 0.0]);
        assert_eq!(t.vertices[2], [0.0, 1.0, 0.0]);
    }

    #[test]
    fn stl_ascii_rejects_incomplete_facet() {
        let src = concat!(
            "solid t\n",
            "facet normal 0 0 1\n",
            "outer loop\n",
            "vertex 0 0 0\n",
            "vertex 1 0 0\n",
            "endloop\n",
            "endfacet\n",
            "endsolid t\n",
        );
        assert!(parse_stl(src.as_bytes()).is_err());
    }

    #[test]
    fn obj_parse_quad_negative_and_normals() {
        let src = concat!(
            "# comment\n",
            "v 0 0 0\n",
            "v 1 0 0\n",
            "v 1 1 0\n",
            "v 0 1 0\n",
            "vn 0 0 1\n",
            "f 1/1/1 2/1/1 3/1/1 4/1/1\n",
            "f 2//1 3//1 4//1\n",
            "f -2 -3 -4\n",
        );
        let mesh = parse_obj(src).expect("obj parses");
        assert_eq!(mesh.positions.len(), 4);
        assert_eq!(mesh.normals, vec![[0.0, 0.0, 1.0]]);
        assert_eq!(mesh.faces.len(), 4);
        assert_eq!(mesh.faces[0], vec![0, 1, 2]);
        assert_eq!(mesh.faces[1], vec![0, 2, 3]);
        assert_eq!(mesh.faces[2], vec![1, 2, 3]);
        assert_eq!(mesh.faces[3], vec![2, 1, 0]);
    }

    #[test]
    fn obj_rejects_out_of_range_index() {
        assert!(parse_obj("v 0 0 0\nf 1 2 9\n").is_err());
        assert!(parse_obj("f 1 2 3\n").is_err());
        assert!(parse_obj("v 0 0 0\nf 1 2 0\n").is_err());
        assert!(parse_obj("v 0 0 0\nf -1 -2 -5\n").is_err());
    }

    #[test]
    fn dxf_parse_line_circle() {
        let src = concat!(
            "0\nSECTION\n",
            "2\nENTITIES\n",
            "0\nLINE\n",
            "8\n0\n",
            "10\n0.0\n",
            "20\n0.0\n",
            "30\n0.0\n",
            "11\n10.0\n",
            "21\n0.0\n",
            "31\n0.0\n",
            "0\nCIRCLE\n",
            "8\n0\n",
            "10\n5.0\n",
            "20\n5.0\n",
            "30\n0.0\n",
            "40\n2.5\n",
            "0\nENDSEC\n",
            "0\nEOF\n",
        );
        let d = parse_dxf(src).expect("dxf parses");
        assert_eq!(d.lines.len(), 1);
        assert_eq!(d.lines[0].start, [0.0, 0.0, 0.0]);
        assert_eq!(d.lines[0].end, [10.0, 0.0, 0.0]);
        assert_eq!(d.circles.len(), 1);
        assert_eq!(d.circles[0].center, [5.0, 5.0, 0.0]);
        assert!((d.circles[0].radius - 2.5).abs() < 1e-9);
        assert!(d.arcs.is_empty());
        assert!(d.polylines.is_empty());
    }

    #[test]
    fn dxf_parse_arc_lwpolyline() {
        let src = concat!(
            "0\nSECTION\n",
            "2\nENTITIES\n",
            "0\nARC\n",
            "10\n1.0\n",
            "20\n2.0\n",
            "40\n3.0\n",
            "50\n0.0\n",
            "51\n90.0\n",
            "0\nLWPOLYLINE\n",
            "90\n3\n",
            "70\n1\n",
            "10\n0.0\n",
            "20\n0.0\n",
            "10\n1.0\n",
            "20\n0.0\n",
            "10\n1.0\n",
            "20\n1.0\n",
            "0\nENDSEC\n",
            "0\nEOF\n",
        );
        let d = parse_dxf(src).expect("dxf parses");
        assert_eq!(d.arcs.len(), 1);
        assert_eq!(d.arcs[0].center, [1.0, 2.0, 0.0]);
        assert!((d.arcs[0].radius - 3.0).abs() < 1e-9);
        assert!((d.arcs[0].end_angle_deg - 90.0).abs() < 1e-9);
        assert_eq!(d.polylines.len(), 1);
        let pl = &d.polylines[0];
        assert!(pl.closed);
        assert_eq!(pl.vertices, vec![[0.0, 0.0], [1.0, 0.0], [1.0, 1.0]]);
    }

    #[test]
    fn dxf_rejects_empty_input() {
        assert!(parse_dxf("").is_err());
        assert!(parse_dxf("not a dxf at all\njust words\n").is_err());
    }

    #[test]
    fn detect_by_extension() {
        assert_eq!(Format::detect("model.obj"), Some(Format::Obj));
        assert_eq!(Format::detect("MODEL.OBJ"), Some(Format::Obj));
        assert_eq!(Format::detect("part.dxf"), Some(Format::Dxf));
        assert_eq!(Format::detect("scene.gltf"), Some(Format::Gltf));
        assert_eq!(Format::detect("readme.txt"), None);
        assert_eq!(Format::detect("noext"), None);
    }

    #[test]
    fn detect_sniffs_stl_content() {
        let dir = std::env::temp_dir();
        let ascii_path = dir.join("arc_formats_test_ascii.stl");
        let bin_path = dir.join("arc_formats_test_binary.stl");
        std::fs::write(&ascii_path, b"solid thing\nendsolid thing\n").expect("write ascii");
        let mut bin = Vec::new();
        bin.extend_from_slice(&[0u8; 80]);
        bin.extend_from_slice(&1u32.to_le_bytes());
        bin.extend_from_slice(&[0u8; 50]);
        std::fs::write(&bin_path, &bin).expect("write binary");
        assert_eq!(
            Format::detect(ascii_path.to_str().unwrap()),
            Some(Format::StlAscii)
        );
        assert_eq!(Format::detect(bin_path.to_str().unwrap()), Some(Format::Stl));
        let _ = std::fs::remove_file(&ascii_path);
        let _ = std::fs::remove_file(&bin_path);
    }

    #[test]
    fn detect_stl_unreadable_falls_back_to_binary() {
        assert_eq!(
            Format::detect("/definitely/missing/model.stl"),
            Some(Format::Stl)
        );
    }

    #[test]
    fn base64_known_vectors() {
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn gltf_export_structure() {
        let mesh = tri_mesh();
        let s = export_gltf(&mesh, "tri").expect("gltf exports");
        let v: serde_json::Value = serde_json::from_str(&s).expect("valid JSON");
        assert_eq!(v["asset"]["version"], "2.0");
        assert_eq!(v["meshes"][0]["primitives"][0]["mode"], 4);
        assert_eq!(v["meshes"][0]["primitives"][0]["attributes"]["POSITION"], 0);
        assert_eq!(v["meshes"][0]["primitives"][0]["attributes"]["NORMAL"], 1);
        let pos = &v["accessors"][0];
        assert_eq!(pos["type"], "VEC3");
        assert_eq!(pos["componentType"], 5126);
        assert_eq!(pos["count"], 3);
        assert_eq!(pos["min"], json!([0.0, 0.0, 0.0]));
        assert_eq!(pos["max"], json!([1.0, 1.0, 0.0]));

        let uri = v["buffers"][0]["uri"].as_str().expect("buffer uri");
        let payload = uri
            .strip_prefix("data:application/octet-stream;base64,")
            .expect("data uri");
        let blob = base64_decode(payload);
        assert_eq!(blob.len(), (mesh.positions.len() + mesh.normals.len()) * 4);
        let x1 = f32::from_le_bytes(blob[12..16].try_into().unwrap());
        assert!((x1 - 1.0).abs() < 1e-6);
    }

    #[test]
    fn gltf_rejects_empty_mesh() {
        assert!(export_gltf(&MeshBuffer::default(), "x").is_err());
    }

    #[test]
    fn soup_welds_duplicate_vertices() {
        let soup = TriangleSoup::from_triangles([
            [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]],
            [[0.0, 0.0, 0.0], [0.0, 1.0, 0.0], [-1.0, 0.0, 0.0]],
        ]);
        assert_eq!(soup.positions.len(), 4);
        assert_eq!(soup.tri_count(), 2);
        assert_eq!(soup.indices, vec![[0, 1, 2], [0, 2, 3]]);
    }

    #[test]
    fn merge_stl_merges_meshes() {
        let mut a = StlMesh::default();
        a.triangles.push(StlTriangle {
            normal: [0.0, 0.0, 1.0],
            vertices: [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]],
        });
        let mut b = StlMesh::default();
        b.triangles.push(StlTriangle {
            normal: [0.0, 0.0, 1.0],
            vertices: [[0.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
        });
        let soup = merge_stl(&[a, b]);
        assert_eq!(soup.positions.len(), 4);
        assert_eq!(soup.tri_count(), 2);
    }

    #[test]
    fn step_export_parse_round_trip() {
        let mesh = tri_mesh();
        let text = export_step_iso_10303(&mesh, "tri");
        assert!(text.starts_with("ISO-10303-21;\nHEADER;\n"));
        assert!(text.contains("FILE_DESCRIPTION(("));
        assert!(text.contains("FILE_NAME('tri',"));
        assert!(text.contains("FILE_SCHEMA(('MANIFOLD_SURFACE_SHAPE_REPRESENTATION'))"));
        assert!(text.contains("ENDSEC;"));
        assert!(text.trim_end().ends_with("END-ISO-10303-21;"));
        // Every referenced entity id must be defined; counts must match.
        assert!(step_all_refs_defined(&text));
        assert_eq!(text.matches("CARTESIAN_POINT").count(), 3); // welded vertices
        assert_eq!(text.matches("POLY_LOOP").count(), 1);
        assert_eq!(text.matches("FACE_OUTER_BOUND").count(), 1);
        assert_eq!(text.matches("ADVANCED_FACE").count(), 1);

        let parsed = parse_step(&text).expect("exported STEP parses");
        assert_eq!(parsed.name.as_deref(), Some("tri"));
        assert_eq!(parsed.tri_count(), 1);
        assert_eq!(parsed.positions.len(), 3);
        assert_eq!(parsed.indices, vec![[0, 1, 2]]);
        let expected = [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]];
        for (a, b) in parsed.positions.iter().flatten().zip(expected.iter().flatten()) {
            assert!((a - b).abs() < 1e-6, "vertex mismatch {a} vs {b}");
        }
    }

    #[test]
    fn step_round_trip_two_triangle_soup() {
        let mut b = MeshBuilder::new();
        b.push_tri(
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
        );
        b.push_tri(
            [0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
            [1.0, 0.0, 0.0],
        );
        let mesh = b.into_buffer();

        let text = export_step_iso_10303(&mesh, "soup");
        assert!(step_all_refs_defined(&text));
        assert_eq!(text.matches("POLY_LOOP").count(), 2);

        let parsed = parse_step(&text).expect("exported STEP parses");
        assert_eq!(parsed.tri_count(), 2);
        assert_eq!(parsed.positions.len(), 4); // shared edge welded
        assert_eq!(parsed.indices, vec![[0, 1, 2], [0, 2, 3]]);
        assert!((parsed.positions[3][2] - 1.0).abs() < 1e-6);
    }

    #[test]
    fn step_parse_skips_unsupported_entities() {
        let src = concat!(
            "ISO-10303-21;\n",
            "DATA;\n",
            "#1 = CARTESIAN_POINT('',(0.,0.,0.));\n",
            "#2 = CARTESIAN_POINT('',(1.,0.,0.));\n",
            "#3 = CARTESIAN_POINT('',(0.,1.,0.));\n",
            // unsupported entity types must be skipped, not rejected
            "#4 = B_SPLINE_CURVE('',3,(#1,#2),.UNSPECIFIED.,.F.,.F.,(4,4),(0.,1.));\n",
            "#5 = PRODUCT('thing','thing','',());\n",
            // EDGE_LOOP routed through a VERTEX_POINT still yields a triangle
            "#6 = VERTEX_POINT('',#1);\n",
            "#7 = EDGE_LOOP('',(#6,#2,#3));\n",
            "#8 = POLY_LOOP('',(#1,#2,#3));\n",
            "ENDSEC;\n",
            "END-ISO-10303-21;\n",
        );
        let m = parse_step(src).expect("parses despite unsupported entities");
        assert_eq!(m.positions.len(), 3);
        assert_eq!(m.tri_count(), 2);
        assert_eq!(m.indices, vec![[0, 1, 2], [0, 1, 2]]);
    }

    #[test]
    fn step_parse_tolerates_line_breaks_between_tokens() {
        let src = concat!(
            "/* leading\n   comment */\n",
            "#1\n =\n CARTESIAN_POINT\n(\n'a'\n,\n(0.\n,0.\n,0.));\n",
            "#2 = CARTESIAN_POINT('',(1.,0.,0.));\n",
            "#3 = CARTESIAN_POINT('',(0.,1.,0.));\n",
            "#4 = POLY_LOOP('',(#1,\n#2,\n#3));\n",
        );
        let m = parse_step(src).expect("parses across line breaks");
        assert_eq!(m.tri_count(), 1);
        assert_eq!(m.indices[0], [0, 1, 2]);
        assert_eq!(m.positions[0], [0.0, 0.0, 0.0]);
    }

    #[test]
    fn step_parse_lenient_syntax_variants() {
        // CRLF endings, lower-case keywords, no spaces, E-notation reals.
        let src = "ISO-10303-21;\r\nDATA;\r\n\
                   #1=cartesian_point('',(1.5E+2,-2.5e-1,.5));\r\n\
                   #2=CARTESIAN_POINT('',(0.,0.,0.));\r\n\
                   #3=CARTESIAN_POINT('',(1.,0.,0.));\r\n\
                   #4=poly_loop('',(#2,#3,#1));\r\n";
        let m = parse_step(src).expect("lenient parse");
        assert_eq!(m.tri_count(), 1);
        assert_eq!(m.indices[0], [1, 2, 0]);
        assert_eq!(m.positions[0], [150.0, -0.25, 0.5]);
    }

    #[test]
    fn step_parse_skips_unresolvable_loops() {
        let src = concat!(
            "DATA;\n",
            "#1 = CARTESIAN_POINT('',(0.,0.,0.));\n",
            "#2 = CARTESIAN_POINT('',(1.,0.,0.));\n",
            "#3 = CARTESIAN_POINT('',(0.,1.,0.));\n",
            // dangling reference: loop dropped, no panic
            "#4 = POLY_LOOP('',(#1,#2,#99));\n",
            // n-gon (4 refs) and 2-ref loops are not triangles: skipped
            "#5 = POLY_LOOP('',(#1,#2,#3,#2));\n",
            "#6 = POLY_LOOP('',(#1,#2));\n",
        );
        let m = parse_step(src).expect("records exist, so Ok with no triangles");
        assert_eq!(m.positions.len(), 3);
        assert!(m.is_empty());
    }

    #[test]
    fn step_export_name_with_apostrophe_round_trips() {
        let text = export_step_iso_10303(&tri_mesh(), "engineer's part");
        assert!(text.contains("FILE_NAME('engineer''s part',"));
        let parsed = parse_step(&text).expect("parses");
        assert_eq!(parsed.name.as_deref(), Some("engineer's part"));
        assert_eq!(parsed.tri_count(), 1);
    }

    #[test]
    fn step_parse_realistic_topology_chain_is_tolerated() {
        // OpenCascade-style excerpt: a real B-rep topology chain (VERTEX_POINT
        // / EDGE_CURVE / ORIENTED_EDGE / EDGE_LOOP / ADVANCED_FACE). Points
        // are recovered; the loop hangs off ORIENTED_EDGE, so it is skipped
        // rather than misread or rejected (documented limitation).
        let src = concat!(
            "ISO-10303-21;\n",
            "HEADER;\n",
            "FILE_NAME('occ_export.step','2024-01-01T00:00:00',('occ'),('occ'),\n",
            "  'OpenCascade','OpenCascade','');\n",
            "FILE_SCHEMA(('AP203'));\n",
            "ENDSEC;\n",
            "DATA;\n",
            "#1 = CARTESIAN_POINT('',(0.,0.,0.));\n",
            "#2 = CARTESIAN_POINT('',(1.,0.,0.));\n",
            "#3 = CARTESIAN_POINT('',(0.,1.,0.));\n",
            "#4 = VERTEX_POINT('',#1);\n",
            "#5 = VERTEX_POINT('',#2);\n",
            "#6 = VERTEX_POINT('',#3);\n",
            "#7 = LINE('',#1,#8);\n",
            "#8 = VECTOR('',#9,1.);\n",
            "#9 = DIRECTION('',(1.,0.,0.));\n",
            "#10 = EDGE_CURVE('',#4,#5,#7,.T.);\n",
            "#11 = ORIENTED_EDGE('',*,*,#10,.T.);\n",
            "#12 = EDGE_LOOP('',(#11));\n",
            "#13 = FACE_OUTER_BOUND('',#12,.T.);\n",
            "#14 = PLANE('',#15);\n",
            "#15 = AXIS2_PLACEMENT_3D('',#1,#9,#16);\n",
            "#16 = DIRECTION('',(0.,0.,1.));\n",
            "#17 = ADVANCED_FACE('',(#13),#14,.T.);\n",
            "ENDSEC;\n",
            "END-ISO-10303-21;\n",
        );
        let m = parse_step(src).expect("realistic STEP parses");
        assert_eq!(m.name.as_deref(), Some("occ_export.step"));
        assert_eq!(m.positions.len(), 3); // points recovered
        assert!(m.is_empty()); // topology chain not interpreted (limitation)
    }

    #[test]
    fn step_round_trip_large_soup_counts_match() {
        // 500-triangle strip: each triangle shares exactly one corner with
        // its successor, so welding must yield 3 * 500 - 499 unique points.
        let mut b = MeshBuilder::new();
        for i in 0..500u32 {
            let x = i as f64;
            b.push_tri(
                [x, 0.0, 0.0],
                [x + 1.0, 0.0, 0.0],
                [x, 1.0, 0.0],
                [0.0, 0.0, 1.0],
            );
        }
        let mesh = b.into_buffer();
        let text = export_step_iso_10303(&mesh, "strip");
        assert!(step_all_refs_defined(&text));
        let parsed = parse_step(&text).expect("parses");
        assert_eq!(parsed.tri_count(), mesh.tri_count());
        assert_eq!(parsed.positions.len(), 3 * 500 - 499);
    }

    #[test]
    fn step_parse_rejects_garbage() {
        assert!(parse_step("").is_err());
        assert!(parse_step("completely not a step file").is_err());
        assert!(parse_step("ISO-10303-21;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n").is_err());
        assert!(parse_step("# = CARTESIAN_POINT('',(0.,0.,0.));").is_err());
        assert!(parse_step("#1 = CARTESIAN_POINT('',").is_err());
        // truncated export must not panic (partial parse or Err are both fine)
        let full = export_step_iso_10303(&tri_mesh(), "t");
        let _ = parse_step(&full[..full.len() / 2]);
        let _ = parse_step(&full[..9]);
    }

    #[test]
    fn step_parse_reads_file_name_header() {
        let src = concat!(
            "ISO-10303-21;\n",
            "HEADER;\n",
            "FILE_NAME('bracket.step','2026-10-18T00:00:00',('a'),('b'),'p','s','');\n",
            "ENDSEC;\n",
            "DATA;\n",
            "#1 = CARTESIAN_POINT('',(0.,0.,0.));\n",
            "ENDSEC;\n",
            "END-ISO-10303-21;\n",
        );
        let m = parse_step(src).expect("parses");
        assert_eq!(m.name.as_deref(), Some("bracket.step"));
    }

    #[test]
    fn step_detect_extensions() {
        assert_eq!(Format::detect("part.step"), Some(Format::Step));
        assert_eq!(Format::detect("PART.STP"), Some(Format::Step));
        assert_eq!(Format::detect("dir/x/y.step"), Some(Format::Step));
        assert_eq!(Format::Step.extension(), "step");
        assert_eq!(Format::detect("model.stepx"), None);
    }

    #[test]
    fn step_real_formatting() {
        assert_eq!(step_real(0.0), "0.0");
        assert_eq!(step_real(1.0), "1.0");
        assert_eq!(step_real(-2.5), "-2.5");
        assert_eq!(step_real(0.25), "0.25");
        assert_eq!(step_real(f64::NAN), "0.");
        assert_eq!(step_real(f64::INFINITY), "0.");
        // every emitted literal must contain a decimal point (STEP reals)
        for v in [1e-7f64, 1e12, -0.0, 123_456.789] {
            assert!(step_real(v).contains('.'), "{}", step_real(v));
        }
    }

    #[test]
    fn step_timestamp_known_dates() {
        assert_eq!(iso_timestamp_at(0), "1970-01-01T00:00:00");
        assert_eq!(iso_timestamp_at(1_000_000_000), "2001-09-09T01:46:40");
        assert_eq!(iso_timestamp_at(1_760_700_000), "2025-10-17T11:20:00");
    }

    /// Test-only minimal base64 decoder (RFC 4648, padding ignored).
    fn base64_decode(s: &str) -> Vec<u8> {
        fn val(c: u8) -> u32 {
            match c {
                b'A'..=b'Z' => (c - b'A') as u32,
                b'a'..=b'z' => (c - b'a' + 26) as u32,
                b'0'..=b'9' => (c - b'0' + 52) as u32,
                b'+' => 62,
                _ => 63,
            }
        }
        let bytes: Vec<u8> = s.bytes().filter(|&c| c != b'=').collect();
        let mut out = Vec::new();
        for chunk in bytes.chunks(4) {
            let mut word = 0u32;
            for &c in chunk {
                word = (word << 6) | val(c);
            }
            word <<= 6 * (4 - chunk.len()) as u32;
            let triple = [(word >> 16) as u8, (word >> 8) as u8, word as u8];
            out.extend_from_slice(&triple[..chunk.len() - 1]);
        }
        out
    }
}
