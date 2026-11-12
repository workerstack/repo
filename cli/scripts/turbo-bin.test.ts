import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { turboBin, turboRunner } from "./turbo-bin.ts";

const ROOT = path.resolve("/repo");
const TURBO_DIR = path.resolve("/repo/node_modules/turbo");

/** A resolver that finds turbo from the root, and the platform packages in `installed` from turbo's dir. */
function resolver(installed: string[]) {
  const calls: [string, string][] = [];

  function resolve(specifier: string, from: string): string {
    calls.push([specifier, from]);

    if (specifier === "turbo/package.json" && from === ROOT) return path.join(TURBO_DIR, "package.json");

    if (installed.includes(specifier))
      return path.resolve(`/repo/node_modules/${path.dirname(specifier)}/package.json`);
    throw new Error(`cannot find ${specifier}`);
  }

  return { calls, resolve };
}

it.each([
  { arch: "x64", bin: "turbo", name: "@turbo/linux-64", platform: "linux" },
  { arch: "arm64", bin: "turbo", name: "@turbo/linux-arm64", platform: "linux" },
  { arch: "x64", bin: "turbo", name: "@turbo/darwin-64", platform: "darwin" },
  { arch: "arm64", bin: "turbo", name: "@turbo/darwin-arm64", platform: "darwin" },
  { arch: "x64", bin: "turbo.exe", name: "@turbo/windows-64", platform: "win32" },
  { arch: "arm64", bin: "turbo.exe", name: "@turbo/windows-arm64", platform: "win32" },
])("$platform $arch resolves $name/package.json from turbo's dir to bin/$bin", ({ platform, arch, name, bin }) => {
  const { resolve, calls } = resolver([`${name}/package.json`]);
  expect(turboBin(ROOT, resolve, { arch, platform })).toStrictEqual({
    ok: true,
    path: path.resolve(`/repo/node_modules/${name}/bin/${bin}`),
  });
  expect(calls).toStrictEqual([
    ["turbo/package.json", ROOT],
    [`${name}/package.json`, TURBO_DIR],
  ]);
});

it("refuses a platform package that is not installed with the fix line", () => {
  const { resolve } = resolver([]);
  expect(turboBin(ROOT, resolve, { arch: "arm64", platform: "linux" })).toStrictEqual({
    error: "turbo has no @turbo/linux-arm64 binary; run `bun install` so its optional dependency installs",
    ok: false,
  });
});

function resolveNothing(): string {
  throw new Error("no");
}

it("refuses a root where turbo itself is not installed", () => {
  expect(turboBin(ROOT, resolveNothing, { arch: "x64", platform: "linux" })).toStrictEqual({
    error: "turbo is not installed; run `bun install`",
    ok: false,
  });
});

it("an arch turbo does not ship is refused with the same line", () => {
  const { resolve } = resolver([]);
  expect(turboBin(ROOT, resolve, { arch: "riscv64", platform: "linux" })).toStrictEqual({
    error: "turbo has no @turbo/linux-riscv64 binary; run `bun install` so its optional dependency installs",
    ok: false,
  });
});

it("turboRunner runs the located binary in the directory with the process's env plus its own, capturing both", () => {
  const script = "console.log(process.env.P66_VAR, process.cwd()); console.error('err'); process.exit(3)";

  const run = turboRunner(() => ({ ok: true, path: process.execPath }))(["-e", script], process.cwd(), {
    P66_VAR: "x",
  });

  expect(run).toStrictEqual({ code: 3, stderr: "err\n", stdout: `x ${process.cwd()}\n` });
});

it("runTurbo reports a binary it cannot locate", () => {
  expect(turboRunner(() => ({ error: "gone", ok: false }))([], ROOT, {})).toStrictEqual({ missing: "gone" });
});

it("finds the turbo this repo installs, for this machine", () => {
  const bin = turboBin();
  expect(bin).toMatchObject({ ok: true });
  expect(bin.ok && path.basename(bin.path)).toBe(process.platform === "win32" ? "turbo.exe" : "turbo");
});

it("turboRunner starts this package's own turbo, from a directory that has none", () => {
  const run = turboRunner()(["--version"], os.tmpdir(), {});
  expect(run).toMatchObject({ code: 0 });
  expect("stdout" in run && run.stdout).toContain("2.11.10");
});

it("turboRunner counts a binary killed by a signal as a failure", () => {
  const run = turboRunner(() => ({ ok: true, path: process.execPath }))(
    ["-e", "process.kill(process.pid, 'SIGKILL')"],
    ROOT,
    {},
  );

  expect(run).toMatchObject({ code: 1 });
});
