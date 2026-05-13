/**
 * Per-host polling-interval config (~/.harbour/runner-config.json).
 *
 * config.mjs reads HARBOUR_HOME lazily on every call, so each test can point
 * the helpers at a fresh tmpdir without dynamic re-imports.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  loadRunnerInterval,
  saveRunnerInterval,
  getPollIntervalSeconds,
  MIN_POLL_INTERVAL_SECONDS,
  MAX_POLL_INTERVAL_SECONDS,
  DEFAULT_POLL_INTERVAL_SECONDS,
} from "../../bin/lib/config.mjs";

let tmp: string;
let originalHome: string | undefined;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "harbour-interval-"));
  originalHome = process.env.HARBOUR_HOME;
  process.env.HARBOUR_HOME = tmp;
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  if (originalHome === undefined) delete process.env.HARBOUR_HOME;
  else process.env.HARBOUR_HOME = originalHome;
});

describe("runner polling interval config", () => {
  it("constants are sane", () => {
    expect(MIN_POLL_INTERVAL_SECONDS).toBe(5);
    expect(MAX_POLL_INTERVAL_SECONDS).toBe(3600);
    expect(DEFAULT_POLL_INTERVAL_SECONDS).toBe(60);
  });

  it("defaults to 60 when the file is missing", () => {
    expect(loadRunnerInterval()).toBe(60);
    expect(getPollIntervalSeconds()).toBe(60);
  });

  it("round-trips a valid value", () => {
    saveRunnerInterval(30);
    expect(loadRunnerInterval()).toBe(30);
    expect(getPollIntervalSeconds()).toBe(30);
  });

  it("accepts the minimum (5)", () => {
    saveRunnerInterval(5);
    expect(loadRunnerInterval()).toBe(5);
  });

  it("accepts the maximum (3600)", () => {
    saveRunnerInterval(3600);
    expect(loadRunnerInterval()).toBe(3600);
  });

  it("rejects values below the minimum", () => {
    expect(() => saveRunnerInterval(4)).toThrow();
    expect(() => saveRunnerInterval(0)).toThrow();
    expect(() => saveRunnerInterval(-1)).toThrow();
  });

  it("rejects values above the maximum", () => {
    expect(() => saveRunnerInterval(3601)).toThrow();
    expect(() => saveRunnerInterval(99999)).toThrow();
  });

  it("rejects non-integer values", () => {
    expect(() => saveRunnerInterval(15.5)).toThrow();
    expect(() => saveRunnerInterval(Number.NaN)).toThrow();
    expect(() => saveRunnerInterval("60" as unknown as number)).not.toThrow(); // Number("60") = 60
  });

  it("clamps on load when the file is corrupt or out of range", () => {
    const file = path.join(tmp, "runner-config.json");
    // Out-of-range value persisted by hand → load returns default
    fs.writeFileSync(file, JSON.stringify({ pollIntervalSeconds: 99999 }));
    expect(loadRunnerInterval()).toBe(60);
    // Garbage JSON → load returns default
    fs.writeFileSync(file, "not json {{{");
    expect(loadRunnerInterval()).toBe(60);
    // Missing field → load returns default
    fs.writeFileSync(file, JSON.stringify({ other: "thing" }));
    expect(loadRunnerInterval()).toBe(60);
  });
});
