import crypto from "crypto";
import { ExportFile } from "./conversationImportSchema.js";

export interface EncryptedConversationBackup {
  format: "unified-ai-workspace.encrypted-conversations";
  version: number;
  createdAt: string;
  crypto: {
    kdf: "scrypt";
    kdfParams: {
      N: number;
      r: number;
      p: number;
      keyLength: number;
    };
    cipher: "aes-256-gcm";
    salt: string;
    iv: string;
    tag: string;
  };
  payload: string;
}

const SCRYPT_PARAMS = {
  N: 16384,
  r: 8,
  p: 1,
  keyLength: 32
};

function scryptAsync(
  passphrase: string,
  salt: Buffer,
  keyLength: number,
  options: crypto.ScryptOptions
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(passphrase, salt, keyLength, options, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(derivedKey);
    });
  });
}

export async function encryptConversationExport(
  exportFile: ExportFile,
  passphrase: string
): Promise<EncryptedConversationBackup> {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12); // GCM standard IV size

  // Derive key
  const derivedKey = await scryptAsync(
    passphrase,
    salt,
    SCRYPT_PARAMS.keyLength,
    {
      N: SCRYPT_PARAMS.N,
      r: SCRYPT_PARAMS.r,
      p: SCRYPT_PARAMS.p
    }
  );

  // Encrypt payload
  const cipher = crypto.createCipheriv("aes-256-gcm", derivedKey, iv);
  const payloadString = JSON.stringify(exportFile);
  const ciphertext = Buffer.concat([
    cipher.update(payloadString, "utf8"),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();

  return {
    format: "unified-ai-workspace.encrypted-conversations",
    version: 1,
    createdAt: new Date().toISOString(),
    crypto: {
      kdf: "scrypt",
      kdfParams: SCRYPT_PARAMS,
      cipher: "aes-256-gcm",
      salt: salt.toString("base64url"),
      iv: iv.toString("base64url"),
      tag: tag.toString("base64url")
    },
    payload: ciphertext.toString("base64url")
  };
}

export async function decryptConversationBackup(
  encryptedFile: unknown,
  passphrase: string
): Promise<ExportFile> {
  if (!isEncryptedConversationBackup(encryptedFile)) {
    throw new Error("BACKUP_DECRYPT_FAILED");
  }

  try {
    const backup = encryptedFile as EncryptedConversationBackup;
    
    // Verify supported crypto params
    if (backup.crypto.kdf !== "scrypt" || backup.crypto.cipher !== "aes-256-gcm") {
      throw new Error("Unsupported crypto format");
    }

    const { salt, iv, tag } = backup.crypto;
    const saltBuffer = Buffer.from(salt, "base64url");
    const ivBuffer = Buffer.from(iv, "base64url");
    const tagBuffer = Buffer.from(tag, "base64url");
    const ciphertextBuffer = Buffer.from(backup.payload, "base64url");

    const { N, r, p, keyLength } = backup.crypto.kdfParams;

    const derivedKey = await scryptAsync(
      passphrase,
      saltBuffer,
      keyLength,
      { N, r, p }
    );

    const decipher = crypto.createDecipheriv("aes-256-gcm", derivedKey, ivBuffer);
    decipher.setAuthTag(tagBuffer);

    const decrypted = Buffer.concat([
      decipher.update(ciphertextBuffer),
      decipher.final()
    ]);

    return JSON.parse(decrypted.toString("utf8")) as ExportFile;
  } catch (error) {
    // Return a safe error to avoid revealing whether it's wrong passphrase or tampered file
    throw new Error("BACKUP_DECRYPT_FAILED");
  }
}

export function isEncryptedConversationBackup(input: unknown): boolean {
  if (!input || typeof input !== "object") return false;
  const obj = input as Record<string, unknown>;
  return obj.format === "unified-ai-workspace.encrypted-conversations";
}
