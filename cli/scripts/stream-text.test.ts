import { expect, it } from "vitest";

import { streamText } from "./stream-text.ts";

it("streamText returns text, decodes a buffer and turns a missing stream into an empty string", () => {
  expect(streamText("out")).toBe("out");
  expect(streamText(Buffer.from("buf"))).toBe("buf");
  expect(streamText(null)).toBe("");
  expect(streamText(undefined)).toBe("");
});
