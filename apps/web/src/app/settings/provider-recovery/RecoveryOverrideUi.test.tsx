import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RecoveryOverrideTable } from "./RecoveryOverrideUi";

describe("RecoveryOverrideTable permissions", () => {
  it("disables rollback controls without providerRecovery.write", () => {
    render(
      <RecoveryOverrideTable
        canRollback={false}
        onRollback={vi.fn()}
        overrides={[
          {
            id: "override_1",
            actionType: "prefer_fallback_provider",
            provider: "gemini",
            status: "active",
            startsAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 60_000).toISOString()
          }
        ]}
      />
    );

    expect(screen.getByRole("button", { name: /rollback/i })).toBeDisabled();
  });
});
