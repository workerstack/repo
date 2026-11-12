import path from "node:path";

import { describe, expect, it } from "vitest";

import type { Json } from "../json.ts";
import { put, tempDir, useTempDirs } from "../sync/__fixtures__/temp-dirs.ts";
import { packageBin } from "./package-bin.ts";

useTempDirs();

/** A package dir whose package.json holds `manifest`; the manifest's path. */
function manifestOf(manifest: Json): string {
  const dir = tempDir("workerstack-package-bin-");
  put(dir, "package.json", JSON.stringify(manifest));

  return path.join(dir, "package.json");
}

describe("packageBin", () => {
  it("joins the named bin to the manifest's dir", () => {
    const manifest = manifestOf({ bin: { other: "o.js", tool: "bin/tool.js" } });
    expect(packageBin(manifest, "tool")).toBe(path.join(path.dirname(manifest), "bin", "tool.js"));
  });

  it.each([[{}], [{ bin: "tool.js" }], [{ bin: { other: "o.js" } }], [[]]])(
    "throws when the manifest %j declares no such bin",
    (manifest) => {
      const file = manifestOf(manifest);
      expect(() => packageBin(file, "tool")).toThrow(`${file} declares no bin tool`);
    },
  );
});
