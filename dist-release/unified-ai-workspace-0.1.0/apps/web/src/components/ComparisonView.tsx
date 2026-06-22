import type { ProviderId } from "@uaiw/shared/types/provider";
import { StreamingResponseCard } from "./StreamingResponseCard";

export function ComparisonView({
  responses
}: {
  responses: Array<{ provider: ProviderId; status: string; text: string; message?: string }>;
}) {
  return (
    <section className="grid gap-4 xl:grid-cols-3">
      {responses.map((response) => (
        <StreamingResponseCard key={response.provider} {...response} />
      ))}
    </section>
  );
}
