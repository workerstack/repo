import { afterEach, describe, expect, it } from "vitest";
import { removePlanted, tempDir } from "../fixtures/planted-repo.ts";
import type { CargoRun } from "../rust/clippy.ts";
import { api, PREFIX } from "./fixtures/api-repo.ts";
import { A, cargo, rustRepo } from "./fixtures/rust-api.ts";

afterEach(removePlanted);

describe("repo release api with nothing to check in a Rust repo", () => {
  it("says so when no crate publishes and no package is public", async () => {
    const dir = rustRepo({ private: true });
    const fake = cargo([{ ...A, publish: [] }]);
    const got = await api(dir, [], { cargo: fake.run });
    expect(got).toMatchObject({
      code: 0,
      err: "",
      out: `${PREFIX}no publishable crate and no public package; nothing to compare\n`,
    });
  });

  it("refuses --against without a public package", async () => {
    const got = await api(rustRepo(), ["--against", "x.tgz"], {
      cargo: cargo([A]).run,
    });
    expect(got).toMatchObject({
      code: 1,
      out: "",
      err: `${PREFIX}--against compares a package tarball; this repo has no public package\n`,
    });
  });
});

describe("repo release api refusals in a Rust repo", () => {
  it("keeps the missing manifest refusal in a repo without a Cargo.toml", async () => {
    expect(await api(tempDir(), [])).toMatchObject({
      code: 1,
      err: `${PREFIX}package.json needs a name and a version\n`,
    });
  });

  it("names a stale lock and a failed cargo metadata", async () => {
    const stale: CargoRun = () => ({
      status: 101,
      stdout: "",
      stderr: "the lock file needs to be updated but --locked was passed",
      missing: false,
    });
    const failed: CargoRun = () => ({
      status: 1,
      stdout: "",
      stderr: "",
      missing: true,
    });
    const lock = "Cargo.lock is out of date with Cargo.toml; run `cargo update --workspace` and commit it";
    expect((await api(rustRepo(), [], { cargo: stale })).err).toBe(`${PREFIX}${lock}\n`);
    expect((await api(rustRepo(), [], { cargo: failed })).code).toBe(1);
  });
});
