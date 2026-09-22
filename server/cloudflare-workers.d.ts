declare module "cloudflare:workers" {
  export const env: Record<string, unknown>;
}

declare module "cloudflare:node" {
  export function httpServerHandler(options: { port: number }): {
    fetch(request: Request, env: unknown, ctx: ExecutionContext): Promise<Response>;
  };
}

type ExecutionContext = {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
};
