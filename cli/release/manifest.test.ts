import { afterEach, describe, expect, it } from "vitest";
import { removePlanted, tempDir, write } from "../fixtures/planted-repo.ts";
import { isPublicPackage, parseManifest, readManifest } from "./manifest.ts";

afterEach(removePlanted);

describe("the manifest", () => {
  it("is parsed from text, private unless it says otherwise", () => {
    expect(parseManifest('{"name":"a","version":"1.0.0"}')).toStrictEqual({
      name: "a",
      version: "1.0.0",
      private: false,
    });
    expect(parseManifest('{"name":"a","version":"1.0.0","private":true}')?.private).toBe(true);
  });

  it("is null for text that is not a manifest", () => {
    expect(parseManifest("not json")).toBeNull();
    expect(parseManifest('{"name":"a"}')).toBeNull();
  });

  it("is read from the root's package.json, null when there is none", () => {
    const dir = tempDir();
    expect(readManifest(dir)).toBeNull();
    write(dir, { "package.json": { name: "a", version: "2.0.0" } });
    expect(readManifest(dir)).toStrictEqual({ name: "a", version: "2.0.0", private: false });
  });
});

describe("isPublicPackage", () => {
  it("is true only for a named package that says private false", () => {
    const dir = tempDir();
    expect(isPublicPackage(dir)).toBe(false);
    write(dir, { "package.json": { name: "a", version: "1.0.0" } });
    expect(isPublicPackage(dir)).toBe(false);
    write(dir, { "package.json": { name: "a", version: "1.0.0", private: false } });
    expect(isPublicPackage(dir)).toBe(true);
    write(dir, { "package.json": { private: false } });
    expect(isPublicPackage(dir)).toBe(false);
  });
});
