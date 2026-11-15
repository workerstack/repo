import { NATIVE_TYPESCRIPT_MAJOR } from "./sync/vscode-defaults.constants.ts";

export const TYPESCRIPT_NAME: string = "typescript";
export const ADD: string = "bun add";
export const ADD_DEV: string = "bun add -d";

/** The line for a root that installs typescript `installed`, below the floor, with `add` naming the wanted version. */
export function typescriptLine(installed: string, add: string): string {
  const floor = `${TYPESCRIPT_NAME} ${NATIVE_TYPESCRIPT_MAJOR} or later`;

  return `${TYPESCRIPT_NAME} ${installed} is installed; repo needs ${floor}; run \`${add}\``;
}
