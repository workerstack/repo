import type { Generator, Output } from "./outputs.ts";
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

const file = (path: string, content: string): Output => ({
  kind: "file",
  path,
  content,
  tracked: false,
  managed: "whole",
});

/**
 * Under the standards pack and with a root `Cargo.toml`, the untracked `rust-toolchain.toml`, `rustfmt.toml`,
 * `clippy.toml` and `deny.toml`, all sync's own. Without the pack or the manifest, nothing.
 */
export const rust: Generator = (ctx) => {
  if (!ctx.config.packs.includes("standards") || ctx.read(CARGO_PATH) === null) return { outputs: [], errors: [] };
  return {
    outputs: [
      file(TOOLCHAIN_PATH, TOOLCHAIN_TOML),
      file(RUSTFMT_PATH, RUSTFMT_TOML),
      file(CLIPPY_PATH, CLIPPY_TOML),
      file(DENY_PATH, DENY_TOML),
    ],
    errors: [],
  };
};
