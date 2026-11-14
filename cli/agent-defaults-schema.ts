/** The `agents` keys that set a repo's defaults: each one of its values, refused with them, else the built-in one. */
import { z } from "zod";

import { AGENT_DEFAULTS } from "./agent-defaults.constants.ts";
import { LAST } from "./config.constants.ts";
import { APPROVALS, EFFORTS, STRATEGIES } from "./scripts/strategy.constants.ts";
import type { Approval, Effort, Strategy } from "./scripts/strategy.types.ts";

/** One of `values`, `fallback` when omitted; another value is refused with the quoted values it takes. */
function oneOf<const T extends string>(values: readonly T[], fallback: T) {
  const quoted = values.map((value) => JSON.stringify(value));
  const listed = `${quoted.slice(0, LAST).join(", ")} or ${quoted.at(LAST)}`;

  return z
    .custom<T>((input) => values.some((value) => value === input), { error: `must be ${listed}` })
    .default(fallback);
}

/** A default key's schema: one of its values, the built-in one when omitted. */
type DefaultKey<T extends string> = z.ZodDefault<z.ZodCustom<T, T>>;

/** The schema of each `agents` default key. */
export type AgentDefaultKeys = {
  readonly defaultApproval: DefaultKey<Approval>;
  readonly defaultEffort: DefaultKey<Effort>;
  readonly defaultStrategy: DefaultKey<Strategy>;
};

/** The schema of each default key, to spread into the `agents` object schema. */
export function agentDefaultKeys(): AgentDefaultKeys {
  return {
    defaultApproval: oneOf(APPROVALS, AGENT_DEFAULTS.defaultApproval),
    defaultEffort: oneOf(EFFORTS, AGENT_DEFAULTS.defaultEffort),
    defaultStrategy: oneOf(STRATEGIES, AGENT_DEFAULTS.defaultStrategy),
  };
}

/** The default keys as the `agents` example of a config error shows them, each with its built-in value. */
export function agentDefaultsExample(): string {
  const { defaultApproval, defaultEffort, defaultStrategy } = AGENT_DEFAULTS;

  const strategy = `defaultStrategy: "${defaultStrategy}"`;

  return `${strategy}, defaultApproval: "${defaultApproval}", defaultEffort: "${defaultEffort}"`;
}
