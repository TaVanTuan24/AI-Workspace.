import { describe, it, expect, vi } from "vitest";
import { mapInternalErrorToOpenAI } from "../../services/openaiCompatErrors.js";
import { OPENAI_COMPAT_MODELS, convertMessagesToPrompt } from "../openaiCompat.js";
import { internalApiAuth } from "../../middleware/internalApiAuth.js";
import { env } from "../../config/env.js";

// Mock the prisma dependency in attachLocalUser
vi.mock("../../services/prisma.js", () => ({
  prisma: {
    user: {
      upsert: vi.fn().mockResolvedValue({ id: "local-user" })
    }
  }
}));

describe("OpenAI Compat Errors", () => {
  it("maps REQUIRES_LOGIN to provider_error", () => {
    const result = mapInternalErrorToOpenAI("REQUIRES_LOGIN", "Please reconnect.");
    expect(result.error.type).toBe("provider_error");
    expect(result.error.code).toBe("requires_login");
  });

  it("maps UNKNOWN_PROVIDER to invalid_request_error", () => {
    const result = mapInternalErrorToOpenAI("UNKNOWN_PROVIDER", "Unknown.");
    expect(result.error.type).toBe("invalid_request_error");
    expect(result.error.code).toBe("model_not_found");
  });

  it("maps PROVIDER_RATE_LIMIT_EXCEEDED to OpenAI rate limit error", () => {
    const result = mapInternalErrorToOpenAI("PROVIDER_RATE_LIMIT_EXCEEDED", "Provider rate limit exceeded.");
    expect(result.error.type).toBe("rate_limit_error");
    expect(result.error.code).toBe("provider_rate_limit_exceeded");
  });
});

describe("OpenAI Compat Models", () => {
  it("includes gemini, chatgpt, grok wrappers", () => {
    expect(OPENAI_COMPAT_MODELS["gemini-web"]).toBeDefined();
    expect(OPENAI_COMPAT_MODELS["chatgpt-web"]).toBeDefined();
    expect(OPENAI_COMPAT_MODELS["grok-web"]).toBeDefined();
  });
});

describe("Message Conversion", () => {
  it("converts single user message directly", () => {
    const result = convertMessagesToPrompt([{ role: "user", content: "Hello" }]);
    expect(result).toBe("Hello");
  });

  it("converts multiple messages into a formatted prompt", () => {
    const result = convertMessagesToPrompt([
      { role: "system", content: "You are helpful." },
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello" }
    ]);
    expect(result).toContain("System:\nYou are helpful.");
    expect(result).toContain("User:\nHi");
    expect(result).toContain("Assistant:\nHello");
    expect(result).toContain("Answer as the assistant.");
  });
});

describe("internalApiAuth middleware", () => {
  it("rejects missing auth header", async () => {
    const req: any = { headers: {} };
    const reply: any = { code: vi.fn().mockReturnThis(), send: vi.fn() };
    await internalApiAuth(req, reply);
    expect(reply.code).toHaveBeenCalledWith(401);
  });

  it("rejects invalid key", async () => {
    env.INTERNAL_API_KEY = "testkey";
    const req: any = { headers: { authorization: "Bearer wrongkey" } };
    const reply: any = { code: vi.fn().mockReturnThis(), send: vi.fn() };
    await internalApiAuth(req, reply);
    expect(reply.code).toHaveBeenCalledWith(401);
  });

  it("accepts valid key", async () => {
    env.INTERNAL_API_KEY = "testkey";
    const req: any = { headers: { authorization: "Bearer testkey" } };
    const reply: any = { code: vi.fn().mockReturnThis(), send: vi.fn() };
    await internalApiAuth(req, reply);
    expect(req.user).toBeDefined();
    expect(req.user.id).toBe("local-user");
  });
});
