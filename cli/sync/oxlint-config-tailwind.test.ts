import { expect, it } from "vitest";

import type { ResolvedLint } from "../config.ts";
import type { JsonObject } from "../json.ts";
import { oxlintConfig } from "./oxlint-config.ts";
import type { Workspace } from "./workspace.ts";

/** A single-package root that ships its lint plugin and the tailwind plugin, as this package does. */
const ROOT: Workspace = {
  manifest: {
    exports: { "./lint": "./cli/lint/index.ts", "./tailwind": "./cli/lint/tailwind-plugin.ts" },
    name: "app",
  },
  packages: [],
  root: "/repo",
};

const ENTRY: ResolvedLint = { skip: [], tailwind: { entryPoint: "src/app.css" } };
const REPO_PLUGIN = { name: "repo", specifier: "@workerstack/repo/lint" };

type Written = { jsPlugins: unknown; overrides: unknown[]; rules: JsonObject; settings?: unknown };

/** The config sync writes for `lint`, parsed; a refusal throws. */
function written(lint: ResolvedLint): Written {
  const built = oxlintConfig(ROOT, lint);

  if (!built.ok) throw new Error(built.errors.join("\n"));

  return JSON.parse(built.value) /* the config sync writes */ as Written;
}

function tailwindRules(config: Written): JsonObject {
  return Object.fromEntries(Object.entries(config.rules).filter(([rule]) => rule.startsWith("tailwindcss/")));
}

it("an entry adds the tailwindcss plugin through this package, its entry as settings and four rules at error", () => {
  const config = written(ENTRY);
  expect(config.jsPlugins).toStrictEqual([
    REPO_PLUGIN,
    { name: "tailwindcss", specifier: "@workerstack/repo/tailwind" },
  ]);
  expect(config.settings).toStrictEqual({ tailwindcss: { entryPoint: "src/app.css" } });
  expect(tailwindRules(config)).toStrictEqual({
    "tailwindcss/no-conflicting-classes": "error",
    "tailwindcss/no-duplicate-classes": "error",
    "tailwindcss/no-hardcoded-colors": "error",
    "tailwindcss/no-unknown-classes": "error",
  });
});

it("without an entry the config has no tailwindcss plugin, settings or rule", () => {
  const config = written({ skip: [] });
  expect(config.jsPlugins).toStrictEqual([REPO_PLUGIN]);
  expect(config).not.toHaveProperty("settings");
  expect(tailwindRules(config)).toStrictEqual({});
});

it("the plugin entries a package exports, ./lint and ./tailwind, may default-export and sit outside an index", () => {
  expect(written({ skip: [] }).overrides).toContainEqual({
    files: ["cli/lint/index.ts", "cli/lint/tailwind-plugin.ts"],
    rules: { "import/no-default-export": "off", "repo/index-file": "off" },
  });
});

it("a skip may name a tailwindcss rule only when an entry turns the rules on", () => {
  const skip = {
    files: ["src/legacy.tsx"],
    reason: "the old palette predates the theme",
    rules: ["tailwindcss/no-hardcoded-colors"],
  };

  expect(written({ ...ENTRY, skip: [skip] }).overrides.at(-1)).toStrictEqual({
    files: ["src/legacy.tsx"],
    rules: { "tailwindcss/no-hardcoded-colors": "off" },
  });
  expect(oxlintConfig(ROOT, { skip: [skip] })).toStrictEqual({
    errors: [
      'repo.config.ts: lint.skip[0].rules: "tailwindcss/no-hardcoded-colors" ' +
        "is not a rule the generated config runs",
    ],
    ok: false,
  });
});
