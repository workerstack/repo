import { BRO_BODY } from "./sync-pstack-fixtures.ts";

/** Upstream bro skill in the three shapes the write tests fetch. */
export const BRO_LONG: string = `---
name: bro
description: Restate the last message in plain human language, with no jargon.
disable-model-invocation: true
---

${BRO_BODY}
`;

export const BRO_SHORT: string = `---
name: bro
description: Restate the last message in plain human language, with no jargon.
disable-model-invocation: true
---

Restate your last message.
`;

export const BRO_NO_INVOCATION: string = `---
name: bro
description: Restate the last message in plain human language, with no jargon.
---

${BRO_BODY}
`;
