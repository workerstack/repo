import type { CliDeps } from "./cli-deps.ts";
import { INIT_COMMAND, MENU_MESSAGE, MENU_OPTIONS, QUIT_CHOICE } from "./main.constants.ts";

/** The command picked from the TTY menu, `init` by default; null when the user quits. */
export async function selectCommand({ select }: Pick<CliDeps["prompts"], "select">): Promise<string | null> {
  const choice = await select({ initialValue: INIT_COMMAND, message: MENU_MESSAGE, options: [...MENU_OPTIONS] });

  return choice === QUIT_CHOICE ? null : choice;
}
