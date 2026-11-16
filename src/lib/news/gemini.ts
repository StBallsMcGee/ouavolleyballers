/**
 * Writes news stories with Google's Gemini API (free tier). Gemini never reads the app or the
 * database: each request carries the player's whole fact sheet, and only the story comes back.
 *
 * Model: GEMINI_MODEL if set, otherwise the newest stable "Flash" model the key can use.
 */
import { ApiError, GoogleGenAI } from "@google/genai";
import type { NewsStory } from "@/lib/players/news";

export class GeminiRateLimited extends Error {}

let candidates: string[] | null = null;

/**
 * Models to try, best first: GEMINI_MODEL if set, then the stable Flash models this key can use
 * (newest first), then the Flash-Lite ones. When one is overloaded the next is tried.
 */
export async function geminiModels(ai: GoogleGenAI): Promise<string[]> {
  if (candidates) return candidates;
  const list: string[] = [];
  if (process.env.GEMINI_MODEL) list.push(process.env.GEMINI_MODEL);
  try {
    const pager = await ai.models.list({ config: { pageSize: 200 } });
    const names = pager.page
      .filter((m) => (m.supportedActions ?? []).includes("generateContent"))
      .map((m) => (m.name ?? "").replace(/^models\//, ""));
    const version = (n: string) => Number.parseFloat(n.split("-")[1] ?? "0");
    const pick = (re: RegExp) => names.filter((n) => re.test(n)).sort((a, b) => version(b) - version(a));
    list.push(...pick(/^gemini-\d+(\.\d+)?-flash$/), ...pick(/^gemini-\d+(\.\d+)?-flash-lite$/));
  } catch {
    // Listing failed: use known names.
  }
  if (!list.length) list.push("gemini-2.5-flash", "gemini-2.5-flash-lite");
  candidates = [...new Set(list)];
  return candidates;
}

/** Forget the model list (tests). */
export function resetGeminiModels(): void {
  candidates = null;
}

/** The model the next story will use first (for reporting). */
export async function pickGeminiModel(ai: GoogleGenAI): Promise<string> {
  return (await geminiModels(ai))[0]!;
}

const STORY_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string", description: "Under 10 words." },
    paragraphs: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 4 },
  },
  required: ["headline", "paragraphs"],
};

const timedOut = (e: unknown) => e instanceof Error && /abort|timeout|timed out/i.test(`${e.name} ${e.message}`);
const overloaded = (e: unknown) => e instanceof ApiError && (e.status === 503 || e.status === 500 || e.status === 504);

/** How long one request may take before it's abandoned. */
export const GEMINI_REQUEST_MS = 15_000;

export async function writeWithGemini(ai: GoogleGenAI, styleGuide: string, prompt: string, deadline = Infinity): Promise<NewsStory | null> {
  const models = await geminiModels(ai);
  let lastError: unknown = null;
  // Each model gets two tries (a short pause between); an overloaded model hands over to the next.
  // Nothing starts that couldn't finish before the deadline.
  for (const model of models.slice(0, 3)) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (Date.now() + GEMINI_REQUEST_MS > deadline) throw new GeminiRateLimited("Out of time for this run; will continue on the next run");
      try {
        return await writeOnce(ai, model, styleGuide, prompt);
      } catch (e) {
        if (!overloaded(e) && !timedOut(e)) throw e;
        lastError = e;
        if (attempt === 0) await new Promise((r) => setTimeout(r, 2500));
      }
    }
  }
  throw lastError;
}

async function writeOnce(ai: GoogleGenAI, model: string, styleGuide: string, prompt: string): Promise<NewsStory | null> {
  try {
    const res = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        systemInstruction: styleGuide,
        responseMimeType: "application/json",
        responseJsonSchema: STORY_SCHEMA,
        temperature: 1,
        maxOutputTokens: 4000,
        // One attempt per call (this file does its own retries and model fallback), and a time limit.
        httpOptions: { timeout: GEMINI_REQUEST_MS, retryOptions: { attempts: 1 } },
      },
    });
    const text = res.text;
    if (!text) return null;
    const out = JSON.parse(text) as { headline?: unknown; paragraphs?: unknown };
    if (typeof out.headline !== "string" || !Array.isArray(out.paragraphs)) return null;
    const paragraphs = out.paragraphs.filter((p): p is string => typeof p === "string" && p.trim() !== "").map((p) => p.trim());
    if (!out.headline.trim() || paragraphs.length === 0) return null;
    return { headline: out.headline.trim(), paragraphs };
  } catch (e) {
    if (e instanceof ApiError && e.status === 429) throw new GeminiRateLimited("Gemini free-tier limit reached; will continue on the next run");
    if (e instanceof SyntaxError) return null; // not valid JSON: skip this one
    throw e;
  }
}
