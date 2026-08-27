import { eq, desc, and, like, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, activationCodes, InsertActivationCode } from "../drizzle/schema";
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
  
  if (!ac.machineId) {
    await db.update(activationCodes).set({ 
      machineId, 
      activatedAt: new Date() 
    }).where(eq(activationCodes.id, ac.id));
  }
  
  return { success: true, message: "激活成功" };
}
