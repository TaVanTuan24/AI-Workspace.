import { describe, expect, it } from "vitest";
import { renderInviteEmailPreview } from "../workspaceInviteTemplateService.js";

describe("workspaceInviteTemplateService", () => {
  it("renders safe text and html without tokens", () => {
    const result = renderInviteEmailPreview({
      workspaceName: 'Test Workspace',
      inviterName: 'Test Inviter',
      inviteeEmail: 'test@example.com',
      role: 'admin',
      acceptUrl: undefined,
      expiresAt: new Date("2030-01-01T00:00:00.000Z")
    });

    expect(result.subject).toBe("You were invited to Test Workspace on Unified AI Workspace");
    expect(result.text).toContain("Test Inviter has invited you to join the workspace \"Test Workspace\" as a admin.");
    expect(result.text).toContain("Please ask the workspace owner for the invite link.");
    
    expect(result.html).toContain("<strong>Test Inviter</strong> has invited you");
    expect(result.html).not.toContain("<script>");
  });

  it("escapes malicious input in html", () => {
    const result = renderInviteEmailPreview({
      workspaceName: '<script>alert("workspace")</script>',
      inviterName: '<img src=x onerror=alert(1)>',
      inviteeEmail: 'test@example.com',
      role: 'member',
      acceptUrl: 'http://localhost:3000/accept?token="onload="alert(1)"',
      expiresAt: new Date("2030-01-01T00:00:00.000Z")
    });

    expect(result.html).not.toContain("<script>alert");
    expect(result.html).toContain("&lt;script&gt;alert(&quot;workspace&quot;)&lt;/script&gt;");
    expect(result.html).not.toContain("<img src=x onerror=alert(1)>");
    expect(result.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    
    // Accept URL should also be escaped
    expect(result.html).toContain("&quot;onload=&quot;alert(1)&quot;");
  });

  it("includes accept link when provided", () => {
    const result = renderInviteEmailPreview({
      workspaceName: 'W',
      inviterName: 'I',
      inviteeEmail: 'e@e.com',
      role: 'member',
      acceptUrl: 'http://example.com/accept',
      expiresAt: new Date("2030-01-01T00:00:00.000Z")
    });

    expect(result.text).toContain("http://example.com/accept");
    expect(result.html).toContain('href="http://example.com/accept"');
  });
});
