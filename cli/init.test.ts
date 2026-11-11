import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it, vi } from "vitest";

import { aliasOf } from "../dev/test-paths.ts";
import { fakeExec, hostsList, readPkg, stubPkgRoot, tmp, useInitKit } from "./fixtures/init-kit.ts";
import { init, parsePacksFlag, samePath } from "./init.ts";
import { PACKAGE_NAME } from "./sync/stock.ts";

useInitKit();

it("try: realpath equal vs unequal", () => {
  const a = tmp("same-a-");
  const b = tmp("same-b-");
  expect(samePath(a, a)).toBe(true);
  expect(samePath(a, b)).toBe(false);
  expect(samePath(aliasOf(a), a)).toBe(true);
  fs.rmSync(`${a}-alias`, { force: true });
});

it("catch: missing paths fall back to resolve", () => {
  const missing = path.join(os.tmpdir(), `repo-missing-${process.pid}-nope`);
  expect(samePath(missing, missing)).toBe(true);
  expect(samePath(missing, `${missing}-other`)).toBe(false);
});

it("lists the packs once each in pack order; none and empty are no packs", () => {
  expect(parsePacksFlag("speak,listen")).toEqual(["listen", "speak"]);
  expect(parsePacksFlag(" clasp , google-workspace,clasp ")).toEqual(["google-workspace", "clasp"]);
  expect(parsePacksFlag("none")).toEqual([]);
  expect(parsePacksFlag("")).toEqual([]);
});

it("refuses a name that is not a pack", () => {
  expect(() => parsePacksFlag("listen,nope")).toThrow("unknown pack nope");
});

it(`a fresh init writes only workerstack.config.ts, package.json and an empty .mcp.json, installs, then syncs \
globals`, () => {
  const dest = tmp("repo-dest-");
  const exec = fakeExec();
  const out: string[] = [];
  init(dest, {
    execFileSync: exec,
    pkgRoot: stubPkgRoot({ name: PACKAGE_NAME, version: "0.7.0" }),
    stdout: (s) => out.push(s),
  });

  expect(fs.readdirSync(dest).toSorted()).toEqual([".mcp.json", "package.json", "workerstack.config.ts"]);
  expect(fs.readFileSync(path.join(dest, ".mcp.json"), "utf8")).toBe('{\n  "mcpServers": {}\n}\n');
  expect(out).toEqual(["repo init: wrote .mcp.json\n"]);
  expect(readPkg(dest)).toEqual({
    devDependencies: { [PACKAGE_NAME]: "0.7.0" },
    packageManager: `bun@${Bun.version}`,
    private: true,
    scripts: { postinstall: "repo sync --postinstall" },
    sideEffects: false,
  });
  expect(exec.mock.calls.map((c) => [c[0], c[1]])).toEqual([
    ["git", ["rev-parse", "--is-inside-work-tree"]],
    ["bun", ["install"]],
    ["bun", ["repo", "yolo"]],
  ]);
  for (const call of exec.mock.calls.filter((c) => c[0] === "bun"))
    expect(call[2]).toEqual({ cwd: dest, stdio: "inherit" });
});

it("outside a git work tree runs git init in the dest before the install and says so", () => {
  const dest = tmp("repo-dest-");
  const out: string[] = [];
  const exec = fakeExec((cmd, args) => {
    if (cmd === "git" && args[0] === "rev-parse") throw new Error("not a git repository");
  });
  init(dest, { execFileSync: exec, pkgRoot: stubPkgRoot(), skipGlobals: true, stdout: (s) => out.push(s) });
  expect(exec.mock.calls.map(([cmd, args]) => [cmd, args])).toEqual([
    ["git", ["rev-parse", "--is-inside-work-tree"]],
    ["git", ["init", "-q"]],
    ["bun", ["install"]],
  ]);
  expect(exec.mock.calls.map(([, , opts]) => opts.cwd)).toEqual([dest, dest, dest]);
  expect(out).toContain("repo init: ran git init\n");
});

it("inside a git work tree does not run git init or print it", () => {
  const dest = tmp("repo-dest-");
  const out: string[] = [];
  const exec = fakeExec();
  init(dest, { execFileSync: exec, pkgRoot: stubPkgRoot(), skipGlobals: true, stdout: (s) => out.push(s) });
  expect(exec.mock.calls.map(([cmd, args]) => [cmd, args])).toEqual([
    ["git", ["rev-parse", "--is-inside-work-tree"]],
    ["bun", ["install"]],
  ]);
  expect(out.join("")).not.toContain("ran git init");
});

it("prints that it ran git init on the process's stdout when given no stdout", () => {
  const dest = tmp("repo-git-stdout-");
  const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  const exec = fakeExec((cmd, args) => {
    if (cmd === "git" && args[0] === "rev-parse") throw new Error("not a git repository");
  });
  init(dest, { execFileSync: exec, pkgRoot: stubPkgRoot(), skipGlobals: true });
  expect(write.mock.calls.map(([chunk]) => String(chunk))).toContain("repo init: ran git init\n");
  write.mockRestore();
});

it("keeps a .mcp.json the repo already has and says nothing of it", () => {
  const dest = tmp("repo-mcp-kept-");
  fs.writeFileSync(path.join(dest, ".mcp.json"), "mine\n");
  const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  init(dest, { execFileSync: fakeExec(), pkgRoot: stubPkgRoot() });
  expect(fs.readFileSync(path.join(dest, ".mcp.json"), "utf8")).toBe("mine\n");
  expect(write).not.toHaveBeenCalled();
  write.mockRestore();
});

it("--packs listen writes agents.skills into a new config", () => {
  const dest = tmp("repo-packs-");
  init(dest, { execFileSync: fakeExec(), packs: ["listen"], pkgRoot: stubPkgRoot() });
  expect(fs.readFileSync(path.join(dest, "workerstack.config.ts"), "utf8")).toContain(
    `agents: { hosts: [${hostsList()}], skills: ["listen"] }`,
  );
});
