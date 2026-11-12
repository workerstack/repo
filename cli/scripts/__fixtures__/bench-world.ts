// A temp repo with bench specs and fake process runner, clock, machine, git and gh for `repo bench`'s main.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { LINUX, METRICS, SAMPLES, SHA } from "../../bench/__fixtures__/usage.ts";
import { put, tempDir } from "../../sync/__fixtures__/temp-dirs.ts";
import type { Machine } from "../../bench/score.ts";
import { main } from "../bench.ts";
import { answerer, ok, type World } from "./ci-wait-world.ts";

export { ok, bad } from "./ci-wait-world.ts";
export { SHA } from "../../bench/__fixtures__/usage.ts";

const MB = 1024 ** 2;
const SPECS = path.join(path.dirname(fileURLToPath(import.meta.url)), "bench");
export const RUN_URL = "https://github.com/o/r/actions/runs/123";

/** What one spawn of a candidate command gives; `wall` advances the fake clock by that many ms. */
export type Spawned = { code?: number; stdout?: string; stderr?: string; wall?: number; rss?: number; cpu?: number };
/** Answers the `call`-th spawn (0-based) of one command. */
export type Script = (call: number) => Spawned;

/** The Usage samples as a script: call 0 is the warmup, call n is measured run n. */
export function usageScript(samples: (typeof SAMPLES)[keyof typeof SAMPLES]): Script {
  return (call) => {
    const at = Math.max(0, call - 1);
    return { wall: samples.wall[at], rss: samples.rss[at], stdout: `noise\nbench: {"ops": ${samples.ops[at]}}\n` };
  };
}

/** The startup spec's three commands: bun, node and node's setup. */
export const STARTUP: Record<string, Script> = {
  "bun -e 1": usageScript(SAMPLES.bun),
  "bun -e 2": usageScript(SAMPLES.node),
  "bun -e 0": () => ({ wall: 500 }),
};

/** HEAD at `SHA` on branch feat, pushed, clean, with bench.yml on origin/main. */
export const REMOTE_GIT: World = {
  "rev-parse HEAD": ok(`${SHA}\n`),
  "status --porcelain": ok(""),
  "rev-parse --abbrev-ref HEAD": ok("feat\n"),
  "rev-parse --abbrev-ref origin/HEAD": ok("origin/main\n"),
  "cat-file -e origin/main:.github/workflows/bench.yml": ok(),
  "rev-parse --verify --quiet refs/remotes/origin/feat": ok(`${SHA}\n`),
};

/** A CI machine's raw result for the startup spec at `SHA`, as the bench job uploads it. */
export function rawOn(env: {
  label: string;
  platform: string;
  arch: string;
  cpu: string;
  cores: number;
  memoryBytes: number;
  rssFloorBytes?: number | null;
}) {
  const candidates = Object.entries(SAMPLES).map(([name, samples]) => ({ name, samples }));
  return { spec: "startup", env: { ...env, bun: "1.4.4", sha: SHA, dirty: false }, runs: 10, warmup: 1, metrics: METRICS, candidates };
}

export type BenchWorld = {
  specs?: string[];
  files?: Record<string, string>;
  spawn?: Record<string, Script>;
  machine?: Partial<Machine>;
  git?: World;
  gh?: World;
  /** What `gh run download` writes: each artifact's raw JSON by os label. */
  artifacts?: Record<string, { spec: string }>;
};

/** A temp repo holding each named fixture spec under `.repo/bench`, re-exported by path. */
function repoWith(specs: string[], files: Record<string, string>) {
  const root = tempDir("workerstack-bench-");
  for (const name of specs) {
    const target = path.relative(path.join(root, ".repo", "bench"), path.join(SPECS, `${name}.bench.ts`));
    put(root, `.repo/bench/${name}.bench.ts`, `export { default } from ${JSON.stringify(target.split(path.sep).join("/"))};\n`);
  }
  for (const [rel, text] of Object.entries(files)) put(root, rel, text);
  return root;
}

/**
 * gh answering from `table`, except `run download`, which writes `artifacts` the way gh lays them out. The answerer
 * shifts answer lists as it goes, so each run gets its own copies and a shared table answers every test alike.
 */
function fakeGh(table: World, artifacts: Record<string, { spec: string }>, calls: string[]) {
  const fresh = Object.fromEntries(Object.entries(table).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value]));
  const answer = answerer("gh", fresh, calls);
  return (args: string[], cwd: string) => {
    if (args[0] !== "run" || args[1] !== "download") return answer(args, cwd);
    calls.push(`gh ${args.join(" ")}`);
    const dir = path.resolve(cwd, args[args.indexOf("--dir") + 1] ?? "");
    for (const [os, raw] of Object.entries(artifacts)) put(dir, `bench-${raw.spec}-${os}/${os}.json`, JSON.stringify(raw));
    return ok();
  };
}

/** A process runner that answers each command from its script and advances the clock by the run's wall. */
function fakeSpawn(scripts: Record<string, Script>, counts: Map<string, number>, tick: (ms: number) => void) {
  const quiet: Script = () => ({ rss: 10, wall: 1 });
  return (cmd: readonly string[]) => {
    const key = cmd.join(" ");
    const call = counts.get(key) ?? 0;
    counts.set(key, call + 1);
    const got = (scripts[key] ?? quiet)(call);
    tick(got.wall ?? 0);
    const cpu = BigInt(Math.round((got.cpu ?? 0) * 1000));
    const usage = { maxRSS: (got.rss ?? 0) * MB, cpuTime: { user: cpu, system: 0n, total: cpu } };
    return { code: got.code ?? 0, stdout: got.stdout ?? "", stderr: got.stderr ?? "", usage };
  };
}

const LOCAL_GIT: World = { "rev-parse HEAD": ok(`${SHA}\n`), "status --porcelain": ok(" M x.ts\n") };

/** Runs `repo bench` with `argv` in a fresh world and returns its exit, output, calls and spawn counts by command. */
export async function bench(argv: string[], world: BenchWorld = {}) {
  const root = repoWith(world.specs ?? ["startup"], world.files ?? {});
  const calls: string[] = [];
  const counts = new Map<string, number>();
  let clock = 0;
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(argv, {
    cwd: root,
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    now: () => clock,
    sleep: (ms) => Promise.resolve(void (clock += ms)),
    machine: () => ({ ...LINUX, ...world.machine }),
    git: answerer("git", world.git ?? LOCAL_GIT, calls),
    gh: fakeGh(world.gh ?? {}, world.artifacts ?? {}, calls),
    spawn: fakeSpawn(world.spawn ?? STARTUP, counts, (ms) => void (clock += ms)),
  });
  const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
  return { code, out: out.join(""), err: err.join(""), calls, counts, root, read };
}
