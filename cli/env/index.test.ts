import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import * as entry from "./index.ts";

const BUILT = path.resolve(import.meta.dirname, "..", "..", "dist", "cli", "env", "index.js");

describe("the env entry", () => {
  it("exports defineEnv and sealed", () => {
    expect(Object.keys(entry).toSorted()).toStrictEqual(["defineEnv", "sealed"]);
  });

  it("loads as built JavaScript under plain Node, which cannot load a .ts file from node_modules", () => {
    const run = spawnSync(
      "node",
      [
        "--input-type=module",
        "-e",
        `import(${JSON.stringify(pathToFileURL(BUILT).href)}).then((m) => console.log(Object.keys(m).join()))`,
      ],
      { encoding: "utf8" },
    );

    expect(run.stderr).toBe("");
    expect(run.stdout.trim()).toBe("defineEnv,sealed");
  });
});
