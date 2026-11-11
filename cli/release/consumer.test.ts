import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { removePlanted, tempDir } from "../fixtures/planted-repo.ts";
import { spawnRunner } from "../scripts/ci-wait-run.ts";
import type { Runner } from "../scripts/ci-wait.ts";
import { PROBE_FILE, PROBE_OUTPUT, PROJECT_DIR_PREFIX } from "./consumer.constants.ts";
import { consume, EXPORTS, fixture, OK, PREFIX, TIMEOUT, withPeers } from "./fixtures/consumer-world.ts";

afterEach(removePlanted);

/** Packs the fixture package into a fresh directory; the path of its tarball. */
function packedFixture(): string {
  const dest = tempDir();
  spawnRunner("bun")(["pm", "pack", "--destination", dest, "--quiet"], fixture());
  return path.join(dest, "acme-fx-1.0.0.tgz");
}

/** A bun that writes one failed resolve of `./notes` as the probe output and runs every other call for real. */
function probeFailsOnNotes(args: string[], cwd: string): ReturnType<Runner> {
  if (args[0] !== PROBE_FILE) return spawnRunner("bun")(args, cwd);
  const failure = [{ key: "./notes", kind: "other", message: "no such file" }];
  fs.writeFileSync(path.join(cwd, PROBE_OUTPUT), JSON.stringify(failure));
  return { code: 0, stderr: "", stdout: "" };
}

/** A bun that fails every call naming a `peer-` package and runs the rest for real. */
function peerAddFails(args: string[], cwd: string): ReturnType<Runner> {
  if (args[1]?.startsWith("peer-") === true) return { code: 1, stderr: "no peer\n", stdout: "" };
  return spawnRunner("bun")(args, cwd);
}

/** A bun whose every call fails as if the package were not there. */
function addFails(): ReturnType<Runner> {
  return { code: 1, stderr: "no such package\n", stdout: "" };
}

describe("repo release consumer", () => {
  it("packs, installs, imports and type-checks every export", { timeout: TIMEOUT }, async () => {
    const got = await consume(fixture());
    expect(got).toMatchObject({ code: 0, out: OK });
    expect(got.err).toContain("fx-1.0.0.tgz");
    expect(fs.readdirSync(got.tmp).filter((name) => name.startsWith(PROJECT_DIR_PREFIX))).toStrictEqual([]);
  });

  it("takes a tarball argument and does not pack", { timeout: TIMEOUT }, async () => {
    const tarball = packedFixture();
    const got = await consume(tempDir(), [tarball]);
    expect(got).toMatchObject({ code: 0, err: "", out: OK });
    expect(got.made).toHaveLength(1);
  });

  it("installs into a project that holds nothing but its manifest, with no repo.ts", { timeout: TIMEOUT }, async () => {
    const seen: string[][] = [];
    function bun(args: string[], cwd: string) {
      seen.push(fs.readdirSync(cwd));
      return spawnRunner("bun")(args, cwd);
    }
    const got = await consume(fixture(), [], { bun });
    expect(got.code).toBe(0);
    expect(seen[1]).toStrictEqual(["package.json"]);
    expect(seen.flat()).not.toContain("repo.ts");
  });
});

describe("repo release consumer cleanup", () => {
  it("removes the directory it packed into after a pass and after a failure", { timeout: TIMEOUT }, async () => {
    const passed = await consume(fixture());
    expect(passed.code).toBe(0);
    const failed = await consume(fixture({ exports: { ...EXPORTS, "./gone": "./gone.js" } }));
    expect(failed.code).toBe(1);
    for (const got of [passed, failed]) expect(got.made.filter((dir) => fs.existsSync(dir))).toStrictEqual([]);
  });

  it("removes the directory it packed into when the pack is refused", { timeout: TIMEOUT }, async () => {
    const got = await consume(tempDir());
    expect(got.code).toBe(1);
    expect(got.made).toHaveLength(1);
    expect(fs.existsSync(got.made[0] ?? "")).toBe(false);
  });

  it("never touches a tarball it was given", { timeout: TIMEOUT }, async () => {
    const tarball = packedFixture();
    const got = await consume(tempDir(), [tarball]);
    expect(got.code).toBe(0);
    expect(fs.existsSync(tarball)).toBe(true);
  });
});

describe("repo release consumer problems", () => {
  it("names a target missing from the tarball", { timeout: TIMEOUT }, async () => {
    const got = await consume(fixture({ exports: { ...EXPORTS, "./gone": "./gone.js" } }));
    expect(got.code).toBe(1);
    expect(got.out).toBe("");
    expect(got.err).toContain(`${PREFIX}./gone resolves to gone.js, which is not in the tarball\n`);
  });

  it("names a * that matches no file and a condition object with no runtime target", { timeout: TIMEOUT }, async () => {
    const exports = { ...EXPORTS, "./agents/*": "./agents/*", "./x": { types: "./x.d.ts" } };
    const got = await consume(fixture({ exports }));
    expect(got.code).toBe(1);
    expect(got.err).toContain(`${PREFIX}./agents/* matches no file in the tarball\n`);
    expect(got.err).toContain(`${PREFIX}./x has a condition object with no default, import or require target\n`);
  });
});

describe("repo release consumer imports", () => {
  it("names a module that throws on import", { timeout: TIMEOUT }, async () => {
    const got = await consume(
      fixture({ exports: { ...EXPORTS, "./boom": "./boom.js" }, files: { "boom.js": 'throw new Error("boom");\n' } }),
    );
    expect(got.code).toBe(1);
    expect(got.err).toContain(`${PREFIX}./boom does not import: boom\n`);
  });

  it("names a module that ends the probe", { timeout: TIMEOUT }, async () => {
    const exports = { ...EXPORTS, "./quit": "./quit.js" };
    const got = await consume(fixture({ exports, files: { "quit.js": "process.exit(3);\n" } }));
    expect(got.code).toBe(1);
    expect(got.err).toContain(`${PREFIX}the import probe exited 3: `);
  });

  it("names a failed resolve of a file that is no code", { timeout: TIMEOUT }, async () => {
    const exports = { ...EXPORTS, "./notes": "./notes.md" };
    const got = await consume(fixture({ exports, files: { "notes.md": "# notes\n" } }), [], { bun: probeFailsOnNotes });
    expect(got.err).toContain(`${PREFIX}./notes does not resolve: no such file\n`);
  });
});

describe("repo release consumer types", () => {
  it("names a type error in a types target", { timeout: TIMEOUT }, async () => {
    const got = await consume(fixture({ files: { "src/x.ts": 'export const x: number = "s";\n' } }));
    expect(got.code).toBe(1);
    expect(got.err).toMatch(new RegExp(`${PREFIX}types: .*src/x\\.ts\\(1,14\\): error TS2322`));
    expect(got.err).not.toContain("does not import");
  });

  it("tests a package whose exports have no types target", { timeout: TIMEOUT }, async () => {
    const got = await consume(fixture({ exports: { "./data": "./data.json" } }));
    expect(got).toMatchObject({
      code: 0,
      out: `${PREFIX}@acme/fx@1.0.0 · 1 export, 1 subpath · imports ok · types ok · publint ok · attw ok\n`,
    });
  });

  it("names a package without exports", { timeout: TIMEOUT }, async () => {
    const got = await consume(fixture({ exports: undefined }));
    expect(got).toMatchObject({ code: 1, out: "" });
    expect(got.err).toContain(`${PREFIX}package.json has no exports\n`);
  });
});

describe("repo release consumer tarball checks", () => {
  it("fails with the publint line and prints no summary", { timeout: TIMEOUT }, async () => {
    const repository = { type: "git", url: "https://github.com/acme/fx.git" };
    const got = await consume(fixture({ manifest: { repository } }));
    expect(got).toMatchObject({ code: 1, out: "" });
    expect(got.err).toMatch(new RegExp(`${PREFIX}publint: pkg\\.repository\\.url`));
  });
});

describe("repo release consumer refusals", () => {
  it("refuses a tarball that does not exist", async () => {
    const missing = path.join(tempDir(), "pkg-1.0.0.tgz");
    expect(await consume(tempDir(), [missing])).toMatchObject({
      code: 1,
      err: `${PREFIX}${missing} does not exist\n`,
      out: "",
    });
  });

  it("refuses more than one argument", async () => {
    const got = await consume(tempDir(), ["a.tgz", "b.tgz"]);
    expect(got).toMatchObject({ code: 1, err: `${PREFIX}takes at most one argument, the tarball to test\n` });
  });
});

describe("repo release consumer peers", () => {
  it("adds the peers of the package, which bun leaves out when they are optional", { timeout: TIMEOUT }, async () => {
    const adds: string[][] = [];
    function bun(args: string[], cwd: string) {
      if (args[0] !== "add" || args[1]?.startsWith("peer-") !== true) return spawnRunner("bun")(args, cwd);
      adds.push(args);
      return { code: 0, stderr: "", stdout: "" };
    }
    const files = { "package.json": withPeers({ "peer-a": "^1.0.0", "peer-b": "2" }) };
    const got = await consume(fixture({ files }), [], { bun });
    expect(got.code).toBe(0);
    expect(adds).toStrictEqual([["add", "peer-a@^1.0.0", "peer-b@2"]]);
  });

  it("prints bun's stderr when adding a peer fails", { timeout: TIMEOUT }, async () => {
    const files = { "package.json": withPeers({ "peer-a": "^1.0.0" }) };
    const got = await consume(fixture({ files }), [], { bun: peerAddFails });
    expect(got).toMatchObject({ code: 1, out: "" });
    expect(got.err).toContain(`${PREFIX}bun add failed: no peer\n`);
  });
});

describe("repo release consumer tool failures", () => {
  it("prints bun's stderr when bun add fails", async () => {
    const tarball = path.join(tempDir(), "pkg-1.0.0.tgz");
    fs.writeFileSync(tarball, "");
    const got = await consume(tempDir(), [tarball], { bun: addFails });
    expect(got).toMatchObject({ code: 1, err: `${PREFIX}bun add failed: no such package\n`, out: "" });
    expect(fs.readdirSync(got.tmp)).toStrictEqual([]);
  });

  it("prints the refusal of a pack that names workspace:^", async () => {
    const manifest = { dependencies: { "@workerstack/x": "workspace:^" }, name: "@acme/app", version: "1.0.0" };
    const got = await consume(tempDir(), [], {
      bun: () => ({ code: 0, stderr: "", stdout: "" }),
      list: () => ["acme-app-1.0.0.tgz"],
      mkdtemp: (prefix) => `${prefix}x1`,
      tar: () => ({ code: 0, stderr: "", stdout: JSON.stringify(manifest) }),
    });
    expect(got).toMatchObject({
      code: 1,
      err: `${PREFIX}the packed package.json names workspace:^ for @workerstack/x; pin it before releasing\n`,
      out: "",
    });
  });
});
