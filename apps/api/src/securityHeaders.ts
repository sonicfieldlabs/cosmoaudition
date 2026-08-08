import type { Context, Next } from "hono";

export const apiSecurityHeaders = {
  "Cache-Control": "no-store, max-age=0",
  "Content-Security-Policy":
    "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), midi=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY"
} as const;

export async function applyApiSecurityHeaders(
  context: Context,
  next: Next
): Promise<void> {
  await next();

  for (const [name, value] of Object.entries(apiSecurityHeaders)) {
    context.header(name, value);
  }
}
