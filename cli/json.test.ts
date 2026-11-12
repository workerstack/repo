import { describe, expect, it } from "vitest";

import { isRecord } from "./json.ts";

describe("isRecord", () => {
  it.each([[{}], [{ a: 1 }], [JSON.parse('{"name":"a"}')]])("accepts the object %j", (value) => {
    expect(isRecord(value)).toBe(true);
  });

  it.each([[null], [undefined], [[]], [[1]], [new Date(0)], ["{}"], [7]])("rejects %j", (value) => {
    expect(isRecord(value)).toBe(false);
  });
});
