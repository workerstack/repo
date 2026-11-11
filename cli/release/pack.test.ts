import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { removePlanted, tempDir, write } from "../fixtures/planted-repo.ts";
import { spawnRunner } from "../scripts/ci-wait-run.ts";
import type { Runner } from "../scripts/ci-wait.ts";
import { releasePack } from "./pack.ts";

afterEach(removePlanted);

function ok(stdout: string) {
  return { code: 0, stderr: "", stdout };
}

/** Runs `release pack` in `cwd`; `bun` and `tar` default to the real tools. */
type Tools = { bun?: Runner; tar?: Runner; mkdtemp?: (prefix: string) => string; list?: (dir: string) => string[] };

function pack(cwd: string, tools: Tools = {}, argv: string[] = []) {
  const out: string[] = [];
  const err: string[] = [];
  const tmp = tempDir();
  const code = releasePack(argv, {
    bun: tools.bun ?? spawnRunner("bun"),
    cwd,
    list: tools.list ?? ((dir) => readdirSync(dir)),
    mkdtemp: tools.mkdtemp ?? mkdtempSync,
    stderr: (s) => err.push(s),
    stdout: (s) => out.push(s),
    tar: tools.tar ?? spawnRunner("tar"),
    tmp,
  });
  return { code, err: err.join(""), out: out.join(""), tmp };
}

/** Fakes bun's packer to name a tarball and tar to show `manifest` as its package.json. */
function fakes(manifest: unknown, stdout = ""): Tools {
  return {
    bun: () => ok(stdout),
    list: () => ["acme-app-0.1.0.tgz"],
    mkdtemp: (prefix) => `${prefix}x1`,
    tar: () => ok(JSON.stringify(manifest)),
  };
}

describe("repo release pack", () => {
  it("packs the package and prints the tarball path", () => {
    const dir = tempDir();
    write(dir, { "index.js": "x\n", "package.json": { name: "@acme/app", version: "0.1.0" } });
    const got = pack(dir);
    expect(got.code).toBe(0);
    const file = got.out.trim();
    expect(got.err).toBe(`${file}\n`);
    expect(path.basename(file)).toBe("acme-app-0.1.0.tgz");
    expect(path.dirname(path.dirname(file))).toBe(got.tmp);
    expect(existsSync(file)).toBe(true);
  });

  it("takes the path from the pack directory and shows the prepack output on stderr", () => {
    const prepack = "$ bun run \x62uild\nrepo sync: up to date\n";
    const got = pack("/repo", fakes({ name: "@acme/app", version: "0.1.0" }, prepack));
    const file = path.join(got.tmp, "repo-pack-x1", "acme-app-0.1.0.tgz");
    expect(got).toMatchObject({ code: 0, err: prepack, out: `${file}\n` });
  });
});

describe("repo release pack refuses", () => {
  it.each([
    ["dependencies", "workspace:^", "@workerstack/x"],
    ["peerDependencies", "catalog:", "react"],
    ["optionalDependencies", "workspace:*", "y"],
    ["devDependencies", "catalog:default", "z"],
  ])("refuses a packed %s entry naming %s", (field, spec, dep) => {
    const got = pack("/repo", fakes({ [field]: { [dep]: spec }, name: "@acme/app", version: "0.1.0" }));
    expect(got).toMatchObject({
      code: 1,
      err: `repo release pack: the packed package.json names ${spec} for ${dep}; pin it before releasing\n`,
      out: "",
    });
  });
});

describe("repo release pack refuses what it cannot pack", () => {
  it("when bun cannot pack", () => {
    const got = pack("/repo", { bun: () => ({ code: 1, stderr: "no package.json\n", stdout: "" }) });
    expect(got).toMatchObject({ code: 1, err: "repo release pack: bun pm pack failed: no package.json\n", out: "" });
  });

  it.each([[[]], [["a.tgz", "b.tgz"]]])("a pack directory holding %j instead of one tarball", (names) => {
    const got = pack("/repo", { ...fakes({}), list: () => [...names, "notes.txt"] });
    expect(got.err).toMatch(
      new RegExp(
        `^repo release pack: bun pm pack left ${names.length} tarballs in .*repo-pack-x1; expected exactly one\\n$`,
      ),
    );
  });

  it("a tarball whose package.json cannot be read", () => {
    const got = pack("/repo", { ...fakes({}), tar: () => ok("not json") });
    expect(got).toMatchObject({
      code: 1,
      err: "repo release pack: the packed tarball has no readable package.json with a name and a version\n",
      out: "",
    });
  });

  it("arguments with the usage line", () => {
    const got = pack("/repo", {}, ["x"]);
    expect(got.err).toBe("repo release pack: takes no arguments; it packs the package in this checkout\n");
  });
});
