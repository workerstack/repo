import { expect, it } from "vitest";

import { errorCode, errorMessage, fail } from "./sync-errors.ts";

it("reads the code of a system error and none from any other thrown value", () => {
  expect(errorCode(Object.assign(new Error("gone"), { code: "ENOENT" }))).toBe("ENOENT");
  expect(errorCode(Object.assign(new Error("odd"), { code: 1 }))).toBeUndefined();
  expect(errorCode(new Error("plain"))).toBeUndefined();
  expect(errorCode("text")).toBeUndefined();
});

it("reads an Error's message and any other thrown value as text", () => {
  expect(errorMessage(new Error("boom"))).toBe("boom");
  expect(errorMessage("text")).toBe("text");
});

it("prints each error as a sync line and exits 1, or 0 under --postinstall", () => {
  const lines: string[] = [];
  const io = { stderr: (s: string) => lines.push(s) };
  expect(fail({ io, postinstall: false }, ["a", "b"])).toBe(1);
  expect(fail({ io, postinstall: true }, [])).toBe(0);
  expect(lines).toStrictEqual(["repo sync: a\n", "repo sync: b\n"]);
});
