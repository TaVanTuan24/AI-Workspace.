import { z } from "zod";

// Roles defined as safe mapping values
const RoleSchema = z.enum(["system", "user", "assistant", "tool", "error"]);

export const ExportMessageSchema = z.object({
  sourceMessageId: z.string().optional(),
  role: RoleSchema,
  content: z.string().max(200000), // Max 200,000 chars per message
  provider: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  metadata: z.record(z.unknown()).optional(),
});

export const ExportThreadSchema = z.object({
  sourceThreadId: z.string().optional(),
  title: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  messages: z.array(ExportMessageSchema).max(2000), // Max 2000 messages per thread
});

export const ExportFileSchema = z.object({
  format: z.literal("unified-ai-workspace.conversations"),
  version: z.number().int().min(1).max(1),
  exportedAt: z.string().datetime(),
  source: z.object({
    app: z.string(),
    type: z.string(),
  }).optional(),
  threads: z.array(ExportThreadSchema).max(500), // Max 500 threads per file
});

export type ExportMessage = z.infer<typeof ExportMessageSchema>;
export type ExportThread = z.infer<typeof ExportThreadSchema>;
export type ExportFile = z.infer<typeof ExportFileSchema>;

// Total max message limit enforcing global scale boundaries
export const MAX_TOTAL_MESSAGES = 50000;
