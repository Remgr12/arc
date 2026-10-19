use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Units {
    pub scale: f64,
    pub system: String,
    pub custom_factors: bool,
}

impl Units {
    pub fn new() -> Self {
        Units {
            scale: 1.0,
            system: "metric".to_string(),
            custom_factors: false,
        }
    }
}
