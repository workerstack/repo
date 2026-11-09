import { afterEach, describe, expect, it } from "vitest";
import { answering, knipRoot, removeKnipRoots, report } from "./fixtures/knip-run.ts";
import { checkKnip } from "./knip-check.ts";
import type { KnipIgnore } from "./knip-schema.ts";

afterEach(removeKnipRoots);

const item = { name: "oxlint", line: 1, col: 1, pos: 0 };
const dep = (reason = "spawned by path"): KnipIgnore => ({ dependency: "oxlint", reason });

/** Checks `ignores` against `issues` in a root with `files` and a manifest depending on oxlint. */
function check(ignores: KnipIgnore[], issues: Record<string, unknown>[], files: Record<string, string> = {}) {
  return checkKnip(knipRoot(files, { oxlint: "1" }), ignores, answering(report(...issues)));
}

describe("an ignore matched by issues", () => {
  it("is no problem and is reported with its reason", () => {
    const out = check([dep()], [{ file: "package.json", dependencies: [item] }]);
    expect(out).toEqual({ report: ["knip: 1 ignore: dependency oxlint (spawned by path)"], problems: [] });
  });

  it("a dependency entry takes the unused, dev, optional peer and unlisted issues of that name only", () => {
    const issues = [
      { file: "package.json", devDependencies: [item], optionalPeerDependencies: [item], dependencies: [item] },
      { file: "a.ts", unlisted: [item, { ...item, name: "other" }], binaries: [item] },
    ];
    expect(check([dep()], issues).problems).toEqual([
      'knip: a.ts: unlisted dependency "other"; add it to package.json',
      'knip: a.ts: unlisted binary "oxlint"; add the package that provides it to package.json',
    ]);
  });

  it("a binary entry takes the binaries of that name", () => {
    const out = check(
      [{ binary: "oxlint", reason: "run by a hook" }],
      [{ file: "a.ts", binaries: [item, { ...item, name: "tsc" }], dependencies: [item] }],
    );
    expect(out.report).toEqual(["knip: 1 ignore: binary oxlint (run by a hook)"]);
    expect(out.problems).toEqual([
      'knip: a.ts: unused dependency "oxlint"; remove it',
      'knip: a.ts: unlisted binary "tsc"; add the package that provides it to package.json',
    ]);
  });
});

describe("an ignore matched by files and several entries", () => {
  it("a file entry takes every issue of the files its path or glob matches", () => {
    const issues = [
      { file: "src/old.ts", exports: [item], files: [{ name: "src/old.ts" }] },
      { file: "src/new.ts", exports: [item] },
    ];
    const out = check([{ file: "src/old*.ts", reason: "loaded by name" }], issues, { "src/old.ts": "" });
    expect(out.report).toEqual(["knip: 1 ignore: file src/old*.ts (loaded by name)"]);
    expect(out.problems).toEqual(['knip: src/new.ts: unused export "oxlint"; delete it or stop exporting it']);
  });

  it("several entries make one line, plural", () => {
    const issues = [
      { file: "package.json", dependencies: [item] },
      { file: "b.ts", binaries: [item] },
    ];
    const out = check([dep("r1"), { binary: "oxlint", reason: "r2" }], issues);
    expect(out.report).toEqual(["knip: 2 ignores: dependency oxlint (r1), binary oxlint (r2)"]);
  });
});

describe("a stale entry", () => {
  it("a file that no longer exists is stale before the run", () => {
    const out = check([{ file: "src/old.ts", reason: "r" }], [{ file: "src/old.ts", exports: [item] }]);
    expect(out.problems).toEqual(["knip.ignore[0]: src/old.ts no longer exists; delete the entry"]);
  });

  it("a dependency in no package.json is stale before the run", () => {
    const out = check([{ dependency: "left-pad", reason: "r" }], []);
    expect(out.problems).toEqual(['knip.ignore[0]: dependency "left-pad" is in no package.json; delete the entry']);
  });
});

describe("a stale entry once knip has run", () => {
  it("a dependency of a workspace package is in a package.json", () => {
    const ws = knipRoot({});
    const manifest = { name: "a", devDependencies: { "left-pad": "1" } };
    const stdout = report({ file: "a/package.json", devDependencies: [{ name: "left-pad" }] });
    const out = checkKnip(
      { ...ws, packages: [{ dir: "a", manifest }] },
      [{ dependency: "left-pad", reason: "r" }],
      answering(stdout),
    );
    expect(out.problems).toEqual([]);
  });

  it("an entry that matches no issue is stale after the run", () => {
    const issues = [{ file: "b.ts", exports: [item] }];
    const out = check([dep(), { file: "a.ts", reason: "r" }, { binary: "tsc", reason: "r" }], issues, {
      "a.ts": "",
      "b.ts": "",
    });
    expect(out.problems).toEqual([
      'knip: b.ts: unused export "oxlint"; delete it or stop exporting it',
      'knip.ignore[0]: dependency "oxlint" has no knip issue any more; delete the entry',
      'knip.ignore[1]: file "a.ts" has no knip issue any more; delete the entry',
      'knip.ignore[2]: binary "tsc" has no knip issue any more; delete the entry',
    ]);
    expect(out.report).toEqual([]);
  });
});
