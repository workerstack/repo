import path from "node:path";

import { describe, expect, it } from "vitest";

import { put, useTempDirs } from "../sync/fixtures/temp-dirs.ts";
import { ignoreRepo } from "./fixtures/ignore-kit.ts";
import { shellIgnoreEdits } from "./shell-ignore-edits.ts";

useTempDirs();

describe("shellIgnoreEdits", () => {
  const forms = [
    "echo .tmp/ > packages/a/.gitignore",
    "echo '.tmp/' >> packages/a/.gitignore",
    "printf '.tmp/\\n' >> packages/a/.gitignore",
    "cat <<'EOF' >> packages/a/.gitignore\n.tmp/\nEOF",
    "cat > packages/a/.gitignore <<EOF\n.tmp/\nEOF",
    "echo .tmp/ | tee -a packages/a/.gitignore",
    "tee packages/a/.gitignore <<'EOF'\n.tmp/\nEOF",
  ];
  it.each(forms)("reads the added lines of %j", (command) => {
    const r = ignoreRepo();
    put(r, "packages/a/.gitignore", "out/\n");
    expect(shellIgnoreEdits(command, r)).toStrictEqual([
      { added: [".tmp/"], file: path.join(r, "packages/a/.gitignore") },
    ]);
  });

  const passes = [
    "cd packages/a && echo .tmp/ >> .gitignore",
    "echo $X >> packages/a/.gitignore",
    "printf '%s\\n' x >> packages/a/.gitignore",
    "sed -i 's/a/b/' packages/a/.gitignore",
    "cat <<EOF >> packages/a/.gitignore\n$HOME\nEOF",
  ];
  it.each(passes)("leaves %j alone", (command) => {
    expect(shellIgnoreEdits(command, ignoreRepo())).toStrictEqual([]);
  });
});
