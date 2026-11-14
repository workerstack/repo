import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { removeTemps } from "../__fixtures__/remove-temps.ts";
import { checkLintSkipsAt } from "./lint-skips.ts";

const temps: string[] = [];

afterEach(() => {
  removeTemps(temps.splice(0));
});

it("checkLintSkipsAt hands a readable workspace to the skip check, which reports nothing with no skip", async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-skips-at-")));
  temps.push(root);
  fs.writeFileSync(path.join(root, "repo.config.ts"), 'export default { packs: ["standards"] };\n');
  fs.writeFileSync(path.join(root, "package.json"), '{ "name": "app", "type": "module" }\n');
  expect(await checkLintSkipsAt(root, [])).toStrictEqual({ problems: [], report: [] });
});
