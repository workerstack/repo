export const PACKAGE_NAME: string = "@workerstack/repo";
export const INSTALLED_MANIFEST: readonly string[] = ["node_modules", "@workerstack", "repo", "package.json"];
export const LATEST_TIMEOUT_MS: number = 5000;
export const LATEST_TAG: string = "latest";
const NPM_NAME: string = "npm";
export const NOT_FOUND_WHY: string = "not found";
export const NO_LATEST_WHY: string = "no latest tag";
export const TRAILING_SLASH: RegExp = /\/?$/;
export const SLASH: string = "/";

export function behindLine(installed: string, latest: string): string {
  return (
    `${PACKAGE_NAME} ${installed} is behind ${latest} on ${NPM_NAME}; ` +
    `run \`bun update ${PACKAGE_NAME}\` and \`bun repo sync\``
  );
}

export function skippedLine(why: string): string {
  return `could not ask ${NPM_NAME} for the latest ${PACKAGE_NAME} (${why}); the version check is skipped`;
}
