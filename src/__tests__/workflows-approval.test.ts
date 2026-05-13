/**
 * Pure approval-decision matrix. Verifies that the autonomy level + step
 * properties drive the correct before/after-step gate outcomes.
 */
import { describe, it, expect } from "vitest";
import { requiresBeforeApproval, requiresAfterApproval } from "@/lib/db/workflow-helpers";

function step(overrides: Partial<{ approval_type: "none" | "before_step" | "after_step"; requires_human_approval: boolean | number; risky: boolean | number }> = {}) {
  return {
    approval_type: "none" as const,
    requires_human_approval: 0,
    risky: 0,
    ...overrides,
  };
}

describe("requiresBeforeApproval", () => {
  it("manual autonomy → every step pauses before", () => {
    expect(requiresBeforeApproval(step(), { autonomy_level: "manual" })).toBe(true);
    expect(requiresBeforeApproval(step({ approval_type: "none" }), { autonomy_level: "manual" })).toBe(true);
  });

  it("supervised autonomy → pause only if risky / requires / before_step", () => {
    expect(requiresBeforeApproval(step(), { autonomy_level: "supervised" })).toBe(false);
    expect(requiresBeforeApproval(step({ risky: 1 }), { autonomy_level: "supervised" })).toBe(true);
    expect(requiresBeforeApproval(step({ requires_human_approval: 1 }), { autonomy_level: "supervised" })).toBe(true);
    expect(requiresBeforeApproval(step({ approval_type: "before_step" }), { autonomy_level: "supervised" })).toBe(true);
  });

  it("autonomous autonomy → pause only if both before_step AND requires_human_approval", () => {
    expect(requiresBeforeApproval(step({ risky: 1 }), { autonomy_level: "autonomous" })).toBe(false);
    expect(requiresBeforeApproval(step({ approval_type: "before_step" }), { autonomy_level: "autonomous" })).toBe(false);
    expect(requiresBeforeApproval(step({ requires_human_approval: 1 }), { autonomy_level: "autonomous" })).toBe(false);
    expect(requiresBeforeApproval(step({ approval_type: "before_step", requires_human_approval: 1 }), { autonomy_level: "autonomous" })).toBe(true);
  });
});

describe("requiresAfterApproval", () => {
  it("requires approval_type='after_step' regardless of autonomy", () => {
    expect(requiresAfterApproval(step({ approval_type: "before_step", risky: 1 }), { autonomy_level: "manual" })).toBe(false);
    expect(requiresAfterApproval(step({ approval_type: "none", risky: 1 }), { autonomy_level: "manual" })).toBe(false);
  });

  it("manual autonomy → after-step always pauses if approval_type='after_step'", () => {
    expect(requiresAfterApproval(step({ approval_type: "after_step" }), { autonomy_level: "manual" })).toBe(true);
  });

  it("supervised autonomy → only if also risky or requires", () => {
    expect(requiresAfterApproval(step({ approval_type: "after_step" }), { autonomy_level: "supervised" })).toBe(false);
    expect(requiresAfterApproval(step({ approval_type: "after_step", risky: 1 }), { autonomy_level: "supervised" })).toBe(true);
    expect(requiresAfterApproval(step({ approval_type: "after_step", requires_human_approval: 1 }), { autonomy_level: "supervised" })).toBe(true);
  });

  it("autonomous autonomy → only if requires_human_approval explicitly true", () => {
    expect(requiresAfterApproval(step({ approval_type: "after_step", risky: 1 }), { autonomy_level: "autonomous" })).toBe(false);
    expect(requiresAfterApproval(step({ approval_type: "after_step", requires_human_approval: 1 }), { autonomy_level: "autonomous" })).toBe(true);
  });
});
