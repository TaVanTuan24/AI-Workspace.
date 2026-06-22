import { expect, vi } from "vitest";

type ConsoleMethod = "log" | "warn" | "error";

export interface ConsoleCapture {
  messages: string[];
  expectCalledWith: (pattern: RegExp) => void;
  expectOnly: (patterns: RegExp[]) => void;
  restore: () => void;
}

function stringifyArg(arg: unknown): string {
  if (arg instanceof Error) {
    return `${arg.name}: ${arg.message}`;
  }
  if (typeof arg === "string") {
    return arg;
  }
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

export function captureConsole(method: ConsoleMethod): ConsoleCapture {
  const messages: string[] = [];
  const matchedIndexes = new Set<number>();
  const spy = vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
    messages.push(args.map(stringifyArg).join(" "));
  });

  const expectCalledWith = (pattern: RegExp) => {
    const index = messages.findIndex((message, candidateIndex) => !matchedIndexes.has(candidateIndex) && pattern.test(message));
    expect(index, `Expected console.${method} to include ${pattern.toString()}`).toBeGreaterThanOrEqual(0);
    matchedIndexes.add(index);
  };

  return {
    messages,
    expectCalledWith,
    expectOnly(patterns: RegExp[]) {
      for (const pattern of patterns) {
        expectCalledWith(pattern);
      }
      const unexpectedMessages = messages.filter((_, index) => !matchedIndexes.has(index));
      expect(unexpectedMessages, `Unexpected console.${method} messages`).toEqual([]);
    },
    restore() {
      const unexpectedMessages = messages.filter((_, index) => !matchedIndexes.has(index));
      expect(unexpectedMessages, `Unexpected console.${method} messages`).toEqual([]);
      spy.mockRestore();
    }
  };
}
