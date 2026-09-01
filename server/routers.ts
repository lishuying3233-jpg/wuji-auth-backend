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
import { sendTelegramMessage, TG_TEMPLATES } from "./telegram";
import { PLANS, getPlanNameByDuration, isSupportedPlanDuration } from "../shared/payment_const";
import { orders as ordersTable } from "../drizzle/schema";

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
        durationDays: z.number().int().refine(isSupportedPlanDuration, {
          message: "不支持的授权期限",
        }),
        count: z.number().int().min(1).max(50).default(1)
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
      .mutation(async ({ input, ctx }) => {
        await db.updateActivationCodeStatus(input.id, input.status);
        if (input.status === 'disabled') {
          const codes = await db.getActivationCodes();
          const code = codes.find(c => c.id === input.id);
          if (code) await sendTelegramMessage(TG_TEMPLATES.licenseDisabled(code.code, (ctx.user as any)?.username || "Admin"));
        }
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
      .input(z.object({ id: z.number().int().positive(), days: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        await db.renewActivationCode(input.id, input.days);
        const codes = await db.getActivationCodes();
        const code = codes.find(c => c.id === input.id);
        if (code) await sendTelegramMessage(TG_TEMPLATES.licenseRenewed(code.code, input.days, (ctx.user as any)?.username || "Admin"));
        return { success: true };
      }),

    // 用于纠正历史上被默认写成 365 天的激活码；已激活时会同步修正到期日。
    correctDuration: protectedProcedure
      .input(z.object({
        id: z.number().int().positive(),
        durationDays: z.number().int().refine(isSupportedPlanDuration, {
          message: "不支持的授权期限",
        }),
      }))
      .mutation(async ({ input }) => {
        const updated = await db.correctActivationCodeDuration(input.id, input.durationDays);
        if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "激活码不存在" });
        return {
          success: true,
          durationDays: updated.durationDays,
          expiresAt: updated.expiresAt?.getTime() ?? null,
          planName: getPlanNameByDuration(updated.durationDays),
        };
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
  }),

  // 支付与订购接口 (公开)
  payment: router({
    getAddresses: publicProcedure.query(async () => {
      return await db.getPaymentSettings();
    }),
    createOrder: publicProcedure
      .input(z.object({
        machineId: z.string(),
        planName: z.string(),
        durationDays: z.number(),
        amount: z.string(),
        network: z.enum(["ERC20", "TRC20"]),
        txHash: z.string().optional()
      }))
      .mutation(async ({ input }) => {
        const plan = PLANS.find(p => p.name === input.planName && p.durationDays === input.durationDays && p.price === input.amount);
        if (!plan) throw new TRPCError({ code: "BAD_REQUEST", message: "套餐参数无效，请重新选择套餐" });
        if (input.txHash) {
          const normalizedTxHash = input.txHash.trim();
          const validHash = input.network === "ERC20"
            ? /^0x[a-fA-F0-9]{64}$/.test(normalizedTxHash)
            : /^[a-fA-F0-9]{64}$/.test(normalizedTxHash);
          if (!validHash) throw new TRPCError({ code: "BAD_REQUEST", message: "TxHash 格式与支付网络不匹配" });
          const existing = await db.getOrderByTxHash(normalizedTxHash);
          if (existing) throw new TRPCError({ code: "CONFLICT", message: "该交易哈希已被使用" });
          input = { ...input, txHash: normalizedTxHash };
        }
        const order = await db.createOrder(input);
        // 发送 TG 通知
        await sendTelegramMessage(TG_TEMPLATES.orderCreated({ ...input, id: (order as any).insertId }));
        return order;
      }),
    getSubscription: publicProcedure
      .input(z.object({
        machineId: z.string(),
        activationCode: z.string().trim().min(1).optional(),
      }))
      .query(async ({ input }) => {
        // 新版客户端提交本地保存的激活码，避免同一机器或机器码碰撞时串用其他授权。
        // 旧版客户端未提交 activationCode 时，继续兼容按机器码查询。
        const code = input.activationCode
          ? await db.getActivationCodeByCodeForMachine(input.activationCode.toUpperCase(), input.machineId)
          : await db.getActivationCodeByMachineId(input.machineId);
        if (!code) return { active: false };
        return {
          active: code.status === 'active' && (!code.expiresAt || code.expiresAt.getTime() > Date.now()),
          expiresAt: code.expiresAt?.getTime() ?? null,
          durationDays: code.durationDays,
          planName: getPlanNameByDuration(code.durationDays)
        };
      }),
    getOrderStatus: publicProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const db_ = await db.getDb();
        if (!db_) return null;
        const result = await db_.select().from(ordersTable).where(eq(ordersTable.id, input.id)).limit(1);
        return result.length > 0 ? result[0] : null;
      })
  }),

  // 管理员订单与支付设置接口
  order: router({
    list: protectedProcedure.query(async () => {
      return await db.getOrders();
    }),
    listSettings: protectedProcedure.query(async () => {
      return await db.getPaymentSettings();
    }),
    updateStatus: protectedProcedure
      .input(z.object({
        id: z.number(),
        status: z.enum(["pending", "paid", "completed", "failed"]),
        machineId: z.string(),
        durationDays: z.number()
      }))
      .mutation(async ({ input }) => {
        let activationCode = undefined;
        if (input.status === 'completed') {
          // 修正逻辑：设备码后三位仅作为前缀
          const prefix = input.machineId.slice(-3).toUpperCase();
          const random = Math.random().toString(36).substring(2, 10).toUpperCase();
          const finalCode = `${prefix}-${random}`;
          
          await db.createActivationCode({
            code: finalCode,
            status: 'active',
            durationDays: input.durationDays,
            note: `订单自动发码 #${input.id}`
          });
          activationCode = finalCode;
        }
        await db.updateOrderStatus(input.id, input.status, activationCode);
        return { success: true, activationCode };
      }),
    manageSettings: protectedProcedure
      .input(z.object({
        id: z.number().optional(),
        network: z.enum(["ERC20", "TRC20"]),
        address: z.string(),
        status: z.enum(["active", "disabled"])
      }))
      .mutation(async ({ input }) => {
        await db.upsertPaymentSetting(input);
        return { success: true };
      }),
    deleteSetting: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await db.deletePaymentSetting(input.id);
        return { success: true };
      }),
    getTelegramSettings: protectedProcedure.query(async ({ ctx }) => {
      if ((ctx.user as any)?.role !== 'super') throw new TRPCError({ code: "FORBIDDEN", message: "仅主管理员可管理通知" });
      const settings = await db.getTelegramSettings();
      if (settings && settings.botToken) {
        // Token 脱敏：保留前 6 位和后 4 位
        const t = settings.botToken;
        if (t.length > 10) {
          settings.botToken = `${t.slice(0, 6)}******${t.slice(-4)}`;
        }
      }
      return settings;
    }),
    updateTelegramSettings: protectedProcedure
      .input(
        z.object({
          botToken: z.string().optional(),
          chatId: z.string().optional(),
          isEnabled: z.number().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        if ((ctx.user as any)?.role !== 'super') throw new TRPCError({ code: "FORBIDDEN", message: "仅主管理员可修改通知" });
        
        // 如果输入是脱敏后的 Token，则不更新 Token 字段
        const updateData = { ...input };
        if (updateData.botToken && updateData.botToken.includes("******")) {
          delete updateData.botToken;
        }
        
        return await db.updateTelegramSettings(updateData);
      }),
    testTelegram: protectedProcedure
      .input(z.object({
        botToken: z.string().optional(),
        chatId: z.string().optional(),
      }).optional())
      .mutation(async ({ input, ctx }) => {
        if ((ctx.user as any)?.role !== 'super') throw new TRPCError({ code: "FORBIDDEN", message: "仅主管理员可发送测试" });
        const { sendTelegramMessage } = await import("./telegram");
        
        // 如果输入是脱敏后的 Token，则从数据库读取真实 Token
        let effectiveToken = input?.botToken;
        if (effectiveToken && effectiveToken.includes("******")) {
          const settings = await db.getTelegramSettings();
          effectiveToken = settings?.botToken || undefined;
        }

        const result = await sendTelegramMessage(
          "<b>🔔 测试通知</b>\n━━━━━━━━━━━━━━\n这是一条来自 M7社媒助手后台的测试消息，您的 Telegram 通知已配置成功。", 
          true,
          { botToken: effectiveToken, chatId: input?.chatId }
        );

        if (!result.success) {
          throw new TRPCError({ 
            code: "BAD_REQUEST", 
            message: `发送失败: ${result.error}` 
          });
        }
        return { success: true };
      }),
  })
});

export type AppRouter = typeof appRouter;
