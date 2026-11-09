import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { removePlanted, tempDir, write } from "../fixtures/planted-repo.ts";
import { spawnRunner } from "../scripts/ci-wait-run.ts";
import type { Runner } from "../scripts/ci-wait.ts";
import { releasePack } from "./pack.ts";

afterEach(removePlanted);

const ok = (stdout: string) => ({ code: 0, stdout, stderr: "" });

/** Runs `release pack` in `cwd`; `bun` and `tar` default to the real tools. */
type Tools = { bun?: Runner; tar?: Runner; mkdtemp?: (prefix: string) => string; list?: (dir: string) => string[] };

async function pack(cwd: string, tools: Tools = {}, argv: string[] = []) {
  const out: string[] = [];
  const err: string[] = [];
  const tmp = tempDir();
  const code = await releasePack(argv, {
    cwd,
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    bun: tools.bun ?? spawnRunner("bun"),
    tar: tools.tar ?? spawnRunner("tar"),
    tmp,
    mkdtemp: tools.mkdtemp ?? fs.mkdtempSync,
    list: tools.list ?? ((dir) => fs.readdirSync(dir)),
  });
  return { code, out: out.join(""), err: err.join(""), tmp };
}

/** Fakes bun's packer to name a tarball and tar to show `manifest` as its package.json. */
const fakes = (manifest: unknown, stdout = ""): Tools => ({
  bun: () => ok(stdout),
  tar: () => ok(JSON.stringify(manifest)),
  mkdtemp: (prefix) => `${prefix}x1`,
  list: () => ["acme-app-0.1.0.tgz"],
});

describe("repo release pack", () => {
  it("packs the package and prints the tarball path", async () => {
    const dir = tempDir();
    write(dir, { "package.json": { name: "@acme/app", version: "0.1.0" }, "index.js": "x\n" });
    const got = await pack(dir);
    expect(got.code).toBe(0);
    const file = got.out.trim();
    expect(got.err).toBe(`${file}\n`);
    expect(path.basename(file)).toBe("acme-app-0.1.0.tgz");
    expect(path.dirname(path.dirname(file))).toBe(got.tmp);
    expect(fs.existsSync(file)).toBe(true);
  });

  it("takes the path from the pack directory and shows the prepack output on stderr", async () => {
    const prepack = "$ bun run \x62uild\nrepo sync: up to date\n";
    const got = await pack("/repo", fakes({ name: "@acme/app", version: "0.1.0" }, prepack));
    const file = path.join(got.tmp, "repo-pack-x1", "acme-app-0.1.0.tgz");
    expect(got).toMatchObject({ code: 0, out: `${file}\n`, err: prepack });
  });
});

describe("repo release pack refuses", () => {
  it.each([
    ["dependencies", "workspace:^", "@workerstack/x"],
    ["peerDependencies", "catalog:", "react"],
    ["optionalDependencies", "workspace:*", "y"],
    ["devDependencies", "catalog:default", "z"],
  ])("refuses a packed %s entry naming %s", async (field, spec, dep) => {
    const got = await pack("/repo", fakes({ name: "@acme/app", version: "0.1.0", [field]: { [dep]: spec } }));
    expect(got).toMatchObject({
      code: 1,
      out: "",
      err: `repo release pack: the packed package.json names ${spec} for ${dep}; pin it before releasing\n`,
    });
  });
});

describe("repo release pack refuses what it cannot pack", () => {
  it("when bun cannot pack", async () => {
    const got = await pack("/repo", { bun: () => ({ code: 1, stdout: "", stderr: "no package.json\n" }) });
    expect(got).toMatchObject({ code: 1, out: "", err: "repo release pack: bun pm pack failed: no package.json\n" });
  });

  it.each([[[]], [["a.tgz", "b.tgz"]]])("a pack directory holding %j instead of one tarball", async (names) => {
    const got = await pack("/repo", { ...fakes({}), list: () => [...names, "notes.txt"] });
    expect(got.err).toMatch(
      new RegExp(
        `^repo release pack: bun pm pack left ${names.length} tarballs in .*repo-pack-x1; expected exactly one\\n$`,
      ),
    );
  });

  it("a tarball whose package.json cannot be read", async () => {
    const got = await pack("/repo", { ...fakes({}), tar: () => ok("not json") });
    expect(got).toMatchObject({
      code: 1,
      out: "",
      err: "repo release pack: the packed tarball has no readable package.json with a name and a version\n",
    });
  });

  it("arguments with the usage line", async () => {
    expect((await pack("/repo", {}, ["x"])).err).toBe(
      "repo release pack: takes no arguments; it packs the package in this checkout\n",
    );
  });
});
