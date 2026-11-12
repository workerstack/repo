/** The root vitest config sync owns, listing each package's config under `projects`. */
export const VITEST_CONFIG_PATH: string = "vitest.config.ts";

/** The config file a package commits, which the root lists under `projects`. */
export const PACKAGE_VITEST_CONFIG: string = "vitest.config.ts";
export const VITEST_IMPORT: string = 'import { defineConfig } from "vitest/config";';
export const VITEST_REFUSAL: string = `${VITEST_CONFIG_PATH} is hand-written; delete it so repo sync can own it`;
