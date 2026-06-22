import type { FastifyInstance } from "fastify";
import { z } from "zod";

const loginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

export async function authRoutes(app: FastifyInstance) {
  app.post("/auth/login", async (request, reply) => {
    const body = loginBody.parse(request.body);

    // MVP placeholder. Implement local password hashing and signed session in M2.
    return reply.send({
      user: {
        id: "local-user",
        email: body.email
      },
      session: {
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 12).toISOString()
      }
    });
  });
}
