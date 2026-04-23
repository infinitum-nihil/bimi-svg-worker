import { DOMParser } from 'linkedom';
import type { Issue, ValidationResult, RuleDef } from './types.ts';
import {
  RULES,
  CONTROLLED_ATTRS,
  FORBIDDEN_ELEMENT_RULES,
  ALLOWED_ELEMENTS,
  ROOT_REQUIREMENTS,
  HREF_ALLOWED_PATTERN,
  TITLE_MAX_LENGTH,
  FILE_SIZE_LIMIT,
  BIMI_MIN_DIMENSION,
  SPEC_VERSIONS,
} from './rules.ts';

function issueFromRule(
  rule: RuleDef,
  substitutions: Record<string, string | number> = {},
  path?: string,
): Issue {
  let message = rule.messageTemplate;
  for (const [k, v] of Object.entries(substitutions)) {
    message = message.replaceAll(`{${k}}`, String(v));
  }
  return {
    code: rule.code,
    severity: rule.severity,
    message,
    spec: rule.spec,
    observedIn: rule.observedIn,
    path,
    autoFixable: rule.autoFixable,
    fixDescription: rule.fixDescription,
  };
}

export function validate(svg: string): ValidationResult {
  const issues: Issue[] = [];

  // File size is a SHOULD (Section 2.4), so warning rather than error
  const byteSize = new TextEncoder().encode(svg).byteLength;
  if (byteSize > FILE_SIZE_LIMIT) {
    issues.push(issueFromRule(RULES['file.size.over-limit'], { size: byteSize }));
  }

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(svg, 'image/svg+xml') as unknown as Document;
  } catch (err) {
    issues.push({
      code: 'xml.parse-error',
      severity: 'fatal',
      message: `XML parse failed: ${(err as Error).message}`,
      spec: { document: 'implementation', note: 'Not parseable as XML.' },
      autoFixable: false,
    });
    return { issues, fatal: true, compliant: false, specVersion: SPEC_VERSIONS };
  }

  const root = doc.documentElement;
  if (!root || root.tagName.toLowerCase() !== 'svg') {
    issues.push({
      code: 'root.not-svg',
      severity: 'fatal',
      message: 'Root element is not <svg>.',
      spec: { document: 'svg-tiny-ps', section: '2.1' },
      autoFixable: false,
    });
    return { issues, fatal: true, compliant: false, specVersion: SPEC_VERSIONS };
  }

  validateRootAttributes(root, issues);
  validateTitle(root, issues);
  validateDesc(root, issues);
  walk(root, issues);
  validateColors(root, issues);

  const fatal = issues.some((i) => i.severity === 'fatal');
  // "Compliant" means: ready for real-world deployment. No fatals, errors, or
  // warnings. (Info-level issues don't affect compliance.) This is stricter
  // than spec-compliance alone because it includes Apple/Gmail implementation
  // strictness as a deployment requirement.
  const compliant = !issues.some((i) => i.severity === 'fatal' || i.severity === 'error' || i.severity === 'warning');
  return { issues, fatal, compliant, specVersion: SPEC_VERSIONS };
}

function validateRootAttributes(root: Element, issues: Issue[]): void {
  // Required: version, baseProfile, xmlns
  const version = root.getAttribute('version');
  if (!version) {
    issues.push(issueFromRule(RULES['root.version.missing']));
  } else if (version !== ROOT_REQUIREMENTS.version) {
    issues.push(issueFromRule(RULES['root.version.wrong'], { value: version }));
  }

  const baseProfile = root.getAttribute('baseProfile');
  if (!baseProfile) {
    issues.push(issueFromRule(RULES['root.baseProfile.missing']));
  } else if (baseProfile !== ROOT_REQUIREMENTS.baseProfile) {
    issues.push(issueFromRule(RULES['root.baseProfile.wrong'], { value: baseProfile }));
  }

  const xmlns = root.getAttribute('xmlns');
  if (!xmlns) {
    issues.push(issueFromRule(RULES['root.xmlns.missing']));
  } else if (xmlns !== ROOT_REQUIREMENTS.namespace) {
    issues.push(issueFromRule(RULES['root.xmlns.wrong'], { value: xmlns }));
  }

  // viewBox (required by the RNC schema)
  const viewBox = root.getAttribute('viewBox');
  if (!viewBox) {
    issues.push(issueFromRule(RULES['root.viewBox.missing']));
  } else {
    const parts = viewBox.trim().split(/[\s,]+/).map(Number);
    if (parts.length !== 4 || parts.some(isNaN)) {
      issues.push(issueFromRule(RULES['root.viewBox.malformed'], { value: viewBox }));
    }
  }

  // width/height — Apple/strict-implementation check, not strictly spec
  const width = root.getAttribute('width');
  const height = root.getAttribute('height');

  if (!width) {
    if (viewBox) issues.push(issueFromRule(RULES['root.width.missing']));
  } else if (/%\s*$/.test(width)) {
    issues.push(issueFromRule(RULES['root.width.percentage'], { value: width }));
  }

  if (!height) {
    if (viewBox) issues.push(issueFromRule(RULES['root.height.missing']));
  } else if (/%\s*$/.test(height)) {
    issues.push(issueFromRule(RULES['root.height.percentage'], { value: height }));
  }

  // Illustrator artifact: x/y on root
  if (root.hasAttribute('x')) {
    issues.push(issueFromRule(RULES['root.x.forbidden']));
  }
  if (root.hasAttribute('y')) {
    issues.push(issueFromRule(RULES['root.y.forbidden']));
  }

  // Minimum dimension check
  const parseNum = (v: string | null): number | null => {
    if (!v) return null;
    const n = parseFloat(v);
    return isNaN(n) ? null : n;
  };
  const wNum = parseNum(width);
  const hNum = parseNum(height);
  if (wNum !== null && wNum < BIMI_MIN_DIMENSION) {
    issues.push(issueFromRule(RULES['root.dimension.below-min'], { axis: 'width', value: wNum }));
  }
  if (hNum !== null && hNum < BIMI_MIN_DIMENSION) {
    issues.push(issueFromRule(RULES['root.dimension.below-min'], { axis: 'height', value: hNum }));
  }
  if (wNum !== null && hNum !== null && Math.abs(wNum - hNum) / Math.max(wNum, hNum) > 0.05) {
    issues.push(issueFromRule(RULES['root.aspect-ratio.non-square'], { w: wNum, h: hNum }));
  }
}

function validateTitle(root: Element, issues: Issue[]): void {
  const titles = Array.from(root.children).filter((c) => c.tagName.toLowerCase() === 'title');
  if (titles.length === 0) {
    issues.push(issueFromRule(RULES['title.missing']));
    return;
  }
  if (titles.length > 1) {
    issues.push(issueFromRule(RULES['title.duplicate']));
  }
  const title = titles[0];
  const text = (title.textContent ?? '').trim();
  if (!text) {
    issues.push(issueFromRule(RULES['title.empty']));
  } else if (text.length > TITLE_MAX_LENGTH) {
    issues.push(issueFromRule(RULES['title.too-long'], { length: text.length }));
  }
}

function validateDesc(root: Element, issues: Issue[]): void {
  const descs = Array.from(root.children).filter((c) => c.tagName.toLowerCase() === 'desc');
  for (const desc of descs) {
    if (!(desc.textContent ?? '').trim()) {
      issues.push(issueFromRule(RULES['desc.empty']));
    }
  }
}

function walk(el: Element, issues: Issue[], path = 'svg'): void {
  // Attributes on this element
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name;
    const lower = name.toLowerCase();
    const value = attr.value;

    // Inline style is forbidden
    if (lower === 'style') {
      issues.push(issueFromRule(RULES['attr.style.forbidden'], {}, path));
    }

    // Event handlers
    if (lower.startsWith('on') && lower.length > 2) {
      issues.push(issueFromRule(RULES['attr.event-handler.forbidden'], { name }, path));
    }

    // Controlled-value attributes (Section 2.3)
    const ctrl = CONTROLLED_ATTRS[name];
    if (ctrl && value !== ctrl.required) {
      issues.push(issueFromRule(RULES[ctrl.rule], { value }, path));
    }

    // External href / xlink:href
    if ((lower === 'href' || lower === 'xlink:href') && !HREF_ALLOWED_PATTERN.test(value)) {
      issues.push(issueFromRule(RULES['attr.href.external'], { name, value }, path));
    }
  }

  // Children
  let idx = 0;
  for (const child of Array.from(el.children)) {
    const tag = child.tagName.toLowerCase();
    const childPath = `${path} > ${tag}[${idx}]`;

    const forbiddenRule = FORBIDDEN_ELEMENT_RULES[tag];
    if (forbiddenRule) {
      issues.push(issueFromRule(RULES[forbiddenRule], { tag }, childPath));
    } else if (!ALLOWED_ELEMENTS.has(tag)) {
      issues.push(issueFromRule(RULES['element.unknown'], { tag }, childPath));
    }

    walk(child, issues, childPath);
    idx++;
  }
}

function validateColors(root: Element, issues: Issue[]): void {
  // MUST include at least two colors when rendered (Section 2.4)
  const colors = new Set<string>();

  const collect = (el: Element) => {
    for (const attr of ['fill', 'stroke', 'color', 'stop-color', 'solid-color']) {
      const v = el.getAttribute(attr);
      if (v && v !== 'none' && v !== 'inherit' && v !== 'transparent') {
        colors.add(v.toLowerCase());
      }
    }
    for (const child of Array.from(el.children)) collect(child);
  };
  collect(root);

  if (colors.size < 2) {
    issues.push(issueFromRule(RULES['colors.insufficient'], { count: colors.size }));
  }
}
