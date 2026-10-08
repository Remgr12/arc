use std::fmt;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum UnitSystem {
    Metric,
    Imperial,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum LengthUnit {
    Millimeter,
    Centimeter,
    Meter,
    Kilometer,
    Inch,
    Foot,
    Yard,
    Mile,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AngleUnit {
    Degree,
    Radian,
    Gradian,
    Surveyor,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AreaUnit {
    SquareMillimeter,
    SquareCentimeter,
    SquareMeter,
    Hectare,
    SquareKilometer,
    SquareInch,
    SquareFoot,
    SquareYard,
    Acre,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum VolumeUnit {
    CubicMillimeter,
    CubicCentimeter,
    CubicMeter,
    Liter,
    CubicInch,
    CubicFoot,
    CubicYard,
    Gallon,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Units {
    pub system: UnitSystem,
    pub length: LengthUnit,
    pub angle: AngleUnit,
    pub area: AreaUnit,
    pub volume: VolumeUnit,
    pub precision: u8,
    pub angle_precision: u8,
    pub suppress_zeros: bool,
    pub zero_suppression: ZeroSuppression,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ZeroSuppression {
    None,
    Leading,
    Trailing,
    Both,
}

impl Default for Units {
    fn default() -> Self {
        Self {
            system: UnitSystem::Metric,
            length: LengthUnit::Millimeter,
            angle: AngleUnit::Degree,
            area: AreaUnit::SquareMeter,
            volume: VolumeUnit::CubicMeter,
            precision: 2,
            angle_precision: 2,
            suppress_zeros: false,
            zero_suppression: ZeroSuppression::None,
        }
    }
}

impl Units {
    pub fn metric() -> Self {
        Self {
            system: UnitSystem::Metric,
            length: LengthUnit::Millimeter,
            ..Default::default()
        }
    }

    pub fn imperial() -> Self {
        Self {
            system: UnitSystem::Imperial,
            length: LengthUnit::Inch,
            ..Default::default()
        }
    }

    pub fn architectural() -> Self {
        Self {
            system: UnitSystem::Imperial,
            length: LengthUnit::Foot,
            ..Default::default()
        }
    }

    pub fn length_to_base(&self, value: f64) -> f64 {
        value * self.length_factor()
    }

    pub fn base_to_length(&self, value: f64) -> f64 {
        value / self.length_factor()
    }

    fn length_factor(&self) -> f64 {
        match self.length {
            LengthUnit::Millimeter => 1.0,
            LengthUnit::Centimeter => 10.0,
            LengthUnit::Meter => 1000.0,
            LengthUnit::Kilometer => 1_000_000.0,
            LengthUnit::Inch => 25.4,
            LengthUnit::Foot => 304.8,
            LengthUnit::Yard => 914.4,
            LengthUnit::Mile => 1_609_344.0,
        }
    }

    pub fn format_length(&self, value: f64) -> String {
        let base_value = self.base_to_length(value);
        let precision = 10_u64.pow(self.precision as u32) as f64;
        let rounded = (base_value * precision).round() / precision;
        
        match self.length {
            LengthUnit::Foot | LengthUnit::Inch => self.format_feet_inches(rounded),
            _ => format!("{:.prec$}", rounded, prec = self.precision as usize),
        }
    }

    fn format_feet_inches(&self, value: f64) -> String {
        let total_inches = value * 12.0;
        let feet = (total_inches / 12.0).floor() as i64;
        let inches = total_inches - feet as f64 * 12.0;
        
        if feet != 0 {
            format!("{}-{:.prec$}\"", feet, inches, prec = self.precision as usize)
        } else {
            format!("{:.prec$}\"", inches, prec = self.precision as usize)
        }
    }

    pub fn format_angle(&self, value: f64) -> String {
        let degrees = value.to_degrees();
        let precision = 10_u64.pow(self.angle_precision as u32) as f64;
        let rounded = (degrees * precision).round() / precision;
        format!("{:.prec$}°", rounded, prec = self.angle_precision as usize)
    }

    pub fn parse_length(&self, input: &str) -> Option<f64> {
        let input = input.trim();
        
        if self.system == UnitSystem::Imperial && input.contains('-') || input.contains('\'') || input.contains('\"') {
            self.parse_feet_inches(input)
        } else {
            input.parse::<f64>().ok().map(|v| self.length_to_base(v))
        }
    }

    fn parse_feet_inches(&self, input: &str) -> Option<f64> {
        let mut total_inches = 0.0;
        let mut current = String::new();
        
        for ch in input.chars() {
            match ch {
                '\'' => {
                    if let Ok(feet) = current.parse::<f64>() {
                        total_inches += feet * 12.0;
                    }
                    current.clear();
                }
                '"' => {
                    if let Ok(inches) = current.parse::<f64>() {
                        total_inches += inches;
                    }
                    current.clear();
                }
                ' ' | '-' => {
                    if !current.is_empty() {
                        if let Ok(val) = current.parse::<f64>() {
                            total_inches += val;
                        }
                        current.clear();
                    }
                }
                _ => current.push(ch),
            }
        }
        
        if !current.is_empty() {
            if let Ok(val) = current.parse::<f64>() {
                total_inches += val;
            }
        }
        
        Some(self.length_to_base(total_inches / 12.0))
    }
}

impl fmt::Display for LengthUnit {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            LengthUnit::Millimeter => "mm",
            LengthUnit::Centimeter => "cm",
            LengthUnit::Meter => "m",
            LengthUnit::Kilometer => "km",
            LengthUnit::Inch => "in",
            LengthUnit::Foot => "ft",
            LengthUnit::Yard => "yd",
            LengthUnit::Mile => "mi",
        };
        write!(f, "{}", s)
    }
}

impl fmt::Display for AngleUnit {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            AngleUnit::Degree => "°",
            AngleUnit::Radian => "rad",
            AngleUnit::Gradian => "grad",
            AngleUnit::Surveyor => "survey",
        };
        write!(f, "{}", s)
    }
}