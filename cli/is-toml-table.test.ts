import { parse } from "smol-toml";
import { describe, expect, it } from "vitest";

import { isTomlTable } from "./is-toml-table.ts";

const parsed = parse('when = 1979-05-27T07:32:00Z\nlist = [1, 2]\n\n[table]\nkey = "a"\n');

describe("isTomlTable", () => {
  it("accepts a table", () => {
    expect(isTomlTable(parsed["table"])).toBe(true);
  });

  it.each([
    ["an array", "list"],
    ["a TOML datetime", "when"],
    ["a missing key", "absent"],
  ])("rejects %s", (_name, key) => {
    expect(isTomlTable(parsed[key])).toBe(false);
  });
});
