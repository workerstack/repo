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
