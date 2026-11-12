import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { knipRoot, removeKnipRoots } from "./__fixtures__/knip-run.ts";
import { checkKnipAt } from "./knip-check.ts";

afterEach(removeKnipRoots);

const SLOW = 120_000;
const INSTALL = path.join(import.meta.dirname, "..", "node_modules");

it(
  "runs the real knip on a planted repo: an unused export and dependency fail, an ignore reports",
  {
    timeout: SLOW,
  },
  async () => {
    const files = {
      "src/index.ts": 'import { used } from "./lib.ts";\nconsole.log(used);\n',
      "src/lib.ts": "export const used = 1;\nexport const unused = 2;\n",
      "src/old.ts": "export const old = 1;\n",
    };

    const ws = knipRoot(files, { "left-pad": "1.0.0" });
    fs.symlinkSync(INSTALL, path.join(ws.root, "node_modules"), "junction");
    fs.writeFileSync(path.join(ws.root, "package.json"), JSON.stringify({ ...ws.manifest, main: "src/index.ts" }));
    const ignore = '{ file: "src/old.ts", reason: "loaded by name" }';
    fs.writeFileSync(
      path.join(ws.root, "workerstack.config.ts"),
      `export default { packs: ["standards"], knip: { ignore: [${ignore}] } };\n`,
    );
    const out = await checkKnipAt(ws.root);
    expect(out.report).toStrictEqual(["knip: 1 ignore: file src/old.ts (loaded by name)"]);
    expect(out.problems.toSorted()).toStrictEqual([
      'knip: package.json: unused dependency "left-pad"; remove it',
      'knip: src/lib.ts: unused export "unused"; delete it or stop exporting it',
    ]);
    expect(fs.readdirSync(ws.root).filter((name) => name.startsWith("knip."))).toStrictEqual([]);
  },
);

it(
  "keeps knip's default entries: src/index.ts and what it imports are used with no main",
  { timeout: SLOW },
  async () => {
    const files = {
      "src/answer.ts": "export const answer = 42;\n",
      "src/index.ts": 'import { answer } from "./answer.ts";\nconsole.log(answer);\n',
    };

    const ws = knipRoot(files, {});
    fs.symlinkSync(INSTALL, path.join(ws.root, "node_modules"), "junction");
    fs.writeFileSync(path.join(ws.root, "workerstack.config.ts"), 'export default { packs: ["standards"] };\n');
    const out = await checkKnipAt(ws.root);
    expect(out.problems).toStrictEqual([]);
  },
);

it("does not report @workerstack/repo as unused when the config does not import it", { timeout: SLOW }, async () => {
  const ws = knipRoot({ "src/index.ts": "export {};\n" }, {});
  fs.symlinkSync(INSTALL, path.join(ws.root, "node_modules"), "junction");
  const manifest = { devDependencies: { "@workerstack/repo": "1.0.0" }, name: "app", type: "module" };
  fs.writeFileSync(path.join(ws.root, "package.json"), JSON.stringify(manifest));
  fs.writeFileSync(path.join(ws.root, "workerstack.config.ts"), 'export default { packs: ["standards"] };\n');
  const out = await checkKnipAt(ws.root);
  expect(out.problems).toStrictEqual([]);
});
