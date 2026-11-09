import { describe, expect, it } from "vitest";
import { reportsOf } from "../../dev/rule-harness.ts";
import { configFile } from "./config-file.ts";

const move = (what: string) => `a config file holds only imports and exports; move ${what} into a module it imports`;
const messagesOf = (code: string, file = "vite.config.ts") =>
  reportsOf(configFile, { [file]: code }).map((report) => report.message);

describe("config-file passes", () => {
  it.each([
    'import { defineConfig } from "vite";\nimport { plugins } from "./plugins.ts";\nexport default defineConfig({ plugins });',
    'export { plugins } from "./plugins.ts";\nexport * from "./shared.ts";\nexport default {};',
    'import { plugins } from "./plugins.ts";\nexport { plugins };\nexport default {};',
  ])("imports and exports with no declaration: %j", (code) => {
    expect(messagesOf(code)).toEqual([]);
  });

  it.each(["src/plugins.ts", "src/config.ts", "src/config-loader.ts"])("%s, which is no config file", (file) => {
    expect(messagesOf("export const plugins = [];", file)).toEqual([]);
  });
});

describe("config-file fails", () => {
  it.each([
    ["const plugins = [];\nexport default { plugins };", [move('"plugins"')]],
    ["export const plugins = [];\nexport default {};", [move('"plugins"')]],
    ["function plugins(): string[] {\n  return [];\n}\nexport default { plugins };", [move('"plugins"')]],
    ["type Options = {};\nexport default {};", [move('"Options"')]],
    ['console.log("loaded");\nexport default {};', [move("this")]],
  ])("%j", (code, messages) => {
    expect(messagesOf(code)).toEqual(messages);
  });

  it.each(["vitest.config.mts", "eslint.config.js", "tool.config.mjs", "workerstack.config.ts", "pkg/vite.config.ts"])(
    "a %s",
    (file) => {
      expect(messagesOf("const FULL = 1;\nexport default { FULL };", file)).toEqual([move('"FULL"')]);
    },
  );
});
