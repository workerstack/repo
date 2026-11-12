import fs from "node:fs";

import { z } from "zod";

import { MAX_PERCENT, REWRITE_HINT, RUST_EXTENSION } from "./floors.constants.ts";

/** The floors of one TypeScript file, each an integer percent. */
export type TsFloor = { statements: number; branches: number; functions: number; lines: number };

/** The floors of one Rust file, each an integer percent; stable llvm-cov has no branches. */
export type RustFloor = { lines: number; functions: number; regions: number };

/**
 * The floors file: a root-relative POSIX path to its floors, a `.rs` key holding a Rust row and any other a
 * TypeScript row.
 */
export type Floors = Record<string, TsFloor | RustFloor>;

/** The shapes of the two row kinds, built once per read so the module runs no code. */
function schemas() {
  const percent = z.number().int().min(0).max(MAX_PERCENT);

  return {
    rust: z.strictObject({ functions: percent, lines: percent, regions: percent }),
    ts: z.strictObject({ branches: percent, functions: percent, lines: percent, statements: percent }),
  };
}

/** Whether the floors-file key `rel` names a Rust file. */
export function isRustKey(rel: string): boolean {
  return rel.endsWith(RUST_EXTENSION);
}

/**
 * The floors file at `file`; none when it is absent. Throws a message that names the file when it is not JSON or a
 * row is wrong.
 */
export function readFloorsFile(file: string): Floors {
  if (!fs.existsSync(file)) return {};
  let json: unknown;

  try {
    json = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new Error(`${file} is not valid JSON; ${REWRITE_HINT}`);
  }

  const table = z.record(z.string(), z.unknown()).safeParse(json);

  if (!table.success) throw new Error(`${file} is not an object of floors; ${REWRITE_HINT}`);
  const schema = schemas();
  const floors: Floors = {};

  for (const [rel, row] of Object.entries(table.data)) {
    const parsed = isRustKey(rel) ? schema.rust.safeParse(row) : schema.ts.safeParse(row);

    if (!parsed.success)
      throw new Error(`${file}: ${rel} has a bad floor row (${parsed.error.message}); ${REWRITE_HINT}`);
    floors[rel] = parsed.data;
  }

  return floors;
}
