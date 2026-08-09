import { BlockList, isIP } from "node:net";

const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const providerTails = new Map<string, Promise<unknown>>();

async function cancelResponseBody(response: Response): Promise<void> {
  if (response.body) {
    await response.body.cancel().catch(() => undefined);
  }
}

async function runSerialized<T>(
  key: string | undefined,
  operation: () => Promise<T>
): Promise<T> {
  if (!key) return operation();
  const previous = providerTails.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  providerTails.set(key, current);
  try {
    return await current;
  } finally {
    if (providerTails.get(key) === current) providerTails.delete(key);
  }
}

async function boundedJson(response: Response, maxBytes: number): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType && !contentType.includes("json")) {
    await cancelResponseBody(response);
    throw new Error(`Unexpected response content type: ${contentType.split(";")[0]}.`);
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await cancelResponseBody(response);
    throw new Error(`Provider response exceeds the ${maxBytes}-byte limit.`);
  }
  if (!response.body) {
    throw new Error("Provider returned an empty response body.");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`Provider response exceeds the ${maxBytes}-byte limit.`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Provider response is not valid UTF-8 JSON.");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Provider response is not valid JSON.");
  }
}

const MAX_PROVIDER_REDIRECTS = 3;
const RESERVED_PROVIDER_SUFFIXES = [
  "localhost",
  "local",
  "internal",
  "home.arpa",
  "test",
  "invalid",
  "example",
  "example.com",
  "example.net",
  "example.org",
  "onion",
  "alt"
] as const;

const blockedProviderAddresses = new BlockList();

for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4]
] as const) {
  blockedProviderAddresses.addSubnet(network, prefix, "ipv4");
}

for (const [network, prefix] of [
  ["::", 128],
  ["::", 96],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["100:0:0:1::", 64],
  ["2001::", 32],
  ["2001:2::", 48],
  ["2001:10::", 28],
  ["2001:20::", 28],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
  ["5f00::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8]
] as const) {
  blockedProviderAddresses.addSubnet(network, prefix, "ipv6");
}

/**
 * Provider requests must stay on HTTPS URLs whose host representation is not a
 * reserved name or non-public literal address. Redirects are checked one hop
 * at a time before they are followed.
 *
 * This is a URL-policy boundary, not a general-purpose SSRF proxy: DNS remains
 * inside Node's HTTPS transport and is authenticated by TLS rather than pinned
 * here. All initial provider URLs are code-declared. A public deployment or a
 * future user-supplied URL surface needs a connection-level resolver policy.
 */
function assertPublicProviderUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Provider URL is not a valid absolute URL.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`Provider URL scheme ${parsed.protocol} is refused; use public HTTPS.`);
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new Error("Provider URLs may not contain credentials.");
  }
  if (isPrivateProviderHost(parsed.hostname)) {
    throw new Error("Provider URL names a loopback, non-public, or private-network host.");
  }
  return parsed;
}

function isPrivateProviderHost(hostname: string): boolean {
  const normalized = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/, "");
  if (normalized.length === 0) {
    return true;
  }
  if (
    RESERVED_PROVIDER_SUFFIXES.some(
      (suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`)
    )
  ) {
    return true;
  }
  const version = isIP(normalized);
  if (version === 4) {
    return blockedProviderAddresses.check(normalized, "ipv4");
  }
  if (version === 6) {
    return blockedProviderAddresses.check(normalized, "ipv6");
  }
  return false;
}

export async function fetchJson(
  url: string,
  options: {
    timeoutMs: number;
    headers?: Record<string, string>;
    maxBytes?: number;
    concurrencyKey?: string;
  }
): Promise<unknown> {
  if (
    !Number.isInteger(options.timeoutMs) ||
    options.timeoutMs < 1 ||
    options.timeoutMs > 120_000
  ) {
    throw new RangeError("Provider timeout must be an integer inside 1..120000 ms.");
  }
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 16 * 1024 * 1024) {
    throw new RangeError("Provider response limit must be an integer inside 1..16777216 bytes.");
  }
  assertPublicProviderUrl(url);

  return runSerialized(options.concurrencyKey, async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

    try {
      const init: RequestInit = {
        signal: controller.signal,
        // Redirects are resolved here, one hop at a time, so every hop is
        // re-checked against the public-host rule instead of being followed
        // blindly by the runtime.
        redirect: "manual",
        ...(options.headers === undefined ? {} : { headers: options.headers })
      };

      let currentUrl = url;
      let response = await fetch(currentUrl, init);
      for (let hop = 0; response.status >= 300 && response.status < 400; hop += 1) {
        await cancelResponseBody(response);
        if (hop >= MAX_PROVIDER_REDIRECTS) {
          throw new Error("Provider redirected too many times.");
        }
        const location = response.headers.get("location");
        if (!location) {
          throw new Error(`HTTP ${response.status} without a redirect location.`);
        }
        currentUrl = new URL(location, currentUrl).href;
        assertPublicProviderUrl(currentUrl);
        response = await fetch(currentUrl, init);
      }

      if (!response.ok) {
        await cancelResponseBody(response);
        throw new Error(`HTTP ${response.status}`);
      }

      return await boundedJson(response, maxBytes);
    } finally {
      clearTimeout(timeout);
    }
  });
}
