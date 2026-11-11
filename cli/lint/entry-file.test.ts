import { describe, expect, it } from "vitest";

import { reportsOf } from "../../dev/rule-harness.ts";
import { entryFile } from "./entry-file.ts";

const MESSAGE = "a bin file holds only imports and one main() call; move this into the module main comes from";
const MISSING = "a bin file holds only imports and one main() call; import main and call it once";
const IMPORT = 'import { main } from "../src/main.ts";\n';
const TYPED_MAIN =
  'import type { Argv } from "../src/argv.ts";\n' +
  'import { start as main } from "../src/main.ts";\n' +
  "await main([] as Argv);";
function manifest(bin: unknown) {
  return JSON.stringify({ bin, name: "app" });
}

/** What the rule reports for `code` at `file`, under a root package.json whose `bin` is `bin`. */
function messagesOf(code: string, bin: unknown = "./bin/app.ts", file = "bin/app.ts") {
  return reportsOf(entryFile, { [file]: code, "package.json": manifest(bin) }).map((report) => report.message);
}

describe("entry-file passes", () => {
  it.each([
    `#!/usr/bin/env bun\n${IMPORT}\nawait main(process.argv.slice(2));`,
    `${IMPORT}main();`,
    `${IMPORT}void main();`,
    TYPED_MAIN,
  ])("imports and one call of an imported main: %j", (code) => {
    expect(messagesOf(code)).toStrictEqual([]);
  });

  it.each([
    ["./bin/app.ts", "bin/app.ts"],
    ["bin/app.ts", "bin/app.ts"],
    [{ app: "./bin/app.ts", other: "bin/other.ts" }, "bin/other.ts"],
  ])("the bin %j at %s, in either spelling or a map", (bin, file) => {
    expect(messagesOf(`${IMPORT}await main();`, bin, file)).toStrictEqual([]);
  });

  it.each([
    ["./bin/app.ts", "src/app.ts"],
    ["./bin/app.ts", "bin/other.ts"],
    [7, "bin/app.ts"],
  ])("a file the bin %j does not name: %s", (bin, file) => {
    expect(messagesOf("export const run = () => 1;\nrun();", bin, file)).toStrictEqual([]);
  });

  it("skips a file whose manifest is unreadable or missing", () => {
    const code = "export const run = () => 1;\nrun();";
    expect(reportsOf(entryFile, { "bin/app.ts": code, "package.json": "{ not json" })).toStrictEqual([]);
    expect(reportsOf(entryFile, { "bin/app.ts": code })).toStrictEqual([]);
  });
});

describe("entry-file fails", () => {
  it.each([
    [`${IMPORT}main().then(() => process.exit());`, [MESSAGE, MISSING]],
    [`${IMPORT}const argv = process.argv.slice(2);\nawait main(argv);`, [MESSAGE]],
    [`${IMPORT}await main();\nawait main();`, [MESSAGE]],
    ["async function main(): Promise<void> {}\nawait main();", [MESSAGE, MESSAGE, MISSING]],
    [`${IMPORT}export { main };\nawait main();`, [MESSAGE]],
    [IMPORT, [MISSING]],
    [`${IMPORT}await run();`, [MESSAGE, MISSING]],
  ])("%j", (code, messages) => {
    expect(messagesOf(code)).toStrictEqual(messages);
  });

  it("fails a bin a map names, read from the nearest package.json", () => {
    const fixture = {
      "package.json": manifest("./bin/root.ts"),
      "packages/cli/bin/cli.ts": "export const run = 1;",
      "packages/cli/package.json": manifest({ cli: "./bin/cli.ts" }),
    };
    expect(reportsOf(entryFile, fixture).map((report) => report.message)).toStrictEqual([MESSAGE, MISSING]);
  });
});
