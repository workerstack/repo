import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it, vi } from "vitest";

import { useCapturedRun } from "../__fixtures__/captured-run.ts";
import { parseJson } from "./__fixtures__/orchestrate-kit.ts";
import { main } from "./set.ts";
import type { Roots } from "./workspace-root.ts";

const captured = useCapturedRun();

const ALL = "ask, away, fast, deep, free, spawn-fast or spawn-deep";

type Workspace = { root: string; roots: () => Roots };

function workspace(): Workspace {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "repo-set-")));
  captured.temps.push(root);

  return { root, roots: () => ({ checkout: root, cwd: root, root }) };
}

function saved(root: string, sid: string): Record<string, string> {
  return parseJson<Record<string, string>>(
    fs.readFileSync(path.join(root, ".repo/tmp/sessions", sid, "settings.json"), "utf8"),
  );
}

it("writes the session's settings file and prints the change line", async () => {
  const { root, roots } = workspace();
  expect(await main(["--session", "s1", "away", "spawn-fast"], roots)).toBe(0);
  expect(saved(root, "s1")).toStrictEqual({ approval: "away", strategy: "spawn-fast" });
  expect(captured.out.join("")).toBe("set approval away (was ask), strategy spawn-fast (was free)\n");
});

it("takes the session flag after the words too", async () => {
  const { root, roots } = workspace();
  expect(await main(["deep", "--session", "s2"], roots)).toBe(0);
  expect(saved(root, "s2")).toStrictEqual({ effort: "deep" });
});

it("reports the value the session held before, and keeps its other values", async () => {
  const { root, roots } = workspace();
  await main(["--session", "s3", "away"], roots);
  captured.out.length = 0;
  expect(await main(["--session", "s3", "fast"], roots)).toBe(0);
  expect(captured.out.join("")).toBe("set effort fast (was deep)\n");
  expect(saved(root, "s3")).toStrictEqual({ approval: "away", effort: "fast" });
});

it("says no change when the session already holds the value", async () => {
  const { roots } = workspace();
  await main(["--session", "s4", "away"], roots);
  captured.out.length = 0;
  expect(await main(["--session", "s4", "away"], roots)).toBe(0);
  expect(captured.out.join("")).toBe("set: no change; approval is already away\n");
});

it("exits 2 with the needs-session line when no session is given", async () => {
  const { root, roots } = workspace();
  expect(await main(["away"], roots)).toBe(2);
  expect(captured.err.join("")).toContain("repo set: needs --session <id>; the hook adds it for an agent");
  expect(fs.existsSync(path.join(root, ".repo/tmp/sessions"))).toBe(false);
});

it.each([[["away", "--session"]], [["away", "--session="]]])("exits 2 for %j: the session has no id", async (argv) => {
  const { root, roots } = workspace();
  expect(await main(argv, roots)).toBe(2);
  expect(captured.err.join("")).toContain("repo set: needs --session <id>");
  expect(fs.existsSync(path.join(root, ".repo/tmp/sessions"))).toBe(false);
});

it("takes the id from --session=<id>", async () => {
  const { root, roots } = workspace();
  expect(await main(["--session=s7", "away"], roots)).toBe(0);
  expect(saved(root, "s7")).toStrictEqual({ approval: "away" });
});

it("finds the workspace from the process cwd when no roots are given", async () => {
  const { root } = workspace();
  vi.spyOn(process, "cwd").mockReturnValue(root);

  try {
    expect(await main(["--session", "s8", "away"])).toBe(0);
  } finally {
    vi.restoreAllMocks();
  }

  expect(saved(root, "s8")).toStrictEqual({ approval: "away" });
});

it("exits 2 with the name-a-setting line when no words are given", async () => {
  const { root, roots } = workspace();
  expect(await main(["--session", "s5"], roots)).toBe(2);
  expect(captured.err.join("")).toContain(`set: name a setting: ${ALL}`);
  expect(fs.existsSync(path.join(root, ".repo/tmp/sessions/s5"))).toBe(false);
});

it.each([
  [["fsat"], `set: "fsat" is not a setting; use ${ALL}`],
  [["fast", "deep"], "set: fast and deep both set effort; pick one"],
])("exits 2 for %j with its line and saves nothing", async (words, line) => {
  const { root, roots } = workspace();
  expect(await main(["--session", "s6", ...words], roots)).toBe(2);
  expect(captured.err.join("")).toContain(line);
  expect(captured.out.join("")).toBe("");
  expect(fs.existsSync(path.join(root, ".repo/tmp/sessions/s6"))).toBe(false);
});

it("runs as `repo set` through the real entry", () => {
  const { root } = workspace();
  const bin = path.resolve(import.meta.dirname, "../../bin/repo.ts");
  const run = spawnSync("bun", [bin, "set", "--session", "e2e", "away"], { cwd: root, encoding: "utf8" });
  expect(run.stdout).toBe("set approval away (was ask)\n");
  expect(run.status).toBe(0);
  expect(saved(root, "e2e")).toStrictEqual({ approval: "away" });

  const bad = spawnSync("bun", [bin, "set", "away"], { cwd: root, encoding: "utf8" });
  expect(bad.status).toBe(2);
  expect(bad.stderr).toContain("repo set: needs --session <id>; the hook adds it for an agent");
});
