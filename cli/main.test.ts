import { expect, it } from "vitest";

import { USAGE, anyFunction, mainFakes, pkgVersion, useStart } from "./__fixtures__/main-kit.ts";
import { dispatch } from "./dispatch.ts";
import { start } from "./main.ts";
import { parseArgv } from "./parse-argv.ts";

const fakes = mainFakes();
const written = useStart(fakes);
const { init, mapCommand, packageJson, runSync } = fakes;
const { isInteractive, select } = fakes.prompts;

it.each(["help", "--help", "-h"])("%s writes usage", async (cmd) => {
  process.argv = ["node", "repo", cmd];
  await start(fakes);
  expect(written.out.join("")).toBe(USAGE);
  expect(process.exitCode).toBe(0);
  expect(init).not.toHaveBeenCalled();
  expect(select).not.toHaveBeenCalled();
});

it.each(["version", "--version", "-v"])("%s writes package version", async (cmd) => {
  process.argv = ["node", "repo", cmd];
  await start(fakes);
  expect(written.out.join("")).toBe(`${pkgVersion()}\n`);
  expect(process.exitCode).toBe(0);
});

it("version with the real deps prints this package's version", async () => {
  process.argv = ["node", "repo", "version"];
  await start();
  expect(written.out.join("")).toBe(`${pkgVersion()}\n`);
});

it("dispatch with the real deps prints this package's version", async () => {
  await dispatch("version", parseArgv(["version"]));
  expect(written.out.join("")).toBe(`${pkgVersion()}\n`);
});

it.each([["null"], ['{"name":"x"}'], ['{"version":3}']])("version refuses a package.json that is %s", async (text) => {
  packageJson.mockReturnValueOnce(text);
  process.argv = ["node", "repo", "version"];
  await expect(start(fakes)).rejects.toThrow("package.json has no version");
});

it.each([["init"], []])("no-arg and init run init on cwd", async (...args) => {
  process.argv = ["node", "repo", ...args];
  await start(fakes);
  expect(init).toHaveBeenCalledOnce();
  expect(init).toHaveBeenCalledWith(process.cwd(), { skipGlobals: false });
  expect(select).not.toHaveBeenCalled();
});

it.each([["--skip-globals"], ["init", "--skip-globals"], ["--skip-globals", "init"]])(
  "passes skipGlobals when argv is %s",
  async (...args) => {
    process.argv = ["node", "repo", ...args];
    await start(fakes);
    expect(init).toHaveBeenCalledOnce();
    expect(init).toHaveBeenCalledWith(process.cwd(), { skipGlobals: true });
  },
);

it.each(["--yes", "-y", "--non-interactive"])("%s no-arg still init, no menu", async (flag) => {
  process.argv = ["node", "repo", flag];
  await start(fakes);
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
  await start(fakes);
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
  await start(fakes);
  expect(mapCommand).toHaveBeenLastCalledWith(process.cwd(), dir);
  expect(written.out.join("")).toBe(printed);
});

it.each(["nope", "generate", "upgrade"])("%s is an unknown command: one line on stderr and exitCode 1", async (cmd) => {
  process.argv = ["node", "repo", cmd];
  await start(fakes);
  expect(written.err.join("")).toBe(`repo: unknown command "${cmd}"; run \`repo --help\`\n`);
  expect(written.out.join("")).toBe("");
  expect(process.exitCode).toBe(1);
  expect(init).not.toHaveBeenCalled();
  expect(runSync).not.toHaveBeenCalled();
});

it("unknown --packs writes usage", async () => {
  process.argv = ["node", "repo", "init", "--packs", "nope"];
  await start(fakes);
  expect(written.out.join("")).toBe(USAGE);
  expect(process.exitCode).toBe(1);
  expect(init).not.toHaveBeenCalled();
});
