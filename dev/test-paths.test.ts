import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { aliasOf, bunPath, installedBin, linkText, removeAlias, shellForm } from "./test-paths.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    removeAlias(`${dir}-alias`);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function temp(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "test-paths-")));
  dirs.push(dir);
  return dir;
}

it("linkText reads an absolute link, as a win32 junction holds it, in the relative form", () => {
  const dir = temp();
  fs.mkdirSync(path.join(dir, "store/a"), { recursive: true });
  fs.mkdirSync(path.join(dir, "tree"));
  fs.symlinkSync(path.join(dir, "store/a"), path.join(dir, "tree/skill"), "junction");
  expect(linkText(path.join(dir, "tree/skill"))).toBe("../store/a");
});

it("linkText names one spelling when the link is reached through an alias of its dir", () => {
  const dir = temp();
  fs.mkdirSync(path.join(dir, "store/a"), { recursive: true });
  fs.mkdirSync(path.join(dir, "tree"));
  fs.symlinkSync(path.join(dir, "store/a"), path.join(dir, "tree/skill"), "junction");
  expect(linkText(path.join(aliasOf(dir), "tree/skill"))).toBe("../store/a");
});

it("shellForm and installedBin name the canonical dir with forward slashes", () => {
  const dir = temp();
  expect(shellForm(path.join(aliasOf(dir), "x"))).toBe(`${dir.split(path.sep).join("/")}/x`);
  expect(installedBin(aliasOf(dir))).toBe(
    `${dir.split(path.sep).join("/")}/node_modules/.bin/repo${process.platform === "win32" ? ".exe" : ""}`,
  );
});

it("bunPath names the bun binary, the same one on every call", () => {
  expect(path.basename(bunPath()).toLowerCase()).toMatch(/^bun(\.exe)?$/);
  expect(bunPath()).toBe(bunPath());
});
