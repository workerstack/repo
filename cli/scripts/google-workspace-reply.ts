/** Reading a Google reply (its JSON body, its error text) and printing a verb's result line. */
import { z } from "zod";

import type { Json } from "../json.ts";
import { filled, rec } from "./google-workspace-account.ts";
import type { Rec } from "./google-workspace.types.ts";

/** The `error.message` of a Google API reply, or the fallback. */
export function apiMessage(json: Json | undefined, fallback: string): string {
  return filled(rec(rec(json).error).message) ?? fallback;
}

export function errMessage(cause: unknown): string {
  const message = typeof cause === "object" && cause !== null && "message" in cause ? cause.message : undefined;

  return (typeof message === "string" ? filled(message) : undefined) ?? String(cause);
}

export async function jsonRecord(r: Response): Promise<Rec> {
  const j = z.json().parse(await r.json());

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
