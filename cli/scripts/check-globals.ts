/**
 * Assert every payload leaf in `agents/global-settings/` is present in its
 * $HOME dest (generic subset check, skips keys matching `skipKeyPattern`), and
 * that the project `.grok/config.toml` sets no [features] or [agent].
 */
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import { parse as parseToml } from "smol-toml";

import { repoEnv } from "../repo-env.ts";
import { ALL_HOSTS, APPLY_HINT, NOT_FOUND_CODE, PROJECT_REL } from "./check-globals.constants.ts";
import { nonEmptyOr } from "./emit-inputs.ts";
import { hostIdsOf, loadManifest, readDest, readPayload, resolveDest, shouldSkip } from "./global-settings-files.ts";
import { isRecord } from "./hook-input.ts";
import type { JsonObject } from "./sync-global-settings.types.ts";

/** One settings key whose payload value is missing or different in the dest. */
export type DriftEntry = {
  host: string;
  dest: string;
  key: string;
  kind: "missing" | "differs";
};

/** One host's check outcome: `ok`, drift (`missing`/`differs` entries), or an `unreadable` dest. */
export type HostStatus = {
  id: string;
  dest: string;
  state: "ok" | "drift" | "unreadable";
  drift: DriftEntry[];
};

export type CheckResult = {
  ok: boolean;
  drift?: DriftEntry[];
  error?: string;
};

type ProjectGrok = { error: string; value?: undefined } | { value: JsonObject; error?: undefined };

type Host = ReturnType<typeof loadManifest>["hosts"][number];

function isPlainObject(v: unknown): v is JsonObject {
  return v != null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date);
}

/** Leaf `[path, value]` pairs of a payload; arrays and dates are leaves. */
function leaves(obj: JsonObject, skipRe: RegExp, prefix: string[] = []): [string[], unknown][] {
  const out: [string[], unknown][] = [];

  for (const [k, v] of Object.entries(obj)) {
    if (shouldSkip(k, skipRe)) continue;
    const next = [...prefix, k];

    if (isPlainObject(v)) out.push(...leaves(v, skipRe, next));
    else out.push([next, v]);
  }

  return out;
}

function valueAt(obj: unknown, keyPath: string[]): { found: false } | { found: true; value: unknown } {
  let cur = obj;

  for (const k of keyPath) {
    if (!isPlainObject(cur) || !Object.prototype.hasOwnProperty.call(cur, k)) return { found: false };
    cur = cur[k];
  }

  return { found: true, value: cur };
}

export function driftLine({ host, dest, key }: DriftEntry): string {
  return `drift: ${host} ${dest} ${key}; ${APPLY_HINT}`;
}

function readProjectGrok(abs: string): ProjectGrok {
  let raw: string;

  try {
    raw = fs.readFileSync(abs, "utf8");
  } catch (err) {
    if (isRecord(err) && err.code === NOT_FOUND_CODE) return { error: "missing project .grok/config.toml" };

    return { error: "unreadable project .grok/config.toml" };
  }

  try {
    return { value: parseToml(raw) };
  } catch {
    return { error: "unreadable project .grok/config.toml" };
  }
}

/** `h`'s status: unreadable when its dest cannot be read, else ok or each payload leaf the dest lacks or differs on. */
function hostStatus(h: Host, home: string, want: { payload: JsonObject; skipRe: RegExp }): HostStatus {
  let destValue: JsonObject;

  try {
    destValue = readDest(resolveDest(home, h.dest), h.format, h.dest);
  } catch {
    return { dest: h.dest, drift: [], id: h.id, state: "unreadable" };
  }

  const drift = leaves(want.payload, want.skipRe).flatMap(([keyPath, value]): DriftEntry[] => {
    const have = valueAt(destValue, keyPath);

    if (have.found && isDeepStrictEqual(have.value, value)) return [];

    return [{ dest: h.dest, host: h.id, key: keyPath.join("."), kind: have.found ? "differs" : "missing" }];
  });

  return { dest: h.dest, drift, id: h.id, state: drift.length > 0 ? "drift" : "ok" };
}

/**
 * Per-host status for `host` ("all" or one id); an unreadable dest marks only its host. Throws on manifest or payload
 * errors.
 */
export function checkHosts({
  home,
  workspaceRoot,
  sourceRoot,
  consumerRoot,
  host = ALL_HOSTS,
}: {
  home: string;
  workspaceRoot: string;
  sourceRoot?: string | undefined;
  consumerRoot?: string | undefined;
  host?: string;
}): HostStatus[] {
  const src = nonEmptyOr(sourceRoot, workspaceRoot);
  const manifest = loadManifest(src);

  if (!hostIdsOf(manifest).has(host)) throw new Error(`unknown host: ${host}`);
  const skipRe = new RegExp(manifest.skipKeyPattern, "i");

  return manifest.hosts
    .filter((x) => host === ALL_HOSTS || x.id === host)
    .map((h) => hostStatus(h, home, { payload: readPayload(src, h, nonEmptyOr(consumerRoot, workspaceRoot)), skipRe }));
}

/** `grok ok · claude missing a,b differs c · …`: hosts in manifest order. */
export function checkLine(statuses: HostStatus[]): string {
  return statuses
    .map((s) => {
      if (s.state !== "drift") return `${s.id} ${s.state}`;

      const parts = (["missing", "differs"] as const).flatMap((kind) => {
        const keys = s.drift.filter((d) => d.kind === kind).map((d) => d.key);

        return keys.length > 0 ? [`${kind} ${keys.join(",")}`] : [];
      });

      return `${s.id} ${parts.join(" ")}`;
    })
    .join(" · ");
}

/** The apply hint, shown only when some host has drifted. */
export function checkHint(statuses: HostStatus[]): string | null {
  return statuses.some((s) => s.state === "drift") ? APPLY_HINT : null;
}

/**
 * The error for a project `.grok/config.toml` that is missing, unreadable or sets [features]/[agent]; null when fine
 * or the same file as the home one.
 */
export function projectConfigError(workspaceRoot: string, home: string): string | null {
  const projectConfig = path.resolve(workspaceRoot, PROJECT_REL);

  if (projectConfig === path.resolve(home, PROJECT_REL)) return null;
  const project = readProjectGrok(projectConfig);

  if (project.error !== undefined) return project.error;

  if (Object.hasOwn(project.value, "features") || Object.hasOwn(project.value, "agent"))
    return "project .grok/config.toml must not set [features] or [agent]";

  return null;
}

/**
 * Manifest and payloads come from `sourceRoot` (default `workspaceRoot`), each replaced by a file of its name under
 * `consumerRoot`'s `.repo/global-settings/` (default `workspaceRoot`); the project `.grok/config.toml` from
 * `workspaceRoot`.
 */
export function checkGlobals({
  home,
  workspaceRoot,
  sourceRoot,
  consumerRoot,
}: {
  home?: string;
  workspaceRoot?: string;
  sourceRoot?: string | undefined;
  consumerRoot?: string | undefined;
} = {}): CheckResult {
  const homeDir = nonEmptyOr(home, nonEmptyOr(repoEnv.process.HOME, ""));
  const ws = nonEmptyOr(workspaceRoot, process.cwd());

  if (homeDir === "") return { error: `HOME required; ${APPLY_HINT}`, ok: false };
  let statuses: HostStatus[];

  try {
    statuses = checkHosts({ consumerRoot, home: homeDir, sourceRoot, workspaceRoot: ws });
  } catch (err) {
    return { error: (err /* checkHosts throws only Error values */ as Error).message, ok: false };
  }

  const unreadable = statuses.find((s) => s.state === "unreadable");

  if (unreadable !== undefined) return { error: `unreadable dest: ${unreadable.dest}; ${APPLY_HINT}`, ok: false };
  const drift = statuses.flatMap((s) => s.drift);

  if (drift.length > 0) return { drift, ok: false };
  const error = projectConfigError(ws, homeDir);

  return error === null ? { drift, ok: true } : { error, ok: false };
}
