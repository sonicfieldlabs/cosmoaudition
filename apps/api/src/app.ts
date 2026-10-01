import { Hono } from "hono";
import { cors } from "hono/cors";
import { PROJECT_NAME } from "@cosmoaudition/core";
import { isLoopbackRequestHost, parseLocalCorsOrigins } from "./localOnly";
import { apiRoutes } from "./routes/api";
import { applyApiSecurityHeaders } from "./securityHeaders";

export const app = new Hono();
const corsOrigins = parseLocalCorsOrigins(process.env.COSMOAUDITION_CORS_ORIGIN);

app.use("*", applyApiSecurityHeaders);

app.use("*", async (context, next) => {
  if (!isLoopbackRequestHost(context.req.header("host"), context.req.url)) {
    return context.json(
      {
        error:
          "Local-only mode refuses a request whose Host header is not a loopback authority."
      },
      421
    );
  }
  const origin = context.req.header("origin");
  if (origin && !corsOrigins.includes(origin)) {
    return context.json({ error: "Local-only mode refuses an unapproved browser origin." }, 403);
  }
  return next();
});

app.use(
  "/api/*",
  cors({
    origin: corsOrigins,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"]
  })
);

app.get("/health", (context) =>
  context.json({
    ok: true,
    service: "@cosmoaudition/api",
    project: PROJECT_NAME
  })
);

app.route("/api", apiRoutes);
