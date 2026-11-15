import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import type { KnipIgnore } from "../../knip-schema.ts";
import { knipConfig } from "../knip-config.ts";
import type { PackageJson, Workspace } from "../workspace.ts";
import { tempDir } from "./temp-dirs.ts";

/** A temp root holding the empty `files`, and a workspace of its manifest and packages. */
export function knipWorkspace(manifest: PackageJson, packages: Workspace["packages"], files: readonly string[] = []) {
  const root = tempDir("workerstack-knip-config-");

  for (const rel of files) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), "");
  }

  return { manifest, packages, root } satisfies Workspace;
}

const generated = z.looseObject({ workspaces: z.record(z.string(), z.unknown()) });

/** The generated config for `ignores` and the files git lists (null outside git), parsed. */
export function parsedKnip(ws: Workspace, ignores: readonly KnipIgnore[], listed: readonly string[] | null) {
  return generated.parse(JSON.parse(knipConfig(ws, { ignores, listed, plugins: [] })));
}
