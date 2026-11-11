import { NOT_FOUND } from "./update-world.ts";
import type { Reply } from "./update-world.ts";

/** A root with a catalog pin and a stale devDependency, one package with a stale range and one with a range and a 404. */
export const BASE: Record<string, unknown> = {
  "package.json": {
    name: "root",
    private: true,
    workspaces: { packages: ["packages/*"], catalog: { zod: "^3.24.1" } },
    devDependencies: { typescript: "5.8.3" },
  },
  "packages/api/package.json": {
    name: "api",
    dependencies: { "left-pad": "1.3.0", zod: "catalog:" },
    devDependencies: { vitest: "^5.0.1" },
  },
  "packages/web/package.json": { name: "web", dependencies: { "@acme/kit": "^1.0.0", react: ">=18 <20" } },
};

export const REPLIES: Record<string, Reply> = {
  zod: "4.1.12",
  typescript: "5.9.3",
  vitest: "5.1.0",
  "left-pad": "1.3.0",
  "@acme/kit": NOT_FOUND,
  react: "19.0.0",
};

export const CHECK_BEHIND = [
  "3 behind of 4 checked:",
  "  zod         catalog              ^3.24.1 → ^4.1.12  major",
  "  typescript  package.json         5.8.3 → 5.9.3",
  "  vitest      packages/api         ^5.0.1 → ^5.1.0",
  'skipped 2: react in packages/web is ">=18 <20", not a plain version; @acme/kit is not on the registry',
  "run `bun repo update` to write them, or `bun repo update <name>` for some",
];

export const UPDATED =
  "updated 3: zod ^3.24.1 → ^4.1.12 in the catalog, typescript 5.8.3 → 5.9.3 in package.json, vitest ^5.0.1 → ^5.1.0 in packages/api";
