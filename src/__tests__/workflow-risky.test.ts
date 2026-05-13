/**
 * Risky-instruction keyword detector. Pure function — no DB.
 */
import { describe, it, expect } from "vitest";
import { detectRiskyInstructions, RISKY_KEYWORDS } from "@/lib/workflow-risky";

describe("detectRiskyInstructions", () => {
  it("detects outbound communication", () => {
    expect(detectRiskyInstructions("Send email to the new lead")).toBe(true);
    expect(detectRiskyInstructions("Post to Slack with the recap")).toBe(true);
    expect(detectRiskyInstructions("Tweet the announcement")).toBe(true);
  });

  it("detects destructive operations", () => {
    expect(detectRiskyInstructions("Delete the old records")).toBe(true);
    expect(detectRiskyInstructions("Run a drop table on test_users")).toBe(true);
    expect(detectRiskyInstructions("rm -rf the temp dir")).toBe(true);
  });

  it("detects deployment / production", () => {
    expect(detectRiskyInstructions("Deploy the new model")).toBe(true);
    expect(detectRiskyInstructions("git push to origin")).toBe(true);
    expect(detectRiskyInstructions("Merge to main")).toBe(true);
    expect(detectRiskyInstructions("Modify the production setting")).toBe(true);
  });

  it("detects financial actions", () => {
    expect(detectRiskyInstructions("Charge the customer card")).toBe(true);
    expect(detectRiskyInstructions("Issue a refund")).toBe(true);
    expect(detectRiskyInstructions("Pay the vendor invoice")).toBe(true);
  });

  it("ignores safe instructions", () => {
    expect(detectRiskyInstructions("Summarize the brief")).toBe(false);
    expect(detectRiskyInstructions("Translate the doc to French")).toBe(false);
    expect(detectRiskyInstructions("Categorize the support ticket")).toBe(false);
  });

  it("handles empty / null", () => {
    expect(detectRiskyInstructions(null)).toBe(false);
    expect(detectRiskyInstructions(undefined)).toBe(false);
    expect(detectRiskyInstructions("")).toBe(false);
  });

  it("does not trigger on partial-word matches", () => {
    // "deletion" contains "delete" but as a substring; whole-word regex
    // should NOT fire on "deletion" alone — but the phrase keyword
    // "delete" itself matches if standalone.
    expect(detectRiskyInstructions("Discuss the deletion policy")).toBe(false);
    expect(detectRiskyInstructions("delete it")).toBe(true);
  });

  it("exports the keyword list", () => {
    expect(RISKY_KEYWORDS.length).toBeGreaterThan(10);
    expect(RISKY_KEYWORDS).toContain("delete");
    expect(RISKY_KEYWORDS).toContain("send email");
  });
});
