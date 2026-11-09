import { expect, it } from "vitest";
import { MAX_REQUESTS_PER_DAY } from "./jev.ts";
import {
  DAY,
  answerBody,
  go,
  plainReply,
  plantDir,
  plantLedger,
  readLedgerFile,
  reply,
  scripted,
  sleeper,
} from "./fixtures/jev-kit.ts";

const retry = (status: number, header: Record<string, string> | undefined) =>
  scripted(reply(status, null, header), reply(200, answerBody()));

it("retries a 529 once after the advertised wait and counts both requests", async () => {
  const home = plantDir();
  const { waits, sleep } = sleeper();
  const fetchImpl = retry(529, { "Retry-After": "1" });
  expect((await go({ home, fetchImpl, sleep })).code).toBe(0);
  expect(waits).toEqual([1000]);
  expect(fetchImpl.calls).toBe(2);
  expect(readLedgerFile(home).requests).toBe(2);
});

it("waits from an HTTP date measured against the injected clock", async () => {
  const { waits, sleep } = sleeper();
  await go({ home: plantDir(), fetchImpl: retry(429, { "Retry-After": "Fri, 09 Oct 2026 12:00:01 GMT" }), sleep });
  expect(waits).toEqual([1000]);
});

it("reads Retry-After from a plain header map", async () => {
  const { waits, sleep } = sleeper();
  const fetchImpl = scripted(plainReply(429, { "retry-after": "0" }), reply(200, answerBody()));
  await go({ home: plantDir(), fetchImpl, sleep });
  expect(waits).toEqual([0]);
  expect(fetchImpl.calls).toBe(2);
});

it.each([reply(429, null), plainReply(429, {}), plainReply(429, null)])(
  "does not retry without a Retry-After header (%#)",
  async (first) => {
    const fetchImpl = scripted(first, reply(200, answerBody()));
    expect((await go({ home: plantDir(), fetchImpl })).code).toBe(2);
    expect(fetchImpl.calls).toBe(1);
  },
);

it("stops the retry when the second attempt hits the request cap", async () => {
  const home = plantDir();
  plantLedger(home, { day: DAY, requests: MAX_REQUESTS_PER_DAY - 1, input_tokens: 0 });
  const fetchImpl = retry(429, { "retry-after": "0" });
  expect((await go({ home, fetchImpl, sleep: sleeper().sleep })).text).toBe("daily request cap 40\n");
  expect(fetchImpl.calls).toBe(1);
});

it("stops the retry when the second attempt fails on the network", async () => {
  const fetchImpl = scripted(reply(429, null, { "retry-after": "0" }), new Error("down"));
  expect((await go({ home: plantDir(), fetchImpl, sleep: sleeper().sleep })).text).toBe("jev request failed\n");
});
