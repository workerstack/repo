// The README generator's suites share a docs-pack context over in-memory files and the first output's text.
import type { Pack } from "../../config.ts";
import type { SyncContext } from "../outputs.ts";
import type { PackageJson, WorkspacePackage } from "../workspace.ts";
import { context as contextOf } from "./context-kit.ts";

/** A public root, the only kind that gets a README. */
export const PUBLIC: PackageJson = { name: "@acme/lib", private: false };

type Fixture = {
  packs?: Pack[];
  manifest?: PackageJson;
  packages?: WorkspacePackage[];
  files?: Record<string, string>;
};

/** A sync context over in-memory files, with the docs pack on and a public root unless told otherwise. */
export function context({ packs = ["docs"], manifest = PUBLIC, packages = [], files = {} }: Fixture = {}): SyncContext {
  return contextOf({ files, manifest, packages, packs });
}

/** The text of the first output of a generator result. */
export function textOf(result: { outputs: { kind: string; content?: string }[] }): string {
  return result.outputs[0]?.content ?? "";
}
