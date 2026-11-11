/** What a spawned process wrote on a stream: the text, a buffer decoded as UTF-8, or "" when it wrote none. */
export function streamText(stream: string | Buffer | null | undefined): string {
  if (typeof stream === "string") return stream;
  return stream instanceof Buffer ? stream.toString("utf8") : "";
}
