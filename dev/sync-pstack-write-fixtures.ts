/** Upstream bro skill in the three shapes the write tests fetch. */
export const BRO_LONG = `---
name: bro
description: Restate the last message in plain human language, with no jargon.
disable-model-invocation: true
---

Restate your last message. Stop using jargon and speak coherently. State it more simply and concisely, like one human talking to another.
`;

export const BRO_SHORT = `---
name: bro
description: Restate the last message in plain human language, with no jargon.
disable-model-invocation: true
---

Restate your last message.
`;

export const BRO_NO_INVOCATION = `---
name: bro
description: Restate the last message in plain human language, with no jargon.
---

Restate your last message. Stop using jargon and speak coherently. State it more simply and concisely, like one human talking to another.
`;
