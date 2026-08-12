/**
 * Minimal OSC 1.0 encoder and UDP sender.
 *
 * Implemented directly on `node:dgram` rather than pulling a dependency: the
 * subset needed here — an address string, a type-tag string, and float/int/
 * string arguments, each null-padded to a four-byte boundary — is small enough
 * to audit in one screen, which matters more in this repository than brevity.
 *
 * Outbound only in v0.2. Accepting OSC *into* the instrument would let a
 * process on the machine set control amounts, which is an authority question
 * the local-only posture has not answered.
 */

import { createSocket, type Socket } from "node:dgram";

export type OscArgument = number | string | boolean | { readonly oscInt: number };

function padTo4(length: number): number {
  return (4 - (length % 4)) % 4;
}

function encodeString(value: string): Buffer {
  // OSC strings are null-terminated and padded to a four-byte boundary, so a
  // string whose length is already a multiple of four still gains four nulls.
  const raw = Buffer.from(value, "utf8");
  const terminated = Buffer.concat([raw, Buffer.from([0])]);
  return Buffer.concat([terminated, Buffer.alloc(padTo4(terminated.length))]);
}

function encodeArgument(value: OscArgument): { tag: string; bytes: Buffer } {
  if (typeof value === "string") {
    return { tag: "s", bytes: encodeString(value) };
  }
  if (typeof value === "boolean") {
    // OSC 1.0 encodes booleans as type tags carrying no payload.
    return { tag: value ? "T" : "F", bytes: Buffer.alloc(0) };
  }
  if (typeof value === "object") {
    const bytes = Buffer.alloc(4);
    bytes.writeInt32BE(value.oscInt, 0);
    return { tag: "i", bytes };
  }
  // Always float32. Choosing the tag from whether a value happens to be
  // integral would make one address change type between frames, which breaks
  // any receiver with a fixed expectation. Integers travel through
  // `oscInteger` when a caller genuinely means one.
  const bytes = Buffer.alloc(4);
  // Non-finite values must never reach a consumer as a number; the caller is
  // expected to route absence through the status address instead.
  bytes.writeFloatBE(Number.isFinite(value) ? value : 0, 0);
  return { tag: "f", bytes };
}

/** Marks a value that must travel as an OSC int32 rather than a float. */
export interface OscInteger {
  readonly oscInt: number;
}

export function oscInteger(value: number): OscInteger {
  if (!Number.isInteger(value) || Math.abs(value) > 2_147_483_647) {
    throw new RangeError("An OSC integer must be a 32-bit signed integer.");
  }
  return { oscInt: value };
}

export function encodeOscMessage(
  address: string,
  args: readonly OscArgument[] = []
): Buffer {
  if (!address.startsWith("/")) {
    throw new RangeError("An OSC address must begin with '/'.");
  }
  const encoded = args.map(encodeArgument);
  const typeTags = `,${encoded.map((item) => item.tag).join("")}`;
  return Buffer.concat([
    encodeString(address),
    encodeString(typeTags),
    ...encoded.map((item) => item.bytes)
  ]);
}

export interface OscTarget {
  host: string;
  port: number;
}

export class OscEmitter {
  readonly #socket: Socket;
  readonly #target: OscTarget;
  #closed = false;

  constructor(target: OscTarget) {
    if (!Number.isInteger(target.port) || target.port < 1 || target.port > 65_535) {
      throw new RangeError("An OSC target port must be an integer inside 1..65535.");
    }
    this.#target = target;
    // An IPv6 target needs an IPv6 socket; sending to `::1` from a udp4 socket
    // fails silently into the error handler below, which would look like the
    // emitter working while nothing arrives.
    this.#socket = createSocket(target.host.includes(":") ? "udp6" : "udp4");
    this.#socket.unref();
    this.#socket.on("error", () => {
      // A UDP send failure must not take down the gateway; the frame is
      // still available over every other transport.
    });
  }

  send(address: string, args: readonly OscArgument[] = []): void {
    if (this.#closed) return;
    const message = encodeOscMessage(address, args);
    this.#socket.send(message, this.#target.port, this.#target.host, () => undefined);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#socket.close();
  }
}
