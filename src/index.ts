import { classify } from './classify.ts';
import { validate } from './validate.ts';
import { transform } from './transform.ts';
import { inspectVMC } from './inspect.ts';
import type { ConvertResponse } from './types.ts';

export interface Env {
  CACHE?: KVNamespace;
  GITHUB_REPO?: string;  // e.g., "infinitum-nihil/bimi-svg-worker" — set as a Worker var
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    try {
      if (req.method === 'POST' && path === '/convert')  return await handleConvert(req, env);
      if ((req.method === 'POST' || req.method === 'GET') && path === '/validate') return await handleValidate(req);
      if (req.method === 'POST' && path === '/inspect')  return await handleInspect(req);
      if (req.method === 'GET'  && path === '/spec-status') return handleSpecStatus(env);
      if (path === '/' || path === '/health') {
        return json({
          ok: true,
          service: 'bimi-svg-worker',
          endpoints: ['/convert', '/validate', '/inspect', '/spec-status'],
          spec: {
            svgTinyPS: 'draft-svg-tiny-ps-abrotman-10',
            fetchValidation: 'draft-fetch-validation-vmc-wchuang-10',
          },
        });
      }
      return json({ error: 'not found' }, 404);
    } catch (err) {
      return json({ error: (err as Error).message, stack: (err as Error).stack }, 500);
    }
  },
};

function handleSpecStatus(env: Env): Response {
  const repo = env.GITHUB_REPO;  // e.g., "infinitum-nihil/bimi-svg-worker"
  return json({
    implemented: {
      svgTinyPS: 'draft-svg-tiny-ps-abrotman-10',
      fetchValidation: 'draft-fetch-validation-vmc-wchuang-10',
    },
    datatracker: {
      svgTinyPS: 'https://datatracker.ietf.org/doc/draft-svg-tiny-ps-abrotman/',
      fetchValidation: 'https://datatracker.ietf.org/doc/draft-fetch-validation-vmc-wchuang/',
    },
    driftCheckWorkflow: repo
      ? `https://github.com/${repo}/actions/workflows/check-spec-drift.yml`
      : null,
    source: repo ? `https://github.com/${repo}` : null,
  });
}

async function handleConvert(req: Request, env: Env): Promise<Response> {
  const svg = await readSvgBody(req);
  if (!svg) return json({ error: 'empty body' }, 400);

  const hash = await sha256Hex(svg);
  if (env.CACHE) {
    const cached = await env.CACHE.get(`out:${hash}`);
    if (cached) return new Response(cached, { headers: { 'content-type': 'application/json', 'x-cache': 'hit' } });
  }

  const classification = classify(svg);
  const warnings: string[] = [];

  if (classification === 'raster-wrapped') {
    warnings.push('Input contains a raster image wrapped in an SVG shell. Vectorization required — this endpoint does not auto-trace. Provide a true vector source.');
  }
  if (classification === 'malformed') {
    return json<ConvertResponse>({
      classification,
      inputValidation: {
        issues: [{ code: 'xml.malformed', severity: 'fatal', message: 'Input is not well-formed SVG.',
                   spec: { document: 'implementation' }, autoFixable: false }],
        fatal: true, compliant: false,
        specVersion: { svgTinyPS: 'draft-svg-tiny-ps-abrotman-10', fetchValidation: 'draft-fetch-validation-vmc-wchuang-10' },
      },
      warnings,
    }, 400);
  }

  const inputValidation = validate(svg);
  if (inputValidation.compliant) {
    const out: ConvertResponse = {
      classification: 'compliant',
      inputValidation,
      outputValidation: inputValidation,
      hash,
      warnings,
    };
    if (env.CACHE) await env.CACHE.put(`out:${hash}`, JSON.stringify(out), { expirationTtl: 86400 });
    return json(out);
  }

  if (inputValidation.fatal && inputValidation.issues.some((i) => i.severity === 'fatal' && !i.autoFixable)) {
    return json<ConvertResponse>({ classification, inputValidation, warnings }, 422);
  }

  const result = transform(svg, inputValidation.issues);
  const outputValidation = validate(result.svg);
  const outHash = await sha256Hex(result.svg);

  const response: ConvertResponse = {
    classification, inputValidation, outputValidation, transform: result, hash: outHash, warnings,
  };
  if (env.CACHE) await env.CACHE.put(`out:${hash}`, JSON.stringify(response), { expirationTtl: 86400 });
  return json(response);
}

async function handleValidate(req: Request): Promise<Response> {
  let svg: string | null = null;
  if (req.method === 'POST') svg = await readSvgBody(req);
  else {
    const src = new URL(req.url).searchParams.get('url');
    if (src) {
      const r = await fetch(src);
      if (!r.ok) return json({ error: `fetch failed: ${r.status}` }, 400);
      svg = await r.text();
    }
  }
  if (!svg) return json({ error: 'no SVG provided' }, 400);
  return json({ classification: classify(svg), validation: validate(svg) });
}

async function handleInspect(req: Request): Promise<Response> {
  const body = await req.json() as { pem?: string; served_url?: string };
  if (!body.pem) return json({ error: 'pem is required' }, 400);
  const result = await inspectVMC(body.pem, body.served_url);
  return json(result);
}

async function readSvgBody(req: Request): Promise<string | null> {
  const ct = req.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    const body = (await req.json()) as { svg?: string };
    return body.svg ?? null;
  }
  const text = await req.text();
  return text || null;
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function json<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status, headers: { 'content-type': 'application/json' },
  });
}
