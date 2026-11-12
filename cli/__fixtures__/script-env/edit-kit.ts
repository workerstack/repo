/** What the env-migrate-edit.ts tests hand `migrateSource`: a stand-in seal, and the counts of a file with none. */
import { createHash } from "node:crypto";

import { OLD_SPECIFIER } from "./tree.ts";

/** The counts of a file with no createScriptEnv call. */
export const NONE_COUNTED = { credentials: [], plain: 0, secrets: 0, spreads: {}, values: 0 };

/** A stand-in for age: the sha256 of `value` as base64, so a test knows the cipher without a key. */
export function standInSeal(value: string): Promise<string> {
  return Promise.resolve(createHash("sha256").update(value).digest("base64"));
}

/** The fake package as `migrateSource` is told of it: its name, and the folder it sits in. */
export const OLD_PACKAGES: readonly { name: string; dir: string }[] = [{ dir: "packages/script-env", name: OLD_SPECIFIER }];

/** The options of `migrateSource` for `a.ts`, not isolated, the stand-in seal, the fake package. */
export function editOptions(extra: { file?: string; isolated?: boolean } = {}): {
  file: string;
  isolated: boolean;
  seal: (value: string) => Promise<string>;
  packages: readonly { name: string; dir: string }[];
} {
  return { file: "a.ts", isolated: false, packages: OLD_PACKAGES, seal: standInSeal, ...extra };
}
