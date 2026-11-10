import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { loadConfig } from "./config.ts";
import { wantedSettings } from "./github.ts";
import type { GithubManifest, WantedResult } from "./github.types.ts";
import { ciJobNames } from "./sync/release.ts";
import { readWorkspace } from "./sync/workspace.ts";

/** Either the wanted settings, a refusal of package.json's keywords, or the config or manifest that could not be read. */
export type WantedAtResult = WantedResult | { ok: false; errors: string[]; unreadable: true };

const manifestSchema = (): z.ZodType<GithubManifest, unknown> =>
  z.object({
    description: z.string().optional().catch(undefined),
    homepage: z.string().optional().catch(undefined),
    keywords: z.array(z.string()).optional().catch(undefined),
  });

/** The fields of `<root>/package.json` the settings come from; a field of the wrong type is as good as absent. */
function manifestOf(root: string): GithubManifest {
  try {
    return manifestSchema().parse(JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")));
  } catch {
    return {};
  }
}

/**
 * The settings the checkout at `root` wants: the CI job names come from its config and manifest, and the metadata from
 * package.json. A config or manifest that cannot be read is another check's line, so it is marked `unreadable`.
 */
export async function wantedAt(root: string): Promise<WantedAtResult> {
  const loaded = await loadConfig(root);
  if (!loaded.ok) return { ok: false, errors: loaded.errors, unreadable: true };
  const read = readWorkspace(root);
  if (!read.ok) return { ok: false, errors: read.errors, unreadable: true };
  const checks = ciJobNames({ config: loaded.config, workspace: read.workspace });
  return wantedSettings(manifestOf(root), checks);
}
