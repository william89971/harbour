/**
 * Activity-log secret scrubber.
 *
 * The runner pipes decrypted env-var values into the agent subprocess so
 * shell scripts can expand `$VARNAME` naturally. If those values end up
 * echoed to stdout, scrubSecrets is the last line of defense before the
 * raw secret lands in the run activity log.
 */
import { describe, it, expect } from "vitest";
import { scrubSecrets } from "../../bin/lib/scrub.mjs";

describe("scrubSecrets", () => {
  it("returns text unchanged when env is empty/null/undefined", () => {
    expect(scrubSecrets("hello world", {})).toBe("hello world");
    expect(scrubSecrets("hello world", null as unknown as Record<string, string>)).toBe("hello world");
    expect(scrubSecrets("hello world", undefined as unknown as Record<string, string>)).toBe("hello world");
  });

  it("returns empty string for falsy text", () => {
    expect(scrubSecrets("", { API_KEY: "sk-abcdef12345" })).toBe("");
    expect(scrubSecrets(null as unknown as string, { API_KEY: "sk-abcdef12345" })).toBe("");
  });

  it("masks long env values appearing in text", () => {
    const env = { API_KEY: "sk-abcdef1234567890" };
    const text = "the key is sk-abcdef1234567890 ok";
    expect(scrubSecrets(text, env)).toBe("the key is [REDACTED] ok");
  });

  it("masks multiple occurrences of the same value", () => {
    const env = { TOKEN: "tok-AAAAAAAAAA" };
    const text = "tok-AAAAAAAAAA repeated tok-AAAAAAAAAA twice";
    expect(scrubSecrets(text, env)).toBe("[REDACTED] repeated [REDACTED] twice");
  });

  it("masks multiple different env values in one pass", () => {
    const env = { A: "longvalueAAAA", B: "anothervalueBBBB" };
    const text = "see longvalueAAAA and anothervalueBBBB now";
    expect(scrubSecrets(text, env)).toBe("see [REDACTED] and [REDACTED] now");
  });

  it("does NOT mask values shorter than minLen (default 8)", () => {
    // "prod" is too short — masking it would over-redact common output.
    const env = { ENV: "prod", FLAG: "true" };
    const text = "running in prod mode (true)";
    expect(scrubSecrets(text, env)).toBe("running in prod mode (true)");
  });

  it("respects custom minLen", () => {
    const env = { SHORT: "abc12" };
    expect(scrubSecrets("the val is abc12 here", env, { minLen: 5 })).toBe("the val is [REDACTED] here");
    expect(scrubSecrets("the val is abc12 here", env, { minLen: 10 })).toBe("the val is abc12 here");
  });

  it("masks longer values before shorter overlapping ones (no partial leak)", () => {
    // If we mask the shorter value first, the longer one leaves a tail.
    // The function sorts values by length DESC to avoid that.
    const env = {
      FULL: "FULL_API_KEY_abc12345",
      SHORT: "_abc12345",
    };
    const text = "echo FULL_API_KEY_abc12345 done";
    expect(scrubSecrets(text, env)).toBe("echo [REDACTED] done");
  });

  it("ignores non-string values", () => {
    const env = { GOOD: "longvalue1234567", BAD: 42 as unknown as string };
    expect(scrubSecrets("emit longvalue1234567 and 42", env)).toBe("emit [REDACTED] and 42");
  });

  it("uses literal string match — no regex injection from env values", () => {
    // Verify that special regex chars in the value match literally and do
    // not blow up or over-mask.
    const env = { K: "secret.[a-z]+$" };
    const text = "found secret.[a-z]+$ literally here";
    expect(scrubSecrets(text, env)).toBe("found [REDACTED] literally here");
    // It also doesn't accidentally match a regex-style string.
    expect(scrubSecrets("found secret.abcdef here", env)).toBe("found secret.abcdef here");
  });

  it("supports custom placeholder", () => {
    const env = { K: "longsecretvalue12" };
    expect(scrubSecrets("see longsecretvalue12 here", env, { placeholder: "***" })).toBe("see *** here");
  });
});
