import { afterEach, expect, it, vi } from "vitest";

import { cleanTemps, git, tempDir, write } from "./fixtures/turn-repo.ts";
import { checkLintSkips } from "./lint-skips.ts";
import { captureTool } from "./lint.ts";

afterEach(cleanTemps);

const IMPORT = '@import "tailwindcss";\n';
const SKIP = { files: ["src/a.ts"], reason: "the lookup result is always present", rules: ["eslint/max-params"] };

it("checkLintSkips returns sync's error for two tailwind entries and no entryPoint, and lints nothing", () => {
  const root = tempDir("workerstack-skips-tailwind-");
  git(root, "init", "-q");
  write(root, {
    "package.json": '{ "name": "app", "type": "module" }\n',
    "src/a.ts": "export const a = 1;\n",
    "src/admin.css": IMPORT,
    "src/app.css": IMPORT,
  });
  const run = vi.fn<typeof captureTool>(captureTool);
  const workspace = { manifest: { name: "app" }, packages: [], root };
  expect(checkLintSkips(workspace, { skip: [SKIP] }, { run, scripts: [] })).toStrictEqual({
    problems: [
      "workerstack.config.ts: lint.tailwind.entryPoint: two sheets import tailwindcss (src/admin.css, src/app.css); " +
        "set the one oxlint checks classes against",
    ],
    report: [],
  });
  expect(run).not.toHaveBeenCalled();
});
