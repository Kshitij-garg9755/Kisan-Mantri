import { randomBytes, createHash, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { getDatabase } from '@netlify/database';

export const db = getDatabase();
export const scrypt = promisify(scryptCallback);
export const SESSION_COOKIE = 'smart_farm_session';

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

export function cookieValue(request, name) {
  const part = (request.headers.get('cookie') || '').split(';').map(value => value.trim())
    .find(value => value.startsWith(`${name}=`));
  return part ? decodeURIComponent(part.slice(name.length + 1)) : '';
}

export function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

export async function passwordHash(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

export async function checkPassword(password, stored) {
  const [algorithm, salt, expectedHex] = String(stored || '').split('$');
  if (algorithm !== 'scrypt' || !salt || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = await scrypt(password, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function farmerPayload(row) {
  if (!row) return null;
  return {
    id: row.id, name: row.name, username: row.username, bio: row.bio || '',
    photo_url: row.photo_url || '', role: row.role || 'buyer', blocked: Boolean(row.blocked), email: row.email || null,
  };
}

export async function createSession(farmerId) {
  const token = randomBytes(32).toString('base64url');
  await db.sql`INSERT INTO farmer_sessions (token_hash, farmer_id, expires_at)
    VALUES (${hash(token)}, ${farmerId}, NOW() + INTERVAL '30 days')`;
  return token;
}

export async function currentFarmer(request) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return null;
  const rows = await db.sql`SELECT f.* FROM farmers f JOIN farmer_sessions s ON s.farmer_id = f.id
    WHERE s.token_hash = ${hash(token)} AND s.expires_at > NOW() AND f.blocked = 0 LIMIT 1`;
  return rows[0] || null;
}

export function sessionCookie(token, maxAge = 30 * 24 * 60 * 60) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export async function bodyJson(request) {
  try { return await request.json(); } catch { return {}; }
}

export async function requireFarmer(request) {
  const farmer = await currentFarmer(request);
  return farmer ? { farmer } : { response: json({ error: 'authentication_required' }, 401) };
}

export function parseList(value) {
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean);
  return String(value || '').split(',').map(item => item.trim()).filter(Boolean);
}
