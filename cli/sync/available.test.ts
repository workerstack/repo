import { describe, expect, it } from "vitest";
import { available } from "./available.ts";
import { AVAILABLE_INDEX_PATH } from "./available.constants.ts";

const REPO = "- [@workerstack/repo](https://www.npmjs.com/package/@workerstack/repo): Agent workflows";
const SYSTEM = "- [@workerstack/system](https://www.npmjs.com/package/@workerstack/system): Manage every OS dependency";
const DATABASE = "- [@workerstack/database](https://www.npmjs.com/package/@workerstack/database): Typed queries";

/** A reader that serves `text` only at the installed index path. */
function reader(text: string | null): (rel: string) => string | null {
  return (rel) => (rel === AVAILABLE_INDEX_PATH ? text : null);
}

describe("available", () => {
  it("lists each uninstalled package in index order with its link and description", () => {
    const text = `# workerstack packages\n\nIntro.\n\n${REPO}\n${SYSTEM}\n${DATABASE}\n`;
    expect(available(reader(text), new Set(["@workerstack/repo"]))).toBe(`${SYSTEM}\n${DATABASE}`);
  });

  it("is an empty body when every name is installed", () => {
    const text = `${REPO}\n${SYSTEM}\n`;
    expect(available(reader(text), new Set(["@workerstack/repo", "@workerstack/system"]))).toBe("");
  });

  it("is null when no index is installed", () => {
    expect(available(reader(null), new Set())).toBeNull();
  });

  it("skips lines that are not entries", () => {
    const text = `# Title\n- [no url] missing\n- plain bullet\n${SYSTEM}\n  ${DATABASE}\n`;
    expect(available(reader(text), new Set())).toBe(SYSTEM);
  });

  it("skips every line inside a repo section", () => {
    const text = `${REPO}\n<!-- repo:stack -->\n${SYSTEM}\n<!-- /repo:stack -->\n${DATABASE}\r\n`;
    expect(available(reader(text), new Set())).toBe(`${REPO}\n${DATABASE}`);
  });

  it("reads a hashed index, as the published one's sync writes it, the same as an unhashed one", () => {
    const text = `${REPO}\n<!-- repo:packages 1a2b3c4d -->  \n${SYSTEM}\n<!-- /repo:packages -->\n${DATABASE}\n`;
    expect(available(reader(text), new Set())).toBe(`${REPO}\n${DATABASE}`);
  });
});
