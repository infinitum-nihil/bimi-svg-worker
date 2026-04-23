# bimi-svg-worker

A Cloudflare Worker that validates, auto-fixes, and inspects BIMI SVGs and
Verified Mark Certificates. Reference implementation of the active IETF
drafts governing BIMI:

- [`draft-svg-tiny-ps-abrotman-10`](https://datatracker.ietf.org/doc/html/draft-svg-tiny-ps-abrotman-10) — SVG Tiny Portable/Secure profile
- [`draft-fetch-validation-vmc-wchuang-10`](https://datatracker.ietf.org/doc/html/draft-fetch-validation-vmc-wchuang-10) — VMC fetch and validation
- [RFC 6170](https://www.rfc-editor.org/info/rfc6170) — Internet X.509 PKI Certificate Image
- [The BIMI Group RNC schema](https://bimigroup.org/resources/SVG_PS-latest.rnc.txt) — authoritative structural schema

Every validation issue the worker produces carries a citation to the exact
spec section that governs it. Implementation-specific behaviors (e.g., Apple
iCloud and Google Gmail rejecting percentage dimensions) are cited
separately so the report distinguishes between "this violates the spec" and
"this violates a documented implementer requirement."

## Endpoints

The root path (`/`) serves an HTML UI when accessed from a browser — useful
for one-off SVG validation, logotype extraction from a VMC PEM, or
comparing a cert-embedded SVG against what's served at a BIMI `l=` URL.
The same URL returns a JSON health response to non-browser clients.

### `POST /convert`
Accept an SVG, classify, validate, auto-fix, re-validate, return. Body is
either raw SVG (`content-type: image/svg+xml`) or JSON `{"svg": "..."}`.

### `POST /validate` or `GET /validate?url=...`
Validate without transforming. Useful for checking SVGs served at a BIMI
`l=` URL.

### `POST /inspect`
Takes a VMC PEM and optionally the served `l=` URL. Extracts the logotype
extension, pulls out the embedded SVG, compares its hash to what's served,
validates both, and returns a full report.

```bash
curl -X POST https://bimi-svg-worker.example.workers.dev/inspect \
  -H 'content-type: application/json' \
  -d '{
    "pem": "-----BEGIN CERTIFICATE-----\nMIID...\n-----END CERTIFICATE-----",
    "served_url": "https://example.com/brand/logo.svg"
  }'
```

Response fields include:
- `certificate` — subject, issuer, validity, SAN domains, serial number
- `logotype.svg` — the SVG bytes embedded in the cert
- `logotype.svgValidation` — full validation result of the embedded SVG
- `logotype.embeddedHash` / `logotype.computedHash` — hash comparison
- `servedComparison` — byte/hash match with what's served at the URL

Per `draft-fetch-validation-vmc-wchuang` §5.3.7, receivers MAY fail
validation if the served SVG differs from the cert-embedded SVG. If the
`servedComparison.servedHashMatchesEmbedded` is false, that's the cause.

### `GET /spec-status`
Returns the spec versions this instance validates against. Useful for
monitoring drift between this implementation and the published drafts.

```json
{
  "implemented": {
    "svgTinyPS": "draft-svg-tiny-ps-abrotman-10",
    "fetchValidation": "draft-fetch-validation-vmc-wchuang-10"
  }
}
```

### `GET /health`
Service metadata and endpoint list.

## Severity semantics

| Severity  | Meaning |
|-----------|---------|
| `fatal`   | MUST violation that prevents further processing |
| `error`   | MUST violation per spec, OR documented requirement from a major implementer |
| `warning` | SHOULD violation, or recommendation from the spec |
| `info`    | Informational — does not affect compliance |

A response is reported as `compliant: true` only when there are zero
issues of severity `warning` or higher. This is intentionally stricter
than pure spec compliance: it means the SVG is deployable without Apple
iCloud or Google Gmail rejecting it.

## Spec compliance matrix

| Rule | Source | Severity | Auto-fix |
|------|--------|----------|----------|
| `version="1.2"` required | svg-tiny-ps §2.1 | error | yes |
| `baseProfile="tiny-ps"` required | svg-tiny-ps §2.1 | error | yes |
| `xmlns` required and correct | svg-tiny-ps §2.1 | error | yes |
| `viewBox` required | bimi-group-rnc | error | no |
| `<title>` present, non-empty, unique, ≤64 chars | svg-tiny-ps §2.1 | error/warning | yes |
| `<desc>` not empty if present | svg-tiny-ps §2.1 | error | yes |
| Absolute pixel `width`/`height` | google-workspace-docs, apple-developer | error | yes |
| Minimum 96×96 pixels | google-workspace-docs | error | no |
| Square aspect ratio | google-workspace-docs | warning | no |
| No `<image>`, `<script>`, `<foreignObject>`, `<a>`, `<animate*>`, `<switch>`, multimedia | svg-tiny-ps §2.3 | fatal/error | yes |
| Controlled-value attributes: `zoomAndPan`, `externalResourcesRequired`, `focusable`, `snapshotTime`, `playbackOrder`, `timelineBegin` | svg-tiny-ps §2.3 | error | yes |
| No inline `style`, no event handlers | svg-tiny-ps §2.3 | fatal/error | yes |
| No external `href`/`xlink:href` | RFC 6170 | fatal | yes |
| At least two colors | svg-tiny-ps §2.4 | error | no |
| File size ≤32 KB | svg-tiny-ps §2.4 | warning (SHOULD) | no |
| No `x`/`y` on root | svg-tiny-ps §6.2 | error | yes |

## Architecture

```
src/
├── rules.ts       Single source of truth — every rule carries a SpecRef
├── classify.ts    Fast triage (compliant/fixable/raster-wrapped/malformed)
├── validate.ts    Structural validation; returns Issue[] with citations
├── transform.ts   Auto-fixes keyed by rule code
├── asn1.ts        Minimal DER parser for X.509 (~150 lines, no deps)
├── inspect.ts     VMC PEM inspection + served-URL comparison
├── types.ts       Shared types
└── index.ts       Worker entry: routing, caching, JSON responses
```

Total bundle size is well under Cloudflare's Worker size limits. The only
runtime dependency is `linkedom` for DOM parsing; all other functionality
is hand-rolled to keep the implementation inspectable.

## Deployment

```sh
npm install
npm test               # run integration tests against fixtures
npm run build-check    # verify Worker builds via wrangler dry-run
npm run deploy         # deploy to Cloudflare
```

Optional KV binding for caching is commented in `wrangler.toml`. Cached
entries are keyed by SHA-256 of input, 24-hour TTL.

To have `/spec-status` link back to this repo, set the `GITHUB_REPO`
variable in `wrangler.toml` (commented out by default):

```toml
[vars]
GITHUB_REPO = "your-org/bimi-svg-worker"
```

## Spec drift tracking

The specs this implementation targets are active Internet-Drafts and
evolve. The `/spec-status` endpoint exposes which versions are
implemented, and the repository includes a GitHub Actions workflow
(`.github/workflows/check-spec-drift.yml`) that runs weekly, queries the
IETF datatracker, and opens an issue when a new revision of either draft
is published. Version strings live in [`src/rules.ts`](src/rules.ts) at
the top of the file.

## Scope

This implementation covers SVG validation, transformation, and logotype
extraction from VMC PEMs. It does **not**:

- Vectorize raster images. If input contains `<image>` with a base64
  data URI, the classifier returns `raster-wrapped` and declines to
  process. Provide a true vector source.
- Validate the X.509 chain or CT proofs in a VMC. Use `openssl verify`
  or a full PKIX validator. This worker focuses on the logotype
  extension, not the certificate's cryptographic authenticity.
- Fetch and validate live BIMI records from DNS. Receivers implementing
  full BIMI should follow `draft-brand-indicators-for-message-identification`
  and `draft-fetch-validation-vmc-wchuang` end-to-end.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Issues and pull requests welcome,
particularly for new rules derived from spec updates or newly-observed
implementer requirements.

## License

MIT. See [LICENSE](LICENSE).
