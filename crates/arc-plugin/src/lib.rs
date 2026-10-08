pub mod registry;
pub mod lua_plugin;
pub mod wasm_plugin;
pub mod api;
pub mod manager;

use arc_core::*;
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

pub trait Plugin: Send + Sync {
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
}

pub struct PluginContext {
    pub app: AppAPI,
    pub document: Option<DocumentRef>,
    pub settings: PluginSettings,
    pub logger: PluginLogger,
}

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

pub struct DocumentAPI {
    pub create_document: Box<dyn Fn(String) -> DocumentRef + Send + Sync>,
    pub open_document: Box<dyn Fn(String) -> Result<DocumentRef, String> + Send + Sync>,
    pub save_document: Box<dyn Fn(&DocumentRef) -> Result<(), String> + Send + Sync>,
    pub close_document: Box<dyn Fn(EntityId) -> Result<(), String> + Send + Sync>,
    pub active_document: Box<dyn Fn() -> Option<DocumentRef> + Send + Sync>,
}

pub struct GeometryAPI {
    pub create_point: Box<dyn Fn(Point3) -> CurveEntity + Send + Sync>,
    pub create_line: Box<dyn Fn(Point3, Point3) -> CurveEntity + Send + Sync>,
    pub create_circle: Box<dyn Fn(Point3, Vector3, f64) -> CurveEntity + Send + Sync>,
    pub create_arc: Box<dyn Fn(Point3, Vector3, f64, f64, f64) -> CurveEntity + Send + Sync>,
    pub create_polyline: Box<dyn Fn(Vec<Point3>, bool) -> Polyline + Send + Sync>,
    pub create_box: Box<dyn Fn(Point3, Point3) -> SolidEntity + Send + Sync>,
    pub create_cylinder: Box<dyn Fn(Point3, Vector3, f64, f64) -> SolidEntity + Send + Sync>,
    pub create_sphere: Box<dyn Fn(Point3, f64) -> SolidEntity + Send + Sync>,
    pub boolean_union: Box<dyn Fn(&SolidEntity, &SolidEntity) -> Result<SolidEntity, String> + Send + Sync>,
    pub boolean_difference: Box<dyn Fn(&SolidEntity, &SolidEntity) -> Result<SolidEntity, String> + Send + Sync>,
    pub boolean_intersection: Box<dyn Fn(&SolidEntity, &SolidEntity) -> Result<SolidEntity, String> + Send + Sync>,
}

pub struct ModelingAPI {
    pub create_sketch: Box<dyn Fn(Plane) -> SketchRef + Send + Sync>,
    pub create_extrusion: Box<dyn Fn(SketchRef, f64, Vector3) -> FeatureRef + Send + Sync>,
    pub create_revolution: Box<dyn Fn(SketchRef, Point3, Vector3, f64) -> FeatureRef + Send + Sync>,
    pub create_loft: Box<dyn Fn(Vec<SketchRef>) -> FeatureRef + Send + Sync>,
    pub create_sweep: Box<dyn Fn(SketchRef, CurveEntity) -> FeatureRef + Send + Sync>,
    pub create_fillet: Box<dyn Fn(SolidEntity, Vec<Edge>, f64) -> SolidEntity + Send + Sync>,
    pub create_chamfer: Box<dyn Fn(SolidEntity, Vec<Edge>, f64) -> SolidEntity + Send + Sync>,
}

pub struct ArchitectureAPI {
    pub create_wall: Box<dyn Fn(Polyline, f64, f64) -> WallRef + Send + Sync>,
    pub create_door: Box<dyn Fn(Point3, Vector3, f64, f64) -> DoorRef + Send + Sync>,
    pub create_window: Box<dyn Fn(Point3, Vector3, f64, f64) -> WindowRef + Send + Sync>,
    pub create_stair: Box<dyn Fn(Point3, Point3, f64, f64, f64) -> StairRef + Send + Sync>,
    pub create_roof: Box<dyn Fn(Polyline, RoofType) -> RoofRef + Send + Sync>,
    pub create_slab: Box<dyn Fn(Polyline, f64, f64) -> SlabRef + Send + Sync>,
    pub create_column: Box<dyn Fn(Point3, f64, f64) -> ColumnRef + Send + Sync>,
    pub create_beam: Box<dyn Fn(Point3, Point3, f64, f64) -> BeamRef + Send + Sync>,
    pub create_room: Box<dyn Fn(Polyline, f64) -> RoomRef + Send + Sync>,
    pub create_grid: Box<dyn Fn(Point3, Vector3, Vector3, f64, f64, usize, usize) -> GridRef + Send + Sync>,
    pub create_level: Box<dyn Fn(String, f64, f64) -> LevelRef + Send + Sync>,
}

pub struct UIAPI {
    pub add_panel: Box<dyn Fn(String, String, String) -> Result<(), String> + Send + Sync>,
    pub remove_panel: Box<dyn Fn(String) -> Result<(), String> + Send + Sync>,
    pub add_toolbar_button: Box<dyn Fn(String, String, String, String) -> Result<(), String> + Send + Sync>,
    pub remove_toolbar_button: Box<dyn Fn(String) -> Result<(), String> + Send + Sync>,
    pub show_message: Box<dyn Fn(String, MessageType) -> Result<(), String> + Send + Sync>,
    pub show_dialog: Box<dyn Fn(String, serde_json::Value) -> Result<serde_json::Value, String> + Send + Sync>,
    pub set_status_bar: Box<dyn Fn(String) -> Result<(), String> + Send + Sync>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MessageType {
    Info,
    Warning,
    Error,
    Success,
}

pub struct CommandAPI {
    pub register_command: Box<dyn Fn(String, String, Box<dyn Fn(&serde_json::Value) -> Result<serde_json::Value, String> + Send + Sync>) -> Result<(), String> + Send + Sync>,
    pub unregister_command: Box<dyn Fn(String) -> Result<(), String> + Send + Sync>,
    pub execute_command: Box<dyn Fn(String, serde_json::Value) -> Result<serde_json::Value, String> + Send + Sync>,
}

pub struct SettingsAPI {
    pub get: Box<dyn Fn(String) -> Option<serde_json::Value> + Send + Sync>,
    pub set: Box<dyn Fn(String, serde_json::Value) -> Result<(), String> + Send + Sync>,
    pub register: Box<dyn Fn(String, serde_json::Value, String) -> Result<(), String> + Send + Sync>,
}

pub struct FileAPI {
    pub read_file: Box<dyn Fn(String) -> Result<String, String> + Send + Sync>,
    pub write_file: Box<dyn Fn(String, String) -> Result<(), String> + Send + Sync>,
    pub list_directory: Box<dyn Fn(String) -> Result<Vec<String>, String> + Send + Sync>,
    pub file_dialog: Box<dyn Fn(FileDialogOptions) -> Result<Option<String>, String> + Send + Sync>,
}

#[derive(Debug, Clone, Default)]
pub struct FileDialogOptions {
    pub title: String,
    pub filters: Vec<(String, Vec<String>)>,
    pub default_path: Option<String>,
    pub save: bool,
    pub multiple: bool,
}

pub struct PluginSettings {
    pub config: serde_json::Value,
    pub data_path: std::path::PathBuf,
}

pub struct PluginLogger {
    pub log: Box<dyn Fn(LogLevel, String) + Send + Sync>,
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