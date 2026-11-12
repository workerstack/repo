/** `repo check`: the installed `@workerstack/repo` must not be older than npm's `latest`. */
import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import {
  INSTALLED_MANIFEST,
  LATEST_TAG,
  LATEST_TIMEOUT_MS,
  NOT_FOUND_WHY,
  NO_LATEST_WHY,
  PACKAGE_NAME,
  SLASH,
  TRAILING_SLASH,
  behindLine,
  skippedLine,
} from "./check-latest.constants.ts";
import { REGISTRY } from "./release/release.constants.ts";
import { registryDoc } from "./release/wait.ts";
import type { Env } from "./repo-env.ts";

/** The problems (fail the check) and report lines (do not) of the latest-version check. */
export type LatestLines = { problems: string[]; report: string[] };

/** What the check fetches with: `fetch`, taking the abort signal that bounds the wait. */
export type LatestFetch = (url: string, init: { signal: AbortSignal }) => Promise<Response>;

function manifestSchema(): z.ZodType<{ version: string }> {
  return z.object({ version: z.string() });
}

/** The registry bun installs from: `BUN_CONFIG_REGISTRY`, then `NPM_CONFIG_REGISTRY`, else npm. */
export function latestRegistry(env: Env): string {
  return env.BUN_CONFIG_REGISTRY ?? env.NPM_CONFIG_REGISTRY ?? REGISTRY;
}

/** The version of `@workerstack/repo` installed under `cwd`; null when it is absent or unreadable. */
function installedVersion(cwd: string): string | null {
  const file = path.join(cwd, ...INSTALLED_MANIFEST);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = manifestSchema().safeParse(JSON.parse(fs.readFileSync(file, "utf8")));
    return parsed.success ? parsed.data.version : null;
  } catch {
    return null;
  }
}

function skipped(why: string): LatestLines {
  return { problems: [], report: [skippedLine(why)] };
}

/**
 * A problem when the installed `@workerstack/repo` is older than `latest` on `registry`; a report line when npm cannot
 * say.
 */
export async function checkLatestAt(cwd: string, fetcher: LatestFetch, registry: string): Promise<LatestLines> {
  const installed = installedVersion(cwd);
  if (installed === null) return { problems: [], report: [] };
  const base = registry.replace(TRAILING_SLASH, SLASH);
  function ask(url: string) {
    return fetcher(url, { signal: AbortSignal.timeout(LATEST_TIMEOUT_MS) });
  }
  const answer = await registryDoc(ask, PACKAGE_NAME, base);
  if (answer.kind === "missing") return skipped(NOT_FOUND_WHY);
  if (answer.kind === "unreachable") return skipped(answer.why);
  const latest = answer.doc["dist-tags"][LATEST_TAG];
  if (latest === undefined) return skipped(NO_LATEST_WHY);
  const isBehind = Bun.semver.order(installed, latest) < 0;
  return { problems: isBehind ? [behindLine(installed, latest)] : [], report: [] };
}
