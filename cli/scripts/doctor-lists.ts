/** Where each CLI's offered model ids come from: codex's models cache, or a list command's output. */
import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { tryJson } from "../json.ts";
import type { ListCli, Offered } from "./doctor.types.ts";

const LINE_RE = /\r?\n/;
const CURSOR_ID_RE = /^(\S+) - /;
const GROK_ID_RE = /^\s+(?:\*\s+)?(\S+)/;
const GROK_HEADER = "Available models:";

function firstGroups(out: string, re: RegExp): string[] {
  return out.split(LINE_RE).flatMap((l) => re.exec(l)?.[1] ?? []);
}

function modelsCacheSchema() {
  return z.looseObject({ models: z.array(z.looseObject({ slug: z.string().optional() })) });
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

  const ids = tryJson(modelsCacheSchema(), text)
    ?.models.flatMap((m) => m.slug ?? [])
    .filter((slug) => slug !== "");

  if (ids !== undefined && ids.length > 0) return { ids };

  return { skip: `codex models cache malformed at ${file}` };
}
