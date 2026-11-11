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
      catalogs: { next: { keep: "2.0.0", [name]: "2.0.0" } },
      devDependencies: { [name]: "1.0.0", [`${name}-extra`]: "1.0.0" },
      name: "root",
      overrides: { keep: "1.0.0", [name]: "1.0.0" },
      patchedDependencies: { [`${name}@1.0.0`]: "patches/a.patch", keep: "patches/keep.patch" },
      private: true,
      resolutions: { [name]: "1.0.0" },
      trustedDependencies: [name, "keep"],
      workspaces: { catalog: { keep: "1.0.0", [name]: "^1.0.0" }, packages: ["packages/*"] },
    },
    "packages/api/package.json": {
      dependencies: { keep: "1.0.0", [name]: "catalog:" },
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

function failedInstall() {
  return { code: 1, output: "boom\n" };
}
function failedFormat() {
  return { code: 1, output: "bad\n" };
}

it("removes a name from every field, catalog, override and patch, and says where", () => {
  const w = world(everywhere("left-pad"), {});
  patches(w.root);
  expect(main(["left-pad"], w.io())).toBe(0);
  expect(w.out).toStrictEqual([
    "removed left-pad from package.json (devDependencies, overrides, resolutions, trustedDependencies, " +
      "patchedDependencies) and packages/api (dependencies, devDependencies, peerDependencies, " +
      "optionalDependencies) and the catalog and the next catalog",
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

it("matches the name part of a scoped name@version patch key", () => {
  const files = { "package.json": { name: "r", patchedDependencies: { "@s/p@2.0.0": "patches/s.patch" } } };
  const w = world(files, {});
  fs.mkdirSync(path.join(w.root, "patches"));
  fs.writeFileSync(path.join(w.root, "patches", "s.patch"), "diff\n");
  expect(main(["@s/p"], w.io())).toBe(0);
  expect(w.out).toStrictEqual(["removed @s/p from package.json (patchedDependencies)"]);
  expect(fs.existsSync(path.join(w.root, "patches", "s.patch"))).toBe(false);
});

it("removes several names at once through one format and one install", () => {
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
  expect(main(["a", "b"], w.io())).toBe(0);
  expect(w.out).toStrictEqual([
    "removed a from packages/x (dependencies) and the catalog; b from package.json (overrides)",
  ]);
  expect(w.formats.length).toBe(1);
  expect(w.installs).toStrictEqual([w.root]);
});

it("an absent name exits 1 and writes nothing", () => {
  const w = world(everywhere("left-pad"), {});
  expect(main(["left-pad", "nope"], w.io())).toBe(1);
  expect(w.err).toStrictEqual(['repo remove: nothing here depends on "nope"']);
  expect(w.read("package.json").devDependencies).toStrictEqual({ "left-pad": "1.0.0", "left-pad-extra": "1.0.0" });
  expect(w.formats).toStrictEqual([]);
  expect(w.installs).toStrictEqual([]);
});

it("a root without a package.json depends on nothing", () => {
  const w = world({}, {});
  expect(main(["x"], w.io())).toBe(1);
  expect(w.err).toStrictEqual(['repo remove: nothing here depends on "x"']);
});

it("a failed install prints the install line with the way back", () => {
  const w = world(everywhere("left-pad"), {});
  expect(main(["left-pad"], w.io({ install: failedInstall }))).toBe(1);
  expect(w.err).toStrictEqual([
    "repo remove: bun install failed (exit 1); the manifests hold the new versions, " +
      "so run `bun install` once it is fixed:",
    "  boom",
  ]);
});

it("without an .oxfmtrc.jsonc nothing is formatted and the install still runs", () => {
  const w = world(everywhere("left-pad"), {});
  fs.rmSync(path.join(w.root, ".oxfmtrc.jsonc"));
  expect(main(["left-pad"], w.io())).toBe(0);
  expect(w.formats).toStrictEqual([]);
  expect(w.installs).toStrictEqual([w.root]);
});

it("a failed format after a good install says the versions are installed", () => {
  const w = world(everywhere("left-pad"), {});
  expect(main(["left-pad"], w.io({ format: failedFormat }))).toBe(1);
  expect(w.err[0]).toContain("repo remove: could not format package.json");
  expect(w.err[0]).toContain("the new versions are installed");
  expect(w.installs).toStrictEqual([w.root]);
});

it("names nothing or an option: usage, exit 2", () => {
  const w = world({}, {});
  expect(main([], w.io())).toBe(2);
  expect(main(["--x"], w.io())).toBe(2);
  expect(w.err).toStrictEqual(["repo remove: usage: repo remove <name>…", "repo remove: usage: repo remove <name>…"]);
});

it("reports an unreadable manifest", () => {
  const w = world({ "package.json": { name: 1 } }, {});
  expect(main(["x"], w.io())).toBe(1);
  expect(w.err[0]).toMatch(/^repo remove: /);
});

it("runs on the process streams when no io is given", () => {
  const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  try {
    expect(main(["--nope"])).toBe(2);
    expect(spy.mock.calls).toStrictEqual([["repo remove: usage: repo remove <name>…\n"]]);
  } finally {
    spy.mockRestore();
  }
});

it("prints the install's repo sync lines right after the removed line, and none when the install fails", () => {
  const files = { "package.json": { dependencies: { a: "1.0.0" }, name: "r" } };
  const output = "bun install v1\nrepo sync: wrote AGENTS.md\n 1 package installed\n";
  const ok = world(files, {}, { output });
  expect(main(["a"], ok.io())).toBe(0);
  expect(ok.out).toStrictEqual(["removed a from package.json (dependencies)", "repo sync: wrote AGENTS.md"]);
  const bad = world(files, {});
  expect(main(["a"], bad.io({ install: () => ({ code: 1, output }) }))).toBe(1);
  expect(bad.out).toStrictEqual(["removed a from package.json (dependencies)"]);
});
