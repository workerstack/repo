import type { FetchResult } from "../listen.types.ts";

/** A fake fetch reply: `over` on top of readers that give an empty text, an empty object and no bytes. */
export function fetchResult(over: Partial<FetchResult> = {}): FetchResult {
  return {
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(""),
    ...over,
  };
}
