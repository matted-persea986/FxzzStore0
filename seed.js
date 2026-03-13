import fs from 'fs-extra';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.join(__dirname, 'data');

await fs.ensureDir(dataDir);

function createPasswordHash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

const adminPasswordHash = createPasswordHash('Admin@12345');
const userPasswordHash = createPasswordHash('User@12345');

await fs.writeJson(path.join(dataDir, 'users.json'), [
  {
    id: 'admin_1',
    name: 'Green Master',
    email: 'admin@vault.local',
    role: 'admin',
    avatar: '',
    isActive: true,
    bio: '',
    statusText: '',
    avatarRingColor: '#1cff8a',
    disableAt: null,
    passwordHash: adminPasswordHash,
    createdAt: new Date().toISOString()
  },
  {
    id: 'user_1',
    name: 'Ali User',
    email: 'ali@example.com',
    role: 'user',
    avatar: '',
    isActive: true,
    bio: '',
    statusText: '',
    avatarRingColor: '#1cff8a',
    disableAt: null,
    passwordHash: userPasswordHash,
    createdAt: new Date().toISOString()
  }
], { spaces: 2 });

await fs.writeJson(path.join(dataDir, 'cards.json'), [
  {
    id: 'card_fc25',
    title: 'EA SPORTS FC 25',
    category: 'رياضة',
    image: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?q=80&w=1400&auto=format&fit=crop',
    steamUsername: 'fc25_private_01',
    steamPassword: 'FC25-Private-01',
    notes: 'استخدم الحساب بشكل شخصي فقط.',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'card_rdr2',
    title: 'Red Dead Redemption 2',
    category: 'عالم مفتوح',
    image: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?q=80&w=1400&auto=format&fit=crop',
    steamUsername: 'rdr2_vault_09',
    steamPassword: 'RDR2-Vault-09',
    notes: 'لا تشارك الحساب مع أي شخص.',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'card_cp',
    title: 'Cyberpunk 2077',
    category: 'أكشن',
    image: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?q=80&w=1400&auto=format&fit=crop',
    steamUsername: 'cyber_green_77',
    steamPassword: 'Cyber-Green-77',
    notes: 'أي مخالفة قد تؤدي لإيقاف الوصول.',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
], { spaces: 2 });

await fs.writeJson(path.join(dataDir, 'rules.json'), [
  'يمنع مشاركة الحسابات مع أي شخص آخر.',
  'الحسابات للاستخدام الشخصي فقط.',
  'يمنع إعادة نشر بيانات الحساب خارج الموقع.',
  'أي مخالفة تؤدي إلى إيقاف الوصول بشكل كامل.'
], { spaces: 2 });

await fs.writeJson(path.join(dataDir, 'logs.json'), [], { spaces: 2 });

console.log('Seed complete.');
