pub mod wall;
pub mod door;
pub mod window;
pub mod stair;
pub mod roof;
pub mod slab;
pub mod column;
pub mod beam;
pub mod room;
pub mod grid;
pub mod level;
pub mod space;
pub mod annotation;

use arc_core::*;
use arc_geometry::*;
use arc_modeling::*;
use std::sync::Arc;
use parking_lot::RwLock;
use uuid::Uuid;

pub use arc_geometry::{Point3, Vector3};

pub use wall::*;
pub use door::*;
pub use window::*;
pub use stair::*;
pub use roof::*;
pub use slab::*;
pub use column::*;
pub use beam::*;
pub use room::*;
pub use grid::*;
pub use level::*;
pub use space::*;
pub use annotation::*;

#[derive(Debug, Clone)]
pub struct ArchitecturalModel {
    pub id: EntityId,
    pub name: String,
    pub levels: Vec<LevelRef>,
    pub grids: Vec<GridRef>,
    pub walls: Vec<WallRef>,
    pub doors: Vec<DoorRef>,
    pub windows: Vec<WindowRef>,
    pub stairs: Vec<StairRef>,
    pub roofs: Vec<RoofRef>,
    pub slabs: Vec<SlabRef>,
    pub columns: Vec<ColumnRef>,
    pub beams: Vec<BeamRef>,
    pub rooms: Vec<RoomRef>,
    pub spaces: Vec<SpaceRef>,
    pub annotations: Vec<AnnotationRef>,
    pub materials: MaterialLibrary,
    pub layers: LayerManager,
    pub project_info: ProjectInfo,
    pub units: Units,
}

impl ArchitecturalModel {
    pub fn new(name: String) -> Self {
        let mut model = Self {
            id: EntityId::new(),
            name,
            levels: Vec::new(),
            grids: Vec::new(),
            walls: Vec::new(),
            doors: Vec::new(),
            windows: Vec::new(),
            stairs: Vec::new(),
            roofs: Vec::new(),
            slabs: Vec::new(),
            columns: Vec::new(),
            beams: Vec::new(),
            rooms: Vec::new(),
            spaces: Vec::new(),
            annotations: Vec::new(),
            materials: MaterialLibrary::default(),
            layers: LayerManager::new(),
            project_info: ProjectInfo::default(),
            units: Units::metric(),
        };
        
        model.create_default_levels();
        model.create_default_grids();
        model
    }

    fn create_default_levels(&mut self) {
        let level = Level::new("Level 1".to_string(), 0.0, 3000.0);
        self.add_level(level);
    }

    fn create_default_grids(&mut self) {
        let grid = Grid::rectangular("Grid".to_string(), Point3::origin(), Vector3::new(1.0, 0.0, 0.0), Vector3::new(0.0, 1.0, 0.0), 6000.0, 6000.0, 5, 5);
        self.add_grid(grid);
    }

    pub fn add_level(&mut self, level: Level) -> LevelRef {
        let level_ref = Arc::new(RwLock::new(level));
        self.levels.push(level_ref.clone());
        level_ref
    }

    pub fn add_grid(&mut self, grid: Grid) -> GridRef {
        let grid_ref = Arc::new(RwLock::new(grid));
        self.grids.push(grid_ref.clone());
        grid_ref
    }

    pub fn add_wall(&mut self, wall: Wall) -> WallRef {
        let wall_ref = Arc::new(RwLock::new(wall));
        self.walls.push(wall_ref.clone());
        wall_ref
    }

    pub fn add_door(&mut self, door: Door) -> DoorRef {
        let door_ref = Arc::new(RwLock::new(door));
        self.doors.push(door_ref.clone());
        door_ref
    }

    pub fn add_window(&mut self, window: Window) -> WindowRef {
        let window_ref = Arc::new(RwLock::new(window));
        self.windows.push(window_ref.clone());
        window_ref
    }

    pub fn add_stair(&mut self, stair: Stair) -> StairRef {
        let stair_ref = Arc::new(RwLock::new(stair));
        self.stairs.push(stair_ref.clone());
        stair_ref
    }

    pub fn add_roof(&mut self, roof: Roof) -> RoofRef {
        let roof_ref = Arc::new(RwLock::new(roof));
        self.roofs.push(roof_ref.clone());
        roof_ref
    }

    pub fn add_slab(&mut self, slab: crate::slab::Slab) -> crate::slab::SlabRef {
        let slab_ref = Arc::new(RwLock::new(slab));
        self.slabs.push(slab_ref.clone());
        slab_ref
    }

    pub fn add_column(&mut self, column: Column) -> ColumnRef {
        let column_ref = Arc::new(RwLock::new(column));
        self.columns.push(column_ref.clone());
        column_ref
    }

    pub fn add_beam(&mut self, beam: Beam) -> BeamRef {
        let beam_ref = Arc::new(RwLock::new(beam));
        self.beams.push(beam_ref.clone());
        beam_ref
    }

    pub fn add_room(&mut self, room: Room) -> RoomRef {
        let room_ref = Arc::new(RwLock::new(room));
        self.rooms.push(room_ref.clone());
        room_ref
    }

    pub fn add_space(&mut self, space: Space) -> SpaceRef {
        let space_ref = Arc::new(RwLock::new(space));
        self.spaces.push(space_ref.clone());
        space_ref
    }

    pub fn add_annotation(&mut self, annotation: Annotation) -> AnnotationRef {
        let annotation_ref = Arc::new(RwLock::new(annotation));
        self.annotations.push(annotation_ref.clone());
        annotation_ref
    }

    pub fn get_elements_at_point(&self, point: Point3, tolerance: f64) -> Vec<ArchElement> {
        let mut elements = Vec::new();
        
        for wall in &self.walls {
            if wall.read().contains_point(point, tolerance) {
                elements.push(ArchElement::Wall(wall.clone()));
            }
        }
        
        for door in &self.doors {
            if door.read().contains_point(point, tolerance) {
                elements.push(ArchElement::Door(door.clone()));
            }
        }
        
        for window in &self.windows {
            if window.read().contains_point(point, tolerance) {
                elements.push(ArchElement::Window(window.clone()));
            }
        }
        
        for room in &self.rooms {
            if room.read().contains_point(point, 0.01) {
                elements.push(ArchElement::Room(room.clone()));
            }
        }
        
        elements
    }

    pub fn get_bounds(&self) -> crate::BoundingBox {
        let mut bbox = crate::BoundingBox::empty();
        
        for wall in &self.walls {
            bbox.expand(&wall.read().bounding_box);
        }
        for door in &self.doors {
            bbox.expand(&door.read().bounding_box);
        }
        for window in &self.windows {
            bbox.expand(&window.read().bounding_box);
        }
        for stair in &self.stairs {
            bbox.expand(&stair.read().bounding_box);
        }
        for roof in &self.roofs {
            bbox.expand(&roof.read().bounding_box);
        }
        for slab in &self.slabs {
            bbox.expand(&slab.read().bounding_box);
        }
        for column in &self.columns {
            bbox.expand(&column.read().bounding_box);
        }
        for beam in &self.beams {
            bbox.expand(&beam.read().bounding_box);
        }
        
        bbox
    }
}

#[derive(Debug, Clone)]
pub enum ArchElement {
    Wall(WallRef),
    Door(DoorRef),
    Window(WindowRef),
    Stair(StairRef),
    Roof(RoofRef),
    Slab(SlabRef),
    Column(ColumnRef),
    Beam(BeamRef),
    Room(RoomRef),
    Space(SpaceRef),
    Grid(GridRef),
    Level(LevelRef),
    Annotation(AnnotationRef),
}

pub type ArchModelRef = Arc<RwLock<ArchitecturalModel>>;

#[derive(Debug, Clone, Default)]
pub struct MaterialLibrary {
    pub materials: std::collections::HashMap<String, Material>,
}

impl MaterialLibrary {
    pub fn add(&mut self, material: Material) {
        self.materials.insert(material.name.clone(), material);
    }

    pub fn get(&self, name: &str) -> Option<&Material> {
        self.materials.get(name)
    }

    pub fn remove(&mut self, name: &str) -> Option<Material> {
        self.materials.remove(name)
    }
}

#[derive(Debug, Clone)]
pub struct Material {
    pub name: String,
    pub color: crate::Color,
    pub transparency: f32,
    pub shininess: f32,
    pub texture: Option<String>,
    pub density: f64,
    pub thermal_conductivity: f64,
    pub cost_per_unit: f64,
    pub category: MaterialCategory,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MaterialCategory {
    Concrete,
    Steel,
    Wood,
    Glass,
    Masonry,
    Insulation,
    Finishes,
    Roofing,
    Custom,
}

impl Default for Material {
    fn default() -> Self {
        Self {
            name: "Default".to_string(),
            color: crate::Color::GRAY,
            transparency: 0.0,
            shininess: 0.5,
            texture: None,
            density: 2400.0,
            thermal_conductivity: 1.7,
            cost_per_unit: 100.0,
            category: MaterialCategory::Concrete,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct LayerManager {
    pub layers: std::collections::HashMap<String, ArchLayer>,
    pub active_layer: Option<String>,
}

impl LayerManager {
    pub fn new() -> Self {
        let mut layers = std::collections::HashMap::new();
        layers.insert("A-WALL".to_string(), ArchLayer::new("A-WALL", crate::Color::RED));
        layers.insert("A-DOOR".to_string(), ArchLayer::new("A-DOOR", crate::Color::GREEN));
        layers.insert("A-WIND".to_string(), ArchLayer::new("A-WIND", crate::Color::BLUE));
        layers.insert("A-STAIR".to_string(), ArchLayer::new("A-STAIR", crate::Color::YELLOW));
        layers.insert("A-ROOF".to_string(), ArchLayer::new("A-ROOF", crate::Color::MAGENTA));
        layers.insert("A-SLAB".to_string(), ArchLayer::new("A-SLAB", crate::Color::CYAN));
        layers.insert("A-COLS".to_string(), ArchLayer::new("A-COLS", crate::Color::WHITE));
        layers.insert("A-BEAM".to_string(), ArchLayer::new("A-BEAM", crate::Color::ORANGE));
        layers.insert("A-ROOM".to_string(), ArchLayer::new("A-ROOM", crate::Color::LIGHT_GRAY));
        layers.insert("A-GRID".to_string(), ArchLayer::new("A-GRID", crate::Color::GRAY));
        layers.insert("A-ANNO".to_string(), ArchLayer::new("A-ANNO", crate::Color::BLACK));
        layers.insert("A-DIMS".to_string(), ArchLayer::new("A-DIMS", crate::Color::BLACK));
        
        Self {
            layers,
            active_layer: Some("A-WALL".to_string()),
        }
    }

    pub fn add_layer(&mut self, name: String, color: crate::Color) {
        self.layers.insert(name.clone(), ArchLayer::new(&name, color));
    }

    pub fn get_layer(&self, name: &str) -> Option<&ArchLayer> {
        self.layers.get(name)
    }

    pub fn get_layer_mut(&mut self, name: &str) -> Option<&mut ArchLayer> {
        self.layers.get_mut(name)
    }
}

#[derive(Debug, Clone)]
pub struct ArchLayer {
    pub name: String,
    pub color: crate::Color,
    pub visible: bool,
    pub locked: bool,
    pub line_weight: f32,
    pub line_type: crate::LineType,
    pub printable: bool,
}

impl ArchLayer {
    pub fn new(name: &str, color: crate::Color) -> Self {
        Self {
            name: name.to_string(),
            color,
            visible: true,
            locked: false,
            line_weight: 0.25,
            line_type: crate::LineType::Continuous,
            printable: true,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct ProjectInfo {
    pub project_name: String,
    pub project_number: String,
    pub client: String,
    pub address: String,
    pub architect: String,
    pub engineer: String,
    pub status: ProjectStatus,
    pub phase: ProjectPhase,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub description: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ProjectStatus {
    #[default]
    Concept,
    SchematicDesign,
    DesignDevelopment,
    ConstructionDocuments,
    Bidding,
    Construction,
    Complete,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ProjectPhase {
    #[default]
    PreDesign,
    Schematic,
    DesignDevelopment,
    ConstructionDocs,
    ConstructionAdmin,
}