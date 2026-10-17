//! Units of measurement.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum UnitSystem {
    #[default]
    Metric,
    Imperial,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum LengthUnit {
    #[default]
    Millimeter,
    Centimeter,
    Meter,
    Inch,
    Foot,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum AngleUnit {
    #[default]
    Degree,
    Radian,
}

/// Units configuration of a document.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Units {
    pub system: UnitSystem,
    pub length: LengthUnit,
    pub angle: AngleUnit,
    pub precision: u32,
    pub angle_precision: u32,
}

impl Default for Units {
    fn default() -> Self {
        Self {
            system: UnitSystem::Metric,
            length: LengthUnit::Millimeter,
            angle: AngleUnit::Degree,
            precision: 2,
            angle_precision: 1,
        }
    }
}

impl Units {
    /// Suffix appended by the frontend when formatting lengths.
    pub fn abbreviation(&self) -> &'static str {
        match self.length {
            LengthUnit::Millimeter => "mm",
            LengthUnit::Centimeter => "cm",
            LengthUnit::Meter => "m",
            LengthUnit::Inch => "in",
            LengthUnit::Foot => "ft",
        }
    }
}
