/**
 * Defense-in-depth: file-serving routes use safeUploadJoin to constrain
 * DB-stored attachment paths to the uploads root. Even if storage_path is
 * ever corrupted, an attacker cannot walk to /etc/passwd via "..".
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { safeUploadJoin, uploadsDir } from "@/lib/paths";

let originalHome: string | undefined;
let tmpHome: string;

beforeEach(() => {
  originalHome = process.env.HARBOUR_HOME;
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "harbour-paths-"));
  process.env.HARBOUR_HOME = tmpHome;
  // Default uploads dir lives under HARBOUR_HOME, so we don't need to override
  // HARBOUR_UPLOADS_DIR — just ensure it exists.
  fs.mkdirSync(path.join(tmpHome, "uploads"), { recursive: true });
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HARBOUR_HOME;
  else process.env.HARBOUR_HOME = originalHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe("safeUploadJoin", () => {
  it("accepts a normal relative path under uploads", () => {
    const out = safeUploadJoin("runs/abc-123/uuid__photo.jpg");
    expect(out).toBe(path.resolve(uploadsDir(), "runs/abc-123/uuid__photo.jpg"));
  });

  it("rejects .. that escapes the uploads root", () => {
    expect(() => safeUploadJoin("../etc/passwd")).toThrow(/path traversal/);
    expect(() => safeUploadJoin("runs/../../../etc/passwd")).toThrow(/path traversal/);
  });

  it("rejects an absolute path outside the uploads root", () => {
    expect(() => safeUploadJoin("/etc/passwd")).toThrow(/path traversal/);
    expect(() => safeUploadJoin("/tmp/x")).toThrow(/path traversal/);
  });

  it("accepts the uploads root itself (no traversal)", () => {
    // Edge case: "" or "." resolves to the root; allowed.
    expect(safeUploadJoin(".")).toBe(path.resolve(uploadsDir()));
  });

  it("rejects empty / non-string input", () => {
    expect(() => safeUploadJoin("")).toThrow(/invalid storage path/);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => safeUploadJoin(null as any)).toThrow(/invalid storage path/);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => safeUploadJoin(undefined as any)).toThrow(/invalid storage path/);
  });
});
