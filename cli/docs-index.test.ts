import { expect, it } from "vitest";
import { linkFindings, listedFiles, unlistedFindings } from "./docs-index.ts";

const everything = () => true;
const only =
  (...present: string[]) =>
  (rel: string) =>
    present.includes(rel);

const INDEX = [
  "# Index",
  "- [Auth](auth.md) the login flow",
  "| `hooks.md` | hook notes |",
  "| output.md | the output rules |",
  "",
  "| name | file |",
  "| lessons | node_modules/@workerstack/repo/references/lessons.md |",
  "| `node_modules/@workerstack/repo/references/lessons.md` | again |",
  "[web](https://example.com/a.md) [top](#top) [missing](missing.md) [sub](sub/INDEX.md#part)",
  "```md",
  "- [Fenced](fenced.md)",
  "```",
  "[self](INDEX.md) `see notes.md` [code](auth.ts) [query](?page=2)",
].join("\n");
const PRESENT = ["auth", "hooks", "output", "lessons", "sub/INDEX", "fenced", "INDEX"].map((n) => `references/${n}.md`);

it("lists the existing files in INDEX order with their lines, once each", () => {
  const index = { text: INDEX, path: "references/INDEX.md", name: "@workerstack/repo" };
  expect(listedFiles(index, only(...PRESENT))).toStrictEqual([
    { path: "references/auth.md", line: 2 },
    { path: "references/hooks.md", line: 3 },
    { path: "references/output.md", line: 4 },
    { path: "references/lessons.md", line: 7 },
    { path: "references/sub/INDEX.md", line: 9 },
  ]);
});

it("resolves the package's own file from the folder that holds references/", () => {
  const text = "| `node_modules/@ws/a/references/own.md` |";
  const inPackage = { text, path: "packages/a/references/INDEX.md", name: "@ws/a" };
  expect(listedFiles(inPackage, everything)).toStrictEqual([{ path: "packages/a/references/own.md", line: 1 }]);
  const atRoot = { text, path: "references/INDEX.md", name: "@ws/a" };
  expect(listedFiles(atRoot, everything)).toStrictEqual([{ path: "references/own.md", line: 1 }]);
});

it("resolves a subfolder INDEX from its own folder", () => {
  const index = { text: "[a](../a.md) [b](b.md)", path: "references/sub/INDEX.md", name: "x" };
  expect(listedFiles(index, everything)).toStrictEqual([
    { path: "references/a.md", line: 1 },
    { path: "references/sub/b.md", line: 1 },
  ]);
});

const TOP = "references/INDEX.md";
const LISTED_BY = new Map([
  [TOP, new Set(["references/a.md", "references/sub/INDEX.md"])],
  ["references/sub/INDEX.md", new Set(["references/sub/b.md"])],
]);

it("passes files their own folder's INDEX lists, and a subfolder INDEX its parent lists", () => {
  const files = [TOP, "references/a.md", "references/sub/INDEX.md", "references/sub/b.md"];
  expect(unlistedFindings(files, TOP, LISTED_BY)).toStrictEqual([]);
});

it("names a file its INDEX does not list", () => {
  expect(unlistedFindings([TOP, "references/auth.md", "references/sub/c.md"], TOP, LISTED_BY)).toStrictEqual([
    "references/auth.md is not listed in references/INDEX.md; add a line that links it",
    "references/sub/c.md is not listed in references/sub/INDEX.md; add a line that links it",
  ]);
});

it("names a subfolder INDEX its parent does not list", () => {
  const parent = new Map([
    [TOP, new Set<string>()],
    ["references/sub/INDEX.md", new Set(["references/sub/b.md"])],
  ]);
  expect(unlistedFindings([TOP, "references/sub/INDEX.md"], TOP, parent)).toStrictEqual([
    "references/sub/INDEX.md is not listed in references/INDEX.md; add a line that links it",
  ]);
});

it("says so when the folder has no INDEX at all", () => {
  const empty = new Map([[TOP, new Set<string>()]]);
  expect(unlistedFindings([TOP, "references/lone/x.md"], TOP, empty)).toStrictEqual([
    "references/lone/x.md is not listed in references/lone/INDEX.md, which does not exist; add it with a line that links the file",
  ]);
});

const LINKS = [
  "[ok](other.md) [frag](other.md#h) [web](https://x.dev) [here](#top)",
  "[gone](missing.md) [gonefrag](missing.md#h)",
  "[pkg](../node_modules/@workerstack/backend/references/INDEX.md)",
  "[plain](../node_modules/left-pad/index.md)",
  "[file](../node_modules/@scope/here/missing.md)",
  "```md",
  "[fenced](nope.md)",
  "```",
].join("\n");

it("names each relative link that does not resolve, with its line, fragments stripped", () => {
  const exists = only("references/other.md", "node_modules/@scope/here");
  expect(linkFindings("references/auth.md", LINKS, exists)).toStrictEqual([
    "references/auth.md:2: links missing.md, which does not exist",
    "references/auth.md:2: links missing.md, which does not exist",
    "references/auth.md:3: links ../node_modules/@workerstack/backend/references/INDEX.md, but @workerstack/backend is not installed; add it or drop the link",
    "references/auth.md:4: links ../node_modules/left-pad/index.md, but left-pad is not installed; add it or drop the link",
    "references/auth.md:5: links ../node_modules/@scope/here/missing.md, which does not exist",
  ]);
});
