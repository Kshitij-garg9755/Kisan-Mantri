import { db, json, bodyJson, currentFarmer, requireFarmer, farmerPayload } from './common.mjs';
import { saveUpload, removeUpload, saveUploadPart, assembleUpload } from './uploads.mjs';

async function fullPost(row, viewerId, featureShape = false) {
  const [authors, counts, state] = await Promise.all([
    db.sql`SELECT id,name,username,bio,photo_url,role,blocked,email FROM farmers WHERE id=${row.farmer_id} LIMIT 1`,
    db.sql`SELECT (SELECT COUNT(*) FROM likes WHERE post_id=${row.id}) AS likes,(SELECT COUNT(*) FROM comments WHERE post_id=${row.id}) AS comments`,
    viewerId ? db.sql`SELECT EXISTS(SELECT 1 FROM saves WHERE post_id=${row.id} AND farmer_id=${viewerId}) AS saved,
      EXISTS(SELECT 1 FROM likes WHERE post_id=${row.id} AND farmer_id=${viewerId}) AS liked,
      EXISTS(SELECT 1 FROM follows WHERE follower_id=${viewerId} AND followed_id=${row.farmer_id}) AS following,
      EXISTS(SELECT 1 FROM follow_requests WHERE requester_id=${viewerId} AND target_id=${row.farmer_id}) AS follow_requested` : Promise.resolve([{saved:false,liked:false,following:false,follow_requested:false}]),
  ]);
  const author = authors[0] ? farmerPayload(authors[0]) : null;
  const result = { ...row, creatorId: row.farmer_id, author, likes: Number(counts[0]?.likes || 0), comments: Number(counts[0]?.comments || 0), saved: Boolean(state[0]?.saved), liked: Boolean(state[0]?.liked), following: Boolean(state[0]?.following), follow_requested: Boolean(state[0]?.follow_requested) };
  if (!featureShape) return result;
  return { id: row.id, creatorId: row.farmer_id, kind: row.kind, media_kind: row.media_kind || 'none', category: row.category || 'General', caption: row.caption, title: row.title || '', description: row.description || '', media_url: row.media_url || '', crop: row.crop || '', tags: row.tags || '', created_at: row.created_at, likes: result.likes, comments: result.comments, liked: result.liked, saved: result.saved, following: result.following, author: author && { id: author.id, name: author.name, username: author.username, bio: author.bio, photo_url: author.photo_url } };
}

async function toggle(table, colA, valA, colB, valB) {
  const existing = await db.sql.unsafe(`SELECT 1 FROM ${table} WHERE ${colA}=$1 AND ${colB}=$2`, [valA,valB]);
  if (existing.length) await db.sql.unsafe(`DELETE FROM ${table} WHERE ${colA}=$1 AND ${colB}=$2`,[valA,valB]);
  else await db.sql.unsafe(`INSERT INTO ${table} (${colA},${colB}) VALUES ($1,$2) ON CONFLICT DO NOTHING`,[valA,valB]);
  return !existing.length;
}

export async function dispatchCommunity(request, pathname) {
  const method=request.method.toUpperCase(); const url=new URL(request.url);

  // Farmer Chaupal routes.
  if(pathname==='/api/features/chaupal/feed' && method==='GET'){
    const viewer=await currentFarmer(request); const category=url.searchParams.get('category')||''; const kind=url.searchParams.get('kind')||''; const q=(url.searchParams.get('q')||'').toLowerCase();
    const rows=await db.sql`SELECT * FROM posts ORDER BY created_at DESC,id DESC LIMIT 200`;
    const posts=[];
    for(const row of rows){if(category && row.category!==category)continue;if(['post','reel','video'].includes(kind)&&row.kind!==kind)continue;if(q && ![row.caption,row.title,row.description].join(' ').toLowerCase().includes(q))continue;posts.push(await fullPost(row,viewer?.id,true));}
    return json({posts});
  }
  if(pathname==='/api/features/chaupal/farmers' && method==='GET'){
    const viewer=await currentFarmer(request); const q=(url.searchParams.get('q')||'').toLowerCase();
    const rows=await db.sql`SELECT id,name,username,bio,photo_url FROM farmers ORDER BY lower(name) LIMIT 100`;
    const farmers=[]; for(const row of rows){if(q&&!`${row.name} ${row.username}`.toLowerCase().includes(q))continue;const rel=viewer?await db.sql`SELECT 1 FROM follows WHERE follower_id=${viewer.id} AND followed_id=${row.id}`:[];farmers.push({...row,following:Boolean(rel.length)});}
    return json({farmers});
  }
  if(pathname==='/api/features/chaupal/posts' && method==='POST'){
    const {farmer,response}=await requireFarmer(request);if(response)return response;const body=await bodyJson(request);const caption=String(body.caption||'').trim().slice(0,2000);if(!caption)return json({error:'caption_required'},400);
    const kind=['post','reel','video'].includes(body.kind)?body.kind:'post';const category=String(body.category||'General').trim().slice(0,60);
    const rows=await db.sql`INSERT INTO posts (farmer_id,kind,caption,category,media_kind) VALUES (${farmer.id},${kind},${caption},${category},'none') RETURNING *`;
    return json({post:await fullPost(rows[0],farmer.id,true)},201);
  }
  if(pathname==='/api/features/chaupal/upload' && method==='POST'){
    const {farmer,response}=await requireFarmer(request);if(response)return response;const form=await request.formData();const image=form.get('image');
    if(!image||typeof image.arrayBuffer!=='function'||!image.name)return json({error:'image_required'},400);
    if(image.size>4*1024*1024)return json({error:'image_too_large'},400);if(!/\.(jpg|jpeg|png|webp)$/i.test(image.name))return json({error:'invalid_image_type'},400);
    const mediaUrl=await saveUpload(image,`chaupal-${farmer.id}`);const caption=String(form.get('caption')||'').trim().slice(0,2000);const category=String(form.get('category')||'General').trim().slice(0,60);
    const rows=await db.sql`INSERT INTO posts (farmer_id,kind,caption,category,media_kind,media_url) VALUES (${farmer.id},'post',${caption},${category},'image',${mediaUrl}) RETURNING *`;
    return json({post:await fullPost(rows[0],farmer.id,true)},201);
  }
  const chaupalPost=pathname.match(/^\/api\/features\/chaupal\/posts\/(\d+)(?:\/(like|save|comments|report))?$/);
  if(chaupalPost){
    const id=Number(chaupalPost[1]);const action=chaupalPost[2];const rows=await db.sql`SELECT * FROM posts WHERE id=${id} LIMIT 1`;
    if(!rows[0])return json({error:'post_not_found'},404);
    if(!action && method==='GET'){const viewer=await currentFarmer(request);return json({post:await fullPost(rows[0],viewer?.id,true)});}
    if(action==='like'&&method==='POST'||action==='save'&&method==='POST'){
      const {farmer,response}=await requireFarmer(request);if(response)return response;const active=await toggle(action==='like'?'likes':'saves','post_id',id,'farmer_id',farmer.id);
      const counts=await db.sql`SELECT COUNT(*) AS count FROM likes WHERE post_id=${id}`;return json(action==='like'?{success:true,liked:active,likes:Number(counts[0].count)}:{success:true,saved:active});
    }
    if(action==='comments'&&method==='GET'){
      const comments=await db.sql`SELECT c.id,c.post_id,c.farmer_id,c.body,c.created_at,f.name AS author_name,f.username AS author_username FROM comments c JOIN farmers f ON f.id=c.farmer_id WHERE c.post_id=${id} ORDER BY c.created_at,c.id`;
      const result=[];for(const c of comments){const replies=await db.sql`SELECT r.id,r.body,r.created_at,r.farmer_id,f.name AS author_name,f.username AS author_username FROM comment_replies r JOIN farmers f ON f.id=r.farmer_id WHERE r.comment_id=${c.id} ORDER BY r.created_at,r.id`;result.push({id:c.id,post_id:c.post_id,body:c.body,created_at:c.created_at,author_id:c.farmer_id,author_name:c.author_name,author_username:c.author_username,replies:replies.map(r=>({id:r.id,body:r.body,created_at:r.created_at,author_id:r.farmer_id,author_name:r.author_name,author_username:r.author_username}))});}return json({comments:result});
    }
    if(action==='comments'&&method==='POST'){
      const {farmer,response}=await requireFarmer(request);if(response)return response;const body=String((await bodyJson(request)).body||'').trim().slice(0,1000);if(!body)return json({error:'comment_body_required'},400);
      await db.sql`INSERT INTO comments (post_id,farmer_id,body) VALUES (${id},${farmer.id},${body})`;
      if(rows[0].farmer_id!==farmer.id)await db.sql`INSERT INTO notifications_v2 (farmer_id,kind,message,link) VALUES (${rows[0].farmer_id},'comment','Someone commented on your post.',${`#post-${id}`})`;return json({success:true},201);
    }
    if(action==='report'&&method==='POST'){
      const {farmer,response}=await requireFarmer(request);if(response)return response;const b=await bodyJson(request);const allowed=['spam','abuse','misinformation','irrelevant','other'];const reason=allowed.includes(b.reason)?b.reason:'other';
      try{await db.sql`INSERT INTO post_reports (post_id,farmer_id,reason,details) VALUES (${id},${farmer.id},${reason},${String(b.details||'').trim().slice(0,500)})`;await db.sql`UPDATE posts SET report_count=report_count+1 WHERE id=${id}`;}catch{return json({error:'already_reported'},409);}return json({success:true},201);
    }
    if(!action&&method==='DELETE'){
      const {farmer,response}=await requireFarmer(request);if(response)return response;if(rows[0].farmer_id!==farmer.id&& !['admin','superadmin'].includes(farmer.role))return json({error:'only_owner_can_delete'},403);
      await db.sql`DELETE FROM likes WHERE post_id=${id}`;await db.sql`DELETE FROM saves WHERE post_id=${id}`;await db.sql`DELETE FROM comments WHERE post_id=${id}`;await db.sql`DELETE FROM post_reports WHERE post_id=${id}`;await db.sql`DELETE FROM posts WHERE id=${id}`;await removeUpload(rows[0].media_url);return json({success:true});
    }
  }
  const reply=pathname.match(/^\/api\/features\/chaupal\/comments\/(\d+)\/reply$/);
  if(reply&&method==='POST'){
    const {farmer,response}=await requireFarmer(request);if(response)return response;const body=String((await bodyJson(request)).body||'').trim().slice(0,1000);if(!body)return json({error:'reply_body_required'},400);
    const parent=await db.sql`SELECT id FROM comments WHERE id=${Number(reply[1])}`;if(!parent.length)return json({error:'comment_not_found'},404);
    await db.sql`INSERT INTO comment_replies (comment_id,farmer_id,body) VALUES (${Number(reply[1])},${farmer.id},${body})`;return json({success:true},201);
  }
  const chaupalFollow=pathname.match(/^\/api\/features\/chaupal\/farmers\/([^/]+)\/follow$/);
  if(chaupalFollow&&method==='POST'){
    const {farmer,response}=await requireFarmer(request);if(response)return response;const target=decodeURIComponent(chaupalFollow[1]);if(target===farmer.id)return json({error:'cannot_follow_self'},400);
    const targetRows=await db.sql`SELECT id FROM farmers WHERE id=${target}`;if(!targetRows.length)return json({error:'farmer_not_found'},404);
    const following=await toggle('follows','follower_id',farmer.id,'followed_id',target);if(following)await db.sql`INSERT INTO notifications_v2 (farmer_id,kind,message) VALUES (${target},'follow','A farmer started following you.')`;return json({success:true,following});
  }
  const chaupalProfile=pathname.match(/^\/api\/features\/chaupal\/profile\/([^/]+)$/);
  if(chaupalProfile&&method==='GET'){
    const id=decodeURIComponent(chaupalProfile[1]);const farmers=await db.sql`SELECT id,name,username,bio,photo_url FROM farmers WHERE id=${id}`;if(!farmers[0])return json({error:'farmer_not_found'},404);
    const rows=await db.sql`SELECT * FROM posts WHERE farmer_id=${id} ORDER BY created_at DESC,id DESC LIMIT 100`;const viewer=await currentFarmer(request);const posts=[];for(const row of rows)posts.push(await fullPost(row,viewer?.id,true));
    const counts=await db.sql`SELECT (SELECT COUNT(*) FROM follows WHERE followed_id=${id}) AS followers,(SELECT COUNT(*) FROM follows WHERE follower_id=${id}) AS following`;return json({farmer:farmers[0],followers:Number(counts[0].followers),following:Number(counts[0].following),posts});
  }

  // AgriVerse social feed and messaging routes.
  if(pathname==='/api/agriverse/feed'&&method==='GET'){
    const viewer=await currentFarmer(request);const kind=url.searchParams.get('kind')||'';
    const rows=['post','reel','video'].includes(kind)?await db.sql`SELECT * FROM posts WHERE kind=${kind} ORDER BY created_at DESC,id DESC`:await db.sql`SELECT * FROM posts ORDER BY created_at DESC,id DESC`;
    const posts=[];for(const row of rows)posts.push(await fullPost(row,viewer?.id));const farmers=await db.sql`SELECT id,name,username,bio,photo_url,role,blocked,email FROM farmers ORDER BY created_at DESC LIMIT 8`;return json({posts,farmers:farmers.map(farmerPayload)});
  }
  const profile=pathname.match(/^\/api\/agriverse\/profile\/([^/]+)$/);
  if(profile&&method==='GET'){
    const id=decodeURIComponent(profile[1]);const farmers=await db.sql`SELECT * FROM farmers WHERE id=${id}`;if(!farmers[0])return json({error:'farmer_not_found'},404);const viewer=await currentFarmer(request);const rows=await db.sql`SELECT * FROM posts WHERE farmer_id=${id} ORDER BY created_at DESC,id DESC`;const posts=[];for(const row of rows)posts.push(await fullPost(row,viewer?.id));
    const counts=await db.sql`SELECT (SELECT COUNT(*) FROM follows WHERE followed_id=${id}) AS followers,(SELECT COUNT(*) FROM follows WHERE follower_id=${id}) AS following,(SELECT COUNT(*) FROM follow_requests WHERE target_id=${id}) AS follow_requests`;return json({farmer:farmerPayload(farmers[0]),followers:Number(counts[0].followers),following:Number(counts[0].following),follow_requests:Number(counts[0].follow_requests),posts});
  }
  if(pathname==='/api/agriverse/relationships'&&method==='GET'){
    const {farmer,response}=await requireFarmer(request);if(response)return response;
    const [followers,following,requests]=await Promise.all([
      db.sql`SELECT f.* FROM follows r JOIN farmers f ON f.id=r.follower_id WHERE r.followed_id=${farmer.id} ORDER BY lower(f.name)`,
      db.sql`SELECT f.* FROM follows r JOIN farmers f ON f.id=r.followed_id WHERE r.follower_id=${farmer.id} ORDER BY lower(f.name)`,
      db.sql`SELECT f.*,r.created_at AS request_created_at FROM follow_requests r JOIN farmers f ON f.id=r.requester_id WHERE r.target_id=${farmer.id} ORDER BY r.created_at DESC`,
    ]);return json({followers:followers.map(farmerPayload),following:following.map(farmerPayload),requests:requests.map(row=>({...farmerPayload(row),created_at:row.request_created_at}))});
  }
  const followAction=pathname.match(/^\/api\/agriverse\/follow-requests\/([^/]+)\/(accept|decline)$/);
  if(followAction&&method==='POST'){
    const {farmer,response}=await requireFarmer(request);if(response)return response;const requester=decodeURIComponent(followAction[1]);const rows=await db.sql`SELECT 1 FROM follow_requests WHERE requester_id=${requester} AND target_id=${farmer.id}`;if(!rows.length)return json({error:'follow_request_not_found'},404);
    if(followAction[2]==='accept'){await db.sql`INSERT INTO follows (follower_id,followed_id) VALUES (${requester},${farmer.id}) ON CONFLICT DO NOTHING`;await db.sql`INSERT INTO notifications (farmer_id,message) VALUES (${requester},'Your AgriVerse follow request was accepted.')`;}
    await db.sql`DELETE FROM follow_requests WHERE requester_id=${requester} AND target_id=${farmer.id}`;return json({success:true,accepted:followAction[2]==='accept'});
  }
  if(pathname==='/api/agriverse/posts'&&method==='POST'){
    const {farmer,response}=await requireFarmer(request);if(response)return response;const b=await bodyJson(request);const kind=b.kind||'post';if(!['post','reel','video'].includes(kind))return json({error:'invalid_post_type'},400);
    const rows=await db.sql`INSERT INTO posts (farmer_id,kind,caption,media_url,thumbnail_url,title,description,crop,category,language,tags) VALUES (${farmer.id},${kind},${String(b.caption||'').trim()},${String(b.media_url||'').trim()},${String(b.thumbnail_url||'').trim()},${String(b.title||'').trim()},${String(b.description||'').trim()},${String(b.crop||'').trim()},${String(b.category||'').trim()},${String(b.language||'').trim()},${String(b.tags||'').trim()}) RETURNING *`;
    return json({post:await fullPost(rows[0],farmer.id)},201);
  }
  if(pathname==='/api/agriverse/upload'&&method==='POST'){
    const {farmer,response}=await requireFarmer(request);if(response)return response;const form=await request.formData();const video=form.get('video');const kind=String(form.get('kind')||'reel');const uploadAction=String(form.get('upload_action')||'');if(!['reel','video'].includes(kind)||(!['chunk','finalize'].includes(uploadAction)&&(!video||typeof video.arrayBuffer!=='function'||!video.name)))return json({error:'video_and_valid_kind_required'},400);
    if(uploadAction==='chunk'){
      if(!video||typeof video.arrayBuffer!=='function')return json({error:'video_and_valid_kind_required'},400);const index=Number(form.get('part_index')),total=Number(form.get('total_parts')),uploadId=String(form.get('upload_id')||'');if(video.size>4*1024*1024||!Number.isInteger(index)||!Number.isInteger(total)||total<1||total>40||index>=total)return json({error:'invalid_upload_chunk'},400);
      try{await saveUploadPart(farmer.id,uploadId,index,await video.arrayBuffer());return json({success:true,part:index});}catch{return json({error:'invalid_upload_chunk'},400);}
    }
    let media;
    if(uploadAction==='finalize'){
      try{media=await assembleUpload(farmer.id,String(form.get('upload_id')||''),Number(form.get('total_parts')),String(form.get('file_name')||'video.mp4'),String(form.get('content_type')||'video/mp4'),`agriverse-${farmer.id}`);}catch(error){return json({error:error.message==='upload_part_missing'?'upload_part_missing':'invalid_upload'},400);}
    }else{
      if(!video||typeof video.arrayBuffer!=='function')return json({error:'video_and_valid_kind_required'},400);
      if(video.size>4*1024*1024)return json({error:'video_upload_requires_chunks'},413);media=await saveUpload(video,`agriverse-${farmer.id}`);
    }
    const rows=await db.sql`INSERT INTO posts (farmer_id,kind,caption,media_url,thumbnail_url,title,description,crop,category,language,tags,media_kind) VALUES (${farmer.id},${kind},${String(form.get('caption')||'').trim()},${media},${String(form.get('thumbnail_url')||'').trim()},${String(form.get('title')||'').trim()},${String(form.get('description')||'').trim()},${String(form.get('crop')||'').trim()},${String(form.get('category')||'').trim()},${String(form.get('language')||'').trim()},${String(form.get('tags')||'').trim()},'video') RETURNING *`;
    return json({post:await fullPost(rows[0],farmer.id)},201);
  }
  const agriverseAction=pathname.match(/^\/api\/agriverse\/posts\/(\d+)\/(like|save|follow|comments)$/);
  if(agriverseAction){
    const id=Number(agriverseAction[1]);const action=agriverseAction[2];const rows=await db.sql`SELECT * FROM posts WHERE id=${id}`;if(!rows[0])return json({error:'post_not_found'},404);
    if(action==='comments'&&method==='GET'){const comments=await db.sql`SELECT c.body,c.created_at,f.name,f.username FROM comments c JOIN farmers f ON f.id=c.farmer_id WHERE c.post_id=${id} ORDER BY c.id`;return json({comments});}
    if(action==='comments'&&method==='POST'){const {farmer,response}=await requireFarmer(request);if(response)return response;const body=String((await bodyJson(request)).body||'').trim();if(!body)return json({error:'comment_required'},400);await db.sql`INSERT INTO comments (post_id,farmer_id,body) VALUES (${id},${farmer.id},${body})`;if(rows[0].farmer_id!==farmer.id)await db.sql`INSERT INTO notifications (farmer_id,message) VALUES (${rows[0].farmer_id},'A farmer commented on your field note.')`;return json({success:true},201);}
    if(method==='POST'&&action==='follow'){
      const {farmer,response}=await requireFarmer(request);if(response)return response;const target=rows[0].farmer_id;if(target===farmer.id)return json({error:'cannot_follow_self'},400);
      const active=await db.sql`SELECT 1 FROM follows WHERE follower_id=${farmer.id} AND followed_id=${target}`;if(active.length){await db.sql`DELETE FROM follows WHERE follower_id=${farmer.id} AND followed_id=${target}`;return json({active:false,pending:false});}
      const pending=await db.sql`SELECT 1 FROM follow_requests WHERE requester_id=${farmer.id} AND target_id=${target}`;if(pending.length){await db.sql`DELETE FROM follow_requests WHERE requester_id=${farmer.id} AND target_id=${target}`;return json({active:false,pending:false,cancelled:true});}
      await db.sql`INSERT INTO follow_requests(requester_id,target_id) VALUES (${farmer.id},${target}) ON CONFLICT DO NOTHING`;await db.sql`INSERT INTO notifications(farmer_id,message) VALUES (${target},'A farmer sent you an AgriVerse follow request.')`;return json({active:false,pending:true});
    }
    if(method==='POST'&&(action==='like'||action==='save')){const {farmer,response}=await requireFarmer(request);if(response)return response;const active=await toggle(action==='like'?'likes':'saves','post_id',id,'farmer_id',farmer.id);if(active&&rows[0].farmer_id!==farmer.id)await db.sql`INSERT INTO notifications(farmer_id,message) VALUES (${rows[0].farmer_id},${action==='like'?'A farmer liked your AgriVerse activity.':'A farmer saved your AgriVerse activity.'})`;return json({active});}
  }
  const agriverseDelete=pathname.match(/^\/api\/agriverse\/posts\/(\d+)$/);
  if(agriverseDelete&&method==='DELETE'){
    const {farmer,response}=await requireFarmer(request);if(response)return response;const id=Number(agriverseDelete[1]);const rows=await db.sql`SELECT * FROM posts WHERE id=${id}`;if(!rows[0])return json({error:'post_not_found'},404);if(rows[0].farmer_id!==farmer.id)return json({error:'unauthorized'},403);
    await db.sql`DELETE FROM likes WHERE post_id=${id}`;await db.sql`DELETE FROM saves WHERE post_id=${id}`;await db.sql`DELETE FROM comments WHERE post_id=${id}`;await db.sql`DELETE FROM posts WHERE id=${id}`;await removeUpload(rows[0].media_url);return json({success:true,deleted_count:1});
  }
  if(pathname==='/api/agriverse/content/bulk-delete'&&method==='POST'){
    const {farmer,response}=await requireFarmer(request);if(response)return response;const b=await bodyJson(request);const scope=b.scope||'selected';if(!['selected','reels','videos','all'].includes(scope))return json({error:'invalid_delete_scope'},400);
    const rows=await db.sql`SELECT * FROM posts WHERE farmer_id=${farmer.id} AND kind IN ('reel','video') ORDER BY id`;const selected=scope==='all'?rows:scope==='reels'?rows.filter(r=>r.kind==='reel'):scope==='videos'?rows.filter(r=>r.kind==='video'):rows.filter(r=>(b.ids||[]).map(Number).includes(Number(r.id)));
    if(scope==='selected'&&!selected.length)return json({error:'no_content_selected'},400);
    for(const row of selected){await db.sql`DELETE FROM likes WHERE post_id=${row.id}`;await db.sql`DELETE FROM saves WHERE post_id=${row.id}`;await db.sql`DELETE FROM comments WHERE post_id=${row.id}`;await db.sql`DELETE FROM posts WHERE id=${row.id}`;await removeUpload(row.media_url);}
    return json({success:true,deleted_count:selected.length,counts:{reels:selected.filter(r=>r.kind==='reel').length,videos:selected.filter(r=>r.kind==='video').length}});
  }
  if(pathname==='/api/agriverse/notifications'&&method==='GET'){
    const {farmer,response}=await requireFarmer(request);if(response)return response;return json({notifications:await db.sql`SELECT id,message,read,created_at FROM notifications WHERE farmer_id=${farmer.id} ORDER BY id DESC`});
  }
  if(pathname==='/api/agriverse/conversations'&&method==='GET'){
    const {farmer,response}=await requireFarmer(request);if(response)return response;const convs=await db.sql`SELECT * FROM conversations WHERE user1_id=${farmer.id} OR user2_id=${farmer.id} ORDER BY updated_at DESC`;const result=[];
    for(const conv of convs){const other=conv.user1_id===farmer.id?conv.user2_id:conv.user1_id;const users=await db.sql`SELECT * FROM farmers WHERE id=${other}`;const messages=await db.sql`SELECT body FROM messages WHERE conversation_id=${conv.id} ORDER BY id DESC LIMIT 1`;result.push({id:conv.id,other_user:farmerPayload(users[0]),updated_at:conv.updated_at,last_message:messages[0]?.body||''});}return json({conversations:result});
  }
  if(pathname==='/api/agriverse/conversations/start'&&method==='POST'){
    const {farmer,response}=await requireFarmer(request);if(response)return response;const target=(await bodyJson(request)).target_id;if(!target||target===farmer.id)return json({error:'invalid_target'},400);const old=await db.sql`SELECT id FROM conversations WHERE (user1_id=${farmer.id} AND user2_id=${target}) OR (user1_id=${target} AND user2_id=${farmer.id})`;const row=old[0]|| (await db.sql`INSERT INTO conversations(user1_id,user2_id) VALUES (${farmer.id},${target}) RETURNING id`)[0];return json({conversation_id:row.id});
  }
  const messages=pathname.match(/^\/api\/agriverse\/conversations\/(\d+)\/messages$/);
  if(messages){const id=Number(messages[1]);const {farmer,response}=await requireFarmer(request);if(response)return response;const convs=await db.sql`SELECT * FROM conversations WHERE id=${id}`;const conv=convs[0];if(!conv||![conv.user1_id,conv.user2_id].includes(farmer.id))return json({error:'unauthorized'},403);
    if(method==='GET')return json({messages:await db.sql`SELECT * FROM messages WHERE conversation_id=${id} ORDER BY id`});
    if(method==='POST'){const body=String((await bodyJson(request)).body||'').trim();if(!body)return json({error:'message_required'},400);await db.sql`INSERT INTO messages(conversation_id,sender_id,body) VALUES (${id},${farmer.id},${body})`;await db.sql`UPDATE conversations SET updated_at=NOW() WHERE id=${id}`;const target=conv.user1_id===farmer.id?conv.user2_id:conv.user1_id;await db.sql`INSERT INTO notifications(farmer_id,message) VALUES (${target},'You have a new message.')`;return json({success:true});}
  }
  return null;
}
