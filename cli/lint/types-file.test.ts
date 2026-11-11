import { describe, expect, it } from "vitest";

import { reportsOf } from "../../dev/rule-harness.ts";
import { typesFile } from "./types-file.ts";

const MESSAGE = "a .types.ts file holds only exported types and interfaces; move this into a module";
function messagesOf(code: string, file = "src/user.types.ts") {
  return reportsOf(typesFile, { [file]: code }).map((report) => report.message);
}

describe("types-file passes", () => {
  it("import type, exported type aliases and interfaces, and export type … from", () => {
    const code = [
      'import type { Id } from "./id.ts";',
      "export type User = { id: Id };",
      "export interface Team {\n  users: User[];\n}",
      'export type { Row } from "./row.ts";',
      'export type * from "./more.types.ts";',
    ].join("\n");
    expect(messagesOf(code)).toStrictEqual([]);
  });

  it.each(["src/user.ts", "src/types.ts", "src/user.types.test.ts"])("%s, which is no .types.ts file", (file) => {
    expect(messagesOf("export const user = 1;", file)).toStrictEqual([]);
  });
});

describe("types-file fails", () => {
  it.each([
    ["export const ROLES = [];", 1],
    ["export function isUser(): boolean {\n  return true;\n}", 1],
    ["type Local = string;\ninterface Other {}", 2],
    ['import { Id } from "./id.ts";\nimport { type Row } from "./row.ts";', 2],
    ['export { User } from "./user.ts";\nexport * from "./user.ts";', 2],
    ["export enum Role {\n  Admin,\n}\nexport default {};", 2],
    ["type User = {};\nexport type { User };", 2],
  ] as const)("%j", (code, count) => {
    expect(messagesOf(code)).toStrictEqual(Array.from({ length: count }, () => MESSAGE));
  });
});
