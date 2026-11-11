import { describe, expect, it } from "vitest";
import { reportsOf } from "../../dev/rule-harness.ts";
import { filenameMatchesExport } from "./filename-matches-export.ts";

const messagesOf = (file: string, code: string) =>
  reportsOf(filenameMatchesExport, { [file]: code }).map((report) => report.message);

describe("filename-matches-export passes", () => {
  it.each([
    ["src/read-workspace.ts", "export function readWorkspace() {}"],
    ["src/readWorkspace.ts", "export function readWorkspace() {}"],
    ["src/read_workspace.ts", "export const readWorkspace = () => {};"],
    ["src/read-workspace.config.ts", "export function readWorkspace() {}"],
    ["src/default-commit.ts", "export const DEFAULT_COMMIT = 1;"],
    ["src/oauth2.ts", "export class OAuth2 {}"],
    ["src/workspace.ts", "export interface Workspace {}"],
    ["src/files.ts", "export function readWorkspace() {}\nexport function writeWorkspace() {}"],
    ["src/files.ts", "export { a, b } from './a.ts';"],
    ["src/files.ts", "export const { a, b } = load();"],
    ["src/files.ts", "export * from './a.ts';\nexport const read = 1;"],
    ["src/files.ts", "export default function readWorkspace() {}"],
    ["src/files.ts", "const read = 1;\nexport default read;"],
    ["src/files.ts", "import { a } from './a.ts';\nconst b = a;"],
    ["src/index.ts", "export function readWorkspace() {}"],
    ["src/files.d.ts", "export function readWorkspace(): void;"],
    ["src/files.test.ts", "export function readWorkspace() {}"],
    ["src/files.spec.ts", "export function readWorkspace() {}"],
    ["src/files.ts", "export declare module 'store' {}"],
    ["src/files.ts", "export const files = 1;\nexport type files = number;"],
    ["src/phase-files.ts", "export async function main(argv: string[]) {}"],
  ])("passes %s: %j", (file, code) => {
    expect(messagesOf(file, code)).toStrictEqual([]);
  });
});

/** Code in `src/files.ts`, the one name it exports, and the file name the message asks for. */
const FAILS = [
  ["export function readWorkspace() {}", "readWorkspace", "read-workspace.ts"],
  ["export const DEFAULT_COMMIT = 1;", "DEFAULT_COMMIT", "default-commit.ts"],
  ["export type ParsedURL = string;", "ParsedURL", "parsed-url.ts"],
  ["export interface Workspace {}", "Workspace", "workspace.ts"],
  ["export enum Kind { A }", "Kind", "kind.ts"],
  ["export namespace Store {}", "Store", "store.ts"],
  ["export class Store {}\nexport default Store;", "Store", "store.ts"],
  ["const a = 1;\nexport { a as readAll };", "readAll", "read-all.ts"],
  ["export { 'read-all' } from './a.ts';", "read-all", "read-all.ts"],
  ["export * as zod from 'zod';", "zod", "zod.ts"],
  ["export const { read } = load();", "read", "read.ts"],
  ["export const { a: [, read = 1] } = load();", "read", "read.ts"],
  ["export const { ...rest } = load();", "rest", "rest.ts"],
  ["export const [...rest] = load();", "rest", "rest.ts"],
  ["export const [first] = load();", "first", "first.ts"],
  ["export function read(a: string): void;\nexport function read(a: string) {}", "read", "read.ts"],
] as const;

describe("filename-matches-export fails", () => {
  it.each(FAILS)("fails %j, which exports only %s", (code, name, renamed) => {
    expect(messagesOf("src/files.ts", code)).toStrictEqual([
      `files.ts exports only "${name}"; rename the file ${renamed}`,
    ]);
  });

  it("keeps everything after the first dot in the new name", () => {
    expect(messagesOf("src/files.config.ts", "export const loadConfig = 1;")).toStrictEqual([
      'files.config.ts exports only "loadConfig"; rename the file load-config.config.ts',
    ]);
  });
});
