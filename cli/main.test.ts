import { BASE_CONFIG } from "./fixtures/base-config.ts";
import { execFileSync as runGit } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const init = vi.hoisted(() => vi.fn());
const isInteractive = vi.hoisted(() => vi.fn(() => false));
const select = vi.hoisted(() => vi.fn());
const confirm = vi.hoisted(() => vi.fn());
const spinner = vi.hoisted(() => vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })));
const bailIfCancel = vi.hoisted(() => vi.fn(<T>(v: T) => v));
const mapCommand = vi.hoisted(() => vi.fn((_cwd: string, dir: string) => `map:${dir}\n`));
const runSync = vi.hoisted(() =>
  vi.fn(
    async (
      _args: string[],
      _io: { cwd: string; stdout: (s: string) => void; stderr: (s: string) => void },
    ): Promise<number> => 0,
  ),
);

// Wraps the real readFileSync; the version tests swap one return value.
const readFileSync = vi.hoisted(() => vi.fn());
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  readFileSync.mockImplementation(actual.readFileSync);
  return { ...actual, default: { ...actual, readFileSync }, readFileSync };
});

const runCommand = vi.hoisted(() => vi.fn(async (_name: string, _argv: string[]): Promise<number> => 0));
vi.mock(new URL("./commands.ts", import.meta.url).href, async (importOriginal) => {
  const actual = await importOriginal<typeof import("./commands.ts")>();
  return { ...actual, runCommand };
});

vi.mock(new URL("./init.ts", import.meta.url).href, async (importOriginal) => {
  const actual = await importOriginal<typeof import("./init.ts")>();
  return { ...actual, init };
});
// The check side reaches GitHub through this holder's gh, never the real one; a test swaps in a fake over a store.
const githubIo = vi.hoisted(() => ({
  gh: (_call: import("./github-gh.ts").GhCall): Promise<import("./github-gh.ts").GhResult> =>
    Promise.resolve({ ok: false, kind: "auth", message: "gh is not logged in (gh auth status)" }),
}));
vi.mock(new URL("./github-apply.ts", import.meta.url).href, async (importOriginal) => {
  const actual = await importOriginal<typeof import("./github-apply.ts")>();
  return { ...actual, checkGithubAt: (cwd: string) => actual.checkGithubAt(cwd, { gh: githubIo.gh, ci: false }) };
});
vi.mock(new URL("./sync.ts", import.meta.url).href, () => ({ runSync }));
vi.mock(new URL("./scripts/folder-map.ts", import.meta.url).href, () => ({ mapCommand }));
vi.mock(new URL("./prompt.ts", import.meta.url).href, () => ({
  isInteractive,
  select,
  confirm,
  spinner,
  bailIfCancel,
}));
import { APPLY_GLOBALS_CONFIRM, parseArgv, start } from "./main.ts";
import { standards } from "./sync/standards.ts";
import { EMPTY_SETTINGS, fakeGh } from "./fixtures/github-store.ts";

/** A resolved config's agents with no host and no skill. */
const NO_AGENTS = { hosts: [], skills: [] };

const USAGE = `Usage: repo [command]

Default (no command): TTY menu; else init — full setup

Commands:
  init              Full setup: write workerstack.config.ts and package.json, bun install (whose postinstall runs repo sync), repo yolo
  check             Tsconfig bases, manifests, disable comments, lint.skip entries, generated files current, lint within .repo/lint-baseline.json, knip, actionlint on workflows, and floors, known failures and the baseline against main
  sync              Write the committed generated files from workerstack.config.ts (--check: report drift; --postinstall: never fail)
  map [dir]         Code-only folder map (git-tracked, no files); dir for depth
  job               Compressed search, exec, slice, fetch and test dumps (--job search|exec|slice|fetch|test)
  worktree          Managed worktrees: add, list, finish, remove
  persist           Save a plan, roadmap, handoff, implementation or tmp body from stdin (persist <kind> [--workspace dir])
  phase-files       Map a parallel group's unstaged changes to its phases
  lessons           Match, hit and list lessons
  browser           Browse with Lightpanda, Chromium when blocked
  google-workspace  Google Sheets, Docs, Slides, Calendar and Gmail
  jev               Yes/no or named-option decision on saved text
  listen            Speech-to-text from the mic
  speak             Text-to-speech
  setup             Handheld keys and OAuth (speak, listen, google-workspace, browser, jev)
  doctor            Check the tools and versions this repo needs
  clean             Remove scratch and stale generated files (--build: ignored build dirs; --deps: and node_modules; --dry-run lists only)
  yolo              Turn on full-permission mode on every host (--check, --dry-run, --host <id>)
  purge-mcps        Purge global MCP servers (dry-run; --apply to write)
  tasks             Write .vscode/tasks.json from package scripts (VS Code and Cursor)
  lint              Lint with the standards pack's oxlint config (args go to oxlint; --baseline: lower .repo/lint-baseline.json)
  fmt               Format with the standards pack's oxfmt config (--check: report only; args go to oxfmt)
  turn              Gate the changed files: fmt, lint, typecheck, related tests, sync, check (--staged: the index)
  ci                Run every gate (--report: skipped tests); skips <dir>: tests skipped on every OS; wait: the run for HEAD
  coverage          run the suite with coverage and raise coverage-floors.json; a drop fails
  mutate            mutation-test the tracked files in a clone of HEAD (--shard i/n, --report <file>); check <dir> [--write]: score reports against mutation-floors.json
  release           Release the root package: bump from commits, stamp CHANGELOG.md, commit, push, wait on CI, tag ([--stable | --pre <id>]); wait <name>@<version>: poll npm
  commit-msg        Check a commit message file against the staged change (the commit-msg git hook), or each commit of --range <base>..<head>
  github            apply the repository's rulesets, security settings and metadata, or report drift with --check
  link              Swap a dependency for a packed sibling checkout (status: list links; --pre-push: the push check)
  unlink            Put a linked dependency back on npm (--all: every link)
  hook <name>       Run a hook: gate-fat-tools, orchestrate-parent, rtk-grok, scrub-spawn-prompt, session-map, worktree
  help              Show this help
  version           Print package version

Flags:
  --skip-globals     Skip repo yolo (otherwise init always runs it)
  --yes, -y          Non-interactive
  --non-interactive  Same as --yes
  --packs <list>     init: skill packs written as agents.skills into a new config: google-workspace,listen,speak,clasp or none
`;

const pkgRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
function readVersion(file: string): string {
  const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
  if (typeof pkg !== "object" || pkg === null || !("version" in pkg) || typeof pkg.version !== "string") {
    throw new Error(`${file} has no version`);
  }
  return pkg.version;
}

const version = readVersion(path.join(pkgRoot, "package.json"));

/** A fetch that answers every request with a registry document whose latest tag is `latest`. */
const latestFetch = (latest: string) => () =>
  Promise.resolve(new Response(JSON.stringify({ versions: { [latest]: {} }, "dist-tags": { latest } })));

describe("start", () => {
  let argv: string[];
  let exitCode: typeof process.exitCode;
  let stdoutWrite: typeof process.stdout.write;
  const chunks: string[] = [];

  beforeEach(() => {
    argv = process.argv.slice();
    exitCode = process.exitCode;
    process.exitCode = 0;
    chunks.length = 0;
    stdoutWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((buf: string | Uint8Array) => {
      chunks.push(String(buf));
      return true;
    }) as typeof process.stdout.write;
    init.mockReset();
    runCommand.mockReset();
    runSync.mockClear();
    runCommand.mockResolvedValue(0);
    isInteractive.mockReset();
    isInteractive.mockReturnValue(false);
    select.mockReset();
    confirm.mockReset();
    spinner.mockReset();
    spinner.mockImplementation(() => ({ start: vi.fn(), stop: vi.fn() }));
    bailIfCancel.mockReset();
    bailIfCancel.mockImplementation((v) => v);
  });

  afterEach(() => {
    process.argv = argv;
    process.exitCode = exitCode;
    process.stdout.write = stdoutWrite;
  });

  it.each(["help", "--help", "-h"])("%s writes usage", async (cmd) => {
    process.argv = ["node", "repo", cmd];
    await start();
    expect(chunks.join("")).toBe(USAGE);
    expect(process.exitCode).toBe(0);
    expect(init).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
  });

  it.each(["version", "--version", "-v"])("%s writes package version", async (cmd) => {
    process.argv = ["node", "repo", cmd];
    await start();
    expect(chunks.join("")).toBe(`${version}\n`);
    expect(process.exitCode).toBe(0);
  });

  it.each([["null"], ['{"name":"x"}'], ['{"version":3}']])(
    "version refuses a package.json that is %s",
    async (text) => {
      readFileSync.mockReturnValueOnce(text);
      process.argv = ["node", "repo", "version"];
      await expect(start()).rejects.toThrow("package.json has no version");
    },
  );

  it("no-arg runs init on cwd", async () => {
    process.argv = ["node", "repo"];
    await start();
    expect(init).toHaveBeenCalledOnce();
    expect(init).toHaveBeenCalledWith(process.cwd(), {
      skipGlobals: false,
    });
    expect(select).not.toHaveBeenCalled();
  });

  it("init runs init on cwd", async () => {
    process.argv = ["node", "repo", "init"];
    await start();
    expect(init).toHaveBeenCalledOnce();
    expect(init).toHaveBeenCalledWith(process.cwd(), {
      skipGlobals: false,
    });
  });

  it.each([
    ["node", "repo", "--skip-globals"],
    ["node", "repo", "init", "--skip-globals"],
    ["node", "repo", "--skip-globals", "init"],
  ])("passes skipGlobals when argv is %s", async (...argv) => {
    process.argv = argv;
    await start();
    expect(init).toHaveBeenCalledOnce();
    expect(init).toHaveBeenCalledWith(process.cwd(), {
      skipGlobals: true,
    });
  });

  it.each(["--yes", "-y", "--non-interactive"])("%s no-arg still init, no menu", async (flag) => {
    process.argv = ["node", "repo", flag];
    await start();
    expect(isInteractive).toHaveBeenCalledOnce();
    expect(select).not.toHaveBeenCalled();
    expect(init).toHaveBeenCalledOnce();
    expect(init).toHaveBeenCalledWith(process.cwd(), {
      skipGlobals: false,
    });
  });

  it("sync --check forwards its args and io to runSync and keeps its exit code", async () => {
    const errs: string[] = [];
    const stderrWrite = process.stderr.write;
    process.stderr.write = ((buf: string | Uint8Array) => {
      errs.push(String(buf));
      return true;
    }) as typeof process.stderr.write;
    runSync.mockReset();
    runSync.mockImplementationOnce(async (_args, io) => {
      io.stdout("out\n");
      io.stderr("err\n");
      return 1;
    });
    process.argv = ["node", "repo", "sync", "--check"];
    try {
      await start();
    } finally {
      process.stderr.write = stderrWrite;
    }
    expect(runSync).toHaveBeenCalledOnce();
    expect(runSync).toHaveBeenCalledWith(["--check"], {
      cwd: process.cwd(),
      stdout: expect.any(Function),
      stderr: expect.any(Function),
    });
    expect(chunks.join("")).toBe("out\n");
    expect(errs.join("")).toBe("err\n");
    expect(process.exitCode).toBe(1);
  });

  it("TTY menu runs a registry command in-process", async () => {
    isInteractive.mockReturnValue(true);
    select.mockResolvedValue("doctor");
    process.argv = ["node", "repo"];
    await start();
    expect(runCommand).toHaveBeenCalledWith("doctor", []);
  });

  it("map prints the folder map without running a script", async () => {
    process.argv = ["node", "repo", "map"];
    await start();
    expect(mapCommand).toHaveBeenLastCalledWith(process.cwd(), "");
    expect(chunks.join("")).toBe("map:\n");
  });

  it("map <dir> scopes the folder map", async () => {
    process.argv = ["node", "repo", "map", "packages/web"];
    await start();
    expect(mapCommand).toHaveBeenLastCalledWith(process.cwd(), "packages/web");
    expect(chunks.join("")).toBe("map:packages/web\n");
  });

  it.each(["nope", "generate", "upgrade"])(
    "%s is an unknown command: one line on stderr and exitCode 1",
    async (cmd) => {
      const errs: string[] = [];
      const stderrWrite = process.stderr.write;
      process.stderr.write = ((buf: string | Uint8Array) => {
        errs.push(String(buf));
        return true;
      }) as typeof process.stderr.write;
      process.argv = ["node", "repo", cmd];
      try {
        await start();
      } finally {
        process.stderr.write = stderrWrite;
      }
      expect(errs.join("")).toBe(`repo: unknown command "${cmd}"; run \`repo --help\`\n`);
      expect(chunks.join("")).toBe("");
      expect(process.exitCode).toBe(1);
      expect(init).not.toHaveBeenCalled();
      expect(runSync).not.toHaveBeenCalled();
    },
  );

  it("TTY no cmd shows menu default init", async () => {
    isInteractive.mockReturnValue(true);
    select.mockResolvedValue("init");
    confirm.mockResolvedValue(true);
    process.argv = ["node", "repo"];
    await start();
    expect(select).toHaveBeenCalledOnce();
    // The call exists: the line above asserts exactly one.
    const opts = select.mock.calls[0]![0] as {
      initialValue: string;
      options: { value: string }[];
    };
    expect(opts.initialValue).toBe("init");
    expect(opts.options.map((o) => o.value)).toEqual([
      "init",
      "check",
      "yolo",
      "purge-mcps",
      "doctor",
      "clean",
      "setup",
      "tasks",
      "help",
      "quit",
    ]);
    expect(init).toHaveBeenCalled();
    expect(isInteractive).toHaveBeenCalledOnce();
    expect(confirm).toHaveBeenCalledWith({
      message: APPLY_GLOBALS_CONFIRM,
      initialValue: true,
    });
  });

  it("TTY menu help writes usage", async () => {
    isInteractive.mockReturnValue(true);
    select.mockResolvedValue("help");
    process.argv = ["node", "repo"];
    await start();
    expect(chunks.join("")).toBe(USAGE);
    expect(process.exitCode).toBe(0);
  });

  it("TTY menu quit does nothing", async () => {
    isInteractive.mockReturnValue(true);
    select.mockResolvedValue("quit");
    process.argv = ["node", "repo"];
    await start();
    expect(init).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
  });

  it("TTY cancel exits 0", async () => {
    isInteractive.mockReturnValue(true);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("EXIT");
    }) as typeof process.exit);
    select.mockImplementation(async () => {
      process.exit(0);
    });
    process.argv = ["node", "repo"];
    await expect(start()).rejects.toThrow("EXIT");
    expect(exit).toHaveBeenCalledWith(0);
    expect(init).not.toHaveBeenCalled();
    exit.mockRestore();
  });

  it("TTY init confirms globals; spinner onPhase stop before inherit", async () => {
    isInteractive.mockReturnValue(true);
    const spin = { start: vi.fn(), stop: vi.fn() };
    spinner.mockReturnValue(spin);
    confirm.mockResolvedValue(true);
    init.mockImplementation((_dest: string, opts: { onPhase?: (n: string, a: string) => void }) => {
      opts.onPhase?.("merge", "start");
      opts.onPhase?.("merge", "stop");
      opts.onPhase?.("install", "start");
      opts.onPhase?.("install", "stop");
    });
    process.argv = ["node", "repo", "init"];
    await start();
    expect(confirm).toHaveBeenCalled();
    const globalsConfirm = confirm.mock.calls.find(
      (c) => (c[0] as { message?: string }).message === APPLY_GLOBALS_CONFIRM,
    );
    expect(globalsConfirm?.[0]).toMatchObject({
      message: APPLY_GLOBALS_CONFIRM,
      initialValue: true,
    });
    expect(init).toHaveBeenCalledWith(
      process.cwd(),
      expect.objectContaining({
        skipGlobals: false,
        onPhase: expect.any(Function),
      }),
    );
    expect(isInteractive).toHaveBeenCalledOnce();
    expect(spin.start).toHaveBeenCalledWith("merge");
    expect(spin.stop).toHaveBeenCalledWith("merge");
    expect(spin.start).toHaveBeenCalledWith("install");
    expect(spin.stop).toHaveBeenCalledWith("install");
  });

  it("TTY init --skip-globals default confirm false maps to skip", async () => {
    isInteractive.mockReturnValue(true);
    confirm.mockResolvedValue(false);
    process.argv = ["node", "repo", "init", "--skip-globals"];
    await start();
    expect(confirm).toHaveBeenCalledWith({
      message: APPLY_GLOBALS_CONFIRM,
      initialValue: false,
    });
    expect(init).toHaveBeenCalledWith(
      process.cwd(),
      expect.objectContaining({
        skipGlobals: true,
        onPhase: expect.any(Function),
      }),
    );
    expect(isInteractive).toHaveBeenCalledOnce();
  });
});

describe("start packs", () => {
  it("TTY init passes --packs to init", async () => {
    isInteractive.mockReturnValue(true);
    confirm.mockResolvedValue(true);
    process.argv = ["node", "repo", "init", "--packs", "listen"];
    await start();
    expect(init).toHaveBeenCalledWith(
      process.cwd(),
      expect.objectContaining({ packs: ["listen"], skipGlobals: false }),
    );
  });
});

describe("parseArgv --packs", () => {
  it("pair, equals, and none", () => {
    expect(parseArgv(["init", "--packs", "speak,listen"])).toMatchObject({
      cmd: "init",
      packs: ["listen", "speak"],
      packsError: false,
    });
    expect(parseArgv(["init", "--packs=google-workspace,clasp"])).toMatchObject({
      packs: ["google-workspace", "clasp"],
      packsError: false,
    });
    expect(parseArgv(["init", "--packs", "none"])).toMatchObject({ packs: [], packsError: false });
    expect(parseArgv(["init", "--packs="])).toMatchObject({ packs: [], packsError: false });
  });

  it("missing, flag, and unknown are packsError", () => {
    expect(parseArgv(["init", "--packs"])).toMatchObject({ packsError: true });
    expect(parseArgv(["init", "--packs", "--yes"])).toMatchObject({ packsError: true });
    expect(parseArgv(["init", "--packs", "nope"])).toMatchObject({ packsError: true });
    expect(parseArgv(["init", "--packs=nope"])).toMatchObject({ packsError: true });
  });

  it("unknown --packs writes usage", async () => {
    const lines: string[] = [];
    const stdoutWrite = process.stdout.write;
    const exitCode = process.exitCode;
    const argv = process.argv.slice();
    process.stdout.write = ((buf: string | Uint8Array) => {
      lines.push(String(buf));
      return true;
    }) as typeof process.stdout.write;
    process.exitCode = 0;
    process.argv = ["node", "repo", "init", "--packs", "nope"];
    init.mockClear();
    try {
      await start();
      expect(lines.join("")).toBe(USAGE);
      expect(process.exitCode).toBe(1);
      expect(init).not.toHaveBeenCalled();
    } finally {
      process.stdout.write = stdoutWrite;
      process.exitCode = exitCode;
      process.argv = argv;
    }
  });
});

describe("start check", () => {
  const SETS_FILES = (rel: string) =>
    `repo check: tsconfig: ${rel} sets "files", which replaces the base's reset.d.ts. List sources under "include".`;
  const NO_BASE = (rel: string) =>
    `repo check: tsconfig: ${rel} does not extend a base. Extend "@workerstack/repo/tsconfig/base", "bun", "worker" or "web".`;
  const NO_SRC = (dir: string) =>
    `repo check: tsconfig: ${dir} has no tsconfig.src.json; add one with "extends": ["./tsconfig.json", "@workerstack/repo/tsconfig/strict"] and an "exclude" that repeats tsconfig.json's and adds the tests`;

  let argv: string[];
  let exitCode: typeof process.exitCode;
  let stderrWrite: typeof process.stderr.write;
  let dir: string;
  const stderr: string[] = [];
  /** What check printed to stderr but knip's lines, which the tests of other checks do not pin. */
  const besidesKnip = () => stderr.filter((line) => !line.startsWith("repo check: knip")).join("");

  function write(rel: string, content: object) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(content)}\n`);
  }

  /** A root tsconfig.json on the bun base and its strict tsconfig.src.json, which check passes. */
  function writeConfigs() {
    write("tsconfig.json", { extends: "@workerstack/repo/tsconfig/bun", include: ["src"] });
    write("tsconfig.src.json", {
      extends: ["./tsconfig.json", "@workerstack/repo/tsconfig/strict"],
      exclude: ["node_modules", "**/*.test.ts"],
    });
  }

  beforeEach(() => {
    argv = process.argv.slice();
    exitCode = process.exitCode;
    // bun cannot unset an exit code once set, so a clean start is 0.
    process.exitCode = 0;
    // A consumer repo: git, with this checkout linked where an install puts it.
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "repo-check-"));
    runGit("git", ["init", "-q"], { cwd: dir });
    // A public package must keep a changelog, which check reads.
    fs.writeFileSync(path.join(dir, "CHANGELOG.md"), "# Changelog\n\n## [Unreleased]\n");
    fs.writeFileSync(path.join(dir, ".gitignore"), "node_modules\n");
    const scope = path.join(dir, "node_modules", "@workerstack");
    fs.mkdirSync(scope, { recursive: true });
    fs.symlinkSync(pkgRoot, path.join(scope, "repo"), "junction");
    vi.spyOn(process, "cwd").mockReturnValue(dir);
    stderr.length = 0;
    stderrWrite = process.stderr.write;
    process.stderr.write = ((buf: string | Uint8Array) => {
      stderr.push(String(buf));
      return true;
    }) as typeof process.stderr.write;
    runSync.mockReset();
    runSync.mockResolvedValue(0);
    isInteractive.mockReset();
    isInteractive.mockReturnValue(false);
    process.argv = ["node", "repo", "check"];
    // The version check asks npm; the tests answer for it, with the latest the installed copy is.
    vi.stubGlobal("fetch", latestFetch(version));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.stderr.write = stderrWrite;
    vi.mocked(process.cwd).mockRestore();
    process.argv = argv;
    process.exitCode = exitCode;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("fails when the installed package is behind npm's latest", async () => {
    writeConfigs();
    vi.stubGlobal("fetch", latestFetch("999.0.0"));
    await start();
    expect(stderr.join("")).toContain(`repo check: @workerstack/repo ${version} is behind 999.0.0 on npm;`);
    expect(process.exitCode).toBe(1);
  });

  it("reports a skipped version check on stdout without failing", async () => {
    writeConfigs();
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
    const out: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((buf) => (out.push(String(buf)), true));
    try {
      await start();
    } finally {
      spy.mockRestore();
    }
    expect(out.join("")).toContain("repo check: could not ask npm for the latest @workerstack/repo (offline)");
  });

  it("holds a workspace to the workspace pack only when the pack is on", async () => {
    writeConfigs();
    write("package.json", { private: true, workspaces: ["packages/*"], dependencies: { lodash: "1.0.0" } });
    fs.writeFileSync(path.join(dir, "workerstack.config.ts"), 'export default { packs: ["standards"] };\n');
    await start();
    expect(besidesKnip()).not.toContain("a workspace root has no");
    fs.writeFileSync(path.join(dir, "workerstack.config.ts"), 'export default { packs: ["workspace"] };\n');
    process.exitCode = 0;
    await start();
    expect(besidesKnip()).toContain(
      'repo check: package.json: a workspace root has no "dependencies"; move "lodash" into the package that uses it\n',
    );
    expect(process.exitCode).toBe(1);
  });

  const ORIGIN = "https://github.com/workerstack/repo.git";
  /** The stdout `start` writes. */
  async function startCapturingStdout(): Promise<string> {
    const out: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((buf) => (out.push(String(buf)), true));
    try {
      await start();
    } finally {
      spy.mockRestore();
    }
    return out.join("");
  }

  it("checks GitHub only under the release pack: standards alone makes no gh call and prints no github line", async () => {
    writeConfigs();
    fs.writeFileSync(path.join(dir, "workerstack.config.ts"), 'export default { packs: ["standards"] };\n');
    runGit("git", ["remote", "add", "origin", ORIGIN], { cwd: dir });
    const fake = fakeGh(EMPTY_SETTINGS());
    const gh = githubIo.gh;
    githubIo.gh = fake.gh;
    try {
      expect(await startCapturingStdout()).not.toContain("github:");
    } finally {
      githubIo.gh = gh;
    }
    expect(fake.calls).toEqual([]);
    expect(stderr.join("")).not.toContain("repo check: github:");
  });

  it("reports a skipped GitHub check on stdout when there is no GitHub origin", async () => {
    writeConfigs();
    fs.writeFileSync(path.join(dir, "workerstack.config.ts"), 'export default { packs: ["release"] };\n');
    expect(await startCapturingStdout()).toContain("repo check: github: skipped, no GitHub origin\n");
    expect(stderr.join("")).not.toContain("github");
  });

  it("reports a skipped GitHub check on stdout, without failing, when gh is not logged in", async () => {
    writeConfigs();
    fs.writeFileSync(path.join(dir, "workerstack.config.ts"), 'export default { packs: ["release"] };\n');
    runGit("git", ["remote", "add", "origin", ORIGIN], { cwd: dir });
    expect(await startCapturingStdout()).toContain(
      "repo check: github: skipped, gh is not logged in (gh auth status)\n",
    );
    // The release pack's other problems fail this run; the skipped GitHub check is none of them.
    expect(stderr.join("")).not.toContain("github");
  });

  it("prints each GitHub setting that drifted, from the injected gh, and exits 1", async () => {
    writeConfigs();
    fs.writeFileSync(path.join(dir, "workerstack.config.ts"), 'export default { packs: ["release"] };\n');
    runGit("git", ["remote", "add", "origin", ORIGIN], { cwd: dir });
    const fake = fakeGh(EMPTY_SETTINGS());
    const gh = githubIo.gh;
    githubIo.gh = fake.gh;
    try {
      await start();
    } finally {
      githubIo.gh = gh;
    }
    expect(stderr.join("")).toContain("repo check: github: ruleset main is missing: run `bun repo github`\n");
    expect(stderr.join("")).toContain(
      "repo check: github: private vulnerability reporting is off: run `bun repo github`\n",
    );
    expect(fake.writes()).toEqual([]);
    expect(process.exitCode).toBe(1);
  });

  it("prints every bad tsconfig, still runs repo sync --check and exits 1", async () => {
    write("a/tsconfig.json", { extends: "@workerstack/repo/tsconfig/bun", files: ["src/a.ts"] });
    write("b/tsconfig.json", { include: ["src"] });
    await start();
    expect(besidesKnip()).toBe(
      [SETS_FILES("a/tsconfig.json"), NO_SRC("a"), NO_BASE("b/tsconfig.json"), NO_SRC("b"), ""].join("\n"),
    );
    expect(runSync).toHaveBeenCalledOnce();
    expect(runSync).toHaveBeenCalledWith(["--check"], expect.objectContaining({ cwd: dir }));
    expect(process.exitCode).toBe(1);
  });

  it("prints each CHANGELOG.md problem of a public root and exits 1", async () => {
    writeConfigs();
    write("package.json", {});
    fs.writeFileSync(path.join(dir, "CHANGELOG.md"), "# Changelog\n\n## [Unreleased]\n\n### Improved\n");
    await start();
    expect(besidesKnip()).toContain(
      'repo check: CHANGELOG.md:5: "### Improved" is not a section; use Added, Changed, Deprecated, Removed, Fixed or Security\n',
    );
    expect(process.exitCode).toBe(1);
  });

  it("prints a second env.ts in one package and exits 1", async () => {
    writeConfigs();
    write("package.json", {});
    fs.mkdirSync(path.join(dir, "src"));
    fs.writeFileSync(path.join(dir, "env.ts"), "export {};\n");
    fs.writeFileSync(path.join(dir, "src/env.ts"), "export {};\n");
    await start();
    expect(besidesKnip()).toBe("repo check: env: env.ts and src/env.ts are both env.ts in .; keep one\n");
    expect(runSync).toHaveBeenCalledOnce();
    expect(process.exitCode).toBe(1);
  });

  it("leaves the exit code at 0 when every tsconfig keeps a base", async () => {
    writeConfigs();
    await start();
    expect(besidesKnip()).toBe("");
    expect(runSync).toHaveBeenCalledOnce();
    expect(runSync).toHaveBeenCalledWith(["--check"], expect.objectContaining({ cwd: dir }));
    expect(process.exitCode).toBe(0);
  });

  it("with the standards pack on, prints each lint count over .repo/lint-baseline.json and exits 1", async () => {
    writeConfigs();
    fs.writeFileSync(path.join(dir, "workerstack.config.ts"), 'export default { packs: ["standards"] };\n');
    const ctx = {
      root: "",
      config: { packs: ["standards" as const], agents: NO_AGENTS, ...BASE_CONFIG },
    };
    for (const output of standards(
      { ...ctx, workspace: { root: "", manifest: {}, packages: [] }, read: () => null },
      [],
    ).outputs)
      if (output.kind === "file") {
        fs.mkdirSync(path.dirname(path.join(dir, output.path)), { recursive: true });
        fs.writeFileSync(path.join(dir, output.path), output.content);
      }
    fs.mkdirSync(path.join(dir, "src"));
    fs.writeFileSync(path.join(dir, "src/a.ts"), "export const a = (xs: string[]): string => xs.find(Boolean)!;\n");
    await start();
    expect(besidesKnip()).toBe(
      "repo check: .repo/lint-baseline.json: src/a.ts has 1 typescript(no-non-null-assertion), the baseline allows 0\n",
    );
    expect(process.exitCode).toBe(1);
  }, 60_000);

  it("with the standards pack on, prints each manifest problem and exits 1", async () => {
    writeConfigs();
    write("package.json", { name: "app", sideEffects: ["*.css"] });
    fs.writeFileSync(path.join(dir, "workerstack.config.ts"), 'export default { packs: ["standards"] };\n');
    await start();
    expect(besidesKnip()).toBe(
      [
        'repo check: package.json: "private" is missing; set true, or false to publish it',
        'repo check: package.json: "sideEffects" is ["*.css"]; set it to false and import CSS from an app entry',
        `repo check: package.json: "packageManager" is missing; set it to "bun@${Bun.version}"`,
        "",
      ].join("\n"),
    );
    expect(process.exitCode).toBe(1);
  }, 60_000);

  it("with the standards pack on, prints each refused comment with its file and line and exits 1", async () => {
    writeConfigs();
    fs.writeFileSync(path.join(dir, "workerstack.config.ts"), 'export default { packs: ["standards"] };\n');
    fs.mkdirSync(path.join(dir, "src"));
    fs.writeFileSync(path.join(dir, "src/a.ts"), "export const a = 1;\n// @ts-ignore\n");
    await start();
    expect(besidesKnip()).toBe(
      'repo check: src/a.ts:2: "@ts-ignore" hides a type error; fix the type, or write @ts-expect-error with a reason\n',
    );
    expect(process.exitCode).toBe(1);
  }, 60_000);

  it("with the release pack on, prints the Stryker install and the empty coverage.mutate and exits 1", async () => {
    writeConfigs();
    fs.writeFileSync(path.join(dir, "workerstack.config.ts"), 'export default { packs: ["release"] };\n');
    await start();
    expect(besidesKnip()).toContain(
      [
        "repo check: the release pack runs mutation tests nightly; bun add -d @stryker-mutator/core@10.1.1 @stryker-mutator/vitest-runner@10.1.1",
        "repo check: coverage.mutate (src/**/*.ts) matches no tracked file; set coverage.mutate in workerstack.config.ts",
        "",
      ].join("\n"),
    );
    expect(process.exitCode).toBe(1);
  }, 60_000);

  it("with the release pack and a public root, prints each missing metadata field and exits 1", async () => {
    writeConfigs();
    write("package.json", { name: "app", private: false, author: "workerstack" });
    const config = 'export default { packs: ["release"], owner: { name: "Ann Lee", github: "ann" } };\n';
    fs.writeFileSync(path.join(dir, "workerstack.config.ts"), config);
    await start();
    const printed = besidesKnip();
    expect(printed).toContain(
      'repo check: package.json: "author" is "workerstack"; set it to "Ann Lee", the owner in workerstack.config.ts\n',
    );
    expect(printed).toContain('repo check: package.json: "keywords" is missing; list at least one\n');
    expect(printed).toContain("repo check: LICENSE is missing; add the MIT license naming Ann Lee\n");
    expect(process.exitCode).toBe(1);
  }, 60_000);

  it("with the release pack and a public root without an owner, asks for the owner", async () => {
    writeConfigs();
    write("package.json", { name: "app", private: false });
    fs.writeFileSync(path.join(dir, "workerstack.config.ts"), 'export default { packs: ["release"] };\n');
    await start();
    expect(besidesKnip()).toContain(
      "repo check: workerstack.config.ts: the release pack with a public package needs owner: { name, github }\n",
    );
    expect(process.exitCode).toBe(1);
  }, 60_000);

  it("with the standards pack on, prints knip's problems to stderr and its ignores to stdout, and exits 1", async () => {
    writeConfigs();
    write("package.json", { name: "app", private: true, sideEffects: false, packageManager: `bun@${Bun.version}` });
    const ignore = '{ file: "src/b.ts", reason: "loaded by name" }';
    const config = `export default { packs: ["standards"], knip: { ignore: [${ignore}] } };\n`;
    fs.writeFileSync(path.join(dir, "workerstack.config.ts"), config);
    fs.mkdirSync(path.join(dir, "src"));
    fs.writeFileSync(path.join(dir, "src/a.ts"), "export const a = 1;\n");
    fs.writeFileSync(path.join(dir, "src/b.ts"), "export const b = 1;\n");
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await start();
    const printed = stdout.mock.calls.map(([line]) => String(line));
    stdout.mockRestore();
    expect(printed).toContain("repo check: knip: 1 ignore: file src/b.ts (loaded by name)\n");
    expect(stderr).toContain("repo check: knip: src/a.ts: unused file; delete it\n");
    expect(stderr).not.toContain("repo check: knip: src/b.ts: unused file; delete it\n");
    expect(process.exitCode).toBe(1);
  }, 60_000);

  it("with the release pack on, prints actionlint's problem for a workflow to stderr and exits 1", async () => {
    writeConfigs();
    fs.writeFileSync(path.join(dir, "workerstack.config.ts"), 'export default { packs: ["release"] };\n');
    const flows = path.join(dir, ".github", "workflows");
    fs.mkdirSync(flows, { recursive: true });
    const job = "  build:\n    runs_on: ubuntu-latest\n    steps:\n      - run: echo hi\n";
    fs.writeFileSync(path.join(flows, "other.yml"), `name: x\non: push\njobs:\n${job}`);
    await start();
    const line = 'repo check: actionlint: .github/workflows/other.yml:5:5: unexpected key "runs_on" for "job" section';
    expect(stderr.some((text) => text.startsWith(line) && text.endsWith("[syntax-check]\n"))).toBe(true);
    expect(process.exitCode).toBe(1);
  }, 180_000);

  it("with the standards pack on, prints each live lint.skip and its count, and exits 1 on a stale entry", async () => {
    writeConfigs();
    write("package.json", { name: "app", private: true, sideEffects: false, packageManager: `bun@${Bun.version}` });
    const reason = "the lookup result is always present";
    const skip = (file: string) => ({ files: [file], rules: ["typescript/no-non-null-assertion"], reason });
    const config = { packs: ["standards"], lint: { skip: [skip("src/a.ts"), skip("src/b.ts")] } };
    fs.writeFileSync(path.join(dir, "workerstack.config.ts"), `export default ${JSON.stringify(config)};\n`);
    fs.mkdirSync(path.join(dir, "src"));
    fs.writeFileSync(path.join(dir, "src/a.ts"), "export const a = (xs: string[]): string => xs.find(Boolean)!;\n");
    fs.writeFileSync(path.join(dir, "src/b.ts"), "export const b = 1;\n");
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await start();
    const printed = stdout.mock.calls.map(([line]) => String(line));
    stdout.mockRestore();
    expect(printed).toEqual([
      `repo check: skip typescript/no-non-null-assertion in src/a.ts: 1 hit (${reason})\n`,
      "repo check: skips: typescript/no-non-null-assertion 1\n",
    ]);
    expect(besidesKnip()).toBe(
      'repo check: lint.skip[1]: typescript/no-non-null-assertion has no hit in "src/b.ts"; delete it from the entry\n',
    );
    expect(process.exitCode).toBe(1);
    expect(fs.readdirSync(dir).filter((name) => name.startsWith(".oxlintrc.unskipped-"))).toEqual([]);
  }, 60_000);

  it("with the standards pack on, reports a skipped magic rule's hits and counts the other over the baseline", async () => {
    write("package.json", { name: "app", private: true, sideEffects: false, packageManager: `bun@${Bun.version}` });
    const reason = "retry tuning lives here for now";
    const skip = { files: ["src/retry.ts"], rules: ["repo/magic-number"], reason };
    const config = { packs: ["standards"], lint: { skip: [skip] } };
    fs.writeFileSync(path.join(dir, "workerstack.config.ts"), `export default ${JSON.stringify(config)};\n`);
    const synced = { packs: ["standards" as const], agents: NO_AGENTS, ...BASE_CONFIG };
    const workspace = { root: "", manifest: {}, packages: [] };
    for (const output of standards({ root: "", config: synced, workspace, read: () => null }, []).outputs)
      if (output.kind === "file") {
        fs.mkdirSync(path.dirname(path.join(dir, output.path)), { recursive: true });
        fs.writeFileSync(path.join(dir, output.path), output.content);
      }
    fs.mkdirSync(path.join(dir, "src"));
    const retry =
      'export const wait = (): number => 5000 + 3;\nexport const is = (m: string): boolean => m === "fast";\n';
    fs.writeFileSync(path.join(dir, "src/retry.ts"), retry);
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await start();
    const printed = stdout.mock.calls.map(([line]) => String(line));
    stdout.mockRestore();
    expect(printed).toEqual([
      `repo check: skip repo/magic-number in src/retry.ts: 2 hits (${reason})\n`,
      "repo check: skips: repo/magic-number 2\n",
    ]);
    expect(besidesKnip()).toBe(
      "repo check: .repo/lint-baseline.json: src/retry.ts has 1 repo(magic-string), the baseline allows 0\n",
    );
    expect(process.exitCode).toBe(1);
  }, 60_000);

  it("with the standards pack on, prints each reject file problem and counts an untested guard over the baseline", async () => {
    write("package.json", { name: "app", private: true, sideEffects: false, packageManager: `bun@${Bun.version}` });
    fs.writeFileSync(path.join(dir, "workerstack.config.ts"), 'export default { packs: ["standards"] };\n');
    const synced = { packs: ["standards" as const], agents: NO_AGENTS, ...BASE_CONFIG };
    const workspace = { root: "", manifest: {}, packages: [] };
    for (const output of standards({ root: "", config: synced, workspace, read: () => null }, []).outputs)
      if (output.kind === "file") {
        fs.mkdirSync(path.dirname(path.join(dir, output.path)), { recursive: true });
        fs.writeFileSync(path.join(dir, output.path), output.content);
      }
    fs.mkdirSync(path.join(dir, "src"));
    const guard = "export const isUser = (value: unknown): value is string[] => Array.isArray(value);\n";
    fs.writeFileSync(path.join(dir, "src/is-user.ts"), guard);
    fs.writeFileSync(path.join(dir, "src/user.reject.ts"), 'lod("u2");\n');
    await start();
    expect(besidesKnip()).toBe(
      [
        "repo check: rejections: src/user.reject.ts: line 1 fails unmarked: TS2304: Cannot find name 'lod'.",
        "repo check: .repo/lint-baseline.json: src/is-user.ts has 1 repo(guard-rejects), the baseline allows 0",
        "",
      ].join("\n"),
    );
    expect(process.exitCode).toBe(1);
  }, 60_000);

  /** Commits the working tree to `main`, then moves to a `feature` branch. */
  function commitMain(): void {
    const git = (...args: string[]) =>
      runGit(
        "git",
        [
          "-c",
          "user.name=t",
          "-c",
          "user.email=t@t",
          "-c",
          "commit.gpgsign=false",
          "-c",
          "core.autocrlf=false",
          ...args,
        ],
        { cwd: dir },
      );
    git("checkout", "-q", "-b", "main");
    git("add", "-A");
    git("commit", "-q", "-m", "main");
    git("checkout", "-q", "-b", "feature");
  }

  it("fails a floor lower than main's", async () => {
    writeConfigs();
    write("coverage-floors.json", { "src/a.ts": { statements: 90, branches: 80, functions: 90 } });
    fs.mkdirSync(path.join(dir, "src"));
    fs.writeFileSync(path.join(dir, "src/a.ts"), "export const a = 1;\n");
    commitMain();
    write("coverage-floors.json", { "src/a.ts": { statements: 90, branches: 70, functions: 90 } });
    await start();
    expect(besidesKnip()).toBe(
      "repo check: coverage-floors.json: src/a.ts branches 70 is below main's 80; floors only rise\n",
    );
    expect(process.exitCode).toBe(1);
  }, 60_000);

  it("fails an it.fails case that known-failures.json does not list", async () => {
    writeConfigs();
    fs.mkdirSync(path.join(dir, "src"));
    fs.writeFileSync(path.join(dir, "src/a.test.ts"), 'it.fails("parses times", () => {});\n');
    await start();
    expect(besidesKnip()).toBe(
      'repo check: src/a.test.ts:1: it.fails("parses times") is not in known-failures.json; list it or fix it\n',
    );
    expect(process.exitCode).toBe(1);
  }, 60_000);

  it("reads no test files outside a git checkout", async () => {
    writeConfigs();
    fs.rmSync(path.join(dir, ".git"), { recursive: true, force: true });
    await start();
    expect(besidesKnip()).toBe("");
    expect(process.exitCode).toBe(0);
  });

  it("without the standards pack says nothing of disable comments", async () => {
    writeConfigs();
    fs.mkdirSync(path.join(dir, "src"));
    fs.writeFileSync(path.join(dir, "src/a.ts"), "export const a = 1;\n// @ts-ignore\n");
    await start();
    expect(besidesKnip()).toBe("");
    expect(process.exitCode).toBe(0);
  });

  it("without the standards pack prints no manifest lines", async () => {
    writeConfigs();
    write("package.json", { name: "app" });
    await start();
    expect(besidesKnip()).toBe("");
    expect(process.exitCode).toBe(0);
  });

  it("leaves an unreadable manifest to sync --check and prints nothing twice", async () => {
    writeConfigs();
    write("package.json", { name: "app", private: "yes" });
    fs.writeFileSync(path.join(dir, "workerstack.config.ts"), 'export default { packs: ["standards"] };\n');
    runSync.mockResolvedValue(1);
    await start();
    expect(besidesKnip()).not.toContain("repo check: package.json");
    expect(process.exitCode).toBe(1);
  }, 60_000);

  it("exits 1 when sync --check finds drift", async () => {
    writeConfigs();
    runSync.mockResolvedValue(1);
    await start();
    expect(process.exitCode).toBe(1);
  });
});
