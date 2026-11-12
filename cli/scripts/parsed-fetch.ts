/** The platform's fetch with its reply body parsed at the edge, so a `json()` port can promise JSON. */
import { z } from "zod";

import type { Json } from "../json.ts";

/** The slice of a fetch Response the scripts read, with `json()` resolving to a parsed JSON value. */
export type ParsedResponse = {
  ok: boolean;
  status: number;
  headers: Headers;
  text: () => Promise<string>;
  json: () => Promise<Json>;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

/** Fetches `url` with the global fetch of the moment; `json()` reads the body as JSON and parses it as `Json`. */
export async function parsedFetch(url: string, init: RequestInit): Promise<ParsedResponse> {
  const res = await fetch(url, init);

  return {
    arrayBuffer: () => res.arrayBuffer(),
    headers: res.headers,
    json: async () => z.json().parse(await res.json()),
    ok: res.ok,
    status: res.status,
    text: () => res.text(),
  };
}
