import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  ProviderRow,
  ProviderWarning,
  isSendBlockedForState
} from "./ChatWorkspace";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  )
}));

describe("Chat workspace recovery states", () => {
  const provider = {
    provider: "chatgpt",
    displayName: "ChatGPT",
    status: "connected",
    readiness: "ready",
    capabilities: ["send_message"]
  } as any;

  it("disables a temporarily disabled provider row without submitting prompts", () => {
    const onChange = vi.fn();

    render(
      <ProviderRow
        provider={provider}
        model={{
          provider: "chatgpt",
          displayName: "ChatGPT Web",
          modelId: "chatgpt-web",
          isUsable: false,
          recovery: {
            temporarilyDisabled: true,
            providerDegraded: false,
            disabledUntil: "2026-06-22T01:00:00.000Z"
          }
        } as any}
        checked={true}
        type="radio"
        onChange={onChange}
      />
    );

    expect(screen.getByText("temporarily disabled")).toBeInTheDocument();
    expect(screen.getByRole("radio")).toBeDisabled();
    fireEvent.click(screen.getByRole("radio"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("blocks send for unusable selected single model", () => {
    expect(isSendBlockedForState({
      mode: "single",
      selectedSingleModel: {
        isUsable: false,
        recovery: {
          temporarilyDisabled: true,
          providerDegraded: false
        }
      } as any,
      selectedCompareCount: 0,
      selectedCompareUsableCount: 0
    })).toBe(true);
  });

  it("renders degraded provider warning", () => {
    render(
      <ProviderWarning
        title="ChatGPT is temporarily degraded"
        message="A recovery policy recommends using a fallback provider if possible."
        actionHref="/settings/provider-recovery"
        actionLabel="Review overrides"
      />
    );

    expect(screen.getByText("ChatGPT is temporarily degraded")).toBeInTheDocument();
    expect(screen.getByText(/fallback provider/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /review overrides/i })).toHaveAttribute("href", "/settings/provider-recovery");
  });
});
