import { describe, expect, it } from "vitest";

import { stockBlock } from "./agents-stock.ts";
import { hashText } from "./stock-history.ts";

const STOCK = "# Agents\n\nRead the rules.\n- one\n- two\n";
const SHORT = "# Agents\n\nRead the rules.\n";
function rowsOf(text: string): string[] {
  return text.split("\n");
}

describe("stockBlock", () => {
  it("finds a stock copy between the user's lines, by the rows it spans", () => {
    const rows = rowsOf(`Team note\n${STOCK}Ship note\n`);
    expect(stockBlock(rows, [hashText(STOCK)])).toStrictEqual({ at: 1, end: 6 });
  });

  it("finds a block whether the stock text was hashed with its last newline or without it", () => {
    const rows = rowsOf(`Team note\n${STOCK}Ship note\n`);
    expect(stockBlock(rows, [hashText(STOCK.trimEnd())])).toStrictEqual({ at: 1, end: 6 });
    expect(stockBlock(rowsOf(STOCK.trimEnd()), [hashText(STOCK)])).toStrictEqual({ at: 0, end: 5 });
  });

  it("finds a stock copy in CRLF text", () => {
    const rows = rowsOf(`Team note\r\n${STOCK.replaceAll("\n", "\r\n")}Ship note\r\n`);
    expect(stockBlock(rows, [hashText(STOCK)])).toStrictEqual({ at: 1, end: 6 });
  });

  it("takes the longest block when more than one stock text matches, the earliest on a tie", () => {
    const rows = rowsOf(`${SHORT}x\n${STOCK}`);
    expect(stockBlock(rows, [hashText(SHORT), hashText(STOCK)])).toStrictEqual({ at: 4, end: 9 });
    expect(stockBlock(rowsOf(`${SHORT}x\n${SHORT}`), [hashText(SHORT)])).toStrictEqual({ at: 0, end: 3 });
  });

  it("finds none when one stock line is edited", () => {
    const rows = rowsOf(`Team note\n${STOCK.replace("- one", "- one!")}Ship note\n`);
    expect(stockBlock(rows, [hashText(STOCK)])).toBeNull();
  });

  it("finds none when only blank lines match, or no hash is given", () => {
    expect(stockBlock(rowsOf("x\n\n\ny\n"), [hashText(""), hashText("\n")])).toBeNull();
    expect(stockBlock(rowsOf(`Team note\n${STOCK}`), [])).toBeNull();
  });
});
