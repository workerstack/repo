import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { CONFIG_FILE } from "../config.constants.ts";
import { runSync } from "../sync.ts";
import { context } from "./__fixtures__/standards-kit.ts";
import { tempDir, useTempDirs } from "./__fixtures__/temp-dirs.ts";
import { standards } from "./standards.ts";

useTempDirs();

/** The `.oxlintrc.jsonc` text the standards pass plans for a `lint.rules` entry of `setting`. */
function oxlintrc(setting: "error" | readonly ["error", number]): string | null {
  const lint = { plugins: { app: "lint/app.js" }, rules: [{ rules: { "app/no-x": setting } }], skip: [] };

  const found = standards(context(["standards"], "app", lint), []).outputs.find(
    (output) => output.path === ".oxlintrc.jsonc",
  );

  return found?.kind === "file" ? found.content : null;
}

it("plans a different .oxlintrc.jsonc for another lint.rules entry, which is what sync --check compares", () => {
  const first = oxlintrc("error");
  expect(first).toContain('"app/no-x": "error"');
  expect(oxlintrc(["error", 2])).not.toBe(first);
});

it("sync --check reports drift once a lint.rules entry changes, and passes after sync", async () => {
  const root = tempDir("workerstack-standards-plugins-");
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "app" }));
  fs.writeFileSync(path.join(root, CONFIG_FILE), 'export default { packs: ["standards"] }\n');

  function sync(args: string[]): Promise<number> {
    return runSync(args, { cwd: root, stderr: () => {}, stdout: () => {} }, { generators: [] });
  }

  expect(await sync([])).toBe(0);
  expect(await sync(["--check"])).toBe(0);

  const lint = '{ plugins: { app: "lint/app.js" }, rules: [{ rules: { "app/no-x": "error" } }] }';
  fs.mkdirSync(path.join(root, "lint"));
  fs.writeFileSync(
    path.join(root, "lint/app.js"),
    'export default { meta: { name: "app" }, rules: { "no-x": {} } };\n',
  );
  fs.writeFileSync(path.join(root, CONFIG_FILE), `export default { packs: ["standards"], lint: ${lint} }\n`);
  expect(await sync(["--check"])).toBe(1);
  expect(await sync([])).toBe(0);
  expect(fs.readFileSync(path.join(root, ".oxlintrc.jsonc"), "utf8")).toContain("app/no-x");
  expect(await sync(["--check"])).toBe(0);
});
