import type { Output, SyncContext } from "./outputs.ts";
import {
  CARGO_PATH,
  CLIPPY_PATH,
  CLIPPY_TOML,
  DENY_PATH,
  DENY_TOML,
  RUSTFMT_PATH,
  RUSTFMT_TOML,
  TOOLCHAIN_PATH,
  TOOLCHAIN_TOML,
} from "./rust.constants.ts";

function file(path: string, content: string): Output {
  return {
    content,
    kind: "file",
    managed: "whole",
    path,
    tracked: false,
  };
}

/**
 * Under the standards pack and with a root `Cargo.toml`, the untracked `rust-toolchain.toml`, `rustfmt.toml`,
 * `clippy.toml` and `deny.toml`, all sync's own. Without the pack or the manifest, nothing.
 */
export function rust(ctx: SyncContext): { outputs: Output[]; errors: string[] } {
  if (!ctx.config.packs.includes("standards") || ctx.read(CARGO_PATH) === null) return { errors: [], outputs: [] };
  return {
    errors: [],
    outputs: [
      file(TOOLCHAIN_PATH, TOOLCHAIN_TOML),
      file(RUSTFMT_PATH, RUSTFMT_TOML),
      file(CLIPPY_PATH, CLIPPY_TOML),
      file(DENY_PATH, DENY_TOML),
    ],
  };
}
