import { INIT_COMMAND, MENU_MESSAGE, MENU_OPTIONS, QUIT_CHOICE } from "./main.constants.ts";
import { select } from "./prompt.ts";

/** The command picked from the TTY menu, `init` by default; null when the user quits. */
export async function selectCommand(): Promise<string | null> {
  const choice = await select({ initialValue: INIT_COMMAND, message: MENU_MESSAGE, options: [...MENU_OPTIONS] });

  return choice === QUIT_CHOICE ? null : choice;
}
