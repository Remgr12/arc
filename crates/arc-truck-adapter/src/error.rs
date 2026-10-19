/// Errors that can occur during arc-core to truck adaptation
#[derive(Debug, thiserror::Error)]
pub enum AdapterError {
    #[error("Adapter not yet implemented for this feature")]
    Unsupported,
    
    #[error("Unsupported geometry type: {0}")]
    UnsupportedType(String),
    
    #[error("Type mismatch: expected {expected}, got {actual}")]
    TypeMismatch { expected: String, actual: String },
    
    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    
    #[error("Io error: {0}")]
    Io(#[from] std::io::Error),
    
    #[error("Conversion error: {0}")]
    Conversion(String),
    
    #[error("Feature not yet implemented: {0}")]
    NotImplemented(String),
}
