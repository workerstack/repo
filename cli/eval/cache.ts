import { createHash } from "node:crypto";
/** A disk cache of model completions, keyed by everything that shapes a call; a bad file is a miss. */
import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { writeAtomic } from "../sync/migrate-fs.ts";
import type { Completion } from "./run.ts";

export type CacheParts = { model: string; maxTokens: number; system: string; input: string; sample: number };

export type Cache = { get: (key: string) => Completion | undefined; set: (key: string, done: Completion) => void };

/** The sha256 hex of every part that changes what a call answers. */
export function cacheKey(parts: CacheParts): string {
  const { input, maxTokens, model, sample, system } = parts;

  return createHash("sha256")
    .update(JSON.stringify([model, maxTokens, system, input, sample]))
    .digest("hex");
}

/** The cache in `dir`, one `<key>.json` per completion. */
export function openCache(dir: string): Cache {
  const schema = z.object({ inputTokens: z.number(), outputTokens: z.number(), text: z.string() });

  return {
    get(key) {
      let found: Completion | null = null;

      try {
        const parsed = schema.safeParse(JSON.parse(fs.readFileSync(path.join(dir, `${key}.json`), "utf8")));

        if (parsed.success) found = parsed.data;
      } catch {
        // unreadable or not JSON: a miss
      }

      return found ?? undefined;
    },
    set(key, done) {
      writeAtomic(path.join(dir, `${key}.json`), JSON.stringify(done));
    },
  };
}
