//! Boolean solid operations (CSG) on triangle soup meshes.
//!
//! `MeshBuffer` stores non-indexed triangles, which is exactly the input
//! format BSP-tree CSG implementations prefer. `boolean` consumes two
//! meshes and produces the combined result.
//!
//! The algorithm is a faithful port of Evan Wallace's `csg.js` BSP-tree
//! CSG (MIT license), adapted to f64 math and Rust ownership:
//!
//! * each mesh becomes a BSP tree of convex polygons (triangles, plus
//!   convex fragments created by plane splits),
//! * `clip_to` removes the parts of one tree's polygons that lie inside
//!   another tree's solid,
//! * `invert` swaps solid and empty space (flip winding + swap children),
//! * union / difference / intersection are compositions of clip, invert
//!   and rebuild exactly as in the reference implementation, which also
//!   handles overlapping coplanar polygons correctly.
//!
//! Epsilon policy: plane classification uses a single tolerance derived
//! from the scene scale (largest absolute input coordinate), so f32
//! rounding noise in the source meshes does not produce sliver triangles.
//! Polygons whose area falls below `MIN_AREA` are treated as degenerate
//! and dropped on input, after splits, and on output.

use crate::entity::CsgOperation;
use crate::mesh::MeshBuffer;

/// Maximum BSP recursion depth before we bail out with an error instead of
/// hanging on pathological inputs.
const MAX_DEPTH: usize = 32;

/// Polygons (and triangles) with an area below this are considered degenerate.
const MIN_AREA: f64 = 1e-12;

/// Candidate splitting planes examined by the plane-selection heuristic.
const PLANE_CANDIDATES: usize = 16;

/// Below this polygon count the plane heuristic is skipped (first polygon wins),
/// keeping small-mesh tree builds linear.
const HEURISTIC_THRESHOLD: usize = 8;

// Point classification by a plane.
const COPLANAR: u8 = 0;
const FRONT: u8 = 1;
const BACK: u8 = 2;
// (FRONT | BACK) == SPANNING; used in the bitwise classification below.
const SPANNING: u8 = 3;

type Vec3 = [f64; 3];

#[inline]
fn sub(a: Vec3, b: Vec3) -> Vec3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

#[inline]
fn dot(a: Vec3, b: Vec3) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

#[inline]
fn cross(a: Vec3, b: Vec3) -> Vec3 {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

#[inline]
fn norm(a: Vec3) -> f64 {
    (a[0] * a[0] + a[1] * a[1] + a[2] * a[2]).sqrt()
}

#[inline]
fn lerp(a: Vec3, b: Vec3, t: f64) -> Vec3 {
    [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
    ]
}

/// Tolerance for plane classification, scaled to the size of the scene.
/// Input positions are f32, so independently generated "coincident"
/// surfaces differ by roughly f32 rounding (~1e-7 relative); the epsilon
/// must sit above that noise but far below real geometric features.
fn scene_epsilon(a: &MeshBuffer, b: &MeshBuffer) -> f64 {
    let mut scale = 1.0f64;
    for chunk in a.positions.chunks(3).chain(b.positions.chunks(3)) {
        for v in chunk {
            let m = (*v as f64).abs();
            if m > scale {
                scale = m;
            }
        }
    }
    1e-6 * scale
}

/// Newell's method: twice the area magnitude of an (approximately planar) polygon.
fn polygon_area2(vertices: &[Vec3]) -> f64 {
    let mut n = [0.0f64; 3];
    let len = vertices.len();
    for i in 0..len {
        let j = (i + 1) % len;
        n[0] += (vertices[i][1] - vertices[j][1]) * (vertices[i][2] + vertices[j][2]);
        n[1] += (vertices[i][2] - vertices[j][2]) * (vertices[i][0] + vertices[j][0]);
        n[2] += (vertices[i][0] - vertices[j][0]) * (vertices[i][1] + vertices[j][1]);
    }
    norm(n)
}

#[derive(Clone, Copy, Debug)]
struct Plane {
    normal: Vec3,
    w: f64,
}

impl Plane {
    fn from_triangle(a: Vec3, b: Vec3, c: Vec3) -> Option<Plane> {
        let n = cross(sub(b, a), sub(c, a));
        if norm(n) * 0.5 < MIN_AREA {
            return None;
        }
        let len = norm(n);
        let normal = [n[0] / len, n[1] / len, n[2] / len];
        Some(Plane {
            normal,
            w: dot(normal, a),
        })
    }

    fn flip(&mut self) {
        self.normal = [-self.normal[0], -self.normal[1], -self.normal[2]];
        self.w = -self.w;
    }
}

/// A convex polygon. Winding determines the outward normal; `plane` must
/// match the winding (coplanar classification in `split_polygon` relies on
/// the plane normal agreeing with the polygon's front side).
#[derive(Clone, Debug)]
struct Polygon {
    vertices: Vec<Vec3>,
    plane: Plane,
}

impl Polygon {
    /// Build from an input triangle; drops zero-area triangles.
    fn from_triangle(a: Vec3, b: Vec3, c: Vec3) -> Option<Polygon> {
        let plane = Plane::from_triangle(a, b, c)?;
        Some(Polygon {
            vertices: vec![a, b, c],
            plane,
        })
    }

    /// Build a split fragment that inherits its parent's plane (fragments are
    /// coplanar with the parent and keep its winding, so the plane stays valid).
    fn fragment(vertices: Vec<Vec3>, plane: Plane) -> Option<Polygon> {
        if vertices.len() < 3 {
            return None;
        }
        if polygon_area2(&vertices) * 0.5 < MIN_AREA {
            return None;
        }
        Some(Polygon { vertices, plane })
    }

    fn flip(&mut self) {
        self.vertices.reverse();
        self.plane.flip();
    }
}

/// Split `polygon` by `plane`, routing the pieces:
/// * coplanar with matching orientation → `coplanar_front`
/// * coplanar with opposing orientation → `coplanar_back`
/// * strictly in front / in back → `front` / `back`
///
/// (csg.js `Plane.splitPolygon`.)
fn split_polygon(
    plane: &Plane,
    polygon: Polygon,
    eps: f64,
    coplanar_front: &mut Vec<Polygon>,
    coplanar_back: &mut Vec<Polygon>,
    front: &mut Vec<Polygon>,
    back: &mut Vec<Polygon>,
) {
    let mut polygon_type = 0u8;
    let mut types = Vec::with_capacity(polygon.vertices.len());
    for v in &polygon.vertices {
        let t = dot(plane.normal, *v) - plane.w;
        let ty = if t < -eps {
            BACK
        } else if t > eps {
            FRONT
        } else {
            COPLANAR
        };
        polygon_type |= ty;
        types.push(ty);
    }

    match polygon_type {
        COPLANAR => {
            if dot(plane.normal, polygon.plane.normal) > 0.0 {
                coplanar_front.push(polygon);
            } else {
                coplanar_back.push(polygon);
            }
        }
        FRONT => front.push(polygon),
        BACK => back.push(polygon),
        _ => {
            // SPANNING: split the polygon into a front and a back fragment.
            let mut f: Vec<Vec3> = Vec::with_capacity(polygon.vertices.len() + 1);
            let mut b: Vec<Vec3> = Vec::with_capacity(polygon.vertices.len() + 1);
            let len = polygon.vertices.len();
            for i in 0..len {
                let j = (i + 1) % len;
                let (ti, tj) = (types[i], types[j]);
                let (vi, vj) = (polygon.vertices[i], polygon.vertices[j]);
                if ti != BACK {
                    f.push(vi);
                }
                if ti != FRONT {
                    b.push(vi);
                }
                if (ti | tj) == SPANNING {
                    // The edge crosses the plane; ti and tj are on opposite
                    // (non-coplanar) sides, so the denominator is bounded
                    // away from zero by at least 2 * eps.
                    let denom = dot(plane.normal, sub(vj, vi));
                    let t = (plane.w - dot(plane.normal, vi)) / denom;
                    let v = lerp(vi, vj, t);
                    f.push(v);
                    b.push(v);
                }
            }
            if let Some(frag) = Polygon::fragment(f, polygon.plane) {
                front.push(frag);
            }
            if let Some(frag) = Polygon::fragment(b, polygon.plane) {
                back.push(frag);
            }
        }
    }
}

struct Node {
    plane: Option<Plane>,
    front: Option<Box<Node>>,
    back: Option<Box<Node>>,
    polygons: Vec<Polygon>,
}

impl Node {
    fn empty() -> Node {
        Node {
            plane: None,
            front: None,
            back: None,
            polygons: Vec::new(),
        }
    }

    fn from_polygons(polygons: Vec<Polygon>, eps: f64) -> Result<Node, String> {
        let mut node = Node::empty();
        node.build(polygons, eps, 0)?;
        Ok(node)
    }

    /// Build (or extend) the tree with `polygons`. Coplanar polygons are
    /// collected at the node whose plane they lie on.
    fn build(&mut self, polygons: Vec<Polygon>, eps: f64, depth: usize) -> Result<(), String> {
        if polygons.is_empty() {
            return Ok(());
        }
        if depth > MAX_DEPTH {
            return Err(format!(
                "CSG: BSP tree exceeded maximum recursion depth ({MAX_DEPTH})"
            ));
        }
        if self.plane.is_none() {
            self.plane = Some(choose_split_plane(&polygons));
        }
        let plane = self.plane.expect("plane set above");
        let mut coplanar_front = Vec::new();
        let mut coplanar_back = Vec::new();
        let mut front = Vec::new();
        let mut back = Vec::new();
        for p in polygons {
            split_polygon(
                &plane,
                p,
                eps,
                &mut coplanar_front,
                &mut coplanar_back,
                &mut front,
                &mut back,
            );
        }
        self.polygons.extend(coplanar_front);
        self.polygons.extend(coplanar_back);
        if !front.is_empty() {
            if self.front.is_none() {
                self.front = Some(Box::new(Node::empty()));
            }
            self.front
                .as_mut()
                .expect("front created above")
                .build(front, eps, depth + 1)?;
        }
        if !back.is_empty() {
            if self.back.is_none() {
                self.back = Some(Box::new(Node::empty()));
            }
            self.back
                .as_mut()
                .expect("back created above")
                .build(back, eps, depth + 1)?;
        }
        Ok(())
    }

    /// Swap solid and empty space: flip every polygon's winding, flip the
    /// plane, and swap the front/back subtrees.
    fn invert(&mut self) {
        for p in &mut self.polygons {
            p.flip();
        }
        if let Some(plane) = &mut self.plane {
            plane.flip();
        }
        std::mem::swap(&mut self.front, &mut self.back);
        if let Some(front) = &mut self.front {
            front.invert();
        }
        if let Some(back) = &mut self.back {
            back.invert();
        }
    }

    /// Clip `polygons` against this tree, keeping only the parts outside the
    /// solid. Reaching an empty back leaf means "inside the solid" → discard;
    /// an empty front leaf means "outside" → keep.
    fn clip_polygons(&self, polygons: Vec<Polygon>, eps: f64, depth: usize) -> Result<Vec<Polygon>, String> {
        let plane = match &self.plane {
            None => return Ok(polygons),
            Some(plane) => *plane,
        };
        if depth > MAX_DEPTH {
            return Err(format!(
                "CSG: BSP clipping exceeded maximum recursion depth ({MAX_DEPTH})"
            ));
        }
        let mut coplanar_front = Vec::new();
        let mut coplanar_back = Vec::new();
        let mut front = Vec::new();
        let mut back = Vec::new();
        for p in polygons {
            split_polygon(
                &plane,
                p,
                eps,
                &mut coplanar_front,
                &mut coplanar_back,
                &mut front,
                &mut back,
            );
        }
        front.extend(coplanar_front);
        back.extend(coplanar_back);
        let front = match &self.front {
            Some(f) => f.clip_polygons(front, eps, depth + 1)?,
            None => front,
        };
        let back = match &self.back {
            Some(b) => b.clip_polygons(back, eps, depth + 1)?,
            None => Vec::new(),
        };
        let mut out = front;
        out.extend(back);
        Ok(out)
    }

    /// Remove all polygons of this tree that are inside the solid of `other`.
    fn clip_to(&mut self, other: &Node, eps: f64) -> Result<(), String> {
        let own = std::mem::take(&mut self.polygons);
        self.polygons = other.clip_polygons(own, eps, 0)?;
        if let Some(front) = &mut self.front {
            front.clip_to(other, eps)?;
        }
        if let Some(back) = &mut self.back {
            back.clip_to(other, eps)?;
        }
        Ok(())
    }

    fn all_polygons(&self) -> Vec<Polygon> {
        let mut out = self.polygons.clone();
        if let Some(front) = &self.front {
            out.extend(front.all_polygons());
        }
        if let Some(back) = &self.back {
            out.extend(back.all_polygons());
        }
        out
    }
}

/// Plane-selection heuristic: for small inputs use the first polygon's plane
/// (linear, as in the reference implementation); otherwise sample a few
/// candidate planes and pick the one with the fewest estimated splits and the
/// most balanced partition, which keeps typical tree depth close to O(log n)
/// instead of degrading toward O(n²) behavior.
fn choose_split_plane(polygons: &[Polygon]) -> Plane {
    if polygons.len() <= HEURISTIC_THRESHOLD {
        return polygons[0].plane;
    }
    let n = polygons.len();
    let candidates = PLANE_CANDIDATES.min(n);
    let mut best = polygons[0].plane;
    let mut best_score = f64::INFINITY;
    for k in 0..candidates {
        let plane = polygons[k * n / candidates].plane;
        let mut front = 0usize;
        let mut back = 0usize;
        let mut splits = 0usize;
        for p in polygons {
            let mut has_front = false;
            let mut has_back = false;
            for v in &p.vertices {
                let t = dot(plane.normal, *v) - plane.w;
                if t > 1e-9 {
                    has_front = true;
                } else if t < -1e-9 {
                    has_back = true;
                }
            }
            match (has_front, has_back) {
                (true, true) => splits += 1,
                (true, false) => front += 1,
                (false, true) => back += 1,
                _ => {}
            }
        }
        let score = splits as f64 + (front as f64 - back as f64).abs();
        if score < best_score {
            best_score = score;
            best = plane;
        }
    }
    best
}

/// Convert a triangle soup into BSP polygons, dropping degenerate triangles
/// and ignoring malformed trailing data instead of panicking.
fn polygons_from_mesh(mesh: &MeshBuffer) -> Vec<Polygon> {
    let mut polygons = Vec::with_capacity(mesh.positions.len() / 9);
    for chunk in mesh.positions.as_chunks::<9>().0 {
        let a = [chunk[0] as f64, chunk[1] as f64, chunk[2] as f64];
        let b = [chunk[3] as f64, chunk[4] as f64, chunk[5] as f64];
        let c = [chunk[6] as f64, chunk[7] as f64, chunk[8] as f64];
        if let Some(poly) = Polygon::from_triangle(a, b, c) {
            polygons.push(poly);
        }
    }
    polygons
}

/// Fan-triangulate the resulting convex polygons into a `MeshBuffer`.
/// Per-triangle normals are recomputed from the winding; zero-area
/// triangles are dropped.
fn mesh_from_polygons(polygons: &[Polygon]) -> MeshBuffer {
    let mut buffer = MeshBuffer::default();
    for poly in polygons {
        let n_vertices = poly.vertices.len();
        for k in 1..n_vertices - 1 {
            let a = poly.vertices[0];
            let b = poly.vertices[k];
            let c = poly.vertices[k + 1];
            let n = cross(sub(b, a), sub(c, a));
            let len = norm(n);
            if len * 0.5 < MIN_AREA {
                continue;
            }
            let n = [n[0] / len, n[1] / len, n[2] / len];
            for v in [a, b, c] {
                buffer
                    .positions
                    .extend_from_slice(&[v[0] as f32, v[1] as f32, v[2] as f32]);
                buffer
                    .normals
                    .extend_from_slice(&[n[0] as f32, n[1] as f32, n[2] as f32]);
            }
        }
    }
    buffer
}

pub fn boolean(
    op: CsgOperation,
    a: &MeshBuffer,
    b: &MeshBuffer,
) -> Result<MeshBuffer, String> {
    let polys_a = polygons_from_mesh(a);
    let polys_b = polygons_from_mesh(b);

    // Degenerate/empty inputs: resolve trivially instead of feeding the BSP
    // pipeline (an empty tree has no planes, which would make clipping a
    // no-op and could yield a wrong result for `empty - solid`).
    if polys_a.is_empty() {
        return match op {
            CsgOperation::Union => Ok(mesh_from_polygons(&polys_b)),
            CsgOperation::Difference | CsgOperation::Intersection => Ok(MeshBuffer::default()),
        };
    }
    if polys_b.is_empty() {
        return match op {
            CsgOperation::Union | CsgOperation::Difference => Ok(mesh_from_polygons(&polys_a)),
            CsgOperation::Intersection => Ok(MeshBuffer::default()),
        };
    }

    let eps = scene_epsilon(a, b);
    let mut a = Node::from_polygons(polys_a, eps)?;
    let mut b = Node::from_polygons(polys_b, eps)?;

    match op {
        CsgOperation::Union => {
            a.clip_to(&b, eps)?;
            b.clip_to(&a, eps)?;
            b.invert();
            b.clip_to(&a, eps)?;
            b.invert();
            a.build(b.all_polygons(), eps, 0)?;
        }
        CsgOperation::Difference => {
            a.invert();
            a.clip_to(&b, eps)?;
            b.clip_to(&a, eps)?;
            b.invert();
            b.clip_to(&a, eps)?;
            b.invert();
            a.build(b.all_polygons(), eps, 0)?;
            a.invert();
        }
        CsgOperation::Intersection => {
            a.invert();
            b.clip_to(&a, eps)?;
            b.invert();
            a.clip_to(&b, eps)?;
            b.clip_to(&a, eps)?;
            a.build(b.all_polygons(), eps, 0)?;
            a.invert();
        }
    }

    Ok(mesh_from_polygons(&a.all_polygons()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::meshgen;

    fn box_mesh(size: f64, offset: [f64; 3]) -> MeshBuffer {
        let mesh = meshgen::generate(&crate::entity::Geometry::Box {
            width: size,
            depth: size,
            height: size,
            corner_radius: 0.0,
        })
        .unwrap();
        if offset == [0.0, 0.0, 0.0] {
            mesh
        } else {
            let mut out = MeshBuffer::default();
            for chunk in mesh.positions.chunks(9) {
                let mut shifted = chunk.to_vec();
                for i in 0..3 {
                    shifted[i * 3] += offset[0] as f32;
                    shifted[i * 3 + 1] += offset[1] as f32;
                    shifted[i * 3 + 2] += offset[2] as f32;
                }
                out.positions.extend_from_slice(&shifted);
                out.normals.extend_from_slice(&[0.0f32; 9]);
            }
            out
        }
    }

    fn vertices_of(mesh: &MeshBuffer) -> Vec<Vec<f32>> {
        mesh.positions
            .chunks(3)
            .map(|c| vec![c[0], c[1], c[2]])
            .collect()
    }

    #[test]
    fn union_of_coincident_boxes_keeps_at_least_one_box_surface() {
        let a = box_mesh(10.0, [0.0, 0.0, 0.0]);
        let b = box_mesh(10.0, [0.0, 0.0, 0.0]);
        let result = boolean(CsgOperation::Union, &a, &b).unwrap();
        assert!(
            result.tri_count() >= a.tri_count(),
            "union tri count {} < one box {}",
            result.tri_count(),
            a.tri_count()
        );
    }

    #[test]
    fn union_of_disjoint_boxes_concatenates_surfaces() {
        let a = box_mesh(10.0, [0.0, 0.0, 0.0]);
        let b = box_mesh(10.0, [20.0, 0.0, 0.0]);
        let result = boolean(CsgOperation::Union, &a, &b).unwrap();
        assert_eq!(result.tri_count(), a.tri_count() + b.tri_count());
    }

    #[test]
    fn difference_of_inner_box_leaves_outer_shell_outside_inner_box() {
        let big = box_mesh(10.0, [0.0, 0.0, 0.0]);
        let small = box_mesh(4.0, [0.0, 0.0, 0.0]);
        let result = boolean(CsgOperation::Difference, &big, &small).unwrap();
        assert!(
            result.tri_count() >= big.tri_count(),
            "outer shell should survive, got {} tris",
            result.tri_count()
        );
        let eps = 1e-4;
        for v in vertices_of(&result) {
            let inside_inner = v[0] < 2.0 - eps
                && v[0] > -2.0 + eps
                && v[1] < 2.0 - eps
                && v[1] > -2.0 + eps
                && v[2] < 2.0 - eps
                && v[2] > -2.0 + eps;
            assert!(
                !inside_inner,
                "vertex strictly inside the removed inner box: {v:?}"
            );
        }
    }

    #[test]
    fn intersection_of_overlapping_boxes_stays_inside_both() {
        // A: [-5, 5]^3, B: [0, 10] x [-5, 5]^2 → intersection [0, 5]^3.
        let a = box_mesh(10.0, [0.0, 0.0, 0.0]);
        let b = box_mesh(10.0, [5.0, 0.0, 0.0]);
        let result = boolean(CsgOperation::Intersection, &a, &b).unwrap();
        assert!(result.tri_count() > 0, "intersection should be non-empty");
        let eps = 1e-4;
        for v in vertices_of(&result) {
            assert!(v[0] >= -eps && v[0] <= 5.0 + eps, "vertex x = {} outside [0,5]", v[0]);
            assert!(v[1] >= -5.0 - eps && v[1] <= 5.0 + eps, "vertex y = {} outside [-5,5]", v[1]);
            assert!(v[2] >= -5.0 - eps && v[2] <= 5.0 + eps, "vertex z = {} outside [-5,5]", v[2]);
        }
    }

    #[test]
    fn empty_input_handled_gracefully() {
        let empty = MeshBuffer::default();
        let box_mesh = box_mesh(10.0, [0.0, 0.0, 0.0]);

        let union = boolean(CsgOperation::Union, &empty, &box_mesh).unwrap();
        assert_eq!(union.tri_count(), box_mesh.tri_count());
        let union = boolean(CsgOperation::Union, &box_mesh, &empty).unwrap();
        assert_eq!(union.tri_count(), box_mesh.tri_count());

        let diff = boolean(CsgOperation::Difference, &box_mesh, &empty).unwrap();
        assert_eq!(diff.tri_count(), box_mesh.tri_count());
        let diff = boolean(CsgOperation::Difference, &empty, &box_mesh).unwrap();
        assert_eq!(diff.tri_count(), 0);

        let inter = boolean(CsgOperation::Intersection, &empty, &box_mesh).unwrap();
        assert_eq!(inter.tri_count(), 0);
        let inter = boolean(CsgOperation::Intersection, &box_mesh, &empty).unwrap();
        assert_eq!(inter.tri_count(), 0);

        // Both empty.
        let none = boolean(CsgOperation::Union, &empty, &empty).unwrap();
        assert_eq!(none.tri_count(), 0);
    }

    #[test]
    fn degenerate_triangles_are_dropped() {
        let mut mesh = MeshBuffer::default();
        // One valid triangle.
        mesh.positions
            .extend_from_slice(&[0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0]);
        mesh.normals
            .extend_from_slice(&[0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0]);
        // One zero-area (collinear) triangle.
        mesh.positions
            .extend_from_slice(&[0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 2.0, 0.0, 0.0]);
        mesh.normals
            .extend_from_slice(&[0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0]);
        // Trailing garbage (partial triangle) must not panic.
        mesh.positions.extend_from_slice(&[1.0, 2.0, 3.0]);

        let result = boolean(CsgOperation::Union, &mesh, &MeshBuffer::default()).unwrap();
        assert_eq!(result.tri_count(), 1, "degenerate triangles must be dropped");
    }
}
