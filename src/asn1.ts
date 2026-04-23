// Minimal ASN.1 DER parser. Not a full X.509 implementation — just enough to
// walk a Certificate structure, find extensions, and extract the logotype
// extension content. Intentionally small (~150 lines) so the Worker bundle
// stays lean.

export interface ASN1 {
  tag: number;           // raw tag byte
  class: number;         // 0=universal, 1=application, 2=context, 3=private
  constructed: boolean;  // bit 6 of tag
  number: number;        // low 5 bits of tag, or multi-byte for high-tag-number
  start: number;         // offset of tag byte in source
  headerLen: number;     // tag + length bytes
  length: number;        // declared length of content
  end: number;           // start + headerLen + length
  content: Uint8Array;   // bytes of the content (not the header)
  children?: ASN1[];     // parsed recursively if constructed
}

export function parseDER(bytes: Uint8Array, offset = 0, end = bytes.length): ASN1 {
  const tag = bytes[offset];
  const classBits = (tag >> 6) & 0x3;
  const constructed = (tag & 0x20) !== 0;
  let number = tag & 0x1f;
  let cursor = offset + 1;

  // High-tag-number form (number >= 31)
  if (number === 0x1f) {
    number = 0;
    while (cursor < end) {
      const b = bytes[cursor++];
      number = (number << 7) | (b & 0x7f);
      if ((b & 0x80) === 0) break;
    }
  }

  // Length
  let length: number;
  const first = bytes[cursor++];
  if (first < 0x80) {
    length = first;
  } else {
    const numLen = first & 0x7f;
    if (numLen === 0) throw new Error('Indefinite length not supported in DER');
    length = 0;
    for (let i = 0; i < numLen; i++) {
      length = (length << 8) | bytes[cursor++];
    }
  }

  const headerLen = cursor - offset;
  const contentStart = cursor;
  const contentEnd = contentStart + length;
  if (contentEnd > end) {
    throw new Error(`ASN.1 overrun: content ends at ${contentEnd}, parent ends at ${end}`);
  }

  const node: ASN1 = {
    tag,
    class: classBits,
    constructed,
    number,
    start: offset,
    headerLen,
    length,
    end: contentEnd,
    content: bytes.subarray(contentStart, contentEnd),
  };

  if (constructed) {
    node.children = [];
    let c = contentStart;
    while (c < contentEnd) {
      const child = parseDER(bytes, c, contentEnd);
      node.children.push(child);
      c = child.end;
    }
  }

  return node;
}

// Decode a DER-encoded OID into dotted notation.
export function decodeOID(bytes: Uint8Array): string {
  const parts: number[] = [];
  const first = bytes[0];
  parts.push(Math.floor(first / 40));
  parts.push(first % 40);
  let value = 0;
  for (let i = 1; i < bytes.length; i++) {
    const b = bytes[i];
    value = (value << 7) | (b & 0x7f);
    if ((b & 0x80) === 0) {
      parts.push(value);
      value = 0;
    }
  }
  return parts.join('.');
}

// Decode a DER-encoded integer into a hex string (for serial numbers, etc.)
export function decodeIntegerHex(bytes: Uint8Array): string {
  // Skip leading zero that indicates positive sign
  let start = 0;
  if (bytes.length > 1 && bytes[0] === 0x00) start = 1;
  return Array.from(bytes.subarray(start))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

// Decode a DER-encoded time (UTCTime or GeneralizedTime) into ISO 8601.
export function decodeTime(node: ASN1): string {
  const s = new TextDecoder('ascii').decode(node.content);
  // UTCTime tag is 0x17, GeneralizedTime is 0x18
  if (node.tag === 0x17) {
    // YYMMDDHHMMSSZ
    const yy = parseInt(s.slice(0, 2), 10);
    const year = yy < 50 ? 2000 + yy : 1900 + yy;
    return `${year}-${s.slice(2, 4)}-${s.slice(4, 6)}T${s.slice(6, 8)}:${s.slice(8, 10)}:${s.slice(10, 12)}Z`;
  }
  if (node.tag === 0x18) {
    // YYYYMMDDHHMMSSZ
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}Z`;
  }
  return s;
}

// Decode an ASCII/UTF8 string-ish DER node
export function decodeString(node: ASN1): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(node.content);
}

// PEM → DER bytes. Accepts a PEM with one or more BEGIN CERTIFICATE blocks;
// returns the first certificate's DER. VMC .pem files contain a chain, and
// the end-entity cert is the first block.
export function pemToDER(pem: string): Uint8Array {
  const match = pem.match(/-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/);
  if (!match) throw new Error('No PEM certificate block found');
  const b64 = match[1].replace(/\s+/g, '');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
