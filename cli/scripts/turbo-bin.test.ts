import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { turboBin, turboRunner } from "./turbo-bin.ts";

const ROOT = path.resolve("/repo");
const TURBO_DIR = path.resolve("/repo/node_modules/turbo");

/** A resolver that finds turbo from the root, and the platform packages in `installed` from turbo's dir. */
function resolver(installed: string[]) {
  const calls: [string, string][] = [];
  const resolve = (specifier: string, from: string): string => {
    calls.push([specifier, from]);
    if (specifier === "turbo/package.json" && from === ROOT) return path.join(TURBO_DIR, "package.json");
    if (installed.includes(specifier))
      return path.resolve(`/repo/node_modules/${path.dirname(specifier)}/package.json`);
    throw new Error(`cannot find ${specifier}`);
  };
  return { resolve, calls };
}

it.each([
  { platform: "linux", arch: "x64", name: "@turbo/linux-64", bin: "turbo" },
  { platform: "linux", arch: "arm64", name: "@turbo/linux-arm64", bin: "turbo" },
  { platform: "darwin", arch: "x64", name: "@turbo/darwin-64", bin: "turbo" },
  { platform: "darwin", arch: "arm64", name: "@turbo/darwin-arm64", bin: "turbo" },
  { platform: "win32", arch: "x64", name: "@turbo/windows-64", bin: "turbo.exe" },
  { platform: "win32", arch: "arm64", name: "@turbo/windows-arm64", bin: "turbo.exe" },
])("$platform $arch resolves $name/package.json from turbo's dir to bin/$bin", ({ platform, arch, name, bin }) => {
  const { resolve, calls } = resolver([`${name}/package.json`]);
  expect(turboBin(ROOT, resolve, { platform, arch })).toStrictEqual({
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
  expect(turboBin(ROOT, resolve, { platform: "linux", arch: "arm64" })).toStrictEqual({
    ok: false,
    error: "turbo has no @turbo/linux-arm64 binary; run `bun install` so its optional dependency installs",
  });
});

it("refuses a root where turbo itself is not installed", () => {
  const resolve = (): string => {
    throw new Error("no");
  };
  expect(turboBin(ROOT, resolve, { platform: "linux", arch: "x64" })).toStrictEqual({
    ok: false,
    error: "turbo is not installed; run `bun install`",
  });
});

it("an arch turbo does not ship is refused with the same line", () => {
  const { resolve } = resolver([]);
  expect(turboBin(ROOT, resolve, { platform: "linux", arch: "riscv64" })).toStrictEqual({
    ok: false,
    error: "turbo has no @turbo/linux-riscv64 binary; run `bun install` so its optional dependency installs",
  });
});

it("turboRunner runs the located binary in the directory with the env on top of the process's, capturing both streams", () => {
  const script = "console.log(process.env.P66_VAR, process.cwd()); console.error('err'); process.exit(3)";
  const run = turboRunner(() => ({ ok: true, path: process.execPath }))(["-e", script], process.cwd(), {
    P66_VAR: "x",
  });
  expect(run).toStrictEqual({ code: 3, stdout: `x ${process.cwd()}\n`, stderr: "err\n" });
});

it("runTurbo reports a binary it cannot locate", () => {
  expect(turboRunner(() => ({ ok: false, error: "gone" }))([], ROOT, {})).toStrictEqual({ missing: "gone" });
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
