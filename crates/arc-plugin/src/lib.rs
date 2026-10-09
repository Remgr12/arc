pub mod registry;
pub mod lua_plugin;
pub mod wasm_plugin;
pub mod api;
pub mod manager;

use arc_core::*;
use arc_geometry::{Point3, Vector3, Polyline, CurveEntity, SolidEntity, Plane, Edge};
use arc_modeling::{SketchRef, FeatureRef};
use arc_architecture::{WallRef, DoorRef, WindowRef, StairRef, RoofType, RoofRef, SlabRef, ColumnRef, BeamRef, RoomRef, SpaceRef, AnnotationRef, OpeningRef, LevelRef, GridRef};
use std::sync::Arc;
use parking_lot::RwLock;
use uuid::Uuid;

pub use registry::*;
pub use lua_plugin::*;
pub use wasm_plugin::*;
pub use api::*;
pub use manager::*;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub author: String,
    pub license: String,
    pub homepage: Option<String>,
    pub repository: Option<String>,
    pub keywords: Vec<String>,
    pub categories: Vec<PluginCategory>,
    pub entry_point: String,
    pub api_version: String,
    pub dependencies: Vec<PluginDependency>,
    pub permissions: Vec<PluginPermission>,
    pub configuration: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum PluginCategory {
    Modeling,
    Architecture,
    Rendering,
    ImportExport,
    Analysis,
    Automation,
    UI,
    Utility,
    Custom,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PluginDependency {
    pub id: String,
    pub version: String,
    pub optional: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum PluginPermission {
    FileSystemRead,
    FileSystemWrite,
    NetworkAccess,
    ClipboardAccess,
    DocumentAccess,
    GeometryAccess,
    UIAccess,
    SettingsAccess,
    CommandExecution,
}

pub trait Plugin: Send + Sync + std::fmt::Debug {
    fn manifest(&self) -> &PluginManifest;
    fn initialize(&mut self, context: &PluginContext) -> Result<(), PluginError>;
    fn shutdown(&mut self) -> Result<(), PluginError>;
    fn on_load(&mut self) -> Result<(), PluginError>;
    fn on_unload(&mut self) -> Result<(), PluginError>;
    fn on_document_created(&mut self, document: &DocumentRef) -> Result<(), PluginError>;
    fn on_document_opened(&mut self, document: &DocumentRef) -> Result<(), PluginError>;
    fn on_document_saved(&mut self, document: &DocumentRef) -> Result<(), PluginError>;
    fn on_document_closed(&mut self, document: &DocumentRef) -> Result<(), PluginError>;
    fn on_selection_changed(&mut self, document: &DocumentRef, selection: &Selection) -> Result<(), PluginError>;
    fn on_command(&mut self, command_id: &str, args: &serde_json::Value) -> Result<Option<serde_json::Value>, PluginError>;
    fn on_ui_event(&mut self, event: &UIEvent) -> Result<(), PluginError>;
    fn on_timer(&mut self, interval: f64) -> Result<(), PluginError>;
}

#[derive(Debug, thiserror::Error)]
pub enum PluginError {
    #[error("Initialization failed: {0}")]
    Initialization(String),
    #[error("Runtime error: {0}")]
    Runtime(String),
    #[error("Permission denied: {0}")]
    PermissionDenied(String),
    #[error("API error: {0}")]
    APIError(String),
    #[error("Configuration error: {0}")]
    Configuration(String),
    #[error("Dependency error: {0}")]
    Dependency(String),
    #[error("IO error: {0}")]
    IO(#[from] std::io::Error),
    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("Internal error: {0}")]
    Internal(String),
}

impl From<String> for PluginError {
    fn from(s: String) -> Self {
        PluginError::Internal(s)
    }
}

impl From<&str> for PluginError {
    fn from(s: &str) -> Self {
        PluginError::Internal(s.to_string())
    }
}

pub struct PluginContext {
    pub app: AppAPI,
    pub document: Option<DocumentRef>,
    pub selection: Selection,
    pub settings: PluginSettings,
    pub logger: PluginLogger,
}

#[derive(Clone)]
pub struct AppAPI {
    pub documents: DocumentAPI,
    pub geometry: GeometryAPI,
    pub modeling: ModelingAPI,
    pub architecture: ArchitectureAPI,
    pub ui: UIAPI,
    pub commands: CommandAPI,
    pub settings: SettingsAPI,
    pub files: FileAPI,
}

#[derive(Clone)]
pub struct DocumentAPI {
    pub create_document: Arc<dyn Fn(String) -> DocumentRef + Send + Sync>,
    pub open_document: Arc<dyn Fn(String) -> Result<DocumentRef, String> + Send + Sync>,
    pub save_document: Arc<dyn Fn(&DocumentRef) -> Result<(), String> + Send + Sync>,
    pub close_document: Arc<dyn Fn(EntityId) -> Result<(), String> + Send + Sync>,
    pub active_document: Arc<dyn Fn() -> Option<DocumentRef> + Send + Sync>,
}

#[derive(Clone)]
pub struct GeometryAPI {
    pub create_point: Arc<dyn Fn(Point3) -> CurveEntity + Send + Sync>,
    pub create_line: Arc<dyn Fn(Point3, Point3) -> CurveEntity + Send + Sync>,
    pub create_circle: Arc<dyn Fn(Point3, Vector3, f64) -> CurveEntity + Send + Sync>,
    pub create_arc: Arc<dyn Fn(Point3, Vector3, f64, f64, f64) -> CurveEntity + Send + Sync>,
    pub create_polyline: Arc<dyn Fn(Vec<Point3>, bool) -> Polyline + Send + Sync>,
    pub create_box: Arc<dyn Fn(Point3, Point3) -> SolidEntity + Send + Sync>,
    pub create_cylinder: Arc<dyn Fn(Point3, Vector3, f64, f64) -> SolidEntity + Send + Sync>,
    pub create_sphere: Arc<dyn Fn(Point3, f64) -> SolidEntity + Send + Sync>,
    pub boolean_union: Arc<dyn Fn(&SolidEntity, &SolidEntity) -> Result<SolidEntity, String> + Send + Sync>,
    pub boolean_difference: Arc<dyn Fn(&SolidEntity, &SolidEntity) -> Result<SolidEntity, String> + Send + Sync>,
    pub boolean_intersection: Arc<dyn Fn(&SolidEntity, &SolidEntity) -> Result<SolidEntity, String> + Send + Sync>,
}

#[derive(Clone)]
pub struct ModelingAPI {
    pub create_sketch: Arc<dyn Fn(Plane) -> SketchRef + Send + Sync>,
    pub create_extrusion: Arc<dyn Fn(SketchRef, f64, Vector3) -> FeatureRef + Send + Sync>,
    pub create_revolution: Arc<dyn Fn(SketchRef, Point3, Vector3, f64) -> FeatureRef + Send + Sync>,
    pub create_loft: Arc<dyn Fn(Vec<SketchRef>) -> FeatureRef + Send + Sync>,
    pub create_sweep: Arc<dyn Fn(SketchRef, CurveEntity) -> FeatureRef + Send + Sync>,
    pub create_fillet: Arc<dyn Fn(SolidEntity, Vec<Edge>, f64) -> SolidEntity + Send + Sync>,
    pub create_chamfer: Arc<dyn Fn(SolidEntity, Vec<Edge>, f64) -> SolidEntity + Send + Sync>,
}

#[derive(Clone)]
pub struct ArchitectureAPI {
    pub create_wall: Arc<dyn Fn(Polyline, f64, f64) -> WallRef + Send + Sync>,
    pub create_door: Arc<dyn Fn(Point3, Vector3, f64, f64) -> DoorRef + Send + Sync>,
    pub create_window: Arc<dyn Fn(Point3, Vector3, f64, f64) -> WindowRef + Send + Sync>,
    pub create_stair: Arc<dyn Fn(Point3, Point3, f64, f64, f64) -> StairRef + Send + Sync>,
    pub create_roof: Arc<dyn Fn(Polyline, RoofType) -> RoofRef + Send + Sync>,
    pub create_slab: Arc<dyn Fn(Polyline, f64, f64) -> SlabRef + Send + Sync>,
    pub create_column: Arc<dyn Fn(Point3, f64, f64) -> ColumnRef + Send + Sync>,
    pub create_beam: Arc<dyn Fn(Point3, Point3, f64, f64) -> BeamRef + Send + Sync>,
    pub create_room: Arc<dyn Fn(Polyline, f64) -> RoomRef + Send + Sync>,
    pub create_grid: Arc<dyn Fn(Point3, Vector3, Vector3, f64, f64, usize, usize) -> GridRef + Send + Sync>,
    pub create_level: Arc<dyn Fn(String, f64, f64) -> LevelRef + Send + Sync>,
}

#[derive(Clone)]
pub struct UIAPI {
    pub add_panel: Arc<dyn Fn(String, String, String) -> Result<(), String> + Send + Sync>,
    pub remove_panel: Arc<dyn Fn(String) -> Result<(), String> + Send + Sync>,
    pub add_toolbar_button: Arc<dyn Fn(String, String, String, String) -> Result<(), String> + Send + Sync>,
    pub remove_toolbar_button: Arc<dyn Fn(String) -> Result<(), String> + Send + Sync>,
    pub show_message: Arc<dyn Fn(String, MessageType) -> Result<(), String> + Send + Sync>,
    pub show_dialog: Arc<dyn Fn(String, serde_json::Value) -> Result<serde_json::Value, String> + Send + Sync>,
    pub set_status_bar: Arc<dyn Fn(String) -> Result<(), String> + Send + Sync>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MessageType {
    Info,
    Warning,
    Error,
    Success,
}

#[derive(Clone)]
pub struct CommandAPI {
    pub register_command: Arc<dyn Fn(String, String, Arc<dyn Fn(&serde_json::Value) -> Result<serde_json::Value, String> + Send + Sync>) -> Result<(), String> + Send + Sync>,
    pub unregister_command: Arc<dyn Fn(String) -> Result<(), String> + Send + Sync>,
    pub execute_command: Arc<dyn Fn(String, serde_json::Value) -> Result<serde_json::Value, String> + Send + Sync>,
}

#[derive(Clone)]
pub struct SettingsAPI {
    pub get: Arc<dyn Fn(String) -> Option<serde_json::Value> + Send + Sync>,
    pub set: Arc<dyn Fn(String, serde_json::Value) -> Result<(), String> + Send + Sync>,
    pub register: Arc<dyn Fn(String, serde_json::Value, String) -> Result<(), String> + Send + Sync>,
}

#[derive(Clone)]
pub struct FileAPI {
    pub read_file: Arc<dyn Fn(String) -> Result<String, String> + Send + Sync>,
    pub write_file: Arc<dyn Fn(String, String) -> Result<(), String> + Send + Sync>,
    pub list_directory: Arc<dyn Fn(String) -> Result<Vec<String>, String> + Send + Sync>,
    pub file_dialog: Arc<dyn Fn(FileDialogOptions) -> Result<Option<String>, String> + Send + Sync>,
}

#[derive(Debug, Clone, Default)]
pub struct FileDialogOptions {
    pub title: String,
    pub filters: Vec<(String, Vec<String>)>,
    pub default_path: Option<String>,
    pub save: bool,
    pub multiple: bool,
}

#[derive(Clone)]
pub struct PluginSettings {
    pub config: serde_json::Value,
    pub data_path: std::path::PathBuf,
}

#[derive(Clone)]
pub struct PluginLogger {
    pub log: Arc<dyn Fn(LogLevel, String) + Send + Sync>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogLevel {
    Trace,
    Debug,
    Info,
    Warn,
    Error,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct UIEvent {
    pub event_type: UIEventType,
    pub component_id: String,
    pub data: serde_json::Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum UIEventType {
    Click,
    DoubleClick,
    Hover,
    Focus,
    Blur,
    Change,
    Submit,
    KeyPress,
    KeyRelease,
    DragStart,
    Drag,
    DragEnd,
    Drop,
    Resize,
    Scroll,
}

pub type PluginRef = Arc<RwLock<dyn Plugin>>;