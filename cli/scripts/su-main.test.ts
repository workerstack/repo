import { expect, it, vi } from "vitest";

import { useCapturedRun } from "../__fixtures__/captured-run.ts";
import { NOW, setup } from "./__fixtures__/su-kit.ts";
import { USAGE } from "./su.constants.ts";
import { main } from "./su.ts";

const captured = useCapturedRun();

function throwingRoots(): never {
  throw new Error("no root");
}

it("prints usage and exits 2 with no window and no session, an unknown flag or a stray argument", () => {
  const { roots } = setup(captured.temps);
  const argvs = [[], ["--bogus"], ["--session"], ["8h", "4h"], ["--session", "s", "--bogus"]];

  for (const argv of argvs) expect(main(argv, () => roots, NOW)).toBe(2);

  expect(captured.err).toStrictEqual(argvs.map(() => `${USAGE}\n`));
  expect(captured.out).toStrictEqual([]);
});

it("refuses a bad window with exit 2", () => {
  const { roots } = setup(captured.temps);

  expect(main(["5x"], () => roots, NOW)).toBe(2);
  expect(main(["0h"], () => roots, NOW)).toBe(2);
  expect(main(["--session", "s", "soon"], () => roots, NOW)).toBe(2);
  expect(captured.err).toStrictEqual(
    ["5x", "0h", "soon"].map((w) => `repo su: bad window "${w}"; use 30m, 4h, 2d or overnight\n`),
  );
});

it("exits 1 with the message when the roots lookup throws", () => {
  expect(main(["8h"], throwingRoots)).toBe(1);
  expect(captured.err).toStrictEqual(["no root\n"]);
});

it("finds its roots from the working directory and reads the real clock when none are given", () => {
  const { root } = setup(captured.temps);

  vi.stubEnv("CLAUDE_PROJECT_DIR", "");
  vi.stubEnv("GROK_WORKSPACE_ROOT", "");
  process.chdir(root);

  try {
    expect(main(["1m"])).toBe(0);
  } finally {
    vi.unstubAllEnvs();
  }

  expect(captured.out.join("")).toMatch(/^since \d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z \(1m\): nothing changed\n$/);
});
