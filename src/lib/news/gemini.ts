/**
 * Writes news stories with Google's Gemini API (free tier). Gemini never reads the app or the
 * database: each request carries the player's whole fact sheet, and only the story comes back.
 *
 * Model: GEMINI_MODEL if set, otherwise the newest stable "Flash" model the key can use.
 */
import { ApiError, GoogleGenAI } from "@google/genai";
import type { NewsStory } from "@/lib/players/news";

export class GeminiRateLimited extends Error {}

let chosenModel: string | null = null;

/** The newest stable Flash text model available to this key (falls back to a known name). */
export async function pickGeminiModel(ai: GoogleGenAI): Promise<string> {
  if (process.env.GEMINI_MODEL) return process.env.GEMINI_MODEL;
  if (chosenModel) return chosenModel;
  let best = "gemini-2.5-flash";
  try {
    const pager = await ai.models.list({ config: { pageSize: 200 } });
    const names = pager.page
      .filter((m) => (m.supportedActions ?? []).includes("generateContent"))
      .map((m) => (m.name ?? "").replace(/^models\//, ""))
      .filter((n) => /^gemini-\d+(\.\d+)?-flash$/.test(n)); // stable Flash only: no lite, preview, image or audio variants
    const version = (n: string) => Number.parseFloat(n.split("-")[1] ?? "0");
    names.sort((a, b) => version(b) - version(a));
    if (names[0]) best = names[0];
  } catch {
    // Listing failed: use the known name.
  }
  chosenModel = best;
  return best;
}

const STORY_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string", description: "Under 10 words." },
    paragraphs: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 4 },
  },
  required: ["headline", "paragraphs"],
};

export async function writeWithGemini(ai: GoogleGenAI, styleGuide: string, prompt: string): Promise<NewsStory | null> {
  const model = await pickGeminiModel(ai);
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
