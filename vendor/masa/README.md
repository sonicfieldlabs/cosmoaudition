# Vendored MASA 0.1.0 artifacts

These package tarballs are immutable local copies of the **released** MASA
0.1.0 packages, packed from the public repository
`https://github.com/sonicfieldlabs/MASA` at tag `v0.1.0`
(commit `3a33d96`, released 2026-08-07, MIT). They are vendored so
COSMOAUDITION can build and validate records without depending on an
unpublished registry package or any sibling repository at runtime.

This release supersedes the pre-release audited snapshot of 2026-07-29 that
was previously vendored under the same version. The reviewed differences that
affect COSMOAUDITION: canonical identifiers moved to
`https://masa.sonicfield.org/…` (the record `$schema` and `@context`
constants), the profile set gained `processing`, the validator gained
processing-request validation (`validateDocument("processingRequest", …)`),
deterministic locale-pinned diagnostics, and hardening fixes recorded in the
MASA changelog.

- `@sonicfield/masa` is the browser-safe core.
- `@sonicfield/masa-validator` is the browser-safe structural and semantic
  validator.
- `@sonicfield/masa-bundle` is Node-only and is declared only by the API
  package. It is not part of the browser package graph.

Every archive includes the canonical package license. The checksums below are
the local compatibility boundary between COSMOAUDITION and this protocol
release.

Verify the artifacts before installing:

```sh
cd vendor/masa
shasum -a 256 -c CHECKSUMS.sha256
```

Do not rebuild or replace these files in place. Updating to a newer MASA
release requires packing from a tagged MASA commit, a reviewed checksum
update, and a note here recording the tag, commit, and behavioral differences
— exactly as this update did.
