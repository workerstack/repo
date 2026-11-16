import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { cargoLock } from "../rust/__fixtures__/cargo-lock.ts";
import {
  cleanTemps,
  consumer,
  git,
  nonNull,
  precommit,
  read,
  SLOW,
  staged,
  turn,
  write,
} from "./__fixtures__/turn-repo.ts";

afterEach(cleanTemps);

const NN = "typescript(no-non-null-assertion)";
const BASELINE = ".repo/lint-baseline.json";

it("a new lint problem over the baseline fails, naming it, and leaves the baseline", { timeout: SLOW }, async () => {
  const baseline = `${JSON.stringify({ "src/a.ts": { [NN]: 2 } }, null, 2)}\n`;
  const root = consumer({ [BASELINE]: baseline, "src/a.ts": nonNull(2) });
  write(root, { "src/a.ts": nonNull(3) });
  const result = await turn(root, []);
  expect(result.err).toContain(`src/a.ts:10:`);
  expect(result.err).toContain(`: error ${NN}: Forbidden non-null assertion.\n`);
  expect(result.err).toContain(`repo turn: src/a.ts has 3 ${NN}, the baseline allows 2; fix the new one\n`);
  expect(result.out).toBe(
    "turn: 1 file · fmt ok · lint 1 over baseline · comments ok · typecheck skipped (no tsconfig.json)\n",
  );
  expect(result.code).toBe(1);
  expect(read(root, BASELINE)).toBe(baseline);
  write(root, { "src/a.ts": nonNull(4) });
  const more = await turn(root, []);
  expect(more.err).toContain(`src/a.ts has 4 ${NN}, the baseline allows 2; fix the 2 new ones\n`);
});

it(
  "a fixed problem and a deleted file lower the baseline, which precommit restages and which triggers no sync",
  { timeout: SLOW },
  async () => {
    const baseline = { "src/a.ts": { [NN]: 2 }, "src/b.ts": { [NN]: 1 } };

    const root = consumer({
      [BASELINE]: `${JSON.stringify(baseline, null, 2)}\n`,
      "src/a.ts": nonNull(2),
      "src/b.ts": nonNull(1, "b"),
    });

    write(root, { "src/a.ts": nonNull(1) });
    git(root, "rm", "-q", "src/b.ts");
    git(root, "add", "src/a.ts");
    const result = await precommit(root);
    const rule = NN.replaceAll(/[()]/g, "\\$&");
    const lowered = `\\(src/a.ts ${rule} 2 → 1, src/b.ts ${rule} 1 → 0\\)`;
    expect(result.out).toMatch(
      new RegExp(`^precommit: 2 files · fmt ok · lint ok, baseline lowered ${lowered} · comments ok · typecheck`),
    );
    expect(result.out).not.toContain("sync");
    expect(result.code).toBe(0);
    expect(JSON.parse(git(root, "show", `:${BASELINE}`))).toStrictEqual({ "src/a.ts": { [NN]: 1 } });
    expect(staged(root)).toStrictEqual([BASELINE, "src/a.ts", "src/b.ts"]);
  },
);

it("the default mode lowers the baseline on disk and stages nothing", { timeout: SLOW }, async () => {
  const root = consumer({
    [BASELINE]: `${JSON.stringify({ "src/a.ts": { [NN]: 2 } }, null, 2)}\n`,
    "src/a.ts": nonNull(2),
  });

  write(root, { "src/a.ts": nonNull(1) });
  const result = await turn(root, []);
  expect(result.out).toContain(`lint ok, baseline lowered (src/a.ts ${NN} 2 → 1)`);
  expect(JSON.parse(read(root, BASELINE))).toStrictEqual({ "src/a.ts": { [NN]: 1 } });
  expect(staged(root)).toStrictEqual([]);
});

it("a broken baseline or tool config fails its step with the reason", { timeout: SLOW }, async () => {
  const root = consumer({ [BASELINE]: '{ "src/a.ts": { "x": 0 } }\n', "src/a.ts": nonNull(1) });
  write(root, { "src/a.ts": nonNull(2) });
  const broken = await turn(root, []);
  expect(broken.err).toBe(
    `repo turn: ${BASELINE}: src/a.ts: x: must be a whole number above 0; ` +
      "fix it, or delete it and run `bun repo lint --baseline`\n",
  );
  expect(broken.out).toContain(" · lint failed · ");
  expect(broken.code).toBe(1);
  write(root, { ".oxfmtrc.jsonc": "{", ".oxlintrc.jsonc": "{", [BASELINE]: "{}\n" });
  const tools = await turn(root, []);
  expect(tools.err).toContain("repo turn: oxlint exited 1: Failed to parse oxlint configuration file");
  expect(tools.out).toMatch(/^turn: 2 files · fmt failed · lint failed · comments ok · /);
});

it("a changed Rust file gets the lexer rules, never clippy, under the baseline", { timeout: SLOW }, async () => {
  const cargo = '[package]\nname = "a"\nversion = "0.1.0"\nedition = "2024"\n';
  const root = consumer({ "Cargo.lock": cargoLock("a"), "Cargo.toml": cargo, "src/lib.rs": "// ok\npub fn f() {}\n" });
  write(root, { "src/lib.rs": "/* old */\npub fn f() {}\n" });
  const result = await turn(root, []);
  expect(result.err).toContain("src/lib.rs:1:1: error repo(rust-block-comment): ");
  expect(result.err).toContain(
    "repo turn: src/lib.rs has 1 repo(rust-block-comment), the baseline allows 0; fix the new one\n",
  );
  expect(result.out).toContain(" · lint 1 over baseline · ");
  expect(result.code).toBe(1);
});

const SORT_KEYS = "eslint(sort-keys)";
const CURLY = "eslint(curly)";
const OBJECT = "export const o = {\n  b: 1,\n  a: 2,\n};\n";

/** A formatted function whose `if` has a multi-line body and no braces: one fixable `curly` hit. */
function unbraced(name: string) {
  return (
    `export function ${name}(x: number) {\n  if (x > 0)\n    return {\n      a: x,\n      b: x,\n    };\n\n` +
    "  return {};\n}\n"
  );
}

/** Precommit on `src/a.ts` staged as `text`, its baseline allowing one `sort-keys` and one `curly` hit. */
async function stagedWithin(text: string) {
  const baseline = `${JSON.stringify({ "src/a.ts": { [CURLY]: 1, [SORT_KEYS]: 1 } }, null, 2)}\n`;
  const root = consumer({ [BASELINE]: baseline });
  write(root, { "src/a.ts": text });
  git(root, "add", "src/a.ts");
  const result = await precommit(root);
  expect(result.err).toBe("");
  expect(result.code).toBe(0);

  return root;
}

it("a staged file within its baseline on a fixable rule commits byte-identical", { timeout: SLOW }, async () => {
  const text = `${OBJECT}\n${unbraced("f")}`;
  const root = await stagedWithin(text);
  expect(git(root, "show", ":src/a.ts")).toBe(text);
  expect(read(root, "src/a.ts")).toBe(text);
});

it(
  "a file over its baseline on one rule gets that rule's fix on all its hits and keeps its other fixable hits",
  { timeout: SLOW },
  async () => {
    const root = await stagedWithin(`${OBJECT}\n${unbraced("f")}\n${unbraced("g")}`);
    const committed = git(root, "show", ":src/a.ts");
    expect(committed).toContain("export function f(x: number) {\n  if (x > 0) {");
    expect(committed).toContain("export function g(x: number) {\n  if (x > 0) {");
    expect(committed.startsWith(OBJECT)).toBe(true);
  },
);

it("an unreadable baseline runs no fix and reports the read error", { timeout: SLOW }, async () => {
  const text = unbraced("f");
  const root = consumer({ [BASELINE]: '{ "src/a.ts": ' });
  write(root, { "src/a.ts": text });
  git(root, "add", "src/a.ts");
  const result = await precommit(root);
  expect(result.err).toContain(`repo precommit: ${BASELINE}: not valid JSON`);
  expect(result.code).toBe(1);
  expect(git(root, "show", ":src/a.ts")).toBe(text);
  expect(read(root, "src/a.ts")).toBe(text);
});

it(
  "a file over its baseline is fixed under the catalog's rules when the root config is gone",
  { timeout: SLOW },
  async () => {
    const root = consumer({});
    fs.rmSync(path.join(root, ".oxlintrc.jsonc"));
    write(root, { "src/a.ts": "export const a = [...[1, 2]];\n" });
    const result = await turn(root, []);
    expect(result.err).toBe("");
    expect(read(root, "src/a.ts")).toBe("export const a = [1, 2];\n");
    expect(fs.readdirSync(root).filter((name) => name.startsWith(".oxlintrc.fix-"))).toStrictEqual([]);
  },
);
