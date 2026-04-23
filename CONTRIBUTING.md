# Contributing

Issues and pull requests are welcome. This project tracks the active
IETF drafts that define BIMI VMC validation:

- `draft-svg-tiny-ps-abrotman`
- `draft-fetch-validation-vmc-wchuang`

The current target versions are pinned at the top of
[`src/rules.ts`](src/rules.ts). A weekly GitHub Actions job checks for
new revisions against the IETF datatracker and opens an issue when
either draft is updated.

## Scope

Appropriate contributions:

- Rules derived from new revisions of the target drafts
- Rules derived from newly-documented implementer requirements
  (published CA, mailbox provider, or BIMI Group documentation)
- Bug fixes in the validator, transformer, or ASN.1 parser
- Test cases for edge cases and real-world problem SVGs
- Performance improvements that preserve behavior

Out of scope for this repository:

- Raster vectorization (potrace-wasm integration would be a separate package)
- Full X.509 chain validation (use a PKIX library)
- BIMI record fetching from DNS
- SVG rendering or rasterization

## Adding a rule

Rules live in `src/rules.ts` as entries in the `RULES` object, keyed by
a stable dotted identifier (e.g., `root.width.percentage`). Each rule
requires:

- `code`: the dotted identifier
- `severity`: `fatal` | `error` | `warning` | `info`
- `spec`: a `SpecRef` pointing to the authoritative source
- `autoFixable`: boolean
- `messageTemplate`: human-readable, with `{placeholder}` substitutions
- `fixDescription`: if auto-fixable, a short description of what the fix does

The validator (`src/validate.ts`) detects conditions and pushes rule
instances into the issue list. The transformer (`src/transform.ts`)
keys off the rule code and applies the fix. Keeping these layered means
adding a rule is a three-location change: the rule definition, the
condition check, and the fix implementation.

## Severity guidelines

- `fatal`: prevents the validator or transformer from safely continuing
  (parse errors, script injection, etc.)
- `error`: a MUST violation per spec, OR a documented requirement from
  a major implementer (Apple, Google, the BIMI Group)
- `warning`: a SHOULD violation, or a recommendation with documented
  support
- `info`: purely informational

An SVG is reported as `compliant: true` only when it has zero issues of
severity `warning` or higher. This means every rule affects the
compliance verdict except `info`.

## Testing

```sh
npm install
node --experimental-strip-types test/run.ts
```

The integration test exercises the full pipeline against representative
inputs. New rules should come with test cases that demonstrate both the
detection and the fix.

## Code style

No strong preferences. Keep the implementation boring and inspectable —
the whole point of this project is that CA product teams and BIMI
implementers can read the source and understand what's happening.
Prefer pure functions over classes. Prefer explicit over clever.

## License

By contributing, you agree that your contributions will be licensed
under the project's MIT license.
