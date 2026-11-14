/**
 * `repo persist <kind> [--workspace dir]`: save the stdin body as a plan, roadmap, handoff, implementation or tmp
 * file.
 */
import path from "node:path";

import { agentDefaults } from "../agent-defaults.ts";
import { processHookIo, readAllText, type HookIo } from "./hook-io.ts";
import { persistHandoff } from "./persist-handoff.ts";
import { persistImplementation } from "./persist-implementation.ts";
import { persistPlan } from "./persist-plan.ts";
import { persistRoadmap } from "./persist-roadmap.ts";
import { persistTmp } from "./persist-tmp.ts";
import type { Strategy } from "./strategy.types.ts";
import { resolveRoots } from "./workspace-root.ts";

type Saved = { ok: true; serial: number; path: string; filename: string } | { ok: false; error: string };

/** A save of one kind; a plan or roadmap sent without a `strategy:` line gets `defaultStrategy`. */
type Saver = (opts: { workspaceRoot: string; content: string; defaultStrategy: Strategy }) => Saved;

const SAVERS = {
  handoff: persistHandoff,
  implementation: persistImplementation,
  plan: persistPlan,
  roadmap: persistRoadmap,
  tmp: persistTmp,
} as const satisfies Readonly<Record<string, Saver>>;

function isKind(kind: string): kind is keyof typeof SAVERS {
  return Object.hasOwn(SAVERS, kind);
}

const KINDS = "use plan, roadmap, handoff, implementation or tmp";

function fail(message: string): number {
  process.stderr.write(`${message}\n`);

  return 1;
}

/** `--workspace dir`, else the repo root the working directory sits in. */
function workspaceOf(argv: string[]): string {
  const at = argv.indexOf("--workspace");

  return (at >= 0 ? argv[at + 1] : undefined) ?? resolveRoots().root;
}

async function saveBody(save: Saver, argv: string[], io: HookIo): Promise<number> {
  try {
    const workspaceRoot = workspaceOf(argv);
    const { defaultStrategy } = await agentDefaults(workspaceRoot);
    const result = save({ content: readAllText(io), defaultStrategy, workspaceRoot });

    if (!result.ok) return fail(result.error);
    const { serial, path: saved, filename } = result;
    io.write(`${JSON.stringify({ absPath: path.resolve(workspaceRoot, saved), filename, path: saved, serial })}\n`);

    return 0;
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

export async function main(argv: string[] = [], io: HookIo = processHookIo()): Promise<number> {
  const kind = argv[0];

  if (kind === undefined) return fail(`repo persist: missing kind; ${KINDS}`);
  const save = isKind(kind) ? SAVERS[kind] : undefined;

  if (save === undefined) return fail(`repo persist: unknown kind "${kind}"; ${KINDS}`);

  return await saveBody(save, argv, io);
}
