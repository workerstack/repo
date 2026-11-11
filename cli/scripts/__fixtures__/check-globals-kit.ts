// The check-globals suites' helpers: temp workspaces and homes, the yolo CLI run, settings edits and drift picks.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect } from "vitest";

import { bunPath } from "../../../dev/test-paths";
import { childEnv } from "../../env.ts";
import { tempDir } from "../../sync/__fixtures__/temp-dirs.ts";
import type { CheckResult, DriftEntry } from "../check-globals.ts";
import { syncGlobals } from "../sync-global-settings.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, "..", "..", "..");
const repoBin = path.join(repoRoot, "bin", "repo.ts");
export const HINT = "run `bun repo yolo`";

const tmpDirs: string[] = [];

/** A temp dir from `tempDir`, kept in the list `madeDirs` returns. */
export function tmpDir(prefix: string) {
  const dir = tempDir(prefix);
  tmpDirs.push(dir);
  return dir;
}

export const PROJECT_OK = `[plugins]
enabled = []

[permission]
deny = [ "MCPTool" ]
`;

/** Workspace holding the real manifest and payloads plus a clean project grok config. */
export function tmpWorkspace(projectConfig: string | null = PROJECT_OK) {
  const ws = tmpDir("yolo-ws-");
  fs.cpSync(path.join(repoRoot, "agents/global-settings"), path.join(ws, "agents/global-settings"), {
    recursive: true,
  });
  if (projectConfig !== null) {
    fs.mkdirSync(path.join(ws, ".grok"), { recursive: true });
    fs.writeFileSync(path.join(ws, ".grok/config.toml"), projectConfig);
  }
  return ws;
}

export function syncedHome(ws: string) {
  const home = tmpDir("yolo-home-");
  expect(syncGlobals({ apply: true, home, workspaceRoot: ws }).ok).toBe(true);
  return home;
}

export function runCli(cwd: string, home: string) {
  return spawnSync(bunPath(), [repoBin, "yolo", "--check"], {
    cwd,
    encoding: "utf8",
    env: childEnv({ HOME: home }),
    timeout: 20_000,
  });
}

/** The settings keys the cases below edit. */
export type SettingsJson = {
  approvalMode?: string;
  permissions: { defaultMode?: string; token?: string };
  extra?: boolean;
  apiKey?: string;
  hooks?: unknown;
};

export function editJson(file: string, edit: (v: SettingsJson) => void) {
  const v = JSON.parse(fs.readFileSync(file, "utf8")) /* the cases edit settings files sync wrote */ as SettingsJson;
  edit(v);
  fs.writeFileSync(file, JSON.stringify(v));
}

/** Every temp dir this file's cases made so far. */
export function madeDirs(): readonly string[] {
  return [...tmpDirs];
}

/** The first drift entry of `r`; throws when there is none. */
export function firstDrift(r: CheckResult): DriftEntry {
  const [first] = r.drift ?? [];
  if (first === undefined) throw new Error("no drift");
  return first;
}

/** A temp dir named from `prefix` holding a copy of this repo's `agents/global-settings`. */
export function stockCopy(prefix: string): string {
  const stock = tmpDir(prefix);
  fs.cpSync(path.join(repoRoot, "agents/global-settings"), path.join(stock, "agents/global-settings"), {
    recursive: true,
  });
  return stock;
}

/** A temp dir named from `prefix` holding only a clean project grok config. */
export function projectOnly(prefix: string): string {
  const ws = tmpDir(prefix);
  fs.mkdirSync(path.join(ws, ".grok"), { recursive: true });
  fs.writeFileSync(path.join(ws, ".grok/config.toml"), PROJECT_OK);
  return ws;
}
