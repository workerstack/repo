import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse, type ParseError } from "jsonc-parser";
import { afterEach, describe, expect, it } from "vitest";
import { CONFIG_FILE, type Pack } from "../config.ts";
import { runSync } from "../sync.ts";
import type { Output, SyncContext } from "./outputs.ts";
import { standards } from "./standards.ts";

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function context(packs: Pack[], name = "app"): SyncContext {
  return {
    root: "/repo",
    config: { packs, agents: { hosts: [], skills: [] } },
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

const OFF = {
  correctness: "off",
  suspicious: "off",
  pedantic: "off",
  perf: "off",
  style: "off",
  restriction: "off",
  nursery: "off",
};
const SIZE = { skipBlankLines: true, skipComments: true };

describe("the standards pass", () => {
  it("writes the oxlint config: the chosen plugins, every category off, type-aware on, each named rule at error", () => {
    const { outputs, errors } = standards(context(["standards"]), []);
    expect(errors).toEqual([]);
    expect(contentOf(outputs, ".oxlintrc.json")).toEqual({
      plugins: ["eslint", "typescript", "unicorn", "oxc", "import", "vitest"],
      categories: OFF,
      options: { typeAware: true, respectEslintDisableDirectives: false },
      ignorePatterns: ["**/fixtures/**"],
      rules: {
        "eslint/max-lines": ["error", { max: 200, ...SIZE }],
        "eslint/max-lines-per-function": ["error", { max: 30, ...SIZE }],
        "eslint/max-params": ["error", { max: 3 }],
        "eslint/complexity": ["error", { max: 10 }],
        "eslint/max-depth": ["error", { max: 4 }],
        "eslint/no-shadow": "error",
        "eslint/no-else-return": "error",
        "eslint/no-nested-ternary": "error",
        "eslint/no-param-reassign": "error",
        "eslint/no-await-in-loop": "error",
        "eslint/require-await": "error",
        "eslint/no-console": "error",
        "import/no-cycle": "error",
        "import/no-default-export": "error",
        "typescript/no-explicit-any": "error",
        "typescript/no-non-null-assertion": "error",
        "typescript/no-floating-promises": "error",
        "typescript/no-unnecessary-condition": "error",
        "typescript/no-unsafe-argument": "error",
        "typescript/no-unsafe-assignment": "error",
        "typescript/switch-exhaustiveness-check": "error",
      },
      overrides: [
        {
          files: ["**/*.{test,spec}.{ts,tsx}"],
          rules: {
            "vitest/expect-expect": "error",
            "vitest/no-conditional-tests": "error",
            "vitest/no-focused-tests": "error",
            "vitest/no-disabled-tests": "error",
            "vitest/warn-todo": "error",
            "eslint/no-console": "off",
          },
        },
        { files: ["**/*.config.ts"], rules: { "import/no-default-export": "off" } },
      ],
    });
  });

  it("writes the oxfmt config: width 120, package.json left unsorted, no trailing commas in JSONC, markdown and fixtures ignored", () => {
    const { outputs } = standards(context(["standards"]), []);
    expect(contentOf(outputs, ".oxfmtrc.jsonc")).toEqual({
      printWidth: 120,
      sortPackageJson: false,
      overrides: [{ files: ["**/*.jsonc"], options: { trailingComma: "none" } }],
      ignorePatterns: [
        "**/*.md",
        "**/fixtures/**",
        "/.gitattributes",
        "/.gitignore",
        "/.oxfmtrc.jsonc",
        "/.oxlintrc.json",
        "/.vscode/settings.json",
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
        "/.gitignore",
        "/.oxfmtrc.jsonc",
        "/.oxlintrc.json",
        "/.vscode/settings.json",
        "/bunfig.toml",
        "/packages/api/references/INDEX.md",
      ],
    });
  });

  it("plans both configs as sync's own, untracked files, and nothing without the pack", () => {
    const shapes = standards(context(["standards"]), []).outputs.map(({ kind, path: rel, tracked, managed }) => ({
      kind,
      path: rel,
      tracked,
      managed,
    }));
    expect(shapes).toEqual([
      { kind: "file", path: ".oxlintrc.json", tracked: false, managed: "whole" },
      { kind: "file", path: ".oxfmtrc.jsonc", tracked: false, managed: "whole" },
    ]);
    expect(standards(context(["agents", "docs"]), [file("bunfig.toml", true)])).toEqual({ outputs: [], errors: [] });
  });
});

describe("repo sync with the standards pack", () => {
  function repo(packs: string): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-standards-"));
    temps.push(root);
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "app" }));
    fs.writeFileSync(path.join(root, CONFIG_FILE), `export default { packs: ${packs} }\n`);
    return root;
  }
  const sync = (root: string) => runSync([], { cwd: root, stdout: () => {}, stderr: () => {} }, { generators: [] });

  it("writes both configs and has git ignore them, then prunes them once the pack is dropped", async () => {
    const root = repo('["standards"]');
    expect(await sync(root)).toBe(0);
    expect(fs.existsSync(path.join(root, ".oxlintrc.json"))).toBe(true);
    expect(fs.existsSync(path.join(root, ".oxfmtrc.jsonc"))).toBe(true);
    expect(fs.readFileSync(path.join(root, ".gitignore"), "utf8").split("\n")).toEqual(
      expect.arrayContaining([".oxfmtrc.jsonc", ".oxlintrc.json"]),
    );

    fs.writeFileSync(path.join(root, CONFIG_FILE), "export default { packs: [] }\n");
    expect(await sync(root)).toBe(0);
    expect(fs.existsSync(path.join(root, ".oxlintrc.json"))).toBe(false);
    expect(fs.existsSync(path.join(root, ".oxfmtrc.jsonc"))).toBe(false);
    expect(fs.readFileSync(path.join(root, ".gitignore"), "utf8")).not.toContain(".ox");
  });
});
