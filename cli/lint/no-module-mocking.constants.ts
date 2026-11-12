/** The vi and jest methods that replace a whole module for the file that calls them. */
export const MODULE_MOCK_METHODS: readonly string[] = ["mock", "doMock", "unstable_mockModule"];

/** Each test framework object, global or imported, by the package that exports it under that name. */
export const FRAMEWORK_SOURCES: Readonly<Record<string, string>> = { jest: "@jest/globals", vi: "vitest" };
