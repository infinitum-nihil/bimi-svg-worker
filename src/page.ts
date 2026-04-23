// HTML page served at /. Inlined as a template literal so it ships with the
// Worker bundle. No external CSS/JS — everything self-contained, no CDN calls.
//
// The page offers three tabs mapping to the Worker's three endpoints:
//   - Convert: upload or paste SVG, get back the auto-fixed version + download
//   - Validate: URL-based check of a deployed BIMI logo
//   - Inspect: upload VMC PEM, optionally compare to served URL
//
// Everything is same-origin to this Worker so no CORS configuration needed.

export const LANDING_PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>bimi-svg-worker — BIMI VMC validation & diagnostics</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #ffffff;
    --fg: #1a1a1a;
    --muted: #6a6a6a;
    --border: #e0e0e0;
    --accent: #0066cc;
    --error: #c0392b;
    --warning: #b35900;
    --success: #27724a;
    --code-bg: #f6f6f6;
    --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #141414;
      --fg: #e8e8e8;
      --muted: #999999;
      --border: #2d2d2d;
      --accent: #6bb0ff;
      --error: #ff6b6b;
      --warning: #ffa34d;
      --success: #5ccf8d;
      --code-bg: #1e1e1e;
    }
  }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--fg); }
  body { font: 15px/1.55 system-ui, -apple-system, sans-serif; }
  .wrap { max-width: 920px; margin: 0 auto; padding: 32px 24px 80px; }
  h1 { font-size: 28px; margin: 0 0 6px; letter-spacing: -0.01em; }
  h2 { font-size: 18px; margin: 24px 0 10px; }
  .sub { color: var(--muted); margin: 0 0 24px; }
  .sub a { color: var(--accent); }
  .tabs { display: flex; gap: 0; border-bottom: 1px solid var(--border); margin: 24px 0 0; }
  .tab { background: none; border: 0; padding: 12px 18px; cursor: pointer; color: var(--muted); font: inherit; border-bottom: 2px solid transparent; margin-bottom: -1px; }
  .tab[aria-selected="true"] { color: var(--fg); border-bottom-color: var(--accent); }
  .tab:hover { color: var(--fg); }
  .panel { display: none; padding: 20px 0; }
  .panel[aria-hidden="false"] { display: block; }
  label { display: block; font-weight: 500; margin: 14px 0 6px; font-size: 13px; }
  label .hint { font-weight: normal; color: var(--muted); margin-left: 8px; font-size: 12px; }
  input[type="text"], input[type="url"], textarea {
    width: 100%; box-sizing: border-box; padding: 10px 12px;
    background: var(--bg); color: var(--fg);
    border: 1px solid var(--border); border-radius: 6px;
    font: inherit;
  }
  textarea { min-height: 140px; font-family: var(--mono); font-size: 13px; resize: vertical; }
  input[type="file"] { font: inherit; }
  button.primary {
    background: var(--accent); color: #fff; border: 0;
    padding: 10px 20px; border-radius: 6px; font: inherit; font-weight: 500;
    cursor: pointer; margin-top: 12px;
  }
  button.primary:hover { filter: brightness(1.1); }
  button.primary:disabled { opacity: 0.5; cursor: not-allowed; }
  button.link {
    background: none; border: 0; color: var(--accent); cursor: pointer;
    padding: 0; font: inherit; text-decoration: underline;
  }
  .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .result { margin-top: 24px; padding: 16px; border: 1px solid var(--border); border-radius: 8px; background: var(--code-bg); }
  .result:empty { display: none; }
  .verdict { font-size: 16px; font-weight: 500; margin-bottom: 8px; }
  .verdict.ok { color: var(--success); }
  .verdict.bad { color: var(--error); }
  .issue { padding: 10px 0; border-bottom: 1px solid var(--border); }
  .issue:last-child { border-bottom: 0; }
  .issue-head { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
  .sev { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; padding: 2px 8px; border-radius: 10px; }
  .sev.fatal, .sev.error { background: rgba(192, 57, 43, 0.15); color: var(--error); }
  .sev.warning { background: rgba(179, 89, 0, 0.15); color: var(--warning); }
  .sev.info { background: rgba(106, 106, 106, 0.15); color: var(--muted); }
  .code-ref { font-family: var(--mono); font-size: 12px; color: var(--muted); }
  .issue-msg { margin-top: 4px; }
  .spec-link { font-size: 12px; color: var(--muted); margin-top: 4px; }
  .spec-link a { color: var(--accent); }
  pre { background: var(--code-bg); padding: 12px; border-radius: 6px; overflow-x: auto; font-family: var(--mono); font-size: 12px; line-height: 1.45; }
  pre.raw-json { max-height: 400px; }
  details { margin-top: 14px; }
  summary { cursor: pointer; color: var(--muted); font-size: 13px; }
  summary:hover { color: var(--fg); }
  .download { display: inline-block; margin-top: 12px; padding: 8px 14px; background: var(--success); color: #fff; text-decoration: none; border-radius: 6px; font-weight: 500; font-size: 14px; }
  .download:hover { filter: brightness(1.1); }
  .meta { font-size: 12px; color: var(--muted); margin-top: 4px; font-family: var(--mono); }
  .error-box { color: var(--error); margin-top: 10px; font-size: 14px; }
  footer { margin-top: 60px; padding-top: 24px; border-top: 1px solid var(--border); color: var(--muted); font-size: 13px; }
  footer a { color: var(--accent); }
  .endpoints { font-family: var(--mono); font-size: 12px; margin-top: 8px; }
  code { font-family: var(--mono); background: var(--code-bg); padding: 1px 5px; border-radius: 3px; font-size: 0.92em; }
</style>
</head>
<body>
<main class="wrap">
  <h1>bimi-svg-worker</h1>
  <p class="sub">Reference implementation of BIMI VMC validation against
    <a href="https://datatracker.ietf.org/doc/draft-svg-tiny-ps-abrotman/" target="_blank" rel="noopener">draft-svg-tiny-ps-abrotman</a> and
    <a href="https://datatracker.ietf.org/doc/draft-fetch-validation-vmc-wchuang/" target="_blank" rel="noopener">draft-fetch-validation-vmc-wchuang</a>.
    Every issue cites the section of the spec that governs it.
  </p>

  <div class="tabs" role="tablist">
    <button class="tab" id="tab-convert" role="tab" aria-selected="true" aria-controls="panel-convert" data-panel="convert">Convert</button>
    <button class="tab" id="tab-validate" role="tab" aria-selected="false" aria-controls="panel-validate" data-panel="validate">Validate</button>
    <button class="tab" id="tab-inspect" role="tab" aria-selected="false" aria-controls="panel-inspect" data-panel="inspect">Inspect VMC</button>
  </div>

  <!-- CONVERT -->
  <section class="panel" id="panel-convert" role="tabpanel" aria-labelledby="tab-convert" aria-hidden="false">
    <p class="sub">Submit an SVG. Get back a validation report and, when fixable, a downloadable auto-corrected version that a CA can re-embed into a VMC.</p>

    <label>SVG file <span class="hint">or paste below</span></label>
    <input type="file" id="convert-file" accept=".svg,image/svg+xml">

    <label style="margin-top: 20px;">SVG source</label>
    <textarea id="convert-text" placeholder="<svg xmlns=&quot;http://www.w3.org/2000/svg&quot; ... ></svg>"></textarea>

    <div class="row"><button class="primary" id="convert-go">Convert</button></div>

    <div class="result" id="convert-result"></div>
  </section>

  <!-- VALIDATE -->
  <section class="panel" id="panel-validate" role="tabpanel" aria-labelledby="tab-validate" aria-hidden="true">
    <p class="sub">Validate an SVG already deployed at a BIMI <code>l=</code> URL (or anywhere public). No transformation — just a report.</p>

    <label>SVG URL</label>
    <input type="url" id="validate-url" placeholder="https://example.com/brand/bimi-logo.svg">

    <label style="margin-top: 20px;">— or paste SVG source</label>
    <textarea id="validate-text" placeholder="<svg ..."></textarea>

    <div class="row"><button class="primary" id="validate-go">Validate</button></div>

    <div class="result" id="validate-result"></div>
  </section>

  <!-- INSPECT -->
  <section class="panel" id="panel-inspect" role="tabpanel" aria-labelledby="tab-inspect" aria-hidden="true">
    <p class="sub">Upload a VMC PEM file. The inspector extracts the logotype SVG, validates it, computes its hash, and optionally compares against the SVG served at a <code>l=</code> URL (per draft-fetch-validation-vmc-wchuang §5.3.7).</p>

    <label>VMC PEM file</label>
    <input type="file" id="inspect-file" accept=".pem,.crt,.cer">

    <label style="margin-top: 20px;">— or paste PEM</label>
    <textarea id="inspect-text" placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"></textarea>

    <label style="margin-top: 20px;">Served SVG URL <span class="hint">optional — compares served bytes against cert-embedded SVG</span></label>
    <input type="url" id="inspect-served-url" placeholder="https://example.com/brand/bimi-logo.svg">

    <div class="row"><button class="primary" id="inspect-go">Inspect</button></div>

    <div class="result" id="inspect-result"></div>
  </section>

  <footer>
    <div>
      <strong>Source:</strong>
      <a href="https://github.com/infinitum-nihil/bimi-svg-worker" target="_blank" rel="noopener">github.com/infinitum-nihil/bimi-svg-worker</a>
      &middot; MIT license &middot; <span id="spec-info">loading spec status…</span>
    </div>
    <div class="endpoints">
      API endpoints: <code>POST /convert</code> &middot; <code>POST|GET /validate</code> &middot; <code>POST /inspect</code> &middot; <code>GET /spec-status</code>
    </div>
  </footer>
</main>

<script>
(() => {
  // --- Tab handling ---
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach(tab => tab.addEventListener('click', () => {
    const name = tab.dataset.panel;
    tabs.forEach(t => t.setAttribute('aria-selected', String(t === tab)));
    document.querySelectorAll('.panel').forEach(p =>
      p.setAttribute('aria-hidden', String(p.id !== 'panel-' + name))
    );
  }));

  // --- File reader helper ---
  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsText(file);
    });
  }

  // --- Rendering helpers ---
  function el(tag, props = {}, children = []) {
    const e = document.createElement(tag);
    Object.assign(e, props);
    (Array.isArray(children) ? children : [children]).forEach(c => {
      if (c == null) return;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return e;
  }

  function renderVerdict(container, compliant, message) {
    const v = el('div', { className: 'verdict ' + (compliant ? 'ok' : 'bad'), textContent: message });
    container.appendChild(v);
  }

  function renderIssues(container, issues) {
    if (!issues || issues.length === 0) return;
    const wrap = el('div');
    wrap.appendChild(el('h2', { textContent: 'Issues (' + issues.length + ')' }));
    issues.forEach(issue => {
      const row = el('div', { className: 'issue' });
      const head = el('div', { className: 'issue-head' });
      head.appendChild(el('span', { className: 'sev ' + issue.severity, textContent: issue.severity }));
      head.appendChild(el('span', { className: 'code-ref', textContent: issue.code }));
      if (issue.observedIn && issue.observedIn.length) {
        head.appendChild(el('span', { className: 'code-ref', textContent: '(observed in: ' + issue.observedIn.join(', ') + ')' }));
      }
      row.appendChild(head);
      row.appendChild(el('div', { className: 'issue-msg', textContent: issue.message }));
      if (issue.spec) {
        const ref = issue.spec.section
          ? issue.spec.document + ' §' + issue.spec.section
          : issue.spec.document;
        const specLine = el('div', { className: 'spec-link' });
        specLine.appendChild(document.createTextNode('Reference: '));
        if (issue.spec.url) {
          specLine.appendChild(el('a', { href: issue.spec.url, target: '_blank', rel: 'noopener', textContent: ref }));
        } else {
          specLine.appendChild(document.createTextNode(ref));
        }
        row.appendChild(specLine);
      }
      wrap.appendChild(row);
    });
    container.appendChild(wrap);
  }

  function renderDownload(container, svg, filename) {
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = el('a', {
      className: 'download',
      href: url,
      download: filename || 'fixed.svg',
      textContent: 'Download fixed SVG (' + svg.length + ' bytes)',
    });
    container.appendChild(a);
  }

  function renderRaw(container, obj) {
    const d = el('details');
    d.appendChild(el('summary', { textContent: 'Raw JSON response' }));
    d.appendChild(el('pre', { className: 'raw-json', textContent: JSON.stringify(obj, null, 2) }));
    container.appendChild(d);
  }

  function renderError(container, message) {
    container.innerHTML = '';
    container.appendChild(el('div', { className: 'error-box', textContent: 'Error: ' + message }));
  }

  // --- Endpoint handlers ---
  async function runConvert() {
    const out = document.getElementById('convert-result');
    out.innerHTML = '';
    const file = document.getElementById('convert-file').files[0];
    const text = document.getElementById('convert-text').value.trim();
    let svg = text;
    if (file && !text) {
      try { svg = await readFileAsText(file); } catch (e) { return renderError(out, 'Could not read file'); }
    }
    if (!svg) return renderError(out, 'Provide an SVG file or paste source.');

    try {
      const r = await fetch('/convert', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ svg }),
      });
      const data = await r.json();

      if (data.classification === 'malformed') {
        renderVerdict(out, false, 'Input is not well-formed SVG');
      } else if (data.classification === 'raster-wrapped') {
        renderVerdict(out, false, 'Raster-wrapped SVG — vectorization required (not auto-fixable)');
      } else if (data.outputValidation && data.outputValidation.compliant) {
        renderVerdict(out, true, 'Compliant after auto-fix');
      } else if (data.inputValidation && data.inputValidation.compliant) {
        renderVerdict(out, true, 'Compliant — no changes needed');
      } else {
        renderVerdict(out, false, 'Non-compliant — some issues not auto-fixable');
      }

      if (data.transform && data.transform.svg) {
        renderDownload(out, data.transform.svg, 'fixed.svg');
        out.appendChild(el('div', {
          className: 'meta',
          textContent: 'SHA-256: ' + (data.hash || '(unknown)') +
                       ' · ' + data.transform.sizeBefore + ' → ' + data.transform.sizeAfter + ' bytes',
        }));
      } else if (data.hash) {
        out.appendChild(el('div', { className: 'meta', textContent: 'SHA-256: ' + data.hash }));
      }

      const allIssues = [];
      if (data.inputValidation) allIssues.push(...(data.inputValidation.issues || []));
      renderIssues(out, allIssues);

      if (data.outputValidation && data.outputValidation.issues && data.outputValidation.issues.length) {
        out.appendChild(el('h2', { textContent: 'Remaining issues after auto-fix' }));
        renderIssues(out, data.outputValidation.issues);
      }

      renderRaw(out, data);
    } catch (err) {
      renderError(out, err.message);
    }
  }

  async function runValidate() {
    const out = document.getElementById('validate-result');
    out.innerHTML = '';
    const url = document.getElementById('validate-url').value.trim();
    const text = document.getElementById('validate-text').value.trim();

    try {
      let r;
      if (url) {
        r = await fetch('/validate?url=' + encodeURIComponent(url));
      } else if (text) {
        r = await fetch('/validate', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ svg: text }),
        });
      } else {
        return renderError(out, 'Provide a URL or paste SVG source.');
      }
      const data = await r.json();

      if (data.validation && data.validation.compliant) {
        renderVerdict(out, true, 'Compliant');
      } else {
        renderVerdict(out, false, 'Non-compliant');
      }
      if (data.validation) renderIssues(out, data.validation.issues);
      renderRaw(out, data);
    } catch (err) {
      renderError(out, err.message);
    }
  }

  async function runInspect() {
    const out = document.getElementById('inspect-result');
    out.innerHTML = '';
    const file = document.getElementById('inspect-file').files[0];
    const text = document.getElementById('inspect-text').value.trim();
    const servedUrl = document.getElementById('inspect-served-url').value.trim();

    let pem = text;
    if (file && !text) {
      try { pem = await readFileAsText(file); } catch (e) { return renderError(out, 'Could not read file'); }
    }
    if (!pem) return renderError(out, 'Provide a PEM file or paste source.');

    try {
      const body = { pem };
      if (servedUrl) body.served_url = servedUrl;
      const r = await fetch('/inspect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();

      // Summary
      if (data.summary && data.summary.length) {
        out.appendChild(el('h2', { textContent: 'Summary' }));
        data.summary.forEach(s => out.appendChild(el('div', { className: 'issue-msg', textContent: '• ' + s })));
      }

      // Certificate details
      if (data.certificate) {
        out.appendChild(el('h2', { textContent: 'Certificate' }));
        const cert = data.certificate;
        const pre = el('pre');
        pre.textContent =
          'Subject:       ' + cert.subject + '\\n' +
          'Issuer:        ' + cert.issuer + '\\n' +
          'Serial:        ' + cert.serialNumber + '\\n' +
          'Valid:         ' + cert.notBefore + ' → ' + cert.notAfter + '\\n' +
          'SAN domains:   ' + (cert.sanDomains || []).join(', ');
        out.appendChild(pre);
      }

      // Logotype
      if (data.logotype) {
        out.appendChild(el('h2', { textContent: 'Logotype' }));
        const lg = data.logotype;
        if (!lg.present) {
          out.appendChild(el('div', { className: 'issue-msg', textContent: 'No logotype extension found in certificate.' }));
        } else {
          const meta = el('pre');
          meta.textContent =
            'Media type:    ' + (lg.mediaType || '(unknown)') + '\\n' +
            'Size:          ' + (lg.sizeBytes || 0) + ' bytes\\n' +
            'Computed hash: ' + (lg.computedHash ? lg.computedHash.value : '(n/a)') + '\\n' +
            'Embedded hash: ' + (lg.embeddedHash ? lg.embeddedHash.value : '(n/a)') + '\\n' +
            'Match:         ' + (lg.hashMatch == null ? '(n/a)' : (lg.hashMatch ? 'yes' : 'NO'));
          out.appendChild(meta);

          if (lg.svg) {
            renderDownload(out, lg.svg, 'embedded-logo.svg');
          }

          if (lg.svgValidation) {
            out.appendChild(el('h2', { textContent: 'Embedded SVG validation' }));
            if (lg.svgValidation.compliant) {
              renderVerdict(out, true, 'Embedded SVG is compliant');
            } else {
              renderVerdict(out, false, 'Embedded SVG has compliance issues');
            }
            renderIssues(out, lg.svgValidation.issues);
          }
        }
      }

      // Served comparison
      if (data.servedComparison) {
        out.appendChild(el('h2', { textContent: 'Served URL comparison' }));
        const sc = data.servedComparison;
        if (!sc.fetched) {
          out.appendChild(el('div', { className: 'issue-msg', textContent: 'Could not fetch ' + sc.url }));
        } else {
          renderVerdict(out, sc.servedHashMatchesEmbedded, sc.servedHashMatchesEmbedded
            ? 'Served SVG matches cert-embedded SVG byte-for-byte'
            : 'Served SVG does NOT match cert-embedded SVG (fetch-validation §5.3.7)');
          if (sc.servedValidation) renderIssues(out, sc.servedValidation.issues);
        }
      }

      renderRaw(out, data);
    } catch (err) {
      renderError(out, err.message);
    }
  }

  document.getElementById('convert-go').addEventListener('click', runConvert);
  document.getElementById('validate-go').addEventListener('click', runValidate);
  document.getElementById('inspect-go').addEventListener('click', runInspect);

  // Populate spec info in footer
  fetch('/spec-status').then(r => r.json()).then(data => {
    const s = data.implemented;
    document.getElementById('spec-info').textContent =
      'Implementing ' + s.svgTinyPS + ' + ' + s.fetchValidation;
  }).catch(() => {
    document.getElementById('spec-info').textContent = '';
  });
})();
</script>
</body>
</html>`;
