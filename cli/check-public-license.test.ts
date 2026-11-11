import { describe, expect, it } from "vitest";

import type { Pack } from "./config.ts";
import { COMPLETE, MIT, OWNER, lines, without } from "./fixtures/public-package.ts";

const RELEASE: Pack[] = ["release"];
const STANDARDS: Pack[] = ["standards"];

describe("checkPublic gate", () => {
  it("passes a complete public package", () => {
    expect(lines(COMPLETE)).toStrictEqual([]);
  });

  it("accepts author and bugs as objects, and a LICENSE with another year and CRLF line ends", () => {
    const manifest = { ...COMPLETE, author: { name: OWNER.name }, bugs: "https://x.test/issues" };
    expect(lines(manifest, MIT.replace("2026", "2024-2026").replaceAll("\n", "\r\n"))).toStrictEqual([]);
  });

  it.each([
    ["private root", { ...COMPLETE, private: true }, { packs: RELEASE }],
    ["no name", without("name"), {}],
    ["private unset", without("private"), {}],
    ["pack off", without("author"), { packs: STANDARDS }],
  ])("gives nothing for a %s", (_, manifest, over) => {
    expect(lines(manifest, null, over)).toStrictEqual([]);
  });

  it("asks for the owner and checks no more when it is missing", () => {
    expect(lines({ ...COMPLETE, author: "x" }, null, { owner: undefined })).toStrictEqual([
      "workerstack.config.ts: the release pack with a public package needs owner: { name, github }",
    ]);
  });
});

const LICENSE_LINE = "LICENSE is not the MIT license naming Lovro Žagar; replace it with the MIT text and that name";

describe("checkPublic LICENSE", () => {
  it.each([
    ["another license", "Apache License\nVersion 2.0\n"],
    ["another name", MIT.replace(OWNER.name, "workerstack")],
    ["an edited body", MIT.replace("WITHOUT WARRANTY", "WITH WARRANTY")],
    ["no text", ""],
  ])("reports a LICENSE with %s", (_, text) => {
    expect(lines(COMPLETE, text)).toStrictEqual([LICENSE_LINE]);
  });

  it("reports a missing LICENSE", () => {
    expect(lines(COMPLETE, null)).toStrictEqual(["LICENSE is missing; add the MIT license naming Lovro Žagar"]);
  });
});
