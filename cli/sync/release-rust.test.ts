import { expect, it } from "vitest";
import { context } from "../fixtures/release-context.ts";
import { release } from "./release.ts";

const RUST_CACHE = "Swatinem/rust-cache@d1527c8f67ef9af357290475d4af4b0fab8f12e0 # v2.9.3";
const INSTALL = "taiki-e/install-action@cfdb7ed4ccc7c7dce37759eae89dc5674b469b39 # v2.90.3";
const TOOLS = `      - uses: ${RUST_CACHE}
      - uses: ${INSTALL}
        with:
          tool: cargo-deny@0.20.2,cargo-shear@1.14.0,cargo-nextest@0.9.151,cargo-llvm-cov@0.9.1
`;
const MSRV = `  msrv:
    name: msrv
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: ${RUST_CACHE}
      - uses: ${INSTALL}
        with:
          tool: cargo-hack@0.6.46
      - name: Check each publishable crate on its rust-version
        shell: bash
        run: |
          meta="$(cargo metadata --no-deps --format-version 1 --locked)"
          if jq -e 'any(.packages[]; .publish != [])' <<<"$meta" >/dev/null; then
            cargo hack check --rust-version --workspace --locked --ignore-private
          else
            echo "no publishable crate"
          fi
`;
const SEMVER_JOB = `  semver:
    name: semver
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          fetch-depth: 0
`;
const INSTALL_STEP = "      - run: bun install --frozen-lockfile\n";

const text = (rust: boolean, packs: ("release" | "workspace")[] = ["release"]) => {
  const [output] = release(context(packs, {}, rust ? { "Cargo.toml": "[package]\n" } : {})).outputs;
  return output?.kind === "file" ? output.content : "";
};
const job = (ci: string, name: string, next: string) => ci.slice(ci.indexOf(`  ${name}:`), ci.indexOf(`  ${next}:`));

it("a Rust repo's test job installs the tools right after bun install, before the turbo restore and the gates", () => {
  const test = job(text(true, ["release", "workspace"]), "test", "commits");
  expect(test).toContain(INSTALL_STEP + TOOLS);
  expect(test.indexOf(TOOLS)).toBeLessThan(test.indexOf("actions/cache/restore"));
  expect(test.indexOf(TOOLS)).toBeLessThan(test.indexOf("bun repo ci --report"));
});

it("a Rust repo's no-node job installs the tools right after bun install, before repo ci", () => {
  const noNode = job(text(true), "no-node", "msrv");
  expect(noNode).toContain(INSTALL_STEP + TOOLS + "      - run: bun repo ci");
});

it("a Rust repo's ci.yml ends with the msrv job, whose steps are exactly the cargo-hack check", () => {
  const ci = text(true);
  expect(ci.endsWith(`\n\n${MSRV}`)).toBe(true);
  expect(ci.split(TOOLS)).toHaveLength(3);
});

it("a Rust repo's semver job has full history, bun, the cache, cargo-semver-checks 0.51.0 and repo release api", () => {
  const semver = job(text(true), "semver", "msrv");
  expect(semver.startsWith(SEMVER_JOB)).toBe(true);
  expect(semver).toContain(`      - uses: ${RUST_CACHE}
      - uses: ${INSTALL}
        with:
          tool: cargo-semver-checks@0.51.0
      - run: bun repo release api
`);
  expect(semver.indexOf("bun install")).toBeLessThan(semver.indexOf("rust-cache"));
});

it("a Rust repo's consumer job has no release api step, since semver runs it", () => {
  const ci = text(true, ["release"]);
  expect(ci.split("bun repo release api")).toHaveLength(2);
  const files = { "Cargo.toml": "[package]\n" };
  const [output] = release(context(["release"], { name: "pkg", private: false }, files)).outputs;
  const consumer = job(output?.kind === "file" ? output.content : "", "consumer", "semver");
  expect(consumer).toContain("bun repo release consumer");
  expect(consumer).not.toContain("release api");
});

it("a repo without Cargo.toml gets no Rust steps and no msrv job", () => {
  const ci = text(false);
  expect(ci).not.toContain("rust-cache");
  expect(ci).not.toContain("msrv");
  expect(ci).not.toContain("semver");
});
