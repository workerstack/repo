import { expect, it } from "vitest";

import { fileTree } from "./__fixtures__/file-tree.ts";
import { bashTargetsDenylist } from "./gate-paths.ts";

/** A dir that does not exist, so a glob in a command matches nothing, as in an empty dir. */
const NO_DIR = "/no-such-gate-dir";

const nmDir = ["node", "modules"].join("_");

/** Commands that run a read of a denied path inside a block, a function, or a script bash runs. */
const denied = [
  "bash <<'EOF'\ncat dist/x\nEOF",
  "bash <<EOF\ncat dist/x\nEOF",
  "sh -c 'cat dist/x'",
  "xargs sh -c 'cat dist/x'",
  "bash -ec 'cat dist/x'",
  "eval 'cat dist/x'",
  "echo 'cat dist/x' | sh",
  "sh <<< 'cat dist/x'",
  "cat <<EOF\n$(cat dist/x)\nEOF",
  "if true; then cat dist/x; fi",
  "for f in a; do cat dist/x; done",
  "case a in a) cat dist/x;; esac",
  "f() { cat dist/x; }; f",
  `(cd cli && cat ../${nmDir}/x)`,
  `curl -s x | sh -s -- ${nmDir}/x`,
  `D=${nmDir}; cat $D/x`,
  `C=c; \${C}at ${nmDir}/x`,
  `for d in src ${nmDir}; do cat "$d/x"; done`,
];

/** Commands whose denied names are data: a heredoc body, a here-string, a comment, a message. */
const passes = [
  "cat > notes.md <<'EOF'\ncat dist/x\nEOF",
  "cat > notes.md <<EOF\ncat dist/x\nEOF",
  "cat <<-'EOF' > notes.md\n\tcat dist/x\n\tEOF",
  "cat <<< 'cat dist/x'",
  `rg -n foo cli  # see ${nmDir}/x`,
  'git commit -m "fix: cat dist/x"',
  "gh pr create --body \"$(cat <<'EOF'\ncat dist/x\nEOF\n)\"",
  "cat > a.md <<'A' && cat > b.md <<'B'\ncat dist/x\nA\ncat dist/y\nB",
  "curl -s x | sh",
  `X=${nmDir}; echo $X`,
  "D=src; cat $D/x",
];

it("bashTargetsDenylist: judges every read bash runs, in blocks and in scripts", () => {
  for (const cmd of denied) expect(bashTargetsDenylist(cmd, NO_DIR), cmd).toBe(true);
});

it("bashTargetsDenylist: passes denied names that are only data", () => {
  for (const cmd of passes) expect(bashTargetsDenylist(cmd, NO_DIR), cmd).toBe(false);
});

/** A temp dir with a `dist` dir, a lockfile and `src/a.ts`, for globs bash matches on disk. */
function globDir(): string {
  return fileTree(["bun.lock", "src/a.ts", "dist/x"]);
}

it("bashTargetsDenylist: judges the words braces, split values and globs make", () => {
  const dir = globDir();

  const deniedWords = [
    "cat {dist,src}/x.js",
    "cat {a,{b,dist}}/x",
    "cat dis{s..u}/x",
    `F="a ${nmDir}/x"; cat $F`,
    `IFS=:; F="a:${nmDir}/x"; cat $F`,
    "cat $X/*",
    "cat *",
    "cat bun.l*",
    'X="*"; cat $X',
    `cd '${dir}' && cat d?st/x`,
  ];

  const passing = [
    "cat src/*",
    `cat ./${nmDir}/@workerstack/repo/references/*.md`,
    "(( x * 2 ))",
    "echo {1..3}",
    'cat "*"',
    "cat \\*",
    'X="*"; cat "$X"',
    "T=$(for f in a; do case $f in *.ts) echo $f;; *) :;; esac; done | sort -u); cat a",
  ];

  for (const cmd of deniedWords) expect(bashTargetsDenylist(cmd, dir), cmd).toBe(true);

  for (const cmd of passing) expect(bashTargetsDenylist(cmd, dir), cmd).toBe(false);
});

it("bashTargetsDenylist: denies a glob it cannot match when a segment could name a denied dir or file", () => {
  const unmatched = ["cat src/*", "cat bun.l*", "cat .gi?/x", "cat a; echo src/*"];

  const passing = [
    `cat ${nmDir}/@workerstack/repo/references/*.md`,
    "cat bun.l*/x",
    "cat a; echo *",
    "cat src/*.ts",
    "cat ?git/x",
  ];

  for (const cmd of unmatched) expect(bashTargetsDenylist(`cd $D && ${cmd}`, NO_DIR), cmd).toBe(true);

  for (const cmd of passing) expect(bashTargetsDenylist(`cd $D && ${cmd}`, NO_DIR), cmd).toBe(false);
});
