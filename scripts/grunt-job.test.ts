import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  FALLBACK,
  formatFacts,
  parseArgv,
  resolveStashFile,
  runJob,
  shouldFallback,
  squeezLines,
} from "./grunt-job.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const script = path.join(here, "grunt-job.mjs");
const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function pathSansRg() {
  return (process.env.PATH || "")
    .split(path.delimiter)
    .filter((dir) => !fs.existsSync(path.join(dir, "rg")))
    .join(path.delimiter);
}

function runCli(args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    cwd: opts.cwd || root,
    timeout: 20_000,
    env: opts.env || process.env,
  });
}

describe("parseArgv", () => {
  it("parses job query path glob cwd; unknown flags set unknown", () => {
    expect(
      parseArgv([
        "--job",
        "search",
        "--query",
        "a|b",
        "--path",
        "src",
        "--glob",
        "*.md",
        "--glob=*.ts",
        "--cwd",
        "pkg",
      ]),
    ).toEqual({
      job: "search",
      query: "a|b",
      path: "src",
      glob: ["*.md", "*.ts"],
      cwd: "pkg",
      stash: "",
      from: "",
      to: "",
      unknown: false,
    });
    expect(parseArgv(["--job", "search", "--query", "x", "--wat"]).unknown).toBe(true);
  });
});

describe("shouldFallback", () => {
  it("falls back on web jobs, denylist, empty query; allows bounded test", () => {
    expect(shouldFallback("web", "anything")).toBe(true);
    expect(shouldFallback("test", "npm test")).toBe(false);
    expect(shouldFallback("search", "")).toBe(true);
    expect(shouldFallback("search", "foo node_modules")).toBe(true);
    expect(shouldFallback("exec", "cat package-lock.json")).toBe(true);
    expect(shouldFallback("test", "foo node_modules")).toBe(true);
    expect(shouldFallback("search", "gate-fat-tools")).toBe(false);
  });
});

describe("formatFacts", () => {
  it("prints 1 vs n sentences for search and exec", () => {
    expect(formatFacts({ kind: "search", n: 0 })).toBe("No matches.\n");
    expect(formatFacts({ kind: "search", n: 1, facts: ["a:1 — x"] })).toBe(
      "1 match.\n- a:1 — x\n",
    );
    expect(formatFacts({ kind: "search", n: 3, facts: ["a", "b", "c"] })).toBe(
      "3 matches.\n- a\n- b\n- c\n",
    );
    expect(formatFacts({ kind: "search", failed: true, errors: ["err"] })).toBe(
      "Search failed.\n- err\n",
    );
    expect(formatFacts({ kind: "exec", n: 0 })).toBe("No output.\n");
    expect(formatFacts({ kind: "exec", n: 1, facts: ["hi"] })).toBe(
      "1 line.\n- hi\n",
    );
    expect(formatFacts({ kind: "exec", n: 3, facts: ["a", "b", "c"] })).toBe(
      "3 lines.\n- a\n- b\n- c\n",
    );
    expect(formatFacts({ kind: "exec", failed: true, errors: ["exit 1"] })).toBe(
      "Command failed.\n- exit 1\n",
    );
  });
});

describe("runJob search", () => {
  it("ok when the pattern hits this repo", () => {
    const r = runJob({
      job: "search",
      query: "DEFAULT_GREP_HEAD_LIMIT",
      cwd: root,
    });
    expect(r.fallback).toBe(false);
    expect(r.text).toMatch(/^\d+ match(?:es)?/);
    expect(r.text).toMatch(/^- /m);
    expect(r.text).not.toMatch(/^verdict:/m);
    expect(r.text.split("\n").filter(Boolean).length).toBeLessThanOrEqual(8);
  });

  it("empty when nothing matches", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grunt-job-"));
    tmpDirs.push(dir);
    fs.writeFileSync(path.join(dir, "a.txt"), "hello\n");
    const r = runJob({
      job: "search",
      query: "zzzxnot-a-real-token-grunt-job-xyzzy",
      cwd: dir,
    });
    expect(r.fallback).toBe(false);
    expect(r.text).toBe("No matches.\n");
    expect(r.code).toBe(0);
  });
});

describe("runJob search flags", () => {
  it("PATH without rg: hello|world fixture ok; --path scoped", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grunt-job-or-"));
    tmpDirs.push(dir);
    fs.writeFileSync(path.join(dir, "a.txt"), "hello\n");
    fs.writeFileSync(path.join(dir, "b.txt"), "world\n");
    fs.mkdirSync(path.join(dir, "sub"));
    fs.writeFileSync(path.join(dir, "sub", "c.txt"), "hello\n");
    fs.writeFileSync(path.join(dir, "sub", "d.txt"), "nope\n");
    const env = { ...process.env, PATH: pathSansRg() };
    const or = runCli(["--job", "search", "--query", "hello|world"], { cwd: dir, env });
    expect(or.status).toBe(0);
    expect(or.stdout).toMatch(/^\d+ match(?:es)?\.\n/);
    expect(or.stdout).toMatch(/hello|world/);
    const scoped = runCli(
      ["--job", "search", "--query", "hello|world", "--path", "sub"],
      { cwd: dir, env },
    );
    expect(scoped.status).toBe(0);
    expect(scoped.stdout).toMatch(/^\d+ match(?:es)?\.\n/);
    expect(scoped.stdout).toMatch(/sub\/c\.txt/);
    expect(scoped.stdout).not.toMatch(/a\.txt/);
    fs.writeFileSync(path.join(dir, "e.md"), "hello\n");
    const globbed = runCli(
      ["--job", "search", "--query", "hello", "--glob", "*.md"],
      { cwd: dir, env },
    );
    expect(globbed.status).toBe(0);
    expect(globbed.stdout).toMatch(/e\.md/);
    expect(globbed.stdout).not.toMatch(/a\.txt/);
  });

  it("unknown flags FALLBACK", () => {
    const r = runCli(["--job", "search", "--query", "x", "--wat"]);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe(FALLBACK + "\n");
  });
});

describe("runJob exec", () => {
  it("ok on a successful command", () => {
    const r = runJob({ job: "exec", query: "echo hi", cwd: root });
    expect(r.fallback).toBe(false);
    expect(r.text).toBe("1 line.\n- hi\n");
    expect(r.text.split("\n").filter(Boolean).length).toBeLessThanOrEqual(8);
  });

  it("fail on a nonzero command", () => {
    const r = runJob({ job: "exec", query: "false", cwd: root });
    expect(r.text).toMatch(/^Command failed\.\n/);
    expect(r.text.split("\n").filter(Boolean).length).toBeLessThanOrEqual(8);
  });

  it("empty on a silent success", () => {
    const r = runJob({ job: "exec", query: "true", cwd: root });
    expect(r.text).toBe("No output.\n");
  });

  it("FALLBACK on shell meta; --cwd + true ok", () => {
    const meta = runJob({ job: "exec", query: "cd && npm test", cwd: root });
    expect(meta.fallback).toBe(true);
    expect(meta.text).toBe(FALLBACK + "\n");
    expect(meta.code).toBe(2);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grunt-job-cwd-"));
    tmpDirs.push(dir);
    const cli = runCli(["--job", "exec", "--query", "true", "--cwd", "."], { cwd: dir });
    expect(cli.status).toBe(0);
    expect(cli.stdout).toBe("No output.\n");
    const escape = runCli(["--job", "exec", "--query", "true", "--cwd", ".."], { cwd: dir });
    expect(escape.status).toBe(2);
    expect(escape.stdout).toBe(FALLBACK + "\n");
  });
});

describe("runJob test", () => {
  it("ok on a bounded successful command", () => {
    const r = runJob({ job: "test", query: "echo hi", cwd: root });
    expect(r.fallback).toBe(false);
    expect(r.text).toBe("1 line.\n- hi\n");
  });

  it("fail on a nonzero command", () => {
    const r = runJob({ job: "test", query: "false", cwd: root });
    expect(r.fallback).toBe(false);
    expect(r.text).toMatch(/^Command failed\.\n/);
  });

  it("FALLBACK on denylist query", () => {
    const r = runJob({ job: "test", query: "npm test node_modules", cwd: root });
    expect(r.fallback).toBe(true);
    expect(r.text).toBe(FALLBACK + "\n");
    expect(r.code).toBe(2);
  });
});

describe("FALLBACK", () => {
  it("CLI exits 2 and prints FALLBACK for denylist and html", () => {
    const a = runCli(["--job", "search", "--query", "foo node_modules"]);
    expect(a.status).toBe(2);
    expect(a.stdout).toBe(FALLBACK + "\n");
    const b = runCli(["--job", "exec", "--query", "printf '<html>x</html>'"]);
    expect(b.status).toBe(2);
    expect(b.stdout).toBe(FALLBACK + "\n");
    const c = runCli(["--job", "web", "--query", "https://example.com"]);
    expect(c.status).toBe(2);
    expect(c.stdout).toBe(FALLBACK + "\n");
  });
});

describe("squeezLines", () => {
  it("keeps FAIL+stack over pass dots", () => {
    const lines = [
      ...Array.from({ length: 400 }, (_, i) => `PASS test ${i}`),
      "FAIL boom",
      "    at Object.<anonymous> (x.js:1:1)",
    ];
    const shown = squeezLines(lines, "test");
    expect(shown.length).toBeLessThanOrEqual(6);
    expect(shown.some((l) => l.includes("FAIL"))).toBe(true);
    expect(shown.some((l) => l.includes("at Object"))).toBe(true);
  });

  it("keeps an exact-query hit after the first 6", () => {
    const lines = [
      "aaa",
      "bbb",
      "ccc",
      "ddd",
      "eee",
      "fff",
      "needle lives here",
    ];
    const shown = squeezLines(lines, "needle");
    expect(shown.some((l) => l.includes("needle"))).toBe(true);
  });
});

describe("stash and slice", () => {
  it("n=3 search does not stash", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grunt-job-n3-"));
    tmpDirs.push(dir);
    fs.writeFileSync(path.join(dir, "a.txt"), "alpha\n");
    fs.writeFileSync(path.join(dir, "b.txt"), "alpha\n");
    fs.writeFileSync(path.join(dir, "c.txt"), "alpha\n");
    const r = runJob({ job: "search", query: "alpha", cwd: dir });
    expect(r.fallback).toBe(false);
    expect(r.text).toMatch(/^3 matches\.\n/);
    expect(r.text).not.toMatch(/stash=/);
    expect(fs.existsSync(path.join(dir, ".tmp", "grunt", "stash"))).toBe(false);
  });

  it("n>6 search stashes and shows 6", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grunt-job-n20-"));
    tmpDirs.push(dir);
    const body = Array.from({ length: 20 }, (_, i) => `token-${i} hit`).join("\n");
    fs.writeFileSync(path.join(dir, "big.txt"), body + "\n");
    const r = runJob({ job: "search", query: "hit", cwd: dir });
    expect(r.fallback).toBe(false);
    expect(r.text).toMatch(/^\d+ matches, 6 shown\. stash=\.tmp\/grunt\/stash\//);
    expect(r.text.split("\n").filter(Boolean).length).toBeLessThanOrEqual(8);
    const m = r.text.match(/stash=(\.tmp\/grunt\/stash\/\S+)/);
    expect(m).toBeTruthy();
    const stashAbs = path.join(dir, m![1]);
    expect(fs.existsSync(stashAbs)).toBe(true);
    const n = Number(r.text.match(/^(\d+) matches/)?.[1]);
    const stashLines = fs.readFileSync(stashAbs, "utf8").split("\n").filter(Boolean);
    expect(stashLines.length).toBe(n);
  });

  it("slice from/to and path filter", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grunt-job-slice-"));
    tmpDirs.push(dir);
    const stashDir = path.join(dir, ".tmp", "grunt", "stash");
    fs.mkdirSync(stashDir, { recursive: true });
    const lines = Array.from({ length: 30 }, (_, i) =>
      i === 10 ? `AgentChatInterface line ${i + 1}` : `row ${i + 1}`,
    );
    fs.writeFileSync(path.join(stashDir, "search-g7k.txt"), lines.join("\n") + "\n");
    const ranged = runJob({
      job: "slice",
      query: "",
      stash: "g7k",
      from: "9",
      to: "12",
      cwd: dir,
    });
    expect(ranged.fallback).toBe(false);
    expect(ranged.text).toMatch(/stash:9/);
    expect(ranged.text).toMatch(/stash:12/);
    const filtered = runJob({
      job: "slice",
      query: "",
      stash: "g7k",
      path: "AgentChatInterface",
      cwd: dir,
    });
    expect(filtered.text).toMatch(/AgentChatInterface/);
    expect(filtered.text.split("\n").filter((l) => l.startsWith("- ")).length).toBe(1);
  });

  it("missing stash is failed facts not FALLBACK", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grunt-job-miss-"));
    tmpDirs.push(dir);
    const r = runJob({ job: "slice", stash: "nope", cwd: dir });
    expect(r.fallback).toBe(false);
    expect(r.text).toMatch(/^Command failed\.\n/);
    expect(r.text).toMatch(/missing stash/);
  });

  it("escape stash path is missing not dump", () => {
    const r = runJob({
      job: "slice",
      stash: "../../etc/passwd",
      cwd: root,
    });
    expect(r.fallback).toBe(false);
    expect(r.text).toMatch(/missing stash/);
  });
});

describe("exec stash vs FALLBACK", () => {
  it("stdout >32KB non-HTML stashes not FALLBACK", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grunt-job-big-"));
    tmpDirs.push(dir);
    fs.writeFileSync(
      path.join(dir, "print.js"),
      'process.stdout.write("x".repeat(40000)+"\\n")\n',
    );
    const r = runJob({
      job: "exec",
      query: "node print.js",
      cwd: dir,
    });
    expect(r.fallback).toBe(false);
    expect(r.text).toMatch(/stash=/);
    expect(r.text).not.toBe(FALLBACK + "\n");
  });
});

describe("resolveStashFile", () => {
  it("finds id stem under stash dir", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grunt-job-id-"));
    tmpDirs.push(dir);
    const stashDir = path.join(dir, ".tmp", "grunt", "stash");
    fs.mkdirSync(stashDir, { recursive: true });
    fs.writeFileSync(path.join(stashDir, "search-ab12.txt"), "hi\n");
    expect(resolveStashFile(dir, "ab12")).toBe(path.join(stashDir, "search-ab12.txt"));
  });
});

