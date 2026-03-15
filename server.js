import express from 'express';
import session from 'express-session';
import fs from 'fs-extra';
import path from 'path';
import crypto from 'crypto';
import { nanoid } from 'nanoid';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const CARDS_FILE = path.join(DATA_DIR, 'cards.json');
const RULES_FILE = path.join(DATA_DIR, 'rules.json');
const LOGS_FILE = path.join(DATA_DIR, 'logs.json');

const activeSessions = new Map();
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const BLOCK_MS = 10 * 60 * 1000;

await fs.ensureDir(DATA_DIR);
setInterval(() => {
  syncScheduledDeactivations().catch(() => {});
}, 30000);

async function readJson(file, fallback = []) {
  await fs.ensureFile(file);
  const raw = await fs.readFile(file, 'utf8');
  if (!raw.trim()) {
    await fs.writeJson(file, fallback, { spaces: 2 });
    return fallback;
  }
  try {
    return JSON.parse(raw);
  } catch {
    await fs.writeJson(file, fallback, { spaces: 2 });
    return fallback;
  }
}

async function writeJson(file, data) {
  await fs.writeJson(file, data, { spaces: 2 });
}

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

function clampText(value = '', max = 500) {
  return cleanText(value).slice(0, max);
}

function isValidEmail(email = '') {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email));
}

function isSafeHttpUrl(value = '') {
  try {
    const url = new URL(String(value));
    return ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
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

function isScheduledDisabled(user) {
  if (!user?.disableAt || user.isActive === false) return false;
  const date = new Date(user.disableAt);
  if (Number.isNaN(date.getTime())) return false;
  return Date.now() >= date.getTime();
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

async function addLog(entry) {
  const logs = await readJson(LOGS_FILE, []);
  logs.unshift({
    id: nanoid(),
    createdAt: new Date().toISOString(),
    ...entry
  });
  await writeJson(LOGS_FILE, logs.slice(0, 300));
}

async function syncScheduledDeactivations() {
  const users = await readJson(USERS_FILE, []);
  let changed = false;

  for (const user of users) {
    if (isScheduledDisabled(user)) {
      user.isActive = false;
      removeSessionsForUser(user);
      changed = true;
      await addLog({
        action: 'USER_AUTO_DISABLED',
        actorEmail: 'system',
        actorRole: 'system',
        description: `تم تعطيل الحساب تلقائيًا عند انتهاء المدة: ${user.email}`
      });
    }
  }

  if (changed) {
    await writeJson(USERS_FILE, users);
  }

  return users;
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

async function getStoredUserById(userId) {
  const users = await syncScheduledDeactivations();
  return users.find((item) => item.id === userId) || null;
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

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'"
  );
  next();
});

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
    secure: IS_PROD
  }
}));

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => ok(res, 'الخادم يعمل بشكل ممتاز', { time: new Date().toISOString() }));

app.post('/api/auth/login', async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const password = cleanText(req.body.password);

  if (!email || !password) {
    return fail(res, 'البريد الإلكتروني وكلمة المرور مطلوبان', 422);
  }

  if (!isValidEmail(email)) {
    return fail(res, 'صيغة البريد الإلكتروني غير صحيحة', 422);
  }

  const ip = getIp(req);
  const attemptState = loginAttempts.get(ip);
  if (attemptState && attemptState.blockedUntil > Date.now()) {
    const remainingMinutes = Math.ceil((attemptState.blockedUntil - Date.now()) / 60000);
    return fail(res, `تم حظر المحاولات مؤقتًا. حاول بعد ${remainingMinutes} دقيقة`, 429);
  }

  const users = await syncScheduledDeactivations();
  const user = users.find((item) => normalizeEmail(item.email) === email);

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
  await new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) return reject(error);
      resolve();
    });
  }).catch(() => null);
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

app.get('/api/auth/me', ensureAuth, (req, res) => {
  return ok(res, 'تم جلب بيانات المستخدم', { user: req.session.user });
});

app.put('/api/profile', ensureAuth, async (req, res) => {
  const users = await readJson(USERS_FILE, []);
  const index = users.findIndex((item) => item.id === req.session.user.id);
  if (index === -1) return fail(res, 'المستخدم غير موجود', 404);

  const current = users[index];
  const name = clampText(req.body.name || current.name, 80);
  const avatar = clampText(req.body.avatar || current.avatar || '', 500);

  if (!name) return fail(res, 'الاسم مطلوب', 422);
  if (avatar && !isSafeHttpUrl(avatar)) return fail(res, 'رابط الصورة غير صالح', 422);

  current.name = name;
  current.avatar = avatar;
  users[index] = current;
  await writeJson(USERS_FILE, users);

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
  const cards = await readJson(CARDS_FILE, []);
  const sorted = [...cards].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return ok(res, 'تم جلب بطاقات Steam', { cards: sorted });
});

app.get('/api/rules', ensureAuth, async (req, res) => {
  const rules = await readJson(RULES_FILE, []);
  return ok(res, 'تم جلب القوانين', { rules });
});

app.put('/api/rules', ensureAdmin, async (req, res) => {
  const rules = Array.isArray(req.body.rules) ? req.body.rules.map(cleanText).filter(Boolean) : null;
  if (!rules) return fail(res, 'البيانات المرسلة غير صحيحة', 422);
  await writeJson(RULES_FILE, rules);
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
  const cards = await readJson(CARDS_FILE, []);
  const logs = await readJson(LOGS_FILE, []);
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
  const name = clampText(req.body.name, 80);
  const email = normalizeEmail(req.body.email);
  const password = cleanText(req.body.password);
  const role = req.body.role === 'admin' ? 'admin' : 'user';
  const avatar = clampText(req.body.avatar || '', 500);
  const bio = clampText(req.body.bio || '', 300);
  const statusText = clampText(req.body.statusText || '', 120);
  const avatarRingColor = cleanText(req.body.avatarRingColor || '#1cff8a');
  const disableAt = buildDisableAtFromRequest(req.body);

  if (!name || !email || !password) {
    return fail(res, 'الاسم والبريد وكلمة المرور مطلوبة', 422);
  }
  if (!isValidEmail(email)) {
    return fail(res, 'صيغة البريد الإلكتروني غير صحيحة', 422);
  }
  if (avatar && !isSafeHttpUrl(avatar)) {
    return fail(res, 'رابط الصورة غير صالح', 422);
  }
  if (password.length < 6) {
    return fail(res, 'كلمة المرور يجب أن تكون 6 أحرف أو أكثر', 422);
  }

  const users = await syncScheduledDeactivations();
  if (users.some((item) => normalizeEmail(item.email) === email)) {
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

  users.push(newUser);
  await writeJson(USERS_FILE, users);
  await addLog({
    action: 'USER_CREATED',
    actorEmail: req.session.user.email,
    actorRole: req.session.user.role,
    description: `تم إنشاء مستخدم جديد: ${email}`
  });
  return ok(res, 'تمت إضافة المستخدم', { user: sanitizeUser(newUser) }, 201);
});

app.put('/api/admin/users/:id', ensureAdmin, async (req, res) => {
  const users = await syncScheduledDeactivations();
  const index = users.findIndex((item) => item.id === req.params.id);
  if (index === -1) return fail(res, 'المستخدم غير موجود', 404);

  const current = users[index];
  const name = clampText(req.body.name || current.name, 80);
  const email = normalizeEmail(req.body.email || current.email);
  const role = req.body.role === 'admin' ? 'admin' : (req.body.role === 'user' ? 'user' : current.role);
  const password = cleanText(req.body.password || '');
  const avatar = clampText(req.body.avatar || current.avatar || '', 500);
  const bio = clampText(req.body.bio || current.bio || '', 300);
  const statusText = clampText(req.body.statusText || current.statusText || '', 120);
  const avatarRingColor = cleanText(req.body.avatarRingColor || current.avatarRingColor || '#1cff8a');
  const disableAt = buildDisableAtFromRequest(req.body, current.disableAt || null);

  if (!name || !isValidEmail(email)) {
    return fail(res, 'الاسم أو البريد الإلكتروني غير صالح', 422);
  }
  if (avatar && !isSafeHttpUrl(avatar)) {
    return fail(res, 'رابط الصورة غير صالح', 422);
  }
  if (users.some((item) => item.id !== current.id && normalizeEmail(item.email) === email)) {
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

  users[index] = current;
  await writeJson(USERS_FILE, users);

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
  const users = await syncScheduledDeactivations();
  const index = users.findIndex((item) => item.id === req.params.id);
  if (index === -1) return fail(res, 'المستخدم غير موجود', 404);

  const target = users[index];
  target.isActive = req.body.isActive === false || req.body.isActive === 'false' ? false : true;
  target.disableAt = buildDisableAtFromRequest(req.body, target.disableAt || null);
  users[index] = target;
  await writeJson(USERS_FILE, users);

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
  const users = await readJson(USERS_FILE, []);
  const target = users.find((item) => item.id === req.params.id);
  if (!target) return fail(res, 'المستخدم غير موجود', 404);
  const nextUsers = users.filter((item) => item.id !== req.params.id);
  await writeJson(USERS_FILE, nextUsers);
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
  const cards = await readJson(CARDS_FILE, []);
  return ok(res, 'تم جلب البطاقات', { cards });
});

app.post('/api/admin/cards', ensureAdmin, async (req, res) => {
  const title = clampText(req.body.title, 120);
  const category = clampText(req.body.category || 'عام', 60);
  const image = clampText(req.body.image, 500);
  const steamUsername = clampText(req.body.steamUsername, 120);
  const steamPassword = clampText(req.body.steamPassword, 120);
  const notes = clampText(req.body.notes || '', 300);

  if (!title || !image || !steamUsername || !steamPassword) {
    return fail(res, 'كل بيانات البطاقة الأساسية مطلوبة', 422);
  }
  if (!isSafeHttpUrl(image)) {
    return fail(res, 'رابط صورة البطاقة غير صالح', 422);
  }

  const cards = await readJson(CARDS_FILE, []);
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
  cards.push(newCard);
  await writeJson(CARDS_FILE, cards);
  await addLog({
    action: 'CARD_CREATED',
    actorEmail: req.session.user.email,
    actorRole: req.session.user.role,
    description: `تم إنشاء بطاقة: ${title}`
  });
  return ok(res, 'تمت إضافة البطاقة', { card: newCard }, 201);
});

app.put('/api/admin/cards/:id', ensureAdmin, async (req, res) => {
  const cards = await readJson(CARDS_FILE, []);
  const index = cards.findIndex((item) => item.id === req.params.id);
  if (index === -1) return fail(res, 'البطاقة غير موجودة', 404);

  const current = cards[index];
  current.title = clampText(req.body.title || current.title, 120);
  current.category = clampText(req.body.category || current.category, 60);
  current.image = clampText(req.body.image || current.image, 500);
  current.steamUsername = clampText(req.body.steamUsername || current.steamUsername, 120);
  current.steamPassword = clampText(req.body.steamPassword || current.steamPassword, 120);
  current.notes = clampText(req.body.notes || current.notes || '', 300);
  if (!isSafeHttpUrl(current.image)) {
    return fail(res, 'رابط صورة البطاقة غير صالح', 422);
  }
  current.updatedAt = new Date().toISOString();

  cards[index] = current;
  await writeJson(CARDS_FILE, cards);
  await addLog({
    action: 'CARD_UPDATED',
    actorEmail: req.session.user.email,
    actorRole: req.session.user.role,
    description: `تم تحديث بطاقة: ${current.title}`
  });
  return ok(res, 'تم تحديث البطاقة', { card: current });
});

app.delete('/api/admin/cards/:id', ensureAdmin, async (req, res) => {
  const cards = await readJson(CARDS_FILE, []);
  const target = cards.find((item) => item.id === req.params.id);
  if (!target) return fail(res, 'البطاقة غير موجودة', 404);
  const nextCards = cards.filter((item) => item.id !== req.params.id);
  await writeJson(CARDS_FILE, nextCards);
  await addLog({
    action: 'CARD_DELETED',
    actorEmail: req.session.user.email,
    actorRole: req.session.user.role,
    description: `تم حذف بطاقة: ${target.title}`
  });
  return ok(res, 'تم حذف البطاقة');
});

app.get('/api/admin/logs', ensureAdmin, async (req, res) => {
  const logs = await readJson(LOGS_FILE, []);
  return ok(res, 'تم جلب السجلات', { logs: logs.slice(0, 50) });
});

app.get('*', (req, res) => {
  const file = req.path === '/' ? 'index.html' : req.path.replace(/^\//, '');
  const full = path.join(__dirname, 'public', file);
  if (fs.existsSync(full) && fs.statSync(full).isFile()) {
    return res.sendFile(full);
  }
  if (req.path.startsWith('/api/')) {
    return fail(res, 'المسار البرمجي غير موجود', 404);
  }
  return res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

app.listen(PORT, () => {
  console.log(` Fxzz Store running on http://localhost:${PORT}`);
});
