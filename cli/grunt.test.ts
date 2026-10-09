import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const init = vi.hoisted(() => vi.fn());
const destAlreadyInited = vi.hoisted(() => vi.fn(() => false));
const shouldAutoSkipGlobals = vi.hoisted(() => vi.fn(() => false));
const toGruntScriptName = vi.hoisted(
  () => (k) => (String(k).startsWith("grunt:") ? k : `grunt:${k}`),
);
const execFileSync = vi.hoisted(() => vi.fn());
const detectPackageManager = vi.hoisted(() => vi.fn());
const actualDetect = vi.hoisted(() => ({ fn: null as null | ((...args: unknown[]) => unknown) }));
const isInteractive = vi.hoisted(() => vi.fn(() => false));
const select = vi.hoisted(() => vi.fn());
const multiselect = vi.hoisted(() => vi.fn(async () => []));
const confirm = vi.hoisted(() => vi.fn());
const selectedPacks = vi.hoisted(() => vi.fn(() => [] as string[]));
const spinner = vi.hoisted(() =>
  vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
);
const bailIfCancel = vi.hoisted(() => vi.fn((v) => v));
const selfUpdate = vi.hoisted(() => vi.fn(async () => ({ reexeced: false })));
const mapCommand = vi.hoisted(() => vi.fn((_cwd: string, dir: string) => `map:${dir}\n`));

vi.mock("./init.mjs", () => ({
  init,
  destAlreadyInited,
  shouldAutoSkipGlobals,
  toGruntScriptName,
  RESERVED_SKILLS: ["browser", "tmp", "write-plan"],
  GRUNT_NPM_PREFIX: "grunt:",
}));
vi.mock("./spawn.mjs", () => ({ execFileSync }));
vi.mock("./self-update.mjs", () => ({ selfUpdate }));
vi.mock("../scripts/folder-map.mjs", () => ({ mapCommand }));
vi.mock("../scripts/package-manager.mjs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../scripts/package-manager.mjs")>();
  actualDetect.fn = actual.detectPackageManager;
  detectPackageManager.mockImplementation((...args: unknown[]) =>
    actual.detectPackageManager(
      ...(args as Parameters<typeof actual.detectPackageManager>),
    ),
  );
  return { ...actual, detectPackageManager };
});
vi.mock("./prompt.mjs", () => ({
  isInteractive,
  select,
  multiselect,
  confirm,
  spinner,
  bailIfCancel,
}));
vi.mock("../scripts/feature-packs.mjs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../scripts/feature-packs.mjs")>();
  return { ...actual, selectedPacks };
});

import {
  PACKAGE_MANAGER_ASK,
  UNKNOWN_PACKAGE_MANAGER,
} from "../scripts/package-manager.mjs";
import { APPLY_GLOBALS_CONFIRM, parseArgv, start } from "./grunt.mjs";

const USAGE = `Usage: grunt [command]

Default (no command): TTY menu; else init — full setup

Commands:
  init          Full setup: merge SoT, install, grunt:rulesync:generate, grunt:sync:globals:apply, grunt:rulesync:check
  generate      run grunt:rulesync:generate
  check         run grunt:rulesync:check
  sync-globals  run grunt:sync:globals (dry-run; --apply to write)
  purge-mcps    run grunt:purge:global-mcps (dry-run; --apply to write)
  doctor        run grunt:doctor
  setup         run grunt:setup — handheld keys/OAuth (speak, listen, google-workspace, browser, jev)
  upgrade       Self-update to the latest grunt, then re-init: copy owned files, prune retired names, print reserved skills
  map [dir]     Code-only folder map (git-tracked, no files); dir for depth
  help          Show this help
  version       Print package version

Flags:
  --skip-globals     Skip sync:globals:apply (auto-skipped when already initialized)
  --no-self-update   upgrade: keep the installed grunt version
  --yes, -y          Non-interactive (not --apply)
  --non-interactive  Same as --yes
  --apply            Write for sync-globals / purge-mcps
  --host <id>        sync-globals host
  --pm <name>        npm | yarn | pnpm | bun (else lockfile, then how grunt was launched, then ask)
  --packs <list>     Optional packs: google-workspace,listen,speak,clasp or none
`;

const pkgRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(
  fs.readFileSync(path.join(pkgRoot, "package.json"), "utf8"),
).version as string;

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
    destAlreadyInited.mockReset();
    destAlreadyInited.mockReturnValue(false);
    shouldAutoSkipGlobals.mockReset();
    shouldAutoSkipGlobals.mockReturnValue(false);
    execFileSync.mockReset();
    selfUpdate.mockReset();
    selfUpdate.mockResolvedValue({ reexeced: false });
    detectPackageManager.mockReset();
    detectPackageManager.mockImplementation((...args: unknown[]) =>
      (actualDetect.fn as (...a: unknown[]) => unknown)(...args),
    );
    isInteractive.mockReset();
    isInteractive.mockReturnValue(false);
    select.mockReset();
    confirm.mockReset();
    spinner.mockReset();
    spinner.mockImplementation(() => ({ start: vi.fn(), stop: vi.fn() }));
    bailIfCancel.mockReset();
    bailIfCancel.mockImplementation((v) => v);
    multiselect.mockReset();
    multiselect.mockResolvedValue([]);
    selectedPacks.mockReset();
    selectedPacks.mockReturnValue([]);
  });

  afterEach(() => {
    process.argv = argv;
    process.exitCode = exitCode;
    process.stdout.write = stdoutWrite;
  });

  it.each(["help", "--help", "-h"])("%s writes usage", async (cmd) => {
    process.argv = ["node", "grunt", cmd];
    await start();
    expect(chunks.join("")).toBe(USAGE);
    expect(process.exitCode).toBe(0);
    expect(init).not.toHaveBeenCalled();
    expect(execFileSync).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
  });

  it.each(["version", "--version", "-v"])("%s writes package version", async (cmd) => {
    process.argv = ["node", "grunt", cmd];
    await start();
    expect(chunks.join("")).toBe(`${version}\n`);
    expect(process.exitCode).toBe(0);
  });

  it("no-arg runs init on cwd", async () => {
    process.argv = ["node", "grunt"];
    await start();
    expect(init).toHaveBeenCalledOnce();
    expect(init).toHaveBeenCalledWith(process.cwd(), {
      skipGlobals: false,
      packageManager: "npm",
    });
    expect(execFileSync).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
  });

  it("init runs init on cwd", async () => {
    process.argv = ["node", "grunt", "init"];
    await start();
    expect(init).toHaveBeenCalledOnce();
    expect(init).toHaveBeenCalledWith(process.cwd(), {
      skipGlobals: false,
      packageManager: "npm",
    });
  });

  it.each([
    ["node", "grunt", "--skip-globals"],
    ["node", "grunt", "init", "--skip-globals"],
    ["node", "grunt", "--skip-globals", "init"],
  ])("passes skipGlobals when argv is %s", async (...argv) => {
    process.argv = argv;
    await start();
    expect(init).toHaveBeenCalledOnce();
    expect(init).toHaveBeenCalledWith(process.cwd(), {
      skipGlobals: true,
      packageManager: "npm",
    });
  });

  it.each(["--yes", "-y", "--non-interactive"])(
    "%s no-arg still init, no menu",
    async (flag) => {
      process.argv = ["node", "grunt", flag];
      await start();
      expect(isInteractive).toHaveBeenCalledOnce();
      expect(select).not.toHaveBeenCalled();
      expect(init).toHaveBeenCalledOnce();
      expect(init).toHaveBeenCalledWith(process.cwd(), {
        skipGlobals: false,
        packageManager: "npm",
      });
    },
  );

  it("generate npm-runs grunt:rulesync:generate", async () => {
    process.argv = ["node", "grunt", "generate"];
    await start();
    expect(execFileSync).toHaveBeenCalledOnce();
    expect(execFileSync).toHaveBeenCalledWith("npm", ["run", "grunt:rulesync:generate"], {
      cwd: process.cwd(),
      stdio: "inherit",
    });
    expect(init).not.toHaveBeenCalled();
  });

  it("check npm-runs grunt:rulesync:check", async () => {
    process.argv = ["node", "grunt", "check"];
    await start();
    expect(execFileSync).toHaveBeenCalledOnce();
    expect(execFileSync).toHaveBeenCalledWith("npm", ["run", "grunt:rulesync:check"], {
      cwd: process.cwd(),
      stdio: "inherit",
    });
  });

  it("sync-globals dry-run default; --yes is not apply", async () => {
    process.argv = ["node", "grunt", "sync-globals", "--yes"];
    await start();
    expect(execFileSync).toHaveBeenCalledOnce();
    expect(execFileSync).toHaveBeenCalledWith("npm", ["run", "grunt:sync:globals"], {
      cwd: process.cwd(),
      stdio: "inherit",
    });
  });

  it("sync-globals --host grok last pair passes host", async () => {
    process.argv = ["node", "grunt", "sync-globals", "--host", "grok"];
    await start();
    expect(execFileSync).toHaveBeenCalledWith(
      "npm",
      ["run", "grunt:sync:globals", "--", "--host", "grok"],
      { cwd: process.cwd(), stdio: "inherit" },
    );
  });

  it("sync-globals --apply --host passes extra args", async () => {
    process.argv = ["node", "grunt", "sync-globals", "--apply", "--host", "grok"];
    await start();
    expect(execFileSync).toHaveBeenCalledWith(
      "npm",
      ["run", "grunt:sync:globals:apply", "--", "--host", "grok"],
      { cwd: process.cwd(), stdio: "inherit" },
    );
  });

  it("sync-globals --host last without id: usage exit 1", async () => {
    process.argv = ["node", "grunt", "sync-globals", "--host"];
    await start();
    expect(chunks.join("")).toBe(USAGE);
    expect(process.exitCode).toBe(1);
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it("sync-globals --host=claude dry-run", async () => {
    process.argv = ["node", "grunt", "sync-globals", "--host=claude"];
    await start();
    expect(execFileSync).toHaveBeenCalledWith(
      "npm",
      ["run", "grunt:sync:globals", "--", "--host", "claude"],
      { cwd: process.cwd(), stdio: "inherit" },
    );
  });

  it("purge-mcps dry-run default", async () => {
    process.argv = ["node", "grunt", "purge-mcps"];
    await start();
    expect(execFileSync).toHaveBeenCalledWith("npm", ["run", "grunt:purge:global-mcps"], {
      cwd: process.cwd(),
      stdio: "inherit",
    });
  });

  it("purge-mcps --apply", async () => {
    process.argv = ["node", "grunt", "--apply", "purge-mcps"];
    await start();
    expect(execFileSync).toHaveBeenCalledWith(
      "npm",
      ["run", "grunt:purge:global-mcps:apply"],
      { cwd: process.cwd(), stdio: "inherit" },
    );
  });

  it("doctor npm-runs grunt:doctor", async () => {
    process.argv = ["node", "grunt", "doctor"];
    await start();
    expect(execFileSync).toHaveBeenCalledWith("npm", ["run", "grunt:doctor"], {
      cwd: process.cwd(),
      stdio: "inherit",
    });
  });

  it("setup npm-runs grunt:setup", async () => {
    process.argv = ["node", "grunt", "setup"];
    await start();
    expect(execFileSync).toHaveBeenCalledWith("npm", ["run", "grunt:setup"], {
      cwd: process.cwd(),
      stdio: "inherit",
    });
  });

  it("setup npm-runs grunt:setup with extra args", async () => {
    process.argv = ["node", "grunt", "setup", "speak", "--skip-verify"];
    await start();
    expect(execFileSync).toHaveBeenCalledWith(
      "npm",
      ["run", "grunt:setup", "--", "speak", "--skip-verify"],
      { cwd: process.cwd(), stdio: "inherit" },
    );
  });

  it("upgrade runs init and prints reserved", async () => {
    process.argv = ["node", "grunt", "upgrade"];
    await start();
    expect(init).toHaveBeenCalledOnce();
    expect(init).toHaveBeenCalledWith(process.cwd(), {
      skipGlobals: false,
      packageManager: "npm",
    });
    expect(chunks.join("")).toBe("reserved: browser tmp write-plan\n");
    expect(select).not.toHaveBeenCalled();
    expect(selfUpdate).toHaveBeenCalledOnce();
    expect(selfUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: process.cwd(),
        pkgRoot,
        currentVersion: version,
        pm: "npm",
        argv: ["upgrade"],
      }),
    );
  });

  it("upgrade stops after a self-update re-exec and keeps its exit code", async () => {
    process.argv = ["node", "grunt", "upgrade"];
    selfUpdate.mockResolvedValue({ reexeced: true, status: 2 });
    await start();
    expect(init).not.toHaveBeenCalled();
    expect(chunks.join("")).toBe("");
    expect(process.exitCode).toBe(2);
  });

  it("upgrade --no-self-update skips the self-update", async () => {
    process.argv = ["node", "grunt", "upgrade", "--no-self-update"];
    await start();
    expect(selfUpdate).not.toHaveBeenCalled();
    expect(init).toHaveBeenCalledOnce();
  });

  it("other commands never self-update", async () => {
    process.argv = ["node", "grunt", "doctor"];
    await start();
    expect(selfUpdate).not.toHaveBeenCalled();
  });

  it("map prints the folder map without a package manager", async () => {
    process.argv = ["node", "grunt", "map"];
    await start();
    expect(mapCommand).toHaveBeenLastCalledWith(process.cwd(), "");
    expect(chunks.join("")).toBe("map:\n");
    expect(detectPackageManager).not.toHaveBeenCalled();
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it("map <dir> scopes the folder map", async () => {
    process.argv = ["node", "grunt", "map", "packages/web"];
    await start();
    expect(mapCommand).toHaveBeenLastCalledWith(process.cwd(), "packages/web");
    expect(chunks.join("")).toBe("map:packages/web\n");
  });

  it("unknown writes usage and exitCode 1", async () => {
    process.argv = ["node", "grunt", "nope"];
    await start();
    expect(chunks.join("")).toBe(USAGE);
    expect(process.exitCode).toBe(1);
    expect(init).not.toHaveBeenCalled();
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it("TTY no cmd shows menu default init", async () => {
    isInteractive.mockReturnValue(true);
    select.mockResolvedValue("init");
    confirm.mockResolvedValue(true);
    process.argv = ["node", "grunt"];
    await start();
    expect(select).toHaveBeenCalledOnce();
    const opts = select.mock.calls[0][0] as {
      initialValue: string;
      options: { value: string }[];
    };
    expect(opts.initialValue).toBe("init");
    expect(opts.options.map((o) => o.value)).toEqual([
      "init",
      "generate",
      "check",
      "sync-globals",
      "purge-mcps",
      "doctor",
      "setup",
      "upgrade",
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

  it("TTY menu generate", async () => {
    isInteractive.mockReturnValue(true);
    select.mockResolvedValue("generate");
    process.argv = ["node", "grunt"];
    await start();
    expect(execFileSync).toHaveBeenCalledWith("npm", ["run", "grunt:rulesync:generate"], {
      cwd: process.cwd(),
      stdio: "inherit",
    });
  });

  it("TTY menu help writes usage", async () => {
    isInteractive.mockReturnValue(true);
    select.mockResolvedValue("help");
    process.argv = ["node", "grunt"];
    await start();
    expect(chunks.join("")).toBe(USAGE);
    expect(process.exitCode).toBe(0);
  });

  it("TTY menu quit does nothing", async () => {
    isInteractive.mockReturnValue(true);
    select.mockResolvedValue("quit");
    process.argv = ["node", "grunt"];
    await start();
    expect(init).not.toHaveBeenCalled();
    expect(execFileSync).not.toHaveBeenCalled();
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
    process.argv = ["node", "grunt"];
    await expect(start()).rejects.toThrow("EXIT");
    expect(exit).toHaveBeenCalledWith(0);
    expect(init).not.toHaveBeenCalled();
    exit.mockRestore();
  });

  it("TTY init already-inited decline skips init", async () => {
    isInteractive.mockReturnValue(true);
    destAlreadyInited.mockReturnValue(true);
    confirm.mockResolvedValue(false);
    process.argv = ["node", "grunt", "init"];
    await start();
    expect(confirm).toHaveBeenCalled();
    expect(init).not.toHaveBeenCalled();
  });

  it("TTY init confirms globals; spinner onPhase stop before inherit", async () => {
    isInteractive.mockReturnValue(true);
    shouldAutoSkipGlobals.mockReturnValue(true);
    const spin = { start: vi.fn(), stop: vi.fn() };
    spinner.mockReturnValue(spin);
    confirm.mockResolvedValue(true);
    init.mockImplementation((_dest: string, opts: { onPhase?: (n: string, a: string) => void }) => {
      opts.onPhase?.("merge", "start");
      opts.onPhase?.("merge", "stop");
      opts.onPhase?.("install", "start");
      opts.onPhase?.("install", "stop");
    });
    process.argv = ["node", "grunt", "init"];
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
        applyGlobals: true,
        packageManager: "npm",
        onPhase: expect.any(Function),
      }),
    );
    expect(isInteractive).toHaveBeenCalledOnce();
    expect(spin.start).toHaveBeenCalledWith("merge");
    expect(spin.stop).toHaveBeenCalledWith("merge");
    expect(spin.start).toHaveBeenCalledWith("install");
    expect(spin.stop).toHaveBeenCalledWith("install");
  });

  it("init --pm pnpm passes packageManager", async () => {
    process.argv = ["node", "grunt", "init", "--pm", "pnpm"];
    await start();
    expect(init).toHaveBeenCalledWith(process.cwd(), {
      skipGlobals: false,
      packageManager: "pnpm",
    });
  });

  it("generate --pm pnpm runs pnpm", async () => {
    process.argv = ["node", "grunt", "generate", "--pm", "pnpm"];
    await start();
    expect(execFileSync).toHaveBeenCalledWith("pnpm", ["run", "grunt:rulesync:generate"], {
      cwd: process.cwd(),
      stdio: "inherit",
    });
  });

  it("setup --pm=yarn extra args omit npm --", async () => {
    process.argv = ["node", "grunt", "setup", "--pm=yarn", "speak"];
    await start();
    expect(execFileSync).toHaveBeenCalledWith("yarn", ["run", "grunt:setup", "speak"], {
      cwd: process.cwd(),
      stdio: "inherit",
    });
  });

  it("invalid --pm writes usage exit 1", async () => {
    process.argv = ["node", "grunt", "generate", "--pm", "deno"];
    await start();
    expect(chunks.join("")).toBe(USAGE);
    expect(process.exitCode).toBe(1);
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it("TTY menu then unknown manager asks", async () => {
    detectPackageManager.mockReturnValue({ manager: null, source: null });
    isInteractive.mockReturnValue(true);
    select.mockResolvedValueOnce("generate").mockResolvedValueOnce("pnpm");
    process.argv = ["node", "grunt"];
    await start();
    expect(select).toHaveBeenCalledTimes(2);
    expect(execFileSync).toHaveBeenCalledWith("pnpm", ["run", "grunt:rulesync:generate"], {
      cwd: process.cwd(),
      stdio: "inherit",
    });
  });

  it("TTY unknown manager asks then runs the choice", async () => {
    detectPackageManager.mockReturnValue({ manager: null, source: null });
    isInteractive.mockReturnValue(true);
    select.mockResolvedValue("bun");
    process.argv = ["node", "grunt", "generate"];
    await start();
    expect(select).toHaveBeenCalledWith({
      message: PACKAGE_MANAGER_ASK,
      options: [
        { value: "npm", label: "npm" },
        { value: "yarn", label: "yarn" },
        { value: "pnpm", label: "pnpm" },
        { value: "bun", label: "bun" },
      ],
    });
    expect(execFileSync).toHaveBeenCalledWith("bun", ["run", "grunt:rulesync:generate"], {
      cwd: process.cwd(),
      stdio: "inherit",
    });
  });

  it("non-interactive unknown manager writes hint and skips run", async () => {
    detectPackageManager.mockReturnValue({ manager: null, source: null });
    process.argv = ["node", "grunt", "generate"];
    await start();
    expect(chunks.join("")).toBe(`${UNKNOWN_PACKAGE_MANAGER}\n`);
    expect(process.exitCode).toBe(1);
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it("TTY init --skip-globals default confirm false maps to skip", async () => {
    isInteractive.mockReturnValue(true);
    confirm.mockResolvedValue(false);
    process.argv = ["node", "grunt", "init", "--skip-globals"];
    await start();
    expect(confirm).toHaveBeenCalledWith({
      message: APPLY_GLOBALS_CONFIRM,
      initialValue: false,
    });
    expect(init).toHaveBeenCalledWith(
      process.cwd(),
      expect.objectContaining({
        skipGlobals: true,
        applyGlobals: false,
        packageManager: "npm",
        onPhase: expect.any(Function),
      }),
    );
    expect(isInteractive).toHaveBeenCalledOnce();
  });
});

describe("parseArgv --host", () => {
  it("last flag pair --host <id>", () => {
    expect(parseArgv(["sync-globals", "--host", "grok"])).toMatchObject({
      cmd: "sync-globals",
      host: "grok",
      hostError: false,
    });
  });

  it("--host last without id is hostError", () => {
    expect(parseArgv(["sync-globals", "--host"])).toMatchObject({ hostError: true });
  });

  it("--host= empty is hostError", () => {
    expect(parseArgv(["sync-globals", "--host="])).toMatchObject({ hostError: true });
  });

  it("--host followed by flag is hostError", () => {
    expect(parseArgv(["sync-globals", "--host", "--apply"])).toMatchObject({
      hostError: true,
    });
  });
});

describe("parseArgv --no-self-update", () => {
  it("sets the flag without a positional", () => {
    expect(parseArgv(["upgrade", "--no-self-update"])).toMatchObject({
      cmd: "upgrade",
      args: [],
      noSelfUpdate: true,
    });
    expect(parseArgv(["upgrade"])).toMatchObject({ noSelfUpdate: false });
  });
});

describe("parseArgv --pm", () => {
  it("pair and equals", () => {
    expect(parseArgv(["generate", "--pm", "PNPM"])).toMatchObject({
      cmd: "generate",
      pm: "pnpm",
      pmError: false,
    });
    expect(parseArgv(["generate", "--pm=Yarn"])).toMatchObject({
      pm: "yarn",
      pmError: false,
    });
  });

  it("TTY upgrade asks packs only", async () => {
    isInteractive.mockReturnValue(true);
    confirm.mockClear();
    multiselect.mockClear();
    init.mockClear();
    multiselect.mockResolvedValue(["listen", "speak"]);
    process.argv = ["node", "grunt", "upgrade", "--no-self-update"];
    await start();
    expect(confirm).not.toHaveBeenCalled();
    expect(multiselect).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Optional packs", required: false, initialValues: [] }),
    );
    expect(init).toHaveBeenCalledWith(process.cwd(), {
      skipGlobals: false,
      packageManager: "npm",
      packs: ["listen", "speak"],
    });
  });

  it("TTY init pre-checks a saved features file and skips the pack prompt when --packs is set", async () => {
    isInteractive.mockReturnValue(true);
    selectedPacks.mockReturnValue(["speak"]);
    confirm.mockResolvedValue(true);
    process.argv = ["node", "grunt", "init"];
    await start();
    expect(multiselect).toHaveBeenCalledWith(
      expect.objectContaining({ initialValues: ["speak"], required: false }),
    );
    multiselect.mockClear();
    confirm.mockClear();
    init.mockClear();
    process.argv = ["node", "grunt", "init", "--packs", "listen"];
    await start();
    expect(multiselect).not.toHaveBeenCalled();
    expect(init).toHaveBeenCalledWith(
      process.cwd(),
      expect.objectContaining({ packs: ["listen"], applyGlobals: true }),
    );
  });

  it("missing, empty, flag, and unknown are pmError", () => {
    expect(parseArgv(["generate", "--pm"])).toMatchObject({ pmError: true });
    expect(parseArgv(["generate", "--pm="])).toMatchObject({ pmError: true });
    expect(parseArgv(["generate", "--pm", "--yes"])).toMatchObject({ pmError: true });
    expect(parseArgv(["generate", "--pm", "deno"])).toMatchObject({ pmError: true });
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
    process.argv = ["node", "grunt", "init", "--packs", "nope"];
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

  it("TTY upgrade with --packs skips the pack prompt", async () => {
    isInteractive.mockReturnValue(true);
    multiselect.mockClear();
    confirm.mockClear();
    init.mockClear();
    process.argv = ["node", "grunt", "upgrade", "--no-self-update", "--packs", "listen"];
    const stdoutWrite = process.stdout.write;
    process.stdout.write = (() => true) as typeof process.stdout.write;
    try {
      await start();
      expect(multiselect).not.toHaveBeenCalled();
      expect(confirm).not.toHaveBeenCalled();
      expect(init).toHaveBeenCalledWith(process.cwd(), {
        skipGlobals: false,
        packageManager: "npm",
        packs: ["listen"],
      });
    } finally {
      process.stdout.write = stdoutWrite;
    }
  });
});
