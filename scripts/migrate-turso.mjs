// Additive schema sync for Turso (or a local SQLite file): creates missing tables/indexes and
// adds missing columns. Never drops or rewrites existing tables, so live data stays intact.
// Usage: node scripts/migrate-turso.mjs [--dry-run] [--local]
//   --local    target apps/api/prisma/dev.db instead of TURSO_DATABASE_URL
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { createClient } from '@libsql/client';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dryRun = process.argv.includes('--dry-run');
const local = process.argv.includes('--local');

const envFile = join(root, '.env.turso');
if (!local && existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}

let db;
if (local) {
  const file = join(root, 'apps', 'api', 'prisma', 'dev.db');
  db = createClient({ url: `file:${file.replace(/\\/g, '/')}` });
} else {
  if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
    console.error('Missing TURSO_DATABASE_URL / TURSO_AUTH_TOKEN (.env.turso)');
    process.exit(1);
  }
  db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
}

const schemaPath = join(root, 'apps', 'api', 'prisma', 'schema.prisma');
const fullSql = execSync(
  `npx prisma migrate diff --from-empty --to-schema-datamodel "${schemaPath}" --script`,
  { cwd: root, encoding: 'utf8', env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL || 'file:./dev.db' } },
);

const statements = fullSql
  .split(/;\s*\r?\n/)
  .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
  .filter(Boolean);

const tableRows = (await db.execute(
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'libsql_%' AND name NOT LIKE '_litestream%'",
)).rows;
const existingTables = new Set(tableRows.map((r) => String(r.name)));

const plan = [];
const createdTables = new Set();
const addedColumns = new Set();

for (const stmt of statements) {
  const createTable = stmt.match(/^CREATE TABLE "([^"]+)"\s*\(([\s\S]*)\)$/);
  if (createTable) {
    const [, table, body] = createTable;
    if (!existingTables.has(table)) {
      plan.push(stmt);
      createdTables.add(table);
      continue;
    }
    const info = (await db.execute(`PRAGMA table_info("${table}")`)).rows;
    const have = new Set(info.map((r) => String(r.name)));
    for (const rawLine of body.split(/\r?\n/)) {
      const line = rawLine.trim().replace(/,$/, '');
      const col = line.match(/^"([^"]+)"\s+(.+)$/);
      if (!col || have.has(col[1])) continue;
      if (/PRIMARY KEY|CURRENT_TIMESTAMP/i.test(col[2])) {
        throw new Error(`Cannot add column ${table}.${col[1]} additively: ${line}`);
      }
      if (/NOT NULL/i.test(col[2]) && !/DEFAULT/i.test(col[2])) {
        throw new Error(`Column ${table}.${col[1]} is NOT NULL without default: ${line}`);
      }
      plan.push(`ALTER TABLE "${table}" ADD COLUMN ${line}`);
      addedColumns.add(`${table}.${col[1]}`);
    }
    continue;
  }
  if (/^CREATE (UNIQUE )?INDEX "/.test(stmt)) {
    plan.push(stmt.replace(/^CREATE (UNIQUE )?INDEX "/, (_, u) => `CREATE ${u || ''}INDEX IF NOT EXISTS "`));
    continue;
  }
  if (/^PRAGMA /i.test(stmt)) continue;
  console.warn('Skipping unrecognised statement:', stmt.slice(0, 80));
}

if (createdTables.has('CustomerProdOrderLine') && existingTables.has('CustomerProdOrder')) {
  plan.push(`INSERT INTO "CustomerProdOrderLine" ("id","orderId","productId","description","quantity","unitPrice","sortOrder")
    SELECT 'pl' || "id", "id", "productId", "description", "quantity", "unitPrice", 0 FROM "CustomerProdOrder"`);
}
if (addedColumns.has('HrAttendance.overtimeApproved')) {
  plan.push(`UPDATE "HrAttendance" SET "overtimeApproved" = 1 WHERE "overtimeMinutes" > 0`);
}

const schemaChanges = plan.length;
console.log(`Target: ${local ? 'local dev.db' : process.env.TURSO_DATABASE_URL}`);
console.log(`New tables: ${[...createdTables].join(', ') || 'none'}`);
console.log(`New columns: ${[...addedColumns].join(', ') || 'none'}`);

if (dryRun) {
  console.log(plan.filter((s) => !/IF NOT EXISTS/.test(s)).join(';\n'));
  process.exit(0);
}

for (const stmt of plan) await db.execute(stmt);

const hrRow = existingTables.has('Setting')
  ? (await db.execute({ sql: 'SELECT "value" FROM "Setting" WHERE "key" = ?', args: ['hr.settings'] })).rows[0]
  : undefined;
if (hrRow) {
  const settings = JSON.parse(String(hrRow.value));
  let changed = false;
  if (!settings.hoursPerDay || Number(settings.hoursPerDay) === 8) { settings.hoursPerDay = 10; changed = true; }
  if (Number(settings.absenceMultiplier) !== 2) { settings.absenceMultiplier = 2; changed = true; }
  if (changed) {
    await db.execute({ sql: 'UPDATE "Setting" SET "value" = ? WHERE "key" = ?', args: [JSON.stringify(settings), 'hr.settings'] });
    console.log('Updated hr.settings: hoursPerDay=10, absenceMultiplier=2');
  }
}

console.log(`Done: ${schemaChanges} statements applied`);
