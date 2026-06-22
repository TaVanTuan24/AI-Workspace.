import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProviderHealthCard } from "./ProviderHealthCard";
import type { ProviderHealth } from "../../../lib/api";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  )
}));

describe("Provider health recovery UI", () => {
  it("renders temporary degraded override metadata without refreshing on render", () => {
    const onRefresh = vi.fn();
    const health: ProviderHealth = {
      provider: "gemini",
      displayName: "Gemini",
      connectionStatus: "connected",
      healthStatus: "healthy",
      readiness: "ready",
      isUsable: true,
      requiresLogin: false,
      capabilities: ["send_message"],
      lastValidatedAt: "2026-06-22T00:00:00.000Z",
      recovery: {
        providerDegraded: true,
        degradedMode: "avoid_if_possible",
        degradedUntil: "2026-06-22T01:00:00.000Z",
        degradedReason: "Provider limit spike"
      }
    };

    render(<ProviderHealthCard health={health} onRefresh={onRefresh} isRefreshing={false} />);

    expect(screen.getByText("Recovery degraded")).toBeInTheDocument();
    expect(screen.getByText("Temporary recovery override active")).toBeInTheDocument();
    expect(screen.getByText("Provider limit spike")).toBeInTheDocument();
    expect(onRefresh).not.toHaveBeenCalled();
  });
});
