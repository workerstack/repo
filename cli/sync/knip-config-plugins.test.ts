import { expect, it } from "vitest";
import { z } from "zod";

import { knipConfig } from "./knip-config.ts";

const DEFAULT_ENTRIES = [
  "{index,cli,main}.{js,mjs,cjs,jsx,ts,tsx,mts,cts}!",
  "src/{index,cli,main}.{js,mjs,cjs,jsx,ts,tsx,mts,cts}!",
  "**/*.config.ts",
  "**/*.worker.ts",
];

const generated = z.looseObject({ workspaces: z.record(z.string(), z.unknown()) });

it("makes each plugin file an entry of the workspace holding it, relative to that dir, the root otherwise", () => {
  const ws = {
    manifest: {},
    packages: [
      { dir: "packages/api", manifest: {} },
      { dir: "packages/api/inner", manifest: {} },
      { dir: "packages/web", manifest: {} },
    ],
    root: "/nowhere",
  };

  const plugins = ["lint/app.js", "packages/api/lint/a.mjs", "packages/api/inner/lint/b.ts", "packages/apix/c.js"];

  expect(generated.parse(JSON.parse(knipConfig(ws, { ignores: [], listed: null, plugins })))).toMatchObject({
    workspaces: {
      ".": { entry: [...DEFAULT_ENTRIES, "lint/app.js", "packages/apix/c.js"] },
      "packages/api": { entry: [...DEFAULT_ENTRIES, "lint/a.mjs"] },
      "packages/api/inner": { entry: [...DEFAULT_ENTRIES, "lint/b.ts"] },
      "packages/web": { entry: DEFAULT_ENTRIES },
    },
  });
});
