/** Websocket frames for the fake engine: one text frame out, every whole frame of a buffer in. */
import {
  FIN_TEXT,
  HEADER,
  HEADER16,
  HEADER64,
  LEN16,
  LEN64,
  LEN_MASK,
  MASK_BIT,
  MASK_LEN,
  MAX_LEN16,
  OPCODE_MASK,
  OP_BINARY,
  OP_CLOSE,
  OP_TEXT,
} from "./browser.constants.ts";
import type { WsDecoded, WsMessage } from "./browser.types.ts";

/** One frame read: where it ends and the message it carries, if any. */
type Frame = { end: number; message: WsMessage | null };

function headerOf(len: number): Buffer {
  if (len < LEN16) return Buffer.from([FIN_TEXT, len]);
  if (len < MAX_LEN16) {
    const header = Buffer.from([FIN_TEXT, LEN16, 0, 0]);
    header.writeUInt16BE(len, HEADER);
    return header;
  }
  const header = Buffer.alloc(HEADER64);
  header.set([FIN_TEXT, LEN64]);
  header.writeBigUInt64BE(BigInt(len), HEADER);
  return header;
}

/** `data` as one unmasked text frame, the way a server sends it. */
export function encodeWsFrame(data: string): Buffer {
  const payload = Buffer.from(data);
  return Buffer.concat([headerOf(payload.length), payload]);
}

/** The payload length of the frame at `offset` and where its mask or payload starts; null when the header is partial. */
function lengthAt(buf: Buffer, offset: number): { len: number; start: number } | null {
  const left = buf.length - offset;
  if (left < HEADER) return null;
  const short = buf.readUInt8(offset + 1) & LEN_MASK;
  if (short === LEN16) {
    return left < HEADER16 ? null : { len: buf.readUInt16BE(offset + HEADER), start: offset + HEADER16 };
  }
  if (short === LEN64) {
    return left < HEADER64
      ? null
      : {
          len: Number(buf.readBigUInt64BE(offset + HEADER)),
          start: offset + HEADER64,
        };
  }
  return { len: short, start: offset + HEADER };
}

function unmask(payload: Buffer, mask: Buffer): Buffer {
  return Buffer.from(payload.map((b, i) => b ^ mask.readUInt8(i % MASK_LEN)));
}

function messageOf(opcode: number, payload: Buffer): WsMessage | null {
  if (opcode === OP_CLOSE) return { type: "close" };
  if (opcode === OP_TEXT || opcode === OP_BINARY) return { data: payload.toString("utf8"), type: "msg" };
  return null;
}

function frameAt(buf: Buffer, offset: number): Frame | null {
  const head = lengthAt(buf, offset);
  if (!head) return null;
  const masked = (buf.readUInt8(offset + 1) & MASK_BIT) !== 0;
  const start = masked ? head.start + MASK_LEN : head.start;
  const end = start + head.len;
  if (buf.length < end) return null;
  const raw = buf.subarray(start, end);
  const payload = masked ? unmask(raw, buf.subarray(head.start, start)) : raw;
  return {
    end,
    message: messageOf(buf.readUInt8(offset) & OPCODE_MASK, payload),
  };
}

/** Every whole frame of `buf` as a message, and the bytes of the partial frame after them. */
export function decodeWsFrames(buf: Buffer): WsDecoded {
  const messages: WsMessage[] = [];
  let offset = 0;
  for (let frame = frameAt(buf, offset); frame; frame = frameAt(buf, offset)) {
    offset = frame.end;
    if (frame.message) messages.push(frame.message);
  }
  return { messages, rest: buf.subarray(offset) };
}
