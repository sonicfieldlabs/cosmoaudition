const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const providerTails = new Map<string, Promise<unknown>>();

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
    throw new Error(`Unexpected response content type: ${contentType.split(";")[0]}.`);
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
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

/**
 * Provider requests must stay on public HTTPS hosts. A redirect is the one way
 * a provider (or a hijacked DNS answer) could otherwise point the gateway at
 * loopback, link-local metadata, or another private service whose response
 * would then be cached and returned to the browser.
 */
function assertPublicProviderUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Provider URL is not a valid absolute URL.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`Provider URL scheme ${parsed.protocol} is refused.`);
  }
  if (isPrivateProviderHost(parsed.hostname)) {
    throw new Error("Provider URL resolves to a loopback or private-network host.");
  }
  return parsed;
}

function isPrivateProviderHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal")
  ) {
    return true;
  }
  if (
    normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fe80:") ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd")
  ) {
    return true;
  }
  const octets = normalized.startsWith("::ffff:")
    ? normalized.slice("::ffff:".length).split(".").map(Number)
    : normalized.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false;
  }
  const [first = -1, second = -1] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
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
        throw new Error(`HTTP ${response.status}`);
      }

      return await boundedJson(response, maxBytes);
    } finally {
      clearTimeout(timeout);
    }
  });
}
