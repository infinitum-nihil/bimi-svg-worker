import { parseDER, decodeOID, decodeIntegerHex, decodeTime, decodeString, pemToDER } from './asn1.ts';
import type { ASN1 } from './asn1.ts';
import { validate } from './validate.ts';
import type { InspectResponse } from './types.ts';

// OIDs we care about
const OID_COMMON_NAME      = '2.5.4.3';
const OID_ORG_NAME         = '2.5.4.10';
const OID_SUBJECT_ALT_NAME = '2.5.29.17';
const OID_LOGOTYPE_EXT     = '1.3.6.1.5.5.7.1.12';

interface ParsedCert {
  subject: string;
  issuer: string;
  serialNumber: string;
  notBefore: string;
  notAfter: string;
  sanDomains: string[];
  extensions: Map<string, ASN1>;  // OID -> extension node
}

// Walk a TBSCertificate per RFC 5280:
//   TBSCertificate  ::=  SEQUENCE  {
//     version         [0]  EXPLICIT Version DEFAULT v1,
//     serialNumber         CertificateSerialNumber,
//     signature            AlgorithmIdentifier,
//     issuer               Name,
//     validity             Validity,
//     subject              Name,
//     subjectPublicKeyInfo SubjectPublicKeyInfo,
//     issuerUniqueID  [1]  IMPLICIT UniqueIdentifier OPTIONAL,
//     subjectUniqueID [2]  IMPLICIT UniqueIdentifier OPTIONAL,
//     extensions      [3]  EXPLICIT Extensions OPTIONAL
//   }
export function parseCert(der: Uint8Array): ParsedCert {
  const cert = parseDER(der);
  if (!cert.children || cert.children.length < 3) throw new Error('Malformed certificate');
  const tbs = cert.children[0];
  if (!tbs.children) throw new Error('Malformed TBSCertificate');

  let idx = 0;
  // Optional [0] version
  if (tbs.children[idx].class === 2 && tbs.children[idx].number === 0) {
    idx++;
  }
  const serial = decodeIntegerHex(tbs.children[idx++].content);
  idx++; // skip signature AlgorithmIdentifier
  const issuerName = parseName(tbs.children[idx++]);
  const validity = tbs.children[idx++];
  const subjectName = parseName(tbs.children[idx++]);
  idx++; // skip SubjectPublicKeyInfo

  // Find extensions [3]
  let extensions: Map<string, ASN1> = new Map();
  for (let i = idx; i < tbs.children.length; i++) {
    const n = tbs.children[i];
    if (n.class === 2 && n.number === 3 && n.children?.[0]?.children) {
      // [3] EXPLICIT contains a SEQUENCE of extensions
      for (const ext of n.children[0].children) {
        if (!ext.children || ext.children.length < 2) continue;
        const oid = decodeOID(ext.children[0].content);
        // Extension = { extnID, critical BOOLEAN DEFAULT FALSE, extnValue OCTET STRING }
        const extnValue = ext.children[ext.children.length - 1];
        extensions.set(oid, extnValue);
      }
    }
  }

  // Validity = SEQUENCE { notBefore, notAfter }
  const [nbNode, naNode] = validity.children!;
  const notBefore = decodeTime(nbNode);
  const notAfter = decodeTime(naNode);

  // SAN dNSNames
  const sanDomains: string[] = [];
  const sanExt = extensions.get(OID_SUBJECT_ALT_NAME);
  if (sanExt) {
    const sanSeq = parseDER(sanExt.content);
    if (sanSeq.children) {
      for (const gn of sanSeq.children) {
        // [2] IMPLICIT IA5String — dNSName
        if (gn.class === 2 && gn.number === 2) {
          sanDomains.push(new TextDecoder('ascii').decode(gn.content));
        }
      }
    }
  }

  return {
    subject: subjectName,
    issuer: issuerName,
    serialNumber: serial,
    notBefore,
    notAfter,
    sanDomains,
    extensions,
  };
}

// Name ::= SEQUENCE OF RelativeDistinguishedName
// Return a compact "CN=Foo, O=Bar" representation
function parseName(node: ASN1): string {
  if (!node.children) return '';
  const rdns: string[] = [];
  for (const rdn of node.children) {
    if (!rdn.children) continue;
    for (const attr of rdn.children) {
      if (!attr.children || attr.children.length < 2) continue;
      const oid = decodeOID(attr.children[0].content);
      const val = decodeString(attr.children[1]);
      if (oid === OID_COMMON_NAME) rdns.push(`CN=${val}`);
      else if (oid === OID_ORG_NAME) rdns.push(`O=${val}`);
    }
  }
  return rdns.join(', ');
}

// Extract the SVG bytes from a logotype extension's data URI.
// LogotypeExtn is deeply nested ASN.1; we navigate to the logotypeURI
// (IA5String) which is a data: URL, then decode base64.
interface ExtractedLogotype {
  mediaType: string;
  bytes: Uint8Array;
  embeddedHashAlg?: string;
  embeddedHashValue?: string;
}

export function extractLogotype(extnOctetString: ASN1): ExtractedLogotype | null {
  // extnOctetString is an OCTET STRING whose content is the DER-encoded LogotypeExtn
  const logoExt = parseDER(extnOctetString.content);

  // Walk the tree looking for IA5String containing "data:image/svg+xml"
  // (simpler than fully decoding LogotypeExtn; the data URI is unique enough to find)
  let mediaType = 'image/svg+xml';
  let svgBytes: Uint8Array | null = null;
  let hashAlg: string | undefined;
  let hashValue: string | undefined;

  function walk(node: ASN1): void {
    // IA5String = tag 0x16, UTF8String = 0x0C
    if (node.tag === 0x16 || node.tag === 0x0c) {
      const s = new TextDecoder('ascii').decode(node.content);
      if (s.startsWith('data:image/svg+xml')) {
        svgBytes = decodeDataURI(s);
        const m = s.match(/^data:([^;,]+)/);
        if (m) mediaType = m[1];
      }
    }
    // Hash algorithm + value sit in a SEQUENCE with OID then OCTET STRING
    if (node.constructed && node.children) {
      // Heuristic: SEQUENCE { AlgorithmIdentifier, OCTET STRING }
      if (node.children.length === 2 &&
          node.children[0].constructed &&
          node.children[0].children?.[0]?.tag === 0x06 &&   // OID inside
          node.children[1].tag === 0x04) {                  // OCTET STRING
        const algOID = decodeOID(node.children[0].children[0].content);
        const alg = oidToHashName(algOID);
        if (alg && !hashAlg) {
          hashAlg = alg;
          hashValue = Array.from(node.children[1].content)
            .map((b) => b.toString(16).padStart(2, '0')).join('');
        }
      }
      for (const child of node.children) walk(child);
    }
  }
  walk(logoExt);

  if (!svgBytes) return null;
  return { mediaType, bytes: svgBytes, embeddedHashAlg: hashAlg, embeddedHashValue: hashValue };
}

function decodeDataURI(uri: string): Uint8Array {
  const comma = uri.indexOf(',');
  if (comma < 0) throw new Error('Malformed data URI');
  const header = uri.slice(0, comma);
  const data = uri.slice(comma + 1);
  const isBase64 = /;base64/i.test(header);
  if (isBase64) {
    const bin = atob(data);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new TextEncoder().encode(decodeURIComponent(data));
}

function oidToHashName(oid: string): string | undefined {
  const map: Record<string, string> = {
    '2.16.840.1.101.3.4.2.1': 'sha256',
    '2.16.840.1.101.3.4.2.2': 'sha384',
    '2.16.840.1.101.3.4.2.3': 'sha512',
    '1.3.14.3.2.26':          'sha1',
  };
  return map[oid];
}

// Main entry point
export async function inspectVMC(pem: string, servedUrl?: string): Promise<InspectResponse> {
  const der = pemToDER(pem);
  const cert = parseCert(der);
  const summary: string[] = [];

  const resp: InspectResponse = {
    certificate: {
      subject: cert.subject,
      issuer: cert.issuer,
      serialNumber: cert.serialNumber,
      notBefore: cert.notBefore,
      notAfter: cert.notAfter,
      sanDomains: cert.sanDomains,
    },
    logotype: { present: false },
    summary,
  };

  const logoExt = cert.extensions.get(OID_LOGOTYPE_EXT);
  if (!logoExt) {
    summary.push('Certificate does not contain a logotype extension (OID 1.3.6.1.5.5.7.1.12).');
    return resp;
  }

  const extracted = extractLogotype(logoExt);
  if (!extracted) {
    summary.push('Logotype extension present but could not extract an SVG data URI.');
    resp.logotype.present = true;
    return resp;
  }

  const svgText = new TextDecoder('utf-8').decode(extracted.bytes);
  const computedHash = await sha256Hex(extracted.bytes);

  resp.logotype = {
    present: true,
    mediaType: extracted.mediaType,
    sizeBytes: extracted.bytes.length,
    embeddedHash: extracted.embeddedHashAlg
      ? { algorithm: extracted.embeddedHashAlg, value: extracted.embeddedHashValue! }
      : undefined,
    computedHash: { algorithm: 'sha256', value: computedHash },
    hashMatch: extracted.embeddedHashAlg === 'sha256'
      ? extracted.embeddedHashValue === computedHash
      : undefined,
    svg: svgText,
    svgValidation: validate(svgText),
  };

  if (resp.logotype.svgValidation!.compliant) {
    summary.push('Embedded SVG is spec-compliant.');
  } else {
    const errs = resp.logotype.svgValidation!.issues.filter((i) => i.severity === 'error' || i.severity === 'fatal');
    summary.push(`Embedded SVG has ${errs.length} compliance issue(s). See logotype.svgValidation.`);
  }

  if (servedUrl) {
    try {
      const r = await fetch(servedUrl);
      if (!r.ok) {
        resp.servedComparison = { url: servedUrl, fetched: false };
        summary.push(`Could not fetch served SVG: HTTP ${r.status}.`);
      } else {
        const servedBytes = new Uint8Array(await r.arrayBuffer());
        const servedHash = await sha256Hex(servedBytes);
        const servedText = new TextDecoder('utf-8').decode(servedBytes);
        const servedValidation = validate(servedText);

        const matches = extracted.embeddedHashAlg === 'sha256'
          ? extracted.embeddedHashValue === servedHash
          : (new TextDecoder().decode(extracted.bytes) === servedText);

        resp.servedComparison = {
          url: servedUrl,
          fetched: true,
          servedBytes: servedBytes.length,
          servedHashMatchesEmbedded: matches,
          servedValidation,
        };

        if (!matches) {
          summary.push('Served SVG does NOT match cert-embedded SVG. Per draft-fetch-validation-vmc-wchuang §5.3.7, receivers MAY fail validation on mismatch.');
        } else {
          summary.push('Served SVG matches cert-embedded SVG byte-for-byte.');
        }
      }
    } catch (err) {
      resp.servedComparison = { url: servedUrl, fetched: false };
      summary.push(`Served SVG fetch failed: ${(err as Error).message}`);
    }
  }

  return resp;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
