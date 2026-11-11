// Shared fakes and setup for the suites that drive `start`: each suite makes its fakes in `vi.hoisted` with
// `mainFakes`, hands them to its `vi.mock` factories, and resets them before each test with `useStart`.
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, expect, vi } from "vitest";
import type { GhCall, GhResult } from "../github-gh.ts";
import type { InitOptions } from "../init.ts";
import type { SyncIo } from "../sync.ts";

/** What `start` passes the TTY menu. */
export type SelectOpts = { message: string; options: { value: string }[]; initialValue: string };
/** What `start` asks before applying the global settings. */
export type ConfirmOpts = { message: string; initialValue: boolean };
type Spin = { start: (name: string) => void; stop: (name: string) => void };

/** The fakes the suites mock init, the prompts, sync, the registry, the folder map and GitHub with. */
export function mainFakes() {
  const gh = (_call: GhCall): Promise<GhResult> =>
    Promise.resolve({ ok: false, kind: "auth", message: "gh is not logged in (gh auth status)" });
  return {
    init: vi.fn<(dest: string, opts: InitOptions) => void>(),
    isInteractive: vi.fn<() => boolean>(() => false),
    select: vi.fn<(opts: SelectOpts) => Promise<string>>(),
    confirm: vi.fn<(opts: ConfirmOpts) => Promise<boolean>>(),
    spinner: vi.fn<() => Spin>(() => ({ start: vi.fn<Spin["start"]>(), stop: vi.fn<Spin["stop"]>() })),
    bailIfCancel: vi.fn(<T>(v: T) => v),
    mapCommand: vi.fn<(cwd: string, dir: string) => string>((_cwd, dir) => `map:${dir}\n`),
    runSync: vi.fn<(args: string[], io: SyncIo) => Promise<number>>(() => Promise.resolve(0)),
    runCommand: vi.fn<(name: string, argv: string[]) => Promise<number>>(() => Promise.resolve(0)),
    // The check side reaches GitHub through this holder's gh, never the real one; a test swaps in a fake over a store.
    githubIo: { gh },
  };
}

export type MainFakes = ReturnType<typeof mainFakes>;

/** `expect.any(Function)`, typed so an object literal can hold it. */
export function anyFunction(): unknown {
  return expect.any(Function);
}

/** This checkout's root, which a consumer repo links where an install puts the package. */
export function pkgRoot(): string {
  return path.join(import.meta.dirname, "..", "..");
}

/** This checkout's package version. */
export function pkgVersion(): string {
  const pkg: unknown = JSON.parse(fs.readFileSync(path.join(pkgRoot(), "package.json"), "utf8"));
  if (typeof pkg !== "object" || pkg === null || !("version" in pkg) || typeof pkg.version !== "string") {
    throw new Error("package.json has no version");
  }
  return pkg.version;
}

/** What a test's `start` wrote to stdout and stderr. */
export type Written = { out: string[]; err: string[] };

/**
 * Before each test: argv and the exit code saved, the exit code 0, stdout and stderr captured, every fake reset to
 * its default. After it: all of them put back.
 */
export function useStart(fakes: MainFakes): Written {
  const written: Written = { out: [], err: [] };
  const saved = { argv: process.argv.slice(), exitCode: process.exitCode };
  beforeEach(() => {
    saved.argv = process.argv.slice();
    saved.exitCode = process.exitCode;
    // bun cannot unset an exit code once set, so a clean start is 0.
    process.exitCode = 0;
    written.out.length = 0;
    written.err.length = 0;
    vi.spyOn(process.stdout, "write").mockImplementation((buf) => written.out.push(String(buf)) > 0);
    vi.spyOn(process.stderr, "write").mockImplementation((buf) => written.err.push(String(buf)) > 0);
    resetFakes(fakes);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    process.argv = saved.argv;
    process.exitCode = saved.exitCode;
  });
  return written;
}

function resetFakes(fakes: MainFakes): void {
  fakes.init.mockReset();
  fakes.runCommand.mockReset();
  fakes.runCommand.mockResolvedValue(0);
  fakes.runSync.mockReset();
  fakes.runSync.mockResolvedValue(0);
  fakes.mapCommand.mockClear();
  fakes.isInteractive.mockReset();
  fakes.isInteractive.mockReturnValue(false);
  fakes.select.mockReset();
  fakes.confirm.mockReset();
  fakes.spinner.mockReset();
  fakes.spinner.mockImplementation(() => ({ start: vi.fn<Spin["start"]>(), stop: vi.fn<Spin["stop"]>() }));
  fakes.bailIfCancel.mockReset();
  fakes.bailIfCancel.mockImplementation((v) => v);
}

/** The help text `repo help` prints. */
export const USAGE: string = `Usage: repo [command]

Default (no command): TTY menu; else init — full setup

Commands:
  init              Full setup: write workerstack.config.ts and package.json, bun install (whose postinstall runs \
repo sync), repo yolo
  check             Tsconfig bases, manifests, disable comments, lint.skip entries, generated files current, lint \
within .repo/lint-baseline.json, knip, actionlint on workflows, and floors, known failures and the baseline against \
main
  sync              Write the committed generated files from workerstack.config.ts (--check: report drift; \
--postinstall: never fail)
  map [dir]         Code-only folder map (git-tracked, no files); dir for depth
  clean             Remove scratch and stale generated files (--build: ignored build dirs; --deps: and node_modules; \
--dry-run lists only)
  doctor            Check the tools and versions this repo needs
  purge-mcps        Purge global MCP servers (dry-run; --apply to write)
  setup             Handheld keys and OAuth (speak, listen, google-workspace, browser, jev)
  tasks             Write .vscode/tasks.json from package scripts (VS Code and Cursor)
  yolo              Turn on full-permission mode on every host (--check, --dry-run, --host <id>)
  browser           Browse with Lightpanda, Chromium when blocked
  google-workspace  Google Sheets, Docs, Slides, Calendar and Gmail
  jev               Yes/no or named-option decision on saved text
  job               Compressed search, exec, slice, fetch and test dumps (--job search|exec|slice|fetch|test)
  lessons           Match, hit and list lessons
  listen            Speech-to-text from the mic
  persist           Save a plan, roadmap, handoff, implementation or tmp body from stdin (persist <kind> [--workspace \
dir])
  phase-files       Map a parallel group's unstaged changes to its phases
  speak             Text-to-speech
  worktree          Managed worktrees: add, list, finish, remove
  ci                Run every gate (--report: skipped tests); skips <dir>: tests skipped on every OS; wait: the run \
for HEAD
  commit-msg        Check a commit message file against the staged change (the commit-msg git hook), or each commit \
of --range <base>..<head>
  coverage          run the suite with coverage and raise coverage-floors.json; a drop fails
  docs              Check references: index, links, exports, examples, tarball (--check: only check; else sync first)
  fixtures          Rename fixture folders to __fixtures__ and rewrite their path references (--fix: apply; else \
list)
  fmt               Format with the standards pack's oxfmt config (--check: report only; args go to oxfmt)
  lint              Lint with the standards pack's oxlint config (args go to oxlint; --baseline: lower \
.repo/lint-baseline.json)
  mutate            mutation-test the tracked files in a clone of HEAD (--shard i/n, --report <file>); check <dir> \
[--write]: score reports against mutation-floors.json
  turn              Gate the changed files: fmt, lint, typecheck, related tests, sync, check (--staged: the index)
  github            apply the repository's rulesets, security settings and metadata, or report drift with --check
  link              Swap a dependency for a packed sibling checkout (status: list links; --pre-push: the push check)
  release           Release the root package: bump from commits, stamp CHANGELOG.md, commit, push, wait on CI, tag \
([--stable | --pre <id>]); wait <name>@<version>: poll npm
  remove            Remove a dependency from every manifest, the catalog and the root's overrides
  unlink            Put a linked dependency back on npm (--all: every link)
  update            List and bump outdated catalog and manifest versions (--check: list only; names or @scope/* \
narrow it)
  hook <name>       Run a hook: gate-fat-tools, orchestrate-parent, rtk-grok, scrub-spawn-prompt, session-map, \
worktree
  help              Show this help
  version           Print package version

Flags:
  --skip-globals     Skip repo yolo (otherwise init always runs it)
  --yes, -y          Non-interactive
  --non-interactive  Same as --yes
  --packs <list>     init: skill packs written as agents.skills into a new config: \
google-workspace,listen,speak,clasp or none
`;
