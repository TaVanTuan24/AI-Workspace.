import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "../prisma.js";
import { 
  createApiKey, 
  rotateApiKey, 
  setApiKeyModelScopes,
  isModelAllowedForApiKey,
  getApiKeyModelScopes
} from "../apiKeyService.js";

import { env } from "../../config/env.js";

env.ENABLE_DB_API_KEYS = true;
env.API_KEY_HASH_SECRET = "test_secret_for_hashing_123";

describe("apiKeyService with model scopes", () => {
  const userId = "test-user-apikey-scopes";

  beforeEach(async () => {
    await prisma.internalApiKeyModelScope.deleteMany({ where: { apiKey: { userId } } });
    await prisma.internalApiKey.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });

    await prisma.user.create({
      data: {
        id: userId,
        email: "test-apikey-scopes@local.com"
      }
    });
  });

  afterEach(async () => {
    await prisma.internalApiKeyModelScope.deleteMany({ where: { apiKey: { userId } } });
    await prisma.internalApiKey.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("should create key with unrestricted scopes by default", async () => {
    const { record } = await createApiKey({ userId, name: "Unrestricted" });
    expect(record.scopeMode).toBe("all_enabled_models");
    expect(record.allowedModels).toHaveLength(0);

    const allowed1 = await isModelAllowedForApiKey(record.id, "chatgpt-web");
    const allowed2 = await isModelAllowedForApiKey(record.id, "gemini-web");
    expect(allowed1).toBe(true);
    expect(allowed2).toBe(true);
  });

  it("should create key with restricted scopes", async () => {
    const { record } = await createApiKey({ 
      userId, 
      name: "Restricted",
      allowedModelIds: ["chatgpt-web"]
    });
    
    expect(record.scopeMode).toBe("restricted");
    expect(record.allowedModels).toContain("chatgpt-web");

    const allowed1 = await isModelAllowedForApiKey(record.id, "chatgpt-web");
    const allowed2 = await isModelAllowedForApiKey(record.id, "gemini-web");
    expect(allowed1).toBe(true);
    expect(allowed2).toBe(false);
  });

  it("should edit scopes successfully", async () => {
    const { record } = await createApiKey({ userId, name: "Edit Me" });
    
    // Initially all allowed
    expect(await isModelAllowedForApiKey(record.id, "claude-web")).toBe(true);

    // Change to restricted
    const updated = await setApiKeyModelScopes(userId, record.id, ["claude-web"]);
    expect(updated.scopeMode).toBe("restricted");
    
    expect(await isModelAllowedForApiKey(record.id, "claude-web")).toBe(true);
    expect(await isModelAllowedForApiKey(record.id, "chatgpt-web")).toBe(false);

    // Change back to unrestricted
    const reverted = await setApiKeyModelScopes(userId, record.id, []);
    expect(reverted.scopeMode).toBe("all_enabled_models");
    expect(await isModelAllowedForApiKey(record.id, "chatgpt-web")).toBe(true);
  });

  it("should preserve scopes on rotate", async () => {
    const { record: oldKey } = await createApiKey({ 
      userId, 
      name: "Rotate Me",
      allowedModelIds: ["gemini-web"]
    });

    const { record: newKey } = await rotateApiKey(userId, oldKey.id, true);
    
    expect(newKey.scopeMode).toBe("restricted");
    expect(newKey.allowedModels).toContain("gemini-web");
    expect(await isModelAllowedForApiKey(newKey.id, "gemini-web")).toBe(true);
    expect(await isModelAllowedForApiKey(newKey.id, "claude-web")).toBe(false);
  });
});
