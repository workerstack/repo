/**
 * A consumer of the fake `@acme/script-env` (./index.ts) for the `bun repo env migrate` tests, planted in an
 * env-repo.ts temp repo with the package linked at `node_modules/@acme/script-env`. Every secret is a fake made per
 * test:
 *
 *   repo.script-env.ts                 the parent: plain values, a credential-shaped plain literal, a `$` value
 *   projects/shop/shop.worker-env.ts   the child (`parent: repoEnv`): two secret(), a flagged literal, a spread
 *   projects/shop/deploy.ts            the helper sites: secretKeysOf (line 5) and unwrapSecrets (line 6)
 *   packages/script-env/src/index.ts   the package source, the file that defines createScriptEnv
 *   packages/script-env/src/script-env.test.ts   a test that calls createScriptEnv
 *   tools.script-env.ts                with `broken`: calls createScriptEnv, then throws at load
 *   projects/shop/tsconfig.json        with `isolated`: extends a root tsconfig.base.json setting isolatedDeclarations
 *   projects/shop/__fixtures__/old.script-env.ts   with `fixture`: a fixture that calls createScriptEnv
 *
 * The repo is committed, as migrate writes no file with uncommitted changes. With `spreadless`, the child's local block
 * holds no spread, as an isolatedDeclarations migrate refuses one.
 *
 * With `pid`, the child's local spread is given the pid of the process that loads it, so each load reads another value.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { envRepo, fakeSecret, type EnvWorld } from "../env-repo.ts";

export const PARENT_REL = "repo.script-env.ts";
export const CHILD_REL = "projects/shop/shop.worker-env.ts";
export const HELPER_REL = "projects/shop/deploy.ts";
export const DEFINES_REL = "packages/script-env/src/index.ts";
export const TEST_REL = "packages/script-env/src/script-env.test.ts";
export const BROKEN_REL = "tools.script-env.ts";
export const FIXTURE_REL = "projects/shop/__fixtures__/old.script-env.ts";

/** The specifier the consumer imports the package by. */
export const OLD_SPECIFIER = "@acme/script-env";
/** The import of a file that calls createScriptEnv and secret. */
export const OLD_IMPORT = 'import { createScriptEnv, secret } from "@acme/script-env";\n';

const PACKAGE_JSON = "packages/script-env/package.json";
const PACKAGE_SOURCE = path.join(path.dirname(fileURLToPath(import.meta.url)), "index.ts");

/** The fakes the tree holds: a parent's flagged literal, the child's two secret() and its flagged literal. */
export type ScriptSecrets = {
  readonly credential: string;
  readonly hook: string;
  readonly mail: string;
  readonly payment: string;
};

/** Where each fake sits once migrated: its file, its key, and the fake. */
export type SealedAt = readonly [rel: string, key: string, value: string];

/** How the tree is planted. */
export type TreeOptions = {
  readonly broken?: boolean;
  readonly fixture?: boolean;
  readonly isolated?: boolean;
  readonly keyed?: boolean;
  readonly pid?: boolean;
  readonly spreadless?: boolean;
};

/** New fakes, one per value the tree seals. */
export function scriptSecrets(): ScriptSecrets {
  return { credential: fakeSecret(), hook: fakeSecret(), mail: fakeSecret(), payment: fakeSecret() };
}

/** Each fake of `s` as the migrated tree holds it. */
export function sealedAt(s: ScriptSecrets): SealedAt[] {
  return [
    [PARENT_REL, "STRIPE_SECRET_KEY", s.credential],
    [CHILD_REL, "HOOK_TOKEN", s.hook],
    [CHILD_REL, "PAYMENT_TOKEN", s.payment],
    [CHILD_REL, "MAIL_API_KEY", s.mail],
  ];
}

/** A file exporting `name = call({ ...blocks })` after `head`, the import and its blank line. */
export function scriptEnvFile(
  blocks: readonly string[],
  { call = "createScriptEnv", head = OLD_IMPORT, name = "shopEnv" } = {},
): string {
  return [head, `export const ${name} = ${call}({`, ...blocks, "});", ""].join("\n");
}

const PARENT_HEAD = [
  'import { createScriptEnv } from "@acme/script-env";',
  "",
  "// The repo's values, every project's base.",
].join("\n");

/** The parent: global plain values, a credential-shaped literal and a `$` value, and one plain value per scope. */
function parentFile(s: ScriptSecrets): string {
  return scriptEnvFile(
    [
      "  global: {",
      '    CLOUDFLARE_ACCOUNT_ID: "fake-account",',
      `    STRIPE_SECRET_KEY: "${s.credential}",`,
      '    PRICE_TEMPLATE: "$9 a month",',
      "  },",
      '  local: { APEX_DOMAIN: "localhost" },',
      '  dev: { APEX_DOMAIN: "dev.shop.example" },',
      '  prod: { APEX_DOMAIN: "shop.example" },',
    ],
    { head: PARENT_HEAD, name: "repoEnv" },
  );
}

/** The head of the child: its imports and the local function its local block spreads. */
export const CHILD_HEAD = [
  OLD_IMPORT,
  'import { repoEnv } from "../../repo.script-env.ts";',
  "",
  "/** The local-only values, built at load. */",
  "function localVars(prefix: string): Record<string, string> {",
  "  return { LOCAL_PREFIX: prefix };",
  "}",
  "",
].join("\n");

/** The child: stacks on the parent, a spread in local (of the loading pid with `pid`), two secret(), a flagged literal. */
function childFile(s: ScriptSecrets, { pid = false, spreadless = false }: TreeOptions): string {
  const prefix = pid ? "String(process.pid)" : '"shop"';
  const local = spreadless ? 'local: { PORT: "8787" },' : `local: { ...localVars(${prefix}), PORT: "8787" },`;

  return scriptEnvFile(
    [
      "  parent: repoEnv,",
      `  ${local}`,
      `  dev: { HOOK_TOKEN: secret("${s.hook}") },`,
      "  prod: {",
      `    PAYMENT_TOKEN: secret("${s.payment}"),`,
      `    MAIL_API_KEY: "${s.mail}",`,
      '    APEX_DOMAIN: "shop.example",',
      "  },",
    ],
    { head: CHILD_HEAD },
  );
}

/** The helper sites: secretKeysOf on line 5, unwrapSecrets on line 6. */
export const HELPER_FILE = [
  'import { secretKeysOf, unwrapSecrets } from "@acme/script-env";',
  "",
  'import { shopEnv } from "./shop.worker-env.ts";',
  "",
  'export const secretKeys = secretKeysOf(shopEnv, "prod");',
  "export const vars = unwrapSecrets(shopEnv.prod);",
  "",
].join("\n");

const TEST_FILE = [
  'import { createScriptEnv, secret } from "./index.ts";',
  "",
  'export const probe = createScriptEnv({ local: {}, dev: {}, prod: { KEY: secret("fake-value") } });',
  "",
].join("\n");

const BROKEN_FILE = [
  'import { createScriptEnv } from "@acme/script-env";',
  "",
  'export const toolsEnv = createScriptEnv({ local: {}, dev: {}, prod: { TOOL: "fake-tool" } });',
  "",
  'throw new Error("tools env is broken");',
  "",
].join("\n");

const FIXTURE_FILE = [
  'import { createScriptEnv } from "@acme/script-env";',
  "",
  'export const oldEnv = createScriptEnv({ local: {}, dev: {}, prod: { OLD: "fake-old" } });',
  "",
].join("\n");

const ISOLATED = {
  "projects/shop/tsconfig.json": '{ "extends": "../../tsconfig.base.json" }\n',
  "tsconfig.base.json": '{ "compilerOptions": { "declaration": true, "isolatedDeclarations": true } }\n',
};

/** The tree's files, relative path to text. */
export function scriptTree(s: ScriptSecrets, options: TreeOptions = {}): Record<string, string> {
  const { broken = false, fixture = false, isolated = false } = options;

  return {
    [CHILD_REL]: childFile(s, options),
    [DEFINES_REL]: fs.readFileSync(PACKAGE_SOURCE, "utf8"),
    [HELPER_REL]: HELPER_FILE,
    [PARENT_REL]: parentFile(s),
    [TEST_REL]: TEST_FILE,
    [PACKAGE_JSON]: '{ "name": "@acme/script-env", "type": "module", "exports": "./src/index.ts" }\n',
    ...(broken ? { [BROKEN_REL]: BROKEN_FILE } : {}),
    ...(fixture ? { [FIXTURE_REL]: FIXTURE_FILE } : {}),
    ...(isolated ? ISOLATED : {}),
  };
}

/** Commits every tracked file of `w.repo`, so migrate finds none with uncommitted changes. */
export function commitAll(w: EnvWorld): void {
  const identity = ["-c", "user.name=acme", "-c", "user.email=acme@example.com", "-c", "commit.gpgsign=false"];
  execFileSync("git", [...identity, "commit", "-qm", "tree", "--no-verify"], { cwd: w.repo });
}

/** An env-repo.ts repo `acme` planted with the tree, the package linked where the consumer imports it. */
export async function scriptRepo(s: ScriptSecrets, options: TreeOptions = {}): Promise<EnvWorld> {
  const w = await envRepo({ files: scriptTree(s, options), keyed: options.keyed });
  fs.mkdirSync(path.join(w.repo, "node_modules/@acme"), { recursive: true });
  fs.symlinkSync(path.join(w.repo, "packages/script-env"), path.join(w.repo, "node_modules/@acme/script-env"), "dir");
  commitAll(w);

  return w;
}

/** The sha256 of `text`: what a test compares instead of a value, so no value reaches a failure message. */
export function hashOf(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** The sha256 of every file git tracks or would add in `w.repo` ("missing" for a tracked one deleted), by path. */
export function hashesOf(w: EnvWorld): Record<string, string> {
  const listed = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], { cwd: w.repo, encoding: "utf8" });
  const rels = [...new Set(listed.split("\n").filter((rel) => rel !== ""))].toSorted();
  const hashed = (rel: string): string => {
    const file = path.join(w.repo, rel);

    return fs.existsSync(file) ? hashOf(fs.readFileSync(file, "utf8")) : "missing";
  };

  return Object.fromEntries(rels.map((rel) => [rel, hashed(rel)]));
}
