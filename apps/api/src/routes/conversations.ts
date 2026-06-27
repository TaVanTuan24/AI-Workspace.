import { FastifyPluginAsync } from "fastify";
import { exportAllConversations, exportThread } from "../services/conversationExportService.js";
import { previewConversationImport, importConversations } from "../services/conversationImportService.js";
import { encryptConversationExport, decryptConversationBackup } from "../services/encryptedBackupService.js";
import { z } from "zod";
import { attachLocalUser } from "../middleware/auth.js";

const ImportRequestSchema = z.object({
  file: z.unknown(),
  options: z.object({
    conflictStrategy: z.enum(["create_new", "skip_duplicates"])
  }).optional()
});

const EncryptedExportRequestSchema = z.object({
  passphrase: z.string().min(1),
  threadId: z.string().optional()
});

const EncryptedImportPreviewRequestSchema = z.object({
  file: z.unknown(),
  passphrase: z.string().min(1)
});

const EncryptedImportRequestSchema = z.object({
  file: z.unknown(),
  passphrase: z.string().min(1),
  options: z.object({
    conflictStrategy: z.enum(["create_new", "skip_duplicates"])
  }).optional()
});

export const conversationsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", attachLocalUser);
  // Enforce auth manually for these endpoints, or trust the hook in server.ts
  // Assuming the `addHook('preHandler', fastify.authenticate)` is applied globally to /settings routes in server.ts.
  
  fastify.get("/settings/conversations/export", async (request, reply) => {
    const userId = request.user.id;
    const exportData = await exportAllConversations(userId);
    
    const dateStr = new Date().toISOString().split("T")[0];
    reply.header("Content-Disposition", `attachment; filename="unified-ai-conversations-${dateStr}.json"`);
    reply.header("Content-Type", "application/json");
    
    return reply.send(exportData);
  });

  fastify.get("/settings/conversations/:threadId/export", async (request, reply) => {
    const userId = request.user.id;
    const { threadId } = request.params as { threadId: string };
    
    const exportData = await exportThread(userId, threadId);
    if (!exportData) {
      return reply.code(404).send({ error: "Thread not found or access denied." });
    }

    const dateStr = new Date().toISOString().split("T")[0];
    reply.header("Content-Disposition", `attachment; filename="unified-ai-thread-${threadId}-${dateStr}.json"`);
    reply.header("Content-Type", "application/json");
    
    return reply.send(exportData);
  });

  fastify.post("/settings/conversations/import/preview", async (request, reply) => {
    const userId = request.user.id;
    const body = request.body as any;

    if (!body || !body.file) {
      return reply.code(400).send({ error: "Missing 'file' payload." });
    }

    const preview = await previewConversationImport(userId, body.file);
    if (!preview.valid) {
      return reply.code(400).send(preview);
    }

    return reply.send(preview);
  });

  fastify.post("/settings/conversations/import", async (request, reply) => {
    const userId = request.user.id;
    const body = request.body as any;

    try {
      const payload = ImportRequestSchema.parse(body);
      
      const options = {
        conflictStrategy: payload.options?.conflictStrategy || "create_new"
      } as const;

      const result = await importConversations(userId, payload.file, options);
      return reply.send(result);
    } catch (error: any) {
      return reply.code(400).send({ error: error.message || "Invalid payload." });
    }
  });

  fastify.post("/settings/conversations/export/encrypted", async (request, reply) => {
    const userId = request.user.id;
    try {
      const payload = EncryptedExportRequestSchema.parse(request.body);
      
      let exportData;
      if (payload.threadId) {
        exportData = await exportThread(userId, payload.threadId);
        if (!exportData) {
          return reply.code(404).send({ error: "Thread not found or access denied." });
        }
      } else {
        exportData = await exportAllConversations(userId);
      }

      const encryptedData = await encryptConversationExport(exportData, payload.passphrase);

      const dateStr = new Date().toISOString().split("T")[0];
      reply.header("Content-Disposition", `attachment; filename="unified-ai-conversations-encrypted-${dateStr}.json"`);
      reply.header("Content-Type", "application/json");
      
      return reply.send(encryptedData);
    } catch (error: any) {
      return reply.code(400).send({ error: error.message || "Invalid payload." });
    }
  });

  fastify.post("/settings/conversations/import/encrypted/preview", async (request, reply) => {
    const userId = request.user.id;
    try {
      const payload = EncryptedImportPreviewRequestSchema.parse(request.body);
      
      const decryptedFile = await decryptConversationBackup(payload.file, payload.passphrase);
      
      const preview = await previewConversationImport(userId, decryptedFile);
      if (!preview.valid) {
        return reply.code(400).send(preview);
      }

      return reply.send(preview);
    } catch (error: any) {
      return reply.code(400).send({ error: error.message || "Invalid payload or decrypt failed." });
    }
  });

  fastify.post("/settings/conversations/import/encrypted", async (request, reply) => {
    const userId = request.user.id;
    try {
      const payload = EncryptedImportRequestSchema.parse(request.body);
      
      const decryptedFile = await decryptConversationBackup(payload.file, payload.passphrase);

      const options = {
        conflictStrategy: payload.options?.conflictStrategy || "create_new"
      } as const;

      const result = await importConversations(userId, decryptedFile, options);
      return reply.send(result);
    } catch (error: any) {
      return reply.code(400).send({ error: error.message || "Invalid payload or decrypt failed." });
    }
  });
};
