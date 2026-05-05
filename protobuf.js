/**
 * Protobuf Wire Format Parser — schema-free decoder
 *
 * Wire types:
 *   0 → Varint          (int32, int64, uint32, uint64, sint32, sint64, bool, enum)
 *   1 → 64-bit          (fixed64, sfixed64, double)
 *   2 → Length-delimited (string, bytes, embedded messages, packed repeated fields)
 *   5 → 32-bit          (fixed32, sfixed32, float)
 */

(function () {
"use strict";

const WIRE_TYPE_NAMES = {
  0: "varint",
  1: "64-bit",
  2: "len-delimited",
  3: "start-group",
  4: "end-group",
  5: "32-bit",
};

/**
 * Read a varint from a Uint8Array starting at offset.
 * Returns { value: BigInt, nextOffset: number }
 */
function readVarint(buf, offset) {
  let result = 0n;
  let shift = 0n;
  let i = offset;
  while (i < buf.length) {
    const byte = BigInt(buf[i]);
    result |= (byte & 0x7fn) << shift;
    i++;
    if ((buf[i - 1] & 0x80) === 0) break;
    shift += 7n;
    if (shift > 63n) throw new Error(`Varint too long at offset ${offset}`);
  }
  return { value: result, nextOffset: i };
}

/**
 * Decode a zigzag-encoded signed integer.
 */
function zigzagDecode(n) {
  return (n >> 1n) ^ -(n & 1n);
}

/**
 * Try to interpret a length-delimited field as a nested protobuf message.
 * Returns parsed fields array or null if it doesn't look like valid protobuf.
 */
function tryParseNested(bytes) {
  try {
    const fields = parseMessage(bytes);
    if (fields.length === 0) return null;
    return fields;
  } catch {
    return null;
  }
}

/**
 * Try to decode bytes as a UTF-8 string.
 * Returns the string or null if it contains non-printable characters.
 */
function tryDecodeString(bytes) {
  try {
    const str = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    // Accept if at least 50% are printable ASCII/unicode letters
    const printable = str.split("").filter((c) => c.charCodeAt(0) >= 0x20).length;
    if (printable / str.length >= 0.7) return str;
    return null;
  } catch {
    return null;
  }
}

/**
 * Convert bytes to a hex string.
 */
function toHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(" ");
}

/**
 * Parse a protobuf-encoded Uint8Array and return an array of field descriptors.
 */
function parseMessage(buf, depth = 0) {
  if (depth > 10) throw new Error("Max nesting depth exceeded");
  const fields = [];
  let offset = 0;

  while (offset < buf.length) {
    // Read tag (field number + wire type)
    const tagResult = readVarint(buf, offset);
    offset = tagResult.nextOffset;
    const tag = tagResult.value;
    const wireType = Number(tag & 0x7n);
    const fieldNumber = Number(tag >> 3n);

    if (fieldNumber === 0) throw new Error(`Invalid field number 0 at offset ${offset}`);

    const field = { fieldNumber, wireType, wireTypeName: WIRE_TYPE_NAMES[wireType] ?? "unknown" };

    if (wireType === 0) {
      // Varint
      const v = readVarint(buf, offset);
      offset = v.nextOffset;
      const raw = v.value;
      field.value = raw.toString();
      field.valueSigned = zigzagDecode(raw).toString();
      field.valueHex = "0x" + raw.toString(16);
      field.type = "varint";
    } else if (wireType === 1) {
      // 64-bit little-endian
      if (offset + 8 > buf.length) throw new Error("Buffer underflow reading 64-bit");
      const slice = buf.slice(offset, offset + 8);
      offset += 8;
      const dv = new DataView(slice.buffer, slice.byteOffset, 8);
      field.valueDouble = dv.getFloat64(0, true);
      field.valueFixed64 = dv.getBigUint64(0, true).toString();
      field.valueHex = toHex(slice);
      field.type = "64-bit";
    } else if (wireType === 2) {
      // Length-delimited
      const lenResult = readVarint(buf, offset);
      offset = lenResult.nextOffset;
      const len = Number(lenResult.value);
      if (offset + len > buf.length) throw new Error("Buffer underflow reading bytes");
      const bytes = buf.slice(offset, offset + len);
      offset += len;
      field.type = "len-delimited";
      field.byteLength = len;

      // Try nested message first
      const nested = tryParseNested(bytes);
      if (nested !== null) {
        field.interpretation = "message";
        field.fields = nested;
      } else {
        // Try string
        const str = tryDecodeString(bytes);
        if (str !== null) {
          field.interpretation = "string";
          field.value = str;
        } else {
          field.interpretation = "bytes";
          field.value = toHex(bytes);
        }
      }
    } else if (wireType === 5) {
      // 32-bit little-endian
      if (offset + 4 > buf.length) throw new Error("Buffer underflow reading 32-bit");
      const slice = buf.slice(offset, offset + 4);
      offset += 4;
      const dv = new DataView(slice.buffer, slice.byteOffset, 4);
      field.valueFloat = dv.getFloat32(0, true);
      field.valueFixed32 = dv.getUint32(0, true);
      field.valueHex = toHex(slice);
      field.type = "32-bit";
    } else if (wireType === 3 || wireType === 4) {
      // Groups (deprecated, skip)
      field.type = "group";
      field.value = "(group — deprecated, not decoded)";
    } else {
      throw new Error(`Unknown wire type ${wireType} at offset ${offset}`);
    }

    fields.push(field);
  }

  return fields;
}

/**
 * Parse a hex string (with or without spaces/0x prefixes) into Uint8Array.
 */
function fromHex(str) {
  const clean = str.replace(/0x/gi, "").replace(/\s+/g, "");
  if (clean.length % 2 !== 0) throw new Error("Hex string has odd length");
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const byte = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if (isNaN(byte)) throw new Error(`Invalid hex character at position ${i * 2}`);
    bytes[i] = byte;
  }
  return bytes;
}

/**
 * Parse a Base64 string into Uint8Array.
 */
function fromBase64(str) {
  const clean = str.trim().replace(/\s+/g, "");
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Auto-detect input format and return Uint8Array.
 * Supports: hex (0a 1b ...), base64, or raw binary string.
 */
function detectAndDecode(input) {
  const trimmed = input.trim();

  // Base64: only base64 chars and padding
  const b64re = /^[A-Za-z0-9+/\r\n]+=*$/;
  // Hex: groups of 2 hex chars optionally separated by spaces or 0x prefix
  const hexre = /^(0x)?[0-9a-fA-F]{2}([\s,]*(0x)?[0-9a-fA-F]{2})*$/;

  if (hexre.test(trimmed)) {
    return { bytes: fromHex(trimmed), format: "hex" };
  }
  if (b64re.test(trimmed) && trimmed.length % 4 === 0) {
    return { bytes: fromBase64(trimmed), format: "base64" };
  }
  // Try base64 anyway (some encodings don't pad)
  try {
    return { bytes: fromBase64(trimmed), format: "base64" };
  } catch {
    // Last resort: treat as hex
    return { bytes: fromHex(trimmed), format: "hex" };
  }
}

// Export for use in popup.js
window.ProtobufParser = { parseMessage, detectAndDecode, toHex };

})();
