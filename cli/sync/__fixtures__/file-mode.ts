import fs from "node:fs";
import path from "node:path";
import { expect } from "vitest";

/** The permission bits of the file at `rel`. */
export const modeOf = (root: string, rel: string) => fs.statSync(path.join(root, rel)).mode & 0o777;
/** Whether any write bit is set on the file at `rel`. */
export const isWritable = (root: string, rel: string) => (modeOf(root, rel) & 0o222) !== 0;

/** Asserts the POSIX mode at `rel`; win32 keeps only a read-only flag, so there only whether it is read-only. */
export function expectMode(root: string, rel: string, posix: number): void {
  if (process.platform === "win32") expect(isWritable(root, rel), rel).toBe((posix & 0o222) !== 0);
  else expect(modeOf(root, rel), rel).toBe(posix);
}
