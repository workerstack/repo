import fs from "node:fs";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { pathWith, plant, plantFiles, plantTool, useJobEnv } from "./fixtures/job-kit.ts";
import { runSearch } from "./job-search.ts";
import { descendantsOf, endTreeAfterError, type Runner } from "./job-tree.ts";

useJobEnv();

/** A planted `rg` that records its arguments in `args.json` beside it, then runs `body`. */
function plantRg(body: string): string {
  const record = `require("node:fs").writeFileSync(require("node:path").join(__dirname, "args.json"), JSON.stringify(process.argv.slice(2)));\n`;
  const dir = plantTool("rg", record + body);
  pathWith(dir);
  return dir;
}

/** The arguments the planted rg last ran with. */
function recorded(tool: string): string[] {
  const args: unknown = JSON.parse(fs.readFileSync(path.join(tool, "args.json"), "utf8"));
  return Array.isArray(args) ? args.map(String) : [];
}

const out = (text: string, code = 0) => `process.stdout.write(${JSON.stringify(text)}); process.exit(${code});`;
const search = (dir: string, extra: { path?: string; glob?: string[] } = {}) =>
  runSearch("hit", { cwd: dir, root: dir, ...extra });

it("runSearch prints what rg found as file:line facts and keeps a line it cannot split", () => {
  const dir = plant();
  plantRg(out("a.txt:1:  hello world \nb.txt:22:x\nno colon line\n"));
  const r = search(dir);
  expect(r).toEqual({
    fallback: false,
    text: "3 matches.\n- a.txt:1 — hello world\n- b.txt:22 — x\n- no colon line\n",
    code: 0,
  });
});

it("runSearch says no matches when rg exits 1", () => {
  const dir = plant();
  plantRg(out("", 1));
  expect(search(dir)).toEqual({ fallback: false, text: "No matches.\n", code: 0 });
});

it("runSearch reports rg's own error lines as a failed search", () => {
  const dir = plant();
  plantRg(`process.stderr.write("regex parse error\\n  bad\\n"); process.exit(2);`);
  expect(search(dir).text).toBe("Search failed.\n- regex parse error\n- bad\n");
});

it("runSearch names the exit code when rg fails without a word", () => {
  const dir = plant();
  plantRg(out("", 2));
  expect(search(dir).text).toBe("Search failed.\n- rg exit 2\n");
});

it("runSearch falls back when rg prints html", () => {
  const dir = plant();
  plantRg(out("<!DOCTYPE html>\n"));
  expect(search(dir)).toEqual({ fallback: true, text: "FALLBACK\n", code: 2 });
});

it("runSearch stashes the hits when rg prints more than six", () => {
  const dir = plant();
  plantRg(out(Array.from({ length: 8 }, (_, i) => `f.txt:${i + 1}:hit`).join("\n")));
  const text = search(dir).text;
  const ref = /stash=(\S+)/.exec(text)?.[1] ?? "";
  expect(text.split("\n")[0]).toBe(`8 matches, 6 shown. stash=${ref}`);
  expect(fs.readFileSync(path.join(dir, ref), "utf8")).toBe(
    Array.from({ length: 8 }, (_, i) => `f.txt:${i + 1}:hit`).join("\n") + "\n",
  );
});

it("runSearch marks ten thousand hits as a cut-off count", () => {
  const dir = plant();
  plantRg(`process.stdout.write("f.txt:1:hit\\n".repeat(10000));`);
  expect(search(dir).text.split("\n")[0]).toMatch(/^10000\+ matches, 6 shown\. stash=/);
});

it("runSearch asks rg to search the path with the globs and the query", () => {
  const dir = plant();
  const tool = plantRg(out("", 1));
  fs.mkdirSync(path.join(dir, "sub"));
  search(dir, { path: "sub", glob: ["*.md", "*.ts"] });
  const args = recorded(tool);
  expect(args.slice(-3)).toEqual(["-e", "hit", "sub"]);
  expect(args).toContain("--hidden");
  const globs = args.flatMap((a, i) => (args[i - 1] === "-g" ? [a] : []));
  expect(globs).toEqual(["!node_modules", "!dist", "!coverage", "!.next", "!build", "!.git", "*.md", "*.ts"]);
  search(dir);
  expect(recorded(tool).slice(-1)).toEqual(["."]);
});

it.skipIf(process.platform === "win32")("runSearch walks the tree itself when rg is killed", () => {
  const dir = plant();
  plantFiles(dir, { "a.txt": "hit\n" });
  plantRg(`process.kill(process.pid, "SIGKILL");`);
  expect(search(dir).text).toBe("1 match.\n- a.txt:1 — hit\n");
});

it("runSearch walks the tree itself when rg prints more than the buffer holds", () => {
  const dir = plant();
  plantFiles(dir, { "a.txt": "hit\n" });
  plantRg(`process.stdout.write("x".repeat(3 * 1024 * 1024));`);
  expect(search(dir).text).toBe("1 match.\n- a.txt:1 — hit\n");
});

function recordingRunner(listing: string) {
  const calls: { file: string; args: string[] }[] = [];
  const runner: Runner = (file, args) => {
    calls.push({ file, args });
    return { stdout: file === "powershell" ? listing : null };
  };
  return { calls, runner };
}

it("endTreeAfterError ends the dead root and every descendant by parent pid, only on Windows with a pid", () => {
  const failed = { error: new Error("spawnSync ENOBUFS"), pid: 10 };
  const { calls, runner } = recordingRunner("junk\r\n11 10\r\n12 11\n13 99\n10 1\n");
  expect(endTreeAfterError(failed, "win32", runner)).toBe(true);
  expect(calls.map((c) => c.file)).toEqual(["powershell", "taskkill"]);
  expect(calls[1]?.args).toEqual(["/F", "/T", "/PID", "10", "/PID", "11", "/PID", "12"]);
  const none = recordingRunner("");
  expect(endTreeAfterError(failed, "win32", { ...none }.runner)).toBe(true);
  expect(none.calls[1]?.args).toEqual(["/F", "/T", "/PID", "10"]);
  const silent = vi.fn(() => ({}));
  expect(endTreeAfterError(failed, "win32", silent)).toBe(true);
  expect(silent).toHaveBeenCalledTimes(2);
  for (const platform of ["linux", "darwin"] as const) {
    expect(endTreeAfterError(failed, platform, silent)).toBe(false);
  }
  expect(endTreeAfterError({ pid: failed.pid }, "win32", silent)).toBe(false);
  expect(endTreeAfterError({ error: failed.error }, "win32", silent)).toBe(false);
  expect(silent).toHaveBeenCalledTimes(2);
});

it("descendantsOf follows parent pids through a cycle without looping", () => {
  expect(
    descendantsOf(1, [
      [2, 1],
      [3, 2],
      [1, 3],
      [2, 1],
    ]),
  ).toEqual([2, 3]);
});

it("endTreeAfterError leaves a real run alone off Windows", () => {
  expect(endTreeAfterError({ error: new Error("x"), pid: 2 ** 22 })).toBe(process.platform === "win32");
});

it.runIf(process.platform === "win32")("runSearch leaves no stub of an overflowing rg shim running", () => {
  const dir = plant();
  plantFiles(dir, { "a.txt": "hit\n" });
  const tool = plantRg(`process.stdout.write("x".repeat(3 * 1024 * 1024));`);
  search(dir);
  const pids = fs.readFileSync(path.join(tool, "pids.txt"), "utf8").split("\n").filter(Boolean).map(Number);
  expect(pids.length).toBeGreaterThan(0);
  for (const pid of pids) {
    expect(() => process.kill(pid, 0)).toThrow();
  }
});
