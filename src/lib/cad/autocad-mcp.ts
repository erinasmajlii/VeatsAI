import "server-only";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
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
