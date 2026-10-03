import type { Environment, InstallationMethod, StartingMethod } from "../types";

/**
 * Engineering constants used by the deterministic engine.
 * All values are visible in the UI (Standards / Settings) and are preliminary reference data.
 * They must be verified against the applicable standard tables and manufacturer data.
 */

export const DEFAULTS = {
  frequency_hz: 50,
  phases: 3,
  power_factor: 0.85,
  efficiency: 0.9,
  ambient_temperature_c: 30,
  max_voltage_drop_pct: 5,
  diversity_factor: 1.0,
  copper_resistivity_ohm_mm2_per_m: 0.0225, // copper at approx. operating temperature
};

/** Standard protective device ratings (A). */
export const STANDARD_RATINGS_A = [6, 10, 13, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630];

/** IEC 60228 nominal cross-section series (mm²). */
export const CONDUCTOR_SIZES_MM2 = [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120];

/** Typical starting current multipliers relative to FLC (configurable reference values). */
export const STARTING_MULTIPLIER: Record<StartingMethod, number> = {
  DOL: 7,
  STAR_DELTA: 2.5,
  SOFT_STARTER: 3.5,
  VFD: 1.2,
};

export const STARTING_METHOD_LABEL: Record<StartingMethod, string> = {
  DOL: "Direct-on-line (DOL)",
  STAR_DELTA: "Star-Delta",
  SOFT_STARTER: "Soft starter",
  VFD: "Variable frequency drive (VFD)",
};

export const ENVIRONMENT_LABEL: Record<Environment, string> = {
  indoor_clean: "Indoor, clean",
  indoor_dusty: "Indoor, dusty / industrial",
  outdoor: "Outdoor",
  wet_washdown: "Wet / washdown",
};

/** Environment → minimum enclosure IP rating (IEC 60529 IP code; mapping is a configurable company rule). */
export const ENVIRONMENT_MIN_IP: Record<Environment, string> = {
  indoor_clean: "IP54",
  indoor_dusty: "IP55",
  outdoor: "IP65",
  wet_washdown: "IP66",
};

export const INSTALLATION_LABEL: Record<InstallationMethod, string> = {
  conduit_on_wall: "Multicore cable in conduit on wall",
  cable_tray: "Multicore cable on perforated tray",
  buried: "Buried in ducts",
  in_free_air: "In free air",
};

/**
 * Indicative current-carrying capacity (A) for multicore copper PVC-insulated cables,
 * three loaded conductors, 30 °C ambient, by reference installation type.
 * Reference values only — verify against IEC 60364-5-52 tables for the actual installation.
 */
export const AMPACITY_TABLE_A: Record<InstallationMethod, Record<number, number>> = {
  conduit_on_wall: { 1.5: 15, 2.5: 20, 4: 27, 6: 34, 10: 46, 16: 62, 25: 80, 35: 99, 50: 118, 70: 149, 95: 179, 120: 206 },
  cable_tray: { 1.5: 18.5, 2.5: 25, 4: 34, 6: 43, 10: 60, 16: 80, 25: 101, 35: 126, 50: 153, 70: 196, 95: 238, 120: 276 },
  buried: { 1.5: 18, 2.5: 24, 4: 31, 6: 39, 10: 52, 16: 67, 25: 86, 35: 103, 50: 122, 70: 151, 95: 179, 120: 203 },
  in_free_air: { 1.5: 18.5, 2.5: 25, 4: 34, 6: 43, 10: 60, 16: 80, 25: 101, 35: 126, 50: 153, 70: 196, 95: 238, 120: 276 },
};

/** Conservative reference installation assumed when the method is not specified. */
export const ASSUMED_INSTALLATION: InstallationMethod = "conduit_on_wall";

/** Indicative ambient-temperature correction factors for PVC insulation (reference 30 °C). */
export const AMBIENT_CORRECTION_PVC: [number, number][] = [
  [10, 1.22], [15, 1.17], [20, 1.12], [25, 1.06], [30, 1.0], [35, 0.94], [40, 0.87], [45, 0.79], [50, 0.71], [55, 0.61], [60, 0.5],
];
