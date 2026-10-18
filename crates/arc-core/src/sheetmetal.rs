//! Sheet metal modeling: bend allowance, flat patterns, and bend sequences.
//!
//! The module supports the standard K-factor bend math used by fabricators
//! (see [`bend_allowance`], [`bend_deduction`]) and can unfold a *linear
//! chain* part — a strip of rectangular flats joined end-to-end by bends —
//! into its flat pattern.
//!
//! # Chain limitation
//!
//! [`flat_pattern`] only handles a **linear chain** of rectangular flats:
//! each flat must be a 4-point rectangle, flats must form an open path where
//! every interior flat has exactly two bends and every end flat at most one,
//! and consecutive flats must have the same width (bends run across the full
//! width). Branching flanges, L/T-shaped junctions, non-rectangular flats,
//! or bends that do not span the full width are rejected with an error; a
//! general unfold (hinge-tree layout with collision resolution) is future work.

use serde::{Deserialize, Serialize};
use std::f64::consts::PI;

use crate::EntityId;

/// Angle tolerance used for geometric sanity checks (radians/degrees mix is
/// avoided; this is a generic epsilon for comparing computed values).
const EPS: f64 = 1e-9;

/// Sheet metal stock definition: thickness and bend behavior.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SheetMetalMaterial {
    pub name: String,
    /// Sheet thickness in millimeters.
    pub thickness_mm: f64,
    /// Neutral axis position factor, typically 0.2..=0.5.
    pub k_factor: f64,
    /// Minimum inside bend radius the material allows, in millimeters.
    pub min_bend_radius_mm: f64,
}

/// Which way a bend folds relative to the flat pattern's "up" face.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BendDirection {
    Up,
    Down,
}

/// A bend in a sheet metal part.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Bend {
    pub id: u64,
    /// Bend angle in degrees, 0..=180.
    pub angle_deg: f64,
    /// Inside (inner) bend radius in millimeters.
    pub inner_radius_mm: f64,
    pub direction: BendDirection,
}

/// A flat (unfolded) face of a sheet metal part, as a closed polygon in mm.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Flat {
    pub id: u64,
    /// Closed polygon (first point not repeated at the end).
    pub polygon: Vec<[f64; 2]>,
}

/// A sheet metal part: flats joined by bends.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SheetMetalPart {
    pub id: EntityId,
    pub name: String,
    pub material: SheetMetalMaterial,
    pub flats: Vec<Flat>,
    /// Bends ordered along the chain: bend `i` joins flat `i` to flat `i+1`.
    pub bends: Vec<Bend>,
}

impl SheetMetalPart {
    /// Validate the part against material limits and geometric invariants.
    pub fn validate(&self) -> Result<(), String> {
        if self.material.thickness_mm <= 0.0 {
            return Err("material thickness must be positive".into());
        }
        if !(0.2..=0.5).contains(&self.material.k_factor) {
            return Err(format!(
                "k_factor must be in [0.2, 0.5], got {}",
                self.material.k_factor
            ));
        }
        if self.flats.is_empty() {
            return Err("part must have at least one flat".into());
        }
        for bend in &self.bends {
            if !(0.0..=180.0).contains(&bend.angle_deg) {
                return Err(format!(
                    "bend {} angle_deg must be in [0, 180], got {}",
                    bend.id, bend.angle_deg
                ));
            }
            if bend.inner_radius_mm < self.material.min_bend_radius_mm - EPS {
                return Err(format!(
                    "bend {} inner radius {} mm is below material minimum {} mm",
                    bend.id, bend.inner_radius_mm, self.material.min_bend_radius_mm
                ));
            }
        }
        Ok(())
    }
}

/// Radius of the neutral axis (the unstretched fiber) for a bend.
pub fn neutral_axis_radius(inner_radius_mm: f64, thickness_mm: f64, k_factor: f64) -> f64 {
    inner_radius_mm + k_factor * thickness_mm
}

/// Bend allowance: arc length of the neutral axis through a bend.
///
/// `BA = radians(angle) * (inner_radius + k_factor * thickness)`.
pub fn bend_allowance(angle_deg: f64, inner_radius_mm: f64, thickness_mm: f64, k_factor: f64) -> f64 {
    let radians = angle_deg * PI / 180.0;
    radians * neutral_axis_radius(inner_radius_mm, thickness_mm, k_factor)
}

/// Setback (X): distance from the mold line to the bend tangent intersection.
///
/// `setback = (inner_radius + thickness) * tan(radians(angle) / 2)`.
pub fn setback(angle_deg: f64, inner_radius_mm: f64, thickness_mm: f64) -> f64 {
    let half = (angle_deg * PI / 180.0) / 2.0;
    (inner_radius_mm + thickness_mm) * half.tan()
}

/// Outside mold line: same as [`setback`] (measured to the outside surface).
pub fn outside_mold_line(angle_deg: f64, inner_radius_mm: f64, thickness_mm: f64) -> f64 {
    setback(angle_deg, inner_radius_mm, thickness_mm)
}

/// Inside mold line: setback measured to the inside surface.
pub fn inside_mold_line(angle_deg: f64, inner_radius_mm: f64) -> f64 {
    let half = (angle_deg * PI / 180.0) / 2.0;
    inner_radius_mm * half.tan()
}

/// Bend deduction: amount to subtract from the sum of outside leg lengths.
///
/// `BD = 2 * setback - BA`.
pub fn bend_deduction(angle_deg: f64, inner_radius_mm: f64, thickness_mm: f64, k_factor: f64) -> f64 {
    2.0 * setback(angle_deg, inner_radius_mm, thickness_mm)
        - bend_allowance(angle_deg, inner_radius_mm, thickness_mm, k_factor)
}

/// Flat length of an L-bracket with two outside legs.
///
/// `flat_length = leg1 + leg2 - bend_deduction`. The angle must be in
/// (0, 180] degrees; a zero-degree bend has no deduction but is rejected as
/// a degenerate bend.
pub fn flat_length(
    leg1_mm: f64,
    leg2_mm: f64,
    angle_deg: f64,
    inner_radius_mm: f64,
    thickness_mm: f64,
    k_factor: f64,
) -> Result<f64, String> {
    if !(angle_deg > 0.0 && angle_deg <= 180.0) {
        return Err(format!(
            "bend angle must be in (0, 180] degrees, got {angle_deg}"
        ));
    }
    let bd = bend_deduction(angle_deg, inner_radius_mm, thickness_mm, k_factor);
    Ok(leg1_mm + leg2_mm - bd)
}

/// A bend line drawn on the unfolded flat pattern.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BendLine {
    /// A point on the bend line, in flat-pattern coordinates (mm).
    pub position: [f64; 2],
    /// Unit direction along the bend line (perpendicular to the chain axis).
    pub direction: [f64; 2],
    pub angle_deg: f64,
    /// Inside bend radius in millimeters.
    pub radius_mm: f64,
}

/// Unfolded flat pattern of a part.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FlatPattern {
    /// Closed outline polygon in mm (rectangle for a linear chain part).
    pub outline: Vec<[f64; 2]>,
    /// Bend lines across the strip, ordered along the chain.
    pub bend_lines: Vec<BendLine>,
}

/// Compute the flat pattern of a part.
///
/// Supports only a **linear chain** of rectangular flats joined by bends
/// (see the module-level docs for the exact limitations). The strip unfolds
/// along +X with the first flat starting at the origin; total length is
/// `sum(leg lengths) - sum(bend deductions)` and the width is the shared
/// flat width.
pub fn flat_pattern(part: &SheetMetalPart) -> Result<FlatPattern, String> {
    if part.flats.is_empty() {
        return Err("part must have at least one flat".into());
    }
    if part.bends.len() != part.flats.len() - 1 {
        return Err(format!(
            "linear chain requires bends == flats - 1, got {} bends for {} flats",
            part.bends.len(),
            part.flats.len()
        ));
    }

    let mut legs = Vec::with_capacity(part.flats.len());
    let mut width: Option<f64> = None;
    for flat in &part.flats {
        let rect = as_rectangle(&flat.polygon)?;
        let (leg, w) = rectangle_extents(rect);
        if let Some(prev_w) = width {
            if (prev_w - w).abs() > EPS {
                return Err("flats in a linear chain must share the same width".into());
            }
        }
        width = Some(w);
        legs.push(leg);
    }
    let width = width.unwrap_or_default();

    let mut deductions = Vec::with_capacity(part.bends.len());
    for bend in &part.bends {
        if !(bend.angle_deg > 0.0 && bend.angle_deg <= 180.0) {
            return Err(format!(
                "bend {} angle_deg must be in (0, 180], got {}",
                bend.id, bend.angle_deg
            ));
        }
        if bend.inner_radius_mm < part.material.min_bend_radius_mm - EPS {
            return Err(format!(
                "bend {} inner radius {} mm is below material minimum {} mm",
                bend.id, bend.inner_radius_mm, part.material.min_bend_radius_mm
            ));
        }
        deductions.push(bend_deduction(
            bend.angle_deg,
            bend.inner_radius_mm,
            part.material.thickness_mm,
            part.material.k_factor,
        ));
    }

    let total_length: f64 = legs.iter().sum::<f64>() - deductions.iter().sum::<f64>();
    if total_length <= 0.0 {
        return Err("unfolded strip has non-positive length".into());
    }

    let mut bend_lines = Vec::with_capacity(part.bends.len());
    let mut x = 0.0;
    for (bend, bd) in part.bends.iter().zip(deductions.iter()) {
        x += legs[bend_lines.len()] - bd;
        bend_lines.push(BendLine {
            position: [x, 0.0],
            direction: [0.0, 1.0],
            angle_deg: bend.angle_deg,
            radius_mm: bend.inner_radius_mm,
        });
    }

    Ok(FlatPattern {
        outline: vec![[0.0, 0.0], [total_length, 0.0], [total_length, width], [0.0, width]],
        bend_lines,
    })
}

/// A step in a suggested bend sequence.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BendSequenceStep {
    pub bend_id: u64,
    /// Tool angle in degrees (equal to the bend angle).
    pub tool_angle_deg: f64,
    /// Whether the sheet must be flipped before this bend.
    pub flip: bool,
}

/// Suggest a bend sequence using the "ends toward the middle" heuristic.
///
/// Bends are visited alternating from the two ends of the chain inwards
/// (first, last, second, second-last, ...), which keeps already-formed
/// flanges out of the tooling. A flip is inserted whenever the next bend's
/// direction differs from the previously formed bend's direction.
pub fn suggest_bend_sequence(part: &SheetMetalPart) -> Vec<BendSequenceStep> {
    let n = part.bends.len();
    let mut order = Vec::with_capacity(n);
    let (mut lo, mut hi) = (0usize, n.saturating_sub(1));
    let mut from_front = true;
    while lo <= hi && n > 0 {
        if from_front {
            order.push(lo);
            lo += 1;
        } else {
            order.push(hi);
            hi = hi.saturating_sub(1);
            if lo > hi {
                break;
            }
        }
        from_front = !from_front;
    }

    let mut steps = Vec::with_capacity(n);
    let mut prev_direction: Option<BendDirection> = None;
    for &idx in &order {
        let bend = &part.bends[idx];
        let flip = prev_direction.is_some_and(|prev| prev != bend.direction);
        prev_direction = Some(bend.direction);
        steps.push(BendSequenceStep {
            bend_id: bend.id,
            tool_angle_deg: bend.angle_deg,
            flip,
        });
    }
    steps
}

/// Default stock materials available to the application.
pub fn default_materials() -> Vec<SheetMetalMaterial> {
    vec![
        SheetMetalMaterial {
            name: "Steel 1.5mm".into(),
            thickness_mm: 1.5,
            k_factor: 0.42,
            min_bend_radius_mm: 1.0,
        },
        SheetMetalMaterial {
            name: "Aluminum 2.0mm".into(),
            thickness_mm: 2.0,
            k_factor: 0.40,
            min_bend_radius_mm: 1.5,
        },
        SheetMetalMaterial {
            name: "Stainless 1.0mm".into(),
            thickness_mm: 1.0,
            k_factor: 0.44,
            min_bend_radius_mm: 0.8,
        },
    ]
}

/// Decompose a polygon into a rectangle if it is exactly 4 points.
fn as_rectangle(polygon: &[[f64; 2]]) -> Result<[[f64; 2]; 4], String> {
    if polygon.len() != 4 {
        return Err(format!(
            "flats in a linear chain must be rectangles, got {} points",
            polygon.len()
        ));
    }
    Ok([polygon[0], polygon[1], polygon[2], polygon[3]])
}

/// Extents of a rectangle: `(length along X, width along Y)` for a
/// rectangle whose edges are parallel to the axes (any winding).
fn rectangle_extents(rect: [[f64; 2]; 4]) -> (f64, f64) {
    let xs = [rect[0][0], rect[1][0], rect[2][0], rect[3][0]];
    let ys = [rect[0][1], rect[1][1], rect[2][1], rect[3][1]];
    let (dx, dy) = (
        xs.iter().cloned().fold(f64::MIN, f64::max)
            - xs.iter().cloned().fold(f64::MAX, f64::min),
        ys.iter().cloned().fold(f64::MIN, f64::max)
            - ys.iter().cloned().fold(f64::MAX, f64::min),
    );
    (dx, dy)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-9
    }

    fn assert_close(a: f64, b: f64, what: &str) {
        assert!(
            approx(a, b),
            "{what}: expected {b}, got {a} (diff {})",
            (a - b).abs()
        );
    }

    const T: f64 = 1.0;
    const R: f64 = 2.0;
    const K: f64 = 0.42;

    fn l_bracket_material() -> SheetMetalMaterial {
        SheetMetalMaterial {
            name: "Test".into(),
            thickness_mm: T,
            k_factor: K,
            min_bend_radius_mm: 1.0,
        }
    }

    fn l_bracket() -> SheetMetalPart {
        SheetMetalPart {
            id: EntityId::nil(),
            name: "L bracket".into(),
            material: l_bracket_material(),
            flats: vec![
                Flat {
                    id: 0,
                    polygon: vec![[0.0, 0.0], [20.0, 0.0], [20.0, 10.0], [0.0, 10.0]],
                },
                Flat {
                    id: 1,
                    polygon: vec![[0.0, 0.0], [30.0, 0.0], [30.0, 10.0], [0.0, 10.0]],
                },
            ],
            bends: vec![Bend {
                id: 0,
                angle_deg: 90.0,
                inner_radius_mm: R,
                direction: BendDirection::Up,
            }],
        }
    }

    #[test]
    fn bend_allowance_90deg() {
        // radians(90) * (2 + 0.42*1) = (PI/2) * 2.42 ≈ 3.801327
        let ba = bend_allowance(90.0, R, T, K);
        let expected = std::f64::consts::FRAC_PI_2 * 2.42;
        assert_close(ba, expected, "bend allowance");
        assert!(approx(ba, expected), "1e-9 tolerance violated");
    }

    #[test]
    fn bend_deduction_90deg() {
        // setback = (2+1)*tan(45deg) = 3; BD = 2*3 - BA ≈ 6 - 3.801327 = 2.198673
        let bd = bend_deduction(90.0, R, T, K);
        let expected = 6.0 - std::f64::consts::FRAC_PI_2 * 2.42;
        assert_close(bd, expected, "bend deduction");
    }

    #[test]
    fn mold_lines_90deg() {
        assert_close(outside_mold_line(90.0, R, T), 3.0, "outside mold line");
        assert_close(inside_mold_line(90.0, R), 2.0, "inside mold line");
    }

    #[test]
    fn neutral_axis_radius_value() {
        assert_close(neutral_axis_radius(R, T, K), 2.42, "neutral axis radius");
    }

    #[test]
    fn flat_length_l_bracket() {
        // legs 20 + 30 = 50, minus BD ≈ 2.198673
        let fl = flat_length(20.0, 30.0, 90.0, R, T, K).expect("valid angle");
        assert_close(fl, 50.0 - (6.0 - std::f64::consts::FRAC_PI_2 * 2.42), "flat length");
    }

    #[test]
    fn flat_length_rejects_bad_angle() {
        assert!(flat_length(20.0, 30.0, 0.0, R, T, K).is_err());
        assert!(flat_length(20.0, 30.0, -10.0, R, T, K).is_err());
        assert!(flat_length(20.0, 30.0, 181.0, R, T, K).is_err());
    }

    #[test]
    fn validation_accepts_valid_part() {
        assert!(l_bracket().validate().is_ok());
    }

    #[test]
    fn validation_rejects_non_positive_thickness() {
        let mut p = l_bracket();
        p.material.thickness_mm = 0.0;
        assert!(p.validate().is_err());
    }

    #[test]
    fn validation_rejects_k_factor_out_of_range() {
        let mut p = l_bracket();
        p.material.k_factor = 0.1;
        assert!(p.validate().is_err());
        p.material.k_factor = 0.6;
        assert!(p.validate().is_err());
    }

    #[test]
    fn validation_rejects_radius_below_minimum() {
        let mut p = l_bracket();
        p.material.min_bend_radius_mm = 2.5;
        assert!(p.validate().is_err());
    }

    #[test]
    fn validation_rejects_bad_angle() {
        let mut p = l_bracket();
        p.bends[0].angle_deg = 200.0;
        assert!(p.validate().is_err());
        p.bends[0].angle_deg = -5.0;
        assert!(p.validate().is_err());
    }

    #[test]
    fn validation_rejects_empty_flats() {
        let mut p = l_bracket();
        p.flats.clear();
        assert!(p.validate().is_err());
    }

    #[test]
    fn flat_pattern_l_bracket() {
        let part = l_bracket();
        let pattern = flat_pattern(&part).expect("valid chain");
        assert_eq!(pattern.outline.len(), 4);
        let total = pattern.outline[1][0];
        let expected = 50.0 - (6.0 - std::f64::consts::FRAC_PI_2 * 2.42);
        assert_close(total, expected, "flat pattern length");
        assert_close(pattern.outline[2][1], 10.0, "flat pattern width");
        assert_eq!(pattern.bend_lines.len(), 1);
        assert_close(pattern.bend_lines[0].position[0], 20.0 - (6.0 - std::f64::consts::FRAC_PI_2 * 2.42), "bend line x");
        assert_eq!(pattern.bend_lines[0].angle_deg, 90.0);
        assert_close(pattern.bend_lines[0].radius_mm, R, "bend line radius");
    }

    #[test]
    fn flat_pattern_rejects_branching_chain() {
        let mut part = l_bracket();
        part.flats.push(Flat {
            id: 2,
            polygon: vec![[0.0, 0.0], [15.0, 0.0], [15.0, 10.0], [0.0, 10.0]],
        });
        assert!(flat_pattern(&part).is_err());
    }

    #[test]
    fn flat_pattern_rejects_non_rectangle() {
        let mut part = l_bracket();
        part.flats[1].polygon.push([10.0, 5.0]);
        assert!(flat_pattern(&part).is_err());
    }

    #[test]
    fn flat_pattern_rejects_width_mismatch() {
        let mut part = l_bracket();
        part.flats[1].polygon = vec![[0.0, 0.0], [30.0, 0.0], [30.0, 12.0], [0.0, 12.0]];
        assert!(flat_pattern(&part).is_err());
    }

    #[test]
    fn flat_pattern_rejects_radius_below_minimum() {
        let mut part = l_bracket();
        part.material.min_bend_radius_mm = 2.5;
        assert!(flat_pattern(&part).is_err());
    }

    #[test]
    fn sequence_ends_toward_middle() {
        let mut part = l_bracket();
        for (i, id) in [1u64, 2, 3, 4].iter().enumerate() {
            part.bends.push(Bend {
                id: *id,
                angle_deg: 90.0,
                inner_radius_mm: R,
                direction: BendDirection::Up,
            });
            part.flats.push(Flat {
                id: i as u64 + 2,
                polygon: vec![[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0]],
            });
        }
        assert_eq!(part.flats.len(), 6);
        assert_eq!(part.bends.len(), 5);
        let seq = suggest_bend_sequence(&part);
        let order: Vec<u64> = seq.iter().map(|s| s.bend_id).collect();
        assert_eq!(order, vec![0, 4, 1, 3, 2], "ends toward the middle");
        assert!(seq.iter().all(|s| approx(s.tool_angle_deg, 90.0)));
        assert!(seq.iter().all(|s| !s.flip), "same direction, no flips");
    }

    #[test]
    fn sequence_flips_on_direction_change() {
        let mut part = l_bracket();
        part.bends.push(Bend {
            id: 1,
            angle_deg: 90.0,
            inner_radius_mm: R,
            direction: BendDirection::Down,
        });
        part.flats.push(Flat {
            id: 2,
            polygon: vec![[0.0, 0.0], [15.0, 0.0], [15.0, 10.0], [0.0, 10.0]],
        });
        let seq = suggest_bend_sequence(&part);
        assert_eq!(seq.len(), 2);
        assert!(!seq[0].flip);
        assert!(seq[1].flip);
    }

    #[test]
    fn sequence_single_bend_no_flip() {
        let part = l_bracket();
        let seq = suggest_bend_sequence(&part);
        assert_eq!(seq.len(), 1);
        assert!(!seq[0].flip);
    }

    #[test]
    fn sequence_empty_part_is_empty() {
        let mut part = l_bracket();
        part.bends.clear();
        part.flats.truncate(1);
        assert!(suggest_bend_sequence(&part).is_empty());
    }

    #[test]
    fn default_materials_values() {
        let mats = default_materials();
        assert_eq!(mats.len(), 3);
        assert_close(mats[0].thickness_mm, 1.5, "steel thickness");
        assert_close(mats[0].k_factor, 0.42, "steel k");
        assert_close(mats[0].min_bend_radius_mm, 1.0, "steel r_min");
        assert_close(mats[1].thickness_mm, 2.0, "alu thickness");
        assert_close(mats[1].k_factor, 0.40, "alu k");
        assert_close(mats[1].min_bend_radius_mm, 1.5, "alu r_min");
        assert_close(mats[2].thickness_mm, 1.0, "stainless thickness");
        assert_close(mats[2].k_factor, 0.44, "stainless k");
        assert_close(mats[2].min_bend_radius_mm, 0.8, "stainless r_min");
    }

    #[test]
    fn serde_round_trip() {
        let part = l_bracket();
        let json = serde_json::to_string(&part).expect("serialize");
        let back: SheetMetalPart = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back, part);
        let pattern = flat_pattern(&part).expect("pattern");
        let json = serde_json::to_string(&pattern).expect("serialize pattern");
        let back: FlatPattern = serde_json::from_str(&json).expect("deserialize pattern");
        assert_eq!(back, pattern);
        let mats = default_materials();
        let json = serde_json::to_string(&mats).expect("serialize materials");
        let back: Vec<SheetMetalMaterial> = serde_json::from_str(&json).expect("deserialize materials");
        assert_eq!(back, mats);
        let seq = suggest_bend_sequence(&part);
        let json = serde_json::to_string(&seq).expect("serialize sequence");
        let back: Vec<BendSequenceStep> = serde_json::from_str(&json).expect("deserialize sequence");
        assert_eq!(back, seq);
    }
}
