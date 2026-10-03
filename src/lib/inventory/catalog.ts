import clientProducts from "../../../data/products.client.json";
import type { Product, ProductAttributes } from "../types";

/**
 * Seed catalog.
 *
 * - `client_dataset` products come verbatim from data/products.client.json (the company's inventory).
 *   We only add machine-readable attributes (rating, range, cross-section…) so the selection
 *   engine can match them — names, prices and stock are untouched.
 * - `demo_supplement` products are dummy items for device types the dataset does not contain
 *   (operator controls, VFD). They are flagged in the UI as demo data.
 */

const ATTRIBUTES: Record<string, ProductAttributes> = {
  "PROT-MCB-001": { product_type: "mcb", manufacturer: "Schneider", poles: 1, rated_current_a: 16, curve: "C", standards: ["IEC 60947"] },
  "PROT-MCB-002": { product_type: "mcb", manufacturer: "Schneider", poles: 3, rated_current_a: 32, curve: "C", standards: ["IEC 60947"] },
  "PROT-MCCB-001": { product_type: "mccb", manufacturer: "ABB", poles: 3, rated_current_a: 100, standards: ["IEC 60947"] },
  "CTRL-CNT-001": { product_type: "contactor", manufacturer: "Schneider", poles: 3, rated_current_a: 32, coil_voltage: "24 V DC (BD coil code)", standards: ["IEC 60947"] },
  "CTRL-OVR-001": { product_type: "overload_relay", manufacturer: "Schneider", range_min_a: 17, range_max_a: 25, standards: ["IEC 60947"] },
  "CTRL-MPCB-001": { product_type: "mpcb", manufacturer: "Eaton", poles: 3, rated_current_a: 25, range_min_a: 16, range_max_a: 25, standards: ["IEC 60947"] },
  "PROT-RCD-001": { product_type: "rccb", manufacturer: "Schneider", poles: 4, rated_current_a: 40, standards: ["IEC 60947"] },
  "PROT-SPD-001": { product_type: "spd", manufacturer: "Dehn", poles: 4 },
  "CABL-NYM-3X1.5": { product_type: "installation_cable", cores: 3, csa_mm2: 1.5, standards: ["IEC 60228"] },
  "CABL-NYM-3X2.5": { product_type: "installation_cable", cores: 3, csa_mm2: 2.5, standards: ["IEC 60228"] },
  "CABL-NYY-5X6": { product_type: "power_cable", cores: 5, csa_mm2: 6, standards: ["IEC 60228"] },
  "CABL-NYY-5X16": { product_type: "power_cable", cores: 5, csa_mm2: 16, standards: ["IEC 60228"] },
  "CABL-H07-1.5": { product_type: "control_wire", cores: 1, csa_mm2: 1.5, standards: ["IEC 60228"] },
  "CABL-H07-6YE": { product_type: "earth_wire", cores: 1, csa_mm2: 6, standards: ["IEC 60228"] },
  "CABL-SOL-6": { product_type: "solar_cable", cores: 1, csa_mm2: 6 },
  "ENC-RIT-8010": { product_type: "enclosure", manufacturer: "Rittal", ip_rating: "IP66", dimensions_mm: "800x1000x300", standards: ["IEC 60529", "IEC 61439"] },
  "ENC-SCH-6040": { product_type: "enclosure", manufacturer: "Schneider", ip_rating: "IP65", dimensions_mm: "600x400x250", standards: ["IEC 60529", "IEC 61439"] },
  "MNT-DIN-35": { product_type: "din_rail" },
  "MNT-TRUNK-4060": { product_type: "trunking" },
  "MNT-TRAY-100": { product_type: "cable_tray" },
  "CONN-TRM-2.5": { product_type: "terminal_block", manufacturer: "Phoenix Contact", csa_mm2: 2.5 },
  "CONN-TRM-10": { product_type: "terminal_block", manufacturer: "Phoenix Contact", csa_mm2: 10 },
  "CONN-WAG-221": { product_type: "connector", manufacturer: "WAGO" },
  "CONN-GLD-M20": { product_type: "cable_gland", ip_rating: "IP68", dimensions_mm: "M20" },
  "CONN-GLD-M32": { product_type: "cable_gland", ip_rating: "IP68", dimensions_mm: "M32" },
  "CONN-FER-1.5": { product_type: "ferrule", csa_mm2: 1.5 },
  "CONN-LUG-35M8": { product_type: "cable_lug", csa_mm2: 35 },
  "CONS-TIE-200": { product_type: "consumable" },
  "CONS-TAP-3M": { product_type: "consumable", manufacturer: "3M" },
  "CONS-HST-SET": { product_type: "consumable" },
  "CONS-DOW-840": { product_type: "consumable" },
};

type RawProduct = Omit<Product, "attributes" | "source">;

const SUPPLEMENT: Product[] = [
  {
    sku: "DEMO-PB-START", name: "Pushbutton 22mm Green, 1NO (Start)", category: "Operator Controls", unit: "pcs",
    purchase_price_eur: 4.0, selling_price_eur: 6.5, stock_quantity: 30, min_stock_level: 10,
    attributes: { product_type: "pushbutton", manufacturer: "DemoParts" }, source: "demo_supplement",
  },
  {
    sku: "DEMO-PB-STOP", name: "Pushbutton 22mm Red, 1NC (Stop)", category: "Operator Controls", unit: "pcs",
    purchase_price_eur: 4.0, selling_price_eur: 6.5, stock_quantity: 30, min_stock_level: 10,
    attributes: { product_type: "pushbutton", manufacturer: "DemoParts" }, source: "demo_supplement",
  },
  {
    sku: "DEMO-ESTOP", name: "Emergency Stop Mushroom 40mm, Twist Release, 2NC", category: "Operator Controls", unit: "pcs",
    purchase_price_eur: 12.0, selling_price_eur: 18.0, stock_quantity: 6, min_stock_level: 3,
    attributes: { product_type: "emergency_stop", manufacturer: "DemoParts", standards: ["IEC 60204-1", "IEC 60947"] }, source: "demo_supplement",
  },
  {
    sku: "DEMO-LAMP-RUN", name: "Pilot Light 22mm LED Green 24V", category: "Operator Controls", unit: "pcs",
    purchase_price_eur: 3.0, selling_price_eur: 5.0, stock_quantity: 4, min_stock_level: 10,
    attributes: { product_type: "pilot_light", manufacturer: "DemoParts" }, source: "demo_supplement",
  },
  {
    sku: "DEMO-VFD-15", name: "Variable Frequency Drive 15 kW 400V 3ph", category: "Drives", unit: "pcs",
    purchase_price_eur: 980.0, selling_price_eur: 1290.0, stock_quantity: 1, min_stock_level: 1,
    attributes: { product_type: "vfd", manufacturer: "DemoDrives", power_kw: 15, rated_current_a: 32, standards: ["IEC 60947"] }, source: "demo_supplement",
  },
];

export const SEED_PRODUCTS: Product[] = [
  ...(clientProducts as RawProduct[]).map((p) => ({
    ...p,
    attributes: ATTRIBUTES[p.sku] ?? { product_type: "consumable" as const },
    source: "client_dataset" as const,
  })),
  ...SUPPLEMENT,
];
