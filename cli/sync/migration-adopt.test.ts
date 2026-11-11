import { expect, it } from "vitest";
import { applyMigration } from "./apply-migration.ts";
import { conflictLines } from "./migrate.ts";
import { GENERATED_SETTINGS, REMOVAL, clash, firstWritten, mini, planOf } from "./fixtures/mini-install.ts";
import { useTempDirs } from "./fixtures/temp-dirs.ts";

useTempDirs();

const block = "<!-- repo:begin -->\n\nstock\n\n<!-- repo:end -->\n";
const CARRIED = "---\ndescription: Carried over from your earlier setup\n---\n";
const SETTINGS_CLASH = clash(".claude/settings.json", ".repo/settings/claude.json");
const NOT_JSON = ".claude/settings.json is not valid JSON; copy any keys of yours into .repo/settings/claude.json";

it("plans nothing for AGENTS.md: missing, only the guarded block, or text of the user's own", () => {
  expect(planOf(mini({}))).toEqual([REMOVAL]);
  expect(planOf(mini({ "AGENTS.md": block }))).toEqual([REMOVAL]);
  expect(planOf(mini({ "AGENTS.md": `${block}\nours\n` }))).toEqual([REMOVAL]);
});

it("takes a settings overlay as done only when it holds every key and list item, and stops otherwise", () => {
  const settings = JSON.stringify({ model: "opus", permissions: { allow: ["Zed"] } });
  const plan = (overlay: string) =>
    conflictLines(planOf(mini({ ".claude/settings.json": settings, ".repo/settings/claude.json": overlay })));
  expect(plan(JSON.stringify({ model: "opus", other: 1, permissions: { allow: ["Zed", "Y"] } }))).toEqual([]);
  for (const overlay of [
    JSON.stringify({ model: "sonnet", permissions: { allow: ["Zed"] } }),
    JSON.stringify({ model: "opus", permissions: { allow: ["Y"] } }),
    JSON.stringify({ model: "opus", permissions: [] }),
    JSON.stringify({ model: "opus" }),
    "{",
  ]) {
    expect(plan(overlay), overlay).toEqual([SETTINGS_CLASH]);
  }
});

it("takes an overlay that already holds the text as done, not as a conflict", () => {
  const moved = mini({
    "AGENTS.md": `${block}\nours\n`,
    ".repo/rules/agents.md": `${CARRIED}before\n\nours\n\nafter\n`,
    ".claude/settings.json": JSON.stringify({ permissions: { allow: ["A"] } }),
    ".repo/settings/claude.json": JSON.stringify({ permissions: { allow: ["A", "B"], deny: ["D"] }, model: "x" }),
  });
  expect(conflictLines(planOf(moved))).toEqual([]);
  expect(planOf(moved).map((step) => step.kind)).toEqual(["remove"]);
});

it("leaves AGENTS.md where it is, whatever .repo/rules/agents.md holds", () => {
  for (const held of [`${CARRIED}ours\n`, "other\n"]) {
    const m = mini({ "AGENTS.md": `${block}\nours\n`, ".repo/rules/agents.md": held });
    expect(planOf(m), held).toEqual([REMOVAL]);
  }
});

it("moves list items, new keys and changed values, and the hooks apart", () => {
  const m = mini({
    ".claude/settings.json": JSON.stringify({
      permissions: { allow: ["A", "B"], deny: ["D"] },
      env: { X: "2", Y: "1" },
      model: "opus",
    }),
  });
  const steps = planOf(m);
  expect(steps[0]).toMatchObject({
    kind: "write",
    path: ".repo/settings/claude.json",
    note: "moved your .claude/settings.json keys permissions.allow, permissions.deny, env.X, env.Y, model to .repo/settings/claude.json",
  });
  expect(firstWritten(steps.slice(0, 1))).toEqual({
    permissions: { allow: ["B"], deny: ["D"] },
    env: { X: "2", Y: "1" },
    model: "opus",
  });
});

it("plans nothing for settings the stock already has, a missing file, an unreadable stock file or none generated", () => {
  expect(planOf(mini({ ".claude/settings.json": GENERATED_SETTINGS }))).toEqual([REMOVAL]);
  expect(planOf(mini({}))).toEqual([REMOVAL]);
  const unreadable = mini(
    { ".claude/settings.json": '{ "env": { "Z": "1" } }' },
    { generated: { ".claude/settings.json": "{" } },
  );
  expect(planOf(unreadable)).toEqual([REMOVAL]);
  // a host left out of the config: sync generates no settings to compare with, so the file is left alone
  const ungenerated = mini({ ".claude/settings.json": '{ "env": { "Z": "1" } }' });
  ungenerated.generated.delete(".claude/settings.json");
  expect(planOf(ungenerated)).toEqual([REMOVAL]);
  expect(planOf(mini({ ".claude/settings.json": "[]" }))).toEqual([REMOVAL]);
});

it("asks for the keys by hand when settings.json is not JSON", async () => {
  const m = mini({ ".claude/settings.json": "{" });
  const steps = planOf(m);
  expect(steps[0]).toEqual({ kind: "note", note: NOT_JSON });
  expect((await applyMigration(m.root, steps))[0]).toBe(`repo sync: ${NOT_JSON}`);
});

it("stops when the settings overlay holds other keys", () => {
  const m = mini({ ".claude/settings.json": '{ "model": "opus" }', ".repo/settings/claude.json": "{}\n" });
  expect(conflictLines(planOf(m))).toEqual([SETTINGS_CLASH]);
});
