import { randomBytes } from 'node:crypto';
import { getStore } from '@netlify/blobs';

const uploads = getStore({ name: 'smart-farm-uploads', consistency: 'strong' });

export async function saveUpload(file, prefix = 'file') {
  const extension = String(file.name || '').match(/\.[a-zA-Z0-9]{1,8}$/)?.[0]?.toLowerCase() || '';
  const key = `${prefix}-${randomBytes(18).toString('hex')}${extension}`;
  await uploads.set(key, await file.arrayBuffer(), { metadata: { contentType: file.type || 'application/octet-stream' } });
  return `/uploads/${key}`;
}

export async function saveUploadData(data, name, contentType, prefix = 'file') {
  const extension = String(name || '').match(/\.[a-zA-Z0-9]{1,8}$/)?.[0]?.toLowerCase() || '';
  const key = `${prefix}-${randomBytes(18).toString('hex')}${extension}`;
  await uploads.set(key, data, { metadata: { contentType: contentType || 'application/octet-stream' } });
  return `/uploads/${key}`;
}

export async function saveUploadPart(owner, uploadId, index, data) {
  if (!/^[a-zA-Z0-9_-]{12,80}$/.test(uploadId) || !Number.isInteger(index) || index < 0) throw new Error('invalid_upload_part');
  await uploads.set(`parts/${owner}/${uploadId}/${index}`, data, { metadata: { owner, uploadId, index } });
}

export async function assembleUpload(owner, uploadId, total, name, contentType, prefix) {
  if (!/^[a-zA-Z0-9_-]{12,80}$/.test(uploadId) || !Number.isInteger(total) || total < 1 || total > 40) throw new Error('invalid_upload');
  const parts=[];
  for(let index=0;index<total;index++){
    const part=await uploads.get(`parts/${owner}/${uploadId}/${index}`,{type:'arrayBuffer'});
    if(!part)throw new Error('upload_part_missing');
    parts.push(Buffer.from(part));
  }
  const buffer=Buffer.concat(parts);
  if(buffer.length>100*1024*1024)throw new Error('upload_too_large');
  const url=await saveUploadData(buffer,name,contentType,prefix);
  await Promise.all(Array.from({length:total},(_,index)=>uploads.delete(`parts/${owner}/${uploadId}/${index}`)));
  return url;
}

export async function removeUpload(url) {
  const key = String(url || '').replace(/^\/uploads\//, '');
  if (key && !key.includes('/') && !key.includes('..')) await uploads.delete(key);
}

export async function serveUpload(pathname) {
  const key = decodeURIComponent(pathname.replace(/^\/uploads\//, ''));
  if (!key || key.includes('/') || key.includes('..')) return new Response('Not found', { status: 404 });
  const entry = await uploads.getWithMetadata(key, { type: 'arrayBuffer' });
  if (!entry?.data) return new Response('Not found', { status: 404 });
  return new Response(entry.data, { headers: {
    'content-type': entry.metadata?.contentType || 'application/octet-stream',
    'cache-control': 'public, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
  } });
}
