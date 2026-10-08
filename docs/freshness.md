# Observation freshness and mapping

Freshness is evaluated independently of provider/transport health and confidence. A successful fetch does not refresh a provider timestamp. Each signal carries its unchanged value, timestamp, confidence and age limit; API snapshots and exported frames add `acquisitionMode` and `freshness`. Consumers must reevaluate on their own clock rather than trust the producer's cached assessment.

| Input | Effective freshness | Mapping |
| --- | --- | --- |
| Live point, source time <= evaluation time < source time + `staleAfterSeconds` | current | Existing mapping and confidence policy |
| Live point at or beyond the age limit | expired | Refused, null output |
| Source-declared stale | stale | Refused, null output, including fixtures |
| Future source time, including forecast validity | unknown | Refused until the declared source instant; no implied measurement |
| Unusable/zoneless source clock or invalid age limit | unknown | Refused |
| Explicit fixture | unknown, reason fixture | Simulation mapping allowed; no claim of current provider observation |
| Archive replay, whatever the original acquisition mode | unknown, reason archive | Refused as current mapping |

There is no clock-skew grace period. An age limit of zero expires at the observation instant. Forecasts retain their temporal character and validity timestamp; this policy does not infer an issue time or automatically treat a forecast as a measured current point. Aggregate timestamps retain the adapter's declared role. Carbon settlement intervals preserve both `from` and `to` as `observedInterval`; their conservative mapping deadline is start plus the existing source age limit. Other providers' existing interval/series metadata remains intact. An old monthly or historical aggregate therefore does not become a current scalar simply because the server retrieved it now. Explicit historical sonification requires a separately authored replay policy; it is not enabled here.

The same evaluator gates core control mappings, modulation/generation frames, MASA mapping receipts and the instrument's selected-signal material modulation. The web archive loads copies marked as archive without changing the stored snapshot. Refusing a new control does not prove that an already scheduled audio parameter has stopped; receipts remain scheduling evidence, not evidence of hearing or physical output. Explicit holds for genuinely absent values retain the existing policy; they cannot substitute a newly supplied stale/future/archive signal.

MASA exports retain source timestamps (canonical ISO spelling) and qualified values. Future source instants are no longer replaced with snapshot time. A zoneless/unusable clock still uses the adapter's disclosed representational fallback in `observedAt`, with the original string preserved in `cosmo:sourceTimestamp`; freshness is unknown and mapping is refused. `cosmo:effectiveFreshness` carries the evaluation clock and reason. Observation freshness includes an expiry when derivable, but does not invent a retrieval time equal to snapshot serialization. Source-level freshness evaluates the separate acquisition clock/TTL. Source health can truthfully remain healthy while the observation is expired.

The wire contract identifiers remain `cosmo/modulation/v0.2`, `cosmo/generation-frame/v1` and MASA `0.2.0`; additions are optional signal metadata for older readers, with stricter admission in updated consumers. The MASA snapshot adapter implementation revision is `0.2.1`, distinct from application version and MASA tooling version.

GERM reevaluates selected generation receipts, modulation routes and direct mappings using receiver time and original signal age limits. Missing/ambiguous signal bindings and missing live age limits fail closed. Its `accept_held`/`accept_uncertainty` switches do not override freshness. Oída admits an attributable observation account with a separate `effective_freshness`, preserves the source snapshot/hash, and requests no execution. A producer's `current` claim without a usable expiry is not evidence of current validity at reception.

`pnpm test` exercises snapshot collection with simulated successful HTTP, canonical MASA export and real frame builders. Rebuild the shared Oída/GERM fixtures using:

```sh
pnpm --filter @cosmoaudition/api exec tsx ../../scripts/build-freshness-fixtures.ts OUTPUT.json
```

Compare/review the output before replacing consumer copies and update their origin hashes. These are deterministic software fixtures, not live-provider qualification. `pnpm release:check` remains mandatory for local closeout.
