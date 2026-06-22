import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StatusBadge } from "./StatusBadge";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  )
}));

describe("Model settings recovery badges", () => {
  it("shows temporarily disabled state and expiry", () => {
    render(
      <StatusBadge
        isUsable={false}
        status="healthy"
        recovery={{
          temporarilyDisabled: true,
          disabledUntil: "2026-06-22T01:00:00.000Z",
          disabledReason: "Provider UI drift detected",
          providerDegraded: false
        }}
      />
    );

    expect(screen.getByText("Temporarily Disabled")).toBeInTheDocument();
    expect(screen.getByText(/until/i)).toBeInTheDocument();
  });

  it("shows degraded provider warning state", () => {
    render(
      <StatusBadge
        isUsable={true}
        status="healthy"
        recovery={{
          temporarilyDisabled: false,
          providerDegraded: true,
          degradedMode: "avoid_if_possible",
          degradedUntil: "2026-06-22T01:00:00.000Z",
          degradedReason: "Spike detected"
        }}
      />
    );

    expect(screen.getByText("Degraded")).toBeInTheDocument();
    expect(screen.getByText(/until/i)).toBeInTheDocument();
  });
});
