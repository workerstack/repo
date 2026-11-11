// Workspaces and contexts for the maps suites: the packed maps workspace, a bare self workspace and the index text.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as tar from "tar";
import { expect } from "vitest";
import { BASE_CONFIG } from "../../__fixtures__/base-config.ts";
import { index, type Output, type SyncContext } from "../outputs.ts";
import { put, tempDir } from "./temp-dirs.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_WS = path.join(here, "maps-ws.tgz");
/** The index the packed maps workspace renders to. */
export const GOLDEN_INDEX: string = path.join(here, "maps/golden/INDEX.md");
/** Where the index sits in a workspace. */
export const INDEX: string = "references/INDEX.md";

/** A workspace named like this package, with an empty references dir. */
export function selfWs(prefix: string): string {
  const ws = tempDir(prefix);
  put(ws, "package.json", '{ "name": "@workerstack/repo" }\n');
  fs.mkdirSync(path.join(ws, "references"), { recursive: true });
  return ws;
}

/** The packed maps workspace in a temp dir, with one stock skill installed. */
export function copyFixtureWs(): string {
  const dest = tempDir("maps-ws-");
  // packed, so no skill tree sits live in the repo for an agent to discover
  tar.x({ file: FIXTURE_WS, cwd: dest, sync: true });
  put(dest, "node_modules/@workerstack/repo/agents/skills/beta/SKILL.md", "---\nname: beta\n---\n");
  return dest;
}

/** A context over the real files of `ws`, named like this package or not. */
export function context(ws: string, name = "@workerstack/repo"): SyncContext {
  return {
    root: ws,
    config: {
      packs: ["agents", "docs"],
      agents: { hosts: [], skills: [] },
      ...BASE_CONFIG,
    },
    workspace: { root: ws, manifest: { name }, packages: [] },
    read: (rel) => {
      try {
        return fs.readFileSync(path.join(ws, rel), "utf8");
      } catch {
        return null;
      }
    },
  };
}

/** The index `ws` renders, which must render with no error. */
export function indexText(ws: string): string {
  const result = index(context(ws));
  expect(result.errors).toEqual([]);
  const output: Output | undefined = result.outputs[0];
  if (output?.kind !== "file") throw new Error("no index file");
  return output.content;
}
