import { describe, expect, it } from "vitest";

import { reportsOf } from "../../dev/rule-harness.ts";
import { skipOnPlatform } from "./skip-on-platform.ts";

const TAIL =
  "a test may skip only on process.platform, process.arch, process.versions or a runtime global, " +
  "so make it hermetic instead";

function messagesOf(code: string) {
  return reportsOf(skipOnPlatform, { "a.test.ts": code }).map((report) => report.message);
}

function inTest(body: string) {
  return `it("x", (ctx) => {\n  ${body}\n});`;
}

const PASSING = [
  'it.skipIf(process.platform === "win32")("x", () => {});',
  'test.runIf(process.arch === "x64")("x", () => {});',
  'describe.skipIf(typeof Bun === "undefined")("x", () => {});',
  'it.concurrent.skipIf(process.platform !== "linux")("x", () => {});',
  'it.sequential.runIf(process.platform === "darwin")("x", () => {});',
  'it.skipIf(globalThis.Deno === undefined)("x", () => {});',
  'it.skipIf(process.versions.bun !== undefined)("x", () => {});',
  'it.skipIf(!(process.platform === "win32"))("x", () => {});',
  'it.skipIf(process.platform === "win32" && process.arch === "arm64")("x", () => {});',
  'it.skipIf(process.platform === "win32" || typeof Bun === "undefined")("x", () => {});',
  inTest('ctx.skip(process.platform !== "linux");'),
  'it.skipIf(false)("x", () => {});',
  'it["skipIf"](hasFfmpeg)("x", () => {});',
  'it[mode].skipIf(hasFfmpeg)("x", () => {});',
  'other.skipIf(hasFfmpeg)("x", () => {});',
  "const run = (ctx) => {\n  ctx.skip(hasFfmpeg);\n};",
  "helper((ctx) => {\n  ctx.skip(hasFfmpeg);\n});",
];

describe("skip-on-platform, conditions it passes", () => {
  it.each(PASSING)("passes %j", (code) => {
    expect(messagesOf(code)).toStrictEqual([]);
  });

  it("passes the skips the repo already has", () => {
    const repoSkips = [
      'it.skipIf(process.platform === "win32")("CLI spawn: lightpanda on PATH, no env knobs", () => {});',
      'it.skipIf(process.platform !== "win32")("CLI spawn: chromium on PATH, no env knobs", () => {});',
      'it.skipIf(process.platform === "win32")(\n  "rewrites a link whose text differs",\n  async () => {},\n);',
    ];

    expect(messagesOf(repoSkips.join("\n"))).toStrictEqual([]);
  });

  it("leaves other calls named skip alone", () => {
    expect(messagesOf('it("x", () => {\n  list.skip(process.env.CI);\n});')).toStrictEqual([]);
  });
});

const FAILING = [
  ['it.skipIf(repoEnv.process.CI)("x", () => {});', "skipIf", "repoEnv.process.CI"],
  ['it.skipIf(globalThis.process.env.CI)("x", () => {});', "skipIf", "globalThis.process.env.CI"],
  ['it.skipIf(!fs.existsSync("/x"))("x", () => {});', "skipIf", "fs.existsSync"],
  ['test.runIf(check())("x", () => {});', "runIf", "check"],
  ['describe.skipIf(!hasFfmpeg)("x", () => {});', "skipIf", "hasFfmpeg"],
  ['it.concurrent.skipIf(hasFfmpeg)("x", () => {});', "skipIf", "hasFfmpeg"],
  ['it.skipIf(process.platform === "win32" && hasFfmpeg)("x", () => {});', "skipIf", "hasFfmpeg"],
  ['it.skipIf(process.env.CI === "1")("x", () => {});', "skipIf", "process.env.CI"],
  ['it.skipIf(process.platform === "win32" || process.cwd() === "/")("x", () => {});', "skipIf", "process.cwd"],
  [inTest("ctx.skip(hasFfmpeg);"), "skip", "hasFfmpeg"],
  [inTest("ctx.skip(!fs.existsSync(`/x`));"), "skip", "fs.existsSync"],
  ['it.skipIf(process[key])("x", () => {});', "skipIf", "process[key]"],
  ['it.skipIf(typeof state.ready)("x", () => {});', "skipIf", "typeof state.ready"],
  ['it.skipIf(+hasFfmpeg)("x", () => {});', "skipIf", "+hasFfmpeg"],
  ['it.skipIf(left + right)("x", () => {});', "skipIf", "left + right"],
  [inTest("ctx.skip();"), "skip", "no condition"],
  ['it.skipIf()("x", () => {});', "skipIf", "no condition"],
] as const;

describe("skip-on-platform, conditions it fails", () => {
  it.each(FAILING)("flags %j", (code, who, what) => {
    expect(messagesOf(code)).toStrictEqual([`${who} reads ${what}; ${TAIL}`]);
  });

  it("names a multi-line condition on one line", () => {
    const code = 'it.skipIf(\n  repoEnv.process\n    .CI,\n)("x", () => {});';
    expect(messagesOf(code)).toStrictEqual([`skipIf reads repoEnv.process .CI; ${TAIL}`]);
  });

  it("reads a callback handed straight to skipIf as a test callback too", () => {
    const code = "it.skipIf((ctx) => ctx.skip(hasFfmpeg));";
    expect(messagesOf(code)).toStrictEqual([
      `skipIf reads (ctx) => ctx.skip(hasFfmpeg); ${TAIL}`,
      `skip reads hasFfmpeg; ${TAIL}`,
    ]);
  });
});
