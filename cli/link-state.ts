import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { readJson } from "./json.ts";
import { LinkError } from "./link-error.ts";
import { JSON_INDENT, STATE_DIR, STATE_FILE, STATE_VERSION, badState } from "./link.constants.ts";
import { errorMessage } from "./sync-errors.ts";

/** One link: the directory it was packed from, the npm version it replaced, and when it last synced. */
export type LinkEntry = { source: string; npm: string | null; syncedAt: string };

/** The links of an install root, by package name. */
export type LinkState = Record<string, LinkEntry>;

function stateSchema(): z.ZodType<{ version: number; links: LinkState }> {
  const entry = z.object({ npm: z.string().nullable(), source: z.string(), syncedAt: z.string() });

  return z.object({ links: z.record(z.string(), entry), version: z.literal(STATE_VERSION) });
}

function stateFile(root: string): string {
  return path.join(root, STATE_DIR, STATE_FILE);
}

/** The links recorded for `root`; none when the file is absent. */
export function readState(root: string): LinkState {
  const file = stateFile(root);

  if (!fs.existsSync(file)) return {};

  try {
    return readJson(stateSchema(), fs.readFileSync(file, "utf8")).links;
  } catch (error) {
    throw new LinkError(badState(file, errorMessage(error)));
  }
}

/** Writes the state by rename, so a reader never sees half a file and two commands never share a temp file. */
export function writeState(root: string, state: LinkState): void {
  const file = stateFile(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const names = Object.keys(state).toSorted();
  const links = Object.fromEntries(names.map((name) => [name, state[name]]));
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify({ links, version: STATE_VERSION }, null, JSON_INDENT)}\n`);
  fs.renameSync(temp, file);
}
