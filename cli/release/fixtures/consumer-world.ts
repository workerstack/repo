import fs from "node:fs";
import { tempDir, write } from "../../fixtures/planted-repo.ts";
import { spawnRunner } from "../../scripts/ci-wait-run.ts";
import type { Runner } from "../../scripts/ci-wait.ts";
import { releaseConsumer, tscScript } from "../consumer.ts";

export const TIMEOUT = 120_000;
const TSC = tscScript();
export const PREFIX = "repo release consumer: ";
export const OK = `${PREFIX}@acme/fx@1.0.0 · 4 exports, 5 subpaths · imports ok · types ok · publint ok · attw ok\n`;

export type Tools = { bun?: Runner; tar?: Runner; mkdtemp?: (prefix: string) => string; list?: (dir: string) => string[] };

/** Runs `release consumer` in `cwd`; the tools default to the real ones. */
export async function consume(cwd: string, argv: string[] = [], tools: Tools = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const tmp = tempDir();
  const made: string[] = [];
  const code = await releaseConsumer(argv, {
    cwd,
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    bun: tools.bun ?? spawnRunner("bun"),
    tar: tools.tar ?? spawnRunner("tar"),
    tmp,
    mkdtemp: (prefix) => {
      const dir = (tools.mkdtemp ?? fs.mkdtempSync)(prefix);
      made.push(dir);
      return dir;
    },
    list: tools.list ?? ((dir) => fs.readdirSync(dir)),
    rm: (dir) => fs.rmSync(dir, { recursive: true, force: true }),
    tsc: TSC,
  });
  return { code, out: out.join(""), err: err.join(""), tmp, made };
}

export type Fixture = {
  exports?: Record<string, unknown> | undefined;
  files?: Record<string, unknown>;
  /** Fields laid over the fixture's package.json. */
  manifest?: Record<string, unknown>;
};
export const EXPORTS = {
  ".": { types: "./src/index.ts", default: "./src/index.ts" },
  "./data": "./data.json",
  "./cfg/*": "./cfg/*.json",
  "./package.json": "./package.json",
};

/** The fixture's package.json. */
export const manifest = (exports: unknown) => ({ name: "@acme/fx", version: "1.0.0", type: "module", exports });

/** A package with a `.ts` entry importing a sibling, a JSON subpath and a `*` subpath, with no dependencies. */
export function fixture(options: Fixture = {}): string {
  const { files = {}, manifest: extra = {} } = options;
  const exports = "exports" in options ? options.exports : EXPORTS;
  const dir = tempDir();
  write(dir, {
    "package.json": { ...manifest(exports), ...extra },
    "src/index.ts": 'import { x } from "./x.ts";\nexport const y: number = x + 1;\n',
    "src/x.ts": "export const x = 1;\n",
    "data.json": { a: 1 },
    "cfg/a.json": {},
    "cfg/b.json": {},
    ...files,
  });
  return dir;
}

/** The fixture's package.json with a peer that is optional, so bun add leaves it out. */
export const withPeers = (peers: Record<string, string>) => ({
  ...manifest(EXPORTS),
  peerDependencies: peers,
  peerDependenciesMeta: Object.fromEntries(Object.keys(peers).map((peer) => [peer, { optional: true }])),
});

