import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { ApiError, GoogleGenAI } from "@google/genai";
import Groq from "groq-sdk";
import { z } from "zod";
import { findMissing } from "../engineering/inputs";
import type { RequestAnalysis } from "../types";
import { ruleBasedExtract } from "./fallback-parser";
import { AiExtractionSchema, validateExtraction, type AiExtraction } from "./schema";

/**
 * AI Agent — request understanding.
 *
 * The LLM ONLY interprets the client's natural-language request into structured JSON.
 * It never performs engineering math; that is done deterministically by /lib/engineering.
 *
 * Providers (server-side keys only, never exposed to the browser):
 *   - Groq            — GROQ_API_KEY          (model: GROQ_MODEL, default openai/gpt-oss-120b)
 *   - Google Gemini   — GEMINI_API_KEY        (model: GEMINI_MODEL, default gemini-3.8-flash)
 *   - Anthropic Claude — AI_API_KEY / ANTHROPIC_API_KEY (model: AI_MODEL, default claude-opus-5-5)
 * AI_PROVIDER=groq|gemini|anthropic forces one; otherwise the first configured key wins in that order.
 */

type Provider = "groq" | "gemini" | "anthropic";

const GROQ_KEY = () => process.env.GROQ_API_KEY;
const GEMINI_KEY = () => process.env.GEMINI_API_KEY;
const ANTHROPIC_KEY = () => process.env.AI_API_KEY || process.env.ANTHROPIC_API_KEY;
const KEYS: Record<Provider, () => string | undefined> = { groq: GROQ_KEY, gemini: GEMINI_KEY, anthropic: ANTHROPIC_KEY };

export function aiProvider(): Provider | null {
  const forced = process.env.AI_PROVIDER as Provider | undefined;
  if (forced && KEYS[forced]?.()) return forced;
  return (["groq", "gemini", "anthropic"] as const).find((p) => KEYS[p]()) ?? null;
}

export function aiModel(): string | null {
  const p = aiProvider();
  if (p === "groq") return process.env.GROQ_MODEL || "openai/gpt-oss-120b";
  if (p === "gemini") return process.env.GEMINI_MODEL || "gemini-3.8-flash";
  if (p === "anthropic") return process.env.AI_MODEL || "claude-opus-5-5";
  return null;
}

export function aiConfigured(): boolean {
  return aiProvider() !== null;
}

export class AIAnalysisError extends Error {
  constructor(
    message: string,
    public detail?: string,
  ) {
    super(message);
  }
}

const FAILED = "AI analysis failed. Please retry.";

const SYSTEM_PROMPT = `You are the request-understanding component of VeatsAI, an engineering platform used by companies that design and build low-voltage electrical systems (motor control panels, distribution boards).

Your only job is to convert a client's natural-language request (it may be in English or Albanian) into structured JSON. Downstream, a deterministic engineering engine performs all calculations and a licensed engineer reviews every result, so accuracy of extraction matters more than completeness.

Rules:
- Extract only what the client actually stated. If a value is not stated, return null. Never fill in typical or default values (e.g. do not assume 400 V, 50 Hz, DOL starting, or an environment) — the engine handles defaults visibly.
- motors: one entry per distinct motor rating. "3 motors of 15 kW each" → [{quantity: 3, power_kw: 15}]. "2×7.5 kW and one 22 kW" → two entries. Convert HP to kW only if the client gives HP (1 HP = 0.746 kW) and mention the conversion in notes. Use label for a stated name (e.g. "Pump"), else null.
- voltage in volts (0.4 kV → 400). frequency in Hz. phases 1 or 3 only if stated.
- starting_method: DOL (direct-on-line), STAR_DELTA, SOFT_STARTER, or VFD (inverter / frequency converter / variable speed) — only if stated.
- environment: indoor_clean, indoor_dusty, outdoor, wet_washdown — only if the client describes the installation location/conditions.
- installation_method of motor cables: conduit_on_wall, cable_tray, buried, in_free_air — only if stated.
- cable_length_m: motor cable length in metres if stated. short_circuit_current_ka: prospective fault level if stated.
- standards: standards the client explicitly mentions (e.g. "IEC 60204-1").
- project_title: short professional title, e.g. "Motor Control Panel — 3 × 15 kW".
- notes: short observations useful to the engineer (ambiguities, conversions, special requirements). Do not perform calculations.
- missing_information: list the field keys that are null and matter for the design, choosing from: motors, voltage, starting_method, cable_length_m, environment, installation_method, ambient_temperature_c, short_circuit_current_ka.`;

function userContent(request: string, previousError?: string) {
  const body = previousError
    ? `${request}\n\n(Your previous output failed validation: ${previousError}. Return corrected JSON; use null for anything not stated.)`
    : request;
  return `Client request:\n"""\n${body}\n"""`;
}

function toAnalysis(x: AiExtraction, source: RequestAnalysis["source"], model?: string): RequestAnalysis {
  // Missing information is recomputed deterministically and merged with the model's own list.
  const det = findMissing(x);
  const missing = Array.from(new Set([...det.critical, ...det.recommended, ...x.missing_information.filter((f) => det.critical.includes(f) || det.recommended.includes(f))]));
  return { ...x, missing_information: missing, source, ...(model ? { model } : {}) };
}

// ------------------------------------------------------------------ Gemini

const JSON_SCHEMA = (() => {
  const s = z.toJSONSchema(AiExtractionSchema) as Record<string, unknown>;
  delete s.$schema;
  return s;
})();

async function callGemini(request: string, previousError?: string): Promise<unknown> {
  const ai = new GoogleGenAI({ apiKey: GEMINI_KEY()! });
  let res;
  try {
    res = await ai.models.generateContent({
      model: aiModel()!,
      contents: userContent(request, previousError),
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: "application/json",
        responseJsonSchema: JSON_SCHEMA,
        temperature: 0,
      },
    });
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 401 || err.status === 403) throw new AIAnalysisError(FAILED, `Gemini access denied (${err.status}) — check the GEMINI_API_KEY project in Google AI Studio.`);
      if (err.status === 429) throw new AIAnalysisError(FAILED, "AI rate limit / quota reached.");
      throw new AIAnalysisError(FAILED, `AI service error (${err.status}).`);
    }
    throw new AIAnalysisError(FAILED, "Could not reach the AI service.");
  }
  const text = res.text;
  if (!text) throw new RetryableError("Empty response from model.");
  try {
    return JSON.parse(text);
  } catch {
    throw new RetryableError("Model returned invalid JSON.");
  }
}

// -------------------------------------------------------------------- Groq

async function callGroq(request: string, previousError?: string): Promise<unknown> {
  const client = new Groq({ apiKey: GROQ_KEY(), maxRetries: 2, timeout: 60_000 });
  let res;
  try {
    res = await client.chat.completions.create({
      model: aiModel()!,
      temperature: 0,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent(request, previousError) },
      ],
      response_format: { type: "json_schema", json_schema: { name: "request_analysis", schema: JSON_SCHEMA } },
    });
  } catch (err) {
    if (err instanceof Groq.AuthenticationError || err instanceof Groq.PermissionDeniedError) throw new AIAnalysisError(FAILED, "Groq API key rejected — check GROQ_API_KEY.");
    if (err instanceof Groq.RateLimitError) throw new AIAnalysisError(FAILED, "AI rate limit reached — wait a moment and retry.");
    if (err instanceof Groq.BadRequestError) throw new RetryableError(`Model output rejected: ${err.message.slice(0, 200)}`);
    if (err instanceof Groq.APIConnectionError) throw new AIAnalysisError(FAILED, "Could not reach the AI service.");
    if (err instanceof Groq.APIError) throw new AIAnalysisError(FAILED, `AI service error (${err.status}).`);
    throw new AIAnalysisError(FAILED, err instanceof Error ? err.message : String(err));
  }
  const text = res.choices[0]?.message?.content;
  if (!text) throw new RetryableError("Empty response from model.");
  try {
    return JSON.parse(text);
  } catch {
    throw new RetryableError("Model returned invalid JSON.");
  }
}

// --------------------------------------------------------------- Anthropic

async function callAnthropic(request: string, previousError?: string): Promise<unknown> {
  const client = new Anthropic({ apiKey: ANTHROPIC_KEY(), maxRetries: 2, timeout: 60_000 });
  let response;
  try {
    response = await client.messages.parse({
      model: aiModel()!,
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent(request, previousError) }],
      output_config: { format: zodOutputFormat(AiExtractionSchema), effort: "low" },
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new AIAnalysisError(FAILED, "AI API key rejected — check AI_API_KEY.");
    if (err instanceof Anthropic.RateLimitError) throw new AIAnalysisError(FAILED, "AI rate limit reached.");
    if (err instanceof Anthropic.APIConnectionError) throw new AIAnalysisError(FAILED, "Could not reach the AI service.");
    if (err instanceof Anthropic.APIError) throw new AIAnalysisError(FAILED, `AI service error (${err.status}).`);
    throw new RetryableError(err instanceof Error ? err.message : String(err));
  }
  if (response.stop_reason === "refusal") throw new RetryableError("Model declined the request.");
  if (response.stop_reason === "max_tokens") throw new RetryableError("Output truncated.");
  if (!response.parsed_output) throw new RetryableError("No structured output returned.");
  return response.parsed_output;
}

/** Errors worth one more attempt (bad/empty JSON, truncation). API/auth errors are not retried here. */
class RetryableError extends Error {}

// ------------------------------------------------------------------ entry

export async function analyzeRequest(request: string, opts: { mode?: "auto" | "rule_based" } = {}): Promise<RequestAnalysis> {
  const text = request.trim();
  if (text.length < 5) throw new AIAnalysisError("Please describe the electrical project.");

  const provider = aiProvider();
  if (opts.mode === "rule_based" || !provider) {
    const parsed = validateExtraction(ruleBasedExtract(text));
    if (!parsed.success) throw new AIAnalysisError("Could not interpret the request. Please rephrase.", parsed.error.message);
    return toAnalysis(parsed.data, "rule_based_fallback");
  }

  const call = provider === "groq" ? callGroq : provider === "gemini" ? callGemini : callAnthropic;
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await call(text, lastError || undefined);
      // Never trust LLM JSON blindly: schema + engineering plausibility validation.
      const valid = validateExtraction(raw);
      if (valid.success) return toAnalysis(valid.data, "ai", aiModel()!);
      lastError = valid.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    } catch (err) {
      if (err instanceof RetryableError) {
        lastError = err.message;
        continue;
      }
      throw err;
    }
  }
  throw new AIAnalysisError(FAILED, `AI output failed validation: ${lastError}`);
}
