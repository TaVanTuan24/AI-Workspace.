export interface EncryptedSession {
  version: number;
  algorithm: "AES-256-GCM";
  keyId: string;
  iv: string;
  authTag: string;
  ciphertext: string;
  createdAt: string;
}

export interface EncryptSessionInput {
  userId: string;
  provider: string;
  sessionState: unknown;
}

export interface DecryptSessionInput {
  userId: string;
  provider: string;
  blob: EncryptedSession;
}

export interface DeleteSessionInput {
  userId: string;
  provider: string;
  sessionRef?: string | null;
}

export interface RotateKeyInput {
  userId: string;
  provider: string;
  blob: EncryptedSession;
}

export interface SessionVault {
  encryptSession(input: EncryptSessionInput): Promise<EncryptedSession>;
  decryptSession(input: DecryptSessionInput): Promise<unknown>;
  deleteSession(input: DeleteSessionInput): Promise<void>;
  validateSessionBlob(blob: EncryptedSession): Promise<boolean>;
  rotateKey?(input: RotateKeyInput): Promise<EncryptedSession>;
}

export interface KeyMaterial {
  keyId: string;
  key: Buffer;
}

export interface KeyProvider {
  getActiveKey(): Promise<KeyMaterial>;
  getKey(keyId: string): Promise<KeyMaterial>;
}

export interface RedactedSessionLog {
  version?: number;
  algorithm?: string;
  keyId?: string;
  iv: "[REDACTED]" | undefined;
  authTag: "[REDACTED]" | undefined;
  ciphertext: "[REDACTED]" | undefined;
  createdAt?: string;
}
