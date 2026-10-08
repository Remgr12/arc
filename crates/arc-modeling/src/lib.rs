pub mod sketch;
pub mod feature;
pub mod part;
pub mod assembly;
pub mod parameters;
pub mod pattern;
pub mod mirror;
pub mod history;

use arc_core::*;
use arc_geometry::*;
use std::sync::Arc;
use parking_lot::RwLock;
use uuid::Uuid;
use serde::{Serialize, Deserialize};

pub use sketch::*;
pub use feature::*;
pub use part::*;
pub use assembly::*;
pub use parameters::*;
pub use pattern::*;
pub use mirror::*;
pub use history::*;

pub use crate::sketch::{Sketch, SketchConstraint, SketchRef, SketchBuilder};
pub use crate::feature::{Feature, FeatureType, FeatureParameter, FeatureRef};
pub use crate::part::{Part, Body, Appearance, PartRef};
pub use crate::assembly::{Assembly, AssemblyComponent, AssemblyConstraint, AssemblyRef};
pub use crate::parameters::{ParameterTable, Parameter, Unit};
pub use crate::pattern::{Pattern, PatternType};
pub use crate::mirror::Mirror;
pub use crate::history::ModelingHistory;

#[derive(Debug, Clone)]
pub struct Model {
    pub id: EntityId,
    pub name: String,
    pub parts: Vec<PartRef>,
    pub assemblies: Vec<AssemblyRef>,
    pub parameters: ParameterTable,
    pub sketches: Vec<SketchRef>,
    pub features: Vec<FeatureRef>,
    pub history: ModelingHistory,
    pub units: Units,
    pub origin: CoordinateSystem,
    pub metadata: Metadata,
}

impl Model {
    pub fn new(name: String) -> Self {
        Self {
            id: EntityId::new(),
            name,
            parts: Vec::new(),
            assemblies: Vec::new(),
            parameters: ParameterTable::new(),
            sketches: Vec::new(),
            features: Vec::new(),
            history: ModelingHistory::new(),
            units: Units::default(),
            origin: CoordinateSystem::default(),
            metadata: Metadata::default(),
        }
    }

    pub fn add_part(&mut self, part: PartRef) {
        self.parts.push(part);
    }

    pub fn add_assembly(&mut self, assembly: AssemblyRef) {
        self.assemblies.push(assembly);
    }

    pub fn add_sketch(&mut self, sketch: SketchRef) {
        self.sketches.push(sketch);
    }

    pub fn add_feature(&mut self, feature: FeatureRef) {
        self.features.push(feature);
    }
}

pub type ModelRef = Arc<RwLock<Model>>;

#[derive(Debug, Clone, Default)]
pub struct CoordinateSystem {
    pub origin: Point3,
    pub x_axis: Vector3,
    pub y_axis: Vector3,
    pub z_axis: Vector3,
}

impl CoordinateSystem {
    pub fn default() -> Self {
        Self {
            origin: Point3::origin(),
            x_axis: Vector3::new(1.0, 0.0, 0.0),
            y_axis: Vector3::new(0.0, 1.0, 0.0),
            z_axis: Vector3::new(0.0, 0.0, 1.0),
        }
    }

    pub fn from_origin_x_y(origin: Point3, x_axis: Vector3, y_axis: Vector3) -> Self {
        let x = x_axis.normalize();
        let z = x.cross(&y_axis).normalize();
        let y = z.cross(&x).normalize();
        Self { origin, x_axis: x, y_axis: y, z_axis: z }
    }

    pub fn to_world(&self, local: Point3) -> Point3 {
        self.origin + self.x_axis * local.x + self.y_axis * local.y + self.z_axis * local.z
    }

    pub fn to_local(&self, world: Point3) -> Point3 {
        let diff = world - self.origin;
        Point3::new(
            diff.dot(&self.x_axis),
            diff.dot(&self.y_axis),
            diff.dot(&self.z_axis),
        )
    }

    pub fn matrix(&self) -> nalgebra::Matrix4<f64> {
        nalgebra::Matrix4::new(
            self.x_axis.x, self.y_axis.x, self.z_axis.x, self.origin.x,
            self.x_axis.y, self.y_axis.y, self.z_axis.y, self.origin.y,
            self.x_axis.z, self.y_axis.z, self.z_axis.z, self.origin.z,
            0.0, 0.0, 0.0, 1.0,
        )
    }
}

pub struct ModelingKernel {
    models: dashmap::DashMap<EntityId, ModelRef>,
    active_model: Option<EntityId>,
    parameter_solver: ParameterSolver,
}

impl ModelingKernel {
    pub fn new() -> Self {
        Self {
            models: dashmap::DashMap::new(),
            active_model: None,
            parameter_solver: ParameterSolver::new(),
        }
    }

    pub fn create_model(&self, name: String) -> ModelRef {
        let model = Arc::new(RwLock::new(Model::new(name)));
        let id = model.read().id;
        self.models.insert(id, model.clone());
        model
    }

    pub fn get_model(&self, id: EntityId) -> Option<ModelRef> {
        self.models.get(&id).map(|m| m.clone())
    }

    pub fn active_model(&self) -> Option<ModelRef> {
        self.active_model.and_then(|id| self.get_model(id))
    }

    pub fn set_active_model(&mut self, id: EntityId) {
        if self.models.contains_key(&id) {
            self.active_model = Some(id);
        }
    }

    pub fn remove_model(&mut self, id: EntityId) -> Option<ModelRef> {
        if self.active_model == Some(id) {
            self.active_model = None;
        }
        self.models.remove(&id).map(|(_, v)| v)
    }

    pub fn solve_parameters(&mut self, model: &ModelRef) -> Result<(), String> {
        self.parameter_solver.solve(model)
    }

    pub fn regenerate(&self, model: &ModelRef) -> Result<(), String> {
        let mut model_guard = model.write();
        model_guard.history.clear();
        
        let sketch_refs: Vec<_> = model_guard.sketches.clone();
        for sketch_ref in sketch_refs {
            let mut sketch = sketch_ref.write();
            sketch.rebuild()?;
            model_guard.history.add_sketch(sketch.id);
        }
        
        let feature_refs: Vec<_> = model_guard.features.clone();
        for feature_ref in feature_refs {
            let mut feature = feature_ref.write();
            feature.rebuild(&model_guard)?;
            model_guard.history.add_feature(feature.id);
        }
        
        let part_refs: Vec<_> = model_guard.parts.clone();
        for part_ref in part_refs {
            let mut part = part_ref.write();
            part.update()?;
        }
        
        Ok(())
    }
}

impl Default for ModelingKernel {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Default)]
pub struct ParameterSolver {
    constraints: Vec<ParameterConstraint>,
}

impl ParameterSolver {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn solve(&mut self, model: &ModelRef) -> Result<(), String> {
        let model_guard = model.read();
        self.constraints.clear();
        
        for (name, param) in &model_guard.parameters.parameters {
            if let Some(expr) = &param.expression {
                self.constraints.push(ParameterConstraint {
                    parameter: name.clone(),
                    expression: expr.clone(),
                    value: param.value,
                });
            }
        }
        
        let mut changed = true;
        let mut iterations = 0;
        while changed && iterations < 100 {
            changed = false;
            let constraints_copy = self.constraints.clone();
            for constraint in constraints_copy {
                if let Some(new_value) = self.evaluate_expression(&constraint.expression, model) {
                    if (new_value - constraint.value).abs() > 1e-9 {
                        // Find and update the original constraint
                        if let Some(orig) = self.constraints.iter_mut().find(|c| c.parameter == constraint.parameter) {
                            orig.value = new_value;
                            changed = true;
                        }
                    }
                }
            }
            iterations += 1;
        }
        
        if changed {
            return Err("Parameter solver did not converge".to_string());
        }
        
        for constraint in &self.constraints {
            if let Some(param) = model.write().parameters.parameters.get_mut(&constraint.parameter) {
                param.value = constraint.value;
            }
        }
        
        Ok(())
    }

    fn evaluate_expression(&self, expr: &str, model: &ModelRef) -> Option<f64> {
        let model_guard = model.read();
        let mut expr = expr.to_string();
        
        for (name, param) in &model_guard.parameters.parameters {
            expr = expr.replace(name, &param.value.to_string());
        }
        
        Self::eval_math(&expr)
    }

    fn eval_math(expr: &str) -> Option<f64> {
        let expr = expr.replace(' ', "");
        let tokens = Self::tokenize(&expr)?;
        Self::parse_expression(&tokens, 0).map(|(v, _)| v)
    }

    fn tokenize(expr: &str) -> Option<Vec<Token>> {
        let mut tokens = Vec::new();
        let mut chars = expr.chars().peekable();
        
        while let Some(ch) = chars.next() {
            match ch {
                '0'..='9' | '.' => {
                    let mut num = String::new();
                    num.push(ch);
                    while let Some(&next) = chars.peek() {
                        if next.is_ascii_digit() || next == '.' {
                            num.push(chars.next().unwrap());
                        } else {
                            break;
                        }
                    }
                    tokens.push(Token::Number(num.parse().ok()?));
                }
                '+' => tokens.push(Token::Plus),
                '-' => tokens.push(Token::Minus),
                '*' => tokens.push(Token::Multiply),
                '/' => tokens.push(Token::Divide),
                '(' => tokens.push(Token::LParen),
                ')' => tokens.push(Token::RParen),
                '^' => tokens.push(Token::Power),
                _ => return None,
            }
        }
        
        Some(tokens)
    }

    fn parse_expression(tokens: &[Token], pos: usize) -> Option<(f64, usize)> {
        let (mut value, mut pos) = Self::parse_term(tokens, pos)?;
        
        while pos < tokens.len() {
            match tokens[pos] {
                Token::Plus => {
                    let (rhs, new_pos) = Self::parse_term(tokens, pos + 1)?;
                    value += rhs;
                    pos = new_pos;
                }
                Token::Minus => {
                    let (rhs, new_pos) = Self::parse_term(tokens, pos + 1)?;
                    value -= rhs;
                    pos = new_pos;
                }
                _ => break,
            }
        }
        
        Some((value, pos))
    }

    fn parse_term(tokens: &[Token], pos: usize) -> Option<(f64, usize)> {
        let (mut value, mut pos) = Self::parse_factor(tokens, pos)?;
        
        while pos < tokens.len() {
            match tokens[pos] {
                Token::Multiply => {
                    let (rhs, new_pos) = Self::parse_factor(tokens, pos + 1)?;
                    value *= rhs;
                    pos = new_pos;
                }
                Token::Divide => {
                    let (rhs, new_pos) = Self::parse_factor(tokens, pos + 1)?;
                    if rhs == 0.0 { return None; }
                    value /= rhs;
                    pos = new_pos;
                }
                _ => break,
            }
        }
        
        Some((value, pos))
    }

    fn parse_factor(tokens: &[Token], pos: usize) -> Option<(f64, usize)> {
        match tokens.get(pos)? {
            Token::Number(n) => Some((*n, pos + 1)),
            Token::Minus => {
                let (val, pos) = Self::parse_factor(tokens, pos + 1)?;
                Some((-val, pos))
            }
            Token::LParen => {
                let (val, pos) = Self::parse_expression(tokens, pos + 1)?;
                if pos < tokens.len() && matches!(tokens[pos], Token::RParen) {
                    Some((val, pos + 1))
                } else {
                    None
                }
            }
            _ => None,
        }
    }
}

#[derive(Debug, Clone)]
enum Token {
    Number(f64),
    Plus,
    Minus,
    Multiply,
    Divide,
    Power,
    LParen,
    RParen,
}

#[derive(Debug, Clone)]
struct ParameterConstraint {
    parameter: String,
    expression: String,
    value: f64,
}