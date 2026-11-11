/** The texts and names of the `turbo` config section. */

/** The tasks sync generates itself, so a config cannot name them. */
export const GENERATED_TASKS: readonly string[] = ["typecheck", "test"];
export const SECTION_ERROR = "must be an object like { tasks: { deploy: { cache: false } } }";
export const TASKS_ERROR = "must be an object of turbo tasks, each like { cache: false, dependsOn: [...] }";
export const TASK_ERROR = 'must be an object like { cache: false, dependsOn: ["^build"] }';
export const LIST_ERROR = "must be a list of strings";
export const FLAG_ERROR = "must be true or false";
/** The line for a task the config names but sync generates. */
export function generatedTask(name: string): string {
  return `turbo.tasks ${JSON.stringify(name)} is generated; pick another name`;
}
