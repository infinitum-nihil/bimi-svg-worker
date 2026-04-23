// Which spec document an issue traces back to. "implementation" is for
// real-world validator behavior that isn't strictly specified (e.g., Apple
// rejects percentage dimensions even though the spec doesn't prohibit them).
export type SpecDocument =
  | 'svg-tiny-ps'           // draft-svg-tiny-ps-abrotman
  | 'fetch-validation-vmc'  // draft-fetch-validation-vmc-wchuang
  | 'rfc6170'               // RFC 6170 secure profile
  | 'rfc3709'               // Logotype in certificates
  | 'bimi-group-rnc'        // the authoritative RNC schema
  | 'google-workspace-docs' // Google Workspace BIMI admin documentation
  | 'apple-developer'       // Apple Mail BIMI developer references
  | 'implementation';       // observed validator behavior, not documented

export interface SpecRef {
  document: SpecDocument;
  section?: string;          // e.g. "2.1", "5.3.7"
  url?: string;              // link to the spec section
  note?: string;             // clarification if the citation needs context
}

export type Severity =
  | 'fatal'     // MUST violation that prevents processing
  | 'error'     // MUST violation
  | 'warning'   // SHOULD violation OR known implementation strictness
  | 'info';     // informational, not a compliance issue

// Which validator(s) flagged this in practice. Null = derived from spec itself.
export type Validator = 'apple' | 'gmail' | 'yahoo' | 'fastmail';

export interface Issue {
  code: string;                   // stable dotted identifier
  severity: Severity;
  message: string;
  spec: SpecRef;
  observedIn?: Validator[];       // validators known to fail on this
  path?: string;
  autoFixable: boolean;
  fixDescription?: string;
}

export type Classification =
  | 'compliant'
  | 'fixable'
  | 'raster-wrapped'
  | 'malformed'
  | 'unsupported';

export interface ValidationResult {
  issues: Issue[];
  fatal: boolean;
  compliant: boolean;
  specVersion: {
    svgTinyPS: string;
    fetchValidation: string;
  };
}

export interface TransformResult {
  svg: string;
  applied: string[];
  skipped: Issue[];
  sizeBefore: number;
  sizeAfter: number;
}

export interface ConvertResponse {
  classification: Classification;
  inputValidation: ValidationResult;
  outputValidation?: ValidationResult;
  transform?: TransformResult;
  hash?: string;
  warnings: string[];
}

// Response from /inspect — the flagship endpoint for CA/reseller triage
export interface InspectResponse {
  certificate: {
    subject: string;
    issuer: string;
    serialNumber: string;
    notBefore: string;
    notAfter: string;
    sanDomains: string[];
  };
  logotype: {
    present: boolean;
    mediaType?: string;
    sizeBytes?: number;
    embeddedHash?: { algorithm: string; value: string };  // hash embedded in cert
    computedHash?: { algorithm: string; value: string };  // hash of extracted SVG bytes
    hashMatch?: boolean;
    svg?: string;
    svgValidation?: ValidationResult;
  };
  servedComparison?: {
    url: string;
    fetched: boolean;
    servedBytes?: number;
    servedHashMatchesEmbedded?: boolean;
    servedValidation?: ValidationResult;
  };
  summary: string[];
}
