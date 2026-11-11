import { expect, it } from "vitest";
import { reportsOf } from "../../dev/rule-harness.ts";
import { nativePathSeparator } from "./native-path-separator.ts";

const messagesOf = (code: string): string[] =>
  reportsOf(nativePathSeparator, { "a.ts": code }).map((report) => report.message);
const PATH = 'import path from "node:path";\n';

const FIX =
  'which uses \\ on Windows, so `.%METHOD%("/…")` misses there; use path.basename, path.dirname, path.relative or split(path.sep), or convert it with .replaceAll(path.sep, "/") first';
const messageFor = (receiver: string, method: string): string =>
  `\`${receiver}\` is a native path, ${FIX.replace("%METHOD%", method)}`;

it("fails the shape of the plan 72 bug with the message from the usage", () => {
  const code = 'export const isA = (cwd: string): boolean => cwd.endsWith("/a");\n';
  expect(messagesOf(code)).toStrictEqual([messageFor("cwd", "endsWith")]);
});

const FAILING: [string, string, string, string][] = [
  ["a cwd member", "export const f = (opts: { cwd: string }) => opts.cwd.split('/');", "opts.cwd", "split"],
  [
    "a path.join call",
    `${PATH}export const f = (a: string) => path.join(a, "b").endsWith("/b");`,
    "path.join(…)",
    "endsWith",
  ],
  [
    "import.meta.dirname",
    'export const f = () => import.meta.dirname.includes("/cli/");',
    "import.meta.dirname",
    "includes",
  ],
  [
    "a const holding path.resolve",
    `${PATH}export function f(x: string) {\n  const out = path.resolve(x);\n  return out.lastIndexOf("/");\n}`,
    "out",
    "lastIndexOf",
  ],
  [
    "a named join import",
    'import { join } from "node:path";\nexport const f = (a: string) => join(a, "b").endsWith("/b");',
    "join(…)",
    "endsWith",
  ],
  [
    "a template literal with a separator",
    `${PATH}export const f = () => {\n  const root = path.resolve(".");\n  const file = path.join(root, "a");\n  return file.startsWith(\`\${root}/\`);\n};`,
    "file",
    "startsWith",
  ],
  [
    "a path.win32 call",
    `${PATH}export const f = (a: string) => path.win32.join(a).endsWith("/b");`,
    "path.win32.join(…)",
    "endsWith",
  ],
  [
    "a namespace import",
    'import * as p from "path";\nexport const f = (a: string) => p.dirname(a).endsWith("/b");',
    "p.dirname(…)",
    "endsWith",
  ],
  ["__dirname", 'export const f = () => __dirname.endsWith("/b");', "__dirname", "endsWith"],
  [
    "tmpdir from node:os",
    'import { tmpdir } from "node:os";\nexport const f = () => tmpdir().startsWith("/tmp");',
    "tmpdir()",
    "startsWith",
  ],
  [
    "an awaited realpath from node:fs/promises",
    'import { realpath } from "node:fs/promises";\nexport const f = async (a: string) => (await realpath(a)).endsWith("/b");',
    "realpath(…)",
    "endsWith",
  ],
  [
    "a cast and a non-null assertion",
    'export const f = (o: { cwd?: string }) => (o.cwd! as string).endsWith("/b");',
    "o.cwd",
    "endsWith",
  ],
  [
    "a const from fileURLToPath",
    'import { fileURLToPath } from "node:url";\nexport const f = (u: URL) => {\n  const file = fileURLToPath(u);\n  return file.split("/");\n};',
    "file",
    "split",
  ],
];

it.each(FAILING)("fails %s", (...row) => {
  const [, code, receiver, method] = row;
  const found = messagesOf(code);
  expect(found).toStrictEqual([messageFor(receiver, method)]);
});

const PASSING: [string, string][] = [
  ["path.posix.join", `${PATH}export const f = (a: string) => path.posix.join(a, "b").split("/");`],
  ["a rel value", 'export const f = (rel: string) => rel.split("/");'],
  ["a url value", 'export const f = (url: string) => url.endsWith("/a");'],
  ["split(path.sep)", `${PATH}export const f = (a: string) => path.relative("/", a).split(path.sep);`],
  ["a converted path", `${PATH}export const f = (abs: string) => abs.replaceAll(path.sep, "/").endsWith("/a");`],
  ["a newline split", 'export const f = (text: string) => text.split("\\n");'],
  ["a newline split of cwd", 'export const f = (cwd: string) => cwd.split("\\n");'],
  ["a let", `${PATH}export function f(a: string) {\n  let dest = path.join(a);\n  return dest.split("/");\n}`],
  ["a local tmpdir", 'function tmpdir(): string {\n  return "a/b";\n}\nexport const f = () => tmpdir().split("/");'],
  ["a tmpdir from elsewhere", 'import { tmpdir } from "./tmp.ts";\nexport const f = () => tmpdir().split("/");'],
  [
    "an inner POSIX value shadowing a native one",
    `${PATH}const out = path.resolve(".");\nexport const f = (git: string) => {\n  const out = git.trim();\n  return out.split("/");\n};\nexport const g = () => out.length;`,
  ],
  ["a non-literal argument", "export const f = (cwd: string, sep: string) => cwd.split(sep);"],
  ["a method that is not a match", 'export const f = (cwd: string) => cwd.replace("/", "-");'],
  ["a computed method", 'export const f = (cwd: string) => cwd["endsWith"]("/a");'],
  ["a literal without a separator", 'export const f = (cwd: string) => cwd.endsWith("a");'],
  ["a template without a separator", "export const f = (cwd: string, s: string) => cwd.endsWith(`${s}a`);"],
  ["a number argument", "export const f = (cwd: string) => cwd.includes(1);"],
  ["a literal receiver", 'export const f = () => "a/b".split("/");'],
  ["a string-named import", 'import { "a-b" as join } from "node:path";\nexport const f = () => join().split("/");'],
  ["no argument", "export const f = (cwd: string) => cwd.split();"],
  ["a call that is not a member", "export const f = (cwd: () => string) => cwd();"],
  [
    "a destructured binding",
    'export const f = (o: { a: string }) => {\n  const { a } = o;\n  return a.split("/");\n};',
  ],
  [
    "a const holding a plain call",
    'export const f = (x: string) => {\n  const a = make(x);\n  return a.split("/");\n};',
  ],
  [
    "a const used before it is declared",
    'export const f = () => {\n  const g = () => out.split("/");\n  const out = process.cwd();\n  return g;\n};',
  ],
  ["a path call on a shadowed non-import", 'export const f = (path: { join(): string }) => path.join().split("/");'],
  ["a call through a computed member", `${PATH}export const f = (a: string) => path["join"](a).split("/");`],
  ["a function parameter", 'export function f(dir: string) {\n  return dir.split("/");\n}'],
  ["a class and a function binding", 'class dir {}\nexport function f() {\n  return dir.split("/");\n}'],
];

it.each(PASSING)("passes %s", (_name, code) => {
  expect(messagesOf(code)).toStrictEqual([]);
});

it("fails a backslash literal on process.cwd() and shows the backslash", () => {
  const code = 'export const f = () => process.cwd().split("\\\\");';
  expect(messagesOf(code)).toStrictEqual([messageFor("process.cwd()", "split").replace('("/…")', '("\\…")')]);
});
