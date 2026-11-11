import { afterEach, expect, it } from "vitest";

import type { Pack } from "../config.ts";
import { docsGates } from "./ci-docs.ts";
import { main } from "./ci.ts";
import { bad, OK, PASSED, plant } from "./fixtures/ci-run.ts";
import { cleanTemps } from "./fixtures/turn-repo.ts";
import type { Captured } from "./lint.ts";

afterEach(cleanTemps);

/** `repo ci` over fakes, under `packs`, with `docs` answering `repo docs --check`. */
function ciWith(packs: Pack[], docs: Captured) {
  const out: string[] = [];
  const repoCalls: string[] = [];
  let clock = 0;
  const code = main([], {
    bins: { tsc: () => OK, vitest: () => PASSED },
    cwd: plant(),
    now: () => (clock += 500),
    packs,
    repo: (args) => {
      repoCalls.push(args.join(" "));
      return args[0] === "docs" ? docs : OK;
    },
    stderr: () => {},
    stdout: (s) => out.push(s),
    turbo: () => OK,
  });
  return { code, out: out.join(""), repoCalls };
}

it("under the docs pack a passing docs gate follows check and is counted in the summary", () => {
  const run = ciWith(["docs"], OK);
  expect(run.code).toBe(0);
  expect(run.out).toBe(
    "ci: check ok (0.5s)\nci: docs ok (0.5s)\nci: fmt ok (0.5s)\nci: typecheck 2 configs (0.5s)\n" +
      "ci: 4 tests passed (0.5s)\nci: check ok · docs ok · fmt ok · typecheck 2 configs · 4 tests passed\n",
  );
  expect(run.repoCalls).toStrictEqual(["check", "docs --check", "fmt --check"]);
});

it("a failing docs gate prints the findings under its line, later gates still run, exit 1", () => {
  const finding = "references/auth.md:14: example 2 fails to type-check: Property 'tokn' does not exist\n";
  const run = ciWith(["docs"], bad(finding));
  expect(run.code).toBe(1);
  expect(run.out).toContain(`ci: docs failed (0.5s)\n${finding}ci: fmt ok`);
  expect(run.out).toContain("ci: 4 tests passed");
});

it("a failing docs gate shows the command's stderr too", () => {
  const run = ciWith(["docs"], { code: 1, stderr: "boom\n", stdout: "" });
  expect(run.out).toContain("ci: docs failed (0.5s)\nboom\n");
});

it("without the docs pack there is no docs gate and the command is not run", () => {
  const run = ciWith(["agents", "workspace"], bad("never shown\n"));
  expect(run.out).not.toContain("docs");
  expect(run.repoCalls).toStrictEqual(["check", "fmt --check"]);
  expect(run.code).toBe(0);
});

it("docsGates is empty off the pack and holds one gate on it", () => {
  expect(docsGates([])).toStrictEqual([]);
  expect(docsGates(["docs"])).toHaveLength(1);
});

it("reads the docs pack from the config, so the docs gate runs when the config turns it on", async () => {
  const root = plant({ "workerstack.config.ts": 'export default { packs: ["docs"] };\n' });
  const seen: string[] = [];
  const out: string[] = [];
  const code = await main([], {
    bins: { tsc: () => OK, vitest: () => PASSED },
    cwd: root,
    now: () => 0,
    repo: (args) => {
      seen.push(args.join(" "));
      return OK;
    },
    stdout: (s) => out.push(s),
  });
  expect(code).toBe(0);
  expect(seen).toStrictEqual(["check", "docs --check", "fmt --check"]);
  expect(out.join("")).toContain("ci: docs ok (0.0s)\n");
});
