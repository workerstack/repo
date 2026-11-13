/** Optimal string alignment distance, used to infer a misspelled word. */

/** An adjacent swap looks two characters back in each word. */
const SWAP_SPAN = 2;

/** The cell at row `i`, column `j` of a table built row by row. */
function cell(table: number[][], i: number, j: number): number {
  const row = table[i] /* every row up to the current one was pushed already */ as number[];

  return row[j] /* every column up to the current one was pushed already */ as number;
}

/**
 * The fewest single-character insertions, deletions, substitutions and adjacent transpositions that turn `a` into
 * `b`, where no substring is edited twice.
 */
export function osaDistance(a: string, b: string): number {
  const rows: number[][] = [];

  for (let i = 0; i <= a.length; i++) {
    const row: number[] = [];

    rows.push(row);

    for (let j = 0; j <= b.length; j++) {
      if (i === 0 || j === 0) {
        row.push(i + j);
        continue;
      }

      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(cell(rows, i - 1, j) + 1, cell(rows, i, j - 1) + 1, cell(rows, i - 1, j - 1) + cost);

      const swapped =
        i >= SWAP_SPAN && j >= SWAP_SPAN && a[i - 1] === b[j - SWAP_SPAN] && a[i - SWAP_SPAN] === b[j - 1];

      if (swapped) d = Math.min(d, cell(rows, i - SWAP_SPAN, j - SWAP_SPAN) + 1);

      row.push(d);
    }
  }

  return cell(rows, a.length, b.length);
}
