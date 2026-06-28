import { FastifyPluginAsync } from "fastify";
import { exportAllConversations, exportThread } from "../services/conversationExportService.js";
import { previewConversationImport, importConversations } from "../services/conversationImportService.js";
import { encryptConversationExport, decryptConversationBackup } from "../services/encryptedBackupService.js";
import {
  listThreads,
  getThreadDetail,
  deleteThread,
  renameThread
} from "../services/conversationHistoryService.js";
import { z } from "zod";
import { attachLocalUser } from "../middleware/auth.js";

const ListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().min(1).optional()
});

const RenameBodySchema = z.object({
  title: z.string().min(1).max(200)
});

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

  fastify.get("/settings/conversations", async (request, reply) => {
    const parsed = ListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid query parameters." });
    }
    const result = await listThreads(request.user.id, parsed.data);
    return reply.send(result);
  });

  fastify.get("/settings/conversations/:threadId", async (request, reply) => {
    const { threadId } = request.params as { threadId: string };
    const detail = await getThreadDetail(request.user.id, threadId);
    if (!detail) {
      return reply.code(404).send({ error: "Thread not found or access denied." });
    }
    return reply.send(detail);
  });

  fastify.patch("/settings/conversations/:threadId", async (request, reply) => {
    const { threadId } = request.params as { threadId: string };
    const parsed = RenameBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Title must be between 1 and 200 characters." });
    }
    try {
      const updated = await renameThread(request.user.id, threadId, parsed.data.title);
      if (!updated) {
        return reply.code(404).send({ error: "Thread not found or access denied." });
      }
      return reply.send({ thread: updated });
    } catch (error: any) {
      return reply.code(400).send({ error: error.message || "Invalid title." });
    }
  });

  fastify.delete("/settings/conversations/:threadId", async (request, reply) => {
    const { threadId } = request.params as { threadId: string };
    const deleted = await deleteThread(request.user.id, threadId);
    if (!deleted) {
      return reply.code(404).send({ error: "Thread not found or access denied." });
    }
    return reply.send({ ok: true });
  });

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
