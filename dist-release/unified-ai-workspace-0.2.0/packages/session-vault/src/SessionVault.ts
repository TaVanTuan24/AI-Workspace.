import {
  decryptJson,
  encryptJson,
  isValidEncryptedSessionShape,
  parseMasterKey,
  redactSessionForLog
} from "./crypto.js";
import type {
  DecryptSessionInput,
  DeleteSessionInput,
  EncryptedSession,
  EncryptSessionInput,
  KeyProvider,
  SessionVault
} from "./types.js";

export class EnvKeyProvider implements KeyProvider {
  constructor(
    private readonly encodedKey = process.env.SESSION_MASTER_KEY,
    private readonly keyId = process.env.SESSION_MASTER_KEY_ID ?? "local-v1"
  ) {}

  async getActiveKey() {
    return this.materialize(this.keyId);
  }

  async getKey(keyId: string) {
    if (keyId !== this.keyId) {
      throw new Error("Unknown encryption key id");
    }
    return this.materialize(keyId);
  }

  private materialize(keyId: string) {
    if (!this.encodedKey) {
      throw new Error("SESSION_MASTER_KEY is required");
    }

    return {
      keyId,
      key: parseMasterKey(this.encodedKey)
    };
  }
}

export class AesGcmSessionVault implements SessionVault {
  constructor(private readonly keyProvider: KeyProvider = new EnvKeyProvider()) {}

  async encryptSession(input: EncryptSessionInput): Promise<EncryptedSession> {
    try {
      const keyMaterial = await this.keyProvider.getActiveKey();
      return encryptJson(input.sessionState, keyMaterial);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("SESSION_MASTER_KEY")) {
        throw error;
      }
      throw new Error("SESSION_ENCRYPT_FAILED");
    }
  }

  async decryptSession(input: DecryptSessionInput): Promise<unknown> {
    try {
      const keyMaterial = await this.keyProvider.getKey(input.blob.keyId);
      return decryptJson(input.blob, keyMaterial);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("SESSION_MASTER_KEY")) {
        throw error;
      }
      throw new Error("SESSION_DECRYPT_FAILED");
    }
  }

  async deleteSession(_input: DeleteSessionInput): Promise<void> {
    // DB/file deletion belongs to the repository layer. This method exists so
    // callers depend on the vault boundary instead of directly touching blobs.
  }

  async validateSessionBlob(blob: EncryptedSession): Promise<boolean> {
    return isValidEncryptedSessionShape(blob);
  }
}

export { redactSessionForLog };
