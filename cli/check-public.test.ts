import { expect, it } from "vitest";
import { COMPLETE, EXPORTS, lines, without } from "./fixtures/public-package.ts";

it.each([
  [
    "repository.url",
    { ...COMPLETE, repository: { type: "git" } },
    '"repository.url" is missing; set it to a URL starting git+https://',
  ],

  ["description", without("description"), '"description" is missing; write one line saying what the package does'],
  ["keywords", without("keywords"), '"keywords" is missing; list 1 to 20 GitHub topics'],
  ["keywords", { ...COMPLETE, keywords: [] }, '"keywords" is []; list 1 to 20 GitHub topics'],
  [
    "keywords",
    { ...COMPLETE, keywords: ["My Tool", "ci"] },
    'keyword "My Tool" is not a GitHub topic; use lowercase letters, digits and dashes, starting with a letter or digit, at most 50 characters',
  ],
  ["keywords", { ...COMPLETE, keywords: ["lint", "ci"] }, '"keywords" are not sorted; write ["ci","lint"]'],
  ["license", { ...COMPLETE, license: "ISC" }, '"license" is "ISC"; set it to "MIT"'],
  [
    "author",
    { ...COMPLETE, author: "workerstack" },
    '"author" is "workerstack"; set it to "Lovro Žagar", the owner in workerstack.config.ts',
  ],
  ["author", without("author"), '"author" is missing; set it to "Lovro Žagar", the owner in workerstack.config.ts'],
  [
    "repository.url",
    { ...COMPLETE, repository: { type: "git", url: "https://github.com/workerstack/repo.git" } },
    '"repository.url" is https://github.com/workerstack/repo.git; set it to git+https://github.com/workerstack/repo.git',
  ],
  [
    "repository.url",
    { ...COMPLETE, repository: { type: "git", url: "ssh://x" } },
    '"repository.url" is ssh://x; set it to a URL starting git+https://',
  ],
  [
    "repository.type",
    { ...COMPLETE, repository: { type: "hg", url: "git+https://x" } },
    '"repository.type" is "hg"; set it to "git"',
  ],
  ["repository", without("repository"), '"repository" is missing; set it to { "type": "git", "url": "git+https://…" }'],
  [
    "repository",
    { ...COMPLETE, repository: "github:a/b" },
    '"repository" is "github:a/b"; set it to { "type": "git", "url": "git+https://…" }',
  ],
  ["homepage", without("homepage"), '"homepage" is missing; set it to the project page URL'],
  ["bugs", without("bugs"), '"bugs" is missing; set it to { "url": "…/issues" }'],
  ["bugs", { ...COMPLETE, bugs: {} }, '"bugs" is {}; set it to { "url": "…/issues" }'],
  ["type", without("type"), '"type" is missing; set it to "module"'],
  ["type", { ...COMPLETE, type: "commonjs" }, '"type" is "commonjs"; set it to "module"'],
  ["engines", without("engines"), '"engines.bun" is missing; set it to ">=1.4.4"'],
  ["engines", { ...COMPLETE, engines: { node: ">=20" } }, '"engines.bun" is missing; set it to ">=1.4.4"'],
  ["exports", without("exports"), '"exports" is missing; list the entry points and "./package.json"'],
  [
    "exports",
    { ...COMPLETE, exports: { ".": "./a.js" } },
    'exports has no "./package.json"; add "./package.json": "./package.json"',
  ],
  [
    "exports",
    { ...COMPLETE, exports: "./a.js" },
    'exports has no "./package.json"; add "./package.json": "./package.json"',
  ],
  [
    "exports",
    { ...COMPLETE, exports: { ...EXPORTS, "./x": { default: "./x.js", types: "./x.d.ts" } } },
    'exports "./x" lists "default" before "types"; put "types" first',
  ],
  [
    "exports",
    {
      ...COMPLETE,
      exports: { ".": { import: { default: "./a.js", types: "./a.d.ts" } }, "./package.json": "./package.json" },
    },
    'exports "." lists "default" before "types"; put "types" first',
  ],
  ["files", without("files"), '"files" is missing; list what to publish'],
  ["files", { ...COMPLETE, files: [] }, '"files" is []; list what to publish'],
  ["publishConfig", without("publishConfig"), '"publishConfig.access" is missing; set it to "public"'],
  [
    "publishConfig",
    { ...COMPLETE, publishConfig: { access: "restricted" } },
    '"publishConfig.access" is "restricted"; set it to "public"',
  ],
])("reports %s", (_, manifest, line) => {
  expect(lines(manifest)).toContain(`package.json: ${line}`);
});

it("reports a manifest with several defects one line each, in rule order", () => {
  const out = lines({ name: "x", private: false }, null);
  expect(out.map((line) => line.split(";")[0])).toStrictEqual([
    'package.json: "description" is missing',
    'package.json: "keywords" is missing',
    'package.json: "license" is missing',
    'package.json: "author" is missing',
    'package.json: "repository" is missing',
    'package.json: "homepage" is missing',
    'package.json: "bugs" is missing',
    'package.json: "type" is missing',
    'package.json: "engines.bun" is missing',
    'package.json: "exports" is missing',
    'package.json: "files" is missing',
    'package.json: "publishConfig.access" is missing',
    expect.stringContaining("LICENSE is missing"),
  ]);
});

it("does not check the keywords of a private package", () => {
  expect(lines({ name: "x", private: true, keywords: ["Bad Topic"] }, null)).toStrictEqual([]);
});

it("fails a public package whose keywords are not GitHub topics", () => {
  const out = lines({ ...COMPLETE, keywords: ["lint", "Agents", "lint"] });
  expect(out.filter((line) => line.includes("keyword"))).toHaveLength(3);
});
