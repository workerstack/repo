import { expect, it } from "vitest";

import type { ResolvedLint } from "../config.ts";
import { contentOf, context } from "./__fixtures__/standards-kit.ts";
import { oxlintConfig } from "./oxlint-config.ts";
import { standards } from "./standards.ts";
import type { Workspace } from "./workspace.ts";

const ROOT: Workspace = { manifest: { name: "app" }, packages: [], root: "/repo" };
const REPO_PLUGIN = { name: "repo", specifier: "@workerstack/repo/lint" };
const APP_PLUGIN = { name: "app", specifier: "./lint/app.js" };
const PLUGINS = { app: "lint/app.js" };

/** The `.oxlintrc.jsonc` the standards pass plans for `lint`. */
function configFor(lint: ResolvedLint) {
  const { outputs } = standards(context(["standards"], "app", lint), []);

  return contentOf(outputs, ".oxlintrc.jsonc") /* the standards pass writes this config */ as {
    jsPlugins: unknown;
    overrides: unknown[];
    rules: Record<string, string | readonly unknown[]>;
  };
}

it("loads a consumer plugin from its file beside the config, after the repo and tailwindcss plugins", () => {
  expect(configFor({ plugins: PLUGINS, rules: [], skip: [] }).jsPlugins).toStrictEqual([REPO_PLUGIN, APP_PLUGIN]);

  const tailwind = { entryPoint: "src/app.css", vars: [] };

  expect(configFor({ plugins: PLUGINS, rules: [], skip: [], tailwind }).jsPlugins).toStrictEqual([
    REPO_PLUGIN,
    { name: "tailwindcss", specifier: "@workerstack/repo/tailwind" },
    APP_PLUGIN,
  ]);
});

it("puts a rules entry with no files in the top-level rules, options as written", () => {
  const rules = { "app/max-y": ["error", { max: 3 }], "app/no-x": "error" } as const;

  expect(configFor({ plugins: PLUGINS, rules: [{ rules }], skip: [] }).rules).toMatchObject(rules);
});

it("writes a rules entry with files as an override after the package ones and before the skips", () => {
  const skip = { files: ["src/legacy.ts"], reason: "predates the rule", rules: ["app/no-x"] };
  const rules = { "app/no-x": ["error", { deep: true }] } as const;
  const config = configFor({ plugins: PLUGINS, rules: [{ files: ["src/**"], rules }], skip: [skip] });

  expect(config.rules).not.toHaveProperty("app/no-x");
  expect(config.overrides.slice(-2)).toStrictEqual([
    { files: ["src/**"], rules },
    { files: ["src/legacy.ts"], rules: { "app/no-x": "off" } },
  ]);
});

it("lets each plugin file default-export and be an index file, as oxlint loads it, before the rules overrides", () => {
  const rules = { "app/no-x": "error" } as const;
  const config = configFor({ plugins: PLUGINS, rules: [{ files: ["src/**"], rules }], skip: [] });

  expect(config.overrides.slice(-2)).toStrictEqual([
    { files: ["lint/app.js"], rules: { "import/no-default-export": "off", "repo/index-file": "off" } },
    { files: ["src/**"], rules },
  ]);
});

function lintSkipping(rule: string): ResolvedLint {
  return {
    plugins: PLUGINS,
    rules: [{ rules: { "app/no-x": "error" } }],
    skip: [{ files: ["src/a.ts"], reason: "a reason", rules: [rule] }],
  };
}

it("accepts a skip of a rule an entry turns on and refuses one no entry turns on", () => {
  expect(oxlintConfig(ROOT, lintSkipping("app/no-x")).ok).toBe(true);
  expect(oxlintConfig(ROOT, lintSkipping("app/other"))).toStrictEqual({
    errors: ['repo.config.ts: lint.skip[0].rules: "app/other" is not a rule the generated config runs'],
    ok: false,
  });
});
