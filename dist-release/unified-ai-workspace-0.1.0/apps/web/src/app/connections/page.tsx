"use client";

import { useQuery } from "@tanstack/react-query";
import { ProviderStatusCard } from "../../components/ProviderStatusCard";
import { SessionWarningBanner } from "../../components/SessionWarningBanner";
import { apiGetProviders } from "../../lib/api";

export default function ConnectionsPage() {
  const providers = useQuery({
    queryKey: ["providers"],
    queryFn: apiGetProviders
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Connections</h1>
        <p className="mt-1 text-sm text-muted">
          Manage encrypted local sessions for your personal AI provider accounts.
        </p>
      </div>
      <SessionWarningBanner />
      <div className="grid gap-4 lg:grid-cols-3">
        {providers.data?.providers.map((provider) => (
          <ProviderStatusCard
            key={provider.provider}
            provider={provider}
            onChanged={() => providers.refetch()}
          />
        ))}
      </div>
    </div>
  );
}
