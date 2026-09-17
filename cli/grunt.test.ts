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
const isInteractive = vi.hoisted(() => vi.fn(() => false));
const select = vi.hoisted(() => vi.fn());
const confirm = vi.hoisted(() => vi.fn());
const spinner = vi.hoisted(() =>
  vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
);
const bailIfCancel = vi.hoisted(() => vi.fn((v) => v));

vi.mock("./init.mjs", () => ({
  init,
  destAlreadyInited,
  shouldAutoSkipGlobals,
  toGruntScriptName,
  RESERVED_SKILLS: ["browser", "tmp", "write-plan"],
  GRUNT_NPM_PREFIX: "grunt:",
}));
const leftoverKeysWarn = vi.hoisted(() => vi.fn(() => ""));
vi.mock("../scripts/grunt-config.mjs", () => ({ leftoverKeysWarn }));
vi.mock("node:child_process", () => ({ execFileSync }));
vi.mock("./prompt.mjs", () => ({
  isInteractive,
  select,
  confirm,
  spinner,
  bailIfCancel,
}));

import { parseArgv, start } from "./grunt.mjs";

const USAGE = `Usage: grunt [command]

Default (no command): TTY menu; else init — full setup

Commands:
  init          Full setup: merge SoT, npm install, grunt:rulesync:generate, grunt:sync:globals:apply, grunt:rulesync:check
  generate      npm run grunt:rulesync:generate
  check         npm run grunt:rulesync:check
  sync-globals  npm run grunt:sync:globals (dry-run; --apply to write)
  purge-mcps    npm run grunt:purge:global-mcps (dry-run; --apply to write)
  doctor        npm run grunt:doctor
  upgrade       Re-init: copy owned files, prune retired grunt-owned names, warn leftover config, print reserved skills
  help          Show this help
  version       Print package version

Flags:
  --skip-globals     Skip sync:globals:apply (auto-skipped when already initialized)
  --yes, -y          Non-interactive (not --apply)
  --non-interactive  Same as --yes
  --apply            Write for sync-globals / purge-mcps
  --host <id>        sync-globals host
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
    leftoverKeysWarn.mockReset();
    leftoverKeysWarn.mockReturnValue("");
    init.mockReset();
    destAlreadyInited.mockReset();
    destAlreadyInited.mockReturnValue(false);
    shouldAutoSkipGlobals.mockReset();
    shouldAutoSkipGlobals.mockReturnValue(false);
    execFileSync.mockReset();
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
    expect(init).toHaveBeenCalledWith(process.cwd(), { skipGlobals: false });
    expect(execFileSync).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
  });

  it("init runs init on cwd", async () => {
    process.argv = ["node", "grunt", "init"];
    await start();
    expect(init).toHaveBeenCalledOnce();
    expect(init).toHaveBeenCalledWith(process.cwd(), { skipGlobals: false });
  });

  it.each([
    ["node", "grunt", "--skip-globals"],
    ["node", "grunt", "init", "--skip-globals"],
    ["node", "grunt", "--skip-globals", "init"],
  ])("passes skipGlobals when argv is %s", async (...argv) => {
    process.argv = argv;
    await start();
    expect(init).toHaveBeenCalledOnce();
    expect(init).toHaveBeenCalledWith(process.cwd(), { skipGlobals: true });
  });

  it.each(["--yes", "-y", "--non-interactive"])(
    "%s no-arg still init, no menu",
    async (flag) => {
      process.argv = ["node", "grunt", flag];
      await start();
      expect(isInteractive).toHaveBeenCalledOnce();
      expect(select).not.toHaveBeenCalled();
      expect(init).toHaveBeenCalledOnce();
      expect(init).toHaveBeenCalledWith(process.cwd(), { skipGlobals: false });
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

  it("upgrade runs init, prints reserved, and leftover warn", async () => {
    leftoverKeysWarn.mockReturnValue("warn: leftoverGate");
    process.argv = ["node", "grunt", "upgrade"];
    await start();
    expect(init).toHaveBeenCalledOnce();
    expect(init).toHaveBeenCalledWith(process.cwd(), { skipGlobals: false });
    expect(chunks.join("")).toBe("warn: leftoverGate\nreserved: browser tmp write-plan\n");
    expect(select).not.toHaveBeenCalled();
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
      "upgrade",
      "help",
      "quit",
    ]);
    expect(init).toHaveBeenCalled();
    expect(isInteractive).toHaveBeenCalledOnce();
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
      (c) => String((c[0] as { message?: string }).message).includes("globals"),
    );
    expect(globalsConfirm?.[0]).toMatchObject({ initialValue: false });
    expect(init).toHaveBeenCalledWith(
      process.cwd(),
      expect.objectContaining({
        skipGlobals: false,
        applyGlobals: true,
        onPhase: expect.any(Function),
      }),
    );
    expect(isInteractive).toHaveBeenCalledOnce();
    expect(spin.start).toHaveBeenCalledWith("merge");
    expect(spin.stop).toHaveBeenCalled();
    expect(spin.start).toHaveBeenCalledWith("install");
  });

  it("TTY init --skip-globals default confirm false maps to skip", async () => {
    isInteractive.mockReturnValue(true);
    confirm.mockResolvedValue(false);
    process.argv = ["node", "grunt", "init", "--skip-globals"];
    await start();
    expect(init).toHaveBeenCalledWith(
      process.cwd(),
      expect.objectContaining({
        skipGlobals: true,
        applyGlobals: false,
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
