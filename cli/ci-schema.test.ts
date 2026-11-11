import { expect, it } from "vitest";

import { ciSchema } from "./ci-schema.ts";

function messages(input: unknown): string[] {
  const parsed = ciSchema().safeParse(input);
  return parsed.success ? [] : parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
}
const ARGV = 'must be a non-empty list of strings like ["bun", "scripts/check.ts"]';

it("takes kebab-case names mapped to argv arrays", () => {
  const checks = { "container-images": ["bun", "scripts/check/container-images.ts"], lint2: ["x"] };
  expect(ciSchema().parse({ checks })).toStrictEqual({ checks });
  expect(ciSchema().parse({})).toStrictEqual({});
});

it("refuses an empty argv and an argv that is not a list of non-empty strings", () => {
  expect(messages({ checks: { a: [] } })).toStrictEqual([`checks.a: ${ARGV}`]);
  expect(messages({ checks: { a: [""] } })).toStrictEqual([`checks.a.0: ${ARGV}`]);
  expect(messages({ checks: { a: "bun x" } })).toStrictEqual([`checks.a: ${ARGV}`]);
  expect(messages({ checks: { a: [1] } })).toStrictEqual([`checks.a.0: ${ARGV}`]);
});

it("refuses a name that is not kebab-case", () => {
  expect(messages({ checks: { "Not Kebab": ["x"], snake_case: ["x"] } })).toStrictEqual([
    'checks: "Not Kebab" is not a kebab-case name like "container-images"',
    'checks: "snake_case" is not a kebab-case name like "container-images"',
  ]);
});

it("refuses a name that a built-in gate already prints", () => {
  const names = ["check", "fmt", "typecheck", "tests", "packages"];
  const checks = Object.fromEntries(names.map((name) => [name, ["x"]]));
  expect(messages({ checks })).toStrictEqual(
    names.map((name) => `checks: "${name}" is a built-in gate label; pick another name`),
  );
});

it("refuses an unknown key, a checks that is not a map and a ci that is not an object", () => {
  const unknown = ciSchema().safeParse({ nope: 1 }).error?.issues;
  expect(unknown).toMatchObject([{ code: "unrecognized_keys", keys: ["nope"] }]);
  expect(messages({ checks: [] })).toStrictEqual([
    'checks: must be an object like { "container-images": ["bun", "scripts/check.ts"] }',
  ]);
  expect(messages(1)).toStrictEqual([
    ': must be an object like { checks: { "container-images": ["bun", "scripts/check.ts"] } }',
  ]);
});
