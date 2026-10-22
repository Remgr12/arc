use super::*;
use derive_more::{From, TryInto};
use serde::{Deserialize, Serialize};
#[doc(hidden)]
pub use truck_geometry::prelude::{algo, inv_or_zero};
pub use truck_geometry::{decorators::*, nurbs::*, specifieds::*};

/// 3-dimensional curve
#[derive(
    Clone,
    Debug,
    Serialize,
    Deserialize,
    From,
    TryInto,
    ParametricCurve,
    BoundedCurve,
    ParameterDivision1D,
    Cut,
    Invertible,
    SearchNearestParameterD1,
    SearchParameterD1,
)]
pub enum Curve {
    /// line
    Line(Line<Point3>),
    /// 3-dimensional B-spline curve
    BSplineCurve(BSplineCurve<Point3>),
    /// 3-dimensional NURBS curve
    NurbsCurve(NurbsCurve<Vector4>),
    /// intersection curve
    IntersectionCurve(IntersectionCurve<Box<Curve>, Box<Surface>, Box<Surface>>),
    /// parametric curve on a surface (fillet boundaries)
    Parametric(Box<PCurve<BSplineCurve<Point2>, Surface>>),
}

macro_rules! derive_curve_method {
    ($curve: expr, $method: expr, $($ver: ident),*) => {
        match $curve {
            Curve::Line(got) => $method(got, $($ver), *),
            Curve::BSplineCurve(got) => $method(got, $($ver), *),
            Curve::NurbsCurve(got) => $method(got, $($ver), *),
            Curve::IntersectionCurve(got) => $method(got, $($ver), *),
            Curve::Parametric(got) => $method(got, $($ver), *),
        }
    };
}

macro_rules! derive_curve_self_method {
    ($curve: expr, $method: expr, $($ver: ident),*) => {
        match $curve {
            Curve::Line(got) => Curve::Line($method(got, $($ver), *)),
            Curve::BSplineCurve(got) => Curve::BSplineCurve($method(got, $($ver), *)),
            Curve::NurbsCurve(got) => Curve::NurbsCurve($method(got, $($ver), *)),
            Curve::IntersectionCurve(got) => Curve::IntersectionCurve($method(got, $($ver), *)),
            Curve::Parametric(got) => Curve::Parametric($method(got, $($ver), *)),
        }
    };
}

impl Transformed<Matrix4> for Curve {
    fn transform_by(&mut self, trans: Matrix4) {
        derive_curve_method!(self, Transformed::transform_by, trans);
    }
    fn transformed(&self, trans: Matrix4) -> Self {
        derive_curve_self_method!(self, Transformed::transformed, trans)
    }
}

impl From<IntersectionCurve<BSplineCurve<Point3>, Surface, Surface>> for Curve {
    fn from(c: IntersectionCurve<BSplineCurve<Point3>, Surface, Surface>) -> Curve {
        let (surface0, surface1, leader) = c.destruct();
        Curve::IntersectionCurve(IntersectionCurve::new(
            Box::new(surface0),
            Box::new(surface1),
            Box::new(leader.into()),
        ))
    }
}

impl ToSameGeometry<Curve> for Line<Point3> {
    #[inline]
    fn to_same_geometry(&self) -> Curve { Curve::from(*self) }
}

impl ToSameGeometry<Curve> for Processor<TrimmedCurve<UnitCircle<Point3>>, Matrix4> {
    #[inline]
    fn to_same_geometry(&self) -> Curve { Curve::NurbsCurve(self.to_same_geometry()) }
}

impl ToSameGeometry<Curve> for BSplineCurve<Point3> {
    #[inline]
    fn to_same_geometry(&self) -> Curve { Curve::from(self.clone()) }
}

impl ToSameGeometry<Curve> for NurbsCurve<Vector4> {
    #[inline]
    fn to_same_geometry(&self) -> Curve { Curve::NurbsCurve(self.clone()) }
}

impl ToSameGeometry<Curve> for PCurve<BSplineCurve<Point2>, Surface> {
    #[inline]
    fn to_same_geometry(&self) -> Curve { Curve::Parametric(Box::new(self.clone())) }
}

impl ToSameGeometry<Surface> for ApproxFilletSurface<Surface, Surface> {
    fn to_same_geometry(&self) -> Surface { Surface::Fillet(Box::new(self.clone().into())) }
}

impl ToSameGeometry<Curve> for IntersectionCurve<Curve, Surface, Surface> {
    fn to_same_geometry(&self) -> Curve {
        let (surface0, surface1, leader) = self.clone().destruct();
        Curve::IntersectionCurve(IntersectionCurve::new(
            Box::new(surface0),
            Box::new(surface1),
            Box::new(leader),
        ))
    }
}

impl ToSameGeometry<Curve> for IntersectionCurve<Box<Curve>, Box<Surface>, Box<Surface>> {
    fn to_same_geometry(&self) -> Curve { Curve::IntersectionCurve(self.clone()) }
}

impl ToSameGeometry<Surface> for ApproxFilletSurface<Box<Surface>, Box<Surface>> {
    fn to_same_geometry(&self) -> Surface { Surface::Fillet(Box::new(self.clone())) }
}

/// Checks whether a curve lies on a surface by sampling the curve and
/// searching each sample on the surface (used for curves whose parametrized
/// representation does not directly reference the checked surface).
fn sampled_curve_on_surface<S>(surface: &S, curve: &Curve) -> bool
where
    S: SearchParameter<D2, Point = Point3>,
{
    let (t0, t1) = curve.range_tuple();
    (0..=24).all(|i| {
        let t = t0 + (t1 - t0) * (i as f64) / 24.0;
        surface.search_parameter(curve.subs(t), None, 1).is_some()
    })
}

impl Curve {
    /// Into non-ratinalized 4-dimensional B-spline curve
    pub fn lift_up(&self) -> BSplineCurve<Vector4> {
        match self {
            Curve::Line(curve) => Curve::BSplineCurve((*curve).into()).lift_up(),
            Curve::BSplineCurve(curve) => BSplineCurve::new(
                curve.knot_vec().clone(),
                curve
                    .control_points()
                    .iter()
                    .map(|pt| pt.to_vec().extend(1.0))
                    .collect(),
            ),
            Curve::NurbsCurve(curve) => curve.non_rationalized().clone(),
            Curve::IntersectionCurve(_) | Curve::Parametric(_) => {
                unimplemented!("fillet curves cannot connect by homotopy")
            }
        }
    }
}

/// 3-dimensional surfaces
#[derive(
    Clone,
    Debug,
    Serialize,
    Deserialize,
    From,
    TryInto,
    ParametricSurface,
    ParameterDivision2D,
    Invertible,
    SearchParameterD2,
)]
pub enum Surface {
    /// Plane
    Plane(Plane),
    /// 3-dimensional B-spline surface
    BSplineSurface(BSplineSurface<Point3>),
    /// 3-dimensional NURBS Surface
    NurbsSurface(NurbsSurface<Vector4>),
    /// revoluted curve
    RevolutedCurve(Processor<RevolutedCurve<Curve>, Matrix4>),
    /// rolling-ball fillet surface (fillet faces)
    Fillet(Box<ApproxFilletSurface<Box<Surface>, Box<Surface>>>),
}

macro_rules! derive_surface_method {
    ($surface: expr, $method: expr, $($ver: ident),*) => {
        match $surface {
            Self::Plane(got) => $method(got, $($ver), *),
            Self::BSplineSurface(got) => $method(got, $($ver), *),
            Self::NurbsSurface(got) => $method(got, $($ver), *),
            Self::RevolutedCurve(got) => $method(got, $($ver), *),
            Self::Fillet(got) => $method(got, $($ver), *),
        }
    };
}

macro_rules! derive_surface_self_method {
    ($surface: expr, $method: expr, $($ver: ident),*) => {
        match $surface {
            Self::Plane(got) => Self::Plane($method(got, $($ver), *)),
            Self::BSplineSurface(got) => Self::BSplineSurface($method(got, $($ver), *)),
            Self::NurbsSurface(got) => Self::NurbsSurface($method(got, $($ver), *)),
            Self::RevolutedCurve(got) => Self::RevolutedCurve($method(got, $($ver), *)),
            Self::Fillet(got) => Self::Fillet(Box::new($method(got, $($ver), *))),
        }
    };
}

impl ParametricSurface3D for Surface {
    #[inline(always)]
    fn normal(&self, u: f64, v: f64) -> Vector3 {
        derive_surface_method!(self, ParametricSurface3D::normal, u, v)
    }
}

impl Transformed<Matrix4> for Surface {
    fn transform_by(&mut self, trans: Matrix4) {
        derive_surface_method!(self, Transformed::transform_by, trans);
    }
    fn transformed(&self, trans: Matrix4) -> Self {
        derive_surface_self_method!(self, Transformed::transformed, trans)
    }
}

impl IncludeCurve<Curve> for Surface {
    #[inline(always)]
    fn include(&self, curve: &Curve) -> bool {
        match self {
            Surface::Fillet(fillet) => sampled_curve_on_surface(fillet, curve),
            Surface::BSplineSurface(surface) => match curve {
                &Curve::Line(curve) => surface.include(&BSplineCurve::from(curve)),
                Curve::BSplineCurve(curve) => surface.include(curve),
                Curve::NurbsCurve(curve) => surface.include(curve),
                Curve::IntersectionCurve(_) | Curve::Parametric(_) => {
                    sampled_curve_on_surface(self, curve)
                }
            },
            Surface::NurbsSurface(surface) => match curve {
                &Curve::Line(curve) => surface.include(&BSplineCurve::from(curve)),
                Curve::BSplineCurve(curve) => surface.include(curve),
                Curve::NurbsCurve(curve) => surface.include(curve),
                Curve::IntersectionCurve(_) | Curve::Parametric(_) => {
                    sampled_curve_on_surface(self, curve)
                }
            },
            Surface::Plane(surface) => match curve {
                &Curve::Line(curve) => surface.include(&BSplineCurve::from(curve)),
                Curve::BSplineCurve(curve) => surface.include(curve),
                Curve::NurbsCurve(curve) => surface.include(curve),
                Curve::IntersectionCurve(_) | Curve::Parametric(_) => {
                    sampled_curve_on_surface(self, curve)
                }
            },
            Surface::RevolutedCurve(surface) => match surface.entity_curve() {
                &Curve::Line(entity_curve) => {
                    let rev = RevolutedCurve::by_revolution(
                        BSplineCurve::from(entity_curve),
                        surface.origin(),
                        surface.axis(),
                    );
                    let surface = Processor::with_transform(rev, *surface.transform());
                    match curve {
                        &Curve::Line(curve) => surface.include(&BSplineCurve::from(curve)),
                        Curve::BSplineCurve(curve) => surface.include(curve),
                        Curve::NurbsCurve(curve) => surface.include(curve),
                        Curve::IntersectionCurve(_) | Curve::Parametric(_) => {
                            sampled_curve_on_surface(self, curve)
                        }
                    }
                }
                Curve::BSplineCurve(entity_curve) => {
                    let rev = RevolutedCurve::by_revolution(
                        entity_curve,
                        surface.origin(),
                        surface.axis(),
                    );
                    let surface = Processor::with_transform(rev, *surface.transform());
                    match curve {
                        &Curve::Line(curve) => surface.include(&BSplineCurve::from(curve)),
                        Curve::BSplineCurve(curve) => surface.include(curve),
                        Curve::NurbsCurve(curve) => surface.include(curve),
                        Curve::IntersectionCurve(_) | Curve::Parametric(_) => {
                            sampled_curve_on_surface(self, curve)
                        }
                    }
                }
                Curve::NurbsCurve(entity_curve) => {
                    let rev = RevolutedCurve::by_revolution(
                        entity_curve,
                        surface.origin(),
                        surface.axis(),
                    );
                    let surface = Processor::with_transform(rev, *surface.transform());
                    match curve {
                        &Curve::Line(curve) => surface.include(&BSplineCurve::from(curve)),
                        Curve::BSplineCurve(curve) => surface.include(curve),
                        Curve::NurbsCurve(curve) => surface.include(curve),
                        Curve::IntersectionCurve(_) | Curve::Parametric(_) => {
                            sampled_curve_on_surface(self, curve)
                        }
                    }
                }
                Curve::IntersectionCurve(_) | Curve::Parametric(_) => {
                    sampled_curve_on_surface(self, curve)
                }
            },
        }
    }
}

impl IncludeCurve<Curve> for Plane {
    fn include(&self, curve: &Curve) -> bool {
        if matches!(curve, Curve::IntersectionCurve(_) | Curve::Parametric(_)) {
            return sampled_curve_on_surface(self, curve);
        }
        curve.lift_up().control_points().iter().all(|v| {
            let p = v.to_point();
            self.search_parameter(p, None, 1).is_some()
        })
    }
}

impl ToSameGeometry<Surface> for Plane {
    fn to_same_geometry(&self) -> Surface { (*self).into() }
}

impl ToSameGeometry<Surface> for RevolutedCurve<Curve> {
    fn to_same_geometry(&self) -> Surface { Surface::RevolutedCurve(Processor::new(self.clone())) }
}

impl SearchNearestParameter<D2> for Surface {
    type Point = Point3;
    fn search_nearest_parameter<H: Into<SPHint2D>>(
        &self,
        point: Point3,
        hint: H,
        trials: usize,
    ) -> Option<(f64, f64)> {
        match self {
            Surface::Plane(plane) => plane.search_nearest_parameter(point, hint, trials),
            Surface::BSplineSurface(bspsurface) => {
                bspsurface.search_nearest_parameter(point, hint, trials)
            }
            Surface::NurbsSurface(surface) => surface.search_nearest_parameter(point, hint, trials),
            Surface::Fillet(fillet) => fillet.search_nearest_parameter(point, hint, trials),
            Surface::RevolutedCurve(rotted) => {
                let hint = match hint.into() {
                    SPHint2D::Parameter(hint0, hint1) => (hint0, hint1),
                    SPHint2D::Range(x, y) => algo::surface::presearch(rotted, point, (x, y), 100),
                    SPHint2D::None => {
                        algo::surface::presearch(rotted, point, rotted.range_tuple(), 100)
                    }
                };
                algo::surface::search_nearest_parameter(rotted, point, hint, trials)
            }
        }
    }
}

impl ToSameGeometry<Surface> for HomotopySurface<Curve, Curve> {
    fn to_same_geometry(&self) -> Surface {
        let curve0 = self.curve0().clone().lift_up();
        let curve1 = self.curve1().clone().lift_up();
        NurbsSurface::new(BSplineSurface::homotopy(curve0, curve1)).into()
    }
}

impl ToSameGeometry<Surface> for ExtrudedCurve<Curve, Vector3> {
    fn to_same_geometry(&self) -> Surface {
        let (curve0, vector) = (self.entity_curve(), self.extruding_vector());
        let trsl = Matrix4::from_translation(vector);
        let curve1 = self.entity_curve().transformed(trsl);
        match (curve0, curve1) {
            (Curve::Line(line), Curve::Line(_)) => {
                Plane::new(line.0, line.1, line.0 + vector).into()
            }
            (Curve::BSplineCurve(curve0), Curve::BSplineCurve(curve1)) => {
                BSplineSurface::homotopy(curve0.clone(), curve1.clone()).into()
            }
            (Curve::NurbsCurve(curve0), Curve::NurbsCurve(curve1)) => {
                NurbsSurface::new(BSplineSurface::homotopy(
                    curve0.non_rationalized().clone(),
                    curve1.non_rationalized().clone(),
                ))
                .into()
            }
            (Curve::IntersectionCurve(_), Curve::IntersectionCurve(_)) => unimplemented!(),
            _ => unreachable!(),
        }
    }
}
