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
//! | DXF (ENTITIES section) | [`parse_dxf`] | - |
//! | glTF 2.0 (JSON) | - | [`export_gltf`] |

use std::collections::HashMap;
use std::path::Path;

use serde_json::json;

use crate::core::mesh::{MeshBuffer, tri_normal};

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
    /// Industry Foundation Classes IFC4 (ISO 16739) (`.ifc`).
    Ifc,
}

impl Format {
    /// Canonical lower-case file extension for this format.
    #[allow(dead_code)]
    pub fn extension(&self) -> &'static str {
        match self {
            Format::Obj => "obj",
            Format::Stl | Format::StlAscii => "stl",
            Format::Dxf => "dxf",
            Format::Gltf => "gltf",
            Format::Step => "step",
            Format::Ifc => "ifc",
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
            "ifc" => Some(Format::Ifc),
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
        Err(
            "not a recognizable STL: neither a valid binary layout nor an ASCII `solid` header"
                .into(),
        )
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
                    return Err(format!(
                        "line {line_no}: expected `facet normal <x> <y> <z>`"
                    ));
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
                    corners.push(obj_corner(
                        c,
                        mesh.positions.len(),
                        mesh.normals.len(),
                        line_no,
                    )?);
                }
                if corners.len() < 3 {
                    return Err(format!(
                        "line {line_no}: face has {} corners (need at least 3)",
                        corners.len()
                    ));
                }
                for k in 1..corners.len() - 1 {
                    mesh.faces
                        .push(vec![corners[0], corners[k], corners[k + 1]]);
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
        .map(|c| {
            if c == '\n' || c == '\r' || c == '\0' {
                ' '
            } else {
                c
            }
        })
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
#[allow(dead_code)]
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
#[allow(dead_code)]
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
    let norm_len = if has_normals {
        mesh.normals.len() * 4
    } else {
        0
    };

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
            vec![json!({ "buffer": 0, "byteOffset": 0, "byteLength": pos_len, "target": 34962 })],
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
#[allow(dead_code)]
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
#[allow(dead_code)]
fn step_string(s: &str) -> String {
    s.replace('\'', "''")
}

/// UTC timestamp for the given Unix seconds, in the `YYYY-MM-DDThh:mm:ss`
/// shape expected by STEP `FILE_NAME` entries (civil-from-days algorithm).
#[allow(dead_code)]
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
#[allow(dead_code)]
fn iso_timestamp() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    iso_timestamp_at(secs)
}

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
    #[allow(dead_code)]
    pub fn tri_count(&self) -> usize {
        self.indices.len()
    }

    /// True when the soup has no triangles.
    pub fn is_empty(&self) -> bool {
        self.indices.is_empty()
    }
}

/// Merge several STL meshes into a single welded [`TriangleSoup`].
#[allow(dead_code)]
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
// IFC4 BIM Export (ISO 16739 / ISO 10303-21 STEP)
// ---------------------------------------------------------------------------

use crate::core::Document;
use crate::core::entity::Geometry;

/// Export document as an ISO 10303-21 IFC4 STEP file.
pub fn export_ifc(doc: &Document) -> String {
    use std::fmt::Write;
    let mut out = String::new();
    let name = if doc.name.is_empty() { "ArcProject" } else { &doc.name };
    let timestamp = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S").to_string();

    writeln!(out, "ISO-10303-21;").unwrap();
    writeln!(out, "HEADER;").unwrap();
    writeln!(out, "FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');").unwrap();
    writeln!(out, "FILE_NAME('{name}.ifc','{timestamp}',('Arc User'),('Arc BIM'),'Arc CAD/BIM v0.26','Arc','');").unwrap();
    writeln!(out, "FILE_SCHEMA(('IFC4'));").unwrap();
    writeln!(out, "ENDSEC;").unwrap();
    writeln!(out, "DATA;").unwrap();

    writeln!(out, "#1=IFCPERSON($,$,'User',$,$,$,$,$);").unwrap();
    writeln!(out, "#2=IFCORGANIZATION($,'Arc CAD',$,$,$);").unwrap();
    writeln!(out, "#3=IFCPERSONANDORGANIZATION(#1,#2,$);").unwrap();
    writeln!(out, "#4=IFCAPPLICATION(#2,'0.26.0','Arc','Arc');").unwrap();
    writeln!(out, "#5=IFCOWNERHISTORY(#3,#4,$,.ADDED.,$,$,$,$);").unwrap();

    writeln!(out, "#6=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);").unwrap();
    writeln!(out, "#7=IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.);").unwrap();
    writeln!(out, "#8=IFCUNITASSIGNMENT((#6,#7));").unwrap();

    writeln!(out, "#9=IFCCARTESIANPOINT((0.,0.,0.));").unwrap();
    writeln!(out, "#10=IFCDIRECTION((0.,0.,1.));").unwrap();
    writeln!(out, "#11=IFCDIRECTION((1.,0.,0.));").unwrap();
    writeln!(out, "#12=IFCAXIS2PLACEMENT3D(#9,#10,#11);").unwrap();
    writeln!(out, "#13=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#12,$);").unwrap();

    writeln!(out, "#14=IFCPROJECT('{}',#5,'{}',$,$,$,$,(#13),#8);", uuid::Uuid::new_v4().simple(), name).unwrap();
    writeln!(out, "#15=IFCSITE('{}',#5,'Site',$,$,#12,$,$,.ELEMENT.,$,$,$,$,$);", uuid::Uuid::new_v4().simple()).unwrap();
    writeln!(out, "#16=IFCBUILDING('{}',#5,'{} Building',$,$,#12,$,$,.ELEMENT.,$,$,$);", uuid::Uuid::new_v4().simple(), name).unwrap();

    let mut id_counter = 20u64;
    let mut storey_ids = Vec::new();

    let levels = if doc.levels.is_empty() {
        vec![crate::core::document::LevelData {
            id: "level-1".to_string(),
            name: "Level 1".to_string(),
            elevation: 0.0,
            height: 300.0,
        }]
    } else {
        doc.levels.clone()
    };

    let mut element_ids_per_storey: Vec<(u64, Vec<u64>)> = Vec::new();

    for level in &levels {
        let sid = id_counter; id_counter += 1;
        let pt_id = id_counter; id_counter += 1;
        let pl_id = id_counter; id_counter += 1;
        let elev_m = level.elevation / 100.0;
        writeln!(out, "#{pt_id}=IFCCARTESIANPOINT((0.,0.,{elev_m:.4}));").unwrap();
        writeln!(out, "#{pl_id}=IFCAXIS2PLACEMENT3D(#{pt_id},#10,#11);").unwrap();
        writeln!(out, "#{sid}=IFCBUILDINGSTOREY('{}',#5,'{}',$,$,#{pl_id},$,$,.ELEMENT.,{elev_m:.4});",
            uuid::Uuid::new_v4().simple(), level.name).unwrap();
        storey_ids.push(sid);
        element_ids_per_storey.push((sid, Vec::new()));
    }

    let default_storey_idx = 0;

    for entity in doc.entities.values() {
        if !entity.visible {
            continue;
        }
        let pos = entity.transform.position;
        let px = pos[0] / 100.0;
        let py = pos[1] / 100.0;
        let pz = pos[2] / 100.0;

        let pt_id = id_counter; id_counter += 1;
        let pl_id = id_counter; id_counter += 1;
        writeln!(out, "#{pt_id}=IFCCARTESIANPOINT(({px:.4},{pz:.4},{py:.4}));").unwrap();
        writeln!(out, "#{pl_id}=IFCAXIS2PLACEMENT3D(#{pt_id},#10,#11);").unwrap();

        let elem_id = id_counter; id_counter += 1;
        let guid = uuid::Uuid::new_v4().simple();
        let ename = if entity.name.is_empty() { entity.kind.type_name() } else { &entity.name };

        match &entity.kind {
            Geometry::Wall { width, height, .. } => {
                let w_m = width / 100.0;
                let h_m = height / 100.0;
                writeln!(out, "#{elem_id}=IFCWALLSTANDARDCASE('{guid}',#5,'{ename}','Wall width={w_m:.2}m height={h_m:.2}m',$,#{pl_id},$,$);").unwrap();
            }
            Geometry::Door { width, height, .. } => {
                let w_m = width / 100.0;
                let h_m = height / 100.0;
                writeln!(out, "#{elem_id}=IFCDOOR('{guid}',#5,'{ename}','Door {w_m:.2}x{h_m:.2}m',$,#{pl_id},$,$,{h_m:.4},{w_m:.4},.DOOR.,.NOTDEFINED.,$);").unwrap();
            }
            Geometry::Window { width, height, .. } => {
                let w_m = width / 100.0;
                let h_m = height / 100.0;
                writeln!(out, "#{elem_id}=IFCWINDOW('{guid}',#5,'{ename}','Window {w_m:.2}x{h_m:.2}m',$,#{pl_id},$,$,{h_m:.4},{w_m:.4},.WINDOW.,.NOTDEFINED.,.NOTDEFINED.,$);").unwrap();
            }
            Geometry::Slab { height, .. } => {
                let th_m = height / 100.0;
                writeln!(out, "#{elem_id}=IFCSLAB('{guid}',#5,'{ename}','Floor Slab th={th_m:.2}m',$,#{pl_id},$,$,.FLOOR.);").unwrap();
            }
            Geometry::Roof { pitch_deg, .. } => {
                writeln!(out, "#{elem_id}=IFCROOF('{guid}',#5,'{ename}','Roof pitch={pitch_deg}deg',$,#{pl_id},$,$,.GABLE_ROOF.);").unwrap();
            }
            Geometry::Column { radius, height, .. } => {
                let r_m = radius / 100.0;
                let h_m = height / 100.0;
                writeln!(out, "#{elem_id}=IFCCOLUMN('{guid}',#5,'{ename}','Column r={r_m:.2}m h={h_m:.2}m',$,#{pl_id},$,$,.COLUMN.);").unwrap();
            }
            Geometry::Beam { length, width, height } => {
                let l_m = length / 100.0;
                let w_m = width / 100.0;
                let h_m = height / 100.0;
                writeln!(out, "#{elem_id}=IFCBEAM('{guid}',#5,'{ename}','Beam {l_m:.2}x{w_m:.2}x{h_m:.2}m',$,#{pl_id},$,$,.BEAM.);").unwrap();
            }
            Geometry::Stair { count, rise, run, .. } => {
                writeln!(out, "#{elem_id}=IFCSTAIR('{guid}',#5,'{ename}','Stair steps={count} rise={rise} run={run}',$,#{pl_id},$,$,.STRAIGHT_RUN_STAIR.);").unwrap();
            }
            Geometry::Room { name, number, .. } => {
                writeln!(out, "#{elem_id}=IFCSPACE('{guid}',#5,'{name}','Room {number}',$,#{pl_id},$,$,.ELEMENT.,.INTERNAL.,$);").unwrap();
            }
            Geometry::Component { component_type, .. } => {
                writeln!(out, "#{elem_id}=IFCFURNISHINGELEMENT('{guid}',#5,'{ename}','Component {component_type}',$,#{pl_id},$,$);").unwrap();
            }
            _ => {
                if entity.kind.has_triangles() {
                    writeln!(out, "#{elem_id}=IFCBUILDINGELEMENTPROXY('{guid}',#5,'{ename}',$,$,#{pl_id},$,$,.ELEMENT.);").unwrap();
                } else {
                    continue;
                }
            }
        }
        element_ids_per_storey[default_storey_idx].1.push(elem_id);
    }

    for (sid, elems) in &element_ids_per_storey {
        if !elems.is_empty() {
            let rel_id = id_counter; id_counter += 1;
            let elem_refs: Vec<String> = elems.iter().map(|e| format!("#{e}")).collect();
            writeln!(out, "#{rel_id}=IFCRELCONTAINEDINSPATIALSTRUCTURE('{}',#5,$,$,({}),#{sid});",
                uuid::Uuid::new_v4().simple(), elem_refs.join(",")).unwrap();
        }
    }

    let rel_proj_site = id_counter; id_counter += 1;
    writeln!(out, "#{rel_proj_site}=IFCRELAGGREGATES('{}',#5,$,$,#14,(#15));", uuid::Uuid::new_v4().simple()).unwrap();

    let rel_site_bldg = id_counter; id_counter += 1;
    writeln!(out, "#{rel_site_bldg}=IFCRELAGGREGATES('{}',#5,$,$,#15,(#16));", uuid::Uuid::new_v4().simple()).unwrap();

    let rel_bldg_storeys = id_counter;
    let storey_refs: Vec<String> = storey_ids.iter().map(|s| format!("#{s}")).collect();
    writeln!(out, "#{rel_bldg_storeys}=IFCRELAGGREGATES('{}',#5,$,$,#16,({}));",
        uuid::Uuid::new_v4().simple(), storey_refs.join(",")).unwrap();

    writeln!(out, "ENDSEC;").unwrap();
    writeln!(out, "END-ISO-10303-21;").unwrap();

    out
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::document::{Document, ProjectMode};
    use crate::core::entity::{Entity, Geometry};

    #[test]
    fn test_architecture_document_and_ifc_export() {
        let mut doc = Document::new_with_mode("Architectural Villa".to_string(), ProjectMode::Architecture);
        assert_eq!(doc.project_mode, ProjectMode::Architecture);
        assert_eq!(doc.levels.len(), 3);
        assert_eq!(doc.grids.len(), 5);

        let wall = Geometry::Wall {
            path: vec![[0.0, 0.0], [500.0, 0.0]],
            width: 25.0,
            height: 300.0,
        };
        let layer_id = doc.layers[0].id;
        let entity = Entity::new(crate::core::EntityId::new(), "Exterior Wall".to_string(), layer_id, wall);
        let _ = doc.add_entity(entity);

        let ifc = export_ifc(&doc);
        assert!(ifc.contains("ISO-10303-21;"));
        assert!(ifc.contains("IFCPROJECT"));
        assert!(ifc.contains("IFCSITE"));
        assert!(ifc.contains("IFCBUILDING"));
        assert!(ifc.contains("IFCBUILDINGSTOREY"));
        assert!(ifc.contains("IFCWALLSTANDARDCASE"));
        assert!(ifc.contains("END-ISO-10303-21;"));
    }
}
