import { randomBytes } from 'node:crypto';
import { dispatchCommunity } from '../lib/community.mjs';
import { dispatchFeatures } from '../lib/features.mjs';
import { dispatchMarketplace } from '../lib/marketplace.mjs';
import { dispatchLegacy } from '../lib/legacy.mjs';
import { db, json, bodyJson, cookieValue, hash, passwordHash, checkPassword, farmerPayload, createSession, currentFarmer, sessionCookie, SESSION_COOKIE } from '../lib/common.mjs';

async function handleAuth(request, pathname) {
  const method = request.method.toUpperCase();
  if (pathname === '/api/auth/register' && method === 'POST') {
    const body = await bodyJson(request);
    const name = String(body.name || '').trim().replace(/\s+/g, ' ');
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!name || name.length > 120) return json({ error: 'Enter your name (up to 120 characters).' }, 400);
    if (!/^[a-z0-9._%+-]+@gmail\.com$/.test(email) || email.length > 254) return json({ error: 'Please enter a valid Gmail address.' }, 400);
    if (password.length < 8 || password.length > 256) return json({ error: 'Password must be between 8 and 256 characters.' }, 400);

    const existing = await db.sql`SELECT id FROM farmers WHERE email = ${email} LIMIT 1`;
    if (existing.length) return json({ error: 'An account with this Gmail already exists. Please log in.' }, 409);
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'farmer';
    let username = base;
    for (let suffix = 2; (await db.sql`SELECT id FROM farmers WHERE username = ${username} LIMIT 1`).length; suffix++) {
      username = `${base}_${suffix}`;
    }
    const id = randomBytes(18).toString('base64url');
    const encodedPassword = await passwordHash(password);
    const created = await db.sql`INSERT INTO farmers (id, name, username, email, password_hash)
      VALUES (${id}, ${name}, ${username}, ${email}, ${encodedPassword}) RETURNING *`;
    const token = await createSession(id);
    return json({ success: true, farmer: farmerPayload(created[0]) }, 201, { 'set-cookie': sessionCookie(token) });
  }

  if (pathname === '/api/auth/login' && method === 'POST') {
    const body = await bodyJson(request);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!/^[a-z0-9._%+-]+@gmail\.com$/.test(email) || email.length > 254 || !password || password.length > 256) {
      return json({ error: 'Enter your Gmail address and password.' }, 400);
    }
    const rows = await db.sql`SELECT * FROM farmers WHERE email = ${email} LIMIT 1`;
    const farmer = rows[0];
    if (!farmer || !(await checkPassword(password, farmer.password_hash))) return json({ error: 'Gmail or password is incorrect.' }, 401);
    if (farmer.blocked) return json({ error: 'This account is not available.' }, 403);
    const token = await createSession(farmer.id);
    return json({ success: true, farmer: farmerPayload(farmer) }, 200, { 'set-cookie': sessionCookie(token) });
  }

  if (pathname === '/api/auth/me' && (method === 'GET' || method === 'PUT')) {
    const farmer = await currentFarmer(request);
    if (!farmer) return json({ farmer: null });
    if (method === 'PUT') {
      const body = await bodyJson(request);
      const bio = body.bio === undefined ? farmer.bio : String(body.bio).slice(0, 500);
      const photo = body.photo_url === undefined ? farmer.photo_url : String(body.photo_url).slice(0, 2048);
      const rows = await db.sql`UPDATE farmers SET bio = ${bio}, photo_url = ${photo} WHERE id = ${farmer.id} RETURNING *`;
      return json({ farmer: farmerPayload(rows[0]) });
    }
    return json({ farmer: farmerPayload(farmer) });
  }

  if (pathname === '/api/auth/logout' && method === 'POST') {
    const token = cookieValue(request, SESSION_COOKIE);
    if (token) await db.sql`DELETE FROM farmer_sessions WHERE token_hash = ${hash(token)}`;
    return json({ success: true }, 200, { 'set-cookie': sessionCookie('', 0) });
  }
  return null;
}

export default async (request) => {
  const pathname = new URL(request.url).pathname;
  try {
    if (pathname === '/api/health') {
      const rows = await db.sql`SELECT 1 AS ok`;
      return json({ success: true, service: 'netlify-functions', database: Number(rows[0]?.ok) === 1 });
    }
    const authResponse = await handleAuth(request, pathname);
    if (authResponse) return authResponse;
    for (const dispatch of [dispatchFeatures, dispatchCommunity, dispatchMarketplace]) {
      const response = await dispatch(request, pathname);
      if (response) return response;
    }
    const legacyResponse = await dispatchLegacy(request, pathname);
    if (legacyResponse) return legacyResponse;
    return json({ error: 'This API endpoint has not been migrated to Netlify Functions yet.', path: pathname }, 501);
  } catch (error) {
    console.error('Netlify API error:', error?.message || error);
    return json({ error: 'The service could not complete this request.' }, 500);
  }
};

export const config = { path: ['/api/*', '/uploads/*', '/send_otp', '/verify_otp'] };
