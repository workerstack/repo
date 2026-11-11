import { expect, it } from "vitest";
import { baselineOf, indexUrl } from "./crates-index.ts";

/** A fetch that answers with `status` and `body`, and records the call. */
function index(status: number, body = "") {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetchIndex = (url: string, init: { headers: Record<string, string> }) => {
    calls.push({ url, headers: init.headers });
    return Promise.resolve(new Response(body, { status }));
  };
  return { fetchIndex, calls };
}
const lines = (...rows: object[]) => rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
const row = (vers: string, extra: object = {}) => ({ vers, yanked: false, pubtime: `t-${vers}`, deps: [], ...extra });
const crate = (version: string) => ({ name: "adler", version });

it.each([
  ["a", "https://index.crates.io/1/a"],
  ["ab", "https://index.crates.io/2/ab"],
  ["abc", "https://index.crates.io/3/a/abc"],
  ["adler", "https://index.crates.io/ad/le/adler"],
  ["s64-unpublished-xyz", "https://index.crates.io/s6/4-/s64-unpublished-xyz"],
  ["Serde_JSON", "https://index.crates.io/se/rd/serde_json"],
])("puts %s at %s", (name, url) => {
  expect(indexUrl(name)).toBe(url);
});

it("asks the index with a generic user agent", async () => {
  const { fetchIndex, calls } = index(404);
  await baselineOf(crate("1.0.0"), fetchIndex);
  expect(calls).toStrictEqual([
    { url: "https://index.crates.io/ad/le/adler", headers: { "User-Agent": "@workerstack/repo" } },
  ]);
});

it("is absent for a crate the index does not have", async () => {
  expect(await baselineOf(crate("1.0.0"), index(404).fetchIndex)).toStrictEqual({ kind: "absent" });
});

it("skips yanked versions and takes the highest at or below the crate's", async () => {
  const body = lines(row("1.0.0"), row("1.0.3", { yanked: true }), row("1.0.2"), row("0.9.9"), row("1.0.4"));
  expect(await baselineOf(crate("1.0.3"), index(200, body).fetchIndex)).toStrictEqual({
    kind: "found",
    version: "1.0.2",
    published: "t-1.0.2",
  });
});

it("compares versions numerically and a prerelease below its release", async () => {
  const body = lines(
    row("1.0.10"),
    row("1.0.9"),
    row("2.0.0-rc.1"),
    row("2.0.0-rc.2"),
    row("2.0.0-beta.9"),
    row("2.0.0"),
  );
  const found = (version: string) => baselineOf(crate(version), index(200, body).fetchIndex);
  expect(await found("1.0.20")).toMatchObject({ version: "1.0.10" });
  expect(await found("2.0.0")).toMatchObject({ version: "2.0.0" });
  expect(await found("2.0.0-rc.3")).toMatchObject({ version: "2.0.0-rc.2" });
  expect(await found("2.0.0-beta.10")).toMatchObject({ version: "2.0.0-beta.9" });
  expect(await found("2.0.0-alpha.1")).toMatchObject({ version: "1.0.10" });
});

it("leaves out a version repo cannot order", async () => {
  const body = lines(row("1.0.0-alpha"), row("1.0.1+build"), row("0.5.0"));
  expect(await baselineOf(crate("1.0.0"), index(200, body).fetchIndex)).toMatchObject({ version: "0.5.0" });
});

it("is absent when every version is above the crate's or yanked", async () => {
  const body = lines(row("1.0.1"), row("0.9.0", { yanked: true }));
  expect(await baselineOf(crate("1.0.0"), index(200, body).fetchIndex)).toStrictEqual({ kind: "absent" });
});

it("takes a missing or null pubtime as null", async () => {
  const { pubtime: _gone, ...bare } = row("1.0.0");
  expect(await baselineOf(crate("1.0.0"), index(200, lines(bare)).fetchIndex)).toStrictEqual({
    kind: "found",
    version: "1.0.0",
    published: null,
  });
  const nulled = lines(row("1.0.0", { pubtime: null }));
  expect(await baselineOf(crate("1.0.0"), index(200, nulled).fetchIndex)).toMatchObject({ published: null });
});

it("quotes the first line it cannot read", async () => {
  const long = `{"vers":${"1".repeat(100)}`;
  const fetchIndex = index(200, `${JSON.stringify(row("1.0.0"))}\n\n${long}\n`).fetchIndex;
  expect(await baselineOf(crate("1.0.0"), fetchIndex)).toStrictEqual({
    kind: "failed",
    line: `crates.io index for adler has an unreadable line: ${long.slice(0, 80)}...`,
  });
  expect(await baselineOf(crate("1.0.0"), index(200, '{"vers":1}\n').fetchIndex)).toMatchObject({ kind: "failed" });
});

it("says to try again on another status", async () => {
  expect(await baselineOf(crate("1.0.0"), index(503).fetchIndex)).toStrictEqual({
    kind: "failed",
    line: "crates.io index for adler answered 503; try again",
  });
});

it("says to try again when the fetch throws", async () => {
  const fetchIndex = () => Promise.reject(new Error("offline"));
  expect(await baselineOf(crate("1.0.0"), fetchIndex)).toStrictEqual({
    kind: "failed",
    line: "crates.io index for adler could not be reached; try again",
  });
});

it("fails a crate version that is not semver", async () => {
  expect(await baselineOf(crate("1.0"), index(200).fetchIndex)).toStrictEqual({
    kind: "failed",
    line: "crate adler has version 1.0, which is not a version repo reads",
  });
});
