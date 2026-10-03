import type { AiExtraction } from "./schema";

/**
 * Rule-based parser — used ONLY when no AI key is configured or when the engineer
 * explicitly chooses it after an AI failure. It is clearly labelled in the UI.
 * It extracts only what is literally present in the text and never guesses.
 */
export function ruleBasedExtract(text: string): AiExtraction {
  const t = text.toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ");
  const num = (s: string) => Number(s.replace(",", "."));

  // Motors: "3 x 15 kW", "3 motors ... 15 kW", "3 motorë 15kW", "a 22 kW motor"
  const motors: AiExtraction["motors"] = [];
  const nxp = [...t.matchAll(/(\d+)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*kw/g)];
  if (nxp.length) {
    for (const m of nxp) motors.push({ quantity: num(m[1]), power_kw: num(m[2]), label: null });
  } else {
    const qty = t.match(/(\d+)\s*(?:motor\w*|pump\w*|fan\w*|compressor\w*|conveyor\w*)/);
    const kws = [...t.matchAll(/(\d+(?:[.,]\d+)?)\s*kw/g)];
    if (kws.length === 1) motors.push({ quantity: qty ? num(qty[1]) : 1, power_kw: num(kws[0][1]), label: null });
    else for (const k of kws) motors.push({ quantity: 1, power_kw: num(k[1]), label: null });
  }

  const kv = t.match(/(\d+(?:[.,]\d+)?)\s*kv\b/);
  const v = t.match(/(\d{3,4})\s*v(?:olt\w*|ac)?\b/);
  const voltage = v ? num(v[1]) : kv ? num(kv[1]) * 1000 : null;
  const hz = t.match(/\b(50|60)\s*hz/);
  const len = t.match(/(\d+(?:[.,]\d+)?)\s*(?:m|meter\w*|metre\w*|metra|metër)\b/);
  const isc = t.match(/(\d+(?:[.,]\d+)?)\s*ka\b/);
  const amb = t.match(/(-?\d+)\s*°?\s*c\b/);

  const starting_method: AiExtraction["starting_method"] = /star.?delta|y.?(?:Δ|d)\b|yll.?trekënd/.test(t)
    ? "STAR_DELTA"
    : /soft.?start/.test(t)
      ? "SOFT_STARTER"
      : /\bvfd\b|inverter|frequency drive|variable speed|frequency converter/.test(t)
        ? "VFD"
        : /\bdol\b|direct.?on.?line|direct start/.test(t)
          ? "DOL"
          : null;

  const environment: AiExtraction["environment"] = /wash.?down|\bwet\b/.test(t)
    ? "wet_washdown"
    : /outdoor|outside|jashtë/.test(t)
      ? "outdoor"
      : /dust|industrial/.test(t)
        ? "indoor_dusty"
        : /indoor|inside|brenda/.test(t)
          ? "indoor_clean"
          : null;

  const installation_method: AiExtraction["installation_method"] = /tray/.test(t)
    ? "cable_tray"
    : /buried|underground/.test(t)
      ? "buried"
      : /conduit/.test(t)
        ? "conduit_on_wall"
        : /free air/.test(t)
          ? "in_free_air"
          : null;

  const missing: string[] = [];
  if (!motors.length) missing.push("motors");
  if (!voltage) missing.push("voltage");
  if (!starting_method) missing.push("starting_method");
  if (!len) missing.push("cable_length_m");
  if (!environment) missing.push("environment");

  return {
    project_type: motors.length ? "motor_control_panel" : "other",
    project_title: motors.length ? `Motor Control Panel — ${motors.map((m) => `${m.quantity}×${m.power_kw} kW`).join(", ")}` : "Electrical project",
    client_name: null,
    motors,
    voltage,
    frequency: hz ? num(hz[1]) : null,
    phases: /3\s*ph|three.?phase|trifaz/.test(t) ? 3 : /single.?phase|1\s*ph|njëfaz/.test(t) ? 1 : null,
    starting_method,
    cable_length_m: len ? num(len[1]) : null,
    environment,
    installation_method,
    ambient_temperature_c: amb && /ambient|temperatur/.test(t) ? num(amb[1]) : null,
    short_circuit_current_ka: isc ? num(isc[1]) : null,
    standards: /\biec\b/.test(t) ? ["IEC"] : [],
    notes: ["Parsed by rule-based fallback (no AI). Verify all extracted values."],
    missing_information: missing,
  };
}
