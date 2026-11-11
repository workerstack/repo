/** `repo persist <kind> [--workspace dir]`: save the stdin body as a plan, roadmap, handoff, implementation or tmp file. */
import path from "node:path";

import { processHookIo, readAllText, type HookIo } from "./hook-io.ts";
import { persistHandoff } from "./persist-handoff.ts";
import { persistImplementation } from "./persist-implementation.ts";
import { persistPlan } from "./persist-plan.ts";
import { persistRoadmap } from "./persist-roadmap.ts";
import { persistTmp } from "./persist-tmp.ts";
import { resolveRoots } from "./workspace-root.ts";

type Saved = { ok: true; serial: number; path: string; filename: string } | { ok: false; error: string };
type Saver = (opts: { workspaceRoot: string; content: string }) => Saved;

const SAVERS: Readonly<Record<string, Saver>> = {
  handoff: persistHandoff,
  implementation: persistImplementation,
  plan: persistPlan,
  roadmap: persistRoadmap,
  tmp: persistTmp,
};

const KINDS = "use plan, roadmap, handoff, implementation or tmp";

const fail = (message: string): number => {
  process.stderr.write(`${message}\n`);
  return 1;
};

/** `--workspace dir`, else the repo root the working directory sits in. */
function workspaceOf(argv: string[]): string {
  const at = argv.indexOf("--workspace");
  return (at >= 0 ? argv[at + 1] : undefined) ?? resolveRoots().root;
}

function saveBody(save: Saver, argv: string[], io: HookIo): number {
  try {
    const workspaceRoot = workspaceOf(argv);
    const result = save({ content: readAllText(io), workspaceRoot });
    if (!result.ok) return fail(result.error);
    const { serial, path: saved, filename } = result;
    io.write(`${JSON.stringify({ absPath: path.resolve(workspaceRoot, saved), filename, path: saved, serial })}\n`);
    return 0;
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

export function main(argv: string[] = [], io: HookIo = processHookIo()): number {
  const kind = argv[0];
  if (kind === undefined) return fail(`repo persist: missing kind; ${KINDS}`);
  const save = Object.hasOwn(SAVERS, kind) ? SAVERS[kind] : undefined;
  if (!save) return fail(`repo persist: unknown kind "${kind}"; ${KINDS}`);
  return saveBody(save, argv, io);
}
