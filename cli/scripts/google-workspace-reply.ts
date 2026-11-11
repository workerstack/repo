/** Reading a Google reply (its JSON body, its error text) and printing a verb's result line. */
import { filled, rec } from "./google-workspace-account.ts";
import type { Rec } from "./google-workspace.types.ts";
import { isRecord } from "./hook-input.ts";

/** The `error.message` of a Google API reply, or the fallback. */
export function apiMessage(json: unknown, fallback: string): string {
  return filled(rec(rec(json).error).message) ?? fallback;
}

export function errMessage(e: unknown): string {
  const m = isRecord(e) ? filled(e.message) : undefined;
  return m ?? String(e);
}

export async function jsonRecord(r: Response): Promise<Rec> {
  const j: unknown = await r.json();
  return rec(j);
}

export function fail(msg: string): number {
  process.stderr.write(`${msg.trimEnd()}\n`);
  return 1;
}

export function ok(msg: string): number {
  process.stdout.write(`${msg.trimEnd()}\n`);
  return 0;
}
