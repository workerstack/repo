import { describe, expect, it } from "vitest";
import { lines } from "./lines.ts";

describe("lines", () => {
  it("splits on LF and CRLF alike and keeps empty lines, a last one included", () => {
    expect(lines("a\r\nb\n\nc\n")).toStrictEqual(["a", "b", "", "c", ""]);
  });
});
