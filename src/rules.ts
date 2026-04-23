import type { SpecRef, Severity, Validator } from './types.ts';

// Spec versions we validate against
export const SPEC_VERSIONS = {
  svgTinyPS: 'draft-svg-tiny-ps-abrotman-10',
  fetchValidation: 'draft-fetch-validation-vmc-wchuang-10',
} as const;

// Spec URLs
const S = (section: string): SpecRef => ({
  document: 'svg-tiny-ps',
  section,
  url: `https://datatracker.ietf.org/doc/html/${SPEC_VERSIONS.svgTinyPS}#section-${section}`,
});

const F = (section: string): SpecRef => ({
  document: 'fetch-validation-vmc',
  section,
  url: `https://datatracker.ietf.org/doc/html/${SPEC_VERSIONS.fetchValidation}#section-${section}`,
});

const IMPL = (note: string): SpecRef => ({
  document: 'implementation',
  note,
});

const GOOG = (note?: string): SpecRef => ({
  document: 'google-workspace-docs',
  url: 'https://knowledge.workspace.google.com/admin/security/set-up-bimi',
  note,
});

const APPL = (note?: string): SpecRef => ({
  document: 'apple-developer',
  url: 'https://developer.apple.com/support/bimi/',
  note,
});

// -----------------------------------------------------------------------------
// Rule definitions
// -----------------------------------------------------------------------------
// Each rule has: a stable code, a severity, a spec reference, and optionally
// the validators known to enforce it. The validate() and transform() modules
// look up rules by code.

export interface RuleDef {
  code: string;
  severity: Severity;
  spec: SpecRef;
  observedIn?: Validator[];
  autoFixable: boolean;
  // Human-readable message template. {x} placeholders filled at validation time.
  messageTemplate: string;
  fixDescription?: string;
}

export const RULES: Record<string, RuleDef> = {
  // --- Root element: required attributes (MUST — Section 2.1) ---
  'root.version.missing': {
    code: 'root.version.missing',
    severity: 'error',
    spec: S('2.1'),
    autoFixable: true,
    messageTemplate: 'Root <svg> MUST set version="1.2".',
    fixDescription: 'Set version="1.2" on root <svg>.',
  },
  'root.version.wrong': {
    code: 'root.version.wrong',
    severity: 'error',
    spec: S('2.1'),
    autoFixable: true,
    messageTemplate: 'version must be "1.2" (got "{value}").',
    fixDescription: 'Set version="1.2".',
  },
  'root.baseProfile.missing': {
    code: 'root.baseProfile.missing',
    severity: 'error',
    spec: S('2.1'),
    autoFixable: true,
    messageTemplate: 'Root <svg> MUST set baseProfile="tiny-ps".',
    fixDescription: 'Set baseProfile="tiny-ps".',
  },
  'root.baseProfile.wrong': {
    code: 'root.baseProfile.wrong',
    severity: 'error',
    spec: S('2.1'),
    autoFixable: true,
    messageTemplate: 'baseProfile must be "tiny-ps" (got "{value}").',
    fixDescription: 'Set baseProfile="tiny-ps".',
  },
  'root.xmlns.missing': {
    code: 'root.xmlns.missing',
    severity: 'error',
    spec: S('2.1'),
    autoFixable: true,
    messageTemplate: 'Root <svg> MUST set xmlns="http://www.w3.org/2000/svg".',
    fixDescription: 'Set xmlns="http://www.w3.org/2000/svg".',
  },
  'root.xmlns.wrong': {
    code: 'root.xmlns.wrong',
    severity: 'error',
    spec: S('2.1'),
    autoFixable: true,
    messageTemplate: 'xmlns must be "http://www.w3.org/2000/svg" (got "{value}").',
    fixDescription: 'Set xmlns="http://www.w3.org/2000/svg".',
  },

  // --- viewBox required (implicit from the RNC schema; required by BIMI Group) ---
  'root.viewBox.missing': {
    code: 'root.viewBox.missing',
    severity: 'error',
    spec: { document: 'bimi-group-rnc', url: 'https://bimigroup.org/resources/SVG_PS-latest.rnc.txt' },
    autoFixable: false,
    messageTemplate: 'viewBox attribute is required by the BIMI Group SVG PS schema.',
  },
  'root.viewBox.malformed': {
    code: 'root.viewBox.malformed',
    severity: 'error',
    spec: { document: 'bimi-group-rnc' },
    autoFixable: false,
    messageTemplate: 'viewBox must be four numeric values (got "{value}").',
  },

  // --- width/height: Apple AND Google explicitly document rejection of
  // percentage dimensions. Google Workspace BIMI admin docs state: "The image
  // size must be specified in absolute pixels... Don't use relative
  // dimensions." Apple's iCloud returns bimi=fail reason="invalid evidence"
  // on such SVGs. The spec (draft-svg-tiny-ps-abrotman) does not explicitly
  // prohibit percentages, but the two largest implementers publicly require
  // absolute pixels. We treat this as an error, not just a warning.
  'root.width.percentage': {
    code: 'root.width.percentage',
    severity: 'error',
    spec: GOOG('Google Workspace BIMI admin docs explicitly state: "Don\'t use relative dimensions to specify image size. Example: width=\\"100%\\" height=\\"100%\\"". Apple/iCloud rejects such SVGs with bimi=fail reason="invalid evidence".'),
    observedIn: ['apple', 'gmail'],
    autoFixable: true,
    messageTemplate: 'width uses percentage ("{value}"); Google Gmail and Apple iCloud both publicly document rejection of relative dimensions.',
    fixDescription: 'Replace percentage with viewBox width.',
  },
  'root.height.percentage': {
    code: 'root.height.percentage',
    severity: 'error',
    spec: GOOG('Google Workspace BIMI admin docs explicitly state: "Don\'t use relative dimensions to specify image size."'),
    observedIn: ['apple', 'gmail'],
    autoFixable: true,
    messageTemplate: 'height uses percentage ("{value}"); Google Gmail and Apple iCloud both publicly document rejection of relative dimensions.',
    fixDescription: 'Replace percentage with viewBox height.',
  },
  'root.width.missing': {
    code: 'root.width.missing',
    severity: 'error',
    spec: GOOG('Google Workspace BIMI admin docs require absolute pixel dimensions on root <svg>.'),
    observedIn: ['apple', 'gmail'],
    autoFixable: true,
    messageTemplate: 'width attribute is missing; Google and Apple require explicit pixel dimensions.',
    fixDescription: 'Derive width from viewBox.',
  },
  'root.height.missing': {
    code: 'root.height.missing',
    severity: 'error',
    spec: GOOG('Google Workspace BIMI admin docs require absolute pixel dimensions on root <svg>.'),
    observedIn: ['apple', 'gmail'],
    autoFixable: true,
    messageTemplate: 'height attribute is missing; Google and Apple require explicit pixel dimensions.',
    fixDescription: 'Derive height from viewBox.',
  },

  // --- Illustrator adds x/y to root — spec says these are NOT permitted ---
  'root.x.forbidden': {
    code: 'root.x.forbidden',
    severity: 'error',
    spec: S('6.2'),  // Section 6.2 "Known issues with various SVG editing software"
    autoFixable: true,
    messageTemplate: 'x attribute on root <svg> is not permitted (common Illustrator artifact).',
    fixDescription: 'Remove x attribute from root <svg>.',
  },
  'root.y.forbidden': {
    code: 'root.y.forbidden',
    severity: 'error',
    spec: S('6.2'),
    autoFixable: true,
    messageTemplate: 'y attribute on root <svg> is not permitted (common Illustrator artifact).',
    fixDescription: 'Remove y attribute from root <svg>.',
  },

  // --- BIMI minimum dimension ---
  // Google Workspace docs explicitly require min 96x96 for Gmail. BIMI Group
  // recommends 98x98 which would satisfy both.
  'root.dimension.below-min': {
    code: 'root.dimension.below-min',
    severity: 'error',
    spec: GOOG('Google Workspace BIMI admin docs: "The image size must be a minimum height and width of 96 pixels."'),
    observedIn: ['gmail'],
    autoFixable: false,
    messageTemplate: '{axis}={value} is below Google Gmail\'s minimum of 96px.',
  },
  'root.aspect-ratio.non-square': {
    code: 'root.aspect-ratio.non-square',
    severity: 'warning',
    spec: GOOG('Google Workspace BIMI admin docs recommend the logo be centered in a square.'),
    autoFixable: false,
    messageTemplate: 'Aspect ratio {w}x{h} is not square; BIMI (and Google) recommend square.',
  },

  // --- title: MUST be present, non-empty, occur only once, SHOULD be ≤ 64 chars ---
  'title.missing': {
    code: 'title.missing',
    severity: 'error',
    spec: S('2.1'),
    autoFixable: true,
    messageTemplate: '<title> element MUST be present as a direct child of <svg>.',
    fixDescription: 'Insert <title>BIMI</title>.',
  },
  'title.empty': {
    code: 'title.empty',
    severity: 'error',
    spec: S('2.1'),
    autoFixable: true,
    messageTemplate: '<title> contents MUST NOT be empty.',
    fixDescription: 'Populate <title> with "BIMI".',
  },
  'title.duplicate': {
    code: 'title.duplicate',
    severity: 'error',
    spec: S('2.1'),
    autoFixable: true,
    messageTemplate: '<title> MUST occur only once as a child of <svg>.',
    fixDescription: 'Remove duplicate <title> elements.',
  },
  'title.too-long': {
    code: 'title.too-long',
    severity: 'warning',
    spec: S('2.1'),
    autoFixable: false,
    messageTemplate: '<title> contents SHOULD be no more than 64 characters (got {length}).',
  },

  // --- desc: if present, MUST NOT be empty ---
  'desc.empty': {
    code: 'desc.empty',
    severity: 'error',
    spec: S('2.1'),
    autoFixable: true,
    messageTemplate: '<desc> is present but empty; MUST have content or be removed.',
    fixDescription: 'Remove empty <desc>.',
  },

  // --- Forbidden elements (Section 2.3 — MUST NOT be present) ---
  'element.image.forbidden': {
    code: 'element.image.forbidden',
    severity: 'fatal',
    spec: S('2.3'),
    autoFixable: true,
    messageTemplate: '<image> element is forbidden (Section 5.7: no raster images).',
    fixDescription: 'Remove <image> element.',
  },
  'element.switch.forbidden': {
    code: 'element.switch.forbidden',
    severity: 'error',
    spec: S('2.3'),
    autoFixable: true,
    messageTemplate: '<switch> element is forbidden (Section 5.8.2: no conditional processing).',
    fixDescription: 'Remove <switch> element.',
  },
  'element.multimedia.forbidden': {
    code: 'element.multimedia.forbidden',
    severity: 'error',
    spec: S('2.3'),
    autoFixable: true,
    messageTemplate: '<{tag}> is forbidden (Section 12: multimedia).',
    fixDescription: 'Remove multimedia element.',
  },
  'element.linking.forbidden': {
    code: 'element.linking.forbidden',
    severity: 'error',
    spec: S('2.3'),
    autoFixable: true,
    messageTemplate: '<a> element is forbidden (Section 14: no linking).',
    fixDescription: 'Remove <a> element.',
  },
  'element.script.forbidden': {
    code: 'element.script.forbidden',
    severity: 'fatal',
    spec: S('2.3'),
    autoFixable: true,
    messageTemplate: '<script> is forbidden (Section 15: no scripting).',
    fixDescription: 'Remove <script> element.',
  },
  'element.animation.forbidden': {
    code: 'element.animation.forbidden',
    severity: 'error',
    spec: S('2.3'),
    autoFixable: true,
    messageTemplate: '<{tag}> is forbidden (Section 16: no animation).',
    fixDescription: 'Remove animation element.',
  },
  'element.foreignObject.forbidden': {
    code: 'element.foreignObject.forbidden',
    severity: 'fatal',
    spec: { document: 'rfc6170', url: 'https://www.rfc-editor.org/info/rfc6170' },
    autoFixable: true,
    messageTemplate: '<foreignObject> is forbidden by RFC 6170 secure profile.',
    fixDescription: 'Remove <foreignObject>.',
  },
  'element.unknown': {
    code: 'element.unknown',
    severity: 'warning',
    spec: S('2'),
    autoFixable: true,
    messageTemplate: '<{tag}> is not in the SVG Tiny PS allowed element set.',
    fixDescription: 'Remove unknown element.',
  },

  // --- Attribute controls (Section 2.3 — MUST be specific values if present) ---
  'attr.zoomAndPan.wrong': {
    code: 'attr.zoomAndPan.wrong',
    severity: 'error',
    spec: S('2.3'),
    autoFixable: true,
    messageTemplate: 'zoomAndPan="{value}" is not permitted; MUST be "disable" if present.',
    fixDescription: 'Set zoomAndPan="disable".',
  },
  'attr.externalResourcesRequired.wrong': {
    code: 'attr.externalResourcesRequired.wrong',
    severity: 'error',
    spec: S('2.3'),
    autoFixable: true,
    messageTemplate: 'externalResourcesRequired="{value}" is not permitted; MUST be "false" if present.',
    fixDescription: 'Set externalResourcesRequired="false".',
  },
  'attr.focusable.wrong': {
    code: 'attr.focusable.wrong',
    severity: 'error',
    spec: S('2.3'),
    autoFixable: true,
    messageTemplate: 'focusable="{value}" is not permitted; MUST be "false" if present.',
    fixDescription: 'Set focusable="false".',
  },
  'attr.snapshotTime.wrong': {
    code: 'attr.snapshotTime.wrong',
    severity: 'error',
    spec: S('2.3'),
    autoFixable: true,
    messageTemplate: 'snapshotTime="{value}" is not permitted; MUST be "none" if present.',
    fixDescription: 'Set snapshotTime="none".',
  },
  'attr.playbackOrder.wrong': {
    code: 'attr.playbackOrder.wrong',
    severity: 'error',
    spec: S('2.3'),
    autoFixable: true,
    messageTemplate: 'playbackOrder="{value}" is not permitted; MUST be "all" if present.',
    fixDescription: 'Set playbackOrder="all".',
  },
  'attr.timelineBegin.wrong': {
    code: 'attr.timelineBegin.wrong',
    severity: 'error',
    spec: S('2.3'),
    autoFixable: true,
    messageTemplate: 'timelineBegin="{value}" is not permitted; MUST be "onLoad" if present.',
    fixDescription: 'Set timelineBegin="onLoad".',
  },

  // --- Attributes that must always be stripped ---
  'attr.style.forbidden': {
    code: 'attr.style.forbidden',
    severity: 'error',
    spec: S('2.3'),
    autoFixable: true,
    messageTemplate: 'Inline style attribute is not permitted in SVG Tiny PS (no embedded CSS).',
    fixDescription: 'Strip style attribute.',
  },
  'attr.event-handler.forbidden': {
    code: 'attr.event-handler.forbidden',
    severity: 'fatal',
    spec: S('2.3'),
    autoFixable: true,
    messageTemplate: 'Event handler "{name}" is forbidden (Section 13: interactivity, Section 15: scripting).',
    fixDescription: 'Strip event handler attribute.',
  },
  'attr.href.external': {
    code: 'attr.href.external',
    severity: 'fatal',
    spec: { document: 'rfc6170', url: 'https://www.rfc-editor.org/info/rfc6170' },
    autoFixable: true,
    messageTemplate: '{name}="{value}" is an external reference; RFC 6170 secure profile requires no external resources.',
    fixDescription: 'Strip external reference.',
  },

  // --- File size (SHOULD, not MUST — Section 2.4) ---
  'file.size.over-limit': {
    code: 'file.size.over-limit',
    severity: 'warning',
    spec: S('2.4'),
    autoFixable: false,
    messageTemplate: 'File size {size} bytes exceeds recommended 32KB (Section 2.4 is SHOULD, not MUST).',
  },

  // --- Color (MUST — Section 2.4) ---
  'colors.insufficient': {
    code: 'colors.insufficient',
    severity: 'error',
    spec: S('2.4'),
    autoFixable: false,
    messageTemplate: 'SVG Tiny PS document MUST include at least two colors when rendered (found {count}).',
  },

  // --- Animation attributes on path/shapes (Section 2.2 — MUST NOT be animated) ---
  // These are caught by element.animation.forbidden covering animate/animateTransform/etc.
};

// Controlled-value attributes and their required values
export const CONTROLLED_ATTRS: Record<string, { required: string; rule: string }> = {
  zoomAndPan: { required: 'disable', rule: 'attr.zoomAndPan.wrong' },
  externalResourcesRequired: { required: 'false', rule: 'attr.externalResourcesRequired.wrong' },
  focusable: { required: 'false', rule: 'attr.focusable.wrong' },
  snapshotTime: { required: 'none', rule: 'attr.snapshotTime.wrong' },
  playbackOrder: { required: 'all', rule: 'attr.playbackOrder.wrong' },
  timelineBegin: { required: 'onLoad', rule: 'attr.timelineBegin.wrong' },
};

// Elements categorised by which section forbids them
export const FORBIDDEN_ELEMENT_RULES: Record<string, string> = {
  image: 'element.image.forbidden',
  switch: 'element.switch.forbidden',
  audio: 'element.multimedia.forbidden',
  video: 'element.multimedia.forbidden',
  a: 'element.linking.forbidden',
  script: 'element.script.forbidden',
  animate: 'element.animation.forbidden',
  animateColor: 'element.animation.forbidden',
  animateMotion: 'element.animation.forbidden',
  animateTransform: 'element.animation.forbidden',
  set: 'element.animation.forbidden',
  foreignObject: 'element.foreignObject.forbidden',
  style: 'element.unknown',
  iframe: 'element.unknown',
  filter: 'element.unknown',
  mask: 'element.unknown',
  clipPath: 'element.unknown',
  pattern: 'element.unknown',
};

// Allowed elements per the RNC schema (section 7) — anything not here gets
// flagged by element.unknown
export const ALLOWED_ELEMENTS = new Set([
  'svg', 'title', 'desc', 'metadata',
  'g', 'defs', 'use',
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'textArea',
  'linearGradient', 'radialGradient', 'stop', 'solidColor',
  'font', 'font-face', 'glyph', 'hkern',
]);

export const ROOT_REQUIREMENTS = {
  version: '1.2',
  baseProfile: 'tiny-ps',
  namespace: 'http://www.w3.org/2000/svg',
} as const;

export const HREF_ALLOWED_PATTERN = /^#[A-Za-z_][-A-Za-z0-9_.:]*$/;

export const TITLE_MAX_LENGTH = 64;  // SHOULD per Section 2.1
export const FILE_SIZE_LIMIT = 32768; // SHOULD per Section 2.4
export const BIMI_MIN_DIMENSION = 96; // Google Gmail's documented minimum (BIMI Group recommends 98)
