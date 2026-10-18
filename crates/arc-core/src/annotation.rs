//! Professional dimension annotation system for arc 3D modeling.
//!
//! The module covers the full annotation pipeline:
//!
//! - [`DimensionStyle`] and [`DimensionStyleRegistry`]: appearance and
//!   formatting of dimensions (units, precision, text height, arrow size,
//!   extension line geometry, text placement).
//! - Pure measurement math: [`linear_distance`], [`aligned_distance`],
//!   [`rotated_distance`], [`angle_between_directions`], [`circumradius`]
//!   and [`ordinate_value`].
//! - Geometry builders that turn measurements into simple render primitives
//!   (extension line segments, dimension line polyline, arrowhead tips/bases
//!   and the text anchor point): [`LinearDimension`], [`AngularDimension`]
//!   and [`RadialDimension`], all producing a [`DimensionGeometry`].
//! - Persistence-facing containers: [`Annotation`], [`AnnotationKind`],
//!   [`AnnotationLayer`] and [`AnnotationRegistry`].
//!
//! # Units
//!
//! Measurements are computed in scene units. arc scenes are millimeter based
//! (matching [`crate::units::Units::default`]); [`DimensionStyle::format_value`]
//! converts a scene measurement into the style's display unit.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::units::LengthUnit;
use crate::{EntityId, Transform};

/// Geometric tolerance used by all measurement and construction checks in
/// this module (absolute epsilon on lengths, and on angles expressed in
/// degrees).
pub const TOLERANCE: f64 = 1e-9;

/// Dimension types for professional CAD annotations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DimensionType {
    /// Linear dimension: distance between two points
    Linear,
    /// Aligned dimension: distance projected onto a reference axis
    LinearAligned,
    /// Rotated dimension: distance between points with arbitrary orientation
    LinearRotated,
    /// Projected dimension: distance measured along a projection direction
    LinearProjected,
    /// Angular dimension: angle between two intersecting lines
    Angular,
    /// Radial dimension: radius or diameter of a circle/arc
    Radial,
    /// Ordinate dimension: coordinate value from a reference point
    Ordinate,
    /// Custom dimension with user-defined geometry and measurement
    Custom,
}

/// Arrowhead styles for dimension annotations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArrowheadStyle {
    /// Closed filled triangle
    Closed,
    /// Open triangle
    Open,
    /// Dot at the end
    Dot,
    /// Slash mark
    Slash,
    /// No arrowhead
    None,
}

/// Text style for dimension labels.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TextStyle {
    /// Regular text
    Regular,
    /// Bold text
    Bold,
    /// Italic text
    Italic,
    /// Underlined text
    Underlined,
}

/// Where the value label sits relative to the dimension line.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TextPlacement {
    /// Label floats just above (on the offset side of) the dimension line.
    #[default]
    AboveLine,
    /// Label sits centered on the dimension line itself.
    Inline,
}

/// Leader line style for associative annotations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LeaderStyle {
    /// Solid line
    Solid,
    /// Dashed line
    Dashed,
    /// Dotted line
    Dotted,
    /// No leader
    None,
}

/// Line type for annotation lines.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LineType {
    /// Solid line
    Solid,
    /// Dashed line
    Dashed,
    /// Dotted line
    Dotted,
    /// Dash-dot line
    DashDot,
}

/// Millimeters per scene unit for each display unit. Scene measurements are
/// divided by this factor to obtain a display value in the given unit.
pub fn length_unit_factor(unit: LengthUnit) -> f64 {
    match unit {
        LengthUnit::Millimeter => 1.0,
        LengthUnit::Centimeter => 10.0,
        LengthUnit::Meter => 1000.0,
        LengthUnit::Inch => 25.4,
        LengthUnit::Foot => 304.8,
    }
}

/// Unit suffix for a display unit, mirroring `Units::abbreviation`.
pub fn length_unit_abbreviation(unit: LengthUnit) -> &'static str {
    match unit {
        LengthUnit::Millimeter => "mm",
        LengthUnit::Centimeter => "cm",
        LengthUnit::Meter => "m",
        LengthUnit::Inch => "in",
        LengthUnit::Foot => "ft",
    }
}

/// Dimension style defines appearance and formatting for dimension annotations.
///
/// Measurements handled by this module are in scene units (millimeters, see
/// the module docs); `unit` selects the display unit used when formatting
/// values.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DimensionStyle {
    pub id: String,
    pub name: String,
    pub color: [f32; 4],
    pub line_width: f32,
    pub arrowhead: ArrowheadStyle,
    /// Arrowhead length in scene units.
    pub arrow_size: f64,
    pub text_style: TextStyle,
    /// Text height in scene units.
    pub text_size: f64,
    /// Legacy free-form unit label; when set it overrides the abbreviation
    /// derived from `unit` in formatted values.
    pub units: Option<String>,
    /// Decimal places used when formatting values (clamped to 12).
    pub precision: u32,
    pub prefix: String,
    pub suffix: String,
    /// Append the unit abbreviation to formatted values.
    pub show_units: bool,
    /// Legacy duplicate of `show_units`, kept for document compatibility.
    pub show_units_flag: bool,
    /// Measurement scale factor (e.g. 0.5 for a 2:1 detail view).
    pub scale_factor: f64,
    pub dim_scale: f64,
    pub override_dimscale: bool,
    pub leader_arrow: bool,
    pub leader_style: LeaderStyle,
    /// Draw extension lines from the measured points to the dimension line.
    pub extension_line: bool,
    /// Overshoot: how far extension lines run past the dimension line.
    pub extension_length: f64,
    /// Display unit for formatted values.
    #[serde(default)]
    pub unit: LengthUnit,
    /// Gap between a measured point and the start of its extension line.
    #[serde(default = "default_extension_line_offset")]
    pub extension_line_offset: f64,
    /// Where the value label sits relative to the dimension line.
    #[serde(default)]
    pub text_placement: TextPlacement,
}

fn default_extension_line_offset() -> f64 {
    1.0
}

impl Default for DimensionStyle {
    /// ISO-style metric defaults for a millimeter scene: 3.5 mm text,
    /// 3 mm arrows, 1 mm extension line gap and 2 mm overshoot.
    fn default() -> Self {
        Self {
            id: "style-default".to_string(),
            name: "default".to_string(),
            color: [0.62, 0.62, 0.65, 1.0], // GRAY
            line_width: 1.0,
            arrowhead: ArrowheadStyle::Closed,
            arrow_size: 3.0,
            text_style: TextStyle::Regular,
            text_size: 3.5,
            units: None,
            precision: 2,
            prefix: String::new(),
            suffix: String::new(),
            show_units: true,
            show_units_flag: true,
            scale_factor: 1.0,
            dim_scale: 1.0,
            override_dimscale: false,
            leader_arrow: false,
            leader_style: LeaderStyle::Solid,
            extension_line: true,
            extension_length: 2.0,
            unit: LengthUnit::Millimeter,
            extension_line_offset: 1.0,
            text_placement: TextPlacement::AboveLine,
        }
    }
}

impl DimensionStyle {
    pub fn new(name: String) -> Self {
        Self {
            id: format!("style-{}", name.to_lowercase().replace(' ', "-")),
            name,
            ..Self::default()
        }
    }

    /// Format a scene-unit length measurement using this style: applies the
    /// measurement `scale_factor`, converts to the display `unit`, rounds to
    /// `precision` decimals and appends prefix/unit abbreviation/suffix.
    pub fn format_value(&self, value: f64) -> String {
        let p = self.precision.min(12) as usize;
        let display = value * self.scale_factor / length_unit_factor(self.unit);
        let mut body = format!("{:.*}", p, display);
        if self.show_units {
            body.push(' ');
            body.push_str(self.units.as_deref().unwrap_or(length_unit_abbreviation(self.unit)));
        }
        format!("{}{}{}", self.prefix, body, self.suffix)
    }

    /// Format an angle in degrees using this style. Angle values are never
    /// unit-converted; `show_units` only controls the degree sign.
    pub fn format_angle(&self, degrees: f64) -> String {
        let p = self.precision.min(12) as usize;
        let mut body = format!("{:.*}", p, degrees);
        if self.show_units {
            body.push('°');
        }
        format!("{}{}{}", self.prefix, body, self.suffix)
    }
}

/// Registry of dimension styles keyed by [`DimensionStyle::name`].
///
/// Always contains a `"default"` style; annotations referencing a missing
/// style fall back to it via [`DimensionStyleRegistry::get_or_default`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DimensionStyleRegistry {
    styles: BTreeMap<String, DimensionStyle>,
}

impl Default for DimensionStyleRegistry {
    fn default() -> Self {
        let style = DimensionStyle::default();
        Self {
            styles: BTreeMap::from([(style.name.clone(), style)]),
        }
    }
}

impl DimensionStyleRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Look up a style by name.
    pub fn get(&self, name: &str) -> Option<&DimensionStyle> {
        self.styles.get(name)
    }

    /// Look up a style by name, falling back to the default style.
    pub fn get_or_default(&self, name: &str) -> DimensionStyle {
        self.styles.get(name).cloned().unwrap_or_default()
    }

    /// Insert a style, keyed by its own name; returns the replaced style.
    pub fn insert(&mut self, style: DimensionStyle) -> Option<DimensionStyle> {
        self.styles.insert(style.name.clone(), style)
    }

    /// Remove a style by name.
    pub fn remove(&mut self, name: &str) -> Option<DimensionStyle> {
        self.styles.remove(name)
    }

    /// Whether a style with this name exists.
    pub fn contains(&self, name: &str) -> bool {
        self.styles.contains_key(name)
    }

    /// All style names, sorted.
    pub fn names(&self) -> Vec<String> {
        self.styles.keys().cloned().collect()
    }

    pub fn len(&self) -> usize {
        self.styles.len()
    }

    pub fn is_empty(&self) -> bool {
        self.styles.is_empty()
    }

    /// Iterate over `(name, style)` pairs, sorted by name.
    pub fn iter(&self) -> impl Iterator<Item = (&String, &DimensionStyle)> {
        self.styles.iter()
    }
}

// --- vector helpers (private) ---

fn sub3(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn add3(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

fn scale3(a: [f64; 3], s: f64) -> [f64; 3] {
    [a[0] * s, a[1] * s, a[2] * s]
}

fn dot3(a: [f64; 3], b: [f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn cross3(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn len3(a: [f64; 3]) -> f64 {
    dot3(a, a).sqrt()
}

/// Unit vector, or `None` when the input is too short to be a direction.
fn normalize3(a: [f64; 3]) -> Option<[f64; 3]> {
    let len = len3(a);
    if len < TOLERANCE {
        None
    } else {
        Some(scale3(a, 1.0 / len))
    }
}

fn mid3(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    scale3(add3(a, b), 0.5)
}

// --- measurement math ---

/// Normalize an angle in degrees into `[0, 360)`, snapping values within
/// [`TOLERANCE`] of 0/90/180/270 to the exact cardinal angles.
fn normalize_degrees(deg: f64) -> f64 {
    let d = deg.rem_euclid(360.0);
    if d < TOLERANCE || d > 360.0 - TOLERANCE {
        0.0
    } else if (d - 90.0).abs() < TOLERANCE {
        90.0
    } else if (d - 180.0).abs() < TOLERANCE {
        180.0
    } else if (d - 270.0).abs() < TOLERANCE {
        270.0
    } else {
        d
    }
}

/// Euclidean distance between two 3D points.
pub fn linear_distance(a: [f64; 3], b: [f64; 3]) -> f64 {
    len3(sub3(b, a))
}

/// Aligned distance: the true distance between `a` and `b` as seen along the
/// reference direction, i.e. the absolute projection of `b - a` onto the
/// normalized `reference` direction.
///
/// Errors when `reference` is degenerate (length < [`TOLERANCE`]).
pub fn aligned_distance(a: [f64; 3], b: [f64; 3], reference: [f64; 3]) -> Result<f64, String> {
    let dir = normalize3(reference).ok_or_else(|| "degenerate reference direction".to_string())?;
    Ok(dot3(sub3(b, a), dir).abs())
}

/// Rotated distance: the absolute projection of `b - a` onto the direction
/// lying in the plane with the given `normal`, at `angle_deg` from the
/// in-plane reference axis picked by the function.
///
/// Errors when `normal` is degenerate. Coincident points measure as `0.0`.
pub fn rotated_distance(
    a: [f64; 3],
    b: [f64; 3],
    normal: [f64; 3],
    angle_deg: f64,
) -> Result<f64, String> {
    let n = normalize3(normal).ok_or_else(|| "degenerate plane normal".to_string())?;
    let delta = sub3(b, a);
    if len3(delta) < TOLERANCE {
        return Ok(0.0);
    }
    // In-plane basis: reference axis least aligned with the normal.
    let axis = if n[0].abs() <= n[1].abs() && n[0].abs() <= n[2].abs() {
        [1.0, 0.0, 0.0]
    } else if n[1].abs() <= n[2].abs() {
        [0.0, 1.0, 0.0]
    } else {
        [0.0, 0.0, 1.0]
    };
    let e1 = normalize3(sub3(axis, scale3(n, dot3(axis, n))))
        .ok_or_else(|| "degenerate plane normal".to_string())?;
    let e2 = cross3(n, e1);
    let theta = angle_deg.to_radians();
    let u = add3(scale3(e1, theta.cos()), scale3(e2, theta.sin()));
    Ok(dot3(delta, u).abs())
}

/// Angle between two line directions in degrees.
///
/// Without a `normal` the result is the unsigned angle in `[0, 180]`. With a
/// reference `normal` the result is the oriented (right-handed about
/// `normal`) angle from `u` to `v` in `[0, 360)`. Values within
/// [`TOLERANCE`] of the cardinal angles are snapped to them exactly.
///
/// Errors when any of `u`, `v` or `normal` is degenerate.
pub fn angle_between_directions(
    u: [f64; 3],
    v: [f64; 3],
    normal: Option<[f64; 3]>,
) -> Result<f64, String> {
    let uu = normalize3(u).ok_or_else(|| "degenerate direction u".to_string())?;
    let vv = normalize3(v).ok_or_else(|| "degenerate direction v".to_string())?;
    let cos = dot3(uu, vv).clamp(-1.0, 1.0);
    match normal {
        None => {
            let deg = cos.acos().to_degrees();
            if deg > 180.0 - TOLERANCE {
                Ok(180.0)
            } else if deg < TOLERANCE {
                Ok(0.0)
            } else {
                Ok(deg)
            }
        }
        Some(n) => {
            let nn = normalize3(n).ok_or_else(|| "degenerate reference normal".to_string())?;
            let sin = dot3(nn, cross3(uu, vv));
            Ok(normalize_degrees(sin.atan2(cos).to_degrees()))
        }
    }
}

/// Radius of the circle through three points (circumradius).
///
/// Uses the classic determinant/area form `R = |AB|·|BC|·|CA| / (2·Area)`
/// with the area computed from the cross product of the triangle edges.
///
/// Errors when the points are collinear or coincident (zero triangle area).
pub fn circumradius(a: [f64; 3], b: [f64; 3], c: [f64; 3]) -> Result<f64, String> {
    let ab = linear_distance(a, b);
    let bc = linear_distance(b, c);
    let ca = linear_distance(c, a);
    let twice_area = len3(cross3(sub3(b, a), sub3(c, a)));
    if twice_area < TOLERANCE {
        return Err("circumradius points are collinear or coincident".to_string());
    }
    Ok(ab * bc * ca / (2.0 * twice_area))
}

/// Ordinate value of `point` measured from `origin` along `direction`:
/// the signed projection of `point - origin` onto the normalized direction.
///
/// Errors when `direction` is degenerate.
pub fn ordinate_value(point: [f64; 3], origin: [f64; 3], direction: [f64; 3]) -> Result<f64, String> {
    let dir = normalize3(direction).ok_or_else(|| "degenerate ordinate direction".to_string())?;
    Ok(dot3(sub3(point, origin), dir))
}

// --- dimension builders ---

/// Linear dimension between two points, displaced by `offset` along
/// `offset_dir`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LinearDimension {
    /// First measured point (extension line origin).
    pub start: [f64; 3],
    /// Second measured point (extension line origin).
    pub end: [f64; 3],
    /// Direction from the measured points toward the dimension line,
    /// typically perpendicular to `end - start`.
    pub offset_dir: [f64; 3],
    /// Distance from the measured line to the dimension line (>= 0).
    pub offset: f64,
}

impl LinearDimension {
    /// Build the render geometry for a linear dimension between `start` and
    /// `end`, with the dimension line displaced by `offset` along
    /// `offset_dir`, drawn with `style`.
    ///
    /// Errors when the points are coincident, `offset_dir` is degenerate, or
    /// `offset_dir` is parallel to the measured line.
    pub fn build(
        start: [f64; 3],
        end: [f64; 3],
        offset_dir: [f64; 3],
        offset: f64,
        style: &DimensionStyle,
    ) -> Result<DimensionGeometry, String> {
        Self { start, end, offset_dir, offset }.to_geometry(style)
    }

    /// Build the render geometry for this dimension with `style`.
    ///
    /// Extension lines run from `extension_line_offset` away from each
    /// measured point to `offset + extension_length` along `offset_dir`. The
    /// dimension line joins the two offset points; arrowheads point inward
    /// along it (flipped outward when the line is too short for two inward
    /// arrows). The text anchor is the dimension line midpoint, lifted by
    /// 3/4 of the text height on the offset side for
    /// [`TextPlacement::AboveLine`].
    pub fn to_geometry(&self, style: &DimensionStyle) -> Result<DimensionGeometry, String> {
        let delta = sub3(self.end, self.start);
        let dist = len3(delta);
        if dist < TOLERANCE {
            return Err("linear dimension points are coincident".to_string());
        }
        let dir = scale3(delta, 1.0 / dist);
        let n = normalize3(self.offset_dir)
            .ok_or_else(|| "degenerate offset direction".to_string())?;
        if len3(cross3(n, dir)) < TOLERANCE {
            return Err("offset direction must not be parallel to the measured line".to_string());
        }
        let offset = self.offset.max(0.0);
        let gap = style.extension_line_offset.max(0.0);
        let overshoot = style.extension_length.max(0.0);
        let arrow = style.arrow_size.max(0.0);

        let line_start = add3(self.start, scale3(n, offset));
        let line_end = add3(self.end, scale3(n, offset));

        let extension_lines = vec![
            (
                add3(self.start, scale3(n, gap)),
                add3(self.start, scale3(n, (offset + overshoot).max(gap))),
            ),
            (
                add3(self.end, scale3(n, gap)),
                add3(self.end, scale3(n, (offset + overshoot).max(gap))),
            ),
        ];

        let (arrow_tips, arrow_bases) = if arrow <= 0.0 {
            (Vec::new(), Vec::new())
        } else if dist > 2.0 * arrow {
            // arrows point inward along the dimension line
            (
                vec![line_start, line_end],
                vec![
                    add3(line_start, scale3(dir, arrow)),
                    add3(line_end, scale3(dir, -arrow)),
                ],
            )
        } else {
            // cramped line: arrows sit outside, still pointing inward
            (
                vec![line_start, line_end],
                vec![
                    add3(line_start, scale3(dir, -arrow)),
                    add3(line_end, scale3(dir, arrow)),
                ],
            )
        };

        let text_midpoint = match style.text_placement {
            TextPlacement::Inline => mid3(line_start, line_end),
            TextPlacement::AboveLine => {
                add3(mid3(line_start, line_end), scale3(n, style.text_size.max(0.0) * 0.75))
            }
        };

        Ok(DimensionGeometry {
            dimension_type: DimensionType::Linear,
            start: self.start,
            end: self.end,
            ref_point: None,
            angular_ref_points: None,
            radial_center: None,
            radial_value: None,
            ordinate_ref: None,
            ordinate_origin: None,
            style_id: Some(style.id.clone()),
            custom_data: None,
            leader_start: None,
            leader_end: None,
            value: dist,
            text: Some(style.format_value(dist)),
            extension_lines,
            dimension_line: vec![line_start, line_end],
            arrow_tips,
            arrow_bases,
            text_midpoint,
        })
    }
}

/// Angular dimension at `vertex` between the rays towards `a` and `b`,
/// dimensioned with an arc of the given `radius`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AngularDimension {
    /// Shared origin of both rays.
    pub vertex: [f64; 3],
    /// First ray target (defines the arc start direction).
    pub a: [f64; 3],
    /// Second ray target (defines the arc end direction).
    pub b: [f64; 3],
    /// Arc radius in scene units (> 0).
    pub radius: f64,
}

impl AngularDimension {
    /// Build the render geometry for an angular dimension between the rays
    /// `vertex -> a` and `vertex -> b`, dimensioned by an arc of `radius`,
    /// drawn with `style`.
    ///
    /// The arc sweeps right-handed about `ua x ub` (so the value is in
    /// `(0, 180)` degrees). Errors when either ray is degenerate, the rays
    /// are collinear, or `radius` is not positive.
    pub fn build(
        vertex: [f64; 3],
        a: [f64; 3],
        b: [f64; 3],
        radius: f64,
        style: &DimensionStyle,
    ) -> Result<DimensionGeometry, String> {
        Self { vertex, a, b, radius }.to_geometry(style)
    }

    /// Build the render geometry for this dimension with `style`.
    ///
    /// The dimension "line" is a sampled arc (5° per sample, 8..64 samples).
    /// Extension lines run along both rays from just outside the vertex to
    /// slightly past the arc. Arrowheads sit on the arc ends pointing along
    /// the sweep, with bases one arrow length back along the arc (clamped so
    /// they never cross on short arcs). The text anchor sits on the mid-ray,
    /// pushed 3/4 of the text height beyond the arc for
    /// [`TextPlacement::AboveLine`].
    pub fn to_geometry(&self, style: &DimensionStyle) -> Result<DimensionGeometry, String> {
        if self.radius < TOLERANCE {
            return Err("angular dimension radius must be positive".to_string());
        }
        let ua = normalize3(sub3(self.a, self.vertex))
            .ok_or_else(|| "degenerate angular ray a".to_string())?;
        let ub = normalize3(sub3(self.b, self.vertex))
            .ok_or_else(|| "degenerate angular ray b".to_string())?;
        let normal = normalize3(cross3(ua, ub))
            .ok_or_else(|| "angular rays are collinear".to_string())?;
        let sweep = dot3(ua, ub).clamp(-1.0, 1.0).acos();
        let sweep_deg = sweep.to_degrees();

        let radius = self.radius;
        let gap = style.extension_line_offset.max(0.0);
        let overshoot = style.extension_length.max(0.0);
        let arrow = style.arrow_size.max(0.0);

        // Sampled dimension arc from ua to ub about the right-hand normal.
        let segments = ((sweep_deg / 5.0).ceil() as usize).clamp(8, 64);
        let mut dimension_line = Vec::with_capacity(segments + 1);
        for i in 0..=segments {
            let angle = sweep * i as f64 / segments as f64;
            let point = Transform::from_axis_angle(normal, angle).transform_point(scale3(ua, radius));
            dimension_line.push(add3(self.vertex, point));
        }

        let extension_lines = vec![
            (
                add3(self.vertex, scale3(ua, gap.min(radius * 0.5))),
                add3(self.vertex, scale3(ua, radius + overshoot)),
            ),
            (
                add3(self.vertex, scale3(ub, gap.min(radius * 0.5))),
                add3(self.vertex, scale3(ub, radius + overshoot)),
            ),
        ];

        // Arrowheads: tips on the arc ends, bases one arrow length back along
        // the arc (clamped so the two bases never cross on short arcs).
        let (arrow_tips, arrow_bases) = if arrow <= 0.0 {
            (Vec::new(), Vec::new())
        } else {
            let tip_start = add3(self.vertex, scale3(ua, radius));
            let tip_end = add3(self.vertex, scale3(ub, radius));
            let delta = (arrow / radius).min(sweep * 0.49);
            let base_start = add3(
                self.vertex,
                Transform::from_axis_angle(normal, delta).transform_point(scale3(ua, radius)),
            );
            let base_end = add3(
                self.vertex,
                Transform::from_axis_angle(normal, -delta).transform_point(scale3(ub, radius)),
            );
            (vec![tip_start, tip_end], vec![base_start, base_end])
        };

        let mid_dir = Transform::from_axis_angle(normal, sweep * 0.5).transform_point(ua);
        let lift = match style.text_placement {
            TextPlacement::Inline => 0.0,
            TextPlacement::AboveLine => style.text_size.max(0.0) * 0.75,
        };
        let text_midpoint = add3(self.vertex, scale3(mid_dir, radius + lift));

        Ok(DimensionGeometry {
            dimension_type: DimensionType::Angular,
            start: self.a,
            end: self.b,
            ref_point: None,
            angular_ref_points: Some((self.a, self.b)),
            radial_center: None,
            radial_value: None,
            ordinate_ref: None,
            ordinate_origin: None,
            style_id: Some(style.id.clone()),
            custom_data: None,
            leader_start: None,
            leader_end: None,
            value: sweep_deg,
            text: Some(style.format_angle(sweep_deg)),
            extension_lines,
            dimension_line,
            arrow_tips,
            arrow_bases,
            text_midpoint,
        })
    }
}

/// Radial dimension of a circle or arc: leader from `center` through `rim`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RadialDimension {
    /// Circle/arc center.
    pub center: [f64; 3],
    /// A point on the circle/arc rim.
    pub rim: [f64; 3],
}

impl RadialDimension {
    /// Build the render geometry for a radial dimension from `center` to a
    /// point `rim` on the circle, drawn with `style`.
    ///
    /// Errors when `rim` coincides with `center`.
    pub fn build(
        center: [f64; 3],
        rim: [f64; 3],
        style: &DimensionStyle,
    ) -> Result<DimensionGeometry, String> {
        Self { center, rim }.to_geometry(style)
    }

    /// Build the render geometry for this dimension with `style`.
    ///
    /// The dimension line runs from the center to the rim extended by the
    /// extension overshoot; the arrowhead sits on the rim pointing outward.
    /// The label is prefixed with `R` and anchored at the dimension line
    /// midpoint (radial labels are always inline: there is no unambiguous
    /// "above" side in 3D without an extra reference normal).
    pub fn to_geometry(&self, style: &DimensionStyle) -> Result<DimensionGeometry, String> {
        let delta = sub3(self.rim, self.center);
        let radius = len3(delta);
        if radius < TOLERANCE {
            return Err("radial dimension rim must differ from center".to_string());
        }
        let u = scale3(delta, 1.0 / radius);
        let overshoot = style.extension_length.max(0.0);
        let arrow = style.arrow_size.max(0.0);

        let line_end = add3(self.rim, scale3(u, overshoot));
        let (arrow_tips, arrow_bases) = if arrow <= 0.0 {
            (Vec::new(), Vec::new())
        } else {
            (vec![self.rim], vec![add3(self.rim, scale3(u, -arrow))])
        };
        let text_midpoint = mid3(self.center, line_end);

        Ok(DimensionGeometry {
            dimension_type: DimensionType::Radial,
            start: self.center,
            end: self.rim,
            ref_point: None,
            angular_ref_points: None,
            radial_center: Some(self.center),
            radial_value: Some(radius),
            ordinate_ref: None,
            ordinate_origin: None,
            style_id: Some(style.id.clone()),
            custom_data: None,
            leader_start: None,
            leader_end: None,
            value: radius,
            text: Some(format!("R{}", style.format_value(radius))),
            extension_lines: Vec::new(),
            dimension_line: vec![self.center, line_end],
            arrow_tips,
            arrow_bases,
            text_midpoint,
        })
    }
}

/// Dimension geometry with type-specific parameters.
///
/// The `extension_lines`, `dimension_line`, `arrow_tips`, `arrow_bases` and
/// `text_midpoint` fields carry the plain render primitives produced by the
/// builders; the remaining fields describe the measured parameters.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DimensionGeometry {
    pub dimension_type: DimensionType,
    /// Start point of the dimension
    pub start: [f64; 3],
    /// End point of the dimension
    pub end: [f64; 3],
    /// Reference point for aligned/rotated dimensions
    pub ref_point: Option<[f64; 3]>,
    /// Reference line for angular dimensions (two points)
    pub angular_ref_points: Option<([f64; 3], [f64; 3])>,
    /// Circle/arc center for radial dimensions
    pub radial_center: Option<[f64; 3]>,
    /// Radius or diameter for radial dimensions
    pub radial_value: Option<f64>,
    /// Ordinate reference point and direction
    pub ordinate_ref: Option<([f64; 3], [f64; 3])>,
    /// Ordinate origin
    pub ordinate_origin: Option<[f64; 3]>,
    /// Dimension style reference
    pub style_id: Option<String>,
    /// Custom geometry data
    pub custom_data: Option<serde_json::Value>,
    /// Leader start point
    pub leader_start: Option<[f64; 3]>,
    /// Leader end point
    pub leader_end: Option<[f64; 3]>,
    /// Measured value in scene units (length) or degrees (angular).
    #[serde(default)]
    pub value: f64,
    /// Auto-formatted measurement label produced by the builder.
    #[serde(default)]
    pub text: Option<String>,
    /// Extension line segments as `(start, end)` point pairs.
    #[serde(default)]
    pub extension_lines: Vec<([f64; 3], [f64; 3])>,
    /// Dimension line as a polyline: two points for linear/radial
    /// dimensions, a sampled arc for angular dimensions.
    #[serde(default)]
    pub dimension_line: Vec<[f64; 3]>,
    /// Arrowhead tips; pairs with `arrow_bases` by index.
    #[serde(default)]
    pub arrow_tips: Vec<[f64; 3]>,
    /// Arrowhead base points; pairs with `arrow_tips` by index.
    #[serde(default)]
    pub arrow_bases: Vec<[f64; 3]>,
    /// Anchor point for the value label.
    #[serde(default)]
    pub text_midpoint: [f64; 3],
}

impl Default for DimensionGeometry {
    fn default() -> Self {
        Self {
            dimension_type: DimensionType::Linear,
            start: [0.0; 3],
            end: [0.0; 3],
            ref_point: None,
            angular_ref_points: None,
            radial_center: None,
            radial_value: None,
            ordinate_ref: None,
            ordinate_origin: None,
            style_id: None,
            custom_data: None,
            leader_start: None,
            leader_end: None,
            value: 0.0,
            text: None,
            extension_lines: Vec::new(),
            dimension_line: Vec::new(),
            arrow_tips: Vec::new(),
            arrow_bases: Vec::new(),
            text_midpoint: [0.0; 3],
        }
    }
}

/// Extension line for dimensions.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExtensionLine {
    pub start: [f64; 3],
    pub end: [f64; 3],
    pub color: [f32; 4],
    pub line_width: f32,
}

/// Arrow for dimensions.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Arrow {
    pub tip: [f64; 3],
    pub wing1: [f64; 3],
    pub wing2: [f64; 3],
    pub color: [f32; 4],
    pub line_width: f32,
}

/// Annotation layer for organizing annotation entities.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AnnotationLayer {
    pub id: String,
    pub name: String,
    pub visible: bool,
    pub locked: bool,
    pub color: [f32; 4],
    pub line_type: LineType,
    pub line_weight: f32,
    /// Auto-number dimensions
    pub auto_number: bool,
    /// Dimension prefix
    pub dimension_prefix: String,
    /// Dimension suffix
    pub dimension_suffix: String,
}

impl AnnotationLayer {
    /// Id of the layer created by [`AnnotationLayer::default_layer`], also
    /// the default `layer` value of new [`Annotation`]s.
    pub const DEFAULT_ID: &str = "layer-dimensions";

    pub fn new(name: String) -> Self {
        Self {
            id: format!("layer-{}", name.to_lowercase().replace(' ', "-")),
            name,
            visible: true,
            locked: false,
            color: [0.36, 0.55, 0.98, 1.0], // BLUE
            line_type: LineType::Solid,
            line_weight: 1.0,
            auto_number: false,
            dimension_prefix: String::new(),
            dimension_suffix: String::new(),
        }
    }

    /// The standard "Dimensions" layer new annotations go onto.
    pub fn default_layer() -> Self {
        Self::new("Dimensions".to_string())
    }
}

/// Kind of an [`Annotation`], wrapping the dimension builders.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AnnotationKind {
    /// Linear dimension between two points.
    Linear(LinearDimension),
    /// Angular dimension between two rays.
    Angular(AngularDimension),
    /// Radial dimension of a circle/arc.
    Radial(RadialDimension),
}

impl AnnotationKind {
    /// The matching [`DimensionType`] discriminator.
    pub fn dimension_type(&self) -> DimensionType {
        match self {
            AnnotationKind::Linear(_) => DimensionType::Linear,
            AnnotationKind::Angular(_) => DimensionType::Angular,
            AnnotationKind::Radial(_) => DimensionType::Radial,
        }
    }

    /// Measured value: scene units for linear/radial dimensions, degrees for
    /// angular dimensions.
    pub fn measure(&self) -> Result<f64, String> {
        match self {
            AnnotationKind::Linear(dim) => Ok(linear_distance(dim.start, dim.end)),
            AnnotationKind::Angular(dim) => {
                angle_between_directions(sub3(dim.a, dim.vertex), sub3(dim.b, dim.vertex), None)
            }
            AnnotationKind::Radial(dim) => {
                let radius = linear_distance(dim.center, dim.rim);
                if radius < TOLERANCE {
                    Err("radial dimension rim must differ from center".to_string())
                } else {
                    Ok(radius)
                }
            }
        }
    }

    /// Build the render geometry with the given style.
    pub fn to_geometry(&self, style: &DimensionStyle) -> Result<DimensionGeometry, String> {
        match self {
            AnnotationKind::Linear(dim) => dim.to_geometry(style),
            AnnotationKind::Angular(dim) => dim.to_geometry(style),
            AnnotationKind::Radial(dim) => dim.to_geometry(style),
        }
    }
}

/// A persistent annotation: identity, label, dimension kind, style reference
/// and display state.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Annotation {
    pub id: EntityId,
    pub label: String,
    pub kind: AnnotationKind,
    /// Name of the [`DimensionStyle`] in the registry used by the document.
    pub style: String,
    /// Id of the [`AnnotationLayer`] this annotation belongs to.
    #[serde(default = "default_layer_id")]
    pub layer: String,
    pub visible: bool,
    pub locked: bool,
}

fn default_layer_id() -> String {
    AnnotationLayer::DEFAULT_ID.to_string()
}

impl Annotation {
    /// New visible, unlocked annotation on the default layer.
    pub fn new(label: String, kind: AnnotationKind, style: String) -> Self {
        Self {
            id: EntityId::new(),
            label,
            kind,
            style,
            layer: AnnotationLayer::DEFAULT_ID.to_string(),
            visible: true,
            locked: false,
        }
    }

    /// Measured value (see [`AnnotationKind::measure`]).
    pub fn measure(&self) -> Result<f64, String> {
        self.kind.measure()
    }

    /// Build the render geometry, resolving `style` against `styles` and
    /// falling back to the default style when the name is unknown.
    pub fn to_geometry(&self, styles: &DimensionStyleRegistry) -> Result<DimensionGeometry, String> {
        let style = styles.get_or_default(&self.style);
        self.kind.to_geometry(&style)
    }
}

/// Complete dimension annotation with all properties.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DimensionAnnotation {
    pub id: String,
    pub name: String,
    pub layer: String,
    pub visible: bool,
    pub locked: bool,
    pub color: Option<[f32; 4]>,
    pub geometry: DimensionGeometry,
    pub extension_line: Option<ExtensionLine>,
    pub arrow: Option<Arrow>,
    pub text: Option<String>,
    pub units: Option<String>,
    pub precision: u32,
    pub style_id: Option<String>,
    /// Group this annotation belongs to
    pub group_id: Option<String>,
    /// Associated dimension entity (if any)
    pub dimension_entity_id: Option<String>,
    /// Associated entity for ordinate dimensions
    pub ordinate_entity_id: Option<String>,
}

/// Annotation group for organizing related annotations.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AnnotationGroup {
    pub id: String,
    pub name: String,
    pub layer: String,
    pub visible: bool,
    pub locked: bool,
    pub color: Option<[f32; 4]>,
    /// Type of group
    pub group_type: GroupType,
    /// Entities in this group
    pub entities: Vec<String>,
}

/// Types of annotation groups.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GroupType {
    /// Reference geometry group
    Reference,
    /// Dimension group
    Dimension,
    /// All geometry group
    All,
    /// Selection set
    Selection,
    /// Custom group
    Custom,
}

/// Registry of annotation layers, annotations and dimension styles.
///
/// Mirrors the document model: layers and annotations are keyed by id,
/// styles by name. New registries contain the default style and the default
/// "Dimensions" layer.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AnnotationRegistry {
    pub styles: DimensionStyleRegistry,
    pub layers: BTreeMap<String, AnnotationLayer>,
    pub annotations: BTreeMap<EntityId, Annotation>,
}

impl Default for AnnotationRegistry {
    fn default() -> Self {
        let layer = AnnotationLayer::default_layer();
        Self {
            styles: DimensionStyleRegistry::default(),
            layers: BTreeMap::from([(layer.id.clone(), layer)]),
            annotations: BTreeMap::new(),
        }
    }
}

impl AnnotationRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Add (or replace) a layer, keyed by its id.
    pub fn add_layer(&mut self, layer: AnnotationLayer) {
        self.layers.insert(layer.id.clone(), layer);
    }

    /// Remove a layer by id.
    pub fn remove_layer(&mut self, id: &str) -> Option<AnnotationLayer> {
        self.layers.remove(id)
    }

    /// Toggle layer visibility; returns `false` when the layer is unknown.
    pub fn set_layer_visible(&mut self, id: &str, visible: bool) -> bool {
        self.layers
            .get_mut(id)
            .map(|layer| layer.visible = visible)
            .is_some()
    }

    /// Add an annotation. Errors when the referenced style or layer does not
    /// exist; returns the annotation id on success.
    pub fn add_annotation(&mut self, annotation: Annotation) -> Result<EntityId, String> {
        if !self.styles.contains(&annotation.style) {
            return Err(format!("unknown dimension style '{}'", annotation.style));
        }
        if !self.layers.contains_key(&annotation.layer) {
            return Err(format!("unknown annotation layer '{}'", annotation.layer));
        }
        let id = annotation.id;
        self.annotations.insert(id, annotation);
        Ok(id)
    }

    /// Remove an annotation by id.
    pub fn remove_annotation(&mut self, id: &EntityId) -> Option<Annotation> {
        self.annotations.remove(id)
    }

    /// Toggle annotation visibility (no-op for unknown ids).
    pub fn set_visible(&mut self, id: &EntityId, visible: bool) {
        if let Some(annotation) = self.annotations.get_mut(id) {
            annotation.visible = visible;
        }
    }

    /// Toggle annotation lock (no-op for unknown ids).
    pub fn set_locked(&mut self, id: &EntityId, locked: bool) {
        if let Some(annotation) = self.annotations.get_mut(id) {
            annotation.locked = locked;
        }
    }

    /// Look up an annotation by id.
    pub fn annotation(&self, id: &EntityId) -> Option<&Annotation> {
        self.annotations.get(id)
    }

    /// Measured value of an annotation, in scene units or degrees.
    pub fn measure(&self, id: &EntityId) -> Result<f64, String> {
        self.annotations
            .get(id)
            .ok_or_else(|| format!("unknown annotation {id}"))?
            .measure()
    }

    /// Build the render geometry of an annotation, resolving its style
    /// against the registry (falling back to the default style).
    pub fn build_geometry(&self, id: &EntityId) -> Result<DimensionGeometry, String> {
        let annotation = self
            .annotations
            .get(id)
            .ok_or_else(|| format!("unknown annotation {id}"))?;
        annotation.to_geometry(&self.styles)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOL: f64 = 1e-9;

    fn assert_close(actual: f64, expected: f64) {
        assert!(
            (actual - expected).abs() < TOL,
            "expected {expected}, got {actual}"
        );
    }

    fn assert_v3(actual: [f64; 3], expected: [f64; 3]) {
        for i in 0..3 {
            assert_close(actual[i], expected[i]);
        }
    }

    #[test]
    fn linear_distance_measures_345_triangle() {
        assert_close(linear_distance([0.0, 0.0, 0.0], [3.0, 4.0, 0.0]), 5.0);
        assert_close(linear_distance([1.0, 2.0, 3.0], [1.0, 2.0, 3.0]), 0.0);
        assert_close(linear_distance([0.0, 0.0, 0.0], [0.0, -3.0, 4.0]), 5.0);
    }

    #[test]
    fn aligned_distance_projects_onto_reference_direction() {
        let a = [0.0, 0.0, 0.0];
        let b = [3.0, 4.0, 0.0];
        assert_close(aligned_distance(a, b, [1.0, 0.0, 0.0]).unwrap(), 3.0);
        assert_close(aligned_distance(a, b, [0.0, 1.0, 0.0]).unwrap(), 4.0);
        // unnormalized reference is normalized first
        assert_close(aligned_distance(a, b, [2.0, 0.0, 0.0]).unwrap(), 3.0);
        assert!(aligned_distance(a, b, [0.0, 0.0, 0.0]).is_err());
    }

    #[test]
    fn rotated_distance_projects_onto_in_plane_direction() {
        let a = [0.0, 0.0, 0.0];
        let b = [1.0, 1.0, 0.0];
        assert_close(rotated_distance(a, b, [0.0, 0.0, 1.0], 0.0).unwrap(), 1.0);
        assert_close(rotated_distance(a, b, [0.0, 0.0, 1.0], 90.0).unwrap(), 1.0);
        assert_close(rotated_distance(a, b, [0.0, 0.0, 1.0], 45.0).unwrap(), 2.0f64.sqrt());
        // coincident points measure zero even with a degenerate-ish normal
        assert_close(rotated_distance(a, a, [0.0, 0.0, 1.0], 30.0).unwrap(), 0.0);
        assert!(rotated_distance(a, b, [0.0, 0.0, 0.0], 45.0).is_err());
    }

    #[test]
    fn angle_between_directions_unsigned_and_oriented() {
        // right angle, unsigned and oriented
        assert_close(angle_between_directions([1.0, 0.0, 0.0], [0.0, 1.0, 0.0], None).unwrap(), 90.0);
        assert_close(
            angle_between_directions([1.0, 0.0, 0.0], [0.0, 1.0, 0.0], Some([0.0, 0.0, 1.0]))
                .unwrap(),
            90.0,
        );
        // parallel and antiparallel snap exactly
        assert_close(angle_between_directions([1.0, 0.0, 0.0], [2.0, 0.0, 0.0], None).unwrap(), 0.0);
        assert_close(angle_between_directions([1.0, 0.0, 0.0], [-1.0, 0.0, 0.0], None).unwrap(), 180.0);
        // oriented sweep: clockwise about +Z from +X to -Y is 270 degrees
        assert_close(
            angle_between_directions([1.0, 0.0, 0.0], [0.0, -1.0, 0.0], Some([0.0, 0.0, 1.0]))
                .unwrap(),
            270.0,
        );
        assert!(
            angle_between_directions([0.0, 0.0, 0.0], [1.0, 0.0, 0.0], None).is_err(),
            "degenerate direction must error"
        );
    }

    #[test]
    fn circumradius_of_right_triangle_is_half_hypotenuse() {
        // 3-4-5 right triangle: R = hypotenuse / 2 = 2.5
        assert_close(circumradius([0.0, 0.0, 0.0], [3.0, 0.0, 0.0], [0.0, 4.0, 0.0]).unwrap(), 2.5);
        // equilateral triangle of side 1: R = 1 / sqrt(3)
        assert_close(
            circumradius([0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.5, 3.0f64.sqrt() / 2.0, 0.0]).unwrap(),
            1.0 / 3.0f64.sqrt(),
        );
        // collinear points have no circumcircle
        assert!(circumradius([0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [2.0, 0.0, 0.0]).is_err());
        assert!(circumradius([0.0, 0.0, 0.0], [0.0, 0.0, 0.0], [0.0, 0.0, 0.0]).is_err());
    }

    #[test]
    fn ordinate_value_is_signed_projection() {
        let origin = [1.0, 2.0, 3.0];
        let point = [4.0, 2.0, 3.0];
        assert_close(ordinate_value(point, origin, [1.0, 0.0, 0.0]).unwrap(), 3.0);
        assert_close(ordinate_value(point, origin, [-1.0, 0.0, 0.0]).unwrap(), -3.0);
        // unnormalized direction is normalized first
        assert_close(ordinate_value(point, origin, [5.0, 0.0, 0.0]).unwrap(), 3.0);
        assert!(ordinate_value(point, origin, [0.0, 0.0, 0.0]).is_err());
    }

    #[test]
    fn default_style_uses_millimeters_and_above_line_text() {
        let style = DimensionStyle::default();
        assert_eq!(style.unit, LengthUnit::Millimeter);
        assert_eq!(style.precision, 2);
        assert_eq!(style.text_placement, TextPlacement::AboveLine);
        assert_eq!(style.name, "default");
        assert_close(DimensionStyle::default().arrow_size, 3.0);
    }

    #[test]
    fn format_value_converts_units_and_precision() {
        let mut style = DimensionStyle::default();
        assert_eq!(style.format_value(20.0), "20.00 mm");
        style.unit = LengthUnit::Meter;
        assert_eq!(style.format_value(2000.0), "2.00 m");
        style.unit = LengthUnit::Inch;
        assert_eq!(style.format_value(25.4), "1.00 in");
        assert_eq!(style.format_angle(90.0), "90.00°");
        style.unit = LengthUnit::Millimeter;
        style.prefix = "≈ ".to_string();
        style.suffix = " max".to_string();
        style.show_units = false;
        assert_eq!(style.format_value(12.3456), "≈ 12.35 max");
        assert_eq!(style.format_angle(90.0), "≈ 90.00 max");
    }

    #[test]
    fn linear_dimension_build_places_geometry_correctly() {
        let style = DimensionStyle::default();
        let geom =
            LinearDimension::build([0.0, 0.0, 0.0], [20.0, 0.0, 0.0], [0.0, 1.0, 0.0], 10.0, &style)
                .unwrap();

        assert_eq!(geom.dimension_type, DimensionType::Linear);
        assert_close(geom.value, 20.0);
        assert_eq!(geom.text.as_deref(), Some("20.00 mm"));

        // dimension line endpoints, offset along +Y by 10
        assert_eq!(geom.dimension_line.len(), 2);
        assert_v3(geom.dimension_line[0], [0.0, 10.0, 0.0]);
        assert_v3(geom.dimension_line[1], [20.0, 10.0, 0.0]);

        // arrowheads point inward: tips on the line ends, bases one arrow in
        assert_eq!(geom.arrow_tips.len(), 2);
        assert_v3(geom.arrow_tips[0], [0.0, 10.0, 0.0]);
        assert_v3(geom.arrow_tips[1], [20.0, 10.0, 0.0]);
        assert_v3(geom.arrow_bases[0], [3.0, 10.0, 0.0]);
        assert_v3(geom.arrow_bases[1], [17.0, 10.0, 0.0]);

        // extension lines: gap of 1 from the measured points, overshoot of 2
        assert_eq!(geom.extension_lines.len(), 2);
        assert_v3(geom.extension_lines[0].0, [0.0, 1.0, 0.0]);
        assert_v3(geom.extension_lines[0].1, [0.0, 12.0, 0.0]);
        assert_v3(geom.extension_lines[1].0, [20.0, 1.0, 0.0]);
        assert_v3(geom.extension_lines[1].1, [20.0, 12.0, 0.0]);

        // text midpoint follows the style placement
        assert_v3(geom.text_midpoint, [10.0, 10.0 + 3.5 * 0.75, 0.0]);

        let mut inline_style = style.clone();
        inline_style.text_placement = TextPlacement::Inline;
        let inline = LinearDimension::build(
            [0.0, 0.0, 0.0],
            [20.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            10.0,
            &inline_style,
        )
        .unwrap();
        assert_v3(inline.text_midpoint, [10.0, 10.0, 0.0]);
    }

    #[test]
    fn linear_dimension_build_rejects_degenerate_inputs() {
        let style = DimensionStyle::default();
        // coincident points
        assert!(LinearDimension::build([1.0, 1.0, 1.0], [1.0, 1.0, 1.0], [0.0, 1.0, 0.0], 1.0, &style).is_err());
        // degenerate offset direction
        assert!(LinearDimension::build([0.0, 0.0, 0.0], [20.0, 0.0, 0.0], [0.0, 0.0, 0.0], 1.0, &style).is_err());
        // offset direction parallel to the measured line
        assert!(LinearDimension::build([0.0, 0.0, 0.0], [20.0, 0.0, 0.0], [1.0, 0.0, 0.0], 1.0, &style).is_err());
        // short lines flip the arrows outward instead of erroring
        let cramped =
            LinearDimension::build([0.0, 0.0, 0.0], [4.0, 0.0, 0.0], [0.0, 1.0, 0.0], 10.0, &style)
                .unwrap();
        assert_v3(cramped.arrow_bases[0], [-3.0, 10.0, 0.0]);
        assert_v3(cramped.arrow_bases[1], [7.0, 10.0, 0.0]);
        // arrow_size <= 0 emits no arrowheads
        let mut bare = style.clone();
        bare.arrow_size = 0.0;
        let bare_geom =
            LinearDimension::build([0.0, 0.0, 0.0], [20.0, 0.0, 0.0], [0.0, 1.0, 0.0], 10.0, &bare)
                .unwrap();
        assert!(bare_geom.arrow_tips.is_empty() && bare_geom.arrow_bases.is_empty());
    }

    #[test]
    fn angular_dimension_build_sweeps_arc() {
        let style = DimensionStyle::default();
        let geom = AngularDimension::build(
            [0.0, 0.0, 0.0],
            [2.0, 0.0, 0.0],
            [0.0, 2.0, 0.0],
            1.0,
            &style,
        )
        .unwrap();

        assert_eq!(geom.dimension_type, DimensionType::Angular);
        assert_close(geom.value, 90.0);
        assert_eq!(geom.text.as_deref(), Some("90.00°"));

        // arc starts on the +X ray and ends on the +Y ray
        assert_v3(geom.dimension_line[0], [1.0, 0.0, 0.0]);
        let last = geom.dimension_line[geom.dimension_line.len() - 1];
        assert_v3(last, [0.0, 1.0, 0.0]);

        // text sits on the 45 degree mid-ray beyond the arc
        let r_text = 1.0 + 3.5 * 0.75;
        let expected = r_text * std::f64::consts::FRAC_1_SQRT_2;
        assert_v3(geom.text_midpoint, [expected, expected, 0.0]);

        // arrowheads: tips on the arc ends, both at arc radius
        assert_eq!(geom.arrow_tips.len(), 2);
        assert_v3(geom.arrow_tips[0], [1.0, 0.0, 0.0]);
        assert_v3(geom.arrow_tips[1], [0.0, 1.0, 0.0]);
        assert_close(len3(geom.arrow_bases[0]), 1.0);
        assert_close(len3(geom.arrow_bases[1]), 1.0);
        // cramped arc: base angle clamped to 0.49 * sweep from each end
        let delta = 0.49 * std::f64::consts::FRAC_PI_2;
        let chord = 2.0 * (delta / 2.0).sin();
        assert_close(linear_distance(geom.arrow_tips[0], geom.arrow_bases[0]), chord);
    }

    #[test]
    fn angular_dimension_arrow_length_follows_style() {
        let style = DimensionStyle::default();
        let geom = AngularDimension::build(
            [0.0, 0.0, 0.0],
            [10.0, 0.0, 0.0],
            [0.0, 10.0, 0.0],
            10.0,
            &style,
        )
        .unwrap();
        // radius 10 >> arrow size 3: base sits one arrow length along the arc
        let chord = 2.0 * 10.0 * (3.0f64 / 10.0 / 2.0).sin();
        assert_close(linear_distance(geom.arrow_tips[0], geom.arrow_bases[0]), chord);
        assert_close(linear_distance(geom.arrow_tips[1], geom.arrow_bases[1]), chord);
    }

    #[test]
    fn angular_dimension_build_rejects_collinear_rays() {
        let style = DimensionStyle::default();
        // degenerate ray
        assert!(AngularDimension::build([0.0, 0.0, 0.0], [0.0, 0.0, 0.0], [1.0, 0.0, 0.0], 1.0, &style).is_err());
        // collinear rays
        assert!(AngularDimension::build([0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [2.0, 0.0, 0.0], 1.0, &style).is_err());
        // non-positive radius
        assert!(AngularDimension::build([0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], 0.0, &style).is_err());
    }

    #[test]
    fn radial_dimension_build_measures_radius() {
        let style = DimensionStyle::default();
        let geom = RadialDimension::build([0.0, 0.0, 0.0], [5.0, 0.0, 0.0], &style).unwrap();

        assert_eq!(geom.dimension_type, DimensionType::Radial);
        assert_close(geom.value, 5.0);
        assert_eq!(geom.radial_center, Some([0.0, 0.0, 0.0]));
        assert_eq!(geom.radial_value, Some(5.0));
        assert_eq!(geom.text.as_deref(), Some("R5.00 mm"));

        // dimension line runs from center to rim plus overshoot
        assert_eq!(geom.dimension_line.len(), 2);
        assert_v3(geom.dimension_line[0], [0.0, 0.0, 0.0]);
        assert_v3(geom.dimension_line[1], [7.0, 0.0, 0.0]);
        // arrowhead on the rim pointing outward (base inward)
        assert_v3(geom.arrow_tips[0], [5.0, 0.0, 0.0]);
        assert_v3(geom.arrow_bases[0], [2.0, 0.0, 0.0]);
        assert_v3(geom.text_midpoint, [3.5, 0.0, 0.0]);
        assert!(geom.extension_lines.is_empty());

        assert!(RadialDimension::build([1.0, 1.0, 1.0], [1.0, 1.0, 1.0], &style).is_err());
    }

    #[test]
    fn style_registry_round_trip() {
        let mut registry = DimensionStyleRegistry::new();
        assert!(registry.contains("default"));
        assert_eq!(registry.len(), 1);

        let mut structural = DimensionStyle::new("Structural".to_string());
        structural.unit = LengthUnit::Inch;
        structural.precision = 3;
        structural.arrow_size = 4.0;
        registry.insert(structural.clone());
        assert_eq!(registry.len(), 2);

        let fetched = registry.get("Structural").unwrap();
        assert_eq!(*fetched, structural);
        assert_eq!(fetched.unit, LengthUnit::Inch);
        assert_close(fetched.arrow_size, 4.0);

        // unknown styles fall back to the default style
        assert!(registry.get("missing").is_none());
        assert_eq!(registry.get_or_default("missing"), DimensionStyle::default());

        let removed = registry.remove("Structural");
        assert_eq!(removed, Some(structural.clone()));
        assert!(registry.get("Structural").is_none());

        // serialization round-trip preserves the map
        registry.insert(structural.clone());
        let json = serde_json::to_string(&registry).unwrap();
        let parsed: DimensionStyleRegistry = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, registry);
    }

    #[test]
    fn annotation_registry_add_remove_and_visibility() {
        let mut registry = AnnotationRegistry::new();
        assert!(registry.layers.contains_key(AnnotationLayer::DEFAULT_ID));

        let kind = AnnotationKind::Linear(LinearDimension {
            start: [0.0, 0.0, 0.0],
            end: [20.0, 0.0, 0.0],
            offset_dir: [0.0, 1.0, 0.0],
            offset: 10.0,
        });
        let annotation = Annotation::new("width".to_string(), kind.clone(), "default".to_string());
        let id = registry.add_annotation(annotation).unwrap();

        assert_eq!(registry.measure(&id).unwrap(), 20.0);
        let geom = registry.build_geometry(&id).unwrap();
        assert_close(geom.value, 20.0);
        assert_eq!(geom.dimension_type, DimensionType::Linear);

        // unknown style or layer is rejected
        let bad_style = Annotation::new("x".to_string(), kind.clone(), "missing".to_string());
        assert!(registry.add_annotation(bad_style).is_err());
        let mut bad_layer = Annotation::new("y".to_string(), kind, "default".to_string());
        bad_layer.layer = "layer-missing".to_string();
        assert!(registry.add_annotation(bad_layer).is_err());

        // visibility toggles for annotations and layers
        registry.set_visible(&id, false);
        assert!(!registry.annotation(&id).unwrap().visible);
        registry.set_visible(&id, true);
        assert!(registry.annotation(&id).unwrap().visible);
        registry.set_locked(&id, true);
        assert!(registry.annotation(&id).unwrap().locked);
        assert!(registry.set_layer_visible(AnnotationLayer::DEFAULT_ID, false));
        assert!(!registry.layers.get(AnnotationLayer::DEFAULT_ID).unwrap().visible);
        assert!(!registry.set_layer_visible("layer-missing", true));

        // removal
        let removed = registry.remove_annotation(&id).unwrap();
        assert_eq!(removed.label, "width");
        assert!(registry.build_geometry(&id).is_err());
        assert!(registry.measure(&id).is_err());
    }

    #[test]
    fn annotation_serde_round_trip() {
        let annotation = Annotation::new(
            "width".to_string(),
            AnnotationKind::Angular(AngularDimension {
                vertex: [0.0, 0.0, 0.0],
                a: [1.0, 0.0, 0.0],
                b: [0.0, 1.0, 0.0],
                radius: 5.0,
            }),
            "default".to_string(),
        );
        let json = serde_json::to_string(&annotation).unwrap();
        assert!(json.contains("\"type\":\"angular\""));
        let parsed: Annotation = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, annotation);
    }

    #[test]
    fn legacy_dimension_geometry_json_still_deserializes() {
        // documents saved before the render-primitive fields existed must
        // still load; the new fields default via serde
        let json = r#"{
            "dimension_type": "linear",
            "start": [0, 0, 0],
            "end": [10, 0, 0],
            "ref_point": null,
            "angular_ref_points": null,
            "radial_center": null,
            "radial_value": null,
            "ordinate_ref": null,
            "ordinate_origin": null,
            "style_id": null,
            "custom_data": null,
            "leader_start": null,
            "leader_end": null
        }"#;
        let geom: DimensionGeometry = serde_json::from_str(json).unwrap();
        assert_eq!(geom.dimension_type, DimensionType::Linear);
        assert_eq!(geom.value, 0.0);
        assert!(geom.arrow_tips.is_empty());
        assert!(geom.extension_lines.is_empty());
        assert!(geom.text.is_none());
    }
}
