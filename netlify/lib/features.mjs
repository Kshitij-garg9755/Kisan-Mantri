import { db, json, bodyJson, requireFarmer, currentFarmer, parseList } from './common.mjs';
import { saveUpload, removeUpload } from './uploads.mjs';

const featurePrefix = '/api/features';
const safeNumber = value => Number.isFinite(Number(value)) ? Number(value) : null;

function schemePayload(row, bookmarked = false) {
  return { ...row, states: parseList(row.states), farmer_categories: parseList(row.farmer_categories), bookmarked };
}

function radioPayload(row, saved = false) {
  return { ...row, has_audio: Boolean(row.audio_url), saved };
}

async function postPayload(row, viewerId) {
  const [authorRows, counts, me] = await Promise.all([
    db.sql`SELECT id,name,username,bio,photo_url FROM farmers WHERE id=${row.farmer_id} LIMIT 1`,
    db.sql`SELECT (SELECT COUNT(*) FROM likes WHERE post_id=${row.id}) AS likes,
      (SELECT COUNT(*) FROM comments WHERE post_id=${row.id}) AS comments`,
    viewerId ? db.sql`SELECT EXISTS(SELECT 1 FROM likes WHERE post_id=${row.id} AND farmer_id=${viewerId}) AS liked,
      EXISTS(SELECT 1 FROM saves WHERE post_id=${row.id} AND farmer_id=${viewerId}) AS saved,
      EXISTS(SELECT 1 FROM follows WHERE follower_id=${viewerId} AND followed_id=${row.farmer_id}) AS following` : Promise.resolve([{ liked: false, saved: false, following: false }]),
  ]);
  return {
    id: row.id, creatorId: row.farmer_id, kind: row.kind, media_kind: row.media_kind || 'none',
    category: row.category || 'General', caption: row.caption, title: row.title || '',
    description: row.description || '', media_url: row.media_url || '', crop: row.crop || '',
    tags: row.tags || '', created_at: row.created_at, likes: Number(counts[0]?.likes || 0),
    comments: Number(counts[0]?.comments || 0), liked: Boolean(me[0]?.liked), saved: Boolean(me[0]?.saved),
    following: Boolean(me[0]?.following), author: authorRows[0] || null,
  };
}

export async function dispatchFeatures(request, pathname) {
  if (!pathname.startsWith(`${featurePrefix}/`)) return null;
  const method = request.method.toUpperCase();
  const path = pathname.slice(featurePrefix.length);
  const url = new URL(request.url);

  if (path === '/health' && method === 'GET') return json({ section: 'smart_farm_features', status: 'ready' });

  if (path === '/schemes' && method === 'GET') {
    const q = (url.searchParams.get('q') || '').toLowerCase();
    const category = url.searchParams.get('category') || '';
    const state = url.searchParams.get('state') || '';
    const farmerCategory = url.searchParams.get('farmer_category') || '';
    const farmer = await currentFarmer(request);
    const rows = await db.sql`SELECT * FROM schemes WHERE active=1 ORDER BY lower(title)`;
    const ids = farmer ? await db.sql`SELECT scheme_id FROM scheme_bookmarks WHERE farmer_id=${farmer.id}` : [];
    const saved = new Set(ids.map(row => Number(row.scheme_id)));
    const schemes = rows.filter(row => {
      const haystack = [row.title,row.title_hi,row.summary,row.description].join(' ').toLowerCase();
      return (!q || haystack.includes(q)) && (!category || row.category === category)
        && (!state || parseList(row.states).includes('All') || parseList(row.states).includes(state))
        && (!farmerCategory || parseList(row.farmer_categories).includes('All') || parseList(row.farmer_categories).includes(farmerCategory));
    }).map(row => schemePayload(row, saved.has(Number(row.id))));
    return json({ status: 'live', count: schemes.length, schemes });
  }

  if (path === '/schemes/meta' && method === 'GET') {
    const rows = await db.sql`SELECT category,states,farmer_categories FROM schemes WHERE active=1`;
    const categories = [...new Set(rows.map(row => row.category).filter(Boolean))].sort();
    const states = new Set(); const farmer_categories = new Set();
    for (const row of rows) { parseList(row.states).forEach(value => states.add(value)); parseList(row.farmer_categories).forEach(value => farmer_categories.add(value)); }
    return json({ categories, states: ['All', ...[...states].filter(value => value && value !== 'All').sort()], farmer_categories: ['All', ...[...farmer_categories].filter(value => value && value !== 'All').sort()] });
  }

  const schemeMatch = path.match(/^\/schemes\/([^/]+)$/);
  if (schemeMatch && method === 'GET') {
    const rows = await db.sql`SELECT * FROM schemes WHERE slug=${decodeURIComponent(schemeMatch[1])} AND active=1 LIMIT 1`;
    if (!rows[0]) return json({ error: 'scheme_not_found' }, 404);
    const farmer = await currentFarmer(request);
    const saved = farmer ? await db.sql`SELECT 1 FROM scheme_bookmarks WHERE scheme_id=${rows[0].id} AND farmer_id=${farmer.id}` : [];
    return json({ scheme: schemePayload(rows[0], saved.length > 0) });
  }

  if (path === '/schemes/bookmarks/mine' && method === 'GET') {
    const { farmer, response } = await requireFarmer(request); if (response) return response;
    const rows = await db.sql`SELECT s.* FROM schemes s JOIN scheme_bookmarks b ON b.scheme_id=s.id
      WHERE b.farmer_id=${farmer.id} AND s.active=1 ORDER BY b.created_at DESC`;
    return json({ schemes: rows.map(row => schemePayload(row, true)) });
  }

  if (path === '/admin/schemes' && method === 'POST') {
    const { farmer, response } = await requireFarmer(request); if (response) return response;
    if (!['admin','superadmin'].includes(farmer.role)) return json({ error: 'admin_required' }, 403);
    const body = await bodyJson(request); const slug = String(body.slug || '').trim().toLowerCase().replace(/\s+/g,'-'); const title = String(body.title || '').trim();
    if (!slug || !title) return json({ error: 'slug_and_title_required' }, 400);
    const fields = ['title_hi','summary','description','eligibility','benefits','required_documents','application_process','official_url','department','category','states','farmer_categories','source_note'];
    const values = [title, ...fields.map(key => String(body[key] || (key === 'states' || key === 'farmer_categories' ? 'All' : '')).trim())];
    const columns = ['title', ...fields];
    const assignments = columns.map((key,index) => `${key}=$${index+1}`).join(',');
    const rows = await db.sql.unsafe(`INSERT INTO schemes(slug,${columns.join(',')}) VALUES ($${values.length+1},${values.map((_,i)=>`$${i+1}`).join(',')}) ON CONFLICT(slug) DO UPDATE SET ${assignments},updated_at=NOW() RETURNING id,slug`, [...values,slug]);
    return json({ success: true, id: rows[0].id, slug }, 201);
  }
  const adminScheme=path.match(/^\/admin\/schemes\/([^/]+)$/);
  if(adminScheme&&method==='DELETE'){
    const {farmer,response}=await requireFarmer(request);if(response)return response;if(!['admin','superadmin'].includes(farmer.role))return json({error:'admin_required'},403);
    const rows=await db.sql`UPDATE schemes SET active=0,updated_at=NOW() WHERE slug=${decodeURIComponent(adminScheme[1])} RETURNING id`;if(!rows.length)return json({error:'scheme_not_found'},404);return json({success:true});
  }

  const bookmark = path.match(/^\/schemes\/([^/]+)\/bookmark$/);
  if (bookmark && method === 'POST') {
    const { farmer, response } = await requireFarmer(request); if (response) return response;
    const rows = await db.sql`SELECT id FROM schemes WHERE slug=${decodeURIComponent(bookmark[1])} AND active=1 LIMIT 1`;
    if (!rows[0]) return json({ error: 'scheme_not_found' }, 404);
    const existing = await db.sql`SELECT 1 FROM scheme_bookmarks WHERE scheme_id=${rows[0].id} AND farmer_id=${farmer.id}`;
    if (existing.length) await db.sql`DELETE FROM scheme_bookmarks WHERE scheme_id=${rows[0].id} AND farmer_id=${farmer.id}`;
    else await db.sql`INSERT INTO scheme_bookmarks (scheme_id,farmer_id) VALUES (${rows[0].id},${farmer.id}) ON CONFLICT DO NOTHING`;
    return json({ success: true, bookmarked: !existing.length });
  }

  if (path === '/bank/info' && method === 'GET') {
    const rows = await db.sql`SELECT * FROM schemes WHERE active=1 AND category IN ('Credit','Insurance','Subsidy','Income Support','Pension') ORDER BY lower(title)`;
    return json({ status: 'live', notice: 'This section provides financial information and calculators only. It does not perform banking transactions or ask for ATM PIN, CVV, OTP, passwords or full account credentials.', schemes: rows.map(row => schemePayload(row)), articles: [
      { title: 'Understand your crop loan before you borrow', body: 'Compare the total interest, not just the instalment. Ask the bank for the effective annual rate after any interest subvention, and read the repayment schedule carefully.' },
      { title: 'Never share banking secrets', body: 'No bank or government office will ever ask for your ATM PIN, CVV, OTP or net-banking password. If someone does, treat it as fraud and report it.' },
      { title: 'Keep documents ready for scheme applications', body: 'Aadhaar, land records and bank details are commonly required. Keep clean copies ready to avoid delays during application windows.' },
      { title: 'Match repayment to harvest cash-flow', body: 'Choose a tenure that ends shortly after your expected harvest and sale, so you can repay promptly and benefit from any interest subvention.' },
    ] });
  }

  if (path === '/satellite/status' && method === 'GET') return json({ layers: { base_map: { status: 'live', provider: 'OpenStreetMap', note: 'Street base map.' }, satellite_imagery: { status: 'live', provider: 'Esri World Imagery', note: 'Satellite / aerial imagery tiles. Not an NDVI analysis.' }, ndvi: { status: process.env.SATELLITE_NDVI_API_URL ? 'live' : 'unavailable', provider: process.env.SATELLITE_NDVI_API_URL ? 'Custom NDVI API' : null, note: process.env.SATELLITE_NDVI_API_URL ? 'NDVI endpoint configured.' : 'No NDVI / crop-health API is connected; crop-health values are illustrative.' }, weather: { status: 'live', provider: 'Open-Meteo', note: 'Live weather via the Smart Farm backend.' } }, note: 'Base map and satellite imagery are live map tiles. Crop-health analysis needs a real satellite analysis API.' });

  if (path === '/satellite/fields' && method === 'GET') {
    const { farmer, response } = await requireFarmer(request); if (response) return response;
    return json({ fields: await db.sql`SELECT * FROM saved_fields WHERE farmer_id=${farmer.id} ORDER BY created_at DESC,id DESC` });
  }
  if (path === '/satellite/fields' && method === 'POST') {
    const { farmer, response } = await requireFarmer(request); if (response) return response;
    const body = await bodyJson(request); const name = String(body.name || '').trim().slice(0,80);
    const lat = safeNumber(body.latitude); const lng = safeNumber(body.longitude);
    if (!name) return json({ error: 'field_name_required' }, 400);
    if (lat === null || lng === null || lat < -90 || lat > 90 || lng < -180 || lng > 180) return json({ error: 'valid_coordinates_required' },400);
    const boundary = Array.isArray(body.boundary) && body.boundary.length >= 3 ? JSON.stringify(body.boundary) : '';
    const area = safeNumber(body.area_acres);
    const rows = await db.sql`INSERT INTO saved_fields (farmer_id,name,crop,latitude,longitude,area_acres,boundary,notes)
      VALUES (${farmer.id},${name},${String(body.crop||'').slice(0,60)},${lat},${lng},${area},${boundary},${String(body.notes||'').slice(0,500)}) RETURNING *`;
    return json({ field: rows[0] }, 201);
  }
  const fieldMatch = path.match(/^\/satellite\/fields\/(\d+)$/);
  if (fieldMatch && method === 'DELETE') {
    const { farmer, response } = await requireFarmer(request); if (response) return response;
    const rows = await db.sql`SELECT farmer_id FROM saved_fields WHERE id=${Number(fieldMatch[1])}`;
    if (!rows[0]) return json({ error: 'field_not_found' },404);
    if (rows[0].farmer_id !== farmer.id) return json({ error: 'only_owner_can_delete' },403);
    await db.sql`DELETE FROM saved_fields WHERE id=${Number(fieldMatch[1])}`; return json({ success: true });
  }

  if (path === '/radio/programs' && method === 'GET') {
    const farmer = await currentFarmer(request); const category = url.searchParams.get('category') || '';
    const rows = category ? await db.sql`SELECT * FROM radio_programs WHERE active=1 AND category=${category} ORDER BY published_at DESC,id DESC` : await db.sql`SELECT * FROM radio_programs WHERE active=1 ORDER BY published_at DESC,id DESC`;
    const savedIds = farmer ? new Set((await db.sql`SELECT program_id FROM saved_programs WHERE farmer_id=${farmer.id}`).map(row=>Number(row.program_id))) : new Set();
    const categories = await db.sql`SELECT DISTINCT category FROM radio_programs WHERE active=1 ORDER BY category`;
    return json({ programs: rows.map(row=>radioPayload(row,savedIds.has(Number(row.id)))), categories: categories.map(row=>row.category), has_audio: rows.some(row=>Boolean(row.audio_url)) });
  }
  const saveProgram = path.match(/^\/radio\/programs\/(\d+)\/save$/);
  if (saveProgram && method === 'POST') {
    const { farmer, response } = await requireFarmer(request); if(response) return response;
    const id = Number(saveProgram[1]); const exists = await db.sql`SELECT id FROM radio_programs WHERE id=${id}`;
    if (!exists[0]) return json({error:'program_not_found'},404);
    const saved = await db.sql`SELECT 1 FROM saved_programs WHERE program_id=${id} AND farmer_id=${farmer.id}`;
    if (saved.length) await db.sql`DELETE FROM saved_programs WHERE program_id=${id} AND farmer_id=${farmer.id}`;
    else await db.sql`INSERT INTO saved_programs (program_id,farmer_id) VALUES (${id},${farmer.id}) ON CONFLICT DO NOTHING`;
    return json({success:true,saved:!saved.length});
  }
  if(path === '/radio/saved' && method === 'GET'){
    const {farmer,response}=await requireFarmer(request); if(response)return response;
    const rows=await db.sql`SELECT p.*,TRUE AS saved FROM radio_programs p JOIN saved_programs s ON s.program_id=p.id WHERE s.farmer_id=${farmer.id} ORDER BY s.created_at DESC`;
    return json({programs:rows.map(row=>radioPayload(row,true))});
  }

  if(path === '/notifications' && method === 'GET'){
    const {farmer,response}=await requireFarmer(request); if(response)return response;
    return json({notifications:await db.sql`SELECT * FROM notifications_v2 WHERE farmer_id=${farmer.id} ORDER BY created_at DESC,id DESC LIMIT 50`});
  }
  const notif=path.match(/^\/notifications\/(\d+)\/read$/);
  if(notif && method==='POST'){
    const {farmer,response}=await requireFarmer(request); if(response)return response;
    const rows=await db.sql`UPDATE notifications_v2 SET read=1 WHERE id=${Number(notif[1])} AND farmer_id=${farmer.id} RETURNING id`;
    if(!rows.length)return json({error:'notification_not_found'},404); return json({success:true});
  }

  if(path === '/diagnosis/analyze' && method==='POST'){
    const {farmer,response}=await requireFarmer(request); if(response)return response;
    const form=await request.formData(); const image=form.get('image'); const crop=String(form.get('crop')||'').trim().slice(0,60);
    if(!image || typeof image.arrayBuffer!=='function' || !image.name)return json({error:'image_required'},400);
    if(!crop)return json({error:'crop_required'},400);
    if(image.size>4*1024*1024)return json({error:'image_too_large'},400);
    if(!/\.(jpg|jpeg|png|webp)$/i.test(image.name))return json({error:'invalid_image_type'},400);
    const imageUrl=await saveUpload(image,`diagnosis-${farmer.id}`);
    const rows=await db.sql`INSERT INTO diagnosis_history (farmer_id,crop,image_url,status,result_label,confidence,symptoms,prevention,treatment)
      VALUES (${farmer.id},${crop},${imageUrl},'demo','AI model not connected',NULL,'','','') RETURNING *`;
    return json({result:{...rows[0],message:'No trained crop-disease model is connected, so this is only an upload and history demo. Please get the crop inspected by your local agriculture extension officer (KVK / Agriculture Department).',model_configured:false}},201);
  }
  if(path === '/diagnosis/history' && method==='GET'){
    const {farmer,response}=await requireFarmer(request); if(response)return response;
    return json({history:await db.sql`SELECT * FROM diagnosis_history WHERE farmer_id=${farmer.id} ORDER BY created_at DESC,id DESC`});
  }
  const diagnosis=path.match(/^\/diagnosis\/history\/(\d+)$/);
  if(diagnosis && method==='DELETE'){
    const {farmer,response}=await requireFarmer(request); if(response)return response;
    const id=Number(diagnosis[1]); const rows=await db.sql`SELECT farmer_id,image_url FROM diagnosis_history WHERE id=${id}`;
    if(!rows[0])return json({error:'record_not_found'},404);
    if(rows[0].farmer_id!==farmer.id)return json({error:'only_owner_can_delete'},403);
    await db.sql`DELETE FROM diagnosis_history WHERE id=${id}`; await removeUpload(rows[0].image_url); return json({success:true});
  }

  return null;
}
