import { PACKAGE_NAME } from "../sync/package-name.constants.ts";

/** The package.json a fresh init writes for a package at version 0.7.0. */
export function freshPackageJson(): object {
  return {
    devDependencies: { [PACKAGE_NAME]: "0.7.0" },
    packageManager: `bun@${Bun.version}`,
    private: true,
    scripts: { postinstall: "repo sync --postinstall" },
    sideEffects: false,
  };
}
