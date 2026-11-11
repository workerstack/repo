import { apiDiff } from "../api-diff.ts";
import type { Change } from "../api-diff.ts";
import { DEP, DEP_B, DEP_B_CHANGED, GONE_DECLARATIONS, NEW_EXPORTS, NEW_INDEX, NEW_SRC, OLD_EXPORTS, OLD_INDEX, OLD_SRC } from "./api-files.ts";
import { apiWorld, plantDep } from "./api-world.ts";
import type { Version } from "./api-world.ts";

/** A file with nothing in it that matters. */
export const JS = "export {};\n";

const OLD_VERSION: Version = {
  version: "1.0.0",
  exports: OLD_EXPORTS,
  files: {
    "index.d.ts": OLD_INDEX,
    "index.js": JS,
    "gone.d.ts": GONE_DECLARATIONS,
    "gone.js": JS,
    "src.d.ts": OLD_SRC,
    "src.js": JS,
    "data.json": "{}\n",
    "extra.json": "{}\n",
    "agents/a.md": "a\n",
  },
};

const NEW_VERSION: Version = {
  version: "2.0.0",
  exports: NEW_EXPORTS,
  files: {
    "index.d.ts": NEW_INDEX,
    "index.js": JS,
    "fresh.d.ts": GONE_DECLARATIONS,
    "fresh.js": JS,
    "src.ts": NEW_SRC,
    "data.json": "{}\n",
  },
};

/** Installs the old and new fixture packages, each with its own copy of two dependencies, and diffs them. */
export function diffFixtures(): Change[] {
  const world = apiWorld(OLD_VERSION, NEW_VERSION);
  plantDep(world.roots.old, { name: "dep", version: "1.0.0", types: DEP });
  plantDep(world.roots.next, { name: "dep", version: "1.0.1", types: DEP });
  plantDep(world.roots.old, { name: "depb", version: "1.0.0", types: DEP_B });
  plantDep(world.roots.next, { name: "depb", version: "1.0.1", types: DEP_B_CHANGED });
  return apiDiff(world.project, world.old, world.next);
}
