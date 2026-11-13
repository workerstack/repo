import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { tempDir, useTempDirs } from "../sync/__fixtures__/temp-dirs.ts";
import { captureStreams } from "./__fixtures__/sync-global-kit.ts";
import { throwOnWrite } from "./__fixtures__/throw-on-write.ts";
import { main, runShim } from "./shim.ts";

useTempDirs();

afterEach(() => vi.restoreAllMocks());

it("main installs the real launcher into --dir and prints its rows", () => {
  const streams = captureStreams();
  const dir = tempDir("shim-main-");

  expect(main(["--dir", dir])).toBe(0);
  expect(streams.out()).toContain(`shim ${path.join(dir, "repo")}`);
  expect(fs.readFileSync(path.join(dir, "repo"), "utf8")).toContain("findLocalRepo");
});

it("main prints a flag error on stderr and exits 1", () => {
  const streams = captureStreams();

  expect(main(["--nope"])).toBe(1);
  expect(streams.err()).toBe("unknown flag: --nope\n");
});

it("main reports a write failure as one line and exits 1", () => {
  const streams = captureStreams();
  const file = path.join(tempDir("shim-main-bad-"), "a-file");
  fs.writeFileSync(file, "x");

  expect(main(["--dir", path.join(file, "bin")])).toBe(1);
  expect(streams.err().trim().split("\n")).toHaveLength(1);
});

it("a missing PATH counts as off PATH", () => {
  const dir = tempDir("shim-nopath-");
  const r = runShim({ argv: ["--dir", dir], home: dir, pathEnv: undefined, platform: "linux", source: "x\n" });

  expect(r.out.join("\n")).toContain("is not on PATH");
});

it("main reports a thrown non-Error as its text and exits 1", () => {
  const dir = tempDir("shim-main-str-");
  throwOnWrite("closed");
  const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

  expect(main(["--dir", dir])).toBe(1);
  expect(err).toHaveBeenCalledWith("closed\n");
});

it("with no --dir it targets the default dir under the home", () => {
  const home = tempDir("shim-home-default-");
  const r = runShim({ argv: ["--dry-run"], home, pathEnv: undefined, platform: "linux", source: "x\n" });

  expect(r.out[0]).toBe(`dry-run shim ${path.join(home, ".local", "bin", "repo")}`);
});

it("--dry-run over an installed launcher reports it ok and touches nothing", () => {
  const dir = tempDir("shim-dry-ok-");
  const opts = { home: dir, pathEnv: dir, platform: "linux", source: "x\n" };
  runShim({ ...opts, argv: ["--dir", dir] });
  const before = fs.statSync(path.join(dir, "repo")).mtimeMs;

  expect(runShim({ ...opts, argv: ["--dir", dir, "--dry-run"] }).out).toStrictEqual([
    `ok shim ${path.join(dir, "repo")}`,
  ]);
  expect(fs.statSync(path.join(dir, "repo")).mtimeMs).toBe(before);
});
