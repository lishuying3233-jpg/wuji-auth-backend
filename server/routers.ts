import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "./db";
import { nanoid } from "nanoid";

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
    // 客户端：验证激活码
    verify: publicProcedure
      .input(z.object({ code: z.string(), machineId: z.string() }))
      .mutation(async ({ input }) => {
        return await db.verifyActivationCode(input.code, input.machineId);
      }),
  }),

  activation: router({
    // 管理端：获取列表
    list: protectedProcedure
      .input(z.object({ query: z.string().optional() }))
      .query(async ({ input, ctx }) => {
        if (ctx.user.role !== 'admin') throw new TRPCError({ code: 'FORBIDDEN' });
        return await db.getActivationCodes(input.query);
      }),
    
    // 管理端：生成激活码
    generate: protectedProcedure
      .input(z.object({ 
        note: z.string().optional(),
        durationDays: z.number().default(365)
      }))
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== 'admin') throw new TRPCError({ code: 'FORBIDDEN' });
        const code = `WUJI-${nanoid(16).toUpperCase()}`;
        await db.createActivationCode({
          code,
          note: input.note || null,
          durationDays: input.durationDays,
        });
        return { code };
      }),
      
    // 管理端：更新状态
    updateStatus: protectedProcedure
      .input(z.object({ id: z.number(), status: z.enum(['active', 'disabled']) }))
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== 'admin') throw new TRPCError({ code: 'FORBIDDEN' });
        await db.updateActivationCodeStatus(input.id, input.status);
        return { success: true };
      }),
      
    // 管理端：删除
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== 'admin') throw new TRPCError({ code: 'FORBIDDEN' });
        await db.deleteActivationCode(input.id);
        return { success: true };
      }),
  }),
});

export type AppRouter = typeof appRouter;
