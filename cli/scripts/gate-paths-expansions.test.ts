import { expect, it } from "vitest";

import { bashTargetsDenylist } from "./gate-paths.ts";

const nmDir = ["node", "modules"].join("_");

/** Commands bash reads past a substitution, an expansion, an ANSI-C quote or an escape into a denied path. */
const denied = [
  `rg foo $(echo) ${nmDir}`,
  `rg foo \`echo\` ${nmDir}`,
  `rg foo "$(echo)" ${nmDir}`,
  `rg foo "\`echo\`" ${nmDir}`,
  "cat bun\\.lock",
  "cat $'\\x64ist/a'",
  `rg ${nmDir} $X`,
  `rg ${nmDir} "\${X}"`,
  `$(echo cat) ${nmDir}`,
  `$X ${nmDir}`,
  `F=1 $X ${nmDir}`,
  `sh -c '$X ${nmDir}'`,
  `X=$(cat ${nmDir}/a)`,
];

/** Commands with an expansion, an escape or a pattern that read no denied path. */
const passes = [
  'rm -rf "$OUT/dist"',
  'mkdir -p "$TMP/build"',
  "cat 'bun\\.lock'",
  "rg -n 'bun\\.lock' cli",
  "awk '{print $1}' x | grep -v dist",
  'echo "$HOME" | cat',
];

it("bashTargetsDenylist: judges a command by every reading bash may give it", () => {
  for (const cmd of denied) expect(bashTargetsDenylist(cmd), cmd).toBe(true);
});

it("bashTargetsDenylist: passes an expansion or an escape that reads no denied path", () => {
  for (const cmd of passes) expect(bashTargetsDenylist(cmd), cmd).toBe(false);
});
