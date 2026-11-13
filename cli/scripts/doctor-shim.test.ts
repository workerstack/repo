import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { tempDir, useTempDirs } from "../sync/__fixtures__/temp-dirs.ts";
import { runDoctor } from "./doctor.ts";
import { shimDir } from "./shim.ts";

useTempDirs();

/** The `shim` row's text after the name column, run on Linux with `home` and no PATH. */
function shimRowOf(home: string): string {
  const r = runDoctor({ cwd: tempDir("doctor-shim-cwd-"), home, pathEnv: "", platform: "linux" });
  const line = r.stdout.split("\n").find((l) => l.startsWith("shim "));

  return (line ?? "").replaceAll(/\s+/g, " ").trim();
}

function launcherPath(home: string): string {
  return path.join(shimDir({ home, platform: "linux" }), "repo");
}

it("shim row: not installed with the repo shim hint when the launcher is missing", () => {
  expect(shimRowOf(tempDir("doctor-shim-none-"))).toBe("shim not installed run `repo shim`");
});

it("shim row: stale when the installed launcher differs from the package's", () => {
  const home = tempDir("doctor-shim-stale-");
  fs.mkdirSync(path.dirname(launcherPath(home)), { recursive: true });
  fs.writeFileSync(launcherPath(home), "old\n");

  expect(shimRowOf(home)).toBe("shim stale run `repo shim`");
});

it("shim row: ok when the launcher is the package's copy", () => {
  const home = tempDir("doctor-shim-ok-");
  fs.mkdirSync(path.dirname(launcherPath(home)), { recursive: true });
  fs.copyFileSync(new URL("shim-launcher.mjs", import.meta.url), launcherPath(home));

  expect(shimRowOf(home)).toBe("shim ok");
});
