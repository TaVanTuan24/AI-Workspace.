"use client";

import { useQuery } from "@tanstack/react-query";
import { ProviderStatusCard } from "../../components/ProviderStatusCard";
import { SessionWarningBanner } from "../../components/SessionWarningBanner";
import { apiGetProviders, getSettingsOverview, hasPermission } from "../../lib/api";

export default function ConnectionsPage() {
  const providers = useQuery({
    queryKey: ["providers"],
    queryFn: apiGetProviders
  });
  const overview = useQuery({
    queryKey: ["settings-overview", "connections"],
    queryFn: getSettingsOverview
  });
  const canWriteConnections = hasPermission(overview.data?.currentUser.permissions, "providerConnections.write");

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Connections</h1>
        <p className="mt-1 text-sm text-muted">
          Manage encrypted local sessions for your personal AI provider accounts.
        </p>
      </div>
      <SessionWarningBanner />
      {!canWriteConnections && !overview.isLoading ? (
        <div className="rounded-md border border-border bg-surface p-3 text-sm text-muted">
          You don't have permission to perform this action.
        </div>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-3">
        {providers.data?.providers.map((provider) => (
          <ProviderStatusCard
            key={provider.provider}
            provider={provider}
            canWriteConnections={canWriteConnections}
            onChanged={() => providers.refetch()}
          />
        ))}
      </div>
    </div>
  );
}
