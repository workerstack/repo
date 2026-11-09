import type { Captured } from "../scripts/lint.ts";
import type { MutateConfig, MutateDeps } from "../mutate-deps.ts";

export const SHA = "09ed564aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
export const BASE = "/tmp/workerstack-mutate-1";
export const CLONE = `${BASE}/repo`;
export const STRYKER_PKG = `${CLONE}/node_modules/@stryker-mutator/core/package.json`;
export const RUNNER_PKG = `${CLONE}/node_modules/@stryker-mutator/vitest-runner/package.json`;
const OK: Captured = { code: 0, stdout: "", stderr: "" };

export type Sim = {
  tracked: string[];
  dirty: boolean;
  /** The sources of the clone, by root-relative path. */
  sources: Record<string, string>;
  installed: boolean;
  gitFails: string | null;
  installFails: boolean;
  /** What a Stryker run does: its exit, its output and the raw report it leaves. */
  stryker: { code: number; output: string; report: unknown };
  config: MutateConfig | string[];
};

const rawReport = (files: Record<string, string[]>) => ({
  files: Object.fromEntries(
    Object.entries(files).map(([file, statuses]) => [
      file,
      {
        mutants: statuses.map((status, i) => ({
          status,
          mutatorName: "ArithmeticOperator",
          location: { start: { line: i + 1, column: 2 } },
        })),
      },
    ]),
  ),
});

export function sim(over: Partial<Sim> = {}): Sim {
  return {
    tracked: ["src/a.ts", "src/b.ts", "src/a.test.ts", "src/fixtures/c.ts", "src/types.d.ts", "docs/x.ts"],
    dirty: false,
    sources: { "src/a.ts": "a\n".repeat(30), "src/b.ts": "b\n".repeat(10) },
    installed: true,
    gitFails: null,
    installFails: false,
    stryker: { code: 0, output: "", report: rawReport({ "src/a.ts": ["Killed", "Survived"], "src/b.ts": ["Killed"] }) },
    config: { root: "/repo", mutate: ["src/**/*.ts"], floors: "mutation-floors.json" },
    ...over,
  };
}

export { rawReport };

export type Fakes = { deps: MutateDeps; calls: string[]; out: string[]; err: string[]; files: Map<string, string> };

type RawReport = { files?: Record<string, unknown> };
type StrykerConfig = { mutate: string[]; jsonReporter: { fileName: string } };

/** The raw report a Stryker run leaves: the planned one, cut to the files the run's config mutates. */
function leave(state: Sim, files: Map<string, string>, configPath: string): void {
  const config = JSON.parse(files.get(configPath) ?? "{}") /* the config the command wrote */ as StrykerConfig;
  const planned = state.stryker.report as /* the test plants an object */ RawReport;
  const mutated = Object.entries(typeof planned.files === "object" ? planned.files : {}).filter(([file]) => config.mutate.includes(file));
  const planted = typeof planned.files === "object";
  const report = planted ? { files: Object.fromEntries(mutated) } : planned;
  files.set(config.jsonReporter.fileName, JSON.stringify(report));
}

function gitOf(state: Sim, calls: string[]): MutateDeps["git"] {
  return (_cwd, args) => {
    calls.push(`git ${args.join(" ")}`);
    if (state.gitFails !== null && args.includes(state.gitFails)) return { code: 128, stdout: "", stderr: "boom\n" };
    if (args[0] === "rev-parse") return { ...OK, stdout: `${SHA}\n` };
    if (args[0] === "status") return { ...OK, stdout: state.dirty ? " M src/a.ts\n" : "" };
    if (args[0] === "ls-tree") return { ...OK, stdout: `${state.tracked.join("\n")}\n` };
    return OK;
  };
}

function runOf(state: Sim, calls: string[], files: Map<string, string>): MutateDeps["run"] {
  return (args, cwd) => {
    calls.push(`bun ${args.join(" ")} @${cwd}`);
    if (args[0] === "install") return state.installFails ? { code: 1, stdout: "", stderr: "lock\n" } : OK;
    leave(state, files, args.at(-1) ?? "");
    return { code: state.stryker.code, stdout: state.stryker.output, stderr: "" };
  };
}

export function fakes(state: Sim = sim(), packages: string[] = []): Fakes {
  const calls: string[] = [];
  const files = new Map<string, string>();
  const out: string[] = [];
  const err: string[] = [];
  const git = gitOf(state, calls);
  const run = runOf(state, calls, files);
  const deps: MutateDeps = {
    cwd: "/repo",
    config: async () => state.config,
    packages: () => packages,
    git,
    run,
    preload: "/pkg/cli/stryker-preload.ts",
    out: (text) => out.push(text),
    err: (text) => err.push(text),
    fs: {
      mkdtemp: (prefix) => {
        calls.push(`mkdtemp ${prefix}`);
        return BASE;
      },
      rm: (target) => {
        calls.push(`rm ${target}`);
        for (const key of [...files.keys()]) if (key.startsWith(target)) files.delete(key);
      },
      read: (file) => {
        if (file === STRYKER_PKG || file === RUNNER_PKG) {
          return state.installed ? JSON.stringify({ bin: { stryker: "bin/stryker.js" } }) : null;
        }
        const source = state.sources[file.replace(`${CLONE}/`, "")];
        return files.get(file) ?? source ?? null;
      },
      write: (file, text) => void files.set(file, text),
      list: (dir) => {
        const names = [...files.keys()].filter((k) => k.startsWith(`${dir}/`)).map((k) => k.slice(dir.length + 1));
        return names.length > 0 ? names : null;
      },
    },
  };
  return { deps, calls, out, err, files };
}
