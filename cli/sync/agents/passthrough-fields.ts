import type { JsonObject } from "../../json.ts";
import { BLOCK, COMMAND, HTTP, ON_FAILURE_IGNORED } from "./hooks.constants.ts";
import type { Def, Passthrough, Target } from "./hooks.types.ts";

/** One handler definition on its way to a host: its kind and the event it sits under. */
export type PassthroughInput = {
  def: Def;
  type: string;
  event: string;
  target: Readonly<Target>;
};

const VALID: Readonly<Record<Exclude<Passthrough["kind"], "keyword">, (value: unknown) => boolean>> = {
  array: (value) => Array.isArray(value) && value.every((item) => typeof item === "string"),
  boolean: (value) => typeof value === "boolean",
  number: (value) => Number.isFinite(value),
  string: (value) => typeof value === "string" && value !== "",
};

/** Whether claude writes `onFailure` here: command and http hooks off the ignored events, never an async command. */
function onFailureApplies({ def, type, event }: PassthroughInput): boolean {
  const blocked = type === COMMAND && (def["async"] === true || def["asyncRewake"] === true);

  return (type === COMMAND || type === HTTP) && !ON_FAILURE_IGNORED.has(event) && !blocked;
}

/** The target's passthrough fields `def` sets validly for its kind, in the target's order. */
export function passthroughFields(input: PassthroughInput): JsonObject {
  const { def, type, target } = input;
  const out: JsonObject = {};

  for (const field of target.passthrough) {
    if (field.kind === "keyword") {
      if (def["failClosed"] === true && onFailureApplies(input)) out["onFailure"] = BLOCK;
      continue;
    }

    const value = def[field.key];

    if (value !== undefined && VALID[field.kind](value) && (field.commandOnly !== true || type === COMMAND))
      out[field.key] = value;
  }

  return out;
}
