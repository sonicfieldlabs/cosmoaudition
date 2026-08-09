# Vendored MASA tooling 0.1.1

These package tarballs are immutable local copies of the released MASA
TypeScript tooling 0.1.1, packed from the public repository
`https://github.com/sonicfieldlabs/MASA` at tag `v0.1.1`
(commit `15ea570e84701da33e382ba9ff8f8cc0ce3cbe30`, released 2026-08-09,
MIT). The packages continue to implement the normative MASA 0.1.0 protocol;
schema identifiers, contexts, record versions, and protocol directories remain
0.1.0.

They are vendored so COSMOAUDITION can build and validate records without an
unpublished registry package or mutable sibling checkout at runtime. This
update adds the audited public-projection and validation hardening, synchronized
reference-tooling identity, stricter path/secret/coordinate/endpoint handling,
and dependency maintenance recorded in the MASA 0.1.1 changelog.

- `@sonicfield/masa` is the browser-safe core.
- `@sonicfield/masa-validator` is the browser-safe structural, semantic,
  profile, and public-safety validator.

The unused Node-only MASA bundle archive is deliberately not vendored. Both
included archives contain the canonical package license. These checksums are
the reviewed compatibility boundary between COSMOAUDITION and the MASA release.

Verify the artifacts before installing:

```sh
cd vendor/masa
shasum -a 256 -c CHECKSUMS.sha256
```

Do not rebuild or replace these files in place. Updating MASA requires packing
from an exact public tag in a fresh clone, reviewing package contents and
licenses, updating the checksums, and recording the tag and commit here.
