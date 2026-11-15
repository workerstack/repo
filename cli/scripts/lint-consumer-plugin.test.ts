import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import type { ResolvedLint } from "../config.ts";
import { OXLINT_CONFIG_PATH, oxlintConfig } from "../sync/oxlint-config.ts";
import { cleanTemps, consumer, SLOW } from "./__fixtures__/baseline-repo.ts";
import { BASELINE_PATH } from "./lint-baseline.constants.ts";
import { checkLintBaseline } from "./lint-baseline.ts";
import { captureTool } from "./lint.ts";

afterEach(cleanTemps);

/** A plain ESM plugin of one rule, which reports each identifier named `forbidden`. */
const APP_PLUGIN = `export default {
  meta: { name: "app" },
  rules: {
    "no-x": {
      create(context) {
        return {
          Identifier(node) {
            if (node.name === "forbidden") context.report({ message: "no forbidden", node });
          },
        };
      },
    },
  },
};
`;

const CODE = "app(no-x)";
const HIT = "src/forbidden.ts";
const ON: ResolvedLint = { plugins: { app: "lint/app.js" }, rules: [{ rules: { "app/no-x": "error" } }], skip: [] };

type Report = { diagnostics: { filename: string; code: string; message: string }[] };

/** A consumer with the plugin at each `lint.plugins` file and one hit, its oxlint config written for `lint`. */
function planted(lint: ResolvedLint, files: Record<string, string> = {}): string {
  const plugins = Object.fromEntries(Object.values(lint.plugins).map((file) => [file, APP_PLUGIN]));
  const root = consumer({ [HIT]: "export const forbidden = 1;\n", ...plugins, ...files });
  const built = oxlintConfig({ manifest: { name: "app" }, packages: [], root }, lint);

  if (!built.ok) throw new Error(built.errors.join("\n"));
  fs.writeFileSync(path.join(root, OXLINT_CONFIG_PATH), built.value);

  return root;
}

/** The hits oxlint reports in `root` with one of `codes`, as `file message`. */
async function hits(root: string, codes = [CODE]): Promise<string[]> {
  const run = await captureTool("oxlint", ["-f", "json"], { root });
  const report = JSON.parse(run.stdout) /* oxlint's json format has this shape */ as Report;

  return report.diagnostics.filter((d) => codes.includes(d.code)).map((d) => `${d.filename} ${d.message}`);
}

it(
  "runs a consumer plugin's rule from lint.plugins and lint.rules, and a lint.skip turns it off",
  { timeout: SLOW },
  async () => {
    expect(await hits(planted(ON))).toStrictEqual([`${HIT} no forbidden`]);

    const skip = { files: [HIT], reason: "the legacy name stays", rules: ["app/no-x"] };
    expect(await hits(planted({ ...ON, skip: [skip] }))).toStrictEqual([]);
  },
);

it("lets the plugin file default-export as oxlint needs, in an index file too", { timeout: SLOW }, async () => {
  const root = planted({ ...ON, plugins: { app: "lint/index.js" } });

  expect(await hits(root, ["import(no-default-export)", "repo(index-file)", CODE])).toStrictEqual([
    `${HIT} no forbidden`,
  ]);
});

it("the baseline check counts the consumer rule's hit under its code", { timeout: SLOW }, async () => {
  const baseline = `${JSON.stringify({ [HIT]: { [CODE]: 1 } })}\n`;
  const root = planted(ON, { [BASELINE_PATH]: baseline });

  async function lines(): Promise<string[]> {
    const found = await checkLintBaseline(root, []);

    return found.filter((line) => line.includes(HIT));
  }

  expect(await lines()).toStrictEqual([]);
  fs.writeFileSync(path.join(root, BASELINE_PATH), "{}\n");
  expect(await lines()).toStrictEqual([`${BASELINE_PATH}: ${HIT} has 1 ${CODE}, the baseline allows 0`]);
});
