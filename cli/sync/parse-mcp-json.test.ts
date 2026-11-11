import { expect, it } from "vitest";
import { parseMcpJson } from "./parse-mcp-json.ts";

const FIX = "; fix it, nothing written";

it("reads the servers of a .mcp.json, other keys ignored", () => {
  const text = JSON.stringify({ other: 1, mcpServers: { docs: { command: "d" } } });
  expect(parseMcpJson(text)).toEqual({ ok: true, servers: { docs: { command: "d" } } });
});

it("reads no servers from a missing file or one without mcpServers", () => {
  expect(parseMcpJson(null)).toEqual({ ok: true, servers: {} });
  expect(parseMcpJson("{}\n")).toEqual({ ok: true, servers: {} });
});

it.each([
  ["broken on line 3", '{\n  "mcpServers": {\n    "a": }\n}\n', 3],
  ["empty", "", 1],
  ["with a comment", '{\n// no\n"mcpServers": {}}', 2],
  ["with a trailing comma", '{ "mcpServers": {}, }', 1],
])("names the line of a file that is not valid JSON: %s", (_name, text, line) => {
  expect(parseMcpJson(text)).toEqual({ ok: false, error: `.mcp.json: not valid JSON at line ${line}${FIX}` });
});

it.each(["[]", "3", "null"])("refuses a file that is not a JSON object: %s", (text) => {
  expect(parseMcpJson(text)).toEqual({ ok: false, error: `.mcp.json: not a JSON object${FIX}` });
});

it.each(['{ "mcpServers": [] }', '{ "mcpServers": "x" }', '{ "mcpServers": null }'])(
  "refuses mcpServers that is not an object: %s",
  (text) => {
    expect(parseMcpJson(text)).toEqual({ ok: false, error: `.mcp.json: mcpServers is not an object${FIX}` });
  },
);
