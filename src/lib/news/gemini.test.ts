import { describe, expect, it } from "vitest";
import { ApiError, type GoogleGenAI } from "@google/genai";
import { GeminiRateLimited, writeWithGemini } from "./gemini";

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
  it("reports the free-tier limit so the run can stop and resume later", async () => {
    const ai = fakeAi(() => { throw new ApiError({ message: "quota", status: 429 }); });
    await expect(writeWithGemini(ai, "guide", "prompt")).rejects.toBeInstanceOf(GeminiRateLimited);
  });
});
