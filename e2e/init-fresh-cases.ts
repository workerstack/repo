/** The fresh-repo cases on what init installs and writes, and on what stays untracked. */
import fs from "node:fs";
import path from "node:path";

import { expect, inject, it } from "vitest";

import type { GetSandbox } from "./get-sandbox.types";
import { gitStdout } from "./git-stdout";
import { expectClean, GENERATED, ignoredFiles, installedVersion, isPackageJson } from "./init-helpers";

/** Init installs this build and writes only the config and a postinstall; install generates the trees. */
export function installCases(get: GetSandbox) {
  it("installs this exact build as a devDependency", async () => {
    const sb = get();
    const version = inject("version");
    expect(await installedVersion(sb)).toBe(version);
    expect(JSON.stringify(sb.json("package.json", isPackageJson).devDependencies)).toContain(version);
  });

  it("init copies nothing: it writes the config and a postinstall, and install generates the trees", () => {
    const sb = get();
    expect(sb.exists("workerstack.config.ts")).toBe(true);
    expect(sb.json("package.json", isPackageJson).scripts.postinstall).toBe("repo sync --postinstall");
    for (const rel of [".rulesync", "scripts"]) expect(sb.exists(rel), rel).toBe(false);
    for (const rel of GENERATED) expect(sb.exists(rel), rel).toBe(true);
    for (const rel of ["CLAUDE.md", "GEMINI.md", ".gemini"]) expect(sb.exists(rel), rel).toBe(false);
    expect(fs.existsSync(path.join(sb.home, ".grok", "config.toml"))).toBe(true);
    const scripts = sb.json("package.json", isPackageJson).scripts;
    expect(Object.keys(scripts).filter((k) => k.startsWith("repo:"))).toStrictEqual([]);
  });
}

/** The package.json init writes passes repo check. */
export function manifestCase(get: GetSandbox) {
  it("writes private, sideEffects and a pinned bun, so repo check passes", async () => {
    const sb = get();
    const pkg = sb.json("package.json", (v): v is Record<string, unknown> => typeof v === "object" && v !== null);
    expect(pkg).toMatchObject({ private: true, sideEffects: false });
    expect(pkg.packageManager).toMatch(/^bun@\d+\.\d+\.\d+/);
    expectClean(sb, await sb.run("bun", ["repo", "check"]));
  });
}

/** Once committed, the generated paths are ignored and untracked, and sync finds nothing to change. */
export function untrackedCase(get: GetSandbox) {
  it("tracks none of the generated paths, and sync --check exits 0", async () => {
    const sb = get();
    await sb.commit("after init");
    const ls = await sb.git("ls-files");
    const tracked = ls.stdout.split("\n").filter(Boolean);
    expect(tracked.filter((f) => GENERATED.some((g) => f === g || f.startsWith(`${g}/`)))).toStrictEqual([]);
    // AGENTS.md holds the user's text below its region and .mcp.json is the user's: both are tracked.
    expect(tracked).toStrictEqual(expect.arrayContaining(["AGENTS.md", ".mcp.json"]));
    expect(await gitStdout(sb, "status", "--porcelain")).toBe("");
    const ignored = await ignoredFiles(sb);
    for (const rel of GENERATED) {
      expect(
        ignored.some((f) => f === rel || f.startsWith(`${rel}/`)),
        rel,
      ).toBe(true);
    }
    const check = await sb.run("bun", ["repo", "sync", "--check"]);
    expectClean(sb, check);
    expect(check.stdout).toContain("up to date");
  });
}
