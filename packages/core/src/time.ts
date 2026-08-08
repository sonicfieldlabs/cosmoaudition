/**
 * Timestamp handling shared by every layer that claims determinism.
 *
 * `Date.parse` reads a date-time without an explicit offset as host-local time,
 * so the same input yields different instants on different machines. Anything
 * that feeds a deterministic generator, a staleness decision, or a MASA receipt
 * must therefore refuse zoneless input rather than silently localize it.
 */

const EXPLICIT_ZONE_PATTERN = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i;

/** True when a date-time string carries an explicit UTC offset or `Z`. */
export function hasExplicitTimeZone(value: string): boolean {
  return EXPLICIT_ZONE_PATTERN.test(value.trim());
}

/**
 * Parse a date-time that must be unambiguous across hosts. Returns `null` for
 * an unparseable value and for one whose offset is absent.
 */
export function parseAbsoluteTime(value: string): number | null {
  if (!hasExplicitTimeZone(value)) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isAbsoluteTime(value: string): boolean {
  return parseAbsoluteTime(value) !== null;
}
