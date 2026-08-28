import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router, protectedProcedure } from "./_core/trpc";
import { eq } from "drizzle-orm";
import { admins as adminsTable } from "../drizzle/schema";
import * as db from "./db";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { sdk } from "./_core/sdk";
import { ONE_YEAR_MS } from "@shared/const";

export const appRouter = router({
  auth: router({
    // 获取当前登录管理员信息
    me: publicProcedure.query(async ({ ctx }) => {
      return ctx.user;
    }),

    // 独立账号密码登录
    login: publicProcedure
      .input(z.object({ username: z.string(), password: z.string() }))
      .mutation(async ({ input, ctx }) => {
        const admin = await db.getAdminByUsername(input.username);
        if (!admin) throw new TRPCError({ code: "UNAUTHORIZED", message: "账号不存在" });
        
        // 简单比对
        if (admin.passwordHash !== input.password) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "密码错误" });
        }

        const token = await sdk.createSessionToken(`admin_${admin.id}`, {
          name: admin.username,
          expiresInMs: ONE_YEAR_MS,
        });

        ctx.res.cookie(COOKIE_NAME, token, { ...getSessionCookieOptions(ctx.req), maxAge: ONE_YEAR_MS });
        return { success: true, user: { id: admin.id, username: admin.username, role: admin.role } };
      }),

    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true };
    }),

    // 桌面端联网验证接口 (公开)
    verify: publicProcedure
      .input(z.object({ code: z.string(), machineId: z.string() }))
      .mutation(async ({ input }) => {
        return await db.verifyActivationCode(input.code, input.machineId);
      }),
  }),

  // 管理员专用接口
  activation: router({
    list: protectedProcedure
      .input(z.object({ query: z.string().optional() }))
      .query(async ({ input }) => {
        return await db.getActivationCodes(input.query);
      }),

    generate: protectedProcedure
      .input(z.object({ 
        prefix: z.string()
          .trim()
          .max(24, "前缀最多 24 个字符")
          .refine((value) => value === "" || /^[A-Z0-9-]+$/i.test(value), {
            message: "前缀只能包含字母、数字和连字符",
          })
          .optional(),
        note: z.string().optional(), 
        durationDays: z.number(),
        count: z.number().default(1) 
      }))
      .mutation(async ({ input }) => {
        const results = [];
        let prefix = (input.prefix || "").trim().toUpperCase();

        // 未填写前缀时使用默认随机前缀；非法字符已经由 Zod schema 拒绝
        if (!prefix) {
          prefix = Math.random().toString(36).substring(2, 6).toUpperCase();
        }

        for (let i = 0; i < input.count; i++) {
          const randomPart = Math.random().toString(36).substring(2, 12).toUpperCase();
          const code = `${prefix}-${randomPart}`;
          await db.createActivationCode({
            code,
            note: input.note,
            durationDays: input.durationDays,
            status: 'active'
          });
          results.push(code);
        }
        return { success: true, codes: results };
      }),

    updateStatus: protectedProcedure
      .input(z.object({ id: z.number(), status: z.enum(['active', 'disabled']) }))
      .mutation(async ({ input }) => {
        await db.updateActivationCodeStatus(input.id, input.status);
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await db.deleteActivationCode(input.id);
        return { success: true };
      }),

    deleteMany: protectedProcedure
      .input(z.object({ ids: z.array(z.number().int().positive()).min(1).max(1000) }))
      .mutation(async ({ input }) => {
        await db.deleteActivationCodes(input.ids);
        return { success: true, deleted: new Set(input.ids).size };
      }),

    renew: protectedProcedure
      .input(z.object({ id: z.number(), days: z.number() }))
      .mutation(async ({ input }) => {
        await db.renewActivationCode(input.id, input.days);
        return { success: true };
      }),
  }),

  // 管理员账号管理
  admin: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      if ((ctx.user as any)?.role !== 'super') throw new TRPCError({ code: "FORBIDDEN", message: "仅主管理员可管理账号" });
      return await db.listAdmins();
    }),
    create: protectedProcedure
      .input(z.object({ 
        username: z.string(), 
        password: z.string(), 
        role: z.enum(['super', 'sub']),
        permissions: z.string().optional() 
      }))
      .mutation(async ({ input, ctx }) => {
        if ((ctx.user as any)?.role !== 'super') throw new TRPCError({ code: "FORBIDDEN", message: "仅主管理员可创建账号" });
        await db.createAdmin({
          username: input.username,
          passwordHash: input.password, 
          role: input.role,
          permissions: input.permissions || "[]"
        });
        return { success: true };
      }),
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        if ((ctx.user as any)?.role !== 'super') throw new TRPCError({ code: "FORBIDDEN", message: "仅主管理员可删除账号" });
        await db.deleteAdmin(input.id);
        return { success: true };
      }),
  })
});

export type AppRouter = typeof appRouter;
