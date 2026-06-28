import { describe, expect, it } from "vitest";
import { buildDiscussionPrompt } from "./ChatWorkspace";

describe("buildDiscussionPrompt", () => {
  it("asks the first speaker to open the discussion (no transcript)", () => {
    const prompt = buildDiscussionPrompt("Is AI conscious?", [], "Gemini");
    expect(prompt).toContain("Is AI conscious?");
    expect(prompt).toContain("Gemini");
    expect(prompt).toContain("speaking first");
    // No prior turns referenced.
    expect(prompt).not.toContain("Discussion so far");
  });

  it("embeds the running transcript for later speakers", () => {
    const transcript = [
      { speaker: "Gemini", text: "I think yes, because X." },
      { speaker: "ChatGPT", text: "I disagree, because Y." }
    ];
    const prompt = buildDiscussionPrompt("Is AI conscious?", transcript, "Claude");

    expect(prompt).toContain("Discussion so far");
    expect(prompt).toContain("### Gemini");
    expect(prompt).toContain("I think yes, because X.");
    expect(prompt).toContain("### ChatGPT");
    expect(prompt).toContain("I disagree, because Y.");
    // Current speaker is instructed to continue as themselves.
    expect(prompt).toContain("As Claude, continue the discussion");
  });
});
