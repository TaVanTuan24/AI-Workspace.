import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient, type User } from "@prisma/client";
import type { ProviderId } from "@uaiw/shared/types/provider.js";
import { AesGcmSessionVault, type EncryptedSession } from "@uaiw/session-vault/index.js";

export interface LoadedConnection {
  userId: string;
  sessionState: unknown;
}

loadLocalEnv();

const prisma = new PrismaClient();
const vault = new AesGcmSessionVault();

export async function loadConnection(input: {
  provider: ProviderId;
  userId?: string;
}): Promise<LoadedConnection> {
  let user: User | null;
  try {
    user = input.userId
      ? await prisma.user.findUnique({ where: { id: input.userId } })
      : await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
  } catch {
    throw new Error("USER_NOT_FOUND");
  }

  if (!user) throw new Error("USER_NOT_FOUND");

  const connection = await prisma.providerConnection.findUnique({
    where: { userId_provider: { userId: user.id, provider: input.provider } }
  });

  if (!connection || connection.status !== "connected") throw new Error("REQUIRES_LOGIN");
  if (!connection.encryptedSessionBlob) throw new Error("REQUIRES_LOGIN");

  let blob: EncryptedSession;
  try {
    blob = JSON.parse(connection.encryptedSessionBlob) as EncryptedSession;
  } catch {
    throw new Error("SESSION_DECRYPT_FAILED");
  }

  const sessionState = await vault.decryptSession({
    userId: user.id,
    provider: input.provider,
    blob
  });

  return {
    userId: user.id,
    sessionState
  };
}

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}

function loadLocalEnv(): void {
  const envPath = resolve(process.cwd(), ".env");
  if (existsSync(envPath)) {
    const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex <= 0) continue;
      const key = trimmed.slice(0, separatorIndex).trim();
      const rawValue = trimmed.slice(separatorIndex + 1).trim();
      if (!process.env[key]) {
        process.env[key] = rawValue.replace(/^["']|["']$/g, "");
      }
    }
  }

  process.env.DATABASE_URL ??= "file:./dev.db";
}
