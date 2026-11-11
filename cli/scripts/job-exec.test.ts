import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { pathWith, plant, plantFiles, plantTool, useJobEnv } from "./fixtures/job-kit.ts";
import { outputsOf, runExec } from "./job-exec.ts";

useJobEnv();

function exec(dir: string, query: string) {
  return runExec(query, { cwd: dir, root: dir });
}
const FALLBACK = { code: 2, fallback: true, text: "FALLBACK\n" };

/** A planted dir holding the given bun scripts. */
function withScripts(scripts: Record<string, string>): string {
  const dir = plant();
  plantFiles(dir, scripts);
  return dir;
}

it("runExec lists what a command printed", () => {
  const dir = plant();
  expect(exec(dir, "echo hi")).toStrictEqual({ code: 0, fallback: false, text: "1 line.\n- hi\n" });
  expect(exec(dir, "  echo  a   b ").text).toBe("1 line.\n- a b\n");
});

it("runExec says no output for a silent success", () => {
  expect(exec(plant(), "true").text).toBe("No output.\n");
});

it("runExec takes the cwd from the process when it is given none", () => {
  expect(runExec("echo hi").text).toBe("1 line.\n- hi\n");
});

it("runExec reports a failing command with its exit code when it printed nothing", () => {
  expect(exec(plant(), "false")).toStrictEqual({ code: 0, fallback: false, text: "Command failed.\n- exit 1\n" });
});

it("runExec reports a failing command by its stderr lines", () => {
  const dir = withScripts({ "err.js": 'console.error("boom one"); console.error("  boom two"); process.exit(3);' });
  expect(exec(dir, "bun err.js").text).toBe("Command failed.\n- boom one\n- boom two\n");
});

it("runExec reports a failing command by its stdout when stderr is empty", () => {
  const dir = withScripts({ "out.js": 'console.log("only out"); process.exit(1);' });
  expect(exec(dir, "bun out.js").text).toBe("Command failed.\n- only out\n");
});

it("runExec stashes a long failure and shows three errors", () => {
  const src = 'for (let i = 0; i < 10; i++) console.error("line " + i); process.exit(1);';
  const dir = withScripts({ "many.js": src });
  const text = exec(dir, "bun many.js").text;
  const ref = /stash=(\S+)/.exec(text)?.[1] ?? "";
  expect(text).toBe(`Command failed. stash=${ref}\n- line 0\n- line 1\n- line 2\n`);
  expect(fs.readFileSync(path.join(dir, ref), "utf8")).toContain("line 9\n");
});

it("runExec shows a warning that came on stderr alone", () => {
  const dir = withScripts({ "warn.js": 'console.error("warn only");' });
  expect(exec(dir, "bun warn.js").text).toBe("1 line.\n- warn only\n");
});

it("runExec stashes output of more than six lines and names the stash", () => {
  const dir = withScripts({ "many.js": 'for (let i = 0; i < 20; i++) console.log("row " + i);' });
  const text = exec(dir, "bun many.js").text;
  const ref = /stash=(\S+)/.exec(text)?.[1] ?? "";
  expect(text.split("\n")[0]).toBe(`20 lines, 6 shown. stash=${ref}`);
  expect(fs.readFileSync(path.join(dir, ref), "utf8").split("\n").filter(Boolean)).toHaveLength(20);
});

it("runExec stashes output over 32KB even when it is one line", () => {
  const dir = withScripts({ "wide.js": 'process.stdout.write("x".repeat(40000) + "\\n");' });
  const text = exec(dir, "bun wide.js").text;
  expect(text).toMatch(/^1 line, 1 shown\. stash=\.tmp\/repo\/stash\/exec-/);
});

it("runExec names the stash absolutely when it runs away from the root", () => {
  const dir = withScripts({ "pkg/many.js": 'for (let i = 0; i < 9; i++) console.log("row " + i);' });
  const text = runExec("bun many.js", { cwd: path.join(dir, "pkg"), root: dir }).text;
  const stash = path.join(dir, ".tmp", "repo", "stash", "exec-");
  expect(text.split("\n")[0]?.startsWith(`9 lines, 6 shown. stash=${stash}`)).toBe(true);
});

it("runExec falls back for shell syntax, an empty command and html", () => {
  const dir = withScripts({ "page.js": 'console.log("<html><body>x</body></html>");' });
  expect(exec(dir, "echo a && echo b")).toStrictEqual(FALLBACK);
  expect(exec(dir, "echo $HOME")).toStrictEqual(FALLBACK);
  expect(exec(dir, "   ")).toStrictEqual(FALLBACK);
  expect(exec(dir, "bun page.js")).toStrictEqual(FALLBACK);
});

it("runExec reports a command that does not exist", () => {
  const dir = plant();
  const text = "Command failed.\n- ENOENT\n";
  expect(exec(dir, "no-such-command-zzq").text).toBe(text);
  expect(exec(dir, "rtk no-such-command-zzq").text).toBe(text);
  expect(exec(dir, "/nowhere/rtk echo hi").text).toBe(text);
});

it("runExec runs the command through rtk when rtk is on PATH", () => {
  const dir = plant();
  pathWith(plantTool("rtk", 'console.log("rtk:" + process.argv.slice(2).join(" "));'));
  expect(exec(dir, "echo hi").text).toBe("1 line.\n- rtk:echo hi\n");
});

it("runExec runs a command that starts with rtk as it is", () => {
  const dir = plant();
  pathWith(plantTool("rtk", 'console.log("rtk:" + process.argv.slice(2).join(" "));'));
  expect(exec(dir, "rtk echo hi").text).toBe("1 line.\n- rtk:echo hi\n");
});

it.runIf(process.platform !== "win32")("runExec runs a command that is a path to rtk as it is", () => {
  const dir = plant();
  const tool = plantTool("rtk", 'console.log("rtk:" + process.argv.slice(2).join(" "));');
  pathWith(tool);
  expect(exec(dir, `${tool}/rtk echo hi`).text).toBe("1 line.\n- rtk:echo hi\n");
});

it("outputsOf reads a run that never started, which has no stdout or stderr, as empty text", () => {
  expect(outputsOf({})).toStrictEqual({ stderr: "", stdout: "" });
  expect(outputsOf({ stderr: null, stdout: null })).toStrictEqual({ stderr: "", stdout: "" });
  expect(outputsOf({ stderr: "e", stdout: "o" })).toStrictEqual({ stderr: "e", stdout: "o" });
});
