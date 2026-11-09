import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { checkLintSkipsAt } from "./lint-skips.ts";

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

it("checkLintSkipsAt hands a readable workspace to the skip check, which has nothing to report with no skip", async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-skips-at-")));
  temps.push(root);
  fs.writeFileSync(path.join(root, "workerstack.config.ts"), 'export default { packs: ["standards"] };\n');
  fs.writeFileSync(path.join(root, "package.json"), '{ "name": "app", "type": "module" }\n');
  expect(await checkLintSkipsAt(root, [])).toEqual({ report: [], problems: [] });
});
