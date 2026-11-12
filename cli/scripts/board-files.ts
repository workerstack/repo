/** Where board rows live, and the private-mode reads and atomic writes of one row file. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { z } from "zod";

import { tryJson } from "../json.ts";
import { repoEnv, type Env } from "../repo-env.ts";
import { safe } from "./board-line.ts";
import { BOARD_PARTS, DIR_MODE, FILE_MODE, HEX, RANDOM_SKIP, ROW_EXT } from "./board.constants.ts";
import type { BoardRow } from "./board.types.ts";

export function boardHome(env: Env = repoEnv.process): string {
  const home = env.REPO_BOARD_HOME;

  return home === undefined || home === "" ? os.homedir() : home;
}

export function boardDir(home: string): string {
  return path.join(home, ...BOARD_PARTS);
}

export function rowPath(dir: string, provider: string, session: string): string {
  return path.join(dir, `${safe(provider)}-${safe(session)}${ROW_EXT}`);
}

/** A row file as note writes it; a missing text field reads as "", and a NaN pid was written as null. */
function rowSchema() {
  const text = z.union([z.string(), z.number(), z.boolean()]).transform(String).default("");

  return z.object({
    boot: text,
    cwd: text,
    effort: text,
    model: text,
    pid: z
      .number()
      .nullish()
      .transform((pid) => pid ?? Number.NaN),
    provider: text,
    session: text,
    start: text,
    sticky: z.boolean().default(false),
    time: text,
    work: text,
  });
}

export function readRow(file: string): BoardRow | null {
  try {
    return tryJson(rowSchema(), fs.readFileSync(file, "utf8")) ?? null;
  } catch {
    return null;
  }
}

/** Best effort: Windows cannot always chmod, and a failed chmod must not fail the write. */
export function tryChmod(
  target: string,
  mode: number,
  chmod: (target: string, mode: number) => void = fs.chmodSync,
): void {
  try {
    chmod(target, mode);
  } catch {
    // The mode stays whatever the platform gave the file.
  }
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { mode: DIR_MODE, recursive: true });
  tryChmod(dir, DIR_MODE);
}

export function atomicWrite(file: string, text: string): void {
  const tmp = `${file}.${process.pid}.${Math.random().toString(HEX).slice(RANDOM_SKIP)}.tmp`;
  fs.writeFileSync(tmp, text, { mode: FILE_MODE });
  fs.renameSync(tmp, file);
  tryChmod(file, FILE_MODE);
}
