import { describe, expect, it } from "vitest";
import { reportsOf } from "../../dev/rule-harness.ts";
import { envInConfig } from "./env-in-config.ts";

const tail = "is read outside env.ts; add the variable to this package's env.ts schema and read it through that module";
const messagesOf = (code: string, file = "a.ts") =>
  reportsOf(envInConfig, { [file]: code }).map((report) => report.message);

describe("env-in-config", () => {
  it.each([
    ["export const a = process.env.HOME;", "process.env"],
    ["export const a = process.env[key];", "process.env"],
    ['export const a = process["env"];', "process.env"],
    ["export const { env } = process;", "process.env"],
    ["export const { HOME } = process.env;", "process.env"],
    ["export const a = Bun.env.X;", "Bun.env"],
    ["export const a = import.meta.env.X;", "import.meta.env"],
    ['export const { "env": e } = process;', "process.env"],
    ['import { "env" as e } from "process";\nexport const a = e;', "env"],
    ['import { env } from "process";\nexport const a = env;', "env"],
    ['import { env } from "node:process";\nexport const a = env;', "env"],
    ['import { env } from "cloudflare:workers";\nexport const a = env;', "env"],
  ] as const)("flags %j", (code, what) => {
    expect(messagesOf(code)).toEqual([`${what} ${tail}`]);
  });
});

describe("env-in-config, reads it passes", () => {
  it.each([
    "export const a = process.cwd();",
    'import { cwd } from "node:process";\nexport const a = cwd;',
    'import { env } from "./env.ts";\nexport const a = env;',
    'vi.stubEnv("X", "1");',
    "export class A {\n  #env = 1;\n  f() {\n    return this.#env;\n  }\n}",
    "export function f() {\n  return new.target.env;\n}",
    "export const { [key]: a } = process;",
    "export const { cwd, ...rest } = process;",
    "export const { ...rest } = process;",
    'import process from "process";\nexport const a = process;',
    'import * as p from "node:process";\nexport const a = p;',
  ])("passes %j", (code) => {
    expect(messagesOf(code)).toEqual([]);
  });
});

describe("env-in-config, by file name", () => {
  it("passes every read in a file named env.ts", () => {
    expect(messagesOf("export const a = process.env.HOME;", "src/env.ts")).toEqual([]);
  });

  it("still flags a file whose name only ends in env.ts", () => {
    expect(messagesOf("export const a = process.env.HOME;", "src/myenv.ts")).toHaveLength(1);
  });
});
