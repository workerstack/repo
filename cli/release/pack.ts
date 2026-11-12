import path from "node:path";

import { z } from "zod";

import { readJson } from "../json.ts";
import type { Result } from "../result.ts";
import type { Runner } from "../scripts/ci-wait.ts";
import { refuse } from "./refuse.ts";
import {
  PACKED_UNREADABLE,
  PACK_ARGS,
  PACK_PREFIX,
  packCount,
  packFailed,
  unpinned,
} from "./release-messages.constants.ts";
import { BUN_PACK, PACK_DIR_PREFIX, TAR_MANIFEST, TARBALL_EXTENSION, UNPINNED } from "./release.constants.ts";

/** Where `repo release pack` runs and prints, and the bun, tar and temp directory it works through. */
export type PackIo = {
  cwd: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  bun: Runner;
  tar: Runner;
  /** The directory the tarball's own directory is made in. */
  tmp: string;
  mkdtemp: (prefix: string) => string;
  /** The names in a directory. */
  list: (dir: string) => string[];
};

/** A tarball and the name and version its package.json carries. */
export type Packed = { tarball: string; name: string; version: string };

function pins() {
  return z.record(z.string(), z.string()).default({});
}

function packedSchema() {
  return z.object({
    dependencies: pins(),
    devDependencies: pins(),
    name: z.string(),
    optionalDependencies: pins(),
    peerDependencies: pins(),
    version: z.string(),
  });
}

/** Packs the package in `io.cwd` and checks its package.json; the tarball and its manifest, or the refusal line. */
export function packTarball(
  io: Pick<PackIo, "cwd" | "stderr" | "bun" | "tar" | "tmp" | "mkdtemp" | "list">,
): Result<Packed, string> {
  const dir = io.mkdtemp(path.join(io.tmp, PACK_DIR_PREFIX));
  const packed = io.bun(BUN_PACK(dir), io.cwd);

  if (packed.stdout !== "") io.stderr(packed.stdout);

  if (packed.code !== 0) return { error: packFailed(packed.stderr.trim()), ok: false };
  const tarballs = io.list(dir).filter((file) => file.endsWith(TARBALL_EXTENSION));
  const [only] = tarballs;

  if (only === undefined || tarballs.length > 1) return { error: packCount(tarballs.length, dir), ok: false };
  const tarball = path.join(dir, only);
  let manifest: z.infer<ReturnType<typeof packedSchema>>;

  try {
    // By name from its own dir: GNU tar reads an absolute `C:\\…` as `host:path` and tries to connect to the host `C`.
    manifest = readJson(packedSchema(), io.tar(TAR_MANIFEST(only), dir).stdout);
  } catch {
    return { error: PACKED_UNREADABLE, ok: false };
  }

  const { name, version, ...fields } = manifest;

  for (const entries of Object.values(fields)) {
    const bad = Object.entries(entries).find(([, spec]) => UNPINNED.test(spec));

    if (bad !== undefined) return { error: unpinned(bad[1], bad[0]), ok: false };
  }

  return { ok: true, value: { name, tarball, version } };
}

/** `repo release pack`: prints the path of the tarball of this checkout's package, after checking its package.json. */
export function releasePack(argv: readonly string[], io: PackIo): number {
  if (argv.length > 0) return refuse(io, PACK_PREFIX, PACK_ARGS);
  const got = packTarball(io);

  if (!got.ok) return refuse(io, PACK_PREFIX, got.error);
  io.stdout(`${got.value.tarball}\n`);

  return 0;
}
