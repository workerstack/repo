import { expect, it } from "vitest";

import { firstLineIs } from "./first-line-is.ts";

const grade = firstLineIs("commit");

const ACCEPTED = ["commit", "/commit", "`commit`", "commit.", "Commit\n", "  commit\nbecause it fits"];

it.each(ACCEPTED)("accepts %j", (answer) => {
  expect(grade(answer)).toBe(true);
});

it.each(["commit-push", "none", "I would use commit", ""])("rejects %j", (answer) => {
  expect(grade(answer)).toBe(false);
});
