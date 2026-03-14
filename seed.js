import fs from 'fs-extra';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import pool from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.join(__dirname, 'data');

function createPasswordHash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'user',
      avatar TEXT NOT NULL DEFAULT '',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      bio TEXT NOT NULL DEFAULT '',
      status_text TEXT NOT NULL DEFAULT '',
      avatar_ring_color TEXT NOT NULL DEFAULT '#1cff8a',
      disable_at TIMESTAMPTZ NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'عام',
      image TEXT NOT NULL,
      steam_username TEXT NOT NULL,
      steam_password TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS rules (
      id SERIAL PRIMARY KEY,
      content TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS logs (
      id TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      action TEXT NOT NULL,
      actor_email TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      description TEXT NOT NULL
    );
  `);
}

async function seedDefaults() {
  const now = new Date().toISOString();
  const adminPasswordHash = createPasswordHash('Admin@12345');
  const userPasswordHash = createPasswordHash('User@12345');

  await pool.query('DELETE FROM logs');
  await pool.query('DELETE FROM rules');
  await pool.query('DELETE FROM cards');
  await pool.query('DELETE FROM users');

  await pool.query(
    `INSERT INTO users
      (id, name, email, role, avatar, is_active, bio, status_text, avatar_ring_color, disable_at, password_hash, created_at)
     VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12),
      ($13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
    [
      'admin_1', 'Green Master', 'admin@vault.local', 'admin', '', true, '', '', '#1cff8a', null, adminPasswordHash, now,
      'user_1', 'Ali User', 'ali@example.com', 'user', '', true, '', '', '#1cff8a', null, userPasswordHash, now
    ]
  );

  await pool.query(
    `INSERT INTO cards
      (id, title, category, image, steam_username, steam_password, notes, created_at, updated_at)
     VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9),
      ($10,$11,$12,$13,$14,$15,$16,$17,$18),
      ($19,$20,$21,$22,$23,$24,$25,$26,$27)`,
    [
      'card_fc25', 'EA SPORTS FC 25', 'رياضة', 'https://images.unsplash.com/photo-1542751371-adc38448a05e?q=80&w=1400&auto=format&fit=crop', 'fc25_private_01', 'FC25-Private-01', 'استخدم الحساب بشكل شخصي فقط.', now, now,
      'card_rdr2', 'Red Dead Redemption 2', 'عالم مفتوح', 'https://images.unsplash.com/photo-1511512578047-dfb367046420?q=80&w=1400&auto=format&fit=crop', 'rdr2_vault_09', 'RDR2-Vault-09', 'لا تشارك الحساب مع أي شخص.', now, now,
      'card_cp', 'Cyberpunk 2077', 'أكشن', 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?q=80&w=1400&auto=format&fit=crop', 'cyber_green_77', 'Cyber-Green-77', 'أي مخالفة قد تؤدي لإيقاف الوصول.', now, now
    ]
  );

  const rules = [
    'يمنع مشاركة الحسابات مع أي شخص آخر.',
    'الحسابات للاستخدام الشخصي فقط.',
    'يمنع إعادة نشر بيانات الحساب خارج الموقع.',
    'أي مخالفة تؤدي إلى إيقاف الوصول بشكل كامل.'
  ];

  for (const [index, rule] of rules.entries()) {
    await pool.query('INSERT INTO rules (content, sort_order) VALUES ($1, $2)', [rule, index + 1]);
  }

  await fs.ensureDir(dataDir);
  console.log('Database seed complete.');
}

await ensureTables();
await seedDefaults();
await pool.end();
