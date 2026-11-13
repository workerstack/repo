// Shared fakes and setup for the suites that drive `start`: each suite makes its fakes with `mainFakes`, passes them
// to `start`, and resets them before each test with `useStart`.
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, expect, vi } from "vitest";
import type { CliDeps } from "../cli-deps.ts";
import type { GhCall, GhResult } from "../github-gh.ts";

type Prompts = CliDeps["prompts"];
type Spin = ReturnType<Prompts["spinner"]>;

/** A spinner whose every call is a fake. */
function fakeSpin(): Spin {
  return { message: vi.fn<Spin["message"]>(), start: vi.fn<Spin["start"]>(), stop: vi.fn<Spin["stop"]>() };
}

/** This checkout's package.json text, what the real deps read. */
function packageJsonText(): string {
  return fs.readFileSync(path.join(pkgRoot(), "package.json"), "utf8");
}

/** The deps `start` runs on, every one a fake; GitHub is a logged-out gh, outside CI, which a test may swap. */
export function mainFakes() {
  const gh = (_call: GhCall): Promise<GhResult> =>
    Promise.resolve({ ok: false, kind: "auth", message: "gh is not logged in (gh auth status)" });
  return {
    init: vi.fn<CliDeps["init"]>(),
    prompts: {
      isInteractive: vi.fn<Prompts["isInteractive"]>(() => false),
      select: vi.fn<Prompts["select"]>(),
      confirm: vi.fn<Prompts["confirm"]>(),
      spinner: vi.fn<Prompts["spinner"]>(fakeSpin),
    },
    mapCommand: vi.fn<CliDeps["mapCommand"]>((_cwd, dir) => `map:${dir}\n`),
    runSync: vi.fn<CliDeps["runSync"]>(() => Promise.resolve(0)),
    runCommand: vi.fn<CliDeps["runCommand"]>(() => Promise.resolve(0)),
    checkIo: { ci: false, gh },
    packageJson: vi.fn<CliDeps["packageJson"]>(packageJsonText),
  } satisfies CliDeps;
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
  const pkg: unknown = JSON.parse(packageJsonText());
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
  const { prompts } = fakes;
  fakes.init.mockReset();
  fakes.runCommand.mockReset();
  fakes.runCommand.mockResolvedValue(0);
  fakes.runSync.mockReset();
  fakes.runSync.mockResolvedValue(0);
  fakes.mapCommand.mockClear();
  fakes.packageJson.mockReset();
  fakes.packageJson.mockImplementation(packageJsonText);
  prompts.isInteractive.mockReset();
  prompts.isInteractive.mockReturnValue(false);
  prompts.select.mockReset();
  prompts.confirm.mockReset();
  prompts.spinner.mockReset();
  prompts.spinner.mockImplementation(fakeSpin);
}

/** The help text `repo help` prints. */
export const USAGE: string = `Usage: repo [command]

Default (no command): TTY menu; else init — full setup

Commands:
  init              Full setup: write repo.config.ts and package.json, bun install (whose postinstall runs \
repo sync), repo yolo
  check             Tsconfig bases, manifests, disable comments, lint.skip entries, generated files current, lint \
within .repo/lint-baseline.json, knip, actionlint on workflows, and floors, known failures and the baseline against \
main
  sync              Write the committed generated files from repo.config.ts (--check: report drift; \
--postinstall: never fail)
  map [dir]         Code-only folder map (git-tracked, no files); dir for depth
  clean             Remove scratch and stale generated files (--build: ignored build dirs; --deps: and node_modules; \
--dry-run lists only)
  doctor            Check the tools and versions this repo needs
  purge-mcps        Purge global MCP servers (dry-run; --apply to write)
  setup             Handheld keys and OAuth (speak, listen, google-workspace, browser, jev)
  shim              Install a \`repo\` command that runs the project's own copy (--check, --dry-run, --dir <path>)
  tasks             Write .vscode/tasks.json from package scripts (VS Code and Cursor)
  yolo              Turn on full-permission mode on every host (--check, --dry-run, --host <id>)
  backlog           Add, list, start, mark done and clear .repo/backlog.md items
  bench             Score candidate commands on a .repo/bench spec (--remote: its other OSes in CI too)
  browser           Browse with Lightpanda, Chromium when blocked
  changelog         Print and add [Unreleased] entries of CHANGELOG.md
  env               Seal, list, read and hand out defineEnv values (init, set, get, ls, run, export, key)
  eval              Score a model on evals/<name> cases; prints a cost estimate and refuses over a cap
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
  commit-msg        Check a commit message file against the staged change (the commit-msg git hook), each commit of \
--range <base>..<head>, or the commits a push sends (--pre-push)
  coverage          run the suite with coverage and raise coverage-floors.json; a drop fails
  docs              Check references: index, links, exports, examples, tarball (--check: only check; else sync first)
  fixtures          Rename fixture folders to __fixtures__ and rewrite their path references (--fix: apply; else \
list)
  fmt               Format with the standards pack's oxfmt config (--check: report only; args go to bun fmt)
  lint              Lint with the standards pack's oxlint config (args go to oxlint; --baseline: lower \
.repo/lint-baseline.json)
  mutate            mutation-test the tracked files in a clone of HEAD (--shard i/n, --report <file>); check <dir> \
[--write]: score reports against mutation-floors.json
  turn              Gate the changed files: fmt, lint, typecheck, related tests, sync, check (--staged: the index)
  github            apply the repository's rulesets, security settings, evals environment and metadata, or report drift with --check
  link              Swap a dependency for a packed sibling checkout (status: list links; --pre-push: the push check)
  push              Push the named branch, or the one the recent-branch table picks, and wait on its ci run (exit 5: \
name the branch)
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
