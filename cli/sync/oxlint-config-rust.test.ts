import { expect, it } from "vitest";

import { oxlintConfig } from "./oxlint-config.ts";
import type { Workspace } from "./workspace.ts";

const APP: Workspace = { manifest: { name: "app" }, packages: [], root: "/repo" };
const REASON = "the crate unwraps a value its caller checked";
const RUST_NAMES = ["clippy/unwrap_used", "rust/unreachable_pub", "repo/rust-lint-attribute", "repo/rust-max-lines"];

function skip(rules: string[]) {
  return { files: ["src/lib.rs"], reason: REASON, rules };
}

function refused(index: number, rule: string) {
  return `repo.config.ts: lint.skip[${index}].rules: "${rule}" is not a rule the generated config runs`;
}

it("oxlintConfig writes no override for a Rust skip, even beside an oxlint rule", () => {
  const built = oxlintConfig(
    APP,
    { skip: [skip(RUST_NAMES), skip(["clippy/pedantic", "repo/no-module-state"])] },
    { rust: true },
  );

  if (!built.ok) throw new Error(built.errors.join("\n"));
  const config = JSON.parse(built.value) /* the config sync writes */ as { overrides: { files: string[] }[] };
  const overrides = config.overrides;
  expect(overrides.filter((override) => override.files.includes("src/lib.rs"))).toStrictEqual([
    { files: ["src/lib.rs"], rules: { "repo/no-module-state": "off" } },
  ]);
  expect(built.value).not.toContain("clippy");
});

it("oxlintConfig refuses the Rust names without a Cargo.toml, as it refuses any unknown name", () => {
  expect(
    oxlintConfig(APP, { skip: [skip(["clippy/unwrap_used"]), skip(["repo/rust-block-comment", "foo/x"])] }),
  ).toStrictEqual({
    errors: [refused(0, "clippy/unwrap_used"), refused(1, "repo/rust-block-comment"), refused(1, "foo/x")],
    ok: false,
  });
});

it("oxlintConfig with a Cargo.toml still refuses a name that is neither a lint in snake_case nor a Rust rule", () => {
  const skips = [skip(["foo/x", "clippy/Unwrap", "clippy/unwrap-used", "repo/rust-nothing", "rust/"])];
  const built = oxlintConfig(APP, { skip: skips }, { rust: true });
  expect(built.ok ? [] : built.errors).toStrictEqual(
    ["foo/x", "clippy/Unwrap", "clippy/unwrap-used", "repo/rust-nothing", "rust/"].map((rule) => refused(0, rule)),
  );
});
