/**
 * Floor-plan domain types (architectural analysis + generated electrical plan).
 * All geometry is expressed in METRES in the drawing's own model coordinates (y up),
 * so the electrical layer lands exactly on top of the original drawing.
 * Keep this file free of runtime logic — it is imported by client components.
 */

export type Pt = [number, number];
export type BBox = [number, number, number, number]; // minX, minY, maxX, maxY

export type RoomType =
  | "office"
  | "meeting"
  | "kitchen"
  | "bathroom"
  | "bedroom"
  | "living"
  | "corridor"
  | "entrance"
  | "storage"
  | "garage"
  | "technical"
  | "laundry"
  | "terrace"
  | "stairs"
  | "room";

export type LayerRole = "wall" | "door" | "window" | "stairs" | "text" | "dimension" | "furniture" | "column" | "other";

export interface PlanWarning {
  id: string;
  severity: "info" | "warning" | "critical";
  message: string;
}

export interface PlanFileInfo {
  name: string;
  ext: "dxf" | "dwg";
  size: number;
  sha256: string;
  uploaded_at: string;
  uploaded_by: string;
  /** Path relative to the uploads directory (server side). */
  stored_as: string;
  /** DXF text actually analysed (for DWG: the AutoCAD-converted copy), relative to uploads dir. */
  analysed_as: string;
  converted_from?: "dwg" | "binary-dxf";
  format_version: string | null;
}

export interface PlanScale {
  /** Unit the drawing is authored in. */
  unit: "mm" | "cm" | "m" | "in" | "ft";
  /** Multiply a drawing coordinate by this to get metres. */
  factor_to_m: number;
  source: "header" | "inferred";
  /** True when the unit had to be guessed — shown to the engineer as an assumption. */
  assumed: boolean;
  note: string;
}

export interface PlanWall {
  id: string;
  a: Pt;
  b: Pt;
  layer: string;
  exterior: boolean;
  thickness_m: number | null;
}

export interface PlanOpening {
  id: string;
  type: "door" | "window";
  at: Pt;
  width_m: number;
  /** Direction along the wall, radians. */
  angle: number;
  layer: string;
  block: string | null;
  /** Rooms on both sides (null = outside). */
  between: [string | null, string | null];
  exterior: boolean;
  swing?: { hinge: Pt; toward: Pt; open_to: string | null; description: string };
}

export interface PlanRoom {
  id: string;
  name: string | null;
  label_source: "text" | "inferred";
  type: RoomType;
  polygon: Pt[];
  area_m2: number;
  centroid: Pt;
  bbox: BBox;
  /** Functional description of the space. */
  function: string;
  /** Short side of the bounding box, metres. */
  min_width_m: number;
}

export interface PlanStair {
  id: string;
  at: Pt;
  bbox: BBox;
  layer: string;
}

export interface PlanLayerInfo {
  name: string;
  role: LayerRole;
  entities: number;
}

/** Drawing primitives kept for the on-screen preview (decimated, metres). */
export interface PreviewPrim {
  k: "line" | "arc" | "circle" | "text";
  role: LayerRole;
  /** line: [x1,y1,x2,y2]; arc: [cx,cy,r,a0,a1]; circle: [cx,cy,r]; text: [x,y,h,rot] */
  v: number[];
  s?: string;
}

export interface PlanAnalysis {
  analysed_at: string;
  scale: PlanScale;
  extents: BBox;
  layers: PlanLayerInfo[];
  walls: PlanWall[];
  openings: PlanOpening[];
  rooms: PlanRoom[];
  stairs: PlanStair[];
  /** Total entities parsed / dimension entities seen. */
  stats: { entities: number; dimensions: number; texts: number; blocks: number; wall_segments: number };
  dimension_check: { checked: number; consistent: boolean | null; note: string };
  confidence: "high" | "medium" | "low";
  walls_layer_assumed: string | null;
  preview: PreviewPrim[];
  warnings: PlanWarning[];
}

// ------------------------------------------------------------------ electrical

export type DeviceKind = "luminaire" | "switch" | "socket" | "special_socket" | "point" | "panel";

export interface ElectricalDevice {
  id: string;
  kind: DeviceKind;
  /** Short symbol tag, e.g. "L3", "S5". */
  tag: string;
  at: Pt;
  room_id: string | null;
  circuit: string | null;
  description: string;
  rating?: string;
  /** Orientation of wall-mounted devices (unit vector pointing into the room). */
  facing?: Pt;
}

export interface ElectricalCircuit {
  id: string; // "C1"
  kind: "lighting" | "sockets" | "special";
  name: string;
  phase: "L1" | "L2" | "L3";
  protection: string;
  cable: string;
  cable_csa_mm2: number;
  load_w: number;
  design_current_a: number;
  device_ids: string[];
  /** Cable route as one polyline, panel → devices in order. */
  route: Pt[];
  length_m: number;
  rooms: string[];
}

export interface LegendItem {
  kind: DeviceKind | "cable";
  label: string;
  count: number;
}

export interface PlanBomLine {
  id: string;
  description: string;
  /** Catalogue SKU when the item is stocked, otherwise null (to be sourced externally). */
  sku: string | null;
  quantity: number;
  unit: string;
  basis: string;
}

export interface ElectricalConfig {
  lighting: boolean;
  switches: boolean;
  sockets: boolean;
  special_sockets: boolean;
  points: boolean;
  supply: "single_phase" | "three_phase";
  voltage_v: number;
  luminaire_w: number;
}

export interface ElectricalPlan {
  generated_at: string;
  config: ElectricalConfig;
  panel: ElectricalDevice;
  devices: ElectricalDevice[];
  circuits: ElectricalCircuit[];
  legend: LegendItem[];
  technical: {
    voltage_v: number;
    system: string;
    frequency_hz: number;
    standards: string[];
    connected_load_w: number;
    demand_load_w: number;
    design_current_a: number;
    main_protection: string;
    cable_total_m: number;
  };
  assumptions: string[];
  bom: PlanBomLine[];
  warnings: PlanWarning[];
}

export interface PlanCadInfo {
  generated_at: string;
  file_name: string;
  saved_path: string;
  entities: number;
  layers: number;
  opened_at?: string;
  open_method?: "autocad-mcp" | "os-default";
  dwg_path?: string;
}

export interface ProjectPlan {
  file: PlanFileInfo;
  analysis: PlanAnalysis | null;
  electrical: ElectricalPlan | null;
  reviewed_by?: string | null;
  reviewed_by_id?: string | null;
  reviewed_at?: string | null;
  cad: PlanCadInfo | null;
}
