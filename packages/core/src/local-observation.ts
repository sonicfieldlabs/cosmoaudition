import type { ObservedSignal } from "./types";

/** Imported owner material is caller-declared; it never becomes live provider evidence. */
export interface LocalObservation {
  contract: "cosmo/local-observation/v1";
  sourceId: string;
  kind: "grib-forecast" | "account-report";
  sourceSha256: string;
  accountRef: string | null;
  attribution: string;
  license: string;
  rightsRef: string;
  coverage: string;
  issuedAt: string;
  fetchedAt: string;
  ttlSeconds: number;
  points: { id: string; unit: string; validAt: string; value: number | null }[];
}

function instant(value: string): number {
  if (typeof value !== "string" || !/(Z|[+-]\d\d:\d\d)$/.test(value)) {
    throw new RangeError("Observation timestamps require a timezone.");
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time))
    throw new RangeError("Invalid observation timestamp.");
  return time;
}

export function importLocalObservation(
  raw: unknown,
  now: string,
): {
  signals: ObservedSignal[];
  provenance: Omit<LocalObservation, "points"> & {
    acquisitionMode: "local-import";
    independentVerification: false;
  };
} {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new RangeError("Invalid observation.");
  const packet = raw as LocalObservation;
  const keys = [
    "contract",
    "sourceId",
    "kind",
    "sourceSha256",
    "accountRef",
    "attribution",
    "license",
    "rightsRef",
    "coverage",
    "issuedAt",
    "fetchedAt",
    "ttlSeconds",
    "points",
  ];
  if (
    Object.keys(packet).length !== keys.length ||
    keys.some((k) => !(k in packet)) ||
    packet.contract !== "cosmo/local-observation/v1" ||
    !["grib-forecast", "account-report"].includes(packet.kind) ||
    !/^[A-Za-z0-9:_-]{1,128}$/.test(packet.sourceId) ||
    !/^[0-9a-f]{64}$/.test(packet.sourceSha256)
  )
    throw new RangeError("Invalid observation envelope.");
  for (const value of [
    packet.attribution,
    packet.license,
    packet.rightsRef,
    packet.coverage,
  ]) {
    if (typeof value !== "string" || !value.trim() || value.length > 1024)
      throw new RangeError("Missing provenance.");
  }
  if (
    packet.accountRef !== null &&
    (typeof packet.accountRef !== "string" ||
      !/^[A-Za-z0-9:_-]{1,128}$/.test(packet.accountRef))
  ) {
    throw new RangeError(
      "Account reference must be opaque; never a credential or URL.",
    );
  }
  if (packet.kind === "account-report" && packet.accountRef === null)
    throw new RangeError("Account reports need an account reference.");
  const current = instant(now),
    issued = instant(packet.issuedAt),
    fetched = instant(packet.fetchedAt);
  if (
    issued > fetched ||
    fetched > current ||
    !Number.isInteger(packet.ttlSeconds) ||
    packet.ttlSeconds < 1 ||
    packet.ttlSeconds > 86400
  ) {
    throw new RangeError("Observation freshness bounds refused.");
  }
  if (
    !Array.isArray(packet.points) ||
    packet.points.length < 1 ||
    packet.points.length > 4096
  )
    throw new RangeError("Observation point budget exceeded.");
  const stale = current - Math.min(issued, fetched) > packet.ttlSeconds * 1000;
  const ids = new Set<string>();
  const signals = packet.points.map((point) => {
    if (
      !point ||
      Object.keys(point).length !== 4 ||
      !/^[A-Za-z0-9:_.-]{1,128}$/.test(point.id) ||
      ids.has(point.id) ||
      typeof point.unit !== "string" ||
      point.unit.length < 1 ||
      point.unit.length > 64 ||
      (point.value !== null &&
        (typeof point.value !== "number" || !Number.isFinite(point.value)))
    ) {
      throw new RangeError("Invalid or duplicate observation point.");
    }
    ids.add(point.id);
    const valid = instant(point.validAt);
    if (packet.kind === "account-report" && valid > current)
      throw new RangeError("Account observation lies in the future.");
    return {
      id: `${packet.sourceId}:${point.id}`,
      label: point.id,
      layer: "cloud" as const,
      unit: point.unit,
      value: stale ? null : point.value,
      normalized: null,
      timestamp: point.validAt,
      sourceId: packet.sourceId,
      epistemicStatus: "reported" as const,
      temporalCharacter:
        packet.kind === "grib-forecast"
          ? ("forecast" as const)
          : ("aggregate" as const),
      signalKind: "observation" as const,
      acquisitionMode: "local-import",
      confidence: stale
        ? ("stale" as const)
        : point.value === null
          ? ("error" as const)
          : ("low" as const),
      staleAfterSeconds: packet.ttlSeconds,
      notes: `${packet.attribution}; ${packet.license}; ${packet.coverage}; caller-declared import, no independent verification`,
    };
  });
  const { points: _points, ...provenance } = packet;
  return {
    signals,
    provenance: {
      ...provenance,
      acquisitionMode: "local-import",
      independentVerification: false,
    },
  };
}
