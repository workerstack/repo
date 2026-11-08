import { execFileSync as runGit } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const init = vi.hoisted(() => vi.fn());
const isInteractive = vi.hoisted(() => vi.fn(() => false));
const select = vi.hoisted(() => vi.fn());
const confirm = vi.hoisted(() => vi.fn());
const spinner = vi.hoisted(() =>
  vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
);
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

const runCommand = vi.hoisted(() => vi.fn(async (_name: string, _argv: string[]): Promise<number> => 0));
vi.mock("./commands.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./commands.ts")>();
  return { ...actual, runCommand };
});

vi.mock("./init.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./init.ts")>();
  return { ...actual, init };
});
vi.mock("./sync.ts", () => ({ runSync }));
vi.mock("../.rulesync/scripts/folder-map.ts", () => ({ mapCommand }));
vi.mock("./prompt.ts", () => ({
  isInteractive,
  select,
  confirm,
  spinner,
  bailIfCancel,
}));
import { APPLY_GLOBALS_CONFIRM, parseArgv, start } from "./main.ts";

const USAGE = `Usage: repo [command]

Default (no command): TTY menu; else init — full setup

Commands:
  init              Full setup: write workerstack.config.ts and package.json, bun install (whose postinstall runs repo sync), repo sync-globals --apply
  check             Every tsconfig extends a base and keeps ts-reset, then repo sync --check
  sync              Write the committed generated files from workerstack.config.ts (--check: report drift; --postinstall: never fail)
  map [dir]         Code-only folder map (git-tracked, no files); dir for depth
  job               Compressed search, exec, slice, fetch and test dumps (--job search|exec|slice|fetch|test)
  worktree          Managed worktrees: add, list, finish, remove
  phase-files       Map a parallel group's unstaged changes to its phases
  lessons           Match, hit and list lessons
  browser           Browse with Lightpanda, Chromium when blocked
  google-workspace  Google Sheets, Docs, Slides, Calendar and Gmail
  jev               Yes/no or named-option decision on saved text
  listen            Speech-to-text from the mic
  speak             Text-to-speech
  setup             Handheld keys and OAuth (speak, listen, google-workspace, browser, jev)
  doctor            Check the tools and versions this repo needs
  clean             Remove scratch and stale generated files (--dry-run lists only)
  sync-globals      Sync global agent settings (dry-run; --apply to write, --host <id>)
  purge-mcps        Purge global MCP servers (dry-run; --apply to write)
  tasks             Write .vscode/tasks.json from package scripts (VS Code and Cursor)
  hook <name>       Run a hook: gate-fat-tools, orchestrate-parent, rtk-grok, scrub-spawn-prompt, session-map, worktree
  help              Show this help
  version           Print package version

Flags:
  --skip-globals     Skip sync-globals --apply (otherwise init always applies it)
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

  it.each([["null"], ['{"name":"x"}'], ['{"version":3}']])("version refuses a package.json that is %s", async (text) => {
    const read = vi.spyOn(fs, "readFileSync").mockReturnValue(text);
    syncBuiltinESMExports();
    process.argv = ["node", "repo", "version"];
    try {
      await expect(start()).rejects.toThrow("package.json has no version");
    } finally {
      read.mockRestore();
      syncBuiltinESMExports();
    }
  });

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

  it.each(["--yes", "-y", "--non-interactive"])(
    "%s no-arg still init, no menu",
    async (flag) => {
      process.argv = ["node", "repo", flag];
      await start();
      expect(isInteractive).toHaveBeenCalledOnce();
      expect(select).not.toHaveBeenCalled();
      expect(init).toHaveBeenCalledOnce();
      expect(init).toHaveBeenCalledWith(process.cwd(), {
        skipGlobals: false,
        });
    },
  );

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

  it.each(["nope", "generate", "upgrade"])("%s is an unknown command: one line on stderr and exitCode 1", async (cmd) => {
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
  });

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
      "sync-globals",
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
    `tsconfig: ${rel} sets "files", which replaces the base's reset.d.ts. List sources under "include".`;
  const NO_BASE = (rel: string) =>
    `tsconfig: ${rel} does not extend a base. Extend "@workerstack/repo/tsconfig/base", "bun", "worker" or "web".`;

  let argv: string[];
  let exitCode: typeof process.exitCode;
  let stderrWrite: typeof process.stderr.write;
  let dir: string;
  const stderr: string[] = [];

  function write(rel: string, content: object) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(content)}\n`);
  }

  beforeEach(() => {
    argv = process.argv.slice();
    exitCode = process.exitCode;
    process.exitCode = undefined;
    // A consumer repo: git, with this checkout linked where an install puts it.
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "repo-check-"));
    runGit("git", ["init", "-q"], { cwd: dir });
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
  });

  afterEach(() => {
    process.stderr.write = stderrWrite;
    vi.mocked(process.cwd).mockRestore();
    process.argv = argv;
    process.exitCode = exitCode;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("prints every bad tsconfig, still runs repo sync --check and exits 1", async () => {
    write("a/tsconfig.json", { extends: "@workerstack/repo/tsconfig/bun", files: ["src/a.ts"] });
    write("b/tsconfig.json", { include: ["src"] });
    await start();
    expect(stderr.join("")).toBe(`${SETS_FILES("a/tsconfig.json")}\n${NO_BASE("b/tsconfig.json")}\n`);
    expect(runSync).toHaveBeenCalledOnce();
    expect(runSync).toHaveBeenCalledWith(["--check"], expect.objectContaining({ cwd: dir }));
    expect(process.exitCode).toBe(1);
  });

  it("leaves the exit code unset when every tsconfig keeps a base", async () => {
    write("tsconfig.json", { extends: "@workerstack/repo/tsconfig/bun", include: ["src"] });
    await start();
    expect(stderr.join("")).toBe("");
    expect(runSync).toHaveBeenCalledOnce();
    expect(runSync).toHaveBeenCalledWith(["--check"], expect.objectContaining({ cwd: dir }));
    expect(process.exitCode).toBeUndefined();
  });

  it("exits 1 when sync --check finds drift", async () => {
    write("tsconfig.json", { extends: "@workerstack/repo/tsconfig/bun", include: ["src"] });
    runSync.mockResolvedValue(1);
    await start();
    expect(process.exitCode).toBe(1);
  });
});
