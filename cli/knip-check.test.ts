import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { answering, knipRoot, removeKnipRoots, report } from "./__fixtures__/knip-run.ts";
import { checkKnip, checkKnipAt } from "./knip-check.ts";
import { knipConfig } from "./sync/knip-config.ts";

afterEach(removeKnipRoots);

function run(issues: Record<string, unknown>[]) {
  return checkKnip(knipRoot({}), [], answering(report(...issues)));
}
const item = { col: 1, line: 1, name: "x", pos: 0 };

describe("one problem line per issue type", () => {
  it.each([
    ["files", { name: "cli/x.ts" }, "knip: cli/x.ts: unused file; delete it"],
    ["dependencies", item, 'knip: cli/x.ts: unused dependency "x"; remove it'],
    ["devDependencies", item, 'knip: cli/x.ts: unused devDependency "x"; remove it'],
    ["optionalPeerDependencies", item, 'knip: cli/x.ts: unused optional peer dependency "x"; remove it'],
    ["unlisted", item, 'knip: cli/x.ts: unlisted dependency "x"; add it to package.json'],
    ["binaries", item, 'knip: cli/x.ts: unlisted binary "x"; add the package that provides it to package.json'],
    ["unresolved", item, 'knip: cli/x.ts: unresolved import "x"; fix the path or install the package'],
    ["exports", item, 'knip: cli/x.ts: unused export "x"; delete it or stop exporting it'],
    ["nsExports", item, 'knip: cli/x.ts: unused namespace export "x"; delete it or stop exporting it'],
    ["types", item, 'knip: cli/x.ts: unused type "x"; delete it or stop exporting it'],
    ["nsTypes", item, 'knip: cli/x.ts: unused namespace type "x"; delete it or stop exporting it'],
    ["enumMembers", { ...item, namespace: "E" }, 'knip: cli/x.ts: unused enum member "E.x"; delete it'],
    ["namespaceMembers", { ...item, namespace: "n" }, 'knip: cli/x.ts: unused namespace member "n.x"; delete it'],
    ["duplicates", item, 'knip: cli/x.ts: duplicate export "x"; export it under one name'],
    ["catalog", item, 'knip: cli/x.ts: unused catalog entry "x"; remove it'],
    ["catalogReferences", item, 'knip: cli/x.ts: unresolved catalog reference "x"; add it to the catalog'],
    ["cycles", item, 'knip: cli/x.ts: circular import "x"; break the cycle'],
  ])("%s", (type, entry, line) => {
    expect(run([{ file: "cli/x.ts", [type]: [entry] }])).toStrictEqual({ problems: [line], report: [] });
  });
});

it("reports each issue of each file in order, and nothing for a clean run", () => {
  const manifest = { dependencies: [{ name: "left-pad" }], file: "package.json" };
  const source = { exports: [item, { ...item, name: "y" }], file: "cli/x.ts" };
  expect(run([manifest, source]).problems).toStrictEqual([
    'knip: package.json: unused dependency "left-pad"; remove it',
    'knip: cli/x.ts: unused export "x"; delete it or stop exporting it',
    'knip: cli/x.ts: unused export "y"; delete it or stop exporting it',
  ]);
  expect(run([])).toStrictEqual({ problems: [], report: [] });
});

function boom(): never {
  throw new Error("spawn failed");
}
function pack(root: string, body: string) {
  return fs.writeFileSync(path.join(root, "workerstack.config.ts"), `export default ${body};\n`);
}

describe("a knip that did not report", () => {
  const tail = "run `bun repo sync` and check knip.json";

  it("exit 2 is one problem naming the tail of its stderr", () => {
    const out = checkKnip(knipRoot({}), [], answering("", 2, "a\nb\nc\nd\n"));
    expect(out).toStrictEqual({ problems: [`knip: exited 2: b c d; ${tail}`], report: [] });
  });

  it("output that is not knip's json is one problem", () => {
    const out = checkKnip(knipRoot({}), [], answering("not json", 0, "boom"));
    expect(out).toStrictEqual({ problems: [`knip: exited 0: boom; ${tail}`], report: [] });
    expect(checkKnip(knipRoot({}), [], answering('{"issues":3}')).problems).toHaveLength(1);
  });
});

describe("the unignored config", () => {
  it("is written beside knip.json for the run from the workspace without ignores, and removed after", () => {
    const ws = knipRoot({});
    const name = `knip.unignored-${process.pid}.json`;
    let seen = "";
    const out = checkKnip(ws, [{ file: "gone.ts", reason: "r" }], (args, cwd) => {
      seen = fs.readFileSync(path.join(ws.root, name), "utf8");
      expect(args.slice(-5)).toStrictEqual(["--config", name, "--no-exit-code", "--reporter", "json"]);
      expect(cwd).toBe(ws.root);
      return { code: 0, stderr: "", stdout: report() };
    });
    expect(seen).toBe(knipConfig(ws, []));
    expect(fs.existsSync(path.join(ws.root, name))).toBe(false);
    expect(out.problems).toHaveLength(1);
  });

  it("is removed when the runner throws", () => {
    const ws = knipRoot({});
    expect(() => checkKnip(ws, [], boom)).toThrow("spawn failed");
    expect(fs.readdirSync(ws.root)).toStrictEqual(["package.json"]);
  });
});

describe("checkKnipAt", () => {
  const none = { problems: [], report: [] };

  it("runs nothing without a config, without the standards pack or with an unreadable manifest", async () => {
    const { root } = knipRoot({});
    const runner = answering(report({ exports: [item], file: "a.ts" }));
    expect(await checkKnipAt(root)).toStrictEqual(none);
    pack(root, '{ packs: ["docs"] }');
    expect(await checkKnipAt(root, { run: runner })).toStrictEqual(none);
    pack(root, '{ packs: ["standards"] }');
    fs.writeFileSync(path.join(root, "package.json"), "{");
    expect(await checkKnipAt(root, { run: runner })).toStrictEqual(none);
    expect(runner.calls).toStrictEqual([]);
  });

  it("runs knip with the config's ignores under the standards pack", async () => {
    const { root } = knipRoot({ "a.ts": "export {};\n" });
    pack(root, '{ packs: ["standards"], knip: { ignore: [{ file: "a.ts", reason: "loaded by name" }] } }');
    const runner = answering(report({ file: "a.ts", files: [{ name: "a.ts" }] }));
    const out = await checkKnipAt(root, { run: runner });
    expect(out).toStrictEqual({ problems: [], report: ["knip: 1 ignore: file a.ts (loaded by name)"] });
    expect(runner.calls).toHaveLength(1);
  });
});
