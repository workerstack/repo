import path from "node:path";

import { describe, expect, it } from "vitest";

import { workspacePaths } from "./persist-plan-validate.ts";
import { canonicalPath } from "./workspace-root.ts";

describe("workspacePaths absolute paths", () => {
  it("finds absolute workspace paths with either separator on Windows and drops outside ones", () => {
    const ws = "C:\\Users\\me\\repo";
    const text = [
      "1.1 [ ] edit `C:\\Users\\me\\repo\\src\\a.ts`.",
      "1.2 [ ] edit C:/Users/me/repo/src/b.ts and c:\\users\\me\\repo\\src\\c.ts",
      "1.3 [ ] leave C:\\Users\\me\\other\\x.ts and C:\\Users\\me\\repository\\y.ts",
    ].join("\n");
    expect(workspacePaths(ws, text, path.win32)).toStrictEqual([
      "C:\\Users\\me\\repo\\src\\a.ts",
      "C:/Users/me/repo/src/b.ts",
      "c:\\users\\me\\repo\\src\\c.ts",
    ]);
  });

  it("finds posix workspace paths and drops a sibling with the same prefix", () => {
    const text = "edit /home/me/repo/src/a.ts: and /home/me/repo2/x.ts";
    expect(workspacePaths("/home/me/repo", text, path.posix)).toStrictEqual(["/home/me/repo/src/a.ts"]);
  });
});

describe("workspacePaths relative paths", () => {
  it("resolves repo-relative paths against the root and keeps worktree paths", () => {
    const ws = "/home/me/repo";
    // Relative paths resolve against the root's canonical spelling (macOS expands /home),
    // absolute ones stay as written.
    const top = canonicalPath(ws, path.posix);
    const text = [
      "1.1 [ ] edit `src/a.ts` and ./docs/x.md, then cli/scripts/w.mjs.",
      "1.2 [ ] also /home/me/repo/.worktrees/w/src/b.ts, https://example.com/a.ts and wt/<name>, and/or main/master",
      "1.3 [ ] not ../outside/y.ts",
    ].join("\n");
    expect(workspacePaths(ws, text, path.posix)).toStrictEqual([
      "/home/me/repo/.worktrees/w/src/b.ts",
      path.posix.join(top, "src/a.ts"),
      path.posix.join(top, "docs/x.md"),
      path.posix.join(top, "cli/scripts/w.mjs"),
    ]);
  });

  it("resolves repo-relative paths with Windows separators", () => {
    const ws = "C:\\Users\\me\\repo";
    const text = "edit src\\a.ts and C:\\Users\\me\\other\\x.ts";
    expect(workspacePaths(ws, text, path.win32)).toStrictEqual(["C:\\Users\\me\\repo\\src\\a.ts"]);
  });
});
