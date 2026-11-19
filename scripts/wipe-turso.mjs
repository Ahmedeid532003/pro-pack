/**
 * Wipes all row data on Turso and reseeds a clean baseline (admin + warehouses + cash).
 * Usage: node scripts/wipe-turso.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import bcrypt from 'bcryptjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = join(root, '.env.turso');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url || !authToken) {
  console.error('Missing TURSO_DATABASE_URL / TURSO_AUTH_TOKEN');
  process.exit(1);
}

const turso = createClient({
  url,
  authToken,
  fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(120_000) }),
});

const tables = (
  await turso.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_litestream%' AND name NOT LIKE 'libsql_%' AND name NOT LIKE '_prisma_%'",
  )
).rows.map((r) => String(r.name));

// Turso يفرض FK دائمًا — نمسح على دورات لحد ما تفضى كل الجداول
let pending = [...tables];
for (let round = 1; round <= 80 && pending.length; round++) {
  const still = [];
  for (const t of pending) {
    try {
      await turso.execute({ sql: `DELETE FROM "${t}"`, args: [] });
    } catch {
      still.push(t);
    }
  }
  if (still.length === pending.length) {
    console.error('Could not clear tables (FK deadlock):', still.join(', '));
    process.exit(1);
  }
  pending = still;
  if (pending.length) console.log(`round ${round}: ${pending.length} tables left`);
}
console.log(`Cleared ${tables.length} tables`);

const passwordHash = await bcrypt.hash('admin123', 10);
const now = new Date().toISOString();
const id = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

const userId = id();
const cashId = id();
const rawId = id();
const mfgId = id();
const whId = id();

await turso.batch(
  [
    {
      sql: `INSERT INTO "User" ("id","username","passwordHash","fullName","role","isActive","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?)`,
      args: [userId, 'admin', passwordHash, 'مدير النظام', 'ADMIN', 1, now, now],
    },
    {
      sql: `INSERT INTO "Setting" ("id","key","value") VALUES (?,?,?)`,
      args: [id(), 'companyName', 'Pro Pack'],
    },
    {
      sql: `INSERT INTO "Warehouse" ("id","code","name","kind","description","isActive","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?)`,
      args: [rawId, 'RAW', 'مخزن خام', 'RAW', 'مواد مشتراة / خام للتصنيع', 1, now, now],
    },
    {
      sql: `INSERT INTO "Warehouse" ("id","code","name","kind","description","isActive","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?)`,
      args: [mfgId, 'MFG', 'مخزن تصنيع', 'MANUFACTURING', 'منتجات مصنّعة جاهزة', 1, now, now],
    },
    {
      sql: `INSERT INTO "Warehouse" ("id","code","name","kind","location","description","isActive","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?)`,
      args: [whId, 'WH01', 'المخزن الرئيسي', 'GENERAL', 'القاهرة', 'المخزن الافتراضي', 1, now, now],
    },
    {
      sql: `INSERT INTO "CashAccount" ("id","code","name","accountType","balance","isActive","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?)`,
      args: [cashId, 'CASH01', 'الخزنة الرئيسية', 'CASH', 0, 1, now, now],
    },
    {
      sql: `INSERT INTO "CashAccount" ("id","code","name","accountType","balance","isActive","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?)`,
      args: [id(), 'EXP01', 'خزنة مصروفات', 'CASH', 0, 1, now, now],
    },
    {
      sql: `INSERT INTO "Customer" ("id","code","name","notes","balance","creditLimit","priceList","isActive","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?)`,
      args: [id(), 'WALKIN', 'عميل سريع', 'عميل نقدي يشتري مرة ويمشي', 0, 0, 'RETAIL', 1, now, now],
    },
  ],
  'write',
);

const counts = {};
for (const t of tables) {
  counts[t] = Number((await turso.execute(`SELECT COUNT(*) AS n FROM "${t}"`)).rows[0].n);
}
const nonempty = Object.entries(counts).filter(([, n]) => n > 0);
console.log('Reseeded:', nonempty.map(([t, n]) => `${t}=${n}`).join(', '));
console.log('Login: admin / admin123');
