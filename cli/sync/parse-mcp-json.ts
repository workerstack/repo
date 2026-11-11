/**
 * The one reader of the user's `.mcp.json`, which sync never writes: the MCP files of the other hosts are built from
 * its `mcpServers`. It is user input, so it is checked here, at the boundary, and nowhere after.
 */
import { parse, type ParseError } from "jsonc-parser";

const MCP_JSON = ".mcp.json";
const SERVERS_KEY = "mcpServers";
const FIX = "fix it, nothing written";
/** Plain JSON: what `claude mcp add --scope project` writes and every host parses. */
const STRICT = { disallowComments: true, allowTrailingComma: false, allowEmptyContent: false };

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const failed = (problem: string) => ({ ok: false as const, error: `${MCP_JSON}: ${problem}; ${FIX}` });

/** The servers of `.mcp.json` given its text, none when it is missing (`null`); a named error when it is no JSON object or its `mcpServers` is no object. */
export function parseMcpJson(text: string | null): { ok: true; servers: Json } | { ok: false; error: string } {
  if (text === null) return { ok: true, servers: {} };
  const errors: ParseError[] = [];
  const value: unknown = parse(text, errors, STRICT);
  const [first] = errors;
  if (first !== undefined) return failed(`not valid JSON at line ${text.slice(0, first.offset).split("\n").length}`);
  if (!isObject(value)) return failed("not a JSON object");
  const servers = Object.hasOwn(value, SERVERS_KEY) ? value[SERVERS_KEY] : {};
  return isObject(servers) ? { ok: true, servers } : failed(`${SERVERS_KEY} is not an object`);
}
