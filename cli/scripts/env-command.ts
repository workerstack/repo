/**
 * `bun repo env <verb>`: init, set, get, ls, run, export, key import, key ci and migrate over this repo's env files.
 * Hands the argv to the module of its verb; no verb or an unknown one prints the usage line, exit 4.
 */
import { main as edit } from "./env-edit.ts";
import { ioOf, usage, type EnvDeps } from "./env-io.ts";
import { main as keys } from "./env-keys.ts";
import { main as migrate } from "./env-migrate.ts";
import { main as values } from "./env-values.ts";

type Verb = (argv: string[], deps?: EnvDeps) => Promise<number>;

const VERBS: ReadonlyMap<string, Verb> = /* @__PURE__ */ new Map([
  ["export", values],
  ["get", values],
  ["init", keys],
  ["key", keys],
  ["ls", values],
  ["migrate", migrate],
  ["run", values],
  ["set", edit],
]);

/** Runs the verb `argv` names; see the file comment. */
export function main(argv: string[], deps?: EnvDeps): Promise<number> {
  const verb = VERBS.get(argv[0] ?? "");

  return verb === undefined ? Promise.resolve(usage(ioOf(deps))) : verb(argv, deps);
}
