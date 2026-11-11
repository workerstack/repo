import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  extractTmpExt,
  extractTmpName,
  isUnderDir,
  isUnderHandoffs,
  isUnderImplementations,
  isUnderPlans,
  isUnderRoadmaps,
  isUnderTmp,
  normalizeTmpExt,
  persistOwner,
  stripTmpMeta,
} from "./persist-tmp.ts";

const root = path.resolve("/work/repo");
const at = (...parts: string[]) => path.join(root, ".tmp", "repo", ...parts);

describe("who owns a file under .tmp/repo", () => {
  it.each([
    ["plans", isUnderPlans],
    ["roadmaps", isUnderRoadmaps],
    ["handoffs", isUnderHandoffs],
    ["implementations", isUnderImplementations],
  ])("%s owns files below its folder, absolute or relative, and nothing else", (dir, isUnder) => {
    expect(isUnder(at(dir, "1-a.md"), root)).toBe(true);
    expect(isUnder(`.tmp/repo/${dir}/deep/1-a.md`, root)).toBe(true);
    expect(isUnder(at(dir), root)).toBe(false);
    expect(isUnder(at("other", "1-a.md"), root)).toBe(false);
    expect(isUnder(path.join(root, ".tmp", "repo", "..", "x.md"), root)).toBe(false);
    expect(isUnder("", root)).toBe(false);
    expect(isUnder(at(dir, "1-a.md"), "")).toBe(false);
    expect(isUnder(null, root)).toBe(false);
    expect(isUnder(at(dir, "1-a.md"), undefined)).toBe(false);
  });

  it("checks any folder under the root by its segments", () => {
    expect(isUnderDir("a/b/c.txt", root, ["a", "b"])).toBe(true);
    expect(isUnderDir("a/c.txt", root, ["a", "b"])).toBe(false);
  });
});

describe("who owns a loose file", () => {
  it("gives tmp the loose files at the top of .tmp/repo, not the folders repo owns", () => {
    expect(isUnderTmp(at("1-note-20260827T143000Z.md"), root)).toBe(true);
    expect(isUnderTmp(".tmp/repo/1-note-20260827T143000Z.md", root)).toBe(true);
    expect(isUnderTmp(at("scratch", "1-note.md"), root)).toBe(false);
    expect(isUnderTmp(at("plans"), root)).toBe(false);
    expect(isUnderTmp(at("stash"), root)).toBe(false);
    expect(isUnderTmp("", root)).toBe(false);
    expect(isUnderTmp(at("1-a.md"), null)).toBe(false);
  });

  it("names the owner of a path, or null", () => {
    expect(persistOwner(at("plans", "1-a.md"), root)).toBe("plans");
    expect(persistOwner(at("roadmaps", "1-a.md"), root)).toBe("roadmaps");
    expect(persistOwner(at("handoffs", "1-a.md"), root)).toBe("handoffs");
    expect(persistOwner(at("implementations", "1-a.md"), root)).toBe("implementations");
    expect(persistOwner(at("1-a.md"), root)).toBe("tmp");
    expect(persistOwner(at("browser", "1-a.md"), root)).toBeNull();
    expect(persistOwner(path.join(root, "src", "a.ts"), root)).toBeNull();
  });
});

describe("tmp meta lines", () => {
  it("reads TMP_NAME and TMP_EXT, trimmed", () => {
    expect(extractTmpName("TMP_NAME:  a note \nbody")).toBe("a note");
    expect(extractTmpName("body")).toBe("");
    expect(extractTmpName("TMP_NAME:  ")).toBe("");
    expect(extractTmpExt("x\nTMP_EXT: sh \n")).toBe("sh");
    expect(extractTmpExt("body")).toBe("");
  });

  it("strips both meta lines and a BOM, keeping the rest", () => {
    expect(stripTmpMeta("﻿TMP_NAME: a\r\nTMP_EXT: sh\r\nbody\r\n")).toBe("body\n");
  });

  it("normalizes an extension to lowercase letters and digits", () => {
    expect(normalizeTmpExt(".TXT ")).toBe("txt");
    expect(normalizeTmpExt("md")).toBe("md");
    expect(normalizeTmpExt("a".repeat(16))).toBe("a".repeat(16));
    expect(normalizeTmpExt("a".repeat(17))).toBe("");
    expect(normalizeTmpExt("../x")).toBe("");
    expect(normalizeTmpExt("tar.gz")).toBe("");
    expect(normalizeTmpExt("")).toBe("");
    expect(normalizeTmpExt(undefined)).toBe("");
  });
});
