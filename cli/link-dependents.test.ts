import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { checkoutOf, readDependents, registerDependent, unregisterDependent } from "./link-dependents.ts";
import { DEPENDENTS_DIR } from "./link.constants.ts";
import { removeTree } from "./remove-tree.ts";

const bases: string[] = [];

afterEach(() => {
  for (const base of bases.splice(0)) removeTree(base);
});

function tempDir(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "dependents-")));
  bases.push(dir);

  return dir;
}

/** A temp dir with a `source` checkout path and a consumer `root` path under it. */
function scene() {
  const b = tempDir();

  return { b, root: path.join(b, "root"), source: path.join(b, "source") };
}

function files(checkout: string): string[] {
  return fs.readdirSync(path.join(checkout, DEPENDENTS_DIR));
}

function read(): void {}

it("writes one file per consumer root holding the root and its packages", () => {
  const b = tempDir();
  const source = path.join(b, "source");
  registerDependent(source, path.join(b, "one"), { dir: path.join(source, "a"), name: "a" });
  registerDependent(source, path.join(b, "two"), { dir: path.join(source, "a"), name: "a" });
  expect(files(source)).toHaveLength(2);
  const warnings: string[] = [];
  expect(
    readDependents(source, (line) => warnings.push(line))
      .map((one) => one.root)
      .toSorted(),
  ).toStrictEqual([path.join(b, "one"), path.join(b, "two")]);
  expect(warnings).toStrictEqual([]);
  const [file] = files(source);
  const parsed: unknown = JSON.parse(fs.readFileSync(path.join(source, DEPENDENTS_DIR, file ?? ""), "utf8"));
  expect(parsed).toMatchObject({ packages: [{ dir: path.join(source, "a"), name: "a" }], version: 1 });
  expect(files(source).some((name) => name.endsWith(".tmp"))).toBe(false);
});

it("adds a second package to the same root without repeating one", () => {
  const { root, source } = scene();
  registerDependent(source, root, { dir: "/x/b", name: "b" });
  registerDependent(source, root, { dir: "/x/a", name: "a" });
  registerDependent(source, root, { dir: "/x/a2", name: "a" });
  expect(files(source)).toHaveLength(1);
  expect(readDependents(source, read)).toStrictEqual([
    {
      packages: [
        { dir: "/x/a2", name: "a" },
        { dir: "/x/b", name: "b" },
      ],
      root,
    },
  ]);
});

it("drops one package, and removes the file with the last one", () => {
  const { root, source } = scene();
  registerDependent(source, root, { dir: "/x/a", name: "a" });
  registerDependent(source, root, { dir: "/x/b", name: "b" });
  unregisterDependent(source, root, "a");
  expect(readDependents(source, read)[0]?.packages).toStrictEqual([{ dir: "/x/b", name: "b" }]);
  unregisterDependent(source, root, "b");
  expect(files(source)).toStrictEqual([]);
});

it("does nothing to unregister a root that was never recorded", () => {
  const b = tempDir();
  const source = path.join(b, "source");
  unregisterDependent(source, path.join(b, "root"), "a");
  expect(fs.existsSync(path.join(source, DEPENDENTS_DIR))).toBe(false);
});

it("lists nothing when the source has no dependents dir", () => {
  expect(readDependents(path.join(tempDir(), "none"), read)).toStrictEqual([]);
});

it("skips a file that does not parse with a warning, and a file that is not json", () => {
  const b = tempDir();
  const source = path.join(b, "source");
  registerDependent(source, path.join(b, "root"), { dir: "/x/a", name: "a" });
  const dir = path.join(source, DEPENDENTS_DIR);
  fs.writeFileSync(path.join(dir, "bad.json"), "{nope");
  fs.writeFileSync(path.join(dir, "shape.json"), JSON.stringify({ root: 1 }));
  fs.writeFileSync(path.join(dir, "stray.tmp"), "x");
  const warnings: string[] = [];
  expect(readDependents(source, (line) => warnings.push(line))).toHaveLength(1);
  expect(warnings).toHaveLength(2);
  expect(warnings[0]).toContain(`${path.join(dir, "bad.json")} is not a valid dependents file`);
  expect(warnings[1]).toContain(path.join(dir, "shape.json"));
});

it("replaces a bad file on the next register, and ignores it on unregister", () => {
  const { root, source } = scene();
  registerDependent(source, root, { dir: "/x/a", name: "a" });
  const [name] = files(source);
  const file = path.join(source, DEPENDENTS_DIR, name ?? "");
  fs.writeFileSync(file, "{nope");
  unregisterDependent(source, root, "a");
  expect(fs.readFileSync(file, "utf8")).toBe("{nope");
  registerDependent(source, root, { dir: "/x/b", name: "b" });
  expect(readDependents(source, read)[0]?.packages).toStrictEqual([{ dir: "/x/b", name: "b" }]);
});

it("shares one file between two spellings of a root", () => {
  const { b, root, source } = scene();
  fs.mkdirSync(root);
  fs.symlinkSync(root, path.join(b, "link"));
  registerDependent(source, root, { dir: "/x/a", name: "a" });
  registerDependent(source, `${path.join(b, "link")}${path.sep}`, { dir: "/x/b", name: "b" });
  registerDependent(source, path.join(b, "other", "..", "root"), { dir: "/x/c", name: "c" });
  expect(files(source)).toHaveLength(1);
  expect(readDependents(source, read)[0]).toMatchObject({ root });
  expect(readDependents(source, read)[0]?.packages).toHaveLength(3);
  unregisterDependent(source, path.join(b, "link"), "a");
  expect(readDependents(source, read)[0]?.packages).toHaveLength(2);
});

it("finds the checkout of a package dir by walking up to .git, or null", () => {
  const b = tempDir();
  const deep = path.join(b, "src", "packages", "x");
  fs.mkdirSync(deep, { recursive: true });
  fs.writeFileSync(path.join(b, "src", ".git"), "gitdir: x\n");
  expect(checkoutOf(deep)).toBe(path.join(b, "src"));
  expect(checkoutOf(path.join(b, "src"))).toBe(path.join(b, "src"));
  expect(checkoutOf(path.join(b, "nowhere"))).toBeNull();
});
