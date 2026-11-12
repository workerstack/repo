import { TomlDate } from "smol-toml";
import { expect, it } from "vitest";

import { isSettingsTable } from "./settings-table.ts";

it("isSettingsTable: true for a JSON object and a TOML table", () => {
  expect(isSettingsTable({ a: 1 })).toBe(true);
  expect(isSettingsTable({ nested: { b: new TomlDate("1979-05-27") } })).toBe(true);
});

it("isSettingsTable: false for an array, a TOML datetime, null, a primitive and a missing value", () => {
  expect(isSettingsTable([1, 2])).toBe(false);
  expect(isSettingsTable(new TomlDate("1979-05-27T07:32:00Z"))).toBe(false);
  expect(isSettingsTable(null)).toBe(false);
  expect(isSettingsTable("text")).toBe(false);
  expect(isSettingsTable(undefined)).toBe(false);
});
