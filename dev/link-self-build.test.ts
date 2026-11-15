import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { useTempDirs } from "../cli/__fixtures__/temp-dirs.ts";
import { linkAndSync } from "./link-self.ts";

const { tempDir } = useTempDirs("self-link-build-");

// Windows needs a bun shim in `.bin` to link; "linkSelf bin on win32" in link-self.test.ts covers that path.
describe.skipIf(process.platform === "win32")("linkAndSync build", () => {
  it("builds in the root before the sync, and skips the sync with the build's exit code when it fails", () => {
    const dir = tempDir();
    fs.mkdirSync(path.join(dir, "bin"));
    fs.writeFileSync(path.join(dir, "bin", "repo.ts"), "bin\n");
    const calls: string[] = [];

    function sync() {
      calls.push("sync");

      return 0;
    }

    function build(cwd: string) {
      calls.push(`build ${cwd}`);

      return 0;
    }

    expect(linkAndSync(dir, sync, build)).toBe(0);
    expect(calls).toStrictEqual([`build ${dir}`, "sync"]);
    calls.length = 0;
    expect(linkAndSync(dir, sync, () => 2)).toBe(2);
    expect(calls).toStrictEqual([]);
  });
});
