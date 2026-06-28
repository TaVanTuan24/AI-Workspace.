import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../prisma.js";
import { withTestUserScope } from "../../test/testIsolation.js";
import {
  createAttachment,
  resolveOwnedAttachmentIds,
  cloneAttachmentsForJob,
  deleteAttachments,
  AttachmentValidationError
} from "../attachmentService.js";

const PNG_BASE64 = Buffer.from("fake-png-bytes").toString("base64");

describe("attachmentService", () => {
  const scope = withTestUserScope("attachments");
  const userId = scope.userId;

  beforeEach(async () => {
    await prisma.user.upsert({
      where: { id: userId },
      update: {},
      create: { id: userId, email: scope.email, role: "owner" }
    });
  });

  afterEach(async () => {
    await scope.cleanup();
  });

  it("stores an allowed image and reports safe metadata", async () => {
    const view = await createAttachment({
      userId,
      filename: "shot.png",
      mimeType: "image/png",
      contentBase64: PNG_BASE64
    });
    expect(view.filename).toBe("shot.png");
    expect(view.mimeType).toBe("image/png");
    expect(view.sizeBytes).toBeGreaterThan(0);

    const owned = await resolveOwnedAttachmentIds(userId, [view.id]);
    expect(owned).toEqual([view.id]);
  });

  it("rejects unsupported file types", async () => {
    await expect(
      createAttachment({ userId, filename: "evil.exe", mimeType: "application/x-msdownload", contentBase64: PNG_BASE64 })
    ).rejects.toBeInstanceOf(AttachmentValidationError);
  });

  it("rejects empty content", async () => {
    await expect(
      createAttachment({ userId, filename: "empty.png", mimeType: "image/png", contentBase64: "" })
    ).rejects.toBeInstanceOf(AttachmentValidationError);
  });

  it("does not return another user's or unknown attachment ids", async () => {
    const view = await createAttachment({ userId, filename: "a.png", mimeType: "image/png", contentBase64: PNG_BASE64 });
    const owned = await resolveOwnedAttachmentIds(userId, [view.id, "does-not-exist"]);
    expect(owned).toEqual([view.id]);
  });

  it("clones attachments into a fresh per-job set and deletes originals", async () => {
    const view = await createAttachment({ userId, filename: "a.png", mimeType: "image/png", contentBase64: PNG_BASE64 });
    const cloned = await cloneAttachmentsForJob(userId, [view.id]);
    expect(cloned).toHaveLength(1);
    expect(cloned[0]).not.toBe(view.id);

    const clone = await prisma.messageAttachment.findUnique({ where: { id: cloned[0] } });
    expect(clone?.filename).toBe("a.png");

    await deleteAttachments([view.id]);
    expect(await prisma.messageAttachment.findUnique({ where: { id: view.id } })).toBeNull();
    // The clone survives independent deletion of the original.
    expect(await prisma.messageAttachment.findUnique({ where: { id: cloned[0] } })).not.toBeNull();
  });
});
