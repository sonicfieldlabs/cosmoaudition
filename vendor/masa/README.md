# Vendored MASA tooling 0.2.0

These package tarballs are immutable local copies of the released MASA
TypeScript tooling 0.2.0, packed from the public repository
`https://github.com/sonicfieldlabs/MASA` for tag `v0.2.0`, peeled to commit
`a967339d77cb7adfb977061e6f3299ff27e55619` (released 2026-08-11, MIT).
The packages implement the normative MASA 0.2.0 protocol, including its
Observation profile and canonical identifiers.

They are vendored so COSMOAUDITION can build and validate records without an
unpublished registry package or mutable sibling checkout at runtime. This
update adds the Observation profile used to carry epistemic status, temporal
character, and signal kind as normative fields while retaining the audited
public-projection and validation boundaries.

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
