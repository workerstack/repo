import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { reportsOf } from "../../dev/rule-harness.ts";
import { fwd } from "../../dev/test-paths.ts";
import { boundaries } from "./boundaries.ts";

/** A repo of real packages: the rule reads each file's nearest package.json from disk. */
const MANIFESTS: Record<string, string> = {
  "package.json": JSON.stringify({ name: "@app/root", dependencies: { zod: "4" } }),
  "packages/web/package.json": JSON.stringify({
    name: "@app/web",
    dependencies: { react: "19" },
    devDependencies: { vitest: "3" },
    peerDependencies: { "@scope/peer": "1" },
    optionalDependencies: { opt: "1" },
  }),
  "packages/api/package.json": JSON.stringify({ name: "@app/api" }),
  "packages/pub/package.json": JSON.stringify({
    name: "@app/pub",
    private: false,
    dependencies: { react: "19" },
    devDependencies: { zod: "4", both: "1" },
    peerDependencies: { both: "1" },
    main: "./lib/main.ts",
    bin: { pub: "tools/cli.ts" },
    files: ["src", "!src/skip", "!**/*.gen.ts", "extra/*.ts", "./lib", "tools/cli.ts"],
  }),
  "packages/open/package.json": JSON.stringify({
    name: "@app/open",
    private: false,
    devDependencies: { zod: "4" },
  }),
  "packages/closed/package.json": JSON.stringify({
    name: "@app/closed",
    private: true,
    devDependencies: { zod: "4" },
    files: ["src"],
  }),
  "packages/anon/package.json": "{}",
  "packages/broken/package.json": "{ not json",
  "packages/null/package.json": "null",
  "packages/odd/package.json": JSON.stringify({ name: 7, dependencies: "zod", devDependencies: ["zod"] }),
};
const WEB = "packages/web/src/a.ts";

/** What the rule reports for `code` at `file` in the repo above. */
const messagesOf = (code: string, file = WEB) =>
  reportsOf(boundaries, { ...MANIFESTS, [file]: code }).map((report) => report.message);

const undeclared = (name: string, manifest = "packages/web/package.json") =>
  `"${name}" is not declared in ${manifest}; add it to its dependencies`;
const reaches = (specifier: string, dir = "packages/api", name = "@app/api") =>
  `"${specifier}" reaches into ${dir}; import it as "${name}"`;
const nameless = (specifier: string, dir: string) =>
  `"${specifier}" reaches into ${dir}; name it in ${dir}/package.json and import it by that name`;

describe("boundaries passes", () => {
  it.each([
    'import { b } from "./b.ts";\nimport manifest from "../package.json" with { type: "json" };',
    'export { b } from "./b.ts";\nexport * from "../lib/c.ts";\nexport const load = () => import("./d.ts");',
    'import React from "react";\nimport { it } from "vitest";\nimport { p } from "@scope/peer/sub";',
    'import opt from "opt";\nimport self from "@app/web/lint";\nexport const value = 1;',
    'import fs from "fs";\nimport { readFile } from "fs/promises";\nimport path from "node:path";',
    'import { serve } from "bun";\nimport { test } from "bun:test";\nimport a from "#internal/a.ts";',
    'import v from "virtual:module";\nexport const load = (name: string) => import(name);',
  ])("a package's own, declared, builtin, scheme and # specifiers: %j", (code) => {
    expect(messagesOf(code)).toEqual([]);
  });

  it.each([
    ["packages/broken/src/a.ts", 'import { z } from "zod";\nimport a from "../../api/a.ts";'],
    ["packages/null/src/a.ts", 'import { z } from "zod";'],
    ["src/a.ts", 'import { z } from "zod";\nimport root from "@app/root";'],
  ])("%s, whose manifest is unreadable or declares what it imports", (file, code) => {
    expect(messagesOf(code, file)).toEqual([]);
  });
});

describe("boundaries fails", () => {
  it.each([
    ['import { z } from "zod";', undeclared("zod")],
    ['import type { Z } from "zod/v4";', undeclared("zod")],
    ['export const load = () => import("@other/pkg/sub");', undeclared("@other/pkg")],
    ['export * from "zod";', undeclared("zod")],
    ['export { z } from "zod";', undeclared("zod")],
    ['import { db } from "../../api/src/db.ts";', reaches("../../api/src/db.ts")],
    ['import type { Db } from "../../api";', reaches("../../api")],
    ['export const load = () => import("../../api/src/db.ts");', reaches("../../api/src/db.ts")],
    ['import { x } from "../../anon/x.ts";', nameless("../../anon/x.ts", "packages/anon")],
    ['import { x } from "../../broken/x.ts";', nameless("../../broken/x.ts", "packages/broken")],
    ['import { x } from "../../../src/x.ts";', reaches("../../../src/x.ts", "the root package", "@app/root")],
  ])("%j", (code, message) => {
    expect(messagesOf(code)).toEqual([message]);
  });

  it.each([
    [
      "src/a.ts",
      'import { a } from "../packages/web/src/a.ts";',
      reaches("../packages/web/src/a.ts", "packages/web", "@app/web"),
    ],
    ["src/a.ts", 'import React from "react";', undeclared("react", "package.json")],
    ["packages/odd/a.ts", 'import { z } from "zod";', undeclared("zod", "packages/odd/package.json")],
  ])("%s: %j", (file, code, message) => {
    expect(messagesOf(code, file)).toEqual([message]);
  });
});

const devOnly = (name = "zod") =>
  `"${name}" is only in devDependencies of packages/pub/package.json; shipped code needs it in dependencies or peerDependencies`;

describe("boundaries on a public package", () => {
  it.each([
    ["packages/pub/src/a.ts", 'import { z } from "zod";'],
    ["packages/pub/src/a.ts", 'import type { Z } from "zod/v4";'],
    ["packages/pub/src/a.ts", 'export const load = () => import("zod");'],
    ["packages/pub/src/deep/a.ts", 'export * from "zod";'],
    ["packages/pub/extra/a.ts", 'import { z } from "zod";'],
    ["packages/pub/lib/b.ts", 'import { z } from "zod";'],
    // npm packs the bin and main targets even when `files` leaves them out.
    ["packages/pub/lib/main.ts", 'import { z } from "zod";'],
  ])("fails %s: %j", (file, code) => {
    expect(messagesOf(code, file)).toEqual([devOnly()]);
  });

  it.each([
    ["packages/pub/src/a.test.ts", "a test"],
    ["packages/pub/src/fixtures/a.ts", "a fixture"],
    ["packages/pub/docs/a.ts", "a file outside files"],
    ["packages/pub/src/skip/a.ts", "a file under a ! entry"],
    ["packages/pub/src/b.gen.ts", "a file matching a ! glob"],
    ["packages/pub/extra/deep/a.ts", "a file the glob does not reach"],
    ["packages/closed/src/a.ts", "a private package's file"],
  ])("passes %s, %s", (file) => {
    expect(messagesOf('import { z } from "zod";', file)).toEqual([]);
  });
});

describe("boundaries on a public package's other files", () => {
  it("passes a dev-only name in a package without private", () => {
    expect(messagesOf('import v from "vitest";', "packages/web/src/a.ts")).toEqual([]);
  });

  it("passes a name its runtime fields also declare, and a runtime dependency", () => {
    expect(messagesOf('import b from "both";\nimport r from "react";', "packages/pub/src/a.ts")).toEqual([]);
  });

  it("ships every source file of a public package without files", () => {
    expect(messagesOf('import { z } from "zod";', "packages/open/anywhere/a.ts")).toEqual([
      '"zod" is only in devDependencies of packages/open/package.json; shipped code needs it in dependencies or peerDependencies',
    ]);
  });

  it("still reports a name nothing declares", () => {
    expect(messagesOf('import { x } from "nope";', "packages/pub/src/a.ts")).toEqual([
      undeclared("nope", "packages/pub/package.json"),
    ]);
  });
});

it("skips a file with no package.json at or above it", () => {
  const messages = reportsOf(boundaries, { "src/a.ts": 'import { z } from "zod";\nimport { x } from "../../x.ts";' });
  expect(messages).toEqual([]);
});

describe("boundaries on an absolute specifier", () => {
  const other = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-boundaries-")));
  fs.writeFileSync(path.join(other, "package.json"), JSON.stringify({ name: "@app/other" }));
  afterAll(() => fs.rmSync(other, { recursive: true, force: true }));

  it("fails one into another package, naming that package", () => {
    // Forward slashes: a backslash in a string literal is an escape.
    const specifier = fwd(path.join(other, "src/x.ts"));
    const [message] = messagesOf(`import { x } from "${specifier}";`);
    const literal = specifier.replace(/[.*+?^${}()|[\]\\]/g, (c) => `\\${c}`);
    expect(message).toMatch(new RegExp(`^"${literal}" reaches into .+; import it as "@app/other"$`));
  });
});
