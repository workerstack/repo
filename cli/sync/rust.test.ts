import { parse, type TomlTable } from "smol-toml";
import { expect, it } from "vitest";

import { BASE_CONFIG } from "../__fixtures__/base-config.ts";
import { AGENT_DEFAULTS } from "../agent-defaults.constants.ts";
import type { Pack } from "../config.ts";
import { isTomlTable } from "../is-toml-table.ts";
import type { SyncContext } from "./outputs.ts";
import { rust } from "./rust.ts";

/** A context with `packs` whose root holds `files`. */
function context(packs: Pack[], files: Record<string, string>): SyncContext {
  return {
    config: { agents: { ...AGENT_DEFAULTS, hosts: [], skills: [] }, packs, ...BASE_CONFIG },
    read: (rel) => files[rel] ?? null,
    root: "/work",
    workspace: { manifest: {}, packages: [], root: "/work" },
  };
}

/** The table at `key` in `parsed`, or an empty one when `key` holds no table. */
function tableAt(parsed: TomlTable, key: string): TomlTable {
  const table = parsed[key];

  return isTomlTable(table) ? table : {};
}

const DENY = `[graph]
all-features = true

[advisories]
unmaintained = "all"
unsound = "all"
yanked = "deny"

[licenses]
confidence-threshold = 0.93
allow = [
  "0BSD",
  "Apache-2.0",
  "Apache-2.0 WITH LLVM-exception",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "BSL-1.0",
  "CC0-1.0",
  "ISC",
  "MIT",
  "MIT-0",
  "Unicode-3.0",
  "Unlicense",
  "Zlib",
]
unused-allowed-license = "allow"

[licenses.private]
ignore = true

[bans]
multiple-versions = "warn"
wildcards = "deny"
allow-wildcard-paths = true

[sources]
unknown-registry = "deny"
unknown-git = "deny"
`;

function whole(path: string, content: string) {
  return { content, kind: "file", managed: "whole", path, tracked: false };
}

it("writes the toolchain pin, the rustfmt defaults and the clippy limits as untracked whole files", () => {
  expect(rust(context(["standards"], { "Cargo.toml": "[package]\n" }))).toStrictEqual({
    errors: [],
    outputs: [
      whole(
        "rust-toolchain.toml",
        `[toolchain]\nchannel = "1.99.1"\n` +
          'components = ["rustfmt", "clippy", "llvm-tools-preview"]\nprofile = "minimal"\n',
      ),
      whole("rustfmt.toml", `# rustfmt's defaults apply.\n`),
      whole(
        "clippy.toml",
        "allow-unwrap-in-tests = true\nallow-expect-in-tests = true\n" +
          "too-many-lines-threshold = 30\ntoo-many-arguments-threshold = 3\n",
      ),
      whole("deny.toml", DENY),
    ],
  });
});

it("writes a deny.toml that parses to the supply-chain policy", () => {
  const out = rust(context(["standards"], { "Cargo.toml": "" })).outputs.find((o) => o.path === "deny.toml");

  const parsed = parse(out?.kind === "file" ? out.content : "");
  const licenses = tableAt(parsed, "licenses");

  expect(Object.keys(parsed)).toStrictEqual(["graph", "advisories", "licenses", "bans", "sources"]);
  expect({ ...tableAt(parsed, "advisories") }).toStrictEqual({ unmaintained: "all", unsound: "all", yanked: "deny" });
  expect(licenses["allow"]).toContain("Apache-2.0 WITH LLVM-exception");
  expect(JSON.stringify(licenses["private"])).toBe(JSON.stringify({ ignore: true }));
  expect({ ...tableAt(parsed, "bans") }).toStrictEqual({
    "allow-wildcard-paths": true,
    "multiple-versions": "warn",
    wildcards: "deny",
  });
  expect({ ...tableAt(parsed, "sources") }).toStrictEqual({ "unknown-git": "deny", "unknown-registry": "deny" });
});

it("writes nothing without a root Cargo.toml", () => {
  expect(rust(context(["standards"], { "package.json": "{}" }))).toStrictEqual({ errors: [], outputs: [] });
});

it("writes nothing without the standards pack", () => {
  expect(rust(context(["agents", "docs"], { "Cargo.toml": "" }))).toStrictEqual({ errors: [], outputs: [] });
});

it("accepts a root Cargo.toml that is empty", () => {
  expect(rust(context(["standards"], { "Cargo.toml": "" })).outputs).toHaveLength(4);
});
