import { Redis } from "ioredis";
import { env } from "../config/env.js";
import { prisma } from "./prisma.js";

export type ReadinessCheckName = "database" | "redis";
export type ReadinessStatus = "ok" | "error";

export interface ReadinessCheck {
  status: ReadinessStatus;
  latencyMs: number;
  message?: string;
}

export type ReadinessChecks = Record<ReadinessCheckName, ReadinessCheck>;

export async function getReadinessChecks(): Promise<ReadinessChecks> {
  const [database, redis] = await Promise.all([
    checkDatabase(),
    checkRedis()
  ]);

  return { database, redis };
}

export function isReady(checks: ReadinessChecks): boolean {
  return Object.values(checks).every((check) => check.status === "ok");
}

async function checkDatabase(): Promise<ReadinessCheck> {
  const startedAt = Date.now();
  try {
    await prisma.$queryRawUnsafe("SELECT 1");
    return { status: "ok", latencyMs: Date.now() - startedAt };
  } catch {
    return {
      status: "error",
      latencyMs: Date.now() - startedAt,
      message: "Database check failed."
    };
  }
}

async function checkRedis(): Promise<ReadinessCheck> {
  const startedAt = Date.now();
  const redis = new Redis(env.REDIS_URL, {
    connectTimeout: 2_000,
    lazyConnect: true,
    maxRetriesPerRequest: 1
  });

  try {
    await redis.connect();
    await redis.ping();
    return { status: "ok", latencyMs: Date.now() - startedAt };
  } catch {
    return {
      status: "error",
      latencyMs: Date.now() - startedAt,
      message: "Redis check failed."
    };
  } finally {
    redis.disconnect();
  }
}
