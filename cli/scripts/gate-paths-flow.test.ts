import { expect, it } from "vitest";

import { bashTargetsDenylist } from "./gate-paths.ts";

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
  for (const cmd of denied) expect(bashTargetsDenylist(cmd), cmd).toBe(true);
});

it("bashTargetsDenylist: passes denied names that are only data", () => {
  for (const cmd of passes) expect(bashTargetsDenylist(cmd), cmd).toBe(false);
});
