/** The `agent models` row: every model a generated agent file names must be one its CLI still offers. */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { readEnv } from "../env.ts";
import { byCodeUnit } from "../sync/by-code-unit.ts";
import { codexOffered, MODEL_LISTS } from "./doctor-lists.ts";
import { errorText, packageRoot, row } from "./doctor-rows.ts";
import { winShim } from "./doctor-which.ts";
import {
  AGY_AGENT_MODELS,
  CAPPED,
  ENOENT,
  GROK_GLOBALS_REL,
  INHERIT,
  MODEL_CLIS,
  MODEL_LIST_CAP_MS,
  MS_PER_SECOND,
  OFFERED_SHOWN,
} from "./doctor.constants.ts";
import type { AgentModelsOpts, ListCli, ListResult, ListRunner, ModelCli, ModelRef, Offered } from "./doctor.types.ts";
import { isRecord } from "./hook-input.ts";
import { resolveRoots } from "./workspace-root.ts";

const LINE_RE = /\r?\n/;
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;
const FRONTMATTER_MODEL_RE = /^model:[ \t]*["']?([^"'\r\n]+?)["']?[ \t]*$/m;
const TOML_MODEL_RE = /^model[ \t]*=[ \t]*"([^"\n]+)"/m;
const SUBAGENT_TABLE_RE = /^\[subagents\.models\][ \t]*$/m;
const TOML_VALUE_RE = /^[\w-]+[ \t]*=[ \t]*"([^"]+)"/;

/** What `listedModels` needs: the runner, the shared abort signal, the cap promise and its length. */
type Ask = { run: ListRunner; signal: AbortSignal; capped: Promise<typeof CAPPED>; capMs: number };

function frontmatterModel(text: string): string | undefined {
  const fm = FRONTMATTER_RE.exec(text);
  return fm?.[1] === undefined ? undefined : FRONTMATTER_MODEL_RE.exec(fm[1])?.[1];
}

function tomlModel(text: string): string | undefined {
  return TOML_MODEL_RE.exec(text)?.[1];
}

/** Values of the `[subagents.models]` table, read without a TOML parser (setup imports doctor before smol-toml). */
function subagentModels(text: string): string[] {
  const at = text.search(SUBAGENT_TABLE_RE);
  if (at < 0) return [];
  const table = text.slice(at).split(LINE_RE).slice(1);
  const end = table.findIndex((l) => l.startsWith("["));
  const body = table.slice(0, end > 0 ? end : table.length);
  return body.flatMap((l) => TOML_VALUE_RE.exec(l)?.[1] ?? []);
}

function readAt(root: string, rel: string): string {
  try {
    return fs.readFileSync(path.join(root, ...rel.split("/")), "utf8");
  } catch {
    return "";
  }
}

function dirFiles(checkout: string, rel: string, ext: string): string[] {
  try {
    return fs
      .readdirSync(path.join(checkout, ...rel.split("/")))
      .filter((n) => n.endsWith(ext))
      .toSorted(byCodeUnit)
      .map((n) => `${rel}/${n}`);
  } catch {
    return [];
  }
}

/**
 * Every model the checkout's generated agent files (plus the grok roles and global settings) name, per CLI.
 * The offered set differs per CLI: codex reads a cache file, agy is a fixed set, grok and cursor run list commands.
 * Claude agents use stable aliases and are not read.
 */
function agentModelRefs(checkout: string, sourceRoot: string): ModelRef[] {
  const refs: ModelRef[] = [];
  function add(cli: ModelCli, files: string[], models: (text: string) => (string | undefined)[]): void {
    for (const file of files)
      for (const model of models(readAt(checkout, file))) if (model !== undefined) refs.push({ cli, file, model });
  }
  add("codex", dirFiles(checkout, ".codex/agents", ".toml"), (t) => [tomlModel(t)]);
  add("grok", dirFiles(checkout, ".grok/agents", ".md"), (t) => [frontmatterModel(t)]);
  add("grok", dirFiles(checkout, ".grok/roles", ".toml"), (t) => [tomlModel(t)]);
  for (const model of subagentModels(readAt(sourceRoot, GROK_GLOBALS_REL)))
    refs.push({ cli: "grok", file: GROK_GLOBALS_REL, model });
  add("agy", dirFiles(checkout, ".agents/agents", ".md"), (t) => [frontmatterModel(t)]);
  // `inherit` runs the parent session's model, which the account can always use, so it names nothing to check.
  add("cursor", dirFiles(checkout, ".cursor/agents", ".md"), (t) => [frontmatterModel(t)].filter((m) => m !== INHERIT));
  return refs;
}

/**
 * Real list runner: resolves { code, stdout, stderr }; rejects with ENOENT when the CLI is not on PATH, or when the
 * signal aborts it.
 */
function spawnList(bin: string, args: string[], { signal }: { signal: AbortSignal }): Promise<ListResult> {
  return new Promise<ListResult>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(bin, args, { shell: winShim(bin), signal, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stderr, stdout }));
  });
}

/** One CLI's offered ids, or why it is skipped. `capped` settles when the shared cap is over. */
async function listedModels(cli: ListCli, { run, signal, capped, capMs }: Ask): Promise<Offered> {
  const { bin, args, ids } = MODEL_LISTS[cli];
  try {
    const r = await Promise.race([run(bin, args, { signal }), capped]);
    if (r === CAPPED) return { skip: `${cli} models took over ${capMs / MS_PER_SECOND} s` };
    if (r.code !== 0) {
      const first = r.stderr.split(LINE_RE).find((l) => l.trim() !== "");
      return { skip: `${cli} models failed: ${first === undefined ? `exit ${r.code}` : first.trim()}` };
    }
    const found = ids(r.stdout);
    return found.length > 0 ? { ids: found } : { skip: `${cli} models failed: no models listed` };
  } catch (err) {
    if (isRecord(err) && err.code === ENOENT) return { skip: `${cli} not installed` };
    return { skip: `${cli} models failed: ${errorText(err).split("\n")[0]}` };
  }
}

function offeredBy(cli: ModelCli, home: string, ask: Ask): Promise<Offered> {
  if (cli === "codex") return Promise.resolve(codexOffered(home));
  if (cli === "agy") return Promise.resolve({ ids: AGY_AGENT_MODELS });
  return listedModels(cli, ask);
}

/** Every CLI's offered ids, all asked at once under one shared cap that aborts whatever is still running. */
async function offeredLists(clis: ModelCli[], home: string, ask: Pick<Ask, "capMs" | "run">) {
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const capped = new Promise<typeof CAPPED>((resolve) => {
    timer = setTimeout(() => {
      resolve(CAPPED);
      abort.abort();
    }, ask.capMs);
  });
  const full = { ...ask, capped, signal: abort.signal };
  const lists = await Promise.all(
    clis.map(async (cli): Promise<[ModelCli, Offered]> => [cli, await offeredBy(cli, home, full)]),
  );
  clearTimeout(timer);
  return lists;
}

/**
 * The `agent models` row: every model an agent file names must be one its CLI still offers.
 * codex is read from its models cache, agy is checked against a fixed set (never skipped), grok and cursor run list
 * commands. Report only. A CLI that is missing, fails, or outlasts the one shared cap is skipped, and the row says so.
 */
export async function agentModelsLines({
  cwd = process.cwd(),
  env = readEnv(),
  home = os.homedir(),
  run = spawnList,
  capMs = MODEL_LIST_CAP_MS,
  sourceRoot = packageRoot(),
}: AgentModelsOpts = {}): Promise<string[]> {
  const refs = agentModelRefs(resolveRoots({}, { cwd, env }).checkout, sourceRoot);
  const clis = MODEL_CLIS.filter((cli) => refs.some((r) => r.cli === cli));
  const lists = await offeredLists(clis, home, { capMs, run });
  const offered = new Map(lists);
  const skipped = lists.flatMap(([, l]) => l.skip ?? []);
  const fixes = refs.flatMap(({ cli, file, model }) => {
    const ids = offered.get(cli)?.ids; // every ref's cli is in clis
    if (ids === undefined || ids.includes(model)) return [];
    return `- ${file}: model ${model} is not offered by ${cli}; offered: ${ids.slice(0, OFFERED_SHOWN).join(", ")}`;
  });
  const note = skipped.length > 0 ? `(skipped: ${skipped.join("; ")})` : "";
  return fixes.length > 0
    ? [row("agent models", `${fixes.length} to fix`, note), ...fixes]
    : [row("agent models", "ok", note)];
}
