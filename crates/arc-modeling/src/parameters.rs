use serde::{Serialize, Deserialize};
use arc_core::*;
use std::collections::HashMap;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ParameterTable {
    pub parameters: HashMap<String, Parameter>,
}

impl ParameterTable {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn add(&mut self, name: String, value: f64, expression: Option<String>) {
        self.parameters.insert(name, Parameter {
            value,
            expression,
            unit: Unit::default(),
            is_driving: true,
        });
    }

    pub fn get(&self, name: &str) -> Option<&Parameter> {
        self.parameters.get(name)
    }

    pub fn set(&mut self, name: String, value: f64) {
        if let Some(param) = self.parameters.get_mut(&name) {
            param.value = value;
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Parameter {
    pub value: f64,
    pub expression: Option<String>,
    pub unit: Unit,
    pub is_driving: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Unit {
    Millimeter,
    Centimeter,
    Meter,
    Inch,
    Foot,
    Degree,
    Radian,
}

impl Default for Unit {
    fn default() -> Self {
        Self::Millimeter
    }
}