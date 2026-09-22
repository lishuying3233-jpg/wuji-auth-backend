import { env } from "cloudflare:workers";
import { httpServerHandler } from "cloudflare:node";
import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./server/_core/oauth";
import { registerStorageProxy } from "./server/_core/storageProxy";
import { appRouter } from "./server/routers";
import { createContext } from "./server/_core/context";
import { processPendingOrders } from "./server/order_worker";
import { sdk } from "./server/_core/sdk";

const app = express();
// Avoid Express body-parser in Workers: body-parser pulls iconv-lite/raw-body,
// which is not compatible with the Workers runtime bundle.
app.use(async (req: any, _res, next) => {
  const method = String(req.method || "").toUpperCase();
  const contentType = String(req.headers?.["content-type"] || "").toLowerCase();
  if (method === "GET" || method === "HEAD" || (!contentType.includes("application/json") && !contentType.includes("application/x-www-form-urlencoded"))) {
    return next();
  }
  try {
    const chunks: Uint8Array[] = [];
    for await (const chunk of req) chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk);
    const bytes = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    const text = new TextDecoder().decode(body);
    req.body = contentType.includes("application/json") ? (text ? JSON.parse(text) : {}) : Object.fromEntries(new URLSearchParams(text));
    next();
  } catch (error) {
    _res.status(400).json({ error: "Invalid request body" });
  }
});
registerStorageProxy(app);
registerOAuthRoutes(app);

app.post("/api/scheduled/verifyOrders", async (req, res) => {
  try {
    const user = await sdk.authenticateRequest(req);
    if (!user.isCron) return res.status(403).json({ error: "cron-only" });
    await processPendingOrders();
    res.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Scheduled] verifyOrders failed:", message);
    res.status(500).json({ error: message });
  }
});

app.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext }));
app.listen(3000);
const expressHandler = httpServerHandler({ port: 3000 });

export default {
  async fetch(request: Request, workerEnv: { ASSETS: { fetch(request: Request): Promise<Response> } }, ctx: ExecutionContext) {
    if (!new URL(request.url).pathname.startsWith("/api/")) return workerEnv.ASSETS.fetch(request);
    return expressHandler.fetch(request, workerEnv, ctx);
  },
};
