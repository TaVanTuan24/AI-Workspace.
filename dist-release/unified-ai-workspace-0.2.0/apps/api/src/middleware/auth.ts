import type { FastifyRequest } from "fastify";
import { prisma } from "../services/prisma.js";

export interface AuthenticatedUser {
  id: string;
  email: string;
}

declare module "fastify" {
  interface FastifyRequest {
    user: AuthenticatedUser;
    apiKeyId?: string;
    apiKeyPrefix?: string;
    rateLimitPerMinute?: number | null;
  }
}

export async function attachLocalUser(request: FastifyRequest) {
  // MVP placeholder. Replace with signed cookie/session validation in M2.
  // Never derive provider access from frontend input.
  const user = {
    id: request.headers["x-local-user-id"]?.toString() ?? "local-user",
    email: "local@example.com"
  };

  await prisma.user.upsert({
    where: { id: user.id },
    create: {
      id: user.id,
      email: user.email,
      displayName: "Local User"
    },
    update: {}
  });

  request.user = user;
}
