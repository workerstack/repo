/** The `turbo` section of workerstack.config.ts: extra turbo tasks, merged after the generated `typecheck` and `test`. */
import { z } from "zod";

import {
  FLAG_ERROR,
  GENERATED_TASKS,
  LIST_ERROR,
  SECTION_ERROR,
  TASKS_ERROR,
  TASK_ERROR,
} from "./turbo-config.constants.ts";

/** One turbo task, as `turbo.json` takes it. */
export type TurboTask = {
  /** Whether turbo caches the task; `false` for a task that must always run. */
  cache?: boolean | undefined;
  /** The tasks that run first, like `^build` for the dependencies' builds. */
  dependsOn?: readonly string[] | undefined;
  /** The environment variables that are part of the task's cache key. */
  env?: readonly string[] | undefined;
  /** The files that are part of the task's cache key; all of the package's files when omitted. */
  inputs?: readonly string[] | undefined;
  /** The files turbo caches and restores for the task. */
  outputs?: readonly string[] | undefined;
  /** The environment variables the task sees without them being part of its cache key. */
  passThroughEnv?: readonly string[] | undefined;
  /** Whether the task never exits, like a dev server. */
  persistent?: boolean | undefined;
};
/** What the generated `turbo.json` reads. */
export type ResolvedTurbo = {
  /** The extra tasks, by name; empty when the config lists none. */
  readonly tasks: Readonly<Record<string, TurboTask>>;
};

type TaskSchema = z.ZodObject<
  {
    cache: z.ZodOptional<z.ZodBoolean>;
    dependsOn: z.ZodOptional<z.ZodReadonly<z.ZodArray<z.ZodString>>>;
    env: z.ZodOptional<z.ZodReadonly<z.ZodArray<z.ZodString>>>;
    inputs: z.ZodOptional<z.ZodReadonly<z.ZodArray<z.ZodString>>>;
    outputs: z.ZodOptional<z.ZodReadonly<z.ZodArray<z.ZodString>>>;
    passThroughEnv: z.ZodOptional<z.ZodReadonly<z.ZodArray<z.ZodString>>>;
    persistent: z.ZodOptional<z.ZodBoolean>;
  },
  z.core.$strict
>;
type TurboSchema = z.ZodObject<{ tasks: z.ZodOptional<z.ZodRecord<z.ZodString, TaskSchema>> }, z.core.$strict>;

function buildSchema(): TurboSchema {
  const list = z
    .array(z.string({ error: LIST_ERROR }), { error: LIST_ERROR })
    .readonly()
    .optional();
  const flag = z.boolean({ error: FLAG_ERROR }).optional();
  const task = z.strictObject(
    {
      cache: flag,
      dependsOn: list,
      env: list,
      inputs: list,
      outputs: list,
      passThroughEnv: list,
      persistent: flag,
    },
    { error: TASK_ERROR },
  );
  return z.strictObject(
    { tasks: z.record(z.string(), task, { error: TASKS_ERROR }).optional() },
    { error: SECTION_ERROR },
  );
}

export const turboSchema: TurboSchema = /* @__PURE__ */ buildSchema();

/** The task names of a parsed `turbo` section that sync generates itself. */
export function generatedNames(turbo: z.output<typeof turboSchema> | undefined): string[] {
  return Object.keys(turbo?.tasks ?? {}).filter((name) => GENERATED_TASKS.includes(name));
}

/** The parsed config's `turbo` section with its tasks filled in; undefined when the config has none. */
export function turboOf(turbo: z.output<typeof turboSchema> | undefined): ResolvedTurbo | undefined {
  return turbo === undefined ? undefined : { tasks: turbo.tasks ?? {} };
}
