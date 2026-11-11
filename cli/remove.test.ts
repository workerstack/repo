import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { cleanup, world } from "./fixtures/update-world.ts";
import { main } from "./remove.ts";

afterEach(cleanup);

const API = path.join("packages", "api", "package.json");

function everywhere(name: string) {
  return {
    "package.json": {
      catalogs: { next: { [name]: "2.0.0", keep: "2.0.0" } },
      devDependencies: { [name]: "1.0.0", [`${name}-extra`]: "1.0.0" },
      name: "root",
      overrides: { [name]: "1.0.0", keep: "1.0.0" },
      patchedDependencies: { [`${name}@1.0.0`]: "patches/a.patch", keep: "patches/keep.patch" },
      private: true,
      resolutions: { [name]: "1.0.0" },
      trustedDependencies: [name, "keep"],
      workspaces: { catalog: { [name]: "^1.0.0", keep: "1.0.0" }, packages: ["packages/*"] },
    },
    "packages/api/package.json": {
      dependencies: { [name]: "catalog:", keep: "1.0.0" },
      devDependencies: { [name]: "1.0.0" },
      name: "api",
      optionalDependencies: { [name]: "1.0.0" },
      peerDependencies: { [name]: "^1.0.0" },
    },
  };
}

function patches(root: string): void {
  fs.mkdirSync(path.join(root, "patches"), { recursive: true });
  for (const file of ["a.patch", "keep.patch"]) fs.writeFileSync(path.join(root, "patches", file), "diff\n");
}

it("removes a name from every field, catalog, override and patch, and says where", async () => {
  const w = world(everywhere("left-pad"), {});
  patches(w.root);
  expect(await main(["left-pad"], w.io())).toBe(0);
  expect(w.out).toStrictEqual([
    "removed left-pad from package.json (devDependencies, overrides, resolutions, trustedDependencies, patchedDependencies) and packages/api (dependencies, devDependencies, peerDependencies, optionalDependencies) and the catalog and the next catalog",
  ]);
  const root = w.read("package.json");
  expect(root.devDependencies).toStrictEqual({ "left-pad-extra": "1.0.0" });
  expect(root.workspaces).toStrictEqual({ catalog: { keep: "1.0.0" }, packages: ["packages/*"] });
  expect(root.catalogs).toStrictEqual({ next: { keep: "2.0.0" } });
  expect(root.overrides).toStrictEqual({ keep: "1.0.0" });
  expect(w.read("packages/api/package.json").dependencies).toStrictEqual({ keep: "1.0.0" });
  expect(w.read("packages/api/package.json").devDependencies).toStrictEqual({});
  const raw = JSON.parse(
    fs.readFileSync(path.join(w.root, "package.json"), "utf8"),
  ) /* the root as written */ as Record<string, unknown>;
  expect(raw.resolutions).toStrictEqual({});
  expect(raw.trustedDependencies).toStrictEqual(["keep"]);
  expect(raw.patchedDependencies).toStrictEqual({ keep: "patches/keep.patch" });
  expect(fs.existsSync(path.join(w.root, "patches", "a.patch"))).toBe(false);
  expect(fs.existsSync(path.join(w.root, "patches", "keep.patch"))).toBe(true);
  expect(w.formats.map((f) => f.files)).toStrictEqual([["package.json", API]]);
  expect(w.installs).toStrictEqual([w.root]);
});

it("matches the name part of a scoped name@version patch key", async () => {
  const files = { "package.json": { name: "r", patchedDependencies: { "@s/p@2.0.0": "patches/s.patch" } } };
  const w = world(files, {});
  fs.mkdirSync(path.join(w.root, "patches"));
  fs.writeFileSync(path.join(w.root, "patches", "s.patch"), "diff\n");
  expect(await main(["@s/p"], w.io())).toBe(0);
  expect(w.out).toStrictEqual(["removed @s/p from package.json (patchedDependencies)"]);
  expect(fs.existsSync(path.join(w.root, "patches", "s.patch"))).toBe(false);
});

it("removes several names at once through one format and one install", async () => {
  const files = {
    "package.json": { name: "r", overrides: { b: "1.0.0" }, workspaces: { catalog: { a: "1.0.0" } } },
    "packages/x/package.json": { dependencies: { a: "catalog:" }, name: "x" },
  };
  const w = world(
    {
      ...files,
      "package.json": { ...files["package.json"], workspaces: { catalog: { a: "1.0.0" }, packages: ["packages/*"] } },
    },
    {},
  );
  expect(await main(["a", "b"], w.io())).toBe(0);
  expect(w.out).toStrictEqual([
    "removed a from packages/x (dependencies) and the catalog; b from package.json (overrides)",
  ]);
  expect(w.formats.length).toBe(1);
  expect(w.installs).toStrictEqual([w.root]);
});

it("an absent name exits 1 and writes nothing", async () => {
  const w = world(everywhere("left-pad"), {});
  expect(await main(["left-pad", "nope"], w.io())).toBe(1);
  expect(w.err).toStrictEqual(['repo remove: nothing here depends on "nope"']);
  expect(w.read("package.json").devDependencies).toStrictEqual({ "left-pad": "1.0.0", "left-pad-extra": "1.0.0" });
  expect(w.formats).toStrictEqual([]);
  expect(w.installs).toStrictEqual([]);
});

it("a root without a package.json depends on nothing", async () => {
  const w = world({}, {});
  expect(await main(["x"], w.io())).toBe(1);
  expect(w.err).toStrictEqual(['repo remove: nothing here depends on "x"']);
});

it("a failed install prints the install line with the way back", async () => {
  const w = world(everywhere("left-pad"), {});
  const install = () => ({ code: 1, output: "boom\n" });
  expect(await main(["left-pad"], w.io({ install }))).toBe(1);
  expect(w.err).toStrictEqual([
    "repo remove: bun install failed (exit 1); the manifests hold the new versions, so run `bun install` once it is fixed:",
    "  boom",
  ]);
});

it("without an .oxfmtrc.jsonc nothing is formatted and the install still runs", async () => {
  const w = world(everywhere("left-pad"), {});
  fs.rmSync(path.join(w.root, ".oxfmtrc.jsonc"));
  expect(await main(["left-pad"], w.io())).toBe(0);
  expect(w.formats).toStrictEqual([]);
  expect(w.installs).toStrictEqual([w.root]);
});

it("a failed format after a good install says the versions are installed", async () => {
  const w = world(everywhere("left-pad"), {});
  const format = () => ({ code: 1, output: "bad\n" });
  expect(await main(["left-pad"], w.io({ format }))).toBe(1);
  expect(w.err[0]).toContain("repo remove: could not format package.json");
  expect(w.err[0]).toContain("the new versions are installed");
  expect(w.installs).toStrictEqual([w.root]);
});

it("names nothing or an option: usage, exit 2", async () => {
  const w = world({}, {});
  expect(await main([], w.io())).toBe(2);
  expect(await main(["--x"], w.io())).toBe(2);
  expect(w.err).toStrictEqual(["repo remove: usage: repo remove <name>…", "repo remove: usage: repo remove <name>…"]);
});

it("reports an unreadable manifest", async () => {
  const w = world({ "package.json": { name: 1 } }, {});
  expect(await main(["x"], w.io())).toBe(1);
  expect(w.err[0]).toMatch(/^repo remove: /);
});

it("runs on the process streams when no io is given", () => {
  const written: string[] = [];
  const spy = vi.spyOn(process.stderr, "write").mockImplementation((text) => {
    written.push(String(text));
    return true;
  });
  try {
    expect(main(["--nope"])).toBe(2);
  } finally {
    spy.mockRestore();
  }
  expect(written).toStrictEqual(["repo remove: usage: repo remove <name>…\n"]);
});

it("prints the install's repo sync lines right after the removed line, and none when the install fails", () => {
  const files = { "package.json": { dependencies: { a: "1.0.0" }, name: "r" } };
  const output = "bun install v1\nrepo sync: wrote AGENTS.md\n 1 package installed\n";
  const ok = world(files, {}, { output });
  expect(main(["a"], ok.io())).toBe(0);
  expect(ok.out).toEqual(["removed a from package.json (dependencies)", "repo sync: wrote AGENTS.md"]);
  const bad = world(files, {});
  expect(main(["a"], bad.io({ install: () => ({ code: 1, output }) }))).toBe(1);
  expect(bad.out).toEqual(["removed a from package.json (dependencies)"]);
});
