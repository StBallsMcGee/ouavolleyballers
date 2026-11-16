import { describe, expect, it } from "vitest";
import { ApiError, type GoogleGenAI } from "@google/genai";
import { GeminiRateLimited, resetGeminiModels, writeWithGemini } from "./gemini";

process.env.GEMINI_MODEL = "test-model";
const fakeAi = (reply: () => unknown) => ({ models: { generateContent: async () => reply() } }) as unknown as GoogleGenAI;

describe("writeWithGemini", () => {
  it("reads the story from Gemini's JSON reply", async () => {
    const s = await writeWithGemini(fakeAi(() => ({ text: JSON.stringify({ headline: " Five-set grit ", paragraphs: ["One.", "", "Two."] }) })), "guide", "prompt");
    expect(s).toEqual({ headline: "Five-set grit", paragraphs: ["One.", "Two."] });
  });
  it("skips a reply that isn't a story", async () => {
    expect(await writeWithGemini(fakeAi(() => ({ text: "not json" })), "guide", "prompt")).toBeNull();
    expect(await writeWithGemini(fakeAi(() => ({ text: JSON.stringify({ headline: "x" }) })), "guide", "prompt")).toBeNull();
  });
  it("reports the free-tier limit (once every model is at it) so the run can stop and resume later", async () => {
    const ai = fakeAi(() => { throw new ApiError({ message: "Quota exceeded for metric: requests per day", status: 429 }); });
    const err = await writeWithGemini(ai, "guide", "prompt").catch((e) => e);
    expect(err).toBeInstanceOf(GeminiRateLimited);
    expect(String(err.message)).toMatch(/per day/);
  });
});

describe("writeWithGemini when a model is overloaded", () => {
  it("moves on to the next model", async () => {
    const used: string[] = [];
    const ai = { models: {
      list: async () => ({ page: [
        { name: "models/gemini-9-flash", supportedActions: ["generateContent"] },
        { name: "models/gemini-9-flash-lite", supportedActions: ["generateContent"] },
      ] }),
      generateContent: async ({ model }: { model: string }) => {
        used.push(model);
        if (model === "gemini-9-flash") throw new ApiError({ message: "high demand", status: 503 });
        return { text: JSON.stringify({ headline: "Fine", paragraphs: ["Ok."] }) };
      },
    } } as unknown as GoogleGenAI;
    delete process.env.GEMINI_MODEL;
    resetGeminiModels();
    const s = await writeWithGemini(ai, "g", "p");
    expect(s?.headline).toBe("Fine");
    expect(used).toEqual(["gemini-9-flash", "gemini-9-flash", "gemini-9-flash-lite"]);
  }, 10_000);
});
