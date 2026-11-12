/** Where each CLI's offered model ids come from: codex's models cache, or a list command's output. */
import fs from "node:fs";
import path from "node:path";

import type { ListCli, Offered } from "./doctor.types.ts";
import { isRecord } from "./hook-input.ts";

const LINE_RE = /\r?\n/;
const CURSOR_ID_RE = /^(\S+) - /;
const GROK_ID_RE = /^\s+(?:\*\s+)?(\S+)/;
const GROK_HEADER = "Available models:";

function firstGroups(out: string, re: RegExp): string[] {
  return out.split(LINE_RE).flatMap((l) => re.exec(l)?.[1] ?? []);
}

/** Each CLI's list command and how to read ids out of its output. */
export const MODEL_LISTS: Record<ListCli, { bin: string; args: string[]; ids: (out: string) => string[] }> = {
  cursor: { args: ["--list-models"], bin: "cursor-agent", ids: (out) => firstGroups(out, CURSOR_ID_RE) },
  grok: {
    args: ["models"],
    bin: "grok",
    ids: (out) => firstGroups(out.slice(Math.max(0, out.indexOf(GROK_HEADER))), GROK_ID_RE),
  },
};

/** The slugs in codex's models cache, or why the cache cannot be read. */
export function codexOffered(home: string): Offered {
  const file = path.join(home, ".codex", "models_cache.json");
  let text: string;

  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return { skip: `codex models cache missing at ${file}` };
  }

  try {
    const parsed: unknown = JSON.parse(text);

    if (!isRecord(parsed) || !Array.isArray(parsed.models)) throw new Error("malformed");
    const ids: string[] = [];

    for (const m of parsed.models) {
      if (!isRecord(m)) throw new Error("malformed");

      if (typeof m.slug === "string" && m.slug !== "") ids.push(m.slug);
    }

    if (ids.length > 0) return { ids };
  } catch {
    // malformed
  }

  return { skip: `codex models cache malformed at ${file}` };
}
