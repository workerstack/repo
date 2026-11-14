import { GIT_CONFIG_ENV, GIT_ENV_PREFIX } from "./lint.constants.ts";

/**
 * `env` without any `GIT_*` variable. Git hands a hook GIT_DIR, GIT_INDEX_FILE and more; a tool run from one that
 * kept them would aim every git call it makes, a test's `git init` in its own temp dir included, at the repo being
 * committed. `GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_<n>`, `GIT_CONFIG_VALUE_<n>`, `GIT_CONFIG_GLOBAL` and
 * `GIT_CONFIG_SYSTEM` stay: they set config, not the repo (the test setup uses them to switch off background git and
 * to check files out with CRLF), and git does not hand them to hooks.
 */
export function toolEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter(([name]) => !name.startsWith(GIT_ENV_PREFIX) || GIT_CONFIG_ENV.test(name)),
  );
}
