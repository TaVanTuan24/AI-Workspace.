import type { ProviderId } from "@uaiw/shared/types/provider";
import { RotateCcw } from "lucide-react";

export function StreamingResponseCard({
  provider,
  status,
  text,
  message
}: {
  provider: ProviderId;
  status: string;
  text: string;
  message?: string;
}) {
  return (
    <article className="min-h-96 rounded-md border border-border bg-panel p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold capitalize">{provider}</h2>
        <span className="rounded-md bg-surface px-2 py-1 text-xs text-muted">{status}</span>
      </div>
      {message ? (
        <div className="mt-4 rounded-md border border-warn/40 bg-amber-50 p-3 text-sm text-amber-950">
          {message}
          <button className="mt-3 inline-flex items-center gap-2 rounded-md border border-border bg-white px-2 py-1 text-xs">
            <RotateCcw className="h-3 w-3" />
            Reconnect
          </button>
        </div>
      ) : null}
      <pre className="mt-4 whitespace-pre-wrap break-words text-sm leading-6">
        {text || "No response yet."}
      </pre>
    </article>
  );
}
