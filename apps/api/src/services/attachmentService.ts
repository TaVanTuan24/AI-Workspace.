import { prisma } from "./prisma.js";

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB per file
export const MAX_ATTACHMENTS_PER_MESSAGE = 6;

// Allowlisted MIME types: common images and documents the providers accept.
export const ALLOWED_ATTACHMENT_MIME_TYPES = new Set<string>([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
]);

export interface AttachmentView {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export class AttachmentValidationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

export async function createAttachment(input: {
  userId: string;
  filename: string;
  mimeType: string;
  contentBase64: string;
}): Promise<AttachmentView> {
  const mimeType = input.mimeType.trim().toLowerCase();
  if (!ALLOWED_ATTACHMENT_MIME_TYPES.has(mimeType)) {
    throw new AttachmentValidationError("unsupported_media_type", `File type ${mimeType || "unknown"} is not supported.`);
  }

  let data: Buffer;
  try {
    data = Buffer.from(input.contentBase64, "base64");
  } catch {
    throw new AttachmentValidationError("invalid_content", "Attachment content could not be decoded.");
  }
  if (data.length === 0) {
    throw new AttachmentValidationError("invalid_content", "Attachment is empty.");
  }
  if (data.length > MAX_ATTACHMENT_BYTES) {
    throw new AttachmentValidationError("payload_too_large", `Attachment exceeds the ${Math.floor(MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB limit.`);
  }

  const filename = (input.filename || "attachment").slice(0, 200);

  const created = await prisma.messageAttachment.create({
    data: {
      userId: input.userId,
      filename,
      mimeType,
      sizeBytes: data.length,
      data,
      status: "pending"
    },
    select: { id: true, filename: true, mimeType: true, sizeBytes: true }
  });

  return created;
}

/**
 * Returns the subset of attachment IDs that exist, belong to the user, and are
 * still pending. Used to validate a chat request's attachment references.
 */
export async function resolveOwnedAttachmentIds(userId: string, attachmentIds: string[]): Promise<string[]> {
  if (attachmentIds.length === 0) return [];
  const rows = await prisma.messageAttachment.findMany({
    where: { id: { in: attachmentIds }, userId, status: "pending" },
    select: { id: true }
  });
  const found = new Set(rows.map((row) => row.id));
  // Preserve caller order, drop unknown/forbidden ids.
  return attachmentIds.filter((id) => found.has(id));
}

/**
 * Duplicate the given attachments into a fresh per-job set and return the new
 * IDs. Each chat job (including each provider in compare mode) gets its own copy
 * so the worker can delete its set after use without affecting sibling jobs.
 */
export async function cloneAttachmentsForJob(userId: string, sourceIds: string[]): Promise<string[]> {
  if (sourceIds.length === 0) return [];
  const rows = await prisma.messageAttachment.findMany({
    where: { id: { in: sourceIds }, userId }
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const newIds: string[] = [];
  for (const id of sourceIds) {
    const row = byId.get(id);
    if (!row) continue;
    const clone = await prisma.messageAttachment.create({
      data: {
        userId: row.userId,
        filename: row.filename,
        mimeType: row.mimeType,
        sizeBytes: row.sizeBytes,
        data: row.data,
        status: "pending"
      },
      select: { id: true }
    });
    newIds.push(clone.id);
  }
  return newIds;
}

/** Delete attachment rows by ID (used to drop the staged originals after cloning). */
export async function deleteAttachments(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await prisma.messageAttachment.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
}
