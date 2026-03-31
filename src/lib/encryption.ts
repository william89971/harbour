import crypto from "crypto";
import fs from "fs";
import path from "path";
import os from "os";

const KEY_FILE = path.join(os.homedir(), ".harbour", "encryption.key");
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

let _key: Buffer | null = null;

function ensureDir() {
  const dir = path.dirname(KEY_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadOrCreateKey(): Buffer {
  if (_key) return _key;

  // Check env var first
  const envKey = process.env.HARBOUR_ENCRYPTION_KEY;
  if (envKey) {
    _key = Buffer.from(envKey, "hex");
    if (_key.length !== 32) throw new Error("HARBOUR_ENCRYPTION_KEY must be 64 hex chars (32 bytes)");
    return _key;
  }

  // Check key file
  if (fs.existsSync(KEY_FILE)) {
    _key = Buffer.from(fs.readFileSync(KEY_FILE, "utf-8").trim(), "hex");
    return _key;
  }

  // Generate new key
  ensureDir();
  _key = crypto.randomBytes(32);
  fs.writeFileSync(KEY_FILE, _key.toString("hex"), { mode: 0o600 });
  return _key;
}

export function encrypt(plaintext: string): string {
  const key = loadOrCreateKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decrypt(ciphertext: string): string {
  const key = loadOrCreateKey();
  const [ivHex, authTagHex, encryptedHex] = ciphertext.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const encrypted = Buffer.from(encryptedHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf-8");
}
