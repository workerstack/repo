import { afterEach, describe, expect, it } from "vitest";

import { answering, knipRoot, removeKnipRoots, report } from "./__fixtures__/knip-run.ts";
import { checkKnip } from "./knip-check.ts";
import type { KnipIgnore } from "./knip-schema.ts";

afterEach(removeKnipRoots);

const item = { col: 1, line: 1, name: "oxlint", pos: 0 };

function dep(reason = "spawned by path"): KnipIgnore {
  return { dependency: "oxlint", reason };
}

/** Checks `ignores` against `issues` in a root with `files` and a manifest depending on oxlint. */
function check(ignores: KnipIgnore[], issues: Record<string, unknown>[], files: Record<string, string> = {}) {
  return checkKnip(knipRoot(files, { oxlint: "1" }), ignores, answering(report(...issues)));
}

describe("an ignore matched by issues", () => {
  it("is no problem and is reported with its reason", () => {
    const out = check([dep()], [{ dependencies: [item], file: "package.json" }]);
    expect(out).toStrictEqual({ problems: [], report: ["knip: 1 ignore: dependency oxlint (spawned by path)"] });
  });

  it("a dependency entry takes the unused, dev, optional peer and unlisted issues of that name only", () => {
    const issues = [
      { dependencies: [item], devDependencies: [item], file: "package.json", optionalPeerDependencies: [item] },
      { binaries: [item], file: "a.ts", unlisted: [item, { ...item, name: "other" }] },
    ];

    expect(check([dep()], issues).problems).toStrictEqual([
      'knip: a.ts: unlisted dependency "other"; add it to package.json',
      'knip: a.ts: unlisted binary "oxlint"; add the package that provides it to package.json',
    ]);
  });

  it("a binary entry takes the binaries of that name", () => {
    const out = check(
      [{ binary: "oxlint", reason: "run by a hook" }],
      [{ binaries: [item, { ...item, name: "tsc" }], dependencies: [item], file: "a.ts" }],
    );

    expect(out.report).toStrictEqual(["knip: 1 ignore: binary oxlint (run by a hook)"]);
    expect(out.problems).toStrictEqual([
      'knip: a.ts: unused dependency "oxlint"; remove it',
      'knip: a.ts: unlisted binary "tsc"; add the package that provides it to package.json',
    ]);
  });
});

describe("an ignore matched by files and several entries", () => {
  it("a file entry takes every issue of the files its path or glob matches", () => {
    const issues = [
      { exports: [item], file: "src/old.ts", files: [{ name: "src/old.ts" }] },
      { exports: [item], file: "src/new.ts" },
    ];

    const out = check([{ file: "src/old*.ts", reason: "loaded by name" }], issues, { "src/old.ts": "" });
    expect(out.report).toStrictEqual(["knip: 1 ignore: file src/old*.ts (loaded by name)"]);
    expect(out.problems).toStrictEqual(['knip: src/new.ts: unused export "oxlint"; delete it or stop exporting it']);
  });

  it("several entries make one line, plural", () => {
    const issues = [
      { dependencies: [item], file: "package.json" },
      { binaries: [item], file: "b.ts" },
    ];

    const out = check([dep("r1"), { binary: "oxlint", reason: "r2" }], issues);
    expect(out.report).toStrictEqual(["knip: 2 ignores: dependency oxlint (r1), binary oxlint (r2)"]);
  });
});

describe("a stale entry", () => {
  it("a file that no longer exists is stale before the run", () => {
    const out = check([{ file: "src/old.ts", reason: "r" }], [{ exports: [item], file: "src/old.ts" }]);
    expect(out.problems).toStrictEqual(["knip.ignore[0]: src/old.ts no longer exists; delete the entry"]);
  });

  it("a dependency in no package.json is stale before the run", () => {
    const out = check([{ dependency: "left-pad", reason: "r" }], []);
    expect(out.problems).toStrictEqual([
      'knip.ignore[0]: dependency "left-pad" is in no package.json; delete the entry',
    ]);
  });
});

describe("a stale entry once knip has run", () => {
  it("a dependency of a workspace package is in a package.json", () => {
    const ws = knipRoot({});
    const manifest = { devDependencies: { "left-pad": "1" }, name: "a" };
    const stdout = report({ devDependencies: [{ name: "left-pad" }], file: "a/package.json" });

    const out = checkKnip(
      { ...ws, packages: [{ dir: "a", manifest }] },
      [{ dependency: "left-pad", reason: "r" }],
      answering(stdout),
    );

    expect(out.problems).toStrictEqual([]);
  });

  it("an entry that matches no issue is stale after the run", () => {
    const issues = [{ exports: [item], file: "b.ts" }];

    const out = check([dep(), { file: "a.ts", reason: "r" }, { binary: "tsc", reason: "r" }], issues, {
      "a.ts": "",
      "b.ts": "",
    });

    expect(out.problems).toStrictEqual([
      'knip: b.ts: unused export "oxlint"; delete it or stop exporting it',
      'knip.ignore[0]: dependency "oxlint" has no knip issue any more; delete the entry',
      'knip.ignore[1]: file "a.ts" has no knip issue any more; delete the entry',
      'knip.ignore[2]: binary "tsc" has no knip issue any more; delete the entry',
    ]);
    expect(out.report).toStrictEqual([]);
  });
});
