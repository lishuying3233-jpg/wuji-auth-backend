import { eq, desc, and, like, or, inArray, isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, activationCodes, InsertActivationCode, admins, InsertAdmin, paymentSettings, orders, telegramSettings } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// Admin Helpers
export async function getAdminByUsername(username: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(admins).where(eq(admins.username, username)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getAdminById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(admins).where(eq(admins.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function createAdmin(admin: InsertAdmin) {
  const db = await getDb();
  if (!db) return;
  await db.insert(admins).values(admin);
}

export async function listAdmins() {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(admins);
}

export async function deleteAdmin(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(admins).where(eq(admins.id, id));
}

export async function updateAdminPermissions(id: number, permissions: string) {
  const db = await getDb();
  if (!db) return;
  await db.update(admins).set({ permissions }).where(eq(admins.id, id));
}

export async function getActivationCodes(query?: string) {
  const db = await getDb();
  if (!db) return [];
  
  if (query) {
    return await db.select().from(activationCodes)
      .where(or(
        like(activationCodes.code, `%${query}%`),
        like(activationCodes.machineId, `%${query}%`),
        like(activationCodes.note, `%${query}%`)
      ))
      .orderBy(desc(activationCodes.createdAt));
  }
  
  return await db.select().from(activationCodes).orderBy(desc(activationCodes.createdAt));
}

export async function createActivationCode(data: InsertActivationCode) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(activationCodes).values(data);
}

export async function updateActivationCodeStatus(id: number, status: 'active' | 'disabled') {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(activationCodes).set({ status }).where(eq(activationCodes.id, id));
}

export async function deleteActivationCode(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(activationCodes).where(eq(activationCodes.id, id));
}

export async function deleteActivationCodes(ids: number[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const uniqueIds = Array.from(new Set(ids.filter((id) => Number.isInteger(id) && id > 0)));
  if (uniqueIds.length === 0) return;
  await db.delete(activationCodes).where(inArray(activationCodes.id, uniqueIds));
}

export async function renewActivationCode(id: number, days: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.select().from(activationCodes).where(eq(activationCodes.id, id)).limit(1);
  if (result.length === 0) return;
  
  const ac = result[0];
  const currentExpiresAt = ac.expiresAt || new Date();
  const newExpiresAt = new Date(currentExpiresAt.getTime() + days * 24 * 60 * 60 * 1000);
  
  await db.update(activationCodes).set({ 
    expiresAt: newExpiresAt,
    durationDays: ac.durationDays + days 
  }).where(eq(activationCodes.id, id));
}

/**
 * 用于纠正历史上以默认 365 天写入的授权码。若已激活，则以首次激活时间
 * 为基准重算到期日，避免只改展示、实际授权仍为年卡。
 */
export async function correctActivationCodeDuration(id: number, durationDays: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.select().from(activationCodes).where(eq(activationCodes.id, id)).limit(1);
  if (result.length === 0) return undefined;

  const code = result[0];
  const expiresAt = code.activatedAt
    ? new Date(code.activatedAt.getTime() + durationDays * 24 * 60 * 60 * 1000)
    : null;

  await db.update(activationCodes).set({ durationDays, expiresAt }).where(eq(activationCodes.id, id));
  return { ...code, durationDays, expiresAt };
}

export async function verifyActivationCode(code: string, machineId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.select().from(activationCodes).where(eq(activationCodes.code, code)).limit(1);
  if (result.length === 0) return { success: false, message: "激活码不存在" };
  
  const ac = result[0];
  if (ac.status === 'disabled') return { success: false, message: "激活码已被禁用" };
  
  if (ac.machineId && ac.machineId !== machineId) {
    return { success: false, message: "激活码已绑定到其他设备" };
  }

  // 检查是否过期
  if (ac.expiresAt && ac.expiresAt.getTime() < Date.now()) {
    return { success: false, message: "激活码已过期" };
  }
  
    if (!ac.machineId) {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + ac.durationDays * 24 * 60 * 60 * 1000);
      await db.update(activationCodes).set({ 
        machineId, 
        activatedAt: now,
        expiresAt: expiresAt
      }).where(eq(activationCodes.id, ac.id));
      
      // 发送 TG 通知；测试环境不触发外部副作用
      if (process.env.NODE_ENV !== "test") {
        const { sendTelegramMessage, TG_TEMPLATES } = await import("./telegram");
        await sendTelegramMessage(TG_TEMPLATES.licenseActivated(ac, machineId));
      }
      
      return { success: true, message: "激活成功", expiresAt: expiresAt.getTime() };
    }
  
  return { success: true, message: "验证通过", expiresAt: ac.expiresAt?.getTime() };
}

// Payment & Order Helpers
export async function getPaymentSettings() {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(paymentSettings).where(eq(paymentSettings.status, "active"));
}

export async function createOrder(data: any) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(orders).values(data);
  return result;
}

export async function getOrders() {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(orders).orderBy(desc(orders.createdAt));
}

export async function updateOrderStatus(id: number, status: any, activationCode?: string, errorReason?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db.update(orders)
    .set({ status, activationCode, errorReason, updatedAt: new Date() })
    .where(eq(orders.id, id));
}

export async function getPendingOrders() {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(orders).where(and(eq(orders.status, "pending"), isNotNull(orders.txHash)));
}

export async function claimPendingOrder(id: number) {
  const db = await getDb();
  if (!db) return false;
  const result: any = await db.update(orders)
    .set({ status: "paid", updatedAt: new Date(), errorReason: null })
    .where(and(eq(orders.id, id), eq(orders.status, "pending")));
  return Number(result?.affectedRows || 0) === 1;
}

export async function getOrderByTxHash(txHash: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(orders).where(eq(orders.txHash, txHash)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function upsertPaymentSetting(data: any) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (data.id) {
    return await db.update(paymentSettings)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(paymentSettings.id, data.id));
  } else {
    return await db.insert(paymentSettings).values(data);
  }
}

export async function deletePaymentSetting(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db.delete(paymentSettings).where(eq(paymentSettings.id, id));
}

export async function getActivationCodeByMachineId(machineId: string) {
  const db = await getDb();
  if (!db) return undefined;
  // 旧版客户端只提交机器码时，保留兼容查询；优先最近修改的有效授权。
  const result = await db
    .select()
    .from(activationCodes)
    .where(and(
      eq(activationCodes.machineId, machineId),
      eq(activationCodes.status, "active"),
    ))
    .orderBy(
      desc(activationCodes.updatedAt),
      desc(activationCodes.activatedAt),
      desc(activationCodes.id),
    )
    .limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function getActivationCodeByCodeForMachine(code: string, machineId: string) {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db
    .select()
    .from(activationCodes)
    .where(and(
      eq(activationCodes.code, code),
      eq(activationCodes.machineId, machineId),
    ))
    .limit(1);

  return result.length > 0 ? result[0] : undefined;
}

/**
 * 激活码本身是唯一键。订阅展示按唯一激活码读取，避免机器码差异
 * 导致已验证的授权无法取到，进而错误落入其他授权数据。
 */
export async function getActivationCodeByCode(code: string) {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db
    .select()
    .from(activationCodes)
    .where(eq(activationCodes.code, code))
    .limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function getTelegramSettings() {
  const db = await getDb();
  if (!db) return null;
  const results = await db.select().from(telegramSettings).limit(1);
  return results[0] || null;
}

export async function updateTelegramSettings(data: {
  botToken?: string;
  chatId?: string;
  isEnabled?: number;
}) {
  const db = await getDb();
  if (!db) return null;
  const existing = await getTelegramSettings();
  if (existing) {
    return db
      .update(telegramSettings)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(telegramSettings.id, existing.id));
  } else {
    return db.insert(telegramSettings).values({
      botToken: data.botToken || "",
      chatId: data.chatId || "",
      isEnabled: data.isEnabled ?? 0,
    });
  }
}
