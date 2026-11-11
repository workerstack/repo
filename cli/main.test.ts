import type * as FsModule from "node:fs";

import { expect, it, vi } from "vitest";

import type * as CommandsModule from "./commands.ts";
import type * as InitModule from "./init.ts";

const fakes = await vi.hoisted(async () => {
  const kit = await import("./fixtures/main-kit.ts");
  return kit.mainFakes();
});
// Wraps the real readFileSync; the version tests swap one return value.
const readFileSync = vi.hoisted(() => vi.fn<typeof FsModule.readFileSync>());
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof FsModule>();
  readFileSync.mockImplementation(actual.readFileSync);
  return { ...actual, default: { ...actual, readFileSync }, readFileSync };
});
vi.mock(new URL("./commands.ts", import.meta.url).href, async (importOriginal) => ({
  ...(await importOriginal<typeof CommandsModule>()),
  runCommand: fakes.runCommand,
}));
vi.mock(new URL("./init.ts", import.meta.url).href, async (importOriginal) => ({
  ...(await importOriginal<typeof InitModule>()),
  init: fakes.init,
}));
vi.mock(new URL("./sync.ts", import.meta.url).href, () => ({ runSync: fakes.runSync }));
vi.mock(new URL("./scripts/folder-map.ts", import.meta.url).href, () => ({ mapCommand: fakes.mapCommand }));
vi.mock(new URL("./prompt.ts", import.meta.url).href, () => fakes);
import { USAGE, anyFunction, pkgVersion, useStart } from "./fixtures/main-kit.ts";
import { start } from "./main.ts";

const written = useStart(fakes);
const { init, isInteractive, mapCommand, runSync, select } = fakes;

it.each(["help", "--help", "-h"])("%s writes usage", async (cmd) => {
  process.argv = ["node", "repo", cmd];
  await start();
  expect(written.out.join("")).toBe(USAGE);
  expect(process.exitCode).toBe(0);
  expect(init).not.toHaveBeenCalled();
  expect(select).not.toHaveBeenCalled();
});

it.each(["version", "--version", "-v"])("%s writes package version", async (cmd) => {
  process.argv = ["node", "repo", cmd];
  await start();
  expect(written.out.join("")).toBe(`${pkgVersion()}\n`);
  expect(process.exitCode).toBe(0);
});

it.each([["null"], ['{"name":"x"}'], ['{"version":3}']])("version refuses a package.json that is %s", async (text) => {
  readFileSync.mockReturnValueOnce(text);
  process.argv = ["node", "repo", "version"];
  await expect(start()).rejects.toThrow("package.json has no version");
});

it.each([["init"], []])("no-arg and init run init on cwd", async (...args) => {
  process.argv = ["node", "repo", ...args];
  await start();
  expect(init).toHaveBeenCalledOnce();
  expect(init).toHaveBeenCalledWith(process.cwd(), { skipGlobals: false });
  expect(select).not.toHaveBeenCalled();
});

it.each([["--skip-globals"], ["init", "--skip-globals"], ["--skip-globals", "init"]])(
  "passes skipGlobals when argv is %s",
  async (...args) => {
    process.argv = ["node", "repo", ...args];
    await start();
    expect(init).toHaveBeenCalledOnce();
    expect(init).toHaveBeenCalledWith(process.cwd(), { skipGlobals: true });
  },
);

it.each(["--yes", "-y", "--non-interactive"])("%s no-arg still init, no menu", async (flag) => {
  process.argv = ["node", "repo", flag];
  await start();
  expect(isInteractive).toHaveBeenCalledOnce();
  expect(select).not.toHaveBeenCalled();
  expect(init).toHaveBeenCalledOnce();
  expect(init).toHaveBeenCalledWith(process.cwd(), { skipGlobals: false });
});

it("sync --check forwards its args and io to runSync and keeps its exit code", async () => {
  runSync.mockImplementationOnce((_args, io) => {
    io.stdout("out\n");
    io.stderr("err\n");
    return Promise.resolve(1);
  });
  process.argv = ["node", "repo", "sync", "--check"];
  await start();
  expect(runSync).toHaveBeenCalledOnce();
  expect(runSync).toHaveBeenCalledWith(["--check"], {
    cwd: process.cwd(),
    stderr: anyFunction(),
    stdout: anyFunction(),
  });
  expect(written.out.join("")).toBe("out\n");
  expect(written.err.join("")).toBe("err\n");
  expect(process.exitCode).toBe(1);
});

it.each([
  [[], "map:\n", ""],
  [["packages/web"], "map:packages/web\n", "packages/web"],
])("map %s prints the folder map without running a script", async (args, printed, dir) => {
  process.argv = ["node", "repo", "map", ...args];
  await start();
  expect(mapCommand).toHaveBeenLastCalledWith(process.cwd(), dir);
  expect(written.out.join("")).toBe(printed);
});

it.each(["nope", "generate", "upgrade"])("%s is an unknown command: one line on stderr and exitCode 1", async (cmd) => {
  process.argv = ["node", "repo", cmd];
  await start();
  expect(written.err.join("")).toBe(`repo: unknown command "${cmd}"; run \`repo --help\`\n`);
  expect(written.out.join("")).toBe("");
  expect(process.exitCode).toBe(1);
  expect(init).not.toHaveBeenCalled();
  expect(runSync).not.toHaveBeenCalled();
});

it("unknown --packs writes usage", async () => {
  process.argv = ["node", "repo", "init", "--packs", "nope"];
  await start();
  expect(written.out.join("")).toBe(USAGE);
  expect(process.exitCode).toBe(1);
  expect(init).not.toHaveBeenCalled();
});
