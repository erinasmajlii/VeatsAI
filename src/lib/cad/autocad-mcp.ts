import "server-only";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { spawn } from "child_process";
import os from "os";
import path from "path";
import { dataDir } from "../data-dir";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CadContract } from "../types";

/**
 * AutoCAD Electrical integration over MCP.
 *
 * VeatsAI (server-side) → MCP client → integrations/autocad-mcp/server.py (--http) → COM → AutoCAD Electrical.
 * The MCP server must run on the same Windows machine as AutoCAD. Default URL: http://127.0.0.1:8765/mcp
 */

export const AUTOCAD_MCP_URL = process.env.AUTOCAD_MCP_URL || "http://127.0.0.1:8765/mcp";

export class AutocadUnavailableError extends Error {}

async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ name: "veatsai-web", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(AUTOCAD_MCP_URL));
  try {
    await client.connect(transport);
  } catch {
    throw new AutocadUnavailableError(
      `AutoCAD MCP server not reachable at ${AUTOCAD_MCP_URL}. Start it with: integrations/autocad-mcp/start.ps1`,
    );
  }
  try {
    return await fn(client);
  } finally {
    await client.close().catch(() => {});
  }
}

/** Calls an MCP tool and returns its structured (or JSON text) result; throws on tool errors. */
async function callTool<T>(name: string, args: Record<string, unknown>, timeoutMs: number): Promise<T> {
  return withClient(async (client) => {
    const res = await client.callTool({ name, arguments: args }, undefined, { timeout: timeoutMs });
    const text = Array.isArray(res.content)
      ? res.content.map((c) => (c && typeof c === "object" && "text" in c ? String(c.text) : "")).join("\n")
      : "";
    if (res.isError) throw new Error(text || `AutoCAD tool ${name} failed.`);
    if (res.structuredContent) {
      const sc = res.structuredContent as Record<string, unknown>;
      return ("result" in sc && Object.keys(sc).length === 1 ? sc.result : sc) as T;
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  });
}

export interface AutocadStatus {
  running: boolean;
  product?: string;
  version?: string;
  electrical_toolset_loaded?: boolean;
  open_drawings?: string[];
  output_dir?: string;
  message?: string;
}

export interface AutocadDrawResult {
  dwg_path: string;
  drawing: string;
  symbols_inserted: number;
  feeders_drawn: number;
  feeders_total: number;
  note: string;
}

export function autocadStatus(): Promise<AutocadStatus> {
  return callTool<AutocadStatus>("autocad_status", {}, 15_000);
}

export function drawInAutocad(contract: CadContract): Promise<AutocadDrawResult> {
  // Symbol insertion is sequential in AutoCAD — allow time for larger panels.
  return callTool<AutocadDrawResult>("draw_motor_panel_schematic", { contract }, 180_000);
}

// ------------------------------------------------------------------ files: output folder, open, convert

/** Where generated CAD files are written — the same folder the MCP server may open from. */
export function cadOutputDir(): string {
  return process.env.VEATS_CAD_OUTPUT || path.join(os.homedir(), "Documents", "VeatsAI", "drawings");
}
/** Where uploaded plans are stored (the MCP server may read DWG files from here for conversion). */
export function uploadsDir(): string {
  return process.env.VEATS_UPLOAD_DIR || path.join(dataDir(), "uploads");
}

export interface OpenResult {
  method: "autocad-mcp" | "os-default";
  dwg_path?: string;
  note: string;
}

function osOpen(file: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const [cmd, args]: [string, string[]] =
      process.platform === "win32" ? ["cmd.exe", ["/c", "start", "", file]] : process.platform === "darwin" ? ["open", [file]] : ["xdg-open", [file]];
    const child = spawn(/*turbopackIgnore: true*/ cmd, args, { detached: true, stdio: "ignore", windowsHide: true });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

/**
 * Opens a generated drawing in AutoCAD. Preferred: the AutoCAD MCP service (brings the drawing to the front of the
 * running AutoCAD and keeps a DWG copy). Fallback: the operating system's default application for the file type.
 * Only files inside the CAD output folder can be opened.
 */
export async function openInAutocad(file: string): Promise<OpenResult> {
  const resolved = path.resolve(/*turbopackIgnore: true*/ file);
  const root = path.resolve(/*turbopackIgnore: true*/ cadOutputDir());
  if (!resolved.startsWith(root + path.sep)) throw new Error("The file is outside the VeatsAI drawings folder.");
  try {
    const r = await callTool<{ opened: string; dwg_path?: string; already_open?: boolean }>("open_drawing", { path: resolved, save_as_dwg: true }, 120_000);
    return { method: "autocad-mcp", dwg_path: r.dwg_path, note: r.already_open ? "The drawing was already open in AutoCAD." : "Opened in AutoCAD." };
  } catch (err) {
    if (!(err instanceof AutocadUnavailableError)) throw err;
  }
  await osOpen(resolved);
  return { method: "os-default", note: "Opened with the default application for DXF files (the AutoCAD service is not running)." };
}

/** Converts an uploaded DWG (or binary DXF) to ASCII DXF through AutoCAD. Returns the converted file path. */
export async function convertToDxf(file: string): Promise<string> {
  const r = await callTool<{ dxf_path: string }>("convert_to_dxf", { path: path.resolve(file) }, 180_000);
  return r.dxf_path;
}
