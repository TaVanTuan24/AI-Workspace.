"use client";

import { Send, Square } from "lucide-react";

export function UnifiedPromptComposer({
  value,
  onChange,
  onSend,
  disabled
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-3">
      <textarea
        className="min-h-40 w-full resize-y rounded-md border border-border p-3 text-sm outline-none focus:border-accent"
        placeholder="Write a prompt..."
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <div className="flex gap-2">
        <button
          className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          disabled={disabled}
          onClick={onSend}
        >
          <Send className="h-4 w-4" />
          Send
        </button>
        <button
          title="Stop"
          type="button"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border hover:bg-surface"
        >
          <Square className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
