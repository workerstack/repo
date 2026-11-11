import { describe, expect, it } from "vitest";
import { reportsOf } from "../../dev/rule-harness.ts";
import { indexFile } from "./index-file.ts";

const MESSAGE = "an index file only re-exports; move this into its own module and re-export it";
const messagesOf = (code: string, file = "src/index.ts") =>
  reportsOf(indexFile, { [file]: code }).map((report) => report.message);

describe("index-file passes", () => {
  it.each([
    'export { answer } from "./answer.ts";\nexport * from "./store.ts";',
    'export type { Row } from "./row.ts";\nexport * as db from "./db.ts";\nexport type * from "./types.ts";',
    'export { default as Store, type Col } from "./store.ts";',
  ])("re-exports: %j", (code) => {
    expect(messagesOf(code)).toStrictEqual([]);
  });

  it.each(["src/answer.ts", "src/index.test.ts", "src/indexes.ts", "src/my-index.ts"])(
    "%s, which is no index file",
    (file) => {
      expect(messagesOf("export const answer = 42;", file)).toStrictEqual([]);
    },
  );
});

describe("index-file fails", () => {
  it.each([
    ["export const answer = 42;", 1],
    ['import { answer } from "./answer.ts";\nexport { answer };', 2],
    ["export default 1;\nexport type Row = { id: string };", 2],
    ["function load(): void {}", 1],
  ] as const)("%j", (code, count) => {
    expect(messagesOf(code)).toStrictEqual(Array.from({ length: count }, () => MESSAGE));
  });

  it.each(["index.tsx", "index.mts", "index.js", "lib/index.ts"])("a %s", (file) => {
    expect(messagesOf("export const answer = 42;", file)).toStrictEqual([MESSAGE]);
  });
});
