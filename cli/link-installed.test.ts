import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, expect, it } from "vitest";

import { markersIn, readVersion } from "./link-installed.ts";
import { MARKER_FILE, MODULES } from "./link.constants.ts";

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-link-installed-")));

afterAll(() => fs.rmSync(root, { force: true, recursive: true }));

/** Writes `text` as `file` of the installed package `name`, and returns the package's dir. */
function installed(name: string, file: string, text: string): string {
  const dir = path.join(root, MODULES, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);

  return dir;
}

it("reads no version from a package.json that is missing, no JSON or names no package and version", () => {
  expect(readVersion(path.join(root, "absent"))).toBeNull();
  expect(readVersion(installed("garbled", "package.json", "{ nope"))).toBeNull();
  expect(readVersion(installed("nameless", "package.json", JSON.stringify({ version: "1.0.0" })))).toBeNull();
  expect(readVersion(installed("named", "package.json", JSON.stringify({ name: "named", version: "1.0.0" })))).toBe(
    "1.0.0",
  );
});

it("lists only the markers that name a package and a source", () => {
  installed("swapped", MARKER_FILE, JSON.stringify({ name: "swapped", source: "/src/swapped" }));
  installed("odd", MARKER_FILE, JSON.stringify({ name: "odd" }));

  expect(markersIn(root)).toStrictEqual([{ name: "swapped", source: "/src/swapped" }]);
});
