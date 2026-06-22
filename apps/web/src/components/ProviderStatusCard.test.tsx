import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProviderStatusCard } from "./ProviderStatusCard";

const provider = {
  provider: "gemini",
  displayName: "Gemini",
  readiness: "ready",
  capabilities: ["connect"],
  defaultEnabled: true,
  loginUrl: "https://gemini.google.com",
  status: "connected",
  lastConnectedAt: null,
  lastUsedAt: null,
  lastValidatedAt: null,
  errorCode: null,
  errorMessageSafe: null
} as any;

describe("ProviderStatusCard permissions", () => {
  it("disables connection controls without providerConnections.write", () => {
    render(<ProviderStatusCard provider={provider} canWriteConnections={false} />);

    expect(screen.getByTitle("Connect")).toBeDisabled();
    expect(screen.getByTitle("Check login status")).toBeDisabled();
    expect(screen.getByTitle("Disconnect and delete data")).toBeDisabled();
  });
});
