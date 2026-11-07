import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";

/** Config packs a repo can turn on in workerstack.config.ts. */
export const PACKS = ["agents", "standards", "docs", "release", "workspace", "personal"] as const;
export type Pack = (typeof PACKS)[number];

export const CONFIG_FILE = "workerstack.config.ts";

const PACK_LIST = `${PACKS.slice(0, -1).join(", ")} or ${PACKS.at(-1)}`;

const packSchema = z.enum(PACKS, {
  error: (issue) => `${JSON.stringify(issue.input)} is not a pack; use ${PACK_LIST}`,
});

export const configSchema = z.strictObject(
  {
    packs: z
      .array(packSchema, { error: "must be a list of pack names" })
      .readonly()
      .superRefine((packs, ctx) => {
        const counts = new Map<Pack, number>();
        for (const pack of packs) counts.set(pack, (counts.get(pack) ?? 0) + 1);
        for (const [pack, count] of counts) {
          if (count === 1) continue;
          const times = count === 2 ? "twice" : `${count} times`;
          ctx.addIssue({ code: "custom", message: `${JSON.stringify(pack)} is listed ${times}` });
        }
      })
      .optional(),
  },
  { error: "the default export must be an object; use `export default defineConfig({ ... })`" },
);

export type WorkerstackConfig = z.input<typeof configSchema>;
export type ResolvedConfig = { readonly packs: readonly Pack[] };
export type LoadResult = { ok: true; config: ResolvedConfig } | { ok: false; errors: string[] };

/** Types a workerstack.config.ts default export. */
export function defineConfig(config: WorkerstackConfig): WorkerstackConfig {
  return config;
}

/** The packs a repo gets when its config omits `packs`. */
export function defaultPacks(hasWorkspaces: boolean): Pack[] {
  const packs: Pack[] = ["agents", "standards", "docs", "release"];
  if (hasWorkspaces) packs.push("workspace");
  return packs;
}

/** The nearest directory at or above `cwd` that holds workerstack.config.ts, or null. */
export function findRoot(cwd: string): string | null {
  let dir = path.resolve(cwd);
  for (;;) {
    if (fs.existsSync(path.join(dir, CONFIG_FILE))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Imports and validates `<root>/workerstack.config.ts`, filling omitted packs from `defaultPacks`. */
export async function loadConfig(root: string): Promise<LoadResult> {
  const fail = (messages: string[]): LoadResult => ({
    ok: false,
    errors: messages.map((message) => `${CONFIG_FILE}: ${message}`),
  });

  let loaded: Record<string, unknown>;
  try {
    loaded = await import(/* @vite-ignore */ pathToFileURL(path.join(root, CONFIG_FILE)).href);
  } catch (error) {
    return fail([`failed to load: ${messageOf(error)}`]);
  }
  if (!("default" in loaded)) return fail(["no default export; add `export default defineConfig({ ... })`"]);

  const parsed = configSchema.safeParse(loaded.default);
  if (!parsed.success) return fail(parsed.error.issues.flatMap(describeIssue));
  if (parsed.data.packs) return { ok: true, config: { packs: parsed.data.packs } };

  const manifest = readWorkspacesFlag(root);
  if (!manifest.ok) return { ok: false, errors: [`package.json: ${manifest.error}`] };
  return { ok: true, config: { packs: defaultPacks(manifest.hasWorkspaces) } };
}

const manifestSchema = z.object({ workspaces: z.unknown().optional() }, { error: "must be a JSON object" });

type WorkspacesFlag = { ok: true; hasWorkspaces: boolean } | { ok: false; error: string };

/** Whether the root package.json declares `workspaces`; a repo without one has none. */
function readWorkspacesFlag(root: string): WorkspacesFlag {
  const file = path.join(root, "package.json");
  if (!fs.existsSync(file)) return { ok: true, hasWorkspaces: false };
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }
  const manifest = manifestSchema.safeParse(raw);
  if (!manifest.success) return { ok: false, error: manifest.error.issues[0].message };
  return { ok: true, hasWorkspaces: manifest.data.workspaces !== undefined };
}

function describeIssue(issue: z.core.$ZodIssue): string[] {
  // ["packs", 1] reads packs[1]; a config path always starts at a top-level key.
  const at = issue.path
    .map((key) => (typeof key === "number" ? `[${key}]` : `.${String(key)}`))
    .join("")
    .replace(/^\./, "");
  const prefix = at ? `${at}: ` : "";
  if (issue.code === "unrecognized_keys") return issue.keys.map((key) => `${prefix}unknown key ${JSON.stringify(key)}`);
  return [`${prefix}${issue.message}`];
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
