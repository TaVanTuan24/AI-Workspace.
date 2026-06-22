import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { parseMasterKey } from "@uaiw/session-vault";
import { env } from "../config/env.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12;

interface EncryptedPayload {
  v: 1;
  alg: "aes-256-gcm";
  iv: string;
  tag: string;
  ciphertext: string;
}

function getEncryptionKey(): Buffer {
  if (env.NOTIFICATION_SECRET_ENCRYPTION_KEY) {
    return parseMasterKey(env.NOTIFICATION_SECRET_ENCRYPTION_KEY);
  }
  if (process.env.SESSION_MASTER_KEY) {
    return parseMasterKey(process.env.SESSION_MASTER_KEY);
  }
  throw new Error("No encryption key available. Configure NOTIFICATION_SECRET_ENCRYPTION_KEY or SESSION_MASTER_KEY.");
}

export function encryptSecretString(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  
  const ciphertextBuffer = Buffer.concat([
    cipher.update(Buffer.from(plaintext, "utf8")),
    cipher.final()
  ]);
  
  const authTag = cipher.getAuthTag();

  const payload: EncryptedPayload = {
    v: 1,
    alg: ALGORITHM,
    iv: iv.toString("base64"),
    tag: authTag.toString("base64"),
    ciphertext: ciphertextBuffer.toString("base64")
  };

  return JSON.stringify(payload);
}

export function decryptSecretString(encodedCiphertext: string): string {
  const key = getEncryptionKey();
  
  let payload: EncryptedPayload;
  try {
    payload = JSON.parse(encodedCiphertext);
  } catch {
    throw new Error("Invalid encrypted payload format");
  }

  if (payload.v !== 1 || payload.alg !== ALGORITHM) {
    throw new Error("Unsupported encrypted payload version or algorithm");
  }

  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));

  const plaintextBuffer = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final()
  ]);

  return plaintextBuffer.toString("utf8");
}
