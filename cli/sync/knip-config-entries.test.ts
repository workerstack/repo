import { expect, it } from "vitest";

import { knipWorkspace, parsedKnip } from "./__fixtures__/knip-kit.ts";
import { useTempDirs } from "./__fixtures__/temp-dirs.ts";
import type { Workspace } from "./workspace.ts";

useTempDirs();

const KNIP_DEFAULTS = [
  "{index,cli,main}.{js,mjs,cjs,jsx,ts,tsx,mts,cts}!",
  "src/{index,cli,main}.{js,mjs,cjs,jsx,ts,tsx,mts,cts}!",
];

/** A temp root holding the empty `files`, with one package at packages/api. */
function workspace(files: readonly string[] = []): Workspace {
  return knipWorkspace({}, [{ dir: "packages/api", manifest: {} }], files);
}

it("makes each listed *.config.ts and *.worker.ts file an entry of the workspace holding it, and no glob", () => {
  const listed = ["a.config.ts", "packages/api/w.worker.ts", "packages/api/x.ts", "z.ts"];

  expect(parsedKnip(workspace(), [], listed)).toMatchObject({
    workspaces: {
      ".": { entry: [...KNIP_DEFAULTS, "a.config.ts"] },
      "packages/api": { entry: [...KNIP_DEFAULTS, "w.worker.ts"] },
    },
  });
});

it("leaves out a config file on disk that git does not list, as a gitignored one", () => {
  const ws = workspace(["a.config.ts", "ignored/b.config.ts"]);

  expect(parsedKnip(ws, [], ["a.config.ts"])).toMatchObject({
    workspaces: { ".": { entry: [...KNIP_DEFAULTS, "a.config.ts"] } },
  });
});

it("keeps the two globs outside git, where no listing exists", () => {
  expect(parsedKnip(workspace(), [], null)).toMatchObject({
    workspaces: { ".": { entry: [...KNIP_DEFAULTS, "**/*.config.ts", "**/*.worker.ts"] } },
  });
});

it("lists a listed vitest.config.ts once, and a .mts vitest config as its own entry", () => {
  const files = ["vitest.config.ts", "packages/api/vitest.unit.config.mts"];

  expect(parsedKnip(workspace(files), [], files)).toMatchObject({
    workspaces: {
      ".": { entry: [...KNIP_DEFAULTS, "vitest.config.ts"], vitest: { config: ["vitest.config.ts"] } },
      "packages/api": { entry: [...KNIP_DEFAULTS, "vitest.unit.config.mts"] },
    },
  });
});
