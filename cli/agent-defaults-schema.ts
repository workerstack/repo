/** The `agents` keys that set a repo's defaults: each one of its values, refused with them, else the built-in one. */
import { z } from "zod";

import { AGENT_DEFAULTS } from "./agent-defaults.constants.ts";
import { LAST } from "./config.constants.ts";
import { APPROVALS, EFFORTS, STRATEGIES } from "./scripts/strategy.constants.ts";
import type { Approval, Effort, Strategy } from "./scripts/strategy.types.ts";

/** One of `values`; another value is refused with the quoted values it takes. */
function oneOf<const T extends string>(values: readonly T[]) {
  const quoted = values.map((value) => JSON.stringify(value));
  const listed = `${quoted.slice(0, LAST).join(", ")} or ${quoted.at(LAST)}`;

  return z.custom<T>((input) => values.some((value) => value === input), { error: `must be ${listed}` });
}

/** A default key's validator: one of its values, with no fallback. */
type Choice<T extends string> = z.ZodCustom<T, T>;

/** The validator of each `agents` default key, which refuses a value that is not one of its own. */
type AgentDefaultChoices = {
  readonly defaultApproval: Choice<Approval>;
  readonly defaultEffort: Choice<Effort>;
  readonly defaultStrategy: Choice<Strategy>;
};

/** The validator of each default key, for a schema that leaves an omitted key unset. */
function agentDefaultChoices(): AgentDefaultChoices {
  return { defaultApproval: oneOf(APPROVALS), defaultEffort: oneOf(EFFORTS), defaultStrategy: oneOf(STRATEGIES) };
}

/** A default key's schema: one of its values, the built-in one when omitted. */
type DefaultKey<T extends string> = z.ZodDefault<Choice<T>>;

/** The schema of each `agents` default key. */
export type AgentDefaultKeys = {
  readonly defaultApproval: DefaultKey<Approval>;
  readonly defaultEffort: DefaultKey<Effort>;
  readonly defaultStrategy: DefaultKey<Strategy>;
};

/** The schema of each default key, to spread into the `agents` object schema. */
export function agentDefaultKeys(): AgentDefaultKeys {
  const choices = agentDefaultChoices();

  return {
    defaultApproval: choices.defaultApproval.default(AGENT_DEFAULTS.defaultApproval),
    defaultEffort: choices.defaultEffort.default(AGENT_DEFAULTS.defaultEffort),
    defaultStrategy: choices.defaultStrategy.default(AGENT_DEFAULTS.defaultStrategy),
  };
}

/** The schema of repo.config.local.ts: only the three agents defaults, each unset when omitted. */
type LocalSchema = z.ZodObject<
  {
    agents: z.ZodOptional<
      z.ZodObject<
        {
          defaultApproval: z.ZodOptional<Choice<Approval>>;
          defaultEffort: z.ZodOptional<Choice<Effort>>;
          defaultStrategy: z.ZodOptional<Choice<Strategy>>;
        },
        z.core.$strict
      >
    >;
  },
  z.core.$strict
>;

function buildLocalSchema(): LocalSchema {
  const choices = agentDefaultChoices();

  return z.strictObject({
    agents: z
      .strictObject({
        defaultApproval: choices.defaultApproval.optional(),
        defaultEffort: choices.defaultEffort.optional(),
        defaultStrategy: choices.defaultStrategy.optional(),
      })
      .optional(),
  });
}

/** What repo.config.local.ts may hold. */
export const localSchema: LocalSchema = /* @__PURE__ */ buildLocalSchema();

/** The default keys as the `agents` example of a config error shows them, each with its built-in value. */
export function agentDefaultsExample(): string {
  const { defaultApproval, defaultEffort, defaultStrategy } = AGENT_DEFAULTS;

  const strategy = `defaultStrategy: "${defaultStrategy}"`;

  return `${strategy}, defaultApproval: "${defaultApproval}", defaultEffort: "${defaultEffort}"`;
}
