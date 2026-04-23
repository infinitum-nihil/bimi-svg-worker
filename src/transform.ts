import { DOMParser } from 'linkedom';
import type { Issue, TransformResult } from './types.ts';
import {
  ROOT_REQUIREMENTS,
  CONTROLLED_ATTRS,
  FORBIDDEN_ELEMENT_RULES,
  ALLOWED_ELEMENTS,
  HREF_ALLOWED_PATTERN,
} from './rules.ts';

export function transform(svg: string, issues: Issue[]): TransformResult {
  const sizeBefore = new TextEncoder().encode(svg).byteLength;
  const applied = new Set<string>();
  const skipped: Issue[] = [];

  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml') as unknown as Document;
  const root = doc.documentElement;
  if (!root || root.tagName.toLowerCase() !== 'svg') {
    return { svg, applied: [], skipped: issues, sizeBefore, sizeAfter: sizeBefore };
  }

  // --- Root attribute fixes ---
  applyRootFixes(root, doc, issues, applied);

  // --- Tree walk: strip forbidden elements/attrs, normalize controlled values ---
  cleanTree(root, applied);

  // --- Title fixes (after cleaning so we don't insert inside bad parent) ---
  applyTitleFixes(root, doc, issues, applied);

  for (const issue of issues) {
    if (!applied.has(issue.code)) {
      if (!issue.autoFixable) skipped.push(issue);
    }
  }

  const serialized = serialize(root);
  const sizeAfter = new TextEncoder().encode(serialized).byteLength;
  return { svg: serialized, applied: Array.from(applied), skipped, sizeBefore, sizeAfter };
}

function parseViewBox(vb: string | null): [number, number, number, number] | null {
  if (!vb) return null;
  const parts = vb.trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) return null;
  return parts as [number, number, number, number];
}

function applyRootFixes(root: Element, doc: Document, issues: Issue[], applied: Set<string>): void {
  const codes = new Set(issues.map((i) => i.code));

  if (codes.has('root.version.missing') || codes.has('root.version.wrong')) {
    root.setAttribute('version', ROOT_REQUIREMENTS.version);
    applied.add('root.version.missing');
    applied.add('root.version.wrong');
  }
  if (codes.has('root.baseProfile.missing') || codes.has('root.baseProfile.wrong')) {
    root.setAttribute('baseProfile', ROOT_REQUIREMENTS.baseProfile);
    applied.add('root.baseProfile.missing');
    applied.add('root.baseProfile.wrong');
  }
  if (codes.has('root.xmlns.missing') || codes.has('root.xmlns.wrong')) {
    root.setAttribute('xmlns', ROOT_REQUIREMENTS.namespace);
    applied.add('root.xmlns.missing');
    applied.add('root.xmlns.wrong');
  }

  const vb = parseViewBox(root.getAttribute('viewBox'));
  if (vb) {
    const [, , vbW, vbH] = vb;
    if (codes.has('root.width.percentage') || codes.has('root.width.missing')) {
      root.setAttribute('width', String(Math.round(vbW)));
      applied.add('root.width.percentage');
      applied.add('root.width.missing');
    }
    if (codes.has('root.height.percentage') || codes.has('root.height.missing')) {
      root.setAttribute('height', String(Math.round(vbH)));
      applied.add('root.height.percentage');
      applied.add('root.height.missing');
    }
  }

  // Illustrator artifacts
  if (root.hasAttribute('x')) {
    root.removeAttribute('x');
    applied.add('root.x.forbidden');
  }
  if (root.hasAttribute('y')) {
    root.removeAttribute('y');
    applied.add('root.y.forbidden');
  }
}

function cleanTree(el: Element, applied: Set<string>): void {
  // Attributes
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name;
    const lower = name.toLowerCase();

    if (lower === 'style') {
      el.removeAttribute(name);
      applied.add('attr.style.forbidden');
    }
    if (lower.startsWith('on') && lower.length > 2) {
      el.removeAttribute(name);
      applied.add('attr.event-handler.forbidden');
    }

    // Controlled-value attrs: either normalize to required or strip
    const ctrl = CONTROLLED_ATTRS[name];
    if (ctrl && attr.value !== ctrl.required) {
      el.setAttribute(name, ctrl.required);
      applied.add(ctrl.rule);
    }

    // External href
    if ((lower === 'href' || lower === 'xlink:href') && !HREF_ALLOWED_PATTERN.test(attr.value)) {
      el.removeAttribute(name);
      applied.add('attr.href.external');
    }
  }

  // Children — remove forbidden or unknown
  const toRemove: Element[] = [];
  for (const child of Array.from(el.children)) {
    const tag = child.tagName.toLowerCase();
    if (FORBIDDEN_ELEMENT_RULES[tag]) {
      toRemove.push(child);
      applied.add(FORBIDDEN_ELEMENT_RULES[tag]);
    } else if (!ALLOWED_ELEMENTS.has(tag)) {
      toRemove.push(child);
      applied.add('element.unknown');
    } else {
      cleanTree(child, applied);
    }
  }
  for (const child of toRemove) {
    el.removeChild(child);
  }
}

function applyTitleFixes(root: Element, doc: Document, issues: Issue[], applied: Set<string>): void {
  const codes = new Set(issues.map((i) => i.code));
  const titles = Array.from(root.children).filter((c) => c.tagName.toLowerCase() === 'title');

  if (codes.has('title.duplicate') && titles.length > 1) {
    for (let i = 1; i < titles.length; i++) {
      root.removeChild(titles[i]);
    }
    applied.add('title.duplicate');
  }

  if (codes.has('title.missing')) {
    const title = doc.createElement('title');
    title.textContent = 'BIMI';
    root.insertBefore(title, root.firstChild);
    applied.add('title.missing');
  }

  if (codes.has('title.empty')) {
    const title = root.querySelector('title');
    if (title) {
      title.textContent = 'BIMI';
      applied.add('title.empty');
    }
  }

  if (codes.has('desc.empty')) {
    const descs = Array.from(root.children).filter((c) => c.tagName.toLowerCase() === 'desc');
    for (const d of descs) {
      if (!(d.textContent ?? '').trim()) root.removeChild(d);
    }
    applied.add('desc.empty');
  }
}

function serialize(root: Element): string {
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + root.outerHTML;
}
