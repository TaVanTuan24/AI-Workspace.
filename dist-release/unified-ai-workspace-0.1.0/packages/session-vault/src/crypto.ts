import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { EncryptedSession, KeyMaterial, RedactedSessionLog } from "./types.js";

const ALGORITHM = "aes-256-gcm";
const PUBLIC_ALGORITHM = "AES-256-GCM" as const;
const IV_LENGTH_BYTES = 12;
const KEY_LENGTH_BYTES = 32;

export function parseMasterKey(encodedKey: string): Buffer {
  const trimmed = encodedKey.trim();
  if (!trimmed) {
    throw new Error("SESSION_MASTER_KEY is required");
  }

  const hexLike = /^[a-f0-9]+$/i.test(trimmed) && trimmed.length === KEY_LENGTH_BYTES * 2;
  const key = hexLike ? Buffer.from(trimmed, "hex") : Buffer.from(trimmed, "base64");
  assertValidKey(key);
  return key;
}

export function assertValidKey(key: Buffer): void {
  if (key.length !== KEY_LENGTH_BYTES) {
    throw new Error("SESSION_MASTER_KEY must be base64 or hex and decode to exactly 32 bytes");
  }
}

export function encryptJson(value: unknown, keyMaterial: KeyMaterial): EncryptedSession {
  assertValidKey(keyMaterial.key);

  if (isEmptySession(value)) {
    throw new Error("Empty session state is not allowed");
  }

  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, keyMaterial.key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    version: 1,
    algorithm: PUBLIC_ALGORITHM,
    keyId: keyMaterial.keyId,
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    createdAt: new Date().toISOString()
  };
}

export function decryptJson(blob: EncryptedSession, keyMaterial: KeyMaterial): unknown {
  assertValidKey(keyMaterial.key);

  if (!isValidEncryptedSessionShape(blob)) {
    throw new Error("Unsupported encrypted session format");
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    keyMaterial.key,
    Buffer.from(blob.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(blob.authTag, "base64"));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(blob.ciphertext, "base64")),
    decipher.final()
  ]);

  return JSON.parse(plaintext.toString("utf8"));
}

export function isEmptySession(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

export function isValidEncryptedSessionShape(blob: EncryptedSession): boolean {
  if (!blob || blob.version !== 1 || blob.algorithm !== PUBLIC_ALGORITHM) return false;
  if (!blob.keyId || !blob.iv || !blob.authTag || !blob.ciphertext || !blob.createdAt) return false;
  if (Number.isNaN(Date.parse(blob.createdAt))) return false;

  try {
    if (Buffer.from(blob.iv, "base64").length !== IV_LENGTH_BYTES) return false;
    if (Buffer.from(blob.authTag, "base64").length !== 16) return false;
    if (Buffer.from(blob.ciphertext, "base64").length === 0) return false;
    return true;
  } catch {
    return false;
  }
}

export function redactSessionForLog(blob?: Partial<EncryptedSession> | null): RedactedSessionLog {
  return {
    version: blob?.version,
    algorithm: blob?.algorithm,
    keyId: blob?.keyId,
    iv: blob?.iv ? "[REDACTED]" : undefined,
    authTag: blob?.authTag ? "[REDACTED]" : undefined,
    ciphertext: blob?.ciphertext ? "[REDACTED]" : undefined,
    createdAt: blob?.createdAt
  };
}
