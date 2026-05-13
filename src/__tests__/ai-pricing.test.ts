import { describe, it, expect } from "vitest";
import { estimateCostUsd, AI_PRICING } from "@/lib/ai-pricing";

describe("estimateCostUsd", () => {
  it("returns null/unknown when provider missing", () => {
    const r = estimateCostUsd(null, "sonnet", 1000, 1000);
    expect(r.cost).toBeNull();
    expect(r.known).toBe(false);
  });

  it("returns null/unknown when model missing", () => {
    const r = estimateCostUsd("claude", null, 1000, 1000);
    expect(r.cost).toBeNull();
    expect(r.known).toBe(false);
  });

  it("returns null/unknown for unknown provider/model combo", () => {
    const r = estimateCostUsd("claude", "fictional-model-xyz", 1000, 1000);
    expect(r.cost).toBeNull();
    expect(r.known).toBe(false);
  });

  it("computes cost for known model", () => {
    // sonnet is $3/M input + $15/M output. 1M in + 1M out = $3 + $15 = $18.
    const r = estimateCostUsd("claude", "sonnet", 1_000_000, 1_000_000);
    expect(r.known).toBe(true);
    expect(r.cost).toBeCloseTo(18, 5);
  });

  it("scales linearly with tokens", () => {
    // 100k input on sonnet = 0.1 * $3 = $0.30
    const r = estimateCostUsd("claude", "sonnet", 100_000, 0);
    expect(r.known).toBe(true);
    expect(r.cost).toBeCloseTo(0.3, 5);
  });

  it("returns zero cost for zero tokens with known model", () => {
    const r = estimateCostUsd("claude", "sonnet", 0, 0);
    expect(r.known).toBe(true);
    expect(r.cost).toBe(0);
  });

  it("AI_PRICING contains expected providers", () => {
    expect(AI_PRICING.claude).toBeDefined();
    expect(AI_PRICING.codex).toBeDefined();
    expect(AI_PRICING.gemini).toBeDefined();
  });
});
