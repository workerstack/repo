import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "session-map.mjs");
const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function tmp(git: boolean) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "session-map-"));
  tmpDirs.push(root);
  if (git) spawnSync("git", ["init", "-q"], { cwd: root });
  return root;
}

function run(root: string, stdin: string) {
  const env = { ...process.env };
  delete env.GROK_WORKSPACE_ROOT;
  delete env.CLAUDE_PROJECT_DIR;
  return spawnSync(process.execPath, [script], { cwd: root, input: stdin, encoding: "utf8", env });
}

describe("session-map hook", () => {
  it("injects the map as SessionStart additionalContext and logs its size", () => {
    const root = tmp(true);
    fs.mkdirSync(path.join(root, "src/lib"), { recursive: true });
    fs.writeFileSync(path.join(root, "src/lib/a.ts"), "");
    const r = run(root, JSON.stringify({ session_id: "s1", cwd: root }));
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(out.hookSpecificOutput.additionalContext).toBe(
      "Folder map (code folders only; `…` = more inside, run `node scripts/folder-map.mjs <dir>`):\nsrc/lib/\n",
    );
    expect(out.decision).toBeUndefined();
    const log = JSON.parse(
      fs.readFileSync(path.join(root, ".tmp/grunt/sessions/s1/map.json"), "utf8"),
    );
    expect(log).toEqual({ rows: 1, tokens: 3 });
  });

  it("prints nothing outside git, on empty maps, and on bad stdin", () => {
    expect(run(tmp(false), "{}")).toMatchObject({ status: 0, stdout: "" });
    expect(run(tmp(true), "{}")).toMatchObject({ status: 0, stdout: "" });
    const root = tmp(true);
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "src/a.ts"), "");
    const r = run(root, "not json");
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).hookSpecificOutput.additionalContext).toContain("src/");
  });
});
