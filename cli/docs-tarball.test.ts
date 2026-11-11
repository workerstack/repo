import { expect, it } from "vitest";

import { packedPaths, tarballFindings } from "./docs-tarball.ts";

const packing =
  (stdout: string, code = 0) =>
  () => ({ code, stderr: code === 0 ? "" : "bad\nmore", stdout });

const WANTED = [
  { file: "references/INDEX.md", index: "references/INDEX.md" },
  { file: "references/hooks.md", index: "references/INDEX.md" },
];

it("reads packed lines, with POSIX separators and colors removed", () => {
  const out = "bun pack v1\n\npacked 3.75KB package.json\r\npacked 1KB \u001b[2mreferences\\INDEX.md\u001b[0m\nnoise\n";
  expect([...packedPaths(out)]).toStrictEqual(["package.json", "references/INDEX.md"]);
});

it("passes when the tarball holds the INDEX and each listed file", () => {
  const pack = packing("packed 1KB references\\INDEX.md\npacked 1KB references/hooks.md\n");
  expect(tarballFindings("", WANTED, pack)).toStrictEqual([]);
});

it("names a listed file the tarball lacks, and the fix", () => {
  expect(tarballFindings("", WANTED, packing("packed 1KB references/INDEX.md\n"))).toStrictEqual([
    'references/hooks.md is listed in references/INDEX.md but not in the packed tarball; add "references" to files in package.json',
  ]);
});

it("names a missing INDEX, and compares paths from the package folder", () => {
  const inPackage = [
    { file: "packages/a/references/INDEX.md", index: "packages/a/references/INDEX.md" },
    { file: "packages/a/references/x.md", index: "packages/a/references/INDEX.md" },
  ];
  expect(tarballFindings("packages/a", inPackage, packing("packed 1KB references/x.md\n"))).toStrictEqual([
    'packages/a/references/INDEX.md is not in the packed tarball; add "references" to files in packages/a/package.json',
  ]);
});

it("folds the listed files into one line when their INDEX is missing too", () => {
  expect(tarballFindings("", WANTED, packing("packed 1KB package.json\n"))).toStrictEqual([
    'references/INDEX.md is not in the packed tarball; add "references" to files in package.json',
  ]);
});

it("reports a failed pack by its first line", () => {
  expect(tarballFindings("", WANTED, packing("", 1))).toStrictEqual(["bun pm pack failed in . (exit 1): bad"]);
  expect(tarballFindings("packages/a", WANTED, packing("", 3))).toStrictEqual([
    "bun pm pack failed in packages/a (exit 3): bad",
  ]);
});
