import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  ActionConfigFields,
  RecoveryOverrideTable,
  defaultAction
} from "./RecoveryOverrideUi";
import type { ProviderRecoveryOverrideView } from "../../../lib/api";

describe("Provider Recovery UI", () => {
  it("renders active override details and calls rollback", () => {
    const onRollback = vi.fn();
    const overrides: ProviderRecoveryOverrideView[] = [
      {
        id: "override_1",
        actionType: "disable_model_temporarily",
        provider: "chatgpt",
        modelId: "chatgpt-web",
        status: "active",
        reason: "Provider UI drift detected",
        startsAt: "2026-06-22T00:00:00.000Z",
        expiresAt: "2026-06-22T01:00:00.000Z"
      }
    ];

    render(<RecoveryOverrideTable overrides={overrides} onRollback={onRollback} />);

    expect(screen.getByText("disable_model_temporarily")).toBeInTheDocument();
    expect(screen.getByText("chatgpt-web")).toBeInTheDocument();
    expect(screen.getByText("Provider UI drift detected")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /rollback/i }));
    expect(onRollback).toHaveBeenCalledWith("override_1");
  });

  it("disables rollback for expired override rows after refresh", () => {
    const { rerender } = render(
      <RecoveryOverrideTable
        overrides={[
          {
            id: "override_1",
            actionType: "disable_model_temporarily",
            provider: "chatgpt",
            modelId: "chatgpt-web",
            status: "active",
            startsAt: "2026-06-22T00:00:00.000Z",
            expiresAt: "2026-06-22T01:00:00.000Z"
          }
        ]}
        onRollback={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: /rollback/i })).toBeEnabled();

    rerender(
      <RecoveryOverrideTable
        overrides={[
          {
            id: "override_1",
            actionType: "disable_model_temporarily",
            provider: "chatgpt",
            modelId: "chatgpt-web",
            status: "expired",
            startsAt: "2026-06-22T00:00:00.000Z",
            expiresAt: "2026-06-22T01:00:00.000Z"
          }
        ]}
        onRollback={vi.fn()}
      />
    );

    expect(screen.getByText("expired")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /rollback/i })).toBeDisabled();
  });

  it("shows duration config for bounded recovery actions", () => {
    const actionTypes = [
      "mark_provider_temporarily_degraded",
      "prefer_fallback_provider",
      "disable_model_temporarily"
    ] as const;

    for (const type of actionTypes) {
      const { unmount } = render(
        <ActionConfigFields
          type={type}
          action={defaultAction(type)}
          onChange={vi.fn()}
        />
      );
      expect(screen.getByLabelText(/duration minutes/i)).toBeInTheDocument();
      unmount();
    }
  });
});
