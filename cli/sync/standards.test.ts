import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { CONFIG_FILE } from "../config.constants.ts";
import { runSync } from "../sync.ts";
import { contentOf, context, file, link } from "./__fixtures__/standards-kit.ts";
import { tempDir, useTempDirs } from "./__fixtures__/temp-dirs.ts";
import { byCodeUnit } from "./by-code-unit.ts";
import { standards } from "./standards.ts";

useTempDirs();

/** What the oxfmt config ignores of a workspace that plans no output, sorted. */
const OWN_IGNORED = [
  "/.gitattributes",
  "/.githooks/commit-msg",
  "/.githooks/pre-commit",
  "/.githooks/pre-push",
  "/.gitignore",
  "/.oxfmtrc.jsonc",
  "/.oxlintrc.json",
  "/.vscode/settings.json",
  "/knip.json",
];

/** What the planned outputs of the trees test add to it. */
const PLANNED_IGNORED = [
  "/.claude/settings.json",
  "/.claude/skills/deploy",
  "/.codex/hooks.json",
  "/bunfig.toml",
  "/packages/api/references/INDEX.md",
];

/** The lines of the `.gitignore` sync wrote in `root`. */
function gitignoreLines(root: string): string[] {
  return fs.readFileSync(path.join(root, ".gitignore"), "utf8").split("\n");
}

it("writes the oxlint config of the workspace: the repo plugin, and a package bin's override", () => {
  const ctx = context(["standards"]);
  ctx.workspace.packages.push({ dir: "packages/cli", manifest: { bin: "./bin/cli.ts" } });
  const { outputs, errors } = standards(ctx, []);
  expect(errors).toStrictEqual([]);

  const config = contentOf(outputs, ".oxlintrc.json") /* the standards pass writes this config */ as {
    jsPlugins: unknown;
    overrides: unknown[];
  };

  expect(config.jsPlugins).toStrictEqual([{ name: "repo", specifier: "@workerstack/repo/lint" }]);
  expect(config.overrides).toContainEqual({
    files: ["packages/cli/bin/cli.ts"],
    rules: { "repo/no-module-side-effects": "off" },
  });
});

it("writes each lint.skip entry as the last override, and refuses a rule the config never runs with no output", () => {
  const reason = "the parsed config cache lives for the process";
  const live = { files: ["src/cache.ts"], reason, rules: ["repo/no-module-state"] };
  const { outputs, errors } = standards(context(["standards"], "app", { skip: [live] }), []);
  expect(errors).toStrictEqual([]);

  const config = contentOf(outputs, ".oxlintrc.json") /* the oxlint config always has overrides */ as {
    overrides: unknown[];
  };

  expect(config.overrides.at(-1)).toStrictEqual({ files: ["src/cache.ts"], rules: { "repo/no-module-state": "off" } });

  const typo = { ...live, rules: ["repo/no-modul-state"] };
  expect(standards(context(["standards"], "app", { skip: [typo] }), [])).toStrictEqual({
    errors: [
      'workerstack.config.ts: lint.skip[0].rules: "repo/no-modul-state" is not a rule the generated config runs',
    ],
    outputs: [],
  });
});

it(
  "writes the oxfmt config: width 120, package.json fields, imports and tailwind classes sorted (against " +
    "the entry sheet when there is one), no trailing commas in JSONC, markdown and fixtures ignored",
  () => {
    const { outputs } = standards(context(["standards"]), []);
    expect(contentOf(outputs, ".oxfmtrc.jsonc")).toStrictEqual({
      ignorePatterns: ["**/*.md", "**/__fixtures__/**", ...OWN_IGNORED],
      overrides: [{ files: ["**/*.jsonc"], options: { trailingComma: "none" } }],
      printWidth: 120,
      sortImports: {},
      sortPackageJson: true,
      sortTailwindcss: {},
    });
    const lint = { skip: [], tailwind: { entryPoint: "src/app.css" } };
    const sorted = standards(context(["standards"], "app", lint), []).outputs;
    expect(contentOf(sorted, ".oxfmtrc.jsonc")).toMatchObject({ sortTailwindcss: { stylesheet: "src/app.css" } });
  },
);

it(
  "has the oxfmt config ignore every planned output of a repo that commits its trees, tracked or not, " +
    "whole or block, anchored at the root",
  () => {
    const planned = [
      file("bunfig.toml", { tracked: true }),
      file(".claude/settings.json", { tracked: true }),
      file(".codex/hooks.json", { tracked: false }),
      file("packages/api/references/INDEX.md", { managed: "block", tracked: true }),
      link(".claude/skills/deploy", { tracked: true }),
    ];

    const { outputs } = standards(context(["agents", "standards"], "@workerstack/repo"), planned);
    expect(contentOf(outputs, ".oxfmtrc.jsonc")).toMatchObject({
      ignorePatterns: ["**/*.md", "**/__fixtures__/**", ...[...OWN_IGNORED, ...PLANNED_IGNORED].toSorted(byCodeUnit)],
    });
  },
);

it("plans both configs as sync's own, untracked files, the hooks as tracked ones, and nothing without the pack", () => {
  const planned = standards(context(["standards"]), []).outputs.map(({ kind, path: rel, tracked, managed }) => ({
    kind,
    managed,
    path: rel,
    tracked,
  }));

  expect(planned).toStrictEqual([
    { kind: "file", managed: "whole", path: ".oxlintrc.json", tracked: false },
    { kind: "file", managed: "whole", path: "knip.json", tracked: false },
    { kind: "file", managed: "whole", path: ".oxfmtrc.jsonc", tracked: false },
    { kind: "file", managed: "whole", path: ".githooks/commit-msg", tracked: true },
    { kind: "file", managed: "whole", path: ".githooks/pre-commit", tracked: true },
    { kind: "file", managed: "whole", path: ".githooks/pre-push", tracked: true },
  ]);
  expect(standards(context(["agents", "docs"]), [file("bunfig.toml", { tracked: true })])).toStrictEqual({
    errors: [],
    outputs: [],
  });
});

function repo(packs: string): string {
  const root = tempDir("workerstack-standards-");
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "app" }));
  fs.writeFileSync(path.join(root, CONFIG_FILE), `export default { packs: ${packs} }\n`);

  return root;
}

function sync(root: string) {
  return runSync([], { cwd: root, stderr: () => {}, stdout: () => {} }, { generators: [] });
}

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

  expect(gitignoreLines(root)).toStrictEqual(
    expect.arrayContaining([".oxfmtrc.jsonc", ".oxlintrc.json", ".oxlintrc.unskipped-*.json"]),
  );

  fs.writeFileSync(path.join(root, CONFIG_FILE), "export default { packs: [] }\n");
  expect(await sync(root)).toBe(0);
  expect(fs.existsSync(path.join(root, ".oxlintrc.json"))).toBe(false);
  expect(fs.existsSync(path.join(root, ".oxfmtrc.jsonc"))).toBe(false);
  expect(fs.existsSync(path.join(root, ".githooks"))).toBe(false);
  expect(fs.readFileSync(path.join(root, ".gitignore"), "utf8")).not.toContain(".ox");
});

it("writes knip.json with the knip.ignore entries, has git ignore it and its copies, then prunes it", async () => {
  const root = repo('["standards"]');
  const ignore = '{ ignore: [{ file: "src/old.ts", reason: "by name" }] }';
  const config = `export default { packs: ["standards"], knip: ${ignore} }\n`;
  fs.writeFileSync(path.join(root, CONFIG_FILE), config);
  expect(await sync(root)).toBe(0);
  expect(JSON.parse(fs.readFileSync(path.join(root, "knip.json"), "utf8"))).toMatchObject({
    workspaces: { ".": { ignoreFiles: ["src/old.ts"] } },
  });
  expect(gitignoreLines(root)).toStrictEqual(expect.arrayContaining(["knip.json", "knip.unignored-*.json"]));
  fs.writeFileSync(path.join(root, CONFIG_FILE), "export default { packs: [] }\n");
  expect(await sync(root)).toBe(0);
  expect(fs.existsSync(path.join(root, "knip.json"))).toBe(false);
});
