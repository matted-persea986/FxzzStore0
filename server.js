import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import fs from 'fs-extra';
import path from 'path';
import crypto from 'crypto';
import { nanoid } from 'nanoid';
import { fileURLToPath } from 'url';
import pool from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const CARDS_FILE = path.join(DATA_DIR, 'cards.json');
const RULES_FILE = path.join(DATA_DIR, 'rules.json');
const LOGS_FILE = path.join(DATA_DIR, 'logs.json');

const activeSessions = new Map();
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const BLOCK_MS = 10 * 60 * 1000;

function ok(res, message, data = null, status = 200) {
  return res.status(status).json({ success: true, message, data });
}

function fail(res, message, status = 400, errors = null) {
  return res.status(status).json({ success: false, message, errors });
}

function normalizeEmail(email = '') {
  return String(email).trim().toLowerCase();
}

function cleanText(value = '') {
  return String(value).trim();
}

function parseOptionalDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function buildDisableAtFromRequest(body = {}, currentDisableAt = null) {
  const explicit = parseOptionalDate(body.disableAt);
  if (explicit) return explicit;

  const durationValue = Number(body.durationValue || 0);
  const durationUnit = cleanText(body.durationUnit || '');

  if (durationValue > 0) {
    const date = new Date();
    if (durationUnit === 'minute') date.setMinutes(date.getMinutes() + durationValue);
    else if (durationUnit === 'hour') date.setHours(date.getHours() + durationValue);
    else if (durationUnit === 'day') date.setDate(date.getDate() + durationValue);
    else if (durationUnit === 'month') date.setMonth(date.getMonth() + durationValue);
    else return currentDisableAt || null;
    return date.toISOString();
  }

  if (body.disableAt === '') return null;
  return currentDisableAt || null;
}

function createPasswordHash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash = '') {
  const [salt, originalHash] = String(storedHash).split(':');
  if (!salt || !originalHash) return false;
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(originalHash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function sanitizeUser(user) {
  const { passwordHash, ...safe } = user;
  return {
    ...safe,
    isActive: user.isActive !== false,
    avatar: user.avatar || '',
    bio: user.bio || '',
    statusText: user.statusText || '',
    avatarRingColor: user.avatarRingColor || '#1cff8a',
    disableAt: user.disableAt || null
  };
}

function mapUserRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    avatar: row.avatar || '',
    isActive: row.is_active !== false,
    bio: row.bio || '',
    statusText: row.status_text || '',
    avatarRingColor: row.avatar_ring_color || '#1cff8a',
    disableAt: row.disable_at ? new Date(row.disable_at).toISOString() : null,
    passwordHash: row.password_hash,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString()
  };
}

function mapCardRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    category: row.category || 'عام',
    image: row.image,
    steamUsername: row.steam_username,
    steamPassword: row.steam_password,
    notes: row.notes || '',
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString()
  };
}

function mapLogRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    action: row.action,
    actorEmail: row.actor_email,
    actorRole: row.actor_role,
    description: row.description
  };
}

async function readJsonIfExists(file, fallback = []) {
  try {
    const exists = await fs.pathExists(file);
    if (!exists) return fallback;
    const raw = await fs.readFile(file, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
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

async function importLegacyJsonIfNeeded() {
  await fs.ensureDir(DATA_DIR);

  const usersCount = Number((await pool.query('SELECT COUNT(*)::int AS count FROM users')).rows[0]?.count || 0);
  if (usersCount === 0) {
    const legacyUsers = await readJsonIfExists(USERS_FILE, []);
    for (const user of legacyUsers) {
      await pool.query(
        `INSERT INTO users
          (id, name, email, role, avatar, is_active, bio, status_text, avatar_ring_color, disable_at, password_hash, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (id) DO NOTHING`,
        [
          user.id || nanoid(),
          cleanText(user.name || 'بدون اسم'),
          normalizeEmail(user.email || ''),
          user.role === 'admin' ? 'admin' : 'user',
          cleanText(user.avatar || ''),
          user.isActive !== false,
          cleanText(user.bio || ''),
          cleanText(user.statusText || ''),
          cleanText(user.avatarRingColor || '#1cff8a'),
          parseOptionalDate(user.disableAt),
          cleanText(user.passwordHash || ''),
          parseOptionalDate(user.createdAt) || new Date().toISOString()
        ]
      );
    }
  }

  const cardsCount = Number((await pool.query('SELECT COUNT(*)::int AS count FROM cards')).rows[0]?.count || 0);
  if (cardsCount === 0) {
    const legacyCards = await readJsonIfExists(CARDS_FILE, []);
    for (const card of legacyCards) {
      await pool.query(
        `INSERT INTO cards
          (id, title, category, image, steam_username, steam_password, notes, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (id) DO NOTHING`,
        [
          card.id || nanoid(),
          cleanText(card.title || 'بدون عنوان'),
          cleanText(card.category || 'عام'),
          cleanText(card.image || ''),
          cleanText(card.steamUsername || ''),
          cleanText(card.steamPassword || ''),
          cleanText(card.notes || ''),
          parseOptionalDate(card.createdAt) || new Date().toISOString(),
          parseOptionalDate(card.updatedAt) || new Date().toISOString()
        ]
      );
    }
  }

  const rulesCount = Number((await pool.query('SELECT COUNT(*)::int AS count FROM rules')).rows[0]?.count || 0);
  if (rulesCount === 0) {
    const legacyRules = await readJsonIfExists(RULES_FILE, []);
    for (const [index, rule] of legacyRules.entries()) {
      await pool.query(
        'INSERT INTO rules (content, sort_order) VALUES ($1, $2)',
        [cleanText(rule), index + 1]
      );
    }
  }

  const logsCount = Number((await pool.query('SELECT COUNT(*)::int AS count FROM logs')).rows[0]?.count || 0);
  if (logsCount === 0) {
    const legacyLogs = await readJsonIfExists(LOGS_FILE, []);
    for (const log of legacyLogs) {
      await pool.query(
        `INSERT INTO logs (id, created_at, action, actor_email, actor_role, description)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (id) DO NOTHING`,
        [
          log.id || nanoid(),
          parseOptionalDate(log.createdAt) || new Date().toISOString(),
          cleanText(log.action || 'UNKNOWN'),
          cleanText(log.actorEmail || 'system'),
          cleanText(log.actorRole || 'system'),
          cleanText(log.description || '')
        ]
      );
    }
  }
}

async function initDatabase() {
  await ensureTables();
  await importLegacyJsonIfNeeded();
}

async function getAllUsers() {
  const result = await pool.query('SELECT * FROM users ORDER BY created_at ASC');
  return result.rows.map(mapUserRow);
}

async function getStoredUserById(userId) {
  const result = await pool.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [userId]);
  return mapUserRow(result.rows[0]);
}

async function getUserByEmail(email) {
  const result = await pool.query('SELECT * FROM users WHERE LOWER(email) = $1 LIMIT 1', [normalizeEmail(email)]);
  return mapUserRow(result.rows[0]);
}

async function saveUser(user) {
  await pool.query(
    `INSERT INTO users
      (id, name, email, role, avatar, is_active, bio, status_text, avatar_ring_color, disable_at, password_hash, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (id)
     DO UPDATE SET
       name = EXCLUDED.name,
       email = EXCLUDED.email,
       role = EXCLUDED.role,
       avatar = EXCLUDED.avatar,
       is_active = EXCLUDED.is_active,
       bio = EXCLUDED.bio,
       status_text = EXCLUDED.status_text,
       avatar_ring_color = EXCLUDED.avatar_ring_color,
       disable_at = EXCLUDED.disable_at,
       password_hash = EXCLUDED.password_hash,
       created_at = EXCLUDED.created_at`,
    [
      user.id,
      cleanText(user.name || ''),
      normalizeEmail(user.email || ''),
      user.role === 'admin' ? 'admin' : 'user',
      cleanText(user.avatar || ''),
      user.isActive !== false,
      cleanText(user.bio || ''),
      cleanText(user.statusText || ''),
      cleanText(user.avatarRingColor || '#1cff8a'),
      parseOptionalDate(user.disableAt),
      cleanText(user.passwordHash || ''),
      parseOptionalDate(user.createdAt) || new Date().toISOString()
    ]
  );
}

async function deleteUserById(userId) {
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
}

async function getAllCards() {
  const result = await pool.query('SELECT * FROM cards ORDER BY created_at DESC');
  return result.rows.map(mapCardRow);
}

async function getCardById(cardId) {
  const result = await pool.query('SELECT * FROM cards WHERE id = $1 LIMIT 1', [cardId]);
  return mapCardRow(result.rows[0]);
}

async function saveCard(card) {
  await pool.query(
    `INSERT INTO cards
      (id, title, category, image, steam_username, steam_password, notes, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (id)
     DO UPDATE SET
       title = EXCLUDED.title,
       category = EXCLUDED.category,
       image = EXCLUDED.image,
       steam_username = EXCLUDED.steam_username,
       steam_password = EXCLUDED.steam_password,
       notes = EXCLUDED.notes,
       created_at = EXCLUDED.created_at,
       updated_at = EXCLUDED.updated_at`,
    [
      card.id,
      cleanText(card.title || ''),
      cleanText(card.category || 'عام'),
      cleanText(card.image || ''),
      cleanText(card.steamUsername || ''),
      cleanText(card.steamPassword || ''),
      cleanText(card.notes || ''),
      parseOptionalDate(card.createdAt) || new Date().toISOString(),
      parseOptionalDate(card.updatedAt) || new Date().toISOString()
    ]
  );
}

async function deleteCardById(cardId) {
  await pool.query('DELETE FROM cards WHERE id = $1', [cardId]);
}

async function getRules() {
  const result = await pool.query('SELECT content FROM rules ORDER BY sort_order ASC, id ASC');
  return result.rows.map((row) => row.content);
}

async function replaceRules(rules) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM rules');
    for (const [index, rule] of rules.entries()) {
      await client.query('INSERT INTO rules (content, sort_order) VALUES ($1, $2)', [rule, index + 1]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function getLogs(limit = 300) {
  const result = await pool.query(
    'SELECT * FROM logs ORDER BY created_at DESC LIMIT $1',
    [Math.max(1, Number(limit) || 50)]
  );
  return result.rows.map(mapLogRow);
}

async function addLog(entry) {
  await pool.query(
    `INSERT INTO logs (id, created_at, action, actor_email, actor_role, description)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      nanoid(),
      new Date().toISOString(),
      cleanText(entry.action || 'UNKNOWN'),
      cleanText(entry.actorEmail || 'system'),
      cleanText(entry.actorRole || 'system'),
      cleanText(entry.description || '')
    ]
  );
}

function isScheduledDisabled(user) {
  if (!user?.disableAt || user.isActive === false) return false;
  const date = new Date(user.disableAt);
  if (Number.isNaN(date.getTime())) return false;
  return Date.now() >= date.getTime();
}

async function syncScheduledDeactivations() {
  const users = await getAllUsers();
  let changed = false;

  for (const user of users) {
    if (isScheduledDisabled(user)) {
      user.isActive = false;
      removeSessionsForUser(user);
      changed = true;
      await saveUser(user);
      await addLog({
        action: 'USER_AUTO_DISABLED',
        actorEmail: 'system',
        actorRole: 'system',
        description: `تم تعطيل الحساب تلقائيًا عند انتهاء المدة: ${user.email}`
      });
    }
  }

  return changed ? getAllUsers() : users;
}

function touchAttempt(ip) {
  const current = loginAttempts.get(ip) || { count: 0, blockedUntil: 0 };
  const now = Date.now();
  if (current.blockedUntil > now) {
    return current;
  }
  current.count += 1;
  if (current.count >= MAX_ATTEMPTS) {
    current.count = 0;
    current.blockedUntil = now + BLOCK_MS;
  }
  loginAttempts.set(ip, current);
  return current;
}

function clearAttempts(ip) {
  loginAttempts.delete(ip);
}

function getIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function parseUserAgent(userAgent = '') {
  const ua = String(userAgent).toLowerCase();

  const isMobile = /android|iphone|ipod|mobile/.test(ua);
  const isTablet = /ipad|tablet/.test(ua);
  const deviceType = isTablet ? 'Tablet' : (isMobile ? 'Mobile' : 'Desktop');

  let browser = 'Unknown';
  if (ua.includes('edg/')) browser = 'Edge';
  else if (ua.includes('opr/') || ua.includes('opera')) browser = 'Opera';
  else if (ua.includes('chrome/')) browser = 'Chrome';
  else if (ua.includes('firefox/')) browser = 'Firefox';
  else if (ua.includes('safari/') && !ua.includes('chrome/')) browser = 'Safari';

  let os = 'Unknown';
  if (ua.includes('windows')) os = 'Windows';
  else if (ua.includes('android')) os = 'Android';
  else if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ios')) os = 'iOS';
  else if (ua.includes('mac os') || ua.includes('macintosh')) os = 'macOS';
  else if (ua.includes('linux')) os = 'Linux';

  return {
    deviceType,
    browser,
    os,
    rawUserAgent: String(userAgent || ''),
    deviceLabel: `${deviceType} • ${browser} • ${os}`
  };
}

function removeSessionsForUser(user) {
  for (const [sessionId, sessionData] of activeSessions.entries()) {
    if (sessionData.userId === user.id || normalizeEmail(sessionData.email) === normalizeEmail(user.email)) {
      activeSessions.delete(sessionId);
    }
  }
}

async function ensureAuth(req, res, next) {
  if (!req.session?.user) {
    return fail(res, 'غير مصرح لك بالدخول', 401);
  }

  const storedUser = await getStoredUserById(req.session.user.id);
  if (!storedUser) {
    activeSessions.delete(req.sessionID);
    req.session.destroy(() => {});
    return fail(res, 'تم حذف هذا الحساب من النظام', 401);
  }

  if (storedUser.isActive === false) {
    activeSessions.delete(req.sessionID);
    req.session.user = sanitizeUser(storedUser);
    req.session.destroy(() => {});
    return fail(res, 'هذا الحساب معطل من الأدمن', 403);
  }

  req.session.user = sanitizeUser(storedUser);

  const sessionData = activeSessions.get(req.sessionID);
  if (sessionData) {
    sessionData.lastSeen = new Date().toISOString();
    sessionData.name = storedUser.name;
    sessionData.role = storedUser.role;
    activeSessions.set(req.sessionID, sessionData);
  }

  next();
}

async function ensureAdmin(req, res, next) {
  if (!req.session?.user) {
    return fail(res, 'غير مصرح لك بالدخول', 401);
  }
  const storedUser = await getStoredUserById(req.session.user.id);
  if (!storedUser) {
    activeSessions.delete(req.sessionID);
    req.session.destroy(() => {});
    return fail(res, 'تم حذف هذا الحساب من النظام', 401);
  }
  if (storedUser.isActive === false) {
    activeSessions.delete(req.sessionID);
    req.session.destroy(() => {});
    return fail(res, 'هذا الحساب معطل من الأدمن', 403);
  }
  req.session.user = sanitizeUser(storedUser);
  if (storedUser.role !== 'admin') {
    return fail(res, 'هذه الصفحة خاصة بالأدمن فقط', 403);
  }
  next();
}

function buildStats(sessions, users = []) {
  const grouped = sessions.reduce((acc, item) => {
    acc[item.email] = acc[item.email] || [];
    acc[item.email].push(item);
    return acc;
  }, {});

  const duplicateAccounts = Object.entries(grouped)
    .filter(([, list]) => list.length > 1)
    .map(([email, list]) => ({ email, count: list.length }));

  const allAccountsOverview = users.map((user) => {
    const userSessions = grouped[user.email] || [];
    const uniqueIps = [...new Set(userSessions.map((item) => item.ip).filter(Boolean))];
    const uniqueDevices = [...new Set(userSessions.map((item) => item.deviceLabel).filter(Boolean))];

    return {
      userId: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
      avatar: user.avatar || '',
      statusText: user.statusText || '',
      avatarRingColor: user.avatarRingColor || '#1cff8a',
      disableAt: user.disableAt || null,
      isActive: user.isActive !== false,
      onlineNow: userSessions.length > 0,
      connectedDevicesCount: userSessions.length,
      uniqueIpsCount: uniqueIps.length,
      uniqueDevicesCount: uniqueDevices.length,
      ips: uniqueIps,
      devices: uniqueDevices,
      sessions: userSessions
    };
  });

  return {
    connectedNow: sessions.length,
    duplicateLoginCount: duplicateAccounts.length,
    duplicateAccounts,
    activeSessions: sessions,
    allAccountsOverview
  };
}

app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));
app.use(session({
  name: 'steam_vault_sid',
  secret: process.env.SESSION_SECRET || 'steam-vault-green-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 12,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
  }
}));

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    return ok(res, 'الخادم يعمل بشكل ممتاز', { time: new Date().toISOString(), database: 'connected' });
  } catch {
    return fail(res, 'تعذر الوصول إلى قاعدة البيانات', 500);
  }
});

app.post('/api/auth/login', async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const password = cleanText(req.body.password);

  if (!email || !password) {
    return fail(res, 'البريد الإلكتروني وكلمة المرور مطلوبان', 422);
  }

  const ip = getIp(req);
  const attemptState = loginAttempts.get(ip);
  if (attemptState && attemptState.blockedUntil > Date.now()) {
    const remainingMinutes = Math.ceil((attemptState.blockedUntil - Date.now()) / 60000);
    return fail(res, `تم حظر المحاولات مؤقتًا. حاول بعد ${remainingMinutes} دقيقة`, 429);
  }

  await syncScheduledDeactivations();
  const user = await getUserByEmail(email);

  if (!user) {
    touchAttempt(ip);
    return fail(res, 'بيانات الدخول غير صحيحة', 401);
  }

  const valid = verifyPassword(password, user.passwordHash);
  if (!valid) {
    touchAttempt(ip);
    return fail(res, 'بيانات الدخول غير صحيحة', 401);
  }

  if (user.isActive === false) {
    return fail(res, 'هذا الحساب معطل من الأدمن', 403);
  }

  clearAttempts(ip);
  req.session.user = sanitizeUser(user);
  const deviceInfo = parseUserAgent(req.headers['user-agent']);
  const ipAddress = getIp(req);

  activeSessions.set(req.sessionID, {
    sessionId: req.sessionID,
    userId: user.id,
    email: user.email,
    role: user.role,
    ip: ipAddress,
    deviceType: deviceInfo.deviceType,
    browser: deviceInfo.browser,
    os: deviceInfo.os,
    deviceLabel: deviceInfo.deviceLabel,
    rawUserAgent: deviceInfo.rawUserAgent,
    loginAt: new Date().toISOString(),
    lastSeen: new Date().toISOString()
  });

  await addLog({
    action: 'LOGIN_SUCCESS',
    actorEmail: user.email,
    actorRole: user.role,
    description: `تم تسجيل الدخول بنجاح من ${ipAddress} باستخدام ${deviceInfo.deviceLabel}`
  });

  return ok(res, 'تم تسجيل الدخول بنجاح', { user: sanitizeUser(user) });
});

app.post('/api/auth/logout', ensureAuth, async (req, res) => {
  const currentUser = req.session.user;
  activeSessions.delete(req.sessionID);
  await addLog({
    action: 'LOGOUT',
    actorEmail: currentUser.email,
    actorRole: currentUser.role,
    description: 'تم تسجيل الخروج'
  });

  req.session.destroy(() => {
    res.clearCookie('steam_vault_sid');
    ok(res, 'تم تسجيل الخروج');
  });
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session?.user) {
    return fail(res, 'غير مسجل الدخول', 401);
  }
  return ok(res, 'تم جلب بيانات المستخدم', { user: req.session.user });
});

app.put('/api/profile', ensureAuth, async (req, res) => {
  const current = await getStoredUserById(req.session.user.id);
  if (!current) return fail(res, 'المستخدم غير موجود', 404);

  const name = cleanText(req.body.name || current.name);
  const avatar = cleanText(req.body.avatar || current.avatar || '');

  if (!name) return fail(res, 'الاسم مطلوب', 422);

  current.name = name;
  current.avatar = avatar;
  await saveUser(current);

  req.session.user = sanitizeUser(current);

  await addLog({
    action: 'PROFILE_UPDATED',
    actorEmail: current.email,
    actorRole: current.role,
    description: 'تم تحديث الملف الشخصي'
  });

  return ok(res, 'تم تحديث الملف الشخصي', { user: sanitizeUser(current) });
});

app.get('/api/cards', ensureAuth, async (req, res) => {
  const cards = await getAllCards();
  return ok(res, 'تم جلب بطاقات Steam', { cards });
});

app.get('/api/rules', ensureAuth, async (req, res) => {
  const rules = await getRules();
  return ok(res, 'تم جلب القوانين', { rules });
});

app.put('/api/rules', ensureAdmin, async (req, res) => {
  const rules = Array.isArray(req.body.rules) ? req.body.rules.map(cleanText).filter(Boolean) : null;
  if (!rules) return fail(res, 'البيانات المرسلة غير صحيحة', 422);
  await replaceRules(rules);
  await addLog({
    action: 'RULES_UPDATED',
    actorEmail: req.session.user.email,
    actorRole: req.session.user.role,
    description: `تم تحديث القوانين وعددها ${rules.length}`
  });
  return ok(res, 'تم تحديث القوانين', { rules });
});

app.get('/api/admin/stats', ensureAdmin, async (req, res) => {
  const users = await syncScheduledDeactivations();
  const cards = await getAllCards();
  const logs = await getLogs(50);
  const stats = buildStats(Array.from(activeSessions.values()), users);
  return ok(res, 'تم جلب الإحصائيات', {
    totalUsers: users.length,
    totalCards: cards.length,
    recentLogs: logs.slice(0, 15),
    ...stats
  });
});

app.get('/api/admin/users', ensureAdmin, async (req, res) => {
  const users = await syncScheduledDeactivations();
  return ok(res, 'تم جلب المستخدمين', { users: users.map(sanitizeUser) });
});

app.post('/api/admin/users', ensureAdmin, async (req, res) => {
  const name = cleanText(req.body.name);
  const email = normalizeEmail(req.body.email);
  const password = cleanText(req.body.password);
  const role = req.body.role === 'admin' ? 'admin' : 'user';
  const avatar = cleanText(req.body.avatar || '');
  const bio = cleanText(req.body.bio || '');
  const statusText = cleanText(req.body.statusText || '');
  const avatarRingColor = cleanText(req.body.avatarRingColor || '#1cff8a');
  const disableAt = buildDisableAtFromRequest(req.body);

  if (!name || !email || !password) {
    return fail(res, 'الاسم والبريد وكلمة المرور مطلوبة', 422);
  }
  if (password.length < 6) {
    return fail(res, 'كلمة المرور يجب أن تكون 6 أحرف أو أكثر', 422);
  }

  const existingUser = await getUserByEmail(email);
  if (existingUser) {
    return fail(res, 'هذا البريد موجود مسبقًا', 409);
  }

  const passwordHash = createPasswordHash(password);
  const newUser = {
    id: nanoid(),
    name,
    email,
    role,
    avatar,
    bio,
    statusText,
    avatarRingColor: avatarRingColor.startsWith('#') ? avatarRingColor : '#1cff8a',
    disableAt,
    isActive: req.body.isActive === 'false' || req.body.isActive === false ? false : true,
    passwordHash,
    createdAt: new Date().toISOString()
  };

  await saveUser(newUser);
  await addLog({
    action: 'USER_CREATED',
    actorEmail: req.session.user.email,
    actorRole: req.session.user.role,
    description: `تم إنشاء مستخدم جديد: ${email}`
  });
  return ok(res, 'تمت إضافة المستخدم', { user: sanitizeUser(newUser) }, 201);
});

app.put('/api/admin/users/:id', ensureAdmin, async (req, res) => {
  const current = await getStoredUserById(req.params.id);
  if (!current) return fail(res, 'المستخدم غير موجود', 404);

  const name = cleanText(req.body.name || current.name);
  const email = normalizeEmail(req.body.email || current.email);
  const role = req.body.role === 'admin' ? 'admin' : (req.body.role === 'user' ? 'user' : current.role);
  const password = cleanText(req.body.password || '');
  const avatar = cleanText(req.body.avatar || current.avatar || '');
  const bio = cleanText(req.body.bio || current.bio || '');
  const statusText = cleanText(req.body.statusText || current.statusText || '');
  const avatarRingColor = cleanText(req.body.avatarRingColor || current.avatarRingColor || '#1cff8a');
  const disableAt = buildDisableAtFromRequest(req.body, current.disableAt || null);

  const sameEmailUser = await getUserByEmail(email);
  if (sameEmailUser && sameEmailUser.id !== current.id) {
    return fail(res, 'البريد مستخدم لحساب آخر', 409);
  }

  current.name = name;
  current.email = email;
  current.role = role;
  current.avatar = avatar;
  current.bio = bio;
  current.statusText = statusText;
  current.avatarRingColor = avatarRingColor.startsWith('#') ? avatarRingColor : '#1cff8a';
  current.disableAt = disableAt;

  if (req.body.isActive !== undefined) {
    current.isActive = !(req.body.isActive === false || req.body.isActive === 'false');
  }

  if (password) {
    if (password.length < 6) return fail(res, 'كلمة المرور قصيرة جدًا', 422);
    current.passwordHash = createPasswordHash(password);
  }

  await saveUser(current);

  if (current.isActive === false) {
    removeSessionsForUser(current);
  }

  await addLog({
    action: 'USER_UPDATED',
    actorEmail: req.session.user.email,
    actorRole: req.session.user.role,
    description: `تم تحديث المستخدم: ${email}`
  });
  return ok(res, 'تم تحديث المستخدم', { user: sanitizeUser(current) });
});

app.patch('/api/admin/users/:id/status', ensureAdmin, async (req, res) => {
  const target = await getStoredUserById(req.params.id);
  if (!target) return fail(res, 'المستخدم غير موجود', 404);

  target.isActive = req.body.isActive === false || req.body.isActive === 'false' ? false : true;
  target.disableAt = buildDisableAtFromRequest(req.body, target.disableAt || null);
  await saveUser(target);

  if (target.isActive === false) {
    removeSessionsForUser(target);
  }

  await addLog({
    action: target.isActive ? 'USER_ENABLED' : 'USER_DISABLED',
    actorEmail: req.session.user.email,
    actorRole: req.session.user.role,
    description: `${target.isActive ? 'تم تفعيل' : 'تم تعطيل'} المستخدم: ${target.email}`
  });

  return ok(res, target.isActive ? 'تم تفعيل الحساب' : 'تم تعطيل الحساب', { user: sanitizeUser(target) });
});

app.delete('/api/admin/users/:id', ensureAdmin, async (req, res) => {
  const target = await getStoredUserById(req.params.id);
  if (!target) return fail(res, 'المستخدم غير موجود', 404);
  await deleteUserById(req.params.id);
  removeSessionsForUser(target);
  await addLog({
    action: 'USER_DELETED',
    actorEmail: req.session.user.email,
    actorRole: req.session.user.role,
    description: `تم حذف المستخدم وإخراجه من أي جلسات نشطة: ${target.email}`
  });
  return ok(res, 'تم حذف المستخدم');
});

app.get('/api/admin/cards', ensureAdmin, async (req, res) => {
  const cards = await getAllCards();
  return ok(res, 'تم جلب البطاقات', { cards });
});

app.post('/api/admin/cards', ensureAdmin, async (req, res) => {
  const title = cleanText(req.body.title);
  const category = cleanText(req.body.category || 'عام');
  const image = cleanText(req.body.image);
  const steamUsername = cleanText(req.body.steamUsername);
  const steamPassword = cleanText(req.body.steamPassword);
  const notes = cleanText(req.body.notes || '');

  if (!title || !image || !steamUsername || !steamPassword) {
    return fail(res, 'كل بيانات البطاقة الأساسية مطلوبة', 422);
  }

  const newCard = {
    id: nanoid(),
    title,
    category,
    image,
    steamUsername,
    steamPassword,
    notes,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  await saveCard(newCard);
  await addLog({
    action: 'CARD_CREATED',
    actorEmail: req.session.user.email,
    actorRole: req.session.user.role,
    description: `تم إنشاء بطاقة: ${title}`
  });
  return ok(res, 'تمت إضافة البطاقة', { card: newCard }, 201);
});

app.put('/api/admin/cards/:id', ensureAdmin, async (req, res) => {
  const current = await getCardById(req.params.id);
  if (!current) return fail(res, 'البطاقة غير موجودة', 404);

  current.title = cleanText(req.body.title || current.title);
  current.category = cleanText(req.body.category || current.category);
  current.image = cleanText(req.body.image || current.image);
  current.steamUsername = cleanText(req.body.steamUsername || current.steamUsername);
  current.steamPassword = cleanText(req.body.steamPassword || current.steamPassword);
  current.notes = cleanText(req.body.notes || current.notes || '');
  current.updatedAt = new Date().toISOString();

  await saveCard(current);
  await addLog({
    action: 'CARD_UPDATED',
    actorEmail: req.session.user.email,
    actorRole: req.session.user.role,
    description: `تم تحديث بطاقة: ${current.title}`
  });
  return ok(res, 'تم تحديث البطاقة', { card: current });
});

app.delete('/api/admin/cards/:id', ensureAdmin, async (req, res) => {
  const target = await getCardById(req.params.id);
  if (!target) return fail(res, 'البطاقة غير موجودة', 404);
  await deleteCardById(req.params.id);
  await addLog({
    action: 'CARD_DELETED',
    actorEmail: req.session.user.email,
    actorRole: req.session.user.role,
    description: `تم حذف بطاقة: ${target.title}`
  });
  return ok(res, 'تم حذف البطاقة');
});

app.get('/api/admin/logs', ensureAdmin, async (req, res) => {
  const logs = await getLogs(50);
  return ok(res, 'تم جلب السجلات', { logs });
});

app.get('*', (req, res) => {
  const file = req.path === '/' ? 'index.html' : req.path.replace(/^\//, '');
  const full = path.join(__dirname, 'public', file);
  if (fs.existsSync(full) && fs.statSync(full).isFile()) {
    return res.sendFile(full);
  }
  return res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

await initDatabase();
setInterval(() => {
  syncScheduledDeactivations().catch((error) => {
    console.error('Scheduled deactivation sync failed:', error.message);
  });
}, 30000);

app.listen(PORT, () => {
  console.log(`Steam Vault Green running on http://localhost:${PORT}`);
});
