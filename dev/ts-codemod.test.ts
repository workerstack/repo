import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import ts from "typescript";
import { annotatePass, movePass, renamePass, runtimePass } from "./ts-codemod.ts";

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const A_SRC = `#!/usr/bin/env node
import { shout } from "./b.mjs";

/**
 * @typedef {object} Opts
 * @property {string} name
 * @property {number} [count]
 */

/**
 * @param {string} name
 * @param {Opts} opts
 * @returns {string}
 */
export function greet(name, opts) {
  return shout(name) + opts.name;
}
`;

const B_SRC = `/**
 * @param {string} s
 * @returns {string}
 */
export function shout(s) {
  return s.toUpperCase();
}
`;

const FILES: Record<string, string> = {
  ".rulesync/scripts/a.mjs": A_SRC,
  ".rulesync/scripts/b.mjs": B_SRC,
  "README.md":
    "Run `node .rulesync/scripts/a.mjs` and see vitest.config.mjs.\nGlobs: dist/*.js and '*.mjs' stay, `.rulesync/scripts/a*.mjs` changes.\nAlso `node ./.rulesync/scripts/b.mjs`.\n",
  ".claude/settings.json": '{ "command": "node \\"$d/.rulesync/scripts/a.mjs\\"" }\n',
  ".rulesync/scripts/a.test.ts":
    "expect(cmd).toMatch(/a\\.mjs --x/);\nexpect(imp).toBe('./b.mjs');\nexpect(msg).toMatch(/run bun .*b\\.mjs index/);\n",
  ".repo/lessons/some.md": '---\npaths: [".rulesync/scripts/a.mjs", ".rulesync/scripts/a*.mjs"]\n---\nbody\n',
  "vitest.config.mjs": "export default {};\n",
  "CHANGELOG.md": "old a.mjs path\n",
  "bun.lock": "a.mjs\n",
  "blob.bin": "a.mjs\0binary",
};

function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ts-codemod-"));
  tmpDirs.push(root);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "T");
  git("config", "commit.gpgsign", "false");
  for (const [rel, text] of Object.entries(FILES)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
  }
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  return root;
}

const read = (root: string, rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

describe("runtimePass", () => {
  it("switches node to bun on rename-set scripts only, then changes nothing", () => {
    const root = fixture();
    const res = runtimePass(root);
    expect(res.changed.sort()).toEqual([".claude/settings.json", ".rulesync/scripts/a.mjs", "README.md"].sort());
    expect(read(root, "README.md")).toContain("`bun .rulesync/scripts/a.mjs`");
    expect(read(root, "README.md")).toContain("`bun ./.rulesync/scripts/b.mjs`");
    expect(read(root, ".claude/settings.json")).toContain('bun \\"$d/.rulesync/scripts/a.mjs\\"');
    expect(read(root, ".rulesync/scripts/a.mjs").startsWith("#!/usr/bin/env bun\n")).toBe(true);
    expect(read(root, "CHANGELOG.md")).toBe(FILES["CHANGELOG.md"]);
    expect(runtimePass(root).changed).toEqual([]);
  });
});

describe("renamePass", () => {
  it("renames, rewrites every spelling, converts JSDoc to types and is idempotent", () => {
    const root = fixture();
    runtimePass(root);
    const res = renamePass(root);

    expect(fs.existsSync(path.join(root, ".rulesync/scripts/a.mjs"))).toBe(false);
    expect(res.changed).toContain(".rulesync/scripts/a.ts");
    expect(res.changed).toContain(".rulesync/scripts/b.ts");
    expect(res.changed).toContain("README.md");
    expect(res.changed).not.toContain("vitest.config.mjs");
    expect(res.changed).not.toContain("CHANGELOG.md");
    expect(execFileSync("git", ["ls-files", ".rulesync/scripts"], { cwd: root, encoding: "utf8" })).toContain("a.ts");

    const a = read(root, ".rulesync/scripts/a.ts");
    expect(a.startsWith("#!/usr/bin/env bun\n")).toBe(true);
    expect(a).toContain('from "./b.ts"');
    expect(a).toMatch(/\b(type|interface) Opts\b/);
    expect(a).not.toContain("@typedef");
    expect(a).toMatch(/name: string/);
    expect(a).toMatch(/opts: Opts/);
    expect(a).not.toMatch(/@param \{/);
    expect(a).not.toMatch(/@returns \{/);
    expect(read(root, ".rulesync/scripts/b.ts")).toMatch(/shout\(s: string\): string/);

    expect(read(root, "README.md")).toContain("`bun .rulesync/scripts/a.ts`");
    expect(read(root, "README.md")).toContain("vitest.config.mjs");
    expect(read(root, "README.md")).toContain("dist/*.js and '*.mjs' stay, `.rulesync/scripts/a*.ts` changes.");
    expect(read(root, ".claude/settings.json")).toContain('bun \\"$d/.rulesync/scripts/a.ts\\"');
    expect(read(root, ".rulesync/scripts/a.test.ts")).toContain("/a\\.ts --x/");
    expect(read(root, ".rulesync/scripts/a.test.ts")).toContain("'./b.ts'");
    expect(read(root, ".rulesync/scripts/a.test.ts")).toContain("/run bun .*b\\.ts index/");
    expect(read(root, ".repo/lessons/some.md")).toContain(
      'paths: [".rulesync/scripts/a.ts", ".rulesync/scripts/a*.ts"]',
    );
    expect(read(root, "vitest.config.mjs")).toBe(FILES["vitest.config.mjs"]);
    expect(read(root, "CHANGELOG.md")).toBe(FILES["CHANGELOG.md"]);
    expect(read(root, "bun.lock")).toBe(FILES["bun.lock"]);
    expect(read(root, "blob.bin")).toBe(FILES["blob.bin"]);

    expect(renamePass(root).changed).toEqual([]);
    expect(runtimePass(root).changed).toEqual([]);
  });

  it("leaves a glob alone when no rename-set name matches it", () => {
    const root = fixture();
    fs.writeFileSync(path.join(root, "notes.md"), "see zzz-*.mjs and q.mjs\n");
    execFileSync("git", ["add", "-A"], { cwd: root });
    renamePass(root);
    expect(read(root, "notes.md")).toBe("see zzz-*.mjs and q.mjs\n");
  });
});

describe("cli", () => {
  const cli = path.resolve(import.meta.dirname, "ts-codemod.ts");
  const run = (...args: string[]) => spawnSync("bun", [cli, ...args], { encoding: "utf8" });

  it("prints changed paths, then nothing to convert on a rerun", () => {
    const root = fixture();
    const first = run("rename", root);
    expect(first.status).toBe(0);
    expect(first.stdout).toContain(".rulesync/scripts/a.ts");
    const again = run("rename", root);
    expect(again.status).toBe(0);
    expect(again.stdout.trim()).toBe("nothing to convert");
    expect(run("runtime", root).stdout.trim()).toBe("nothing to convert");
  });

  it("runs the runtime pass and defaults the root to the git toplevel", () => {
    const root = fixture();
    const res = spawnSync("bun", [cli, "runtime"], { cwd: path.join(root, ".rulesync"), encoding: "utf8" });
    expect(res.stdout).toContain("README.md");
    expect(read(root, "README.md")).toContain("bun .rulesync/scripts/a.mjs");
  });

  it("rejects an unknown pass", () => {
    const res = run("bogus");
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("usage");
  });
});

const MOVE_FILES: Record<string, string> = {
  ".rulesync/rules/overview.md": "See [a](../../references/a.md) and `.rulesync/hooks.jsonc`.\n",
  ".rulesync/hooks.jsonc": "{}\n",
  ".rulesync/scripts/a.ts":
    'import { b } from "./b.ts";\nimport { c } from "../../cli/sync/c.ts";\n' +
    'const p = path.join(root, ".rulesync", "scripts", "a.ts");\nconst h = "../hooks.jsonc";\n' +
    String.raw`const link = "../../.agents/skills/ask";
const re = /\.rulesync\/global-settings\/x\.json/;
const src = ` +
    "`\\\\.rulesync/scripts/`;\n",
  ".rulesync/scripts/b.ts": "export const b = 1;\n",
  "cli/sync/c.ts":
    'import { b } from "../../.rulesync/scripts/b.ts";\nimport { o } from "../../.grok/hooks/orchestrate-parent.ts";\n' +
    'export const STOCK = "node_modules/@workerstack/repo/.rulesync/rules/";\nexport const LINK = "../../.agents/skills/ask";\n',
  ".grok/hooks/orchestrate-parent.ts": 'import { b } from "../../.rulesync/scripts/b.ts";\n',
  ".grok/hooks/rtk-grok.ts": "export {};\n",
  ".grok/hooks/rtk.json": "{}\n",
  ".grok/hooks/package.json": '{"type":"module"}\n',
  ".grok/roles/scout.toml": 'doc = "../../references/a.md"\n',
  ".grok/config.toml": "# Generated by emit-mcp-policy.ts from .rulesync/mcp-policy.jsonc.\n",
  ".agents/skills/ask/SKILL.md": "See [x](../principle-x/SKILL.md).\n",
  ".agents/skills/principle-x/SKILL.md": "x\n",
  "references/a.md":
    "Edit `.rulesync/rules/overview.md`, run `bun ./.rulesync/scripts/a.ts` and `.grok/hooks/rtk-grok.ts`.\n" +
    "Codex reads `.agents/skills/x`; grok reads `.grok/hooks/rtk.json` and `.grok/roles/scout.toml`.\n" +
    "Built from .rulesync/mcp-policy.jsonc.\n",
  "cli/sync/fixtures/consumer-stock/.rulesync/rules/overview.md": "stock\n",
  "cli/sync/fixtures/consumer-stock/.grok/roles/scout.toml": "model = 1\n",
  ".repo/lessons/l.md":
    '---\npaths: [".rulesync/scripts/a.ts", ".grok/hooks/rtk-grok.ts"]\n---\nSee `.rulesync/hooks.jsonc`.\n',
  "cli/sync/migrate.ts":
    'import { b } from "../../.rulesync/scripts/b.ts";\nconst COPIED = ".rulesync/scripts/workspace-root.ts";\n',
};

// Each names the old layout on purpose and must come out byte for byte.
const KEPT: Record<string, string> = {
  "CHANGELOG.md": "moved `.rulesync/scripts/` once\n",
  "cli/sync/stock-history.json": '{ ".rulesync/rules/overview.md": [] }\n',
  "cli/sync/stock-history.ts": 'const STOCK_PREFIXES = [".rulesync/rules/", ".agents/skills/"];\n',
  "cli/sync/migrate.test.ts": 'expect(out).toContain("moved .rulesync/rules/team.md");\n',
  "cli/init.ts": 'const OLD = ["bun ./.rulesync/scripts/doctor.ts"];\n',
  "cli/sync/fixtures/copied.README.md": "the copied `.rulesync/scripts/`\n",
  "cli/sync/fixtures/golden/.grok/config.toml": "# Generated by emit-mcp-policy.ts from .rulesync/mcp-policy.jsonc.\n",
  "dev/codemod-old.ts": 'const FROM = ".rulesync/scripts/";\n',
};

function moveFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ts-codemod-move-"));
  tmpDirs.push(root);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "T");
  git("config", "commit.gpgsign", "false");
  for (const [rel, text] of Object.entries({ ...MOVE_FILES, ...KEPT })) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  return root;
}

const tracked = (root: string) =>
  execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);

describe("movePass", () => {
  it("moves the stock sources and scripts, and deletes the grok hooks package.json", () => {
    const root = moveFixture();
    movePass(root);
    const files = tracked(root);
    for (const rel of [
      "agents/rules/overview.md",
      "agents/hooks.jsonc",
      "cli/scripts/a.ts",
      "cli/scripts/b.ts",
      "cli/scripts/orchestrate-parent.ts",
      "cli/scripts/rtk-grok.ts",
      "agents/grok/hooks/rtk.json",
      "agents/grok/roles/scout.toml",
      "agents/skills/ask/SKILL.md",
      "cli/sync/fixtures/consumer-stock/agents/rules/overview.md",
      "cli/sync/fixtures/consumer-stock/agents/grok/roles/scout.toml",
    ]) {
      expect(files, rel).toContain(rel);
    }
    expect(files.filter((f) => /^(\.rulesync|\.grok\/hooks|\.grok\/roles|\.agents)\//.test(f))).toEqual([]);
    expect(files).toContain(".grok/config.toml");
  });

  it("rewrites path strings, path segments and relative imports from each file's new place", () => {
    const root = moveFixture();
    movePass(root);
    expect(read(root, "agents/rules/overview.md")).toBe("See [a](../../references/a.md) and `agents/hooks.jsonc`.\n");
    expect(read(root, "cli/scripts/a.ts")).toBe(
      'import { b } from "./b.ts";\nimport { c } from "../sync/c.ts";\n' +
        'const p = path.join(root, "cli", "scripts", "a.ts");\nconst h = "../../agents/hooks.jsonc";\n' +
        String.raw`const link = "../../.agents/skills/ask";
const re = /agents\/global-settings\/x\.json/;
const src = ` +
        "`cli/scripts/`;\n",
    );
    expect(read(root, "cli/sync/c.ts")).toBe(
      'import { b } from "../scripts/b.ts";\nimport { o } from "../scripts/orchestrate-parent.ts";\n' +
        'export const STOCK = "node_modules/@workerstack/repo/agents/rules/";\nexport const LINK = "../../.agents/skills/ask";\n',
    );
    expect(read(root, "cli/scripts/orchestrate-parent.ts")).toBe('import { b } from "./b.ts";\n');
    // One level deeper: one more `../`.
    expect(read(root, "agents/grok/roles/scout.toml")).toBe('doc = "../../../references/a.md"\n');
    expect(read(root, "agents/skills/ask/SKILL.md")).toBe(MOVE_FILES[".agents/skills/ask/SKILL.md"]);
    expect(read(root, "references/a.md")).toBe(
      "Edit `agents/rules/overview.md`, run `bun ./cli/scripts/a.ts` and `cli/scripts/rtk-grok.ts`.\n" +
        "Codex reads `.agents/skills/x`; grok reads `.grok/hooks/rtk.json` and `.grok/roles/scout.toml`.\n" +
        "Built from agents/mcp-policy.jsonc.\n",
    );
    expect(read(root, ".grok/config.toml")).toBe(MOVE_FILES[".grok/config.toml"]);
    expect(read(root, ".repo/lessons/l.md")).toBe(
      '---\npaths: ["cli/scripts/a.ts", "cli/scripts/rtk-grok.ts"]\n---\nSee `agents/hooks.jsonc`.\n',
    );
  });

  it("leaves the kept files byte for byte, and moves only a kept file's imports", () => {
    const root = moveFixture();
    movePass(root);
    for (const [rel, text] of Object.entries(KEPT)) expect(read(root, rel), rel).toBe(text);
    expect(read(root, "cli/sync/migrate.ts")).toBe(
      'import { b } from "../scripts/b.ts";\nconst COPIED = ".rulesync/scripts/workspace-root.ts";\n',
    );
  });

  it("changes nothing on a second run", () => {
    const root = moveFixture();
    expect(movePass(root).changed.length).toBeGreaterThan(0);
    const before = tracked(root).map((rel) => [rel, read(root, rel)]);
    expect(movePass(root).changed).toEqual([]);
    expect(tracked(root).map((rel) => [rel, read(root, rel)])).toEqual(before);
  });

  it("is the cli default and prints nothing on a rerun", () => {
    const root = moveFixture();
    const cli = path.resolve(import.meta.dirname, "ts-codemod.ts");
    const first = spawnSync("bun", [cli], { cwd: root, encoding: "utf8" });
    expect(first.status).toBe(0);
    expect(first.stdout).toContain("cli/scripts/a.ts");
    const again = spawnSync("bun", [cli, "move", root], { encoding: "utf8" });
    expect(again.status).toBe(0);
    expect(again.stdout).toBe("");
  });
});

const STRICT_BASE = path.resolve(import.meta.dirname, "../tsconfig/strict.json");
const LOOSE_BASE = path.resolve(import.meta.dirname, "../tsconfig/base.json");
const UNANNOTATED = [
  "export const size = (s: string) => s.length;",
  "export function pair(a: number) {",
  "  return [a, a] as const;",
  "}",
  "export const upper = ['a', 'b'].map((n) => n.toUpperCase());",
  'export const pick = (n: number) => (n > 1 ? "many" : "one");',
  "",
].join("\n");
const TEST_FILE = "export const twice = (s: string) => s + s;\n";

/** A folder with a loose tsconfig.json and the strict tsconfig.src.json over its non-test sources. */
function annotateFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ts-codemod-annotate-"));
  tmpDirs.push(root);
  const files = {
    "tsconfig.json": JSON.stringify({ extends: LOOSE_BASE, include: ["src"] }),
    "tsconfig.src.json": JSON.stringify({ extends: ["./tsconfig.json", STRICT_BASE], exclude: ["**/*.test.ts"] }),
    "src/a.ts": UNANNOTATED,
    "src/a.test.ts": TEST_FILE,
  };
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return root;
}

/** What `tsc --noEmit -p tsconfig.src.json` would report in `root`, declaration diagnostics included. */
function strictErrors(root: string): string[] {
  const file = path.join(root, "tsconfig.src.json");
  const parsed = ts.getParsedCommandLineOfConfigFile(
    file,
    {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} },
  );
  const program = ts.createProgram({ rootNames: parsed?.fileNames ?? [], options: parsed?.options ?? {} });
  const found = ts.getPreEmitDiagnostics(program);
  return found.map((d) => `TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
}

it("annotatePass writes each export's inferred type, as narrow, and leaves the test file", () => {
  const root = annotateFixture();
  expect(strictErrors(root).map((line) => line.split(" ")[0])).toEqual([
    "TS9007",
    "TS9013",
    "TS9013",
    "TS9010",
    "TS9007",
  ]);
  expect(annotatePass(root)).toEqual({ changed: ["src/a.ts"], left: [] });
  const text = read(root, "src/a.ts");
  expect(text).toContain("export const size = (s: string): number => s.length;");
  expect(text).toContain("export function pair(a: number): readonly [number, number] {");
  expect(text).toContain("export const upper: string[] = ");
  expect(text).toContain('export const pick = (n: number): "many" | "one" => ');
  expect(read(root, "src/a.test.ts")).toBe(TEST_FILE);
  expect(strictErrors(root)).toEqual([]);
  expect(annotatePass(root)).toEqual({ changed: [], left: [] });
}, 30_000);

it("annotatePass names what the codefix leaves; the cli prints changed paths, then nothing to annotate", () => {
  const root = annotateFixture();
  fs.writeFileSync(path.join(root, "src/b.ts"), "export const K = class {\n  x = 1;\n};\n");
  const cli = path.resolve(import.meta.dirname, "ts-codemod.ts");
  const first = spawnSync("bun", [cli, "annotate", root], { encoding: "utf8" });
  expect(first.stdout).toBe("src/a.ts\n");
  expect(first.stderr).toMatch(/^left for hand fixes:\nsrc\/b\.ts\(1,18\): TS9022 /);
  expect(first.status).toBe(0);
  fs.rmSync(path.join(root, "src/b.ts"));
  const again = spawnSync("bun", [cli, "annotate", root], { encoding: "utf8" });
  expect(again.stdout).toBe("nothing to annotate\n");
}, 30_000);

it("annotatePass adds undefined to the optional properties of a type a caller passes undefined into", () => {
  const root = annotateFixture();
  fs.rmSync(path.join(root, "src/a.ts"));
  const caller = "export const g = (a: string | undefined): string => f({ a });\n";
  const callee = 'export function f(o: { a?: string; b?: number }): string {\n  return o.a ?? "";\n}\n';
  fs.writeFileSync(path.join(root, "src/c.ts"), callee + caller);
  expect(strictErrors(root).map((line) => line.split(" ")[0])).toEqual(["TS2379"]);
  expect(annotatePass(root)).toEqual({ changed: ["src/c.ts"], left: [] });
  const widened = callee.replace("a?: string; b?: number", "a?: string | undefined; b?: number | undefined");
  expect(read(root, "src/c.ts")).toBe(widened + caller);
  expect(strictErrors(root)).toEqual([]);
}, 30_000);
