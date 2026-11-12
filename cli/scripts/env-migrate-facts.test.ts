/**
 * What env-migrate-facts.ts's `scriptFacts(rel, text, packages)` reads of an old file before migrate writes:
 *
 *   { calls: number; bindings: string[]; parents: string[]; dollars: string[] }
 *
 * `bindings` are the exported names whose values parity hashes, wrappers around the call seen through. A call bound
 * to no `const`, or to a local one no exported call names as its `parent`, refuses with
 * `repo env: <rel>:<line> createScriptEnv call is not an exported const; export it or migrate it by hand`.
 * And env-migrate-source.ts's `isOldSpecifier(rel, packages, spec)`: whether an import names the old package.
 */
import { describe, expect, it } from "vitest";

import { OLD_PACKAGES } from "../__fixtures__/script-env/edit-kit.ts";
import { OLD_IMPORT } from "../__fixtures__/script-env/tree.ts";
import { scriptFacts } from "./env-migrate-facts.ts";
import { isOldSpecifier } from "./env-migrate-source.ts";

const CONFIG = "{ local: {}, dev: {}, prod: {} }";

function facts(body: string): ReturnType<typeof scriptFacts> {
  return scriptFacts("projects/a.ts", `${OLD_IMPORT}\n${body}`, OLD_PACKAGES);
}

describe("scriptFacts, the names parity hashes", () => {
  it("hashes an exported const through `satisfies`, and a local one only as an exported call's parent", () => {
    const body = [
      'import { repoEnv } from "../repo.ts";',
      `const base = createScriptEnv({ parent: repoEnv, local: {}, dev: {}, prod: {} });`,
      `export const e = createScriptEnv({ parent: base, local: {}, dev: {}, prod: {} }) satisfies object;`,
      "",
    ].join("\n");

    expect(facts(body)).toStrictEqual({ bindings: ["e"], calls: 2, dollars: [], parents: ["../repo.ts"] });
  });

  it("names a quoted key that holds `$` without its quotes", () => {
    const config = '{ local: {}, dev: {}, prod: { "PRICE": "$9", T: secret("$x") } }';
    const body = `export const e = createScriptEnv(${config});\n`;
    expect(facts(body).dollars).toStrictEqual(["PRICE", "T"]);
  });
});

describe("scriptFacts, calls parity cannot reach", () => {
  it.each([
    ["an export default", `export default createScriptEnv(${CONFIG});\n`],
    ["a factory's return", `export function envFor() {\n  return createScriptEnv(${CONFIG});\n}\n`],
    ["a bare call", `createScriptEnv(${CONFIG});\n`],
    ["a local const no export names as parent", `const base = createScriptEnv(${CONFIG});\n`],
  ])("refuses %s, naming the file and line", (_, body) => {
    const line = body.startsWith("export function") ? 4 : 3;

    const fix = "export it or migrate it by hand";
    const refusal = `repo env: projects/a.ts:${line} createScriptEnv call is not an exported const; ${fix}`;
    expect(() => facts(body)).toThrow(new Error(refusal));
  });
});

describe("isOldSpecifier", () => {
  it.each([
    ["@acme/script-env", "a.ts", true],
    ["@acme/script-env/core", "a.ts", true],
    ["../../packages/script-env/src/index.ts", "projects/shop/a.ts", true],
    ["../../repo.script-env.ts", "projects/shop/a.ts", false],
    ["@acme/script-envy", "a.ts", false],
  ])("reads %s from %s as the old package: %s", (spec, rel, isOld) => {
    expect(isOldSpecifier(rel, OLD_PACKAGES, spec)).toBe(isOld);
  });
});
