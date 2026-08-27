import { drizzle } from "drizzle-orm/mysql2";
import { mysqlEnum, mysqlTable, text, timestamp, varchar, int } from "drizzle-orm/mysql-core";
import dotenv from "dotenv";

dotenv.config();

// 重新定义 admins 表以避免导入 ESM/TS 冲突
const admins = mysqlTable("admins", {
  id: int("id").autoincrement().primaryKey(),
  username: varchar("username", { length: 64 }).notNull().unique(),
  passwordHash: varchar("passwordHash", { length: 255 }).notNull(),
  role: mysqlEnum("role", ["super", "sub"]).default("sub").notNull(),
  permissions: text("permissions"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set");
    return;
  }

  const db = drizzle(process.env.DATABASE_URL);
  
  console.log("Seeding super admin...");
  
  try {
    await db.insert(admins).values({
      username: "wudideji001",
      passwordHash: "admin001",
      role: "super",
      permissions: JSON.stringify(["generate", "delete", "renew", "manage_admins"])
    }).onDuplicateKeyUpdate({
      set: {
        passwordHash: "admin001",
        role: "super",
        permissions: JSON.stringify(["generate", "delete", "renew", "manage_admins"])
      }
    });
    
    console.log("Super admin 'wudideji001' created/updated successfully.");
  } catch (error) {
    console.error("Failed to seed admin:", error);
  }
  
  process.exit(0);
}

main();
