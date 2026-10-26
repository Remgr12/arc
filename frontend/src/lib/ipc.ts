import { invoke } from "@tauri-apps/api/core";
import type {
  AppOverview,
  BuildingSchedule,
  DocumentInfo,
  Geometry,
  GridData,
  LayerData,
  LevelData,
  PluginInfo,
  ProjectMode,
  ProjectSummary,
  RayHit,
  SceneData,
  SceneEnvelope,
  Settings,
  Transform,
  UpdateNotice,
} from "./types";

export const ipc = {
  // app / documents
  getState: (): Promise<AppOverview> => invoke("get_state"),
  getPlugins: (): Promise<PluginInfo[]> => invoke("get_plugins"),
  getSettings: (): Promise<Settings> => invoke("get_settings"),
  listProjects: (dir: string): Promise<ProjectSummary[]> => invoke("list_projects", { dir }),
  deleteProject: (path: string): Promise<void> => invoke("delete_project", { path }),
  saveProjectThumbnail: (documentId: string, base64Png: string): Promise<void> =>
    invoke("save_project_thumbnail", { documentId, base64Png }),
  readProjectThumbnail: (projectPath: string): Promise<string | null> =>
    invoke("read_project_thumbnail", { projectPath }),
  setSettings: (settings: Settings): Promise<Settings> => invoke("set_settings", { settings }),

  newDocument: (name?: string, mode?: ProjectMode): Promise<DocumentInfo> =>
    invoke("new_document", { name: name ?? null, mode: mode ?? null }),
  openDocument: (path: string): Promise<DocumentInfo> => invoke("open_document", { path }),
  saveDocument: (documentId: string, path?: string): Promise<DocumentInfo> =>
    invoke("save_document", { documentId, path: path ?? null }),
  closeDocument: (id: string): Promise<void> => invoke("close_document", { id }),
  setActiveDocument: (id: string): Promise<void> => invoke("set_active_document", { id }),

  // architecture & BIM
  setProjectMode: (documentId: string, mode: ProjectMode): Promise<SceneData> =>
    invoke("set_project_mode", { documentId, mode }),
  addLevel: (
    documentId: string,
    name: string,
    elevation: number,
    height: number,
  ): Promise<LevelData> => invoke("add_level", { documentId, name, elevation, height }),
  removeLevel: (documentId: string, levelId: string): Promise<boolean> =>
    invoke("remove_level", { documentId, levelId }),
  setActiveLevel: (documentId: string, levelId: string | null): Promise<void> =>
    invoke("set_active_level", { documentId, levelId }),
  addGrid: (
    documentId: string,
    name: string,
    start: [number, number],
    end: [number, number],
  ): Promise<GridData> => invoke("add_grid", { documentId, name, start, end }),
  removeGrid: (documentId: string, gridId: string): Promise<boolean> =>
    invoke("remove_grid", { documentId, gridId }),
  getBuildingSchedule: (documentId: string): Promise<BuildingSchedule> =>
    invoke("get_building_schedule", { documentId }),

  // scene
  getScene: (documentId: string): Promise<SceneData> =>
    invoke<SceneEnvelope>("get_scene", { documentId }).then((envelope) => envelope.scene),

  // entities
  createEntity: (
    documentId: string,
    geometry: Geometry,
    name?: string,
    transform?: Transform,
  ) =>
    invoke<{ id: string; name: string }>("create_entity", {
      documentId,
      geometry,
      name: name ?? null,
      transform: transform ?? null,
    }),
  updateGeometry: (documentId: string, entityId: string, geometry: Geometry): Promise<void> =>
    invoke("update_geometry", { documentId, entityId, geometry }),
  deleteEntities: (documentId: string, entityIds: string[]): Promise<void> =>
    invoke("delete_entities", { documentId, entityIds }),
  duplicateEntities: (documentId: string, entityIds: string[]): Promise<string[]> =>
    invoke("duplicate_entities", { documentId, entityIds }),
  explodeEntities: (
    documentId: string,
    entityIds: string[],
    distance: number,
  ): Promise<string[]> => invoke("explode_entities", { documentId, entityIds, distance }),
  setTransform: (
    documentId: string,
    updates: { id: string; transform: Transform }[],
    record = true,
  ): Promise<void> => invoke("set_transform", { documentId, updates, record }),
  setEntityProps: (
    documentId: string,
    entityId: string,
    props: {
      name?: string;
      visible?: boolean;
      locked?: boolean;
      color?: [number, number, number, number] | null;
      layerId?: string;
    },
  ): Promise<void> => invoke("set_entity_props", { documentId, entityId, props }),
  setSelection: (
    documentId: string,
    ids: string[],
    primary: string | null,
  ): Promise<void> => invoke("set_selection", { documentId, ids, primary: primary ?? null }),

  // picking
  raycast: (
    documentId: string,
    origin: [number, number, number],
    dir: [number, number, number],
  ): Promise<RayHit | null> => invoke("raycast", { documentId, origin, dir, tolerance: 1.0 }),

  // history
  undo: (documentId: string): Promise<string | null> => invoke("undo", { documentId }),
  redo: (documentId: string): Promise<string | null> => invoke("redo", { documentId }),

  // layers
  addLayer: (documentId: string, name?: string): Promise<string> =>
    invoke("add_layer", { documentId, name: name ?? null }),
  deleteLayer: (documentId: string, layerId: string): Promise<void> =>
    invoke("delete_layer", { documentId, layerId }),
  renameLayer: (documentId: string, layerId: string, name: string): Promise<void> =>
    invoke("rename_layer", { documentId, layerId, name }),
  setLayerVisible: (documentId: string, layerId: string, visible: boolean): Promise<void> =>
    invoke("set_layer_visible", { documentId, layerId, visible }),
  setLayerLocked: (documentId: string, layerId: string, locked: boolean): Promise<void> =>
    invoke("set_layer_locked", { documentId, layerId, locked }),
  setLayerColor: (documentId: string, layerId: string, color: [number, number, number, number]) =>
    invoke("set_layer_color", { documentId, layerId, color }),
  setActiveLayer: (documentId: string, layerId: string): Promise<void> =>
    invoke("set_active_layer", { documentId, layerId }),

  // plugins
  reloadPlugins: (): Promise<PluginInfo[]> => invoke("reload_plugins"),
  setPluginEnabled: (name: string, enabled: boolean): Promise<void> =>
    invoke("set_plugin_enabled", { name, enabled }),

  // import
  importFile: (documentId: string, path: string, format?: string): Promise<ImportResult> =>
    invoke("import_file", { documentId, path, format: format ?? null }),

  // export
  exportScene: (documentId: string, path: string, format: string): Promise<string> =>
    invoke("export_scene", { documentId, path, format }),

  // CSG booleans
  csgApply: (
    documentId: string,
    operation: "union" | "difference" | "intersection",
    firstId: string,
    secondId: string,
  ): Promise<{ id: string; name: string }> =>
    invoke("csg_apply", {
      documentId,
      operation,
      firstId,
      secondId,
    }),

  // sheet metal
  sheetmetalMaterials: (): Promise<SheetMetalMaterial[]> =>
    invoke("sheetmetal_materials"),
  sheetmetalFlatPattern: (spec: unknown): Promise<SheetMetalFlatPattern> =>
    invoke("sheetmetal_flat_pattern", { spec }),

  // materials
  setEntityMaterial: (documentId: string, entityId: string, material: string | null): Promise<void> =>
    invoke("set_entity_material", { documentId, entityId, material }),
  getMaterialLibrary: (): Promise<MaterialLibraryEntry[]> => invoke("get_material_library"),

  // updater
  checkForUpdates: (): Promise<UpdateNotice> => invoke("check_for_updates"),
  installUpdate: (): Promise<void> => invoke("install_update"),
};

export interface ImportResult {
  format: string;
  entities_created: string[];
}

export interface SheetMetalMaterial {
  name: string;
  thickness_mm: number;
  k_factor: number;
  min_bend_radius_mm: number;
}

export interface MaterialLibraryEntry {
  id: string;
  label: string;
  color: [number, number, number];
  roughness: number;
  metalness: number;
}

export interface SheetMetalBendLine {
  position: [number, number];
  direction: [number, number];
  angle_deg: number;
  radius_mm: number;
}

export interface SheetMetalFlatPattern {
  outline: [number, number][];
  bend_lines: SheetMetalBendLine[];
}

export type { LayerData };
