import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { removePlanted, tempDir } from "../fixtures/planted-repo.ts";
import { spawnRunner } from "../scripts/ci-wait-run.ts";
import type { Runner } from "../scripts/ci-wait.ts";
import { PROBE_FILE, PROBE_OUTPUT, PROJECT_DIR_PREFIX } from "./consumer.constants.ts";
import { consume, EXPORTS, fixture, OK, PREFIX, TIMEOUT, withPeers } from "./fixtures/consumer-world.ts";

afterEach(removePlanted);

describe("repo release consumer", () => {
  it("packs, installs, imports and type-checks every export", { timeout: TIMEOUT }, () => {
    const got = consume(fixture());
    expect(got).toMatchObject({ code: 0, out: OK });
    expect(got.err).toContain("fx-1.0.0.tgz");
    expect(fs.readdirSync(got.tmp).filter((name) => name.startsWith(PROJECT_DIR_PREFIX))).toEqual([]);
  });

  it("takes a tarball argument and does not pack", { timeout: TIMEOUT }, () => {
    const dest = tempDir();
    spawnRunner("bun")(["pm", "pack", "--destination", dest, "--quiet"], fixture());
    const tarball = path.join(dest, "acme-fx-1.0.0.tgz");
    const got = consume(tempDir(), [tarball]);
    expect(got).toMatchObject({ code: 0, out: OK, err: "" });
    expect(got.made).toHaveLength(1);
  });

  it("installs into a project that holds nothing but its manifest, with no repo.ts", { timeout: TIMEOUT }, () => {
    const seen: string[][] = [];
    const bun: Runner = (args, cwd) => {
      seen.push(fs.readdirSync(cwd));
      return spawnRunner("bun")(args, cwd);
    };
    const got = consume(fixture(), [], { bun });
    expect(got.code).toBe(0);
    expect(seen[1]).toEqual(["package.json"]);
    expect(seen.flat()).not.toContain("repo.ts");
  });
});

describe("repo release consumer cleanup", () => {
  it("removes the directory it packed into after a pass and after a failure", { timeout: TIMEOUT }, () => {
    const passed = consume(fixture());
    expect(passed.code).toBe(0);
    const failed = consume(fixture({ exports: { ...EXPORTS, "./gone": "./gone.js" } }));
    expect(failed.code).toBe(1);
    for (const got of [passed, failed]) expect(got.made.filter((dir) => fs.existsSync(dir))).toEqual([]);
  });

  it("removes the directory it packed into when the pack is refused", { timeout: TIMEOUT }, () => {
    const got = consume(tempDir());
    expect(got.code).toBe(1);
    expect(got.made).toHaveLength(1);
    expect(fs.existsSync(got.made[0] ?? "")).toBe(false);
  });

  it("never touches a tarball it was given", { timeout: TIMEOUT }, () => {
    const dest = tempDir();
    spawnRunner("bun")(["pm", "pack", "--destination", dest, "--quiet"], fixture());
    const tarball = path.join(dest, "acme-fx-1.0.0.tgz");
    expect(consume(tempDir(), [tarball]).code).toBe(0);
    expect(fs.existsSync(tarball)).toBe(true);
  });
});

describe("repo release consumer problems", () => {
  it("names a target missing from the tarball", { timeout: TIMEOUT }, () => {
    const got = consume(fixture({ exports: { ...EXPORTS, "./gone": "./gone.js" } }));
    expect(got.code).toBe(1);
    expect(got.out).toBe("");
    expect(got.err).toContain(`${PREFIX}./gone resolves to gone.js, which is not in the tarball\n`);
  });

  it("names a * that matches no file and a condition object with no runtime target", { timeout: TIMEOUT }, () => {
    const exports = { ...EXPORTS, "./agents/*": "./agents/*", "./x": { types: "./x.d.ts" } };
    const got = consume(fixture({ exports }));
    expect(got.code).toBe(1);
    expect(got.err).toContain(`${PREFIX}./agents/* matches no file in the tarball\n`);
    expect(got.err).toContain(`${PREFIX}./x has a condition object with no default, import or require target\n`);
  });
});

describe("repo release consumer imports", () => {
  it("names a module that throws on import", { timeout: TIMEOUT }, () => {
    const got = consume(
      fixture({ exports: { ...EXPORTS, "./boom": "./boom.js" }, files: { "boom.js": 'throw new Error("boom");\n' } }),
    );
    expect(got.code).toBe(1);
    expect(got.err).toContain(`${PREFIX}./boom does not import: boom\n`);
  });

  it("names a module that ends the probe", { timeout: TIMEOUT }, () => {
    const exports = { ...EXPORTS, "./quit": "./quit.js" };
    const got = consume(fixture({ exports, files: { "quit.js": "process.exit(3);\n" } }));
    expect(got.code).toBe(1);
    expect(got.err).toContain(`${PREFIX}the import probe exited 3: `);
  });

  it("names a failed resolve of a file that is no code", { timeout: TIMEOUT }, () => {
    const exports = { ...EXPORTS, "./notes": "./notes.md" };
    const bun: Runner = (args, cwd) => {
      if (args[0] !== PROBE_FILE) return spawnRunner("bun")(args, cwd);
      const failure = [{ key: "./notes", kind: "other", message: "no such file" }];
      fs.writeFileSync(path.join(cwd, PROBE_OUTPUT), JSON.stringify(failure));
      return { code: 0, stdout: "", stderr: "" };
    };
    const got = consume(fixture({ exports, files: { "notes.md": "# notes\n" } }), [], { bun });
    expect(got.err).toContain(`${PREFIX}./notes does not resolve: no such file\n`);
  });
});

describe("repo release consumer types", () => {
  it("names a type error in a types target", { timeout: TIMEOUT }, () => {
    const got = consume(fixture({ files: { "src/x.ts": 'export const x: number = "s";\n' } }));
    expect(got.code).toBe(1);
    expect(got.err).toMatch(new RegExp(`${PREFIX}types: .*src/x\\.ts\\(1,14\\): error TS2322`));
    expect(got.err).not.toContain("does not import");
  });

  it("tests a package whose exports have no types target", { timeout: TIMEOUT }, () => {
    const got = consume(fixture({ exports: { "./data": "./data.json" } }));
    expect(got).toMatchObject({
      code: 0,
      out: `${PREFIX}@acme/fx@1.0.0 · 1 export, 1 subpath · imports ok · types ok\n`,
    });
  });

  it("names a package without exports", { timeout: TIMEOUT }, () => {
    const got = consume(fixture({ exports: undefined }));
    expect(got).toMatchObject({ code: 1, out: "" });
    expect(got.err).toContain(`${PREFIX}package.json has no exports\n`);
  });
});

describe("repo release consumer refusals", () => {
  it("refuses a tarball that does not exist", () => {
    const missing = path.join(tempDir(), "pkg-1.0.0.tgz");
    expect(consume(tempDir(), [missing])).toMatchObject({
      code: 1,
      out: "",
      err: `${PREFIX}${missing} does not exist\n`,
    });
  });

  it("refuses more than one argument", () => {
    const got = consume(tempDir(), ["a.tgz", "b.tgz"]);
    expect(got).toMatchObject({ code: 1, err: `${PREFIX}takes at most one argument, the tarball to test\n` });
  });
});

describe("repo release consumer peers", () => {
  it("adds the peers of the package, which bun leaves out when they are optional", { timeout: TIMEOUT }, () => {
    const adds: string[][] = [];
    const bun: Runner = (args, cwd) => {
      if (args[0] !== "add" || !args[1]?.startsWith("peer-")) return spawnRunner("bun")(args, cwd);
      adds.push(args);
      return { code: 0, stdout: "", stderr: "" };
    };
    const files = { "package.json": withPeers({ "peer-a": "^1.0.0", "peer-b": "2" }) };
    const got = consume(fixture({ files }), [], { bun });
    expect(got.code).toBe(0);
    expect(adds).toEqual([["add", "peer-a@^1.0.0", "peer-b@2"]]);
  });

  it("prints bun's stderr when adding a peer fails", { timeout: TIMEOUT }, () => {
    const bun: Runner = (args, cwd) =>
      args[1]?.startsWith("peer-") ? { code: 1, stdout: "", stderr: "no peer\n" } : spawnRunner("bun")(args, cwd);
    const files = { "package.json": withPeers({ "peer-a": "^1.0.0" }) };
    const got = consume(fixture({ files }), [], { bun });
    expect(got).toMatchObject({ code: 1, out: "" });
    expect(got.err).toContain(`${PREFIX}bun add failed: no peer\n`);
  });
});

describe("repo release consumer tool failures", () => {
  it("prints bun's stderr when bun add fails", () => {
    const tarball = path.join(tempDir(), "pkg-1.0.0.tgz");
    fs.writeFileSync(tarball, "");
    const bun: Runner = () => ({ code: 1, stdout: "", stderr: "no such package\n" });
    const got = consume(tempDir(), [tarball], { bun });
    expect(got).toMatchObject({ code: 1, out: "", err: `${PREFIX}bun add failed: no such package\n` });
    expect(fs.readdirSync(got.tmp)).toEqual([]);
  });

  it("prints the refusal of a pack that names workspace:^", () => {
    const manifest = { name: "@acme/app", version: "1.0.0", dependencies: { "@workerstack/x": "workspace:^" } };
    const got = consume(tempDir(), [], {
      bun: () => ({ code: 0, stdout: "", stderr: "" }),
      tar: () => ({ code: 0, stdout: JSON.stringify(manifest), stderr: "" }),
      mkdtemp: (prefix) => `${prefix}x1`,
      list: () => ["acme-app-1.0.0.tgz"],
    });
    expect(got).toMatchObject({
      code: 1,
      out: "",
      err: `${PREFIX}the packed package.json names workspace:^ for @workerstack/x; pin it before releasing\n`,
    });
  });
});
