import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { LINT, refusal, repo, useConfigKit } from "./__fixtures__/config-kit.ts";
import { loadConfig } from "./config.ts";
import type { Json } from "./json.ts";

useConfigKit();

/** A standards config whose `lint` is `lint`, written as JSON. */
function lintConfig(lint: Json): string {
  return `export default { packs: ["standards"], lint: ${JSON.stringify(lint)} }\n`;
}

/** A plugin file at each of `files` under `root`, exporting the rules no-x and max-y. */
function plant(root: string, ...files: string[]): string {
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), PLUGIN_TEXT);
  }

  return root;
}

const PLUGIN_TEXT = `export default { meta: { name: "app" }, rules: { "no-x": {}, "max-y": {} } };\n`;

const PLUGINS: Json = { app: "lint/app.js" };

const RULES: Json = [
  { files: ["src/**"], rules: { "app/no-x": "error" } },
  { rules: { "app/max-y": ["error", { max: 3 }] } },
];

it("lint.plugins and lint.rules: Usage's config resolves as written", async () => {
  expect(await loadConfig(plant(repo(lintConfig({ plugins: PLUGINS, rules: RULES })), "lint/app.js"))).toMatchObject({
    config: { lint: { plugins: PLUGINS, rules: RULES, skip: [] } },
    ok: true,
  });
});

it("lint.plugins and lint.rules: default to none, and a plugin with no rules resolves", async () => {
  expect(await loadConfig(repo(lintConfig({})))).toMatchObject({ config: { lint: LINT }, ok: true });
  const root = plant(repo(lintConfig({ plugins: { "app-two": "a/b.mjs", x1: "./c.ts" } })), "a/b.mjs", "c.ts");
  expect(await loadConfig(root)).toMatchObject({
    config: { lint: { plugins: { "app-two": "a/b.mjs", x1: "c.ts" }, rules: [] } },
    ok: true,
  });
});

it("lint.plugins: stores a path without its leading ./", async () => {
  const root = plant(repo(lintConfig({ plugins: { app: "./lint/app.js" } })), "lint/app.js");
  expect(await loadConfig(root)).toMatchObject({
    config: { lint: { plugins: { app: "lint/app.js" } } },
    ok: true,
  });
});

it.each([
  "vitest",
  "eslint",
  "react-hooks",
  "import-x",
  "jsx-a11y",
  "repo",
  "tailwindcss",
  "stylelint",
  "clippy",
  "rust",
])("lint.plugins: refuses the stock name %s", async (name) => {
  expect(await loadConfig(repo(lintConfig({ plugins: { [name]: "lint/app.js" } })))).toStrictEqual(
    refusal(`lint.plugins.${name}: is a stock plugin name; pick another, like "app"`),
  );
});

it.each(["App", "my_app", "-app", "app-", "a--b", "1app", "@typescript-eslint", ""])(
  "lint.plugins: refuses the name %j",
  async (name) => {
    const kebab = `lint.plugins.${name}: must be a lowercase kebab-case name, like "app"`;
    const loaded = await loadConfig(repo(lintConfig({ plugins: { [name]: "lint/app.js" } })));
    expect(loaded).toStrictEqual(refusal(kebab));
  },
);

it.each(["../app.js", "lint/../../app.js", "/srv/app.js", "C:\\app.js", "lint/app.json", "lint/app", "", 7])(
  "lint.plugins.app: refuses the path %j",
  async (file) => {
    expect(await loadConfig(repo(lintConfig({ plugins: { app: file } })))).toStrictEqual(
      refusal('lint.plugins.app: must be a repo-relative path to a .js, .mjs or .ts file, like "lint/app.js"'),
    );
  },
);

it("lint.rules: refuses a rule of a plugin that is not registered", async () => {
  const lint = { plugins: PLUGINS, rules: [{ rules: { "other/x": "error" } }] };
  expect(await loadConfig(repo(lintConfig(lint)))).toStrictEqual(
    refusal('lint.rules[0].rules: "other/x" names no plugin in lint.plugins'),
  );
  const none = { rules: [{ rules: { "app/x": "error", nope: "error" } }] };
  expect(await loadConfig(repo(lintConfig(none)))).toStrictEqual(
    refusal(
      'lint.rules[0].rules: "app/x" names no plugin in lint.plugins',
      'lint.rules[0].rules: "nope" names no plugin in lint.plugins',
    ),
  );
});

it.each(["off", "warn", ["warn"], ["off", 1], [], 2, null])("lint.rules: refuses the setting %j", async (setting) => {
  const lint = { plugins: PLUGINS, rules: [{ rules: { "app/no-x": setting } }] };
  expect(await loadConfig(repo(lintConfig(lint)))).toStrictEqual(
    refusal('lint.rules[0].rules.app/no-x: must be "error" or ["error", options]; lint.skip turns rules off'),
  );
});

it("lint.rules: refuses an entry with no files or no rules, a bad list and an unknown key", async () => {
  const rules = { "app/no-x": "error" };
  expect(await loadConfig(repo(lintConfig({ plugins: PLUGINS, rules: [{ files: [], rules }] })))).toStrictEqual(
    refusal("lint.rules[0].files: list at least one file glob"),
  );
  expect(await loadConfig(repo(lintConfig({ plugins: PLUGINS, rules: [{ rules: {} }] })))).toStrictEqual(
    refusal('lint.rules[0].rules: list at least one rule like "app/no-x"'),
  );
  expect(await loadConfig(repo(lintConfig({ plugins: PLUGINS, rules: [{ reason: "x", rules }] })))).toStrictEqual(
    refusal('lint.rules[0]: unknown key "reason"'),
  );
  expect(await loadConfig(repo(lintConfig({ plugins: PLUGINS, rules: "app/no-x" })))).toStrictEqual(
    refusal("lint.rules: must be a list of { files, rules } entries"),
  );
  expect(await loadConfig(repo(lintConfig({ plugins: "app" })))).toStrictEqual(
    refusal('lint.plugins: must be an object like { app: "lint/app.js" }'),
  );
  expect(await loadConfig(repo(lintConfig({ plugins: PLUGINS, rules: [{ rules: "x" }] })))).toStrictEqual(
    refusal('lint.rules[0].rules: must be an object like { "app/no-x": "error" }'),
  );
});

it("lint.rules: refuses plugins and rules without the standards pack", async () => {
  const config = `export default { packs: ["docs"], lint: { plugins: { app: "lint/app.js" } } }\n`;
  expect(await loadConfig(repo(config))).toStrictEqual(
    refusal('lint: set only with the standards pack; add "standards" to packs or delete lint'),
  );
});

it("lint.plugins: a config with plugins runs the check, so an unexported rule is refused", async () => {
  const lint = { plugins: PLUGINS, rules: [{ rules: { "app/nope": "error" } }] };
  expect(await loadConfig(plant(repo(lintConfig(lint)), "lint/app.js"))).toStrictEqual(
    refusal('lint.rules[0].rules: "app/nope" is not a rule of lint/app.js; it has no-x, max-y'),
  );
  expect(await loadConfig(repo(lintConfig({ plugins: PLUGINS })))).toStrictEqual(
    refusal("lint.plugins.app: lint/app.js is no file"),
  );
});

it("lint.plugins: a config without plugins imports nothing", async () => {
  const root = repo(lintConfig({ skip: [] }));
  fs.writeFileSync(path.join(root, "side-effect.js"), `throw new Error("imported");\n`);
  expect(await loadConfig(root)).toMatchObject({ ok: true });
});
