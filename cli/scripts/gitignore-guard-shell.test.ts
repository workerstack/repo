import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { useTempTree } from "../__fixtures__/temp-tree.ts";
import { shellIgnoreEdits } from "./shell-ignore-edits.ts";

const tree = useTempTree("ignore-shell-");

/** An empty temp dir, by its real path. */
function root() {
  return fs.realpathSync(tree({}));
}

const reads: [string, string[]][] = [
  ["echo -n .tmp/ >> pkg/.gitignore", [".tmp/"]],
  ["echo -e 'a\\nb' >> pkg/.gitignore", ["a", "b"]],
  ["echo -e 'a\\tb\\q' >> pkg/.gitignore", ["a\tbq"]],
  ["echo >> pkg/.gitignore", []],
  ["printf '100%%\\n' >> pkg/.gitignore", ["100%"]],
  ["echo .tmp/ | tee pkg/.gitignore > /dev/null", [".tmp/"]],
  ['echo ".tmp/" >> pkg/.gitignore', [".tmp/"]],
  ["cat <<-EOF >> pkg/.gitignore\n\t.tmp/\n\tEOF", [".tmp/"]],
  ["cat <<'EOF' >> pkg/.gitignore\n$HOME\nEOF", ["$HOME"]],
  ["echo a/ b/ >> pkg/.gitignore\n", ["a/ b/"]],
];

describe("shellIgnoreEdits reads literal text", () => {
  it.each(reads)("reads %j", (command, added) => {
    const r = root();
    expect(shellIgnoreEdits(command, r)).toStrictEqual([{ added, file: path.join(r, "pkg/.gitignore") }]);
  });

  it("names a target whose directory does not exist yet", () => {
    const r = root();
    expect(shellIgnoreEdits("echo x/ >> deep/new/.gitignore", r)).toStrictEqual([
      { added: ["x/"], file: path.join(r, "deep/new/.gitignore") },
    ]);
  });
});

const passes = [
  "",
  "echo a || echo b >> pkg/.gitignore",
  "echo 'unclosed >> pkg/.gitignore",
  'echo "$X" >> pkg/.gitignore',
  'echo "a\\b" >> pkg/.gitignore',
  "echo a > f | tee pkg/.gitignore",
  "echo a\\b >> pkg/.gitignore",
  "printf '%d\\n' >> pkg/.gitignore",
  "printf a b >> pkg/.gitignore",
  "printf >> pkg/.gitignore",
  "ls >> pkg/.gitignore",
  "echo 'a\\b' >> pkg/.gitignore",
  "echo a\nb >> pkg/.gitignore",
  "cat <<EOF >> pkg/.gitignore",
  "cat <<EOF >> pkg/.gitignore\n.tmp/\nOTHER",
  "cat <<EOF >> pkg/.gitignore\n$HOME\nEOF",
  "tee pkg/.gitignore",
  "echo x | tee",
  "echo x | tee pkg/.gitignore extra",
  "echo x | tee -a pkg/.gitignore > other",
  "echo x | cat",
  "cat pkg/other >> pkg/.gitignore",
  "echo x <<EOF >> pkg/.gitignore\nx\nEOF",
  "echo x",
  "echo x > ",
  "echo x > > pkg/.gitignore",
  "echo x >> pkg/notes.md",
  "echo x > a b",
];

describe("shellIgnoreEdits leaves anything it cannot read literally", () => {
  it.each(passes)("returns no edit for %j", (command) => {
    expect(shellIgnoreEdits(command, root())).toStrictEqual([]);
  });
});
