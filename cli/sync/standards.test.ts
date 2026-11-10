import { BASE_CONFIG } from "../fixtures/base-config.ts";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse, type ParseError } from "jsonc-parser";
import { afterEach, describe, expect, it } from "vitest";
import { CONFIG_FILE, type LintSkip, type Pack } from "../config.ts";
import { runSync } from "../sync.ts";
import type { Output, SyncContext } from "./outputs.ts";
import { standards } from "./standards.ts";

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function context(packs: Pack[], name = "app", skip: readonly LintSkip[] = []): SyncContext {
  return {
    root: "/repo",
    config: {
      packs,
      agents: { hosts: [], skills: [] },
      ...BASE_CONFIG,
      lint: { skip },
    },
    workspace: { root: "/repo", manifest: { name }, packages: [] },
    read: () => null,
  };
}

const file = (rel: string, tracked: boolean, managed: Output["managed"] = "whole"): Output => ({
  kind: "file",
  path: rel,
  content: "x\n",
  tracked,
  managed,
});
const link = (rel: string, tracked: boolean): Output => ({
  kind: "link",
  path: rel,
  target: "../x",
  tracked,
  managed: "whole",
});

function contentOf(outputs: readonly Output[], rel: string): unknown {
  const found = outputs.find((output) => output.path === rel);
  if (found?.kind !== "file") throw new Error(`no file output ${rel}`);
  const errors: ParseError[] = [];
  const value: unknown = parse(found.content, errors, { allowTrailingComma: true });
  if (errors.length > 0) throw new Error(`${rel} does not parse`);
  return value;
}

describe("the standards pass", () => {
  it("writes the oxlint config of the workspace: the repo plugin, and a package bin's override", () => {
    const ctx = context(["standards"]);
    ctx.workspace.packages.push({ dir: "packages/cli", manifest: { bin: "./bin/cli.ts" } });
    const { outputs, errors } = standards(ctx, []);
    expect(errors).toEqual([]);
    const config = contentOf(outputs, ".oxlintrc.json") as { jsPlugins: unknown; overrides: unknown[] };
    expect(config.jsPlugins).toEqual([{ name: "repo", specifier: "@workerstack/repo/lint" }]);
    expect(config.overrides).toContainEqual({
      files: ["packages/cli/bin/cli.ts"],
      rules: { "repo/no-module-side-effects": "off" },
    });
  });

  it("writes each lint.skip entry as the last override, and refuses a rule the config never runs with no output", () => {
    const reason = "the parsed config cache lives for the process";
    const live = { files: ["src/cache.ts"], rules: ["repo/no-module-state"], reason };
    const { outputs, errors } = standards(context(["standards"], "app", [live]), []);
    expect(errors).toEqual([]);
    const config = contentOf(outputs, ".oxlintrc.json") /* the oxlint config always has overrides */ as {
      overrides: unknown[];
    };
    expect(config.overrides.at(-1)).toEqual({ files: ["src/cache.ts"], rules: { "repo/no-module-state": "off" } });

    const typo = { ...live, rules: ["repo/no-modul-state"] };
    expect(standards(context(["standards"], "app", [typo]), [])).toEqual({
      outputs: [],
      errors: [
        'workerstack.config.ts: lint.skip[0].rules: "repo/no-modul-state" is not a rule the generated config runs',
      ],
    });
  });

  it("writes the oxfmt config: width 120, package.json fields sorted, no trailing commas in JSONC, markdown and fixtures ignored", () => {
    const { outputs } = standards(context(["standards"]), []);
    expect(contentOf(outputs, ".oxfmtrc.jsonc")).toEqual({
      printWidth: 120,
      sortPackageJson: true,
      overrides: [{ files: ["**/*.jsonc"], options: { trailingComma: "none" } }],
      ignorePatterns: [
        "**/*.md",
        "**/fixtures/**",
        "/.gitattributes",
        "/.githooks/commit-msg",
        "/.githooks/pre-commit",
        "/.githooks/pre-push",
        "/.gitignore",
        "/.oxfmtrc.jsonc",
        "/.oxlintrc.json",
        "/.vscode/settings.json",
        "/knip.json",
      ],
    });
  });

  it("has oxfmt ignore every planned output of a repo that commits its trees, tracked or not, whole or block, anchored at the root", () => {
    const planned = [
      file("bunfig.toml", true),
      file(".claude/settings.json", true),
      file(".codex/hooks.json", false),
      file("packages/api/references/INDEX.md", true, "block"),
      link(".claude/skills/deploy", true),
    ];
    const { outputs } = standards(context(["agents", "standards"], "@workerstack/repo"), planned);
    expect(contentOf(outputs, ".oxfmtrc.jsonc")).toMatchObject({
      ignorePatterns: [
        "**/*.md",
        "**/fixtures/**",
        "/.claude/settings.json",
        "/.claude/skills/deploy",
        "/.codex/hooks.json",
        "/.gitattributes",
        "/.githooks/commit-msg",
        "/.githooks/pre-commit",
        "/.githooks/pre-push",
        "/.gitignore",
        "/.oxfmtrc.jsonc",
        "/.oxlintrc.json",
        "/.vscode/settings.json",
        "/bunfig.toml",
        "/knip.json",
        "/packages/api/references/INDEX.md",
      ],
    });
  });

  it("plans both configs as sync's own, untracked files, the hooks as tracked ones, and nothing without the pack", () => {
    const shapes = standards(context(["standards"]), []).outputs.map(({ kind, path: rel, tracked, managed }) => ({
      kind,
      path: rel,
      tracked,
      managed,
    }));
    expect(shapes).toEqual([
      { kind: "file", path: ".oxlintrc.json", tracked: false, managed: "whole" },
      { kind: "file", path: "knip.json", tracked: false, managed: "whole" },
      { kind: "file", path: ".oxfmtrc.jsonc", tracked: false, managed: "whole" },
      { kind: "file", path: ".githooks/commit-msg", tracked: true, managed: "whole" },
      { kind: "file", path: ".githooks/pre-commit", tracked: true, managed: "whole" },
      { kind: "file", path: ".githooks/pre-push", tracked: true, managed: "whole" },
    ]);
    expect(standards(context(["agents", "docs"]), [file("bunfig.toml", true)])).toEqual({ outputs: [], errors: [] });
  });
});

function repo(packs: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-standards-"));
  temps.push(root);
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "app" }));
  fs.writeFileSync(path.join(root, CONFIG_FILE), `export default { packs: ${packs} }\n`);
  return root;
}
const sync = (root: string) => runSync([], { cwd: root, stdout: () => {}, stderr: () => {} }, { generators: [] });

describe("repo sync with the standards pack", () => {
  it("writes both configs and has git ignore them, then prunes them once the pack is dropped", async () => {
    const root = repo('["standards"]');
    expect(await sync(root)).toBe(0);
    expect(fs.existsSync(path.join(root, ".oxlintrc.json"))).toBe(true);
    expect(fs.existsSync(path.join(root, ".oxfmtrc.jsonc"))).toBe(true);
    for (const hook of ["pre-commit", "commit-msg", "pre-push"]) {
      expect(fs.statSync(path.join(root, ".githooks", hook)).mode & 0o777).toBe(
        process.platform === "win32" ? 0o444 : 0o555,
      ); // read-only, and no execute bits on win32
    }
    expect(fs.readFileSync(path.join(root, ".gitignore"), "utf8").split("\n")).toEqual(
      expect.arrayContaining([".oxfmtrc.jsonc", ".oxlintrc.json", ".oxlintrc.unskipped-*.json"]),
    );

    fs.writeFileSync(path.join(root, CONFIG_FILE), "export default { packs: [] }\n");
    expect(await sync(root)).toBe(0);
    expect(fs.existsSync(path.join(root, ".oxlintrc.json"))).toBe(false);
    expect(fs.existsSync(path.join(root, ".oxfmtrc.jsonc"))).toBe(false);
    expect(fs.existsSync(path.join(root, ".githooks"))).toBe(false);
    expect(fs.readFileSync(path.join(root, ".gitignore"), "utf8")).not.toContain(".ox");
  });
});

describe("repo sync with the standards pack and knip", () => {
  it("writes knip.json with the knip.ignore entries and has git ignore it and its one-run copies, then prunes it", async () => {
    const root = repo('["standards"]');
    const config = `export default { packs: ["standards"], knip: { ignore: [{ file: "src/old.ts", reason: "by name" }] } }\n`;
    fs.writeFileSync(path.join(root, CONFIG_FILE), config);
    expect(await sync(root)).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(root, "knip.json"), "utf8"))).toMatchObject({
      workspaces: { ".": { ignoreFiles: ["src/old.ts"] } },
    });
    expect(fs.readFileSync(path.join(root, ".gitignore"), "utf8").split("\n")).toEqual(
      expect.arrayContaining(["knip.json", "knip.unignored-*.json"]),
    );
    fs.writeFileSync(path.join(root, CONFIG_FILE), "export default { packs: [] }\n");
    expect(await sync(root)).toBe(0);
    expect(fs.existsSync(path.join(root, "knip.json"))).toBe(false);
  });
});
