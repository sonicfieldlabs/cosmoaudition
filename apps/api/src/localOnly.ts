export const defaultLocalCorsOrigins = [
  "http://127.0.0.1:4173",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174",
  "http://127.0.0.1:5175",
  "http://localhost:4173",
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175"
] as const;

export function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();

  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]"
  );
}

/**
 * A request's authority must itself name a loopback host. CORS and the bind
 * address alone do not stop DNS rebinding: a page on a public domain whose name
 * resolves to 127.0.0.1 reaches this server as a same-origin request, so the
 * browser never consults CORS. Refusing a non-loopback authority closes that
 * path while leaving ordinary local use untouched.
 *
 * The `Host` header is authoritative when present. Fetch-style callers cannot
 * set it (it is a forbidden header), so the request URL — which the Node server
 * adapter builds from that same header — is the fallback.
 */
export function isLoopbackRequestHost(
  hostHeader: string | undefined,
  requestUrl?: string
): boolean {
  const authority = hostHeader?.trim() ? hostHeader.trim() : hostFromUrl(requestUrl);
  if (authority === undefined || authority.length === 0 || authority.length > 256) {
    return false;
  }
  // Parse with a scheme so bracketed IPv6 authorities and ports are handled by
  // the URL parser rather than by hand-rolled string splitting.
  let parsed: URL;
  try {
    parsed = new URL(`http://${authority}`);
  } catch {
    return false;
  }
  if (parsed.username !== "" || parsed.password !== "" || parsed.pathname !== "/") {
    return false;
  }
  return isLoopbackHost(parsed.hostname);
}

function hostFromUrl(requestUrl: string | undefined): string | undefined {
  if (requestUrl === undefined) {
    return undefined;
  }
  try {
    return new URL(requestUrl).host;
  } catch {
    return undefined;
  }
}

export function assertLoopbackHost(hostname: string, label: string): string {
  if (!isLoopbackHost(hostname)) {
    throw new Error(
      `Local-only mode refuses ${label}=${hostname}. Use 127.0.0.1, localhost, or ::1.`
    );
  }

  return hostname;
}

export function parseLocalCorsOrigins(rawOrigins: string | undefined): string[] {
  if (!rawOrigins || rawOrigins.trim().length === 0) {
    return [...defaultLocalCorsOrigins];
  }

  const origins = rawOrigins
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    return [...defaultLocalCorsOrigins];
  }

  for (const origin of origins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(`Invalid COSMOAUDITION_CORS_ORIGIN value: ${origin}`);
    }

    if (!isLoopbackHost(parsed.hostname)) {
      throw new Error(
        `Local-only mode refuses CORS origin ${origin}. Use localhost, 127.0.0.1, or [::1].`
      );
    }
  }

  return Array.from(new Set(origins));
}
