import { parseSync, type ObjectExpression } from "oxc-parser";
import { describe, expect, it } from "vitest";

import { defineCalls, isAssignment, keyName, stringOf } from "./env-syntax.ts";

/** The object literal `code` spells, as oxc reads it. */
function objectOf(code: string): ObjectExpression {
  const [statement] = parseSync("a.ts", `const x = ${code};`).program.body;

  if (statement?.type !== "VariableDeclaration") throw new Error(`no declaration in ${code}`);
  const init = statement.declarations[0]?.init;

  if (init?.type !== "ObjectExpression") throw new Error(`no object literal in ${code}`);

  return init;
}

describe("env-syntax", () => {
  it("counts only `key: value` members as assignments", () => {
    const members = objectOf("{ a: 1, b, c() {}, get d() { return 1; }, ...e }").properties;
    const [assigned, ...others] = members;
    expect(assigned === undefined ? false : isAssignment(assigned)).toBe(true);

    for (const member of others) expect(isAssignment(member)).toBe(false);
  });

  it("names identifier and string keys, not computed or numeric ones or a spread", () => {
    const members = objectOf('{ a: 1, "b": 2, ["c"]: 3, 4: 4, ...e }').properties;
    expect(members.map(keyName)).toStrictEqual(["a", "b", undefined, undefined, undefined]);
  });

  it("reads a string or a plain template, not a template with an expression or a number", () => {
    const values = objectOf("{ a: 'x', b: `y`, c: `z${1}`, d: 1 }").properties.flatMap((member) =>
      isAssignment(member) ? [stringOf(member.value)] : [],
    );

    expect(values).toStrictEqual(["x", "y", undefined, undefined]);
  });

  it("binds each defineEnv call to the name a declaration gives it, else to none", () => {
    const code = "let unset;\nconst a = defineEnv({});\nconst { b } = defineEnv({});\ndefineEnv({});\nother({});\n";
    const calls = defineCalls(parseSync("a.ts", code).program);
    expect(calls.map((call) => call.binding)).toStrictEqual(["a", "", ""]);
  });
});
