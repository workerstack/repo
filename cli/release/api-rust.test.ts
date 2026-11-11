import { afterEach, describe, expect, it } from "vitest";
import { removePlanted } from "../fixtures/planted-repo.ts";
import { TIMEOUT } from "./fixtures/api-cases.ts";
import { api, PREFIX } from "./fixtures/api-repo.ts";
import { A, absent, BROKEN, cargo, index, NO_TAG, OK_A, rustRepo } from "./fixtures/rust-api.ts";

afterEach(removePlanted);

describe("repo release api in a Rust repo", () => {
  it("checks each crate crates.io can publish and skips one it has not got", async () => {
    const fake = cargo([A, { name: "b", version: "0.1.0" }, { name: "p", version: "1.0.0", publish: [] }]);
    const fetch = (url: string) => (url.endsWith("/a") ? index("1.0.2")() : absent());
    const got = await api(rustRepo(), [], { cargo: fake.run, fetch });
    expect(got).toMatchObject({
      code: 0,
      err: "",
      out: `${OK_A}${PREFIX}crate b is not on crates.io yet; nothing to compare\n`,
    });
    expect(fake.checks()).toHaveLength(1);
  });

  it("runs the TypeScript check too for a public package", { timeout: TIMEOUT }, async () => {
    const got = await api(rustRepo({ private: false }), [], {
      cargo: cargo([A]).run,
      fetch: index("1.0.2"),
    });
    expect(got).toMatchObject({ code: 0, err: "", out: `${OK_A}${NO_TAG}` });
  });

  it("leaves a private named package to the crates", { timeout: TIMEOUT }, async () => {
    const got = await api(rustRepo({ private: true }), [], {
      cargo: cargo([A]).run,
      fetch: index("1.0.2"),
    });
    expect(got).toMatchObject({ code: 0, err: "", out: OK_A });
  });
});

describe("repo release api failures in a Rust repo", () => {
  it("exits 1 for a crate that broke its api, each line prefixed", async () => {
    const fake = cargo([A], {}, { status: 100, stderr: `${BROKEN}\n` });
    const got = await api(rustRepo(), [], {
      cargo: fake.run,
      fetch: index("1.0.2"),
    });
    expect(got.code).toBe(1);
    expect(got.out).toBe("");
    expect(got.err).toBe(
      `${PREFIX}crate a 1.0.2 → this checkout needs a major release: function a::gone (function_missing: pub fn removed or renamed); restore it, bump a's version, or mark a commit breaking with \`!\`\n`,
    );
  });

  it("still runs the TypeScript check after a failed crate", { timeout: TIMEOUT }, async () => {
    const fake = cargo([A], {}, { status: 101, stderr: "error: boom\n" });
    const got = await api(rustRepo({ private: false }), [], {
      cargo: fake.run,
      fetch: index("1.0.2"),
    });
    expect(got).toMatchObject({
      code: 1,
      out: NO_TAG,
      err: `${PREFIX}cargo semver-checks exited 101 for a: error: boom\n`,
    });
  });
});

describe("repo release api pins in a Rust repo", () => {
  it.each([
    ["is not installed", { stderr: "error: no such command: `semver-checks`" }, "cargo-semver-checks is not installed"],
    [
      "is another version",
      { stdout: "cargo-semver-checks 0.50.0\n" },
      "cargo-semver-checks 0.50.0 is installed but repo pins 0.51.0",
    ],
  ])("refuses a tool that %s, before any crate", async (_name, pin, start) => {
    const fake = cargo([A], { status: 1, ...pin });
    const got = await api(rustRepo(), [], {
      cargo: fake.run,
      fetch: index("1.0.2"),
    });
    expect(got.code).toBe(1);
    expect(got.err.startsWith(`${PREFIX}${start}; run \`cargo install --locked cargo-semver-checks@0.51.0\``)).toBe(
      true,
    );
    expect(fake.checks()).toStrictEqual([]);
  });
});
