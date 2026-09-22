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
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
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
