import fs from "node:fs";
import path from "node:path";
import { apiRepo, oldTarball, PREFIX, TAG } from "./api-repo.ts";
import type { Declarations } from "./api-repo.ts";

export const TIMEOUT = 120_000;
/** The old version: three names and a subpath. */
export const OLD: Declarations = {
  index: "export declare const PACKS: number;\nexport declare const keep: string;\nexport declare const narrow: string;\n",
  x: "export declare const x: number;\n",
};
/** The checkout after it dropped `PACKS`, narrowed `narrow` and dropped the subpath. */
export const SHRUNK: Declarations = {
  index: "export declare const keep: string;\nexport declare const narrow: string | number;\n",
};
const REMOVED = "mark the commit that removed it with `!` or a `BREAKING CHANGE:` footer";
export const REMOVAL_LINES =
  `${PREFIX}\`PACKS\` in "." was removed since old.tgz, and no commit since ${TAG} is breaking: ${REMOVED}\n` +
  `${PREFIX}\`narrow\` in "." narrowed since old.tgz (a old.tgz value no longer fits it), and no commit since ${TAG} is breaking: mark it breaking, or keep the old shape\n` +
  `${PREFIX}"./x" was removed since old.tgz, and no commit since ${TAG} is breaking: ${REMOVED}\n`;
export const REMOVAL_OK = `${PREFIX}old.tgz → this checkout · 1 code subpath · 0 added, 0 widened, 3 breaking · ok\n`;
export const FEAT_TAIL = `, and no commit since ${TAG} is a feat: commit them as \`feat\`\n`;

/** Puts the old version's tarball beside the repo as `old.tgz`. */
export function withOld(dir: string, declared: Declarations = OLD, exports?: Record<string, unknown>): string {
  fs.copyFileSync(oldTarball(declared, exports), path.join(dir, "old.tgz"));
  return dir;
}

/** A repo whose checkout dropped names and a subpath from `OLD`, with `old.tgz` beside it. */
export const removal = (...messages: string[]): string => withOld(apiRepo(SHRUNK, messages));

/** A repo whose checkout adds a name and a subpath to `OLD`, with `old.tgz` beside it. */
export function addition(...messages: string[]): string {
  const index = `${OLD.index}export declare const fresh: number;\n`;
  return withOld(apiRepo({ index, x: OLD.x, y: OLD.x }, messages));
}
