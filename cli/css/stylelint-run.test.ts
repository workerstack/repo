import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { cleanTemps, SLOW } from "../scripts/__fixtures__/turn-repo.ts";
import { cssKit, UNKNOWN_CSS } from "./__fixtures__/css-kit.ts";
import { main } from "./stylelint-run.ts";

const saved = process.cwd();
afterEach(() => {
  process.chdir(saved);
  cleanTemps();
});

/** `main` on `argv` in the cwd: what it wrote to its stdout and its stderr, and the exit code it gave. */
async function run(argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(
    argv,
    (text) => out.push(text),
    (text) => err.push(text),
  );
  return { code, err, out };
}

it("writes the sheets' results as json to stdout and exits 0", { timeout: SLOW }, async () => {
  const root = cssKit({ "src/unknown.css": UNKNOWN_CSS });
  process.chdir(root);
  const { code, err, out } = await run(["src/unknown.css"]);
  expect({ code, err }).toStrictEqual({ code: 0, err: [] });
  expect(out.map((text) => JSON.parse(text))).toStrictEqual([
    [
      {
        invalid: [],
        source: path.join(root, "src/unknown.css"),
        warnings: [
          {
            column: 3,
            line: 2,
            rule: "property-no-unknown",
            severity: "error",
            text: 'Unknown property "colr" (property-no-unknown)',
          },
        ],
      },
    ],
  ]);
});

it("writes why Stylelint threw as one stderr line, nothing to stdout, and exits 1", { timeout: SLOW }, async () => {
  process.chdir(cssKit({ "src/unknown.css": UNKNOWN_CSS }));
  // A NUL byte in a path makes Stylelint's file lookup throw on every platform: Node refuses it before any syscall.
  const { code, err, out } = await run(["src/a\0.css"]);
  expect({ code, out }).toStrictEqual({ code: 1, out: [] });
  expect(err).toStrictEqual([expect.stringMatching(/^TypeError \[ERR_INVALID_ARG_VALUE\]: [^\n]+\n$/)]);
});
