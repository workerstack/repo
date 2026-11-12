import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import {
  BUGS_FIX,
  GIT_URL_PREFIX,
  HTTPS_PREFIX,
  LICENSE_FILE,
  LICENSE_ID,
  MANIFEST_EXPORT,
  MANIFEST_FILE,
  MIT_BODY,
  MODULE_TYPE,
  OWNER_MISSING,
  PUBLISH_ACCESS,
  REPOSITORY_FIX,
  REPOSITORY_TYPE,
  SUBPATH_PREFIX,
  TYPES_CONDITION,
  WHITESPACE,
} from "./check-public.constants.ts";
import type { ResolvedConfig } from "./config.ts";
import { isRecord, isString, type Json, type JsonObject, readJson } from "./json.ts";
import { keywordLines } from "./keyword-lines.ts";
import type { ResolvedOwner } from "./owner-config.ts";
import type { Workspace } from "./sync/workspace.ts";

function isText(value: Json | undefined): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isFilled(value: Json | undefined): boolean {
  return Array.isArray(value) && value.length > 0;
}

/** How a field reads in a line: `"x" is missing`, or `"x" is <value as JSON>`. */
function state(field: string, value: Json | undefined): string {
  return value === undefined ? `"${field}" is missing` : `"${field}" is ${JSON.stringify(value)}`;
}

function problem(field: string, value: Json | undefined, fix: string): string {
  return `${MANIFEST_FILE}: ${state(field, value)}; ${fix}`;
}

/** `package.json` as written; the workspace read has already shown it is a JSON object. */
function readManifest(root: string): JsonObject {
  return readJson(z.record(z.string(), z.json()), fs.readFileSync(path.join(root, MANIFEST_FILE), "utf8"));
}

function authorLines(author: Json | undefined, owner: ResolvedOwner): string[] {
  const name = isRecord(author) ? author.name : author;

  if (name === owner.name) return [];

  return [problem("author", author, `set it to ${JSON.stringify(owner.name)}, the owner in workerstack.config.ts`)];
}

function urlLines(url: Json | undefined): string[] {
  if (!isString(url)) return [problem("repository.url", url, `set it to a URL starting ${GIT_URL_PREFIX}`)];

  if (url.startsWith(GIT_URL_PREFIX)) return [];

  const fix = url.startsWith(HTTPS_PREFIX)
    ? `${GIT_URL_PREFIX}${url.slice(HTTPS_PREFIX.length)}`
    : `a URL starting ${GIT_URL_PREFIX}`;

  return [`${MANIFEST_FILE}: "repository.url" is ${url}; set it to ${fix}`];
}

function repositoryLines(repository: Json | undefined): string[] {
  if (!isRecord(repository)) return [problem("repository", repository, REPOSITORY_FIX)];

  const type =
    repository.type === REPOSITORY_TYPE
      ? []
      : [problem("repository.type", repository.type, `set it to "${REPOSITORY_TYPE}"`)];

  return [...type, ...urlLines(repository.url)];
}

/** One line per condition object under `subpath` that lists a later key before `types`. */
function orderLines(subpath: string, target: Json | undefined): string[] {
  if (!isRecord(target)) return [];
  const keys = Object.keys(target);
  const lines: string[] = [];

  if (keys.includes(TYPES_CONDITION) && keys[0] !== TYPES_CONDITION) {
    lines.push(
      `${MANIFEST_FILE}: exports "${subpath}" lists "${keys[0]}" before "${TYPES_CONDITION}"; ` +
        `put "${TYPES_CONDITION}" first`,
    );
  }

  for (const nested of Object.values(target)) lines.push(...orderLines(subpath, nested));

  return lines;
}

function exportLines(exported: Json | undefined): string[] {
  if (exported === undefined) return [problem("exports", exported, `list the entry points and "${MANIFEST_EXPORT}"`)];

  const subpaths =
    isRecord(exported) && Object.keys(exported).every((key) => key.startsWith(SUBPATH_PREFIX))
      ? exported
      : { [SUBPATH_PREFIX]: exported };

  const lines: string[] = [];

  if (!(MANIFEST_EXPORT in subpaths))
    lines.push(`${MANIFEST_FILE}: exports has no "${MANIFEST_EXPORT}"; add "${MANIFEST_EXPORT}": "${MANIFEST_EXPORT}"`);

  for (const [subpath, target] of Object.entries(subpaths)) lines.push(...orderLines(subpath, target));

  return lines;
}

function publishLines(publishConfig: Json | undefined): string[] {
  const set = isRecord(publishConfig) ? publishConfig : {};

  if (set.access === PUBLISH_ACCESS) return [];

  return [problem("publishConfig.access", set.access, `set it to "${PUBLISH_ACCESS}"`)];
}

function identityLines(manifest: JsonObject, owner: ResolvedOwner): string[] {
  const { description, keywords, license, homepage, bugs } = manifest;
  const lines: string[] = [];

  if (!isText(description))
    lines.push(problem("description", description, "write one line saying what the package does"));
  lines.push(...keywordLines(keywords));

  if (license !== LICENSE_ID) lines.push(problem("license", license, `set it to "${LICENSE_ID}"`));
  lines.push(...authorLines(manifest.author, owner), ...repositoryLines(manifest.repository));

  if (!isText(homepage)) lines.push(problem("homepage", homepage, "set it to the project page URL"));

  if (!isText(bugs) && !(isRecord(bugs) && isText(bugs.url))) lines.push(problem("bugs", bugs, BUGS_FIX));

  return lines;
}

function buildLines(manifest: JsonObject): string[] {
  const engines = isRecord(manifest.engines) ? manifest.engines : {};
  const lines: string[] = [];

  if (manifest.type !== MODULE_TYPE) lines.push(problem("type", manifest.type, `set it to "${MODULE_TYPE}"`));

  if (!isText(engines.bun)) lines.push(problem("engines.bun", engines.bun, `set it to ">=${Bun.version}"`));
  lines.push(...exportLines(manifest.exports));

  if (!isFilled(manifest.files)) lines.push(problem("files", manifest.files, "list what to publish"));

  return lines;
}

function manifestLines(manifest: JsonObject, owner: ResolvedOwner): string[] {
  return [...identityLines(manifest, owner), ...buildLines(manifest), ...publishLines(manifest.publishConfig)];
}

/** The LICENSE problem line, or none when the file is the MIT text naming the owner. */
function licenseLines(root: string, owner: ResolvedOwner): string[] {
  const file = path.join(root, LICENSE_FILE);

  if (!fs.existsSync(file)) return [`${LICENSE_FILE} is missing; add the ${LICENSE_ID} license naming ${owner.name}`];
  const text = fs.readFileSync(file, "utf8").replace(WHITESPACE, " ");

  if (text.includes(MIT_BODY) && text.includes(owner.name)) return [];

  return [
    `${LICENSE_FILE} is not the ${LICENSE_ID} license naming ${owner.name}; ` +
      `replace it with the ${LICENSE_ID} text and that name`,
  ];
}

/**
 * `repo check`'s public-package lines: under the release pack with a public root (`name` and `"private": false`),
 * each manifest field npm and GitHub need, and a LICENSE that is MIT and names the config's owner. Without an owner
 * the only line asks for it.
 */
export function checkPublic(root: string, workspace: Workspace, config: ResolvedConfig): string[] {
  const { name, private: isPrivate } = workspace.manifest;

  if (!config.packs.includes("release") || name === undefined || isPrivate !== false) return [];

  if (config.owner === undefined) return [OWNER_MISSING];

  return [...manifestLines(readManifest(root), config.owner), ...licenseLines(root, config.owner)];
}
