import { under } from "../docs.constants.ts";

const README_FILE = "README.md";
export const PACKAGE_FILE = "package.json";
export const CONTENTS_TITLE = "Contents";
export const MAX_HEADING = 6;

/** The root-relative path of the README of the doc root `dir`. */
export function readmePath(dir: string): string {
  return under(dir, README_FILE);
}

export function handWritten(path: string): string {
  return `${path} is hand-written; move its text into references/ and delete it so repo sync can generate it. Nothing was written.`;
}
