import { afterEach, describe, expect, it } from "vitest";

import { git as run, removePlanted, repoOnMain, tempDir } from "./__fixtures__/planted-repo.ts";
import { git, mainRef, showOnMain } from "./main-ref.ts";

afterEach(removePlanted);

describe("main-ref", () => {
  it("reads main's copy of a file, and null when git cannot show it", () => {
    const dir = repoOnMain({ "a.txt": "on main\n" });
    expect(mainRef(dir)).toBe("main");
    expect(showOnMain(dir, "main", "a.txt")).toBe("on main\n");
    expect(showOnMain(dir, "main", "missing.txt")).toBeNull();
    expect(showOnMain(dir, "no-such-ref", "a.txt")).toBeNull();
  });

  it("returns git's stdout, or null when git fails", () => {
    const dir = repoOnMain({ "a.txt": "x\n" });
    expect(git(dir, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe("feature\n");
    expect(git(dir, ["no-such-command"])).toBeNull();
  });

  it("has no main ref on the default branch itself or outside a repo", () => {
    const dir = repoOnMain({ "a.txt": "x\n" });
    run(dir, "checkout", "-q", "main");
    expect(mainRef(dir)).toBeNull();
    expect(mainRef(tempDir())).toBeNull();
  });
});
