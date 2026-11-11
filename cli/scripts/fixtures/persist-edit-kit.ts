/** A saved doc and the edit-then-validate helpers the handoff and journal validator suites share. */
import { expect } from "vitest";

/** The saved filename and text a validator suite edits. */
export type SavedDoc = { filename: string; text: string };

/** `edit` swaps one piece of the saved text; `errorsOf` runs the validator on a text. */
export type DocEditor = {
  edit: (from: string, to: string) => string;
  errorsOf: (text: string, filename?: string) => string[];
};

/** The filename and text of a save, empty when it was refused. */
export function savedDoc(r: { filename?: string; content?: string }): SavedDoc {
  return { filename: r.filename ?? "", text: r.content ?? "" };
}

/** Helpers that edit `saved` and validate the result with `validate`. */
export function docEditor(saved: SavedDoc, validate: (filename: string, text: string) => string[]): DocEditor {
  return {
    edit: (from, to) => {
      expect(saved.text).toContain(from);
      return saved.text.replace(from, to);
    },
    errorsOf: (text, filename = saved.filename) => validate(filename, text),
  };
}
