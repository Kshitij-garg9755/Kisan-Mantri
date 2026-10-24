import { randomBytes } from 'node:crypto';
import { db, json, bodyJson, requireFarmer, currentFarmer } from './common.mjs';
import { saveUpload } from './uploads.mjs';

function productInput(data) {
  const required=['name','category','product_type','price','unit','quantity'];
  if(required.some(k=>!String(data[k]??'').trim()))return {error:'product_required_fields_missing'};
  const price=Number(data.price), quantity=Number(data.quantity), min=Number(data.min_order_quantity||1);
  if(!Number.isFinite(price)||!Number.isFinite(quantity)||!Number.isFinite(min))return {error:'invalid_product_numbers'};
  if(price<0||quantity<0||min<=0||min>quantity)return {error:'invalid_product_quantity'};
  return {product:{name:String(data.name).trim().slice(0,120),category:String(data.category).trim().slice(0,60),product_type:String(data.product_type).trim().slice(0,40),description:String(data.description||'').trim().slice(0,3000),price,unit:String(data.unit).trim().slice(0,30),quantity,min_order_quantity:min,organic:['true','1','on',1,true].includes(data.organic)?1:0,harvest_date:String(data.harvest_date||'').slice(0,30),delivery_time:String(data.delivery_time||'').slice(0,120),village:String(data.village||'').slice(0,120),farm_location:String(data.farm_location||'').slice(0,300),quality_details:String(data.quality_details||'').slice(0,1000)}};
}

async function productPayload(row) {
  const [images,farmer,profile,reviews]=await Promise.all([
    db.sql`SELECT image_url FROM product_images WHERE product_id=${row.id} ORDER BY id`,
    db.sql`SELECT id,name,phone,username FROM farmers WHERE id=${row.owner_id}`,
    db.sql`SELECT village,district,state,farm_name,verification_status FROM farmer_profiles WHERE user_id=${row.owner_id}`,
    db.sql`SELECT r.rating,r.body,r.created_at,f.name AS reviewer_name FROM reviews r JOIN farmers f ON f.id=r.reviewer_id WHERE r.product_id=${row.id} ORDER BY r.id DESC LIMIT 20`,
  ]);
  return {...row,organic:Boolean(row.organic),images:images.map(x=>x.image_url),farmer:farmer[0]||null,farmer_profile:profile[0]||null,reviews};
}

async function ensureCart(userId){return db.sql`INSERT INTO carts (buyer_id) VALUES (${userId}) ON CONFLICT (buyer_id) DO UPDATE SET buyer_id=EXCLUDED.buyer_id RETURNING id`}

export async function dispatchMarketplace(request, pathname) {
  const method=request.method.toUpperCase(), url=new URL(request.url);
  if(pathname==='/api/marketplace/health'&&method==='GET')return json({section:'farmer_marketplace',status:'ready'});
  if(pathname==='/api/products'&&method==='GET')return json([
    {name:'Wheat',category:'Grain',price:1200,units:820,stock:'In Stock',currency:'₹'},
    {name:'Rice',category:'Grain',price:860,units:640,stock:'In Stock',currency:'₹'},
    {name:'Tomato',category:'Vegetable',price:40,units:980,stock:'In Stock',currency:'₹/kg'},
    {name:'Green Peas',category:'Vegetable',price:95,units:420,stock:'In Stock',currency:'₹/kg'},
    {name:'Pulses',category:'Grain',price:860,units:530,stock:'Low',currency:'₹'},
    {name:'Cabbage',category:'Vegetable',price:35,units:610,stock:'In Stock',currency:'₹/kg'},
    {name:'Eggplant',category:'Vegetable',price:70,units:380,stock:'Low',currency:'₹/kg'},
  ]);
  if(pathname==='/api/marketplace/become-seller'&&method==='POST'){
    const {farmer,response}=await requireFarmer(request);if(response)return response;const b=await bodyJson(request);
    await db.sql`UPDATE farmers SET role='seller' WHERE id=${farmer.id}`;
    const rows=await db.sql`INSERT INTO farmer_profiles(user_id,village,district,state,farm_name,about) VALUES (${farmer.id},${String(b.village||'').trim().slice(0,120)},${String(b.district||'').trim().slice(0,120)},${String(b.state||'').trim().slice(0,120)},${String(b.farm_name||'').trim().slice(0,160)},${String(b.about||'').trim().slice(0,2000)}) ON CONFLICT(user_id) DO UPDATE SET village=EXCLUDED.village,district=EXCLUDED.district,state=EXCLUDED.state,farm_name=EXCLUDED.farm_name,about=EXCLUDED.about RETURNING *`;
    return json({profile:rows[0],verification_status:rows[0].verification_status},201);
  }
  const farmerProfile=pathname.match(/^\/api\/marketplace\/farmer-profile\/([^/]+)$/);
  if(farmerProfile&&(method==='GET'||method==='PUT')){
    const id=decodeURIComponent(farmerProfile[1]);const viewer=await currentFarmer(request);if(method==='PUT'&&viewer?.id!==id)return json({error:'unauthorized'},403);
    const farmers=await db.sql`SELECT id,name,phone,username,role FROM farmers WHERE id=${id} AND blocked=0`;if(!farmers.length)return json({error:'farmer_not_found'},404);
    if(method==='PUT'){const b=await bodyJson(request);await db.sql`INSERT INTO farmer_profiles(user_id,village,district,state,farm_name,about) VALUES (${id},${String(b.village||'').slice(0,200)},${String(b.district||'').slice(0,200)},${String(b.state||'').slice(0,200)},${String(b.farm_name||'').slice(0,200)},${String(b.about||'').slice(0,2000)}) ON CONFLICT(user_id) DO UPDATE SET village=EXCLUDED.village,district=EXCLUDED.district,state=EXCLUDED.state,farm_name=EXCLUDED.farm_name,about=EXCLUDED.about`}
    const profiles=await db.sql`SELECT * FROM farmer_profiles WHERE user_id=${id}`;const rows=await db.sql`SELECT * FROM products WHERE owner_id=${id} AND status!='deleted' ORDER BY id DESC`;const products=[];for(const row of rows)products.push(await productPayload(row));const counts=await db.sql`SELECT COUNT(*) AS count FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.seller_id=${id} AND o.status='delivered'`;
    return json({farmer:farmers[0],profile:profiles[0]||null,products,completed_orders:Number(counts[0].count)});
  }
  if(pathname==='/api/marketplace/products'&&method==='GET'){
    const q=(url.searchParams.get('q')||'').toLowerCase(),category=url.searchParams.get('category')||'',type=url.searchParams.get('product_type')||'',location=(url.searchParams.get('location')||'').toLowerCase(),organic=['1','true'].includes(url.searchParams.get('organic')||'');
    const min=url.searchParams.has('min_price')?Number(url.searchParams.get('min_price')):null,max=url.searchParams.has('max_price')?Number(url.searchParams.get('max_price')):null;if((min!==null&&!Number.isFinite(min))||(max!==null&&!Number.isFinite(max)))return json({error:'invalid_price_filter'},400);
    const sort=url.searchParams.get('sort')||'latest';const order=sort==='price_asc'?'price ASC':sort==='price_desc'?'price DESC':sort==='rating'?'rating DESC,review_count DESC':'created_at DESC';
    const rows=await db.sql.unsafe(`SELECT p.* FROM products p LEFT JOIN farmer_profiles fp ON fp.user_id=p.owner_id WHERE p.status='available' AND p.quantity>0 AND ($1='' OR lower(p.name||' '||p.description||' '||p.category) LIKE '%'||$1||'%') AND ($2='' OR p.category=$2) AND ($3='' OR p.product_type=$3) AND ($4='' OR lower(coalesce(p.village,'')||' '||coalesce(fp.district,'')||' '||coalesce(fp.state,'')) LIKE '%'||$4||'%') AND ($5::boolean=false OR p.organic=1) AND ($6::double precision IS NULL OR p.price >= $6) AND ($7::double precision IS NULL OR p.price <= $7) ORDER BY ${order},p.id DESC LIMIT 100`,[q,category,type,location,organic,min,max]);
    const products=[];for(const row of rows)products.push(await productPayload(row));return json({products,count:products.length});
  }
  if(pathname==='/api/marketplace/products'&&method==='POST'){
    const {farmer,response}=await requireFarmer(request);if(response)return response;const b=await bodyJson(request);const parsed=productInput(b);if(parsed.error)return json({error:parsed.error},400);if(!['seller','admin','superadmin'].includes(farmer.role))return json({error:'seller_profile_required'},403);const p=parsed.product;
    const cols=Object.keys(p);const vals=cols.map(k=>p[k]);const rows=await db.sql.unsafe(`INSERT INTO products(owner_id,${cols.join(',')}) VALUES ($${vals.length+1},${vals.map((_,i)=>`$${i+1}`).join(',')}) RETURNING *`,[...vals,farmer.id]);
    for(const image of (Array.isArray(b.images)?b.images:[])){if(typeof image==='string'&&(/^\/uploads\//i.test(image)||/^https?:\/\//i.test(image)))await db.sql`INSERT INTO product_images(product_id,image_url) VALUES (${rows[0].id},${image.slice(0,500)})`;}
    await db.sql`INSERT INTO notifications(farmer_id,message) VALUES (${farmer.id},'Product listed successfully.')`;return json({product:await productPayload(rows[0])},201);
  }
  const productMatch=pathname.match(/^\/api\/marketplace\/products\/(\d+)$/);
  if(productMatch){const id=Number(productMatch[1]);const rows=await db.sql`SELECT * FROM products WHERE id=${id}`;const row=rows[0];if(!row)return json({error:'product_not_found'},404);
    if(method==='GET')return json({product:await productPayload(row)});
    const {farmer,response}=await requireFarmer(request);if(response)return response;if(row.owner_id!==farmer.id)return json({error:'product_owner_required'},403);
    if(method==='DELETE'){await db.sql`UPDATE products SET status='deleted',updated_at=NOW() WHERE id=${id}`;return json({success:true});}
    if(method==='PUT'){const b=await bodyJson(request);const parsed=productInput({...row,...b});if(parsed.error)return json({error:parsed.error},400);const p=parsed.product;const cols=Object.keys(p);const vals=cols.map(k=>p[k]);await db.sql.unsafe(`UPDATE products SET ${cols.map((k,i)=>`${k}=$${i+1}`).join(',')},status=$${vals.length+1},updated_at=NOW() WHERE id=$${vals.length+2}`,[...vals,String(b.status||row.status),id]);return json({product:await productPayload((await db.sql`SELECT * FROM products WHERE id=${id}`)[0])});}
    return json({error:'method_not_allowed'},405);
  }
  if(pathname==='/api/marketplace/wishlist'&&method==='GET'){
    const {farmer,response}=await requireFarmer(request);if(response)return response;const rows=await db.sql`SELECT p.* FROM wishlists w JOIN products p ON p.id=w.product_id WHERE w.buyer_id=${farmer.id} AND p.status!='deleted' ORDER BY w.created_at DESC`;const products=[];for(const row of rows)products.push(await productPayload(row));return json({products});
  }
  const wish=pathname.match(/^\/api\/marketplace\/wishlist\/(\d+)$/);
  if(wish&&method==='POST'){
    const {farmer,response}=await requireFarmer(request);if(response)return response;const id=Number(wish[1]);const p=await db.sql`SELECT id FROM products WHERE id=${id} AND status!='deleted'`;if(!p.length)return json({error:'product_not_found'},404);const e=await db.sql`SELECT 1 FROM wishlists WHERE buyer_id=${farmer.id} AND product_id=${id}`;if(e.length)await db.sql`DELETE FROM wishlists WHERE buyer_id=${farmer.id} AND product_id=${id}`;else await db.sql`INSERT INTO wishlists(buyer_id,product_id) VALUES (${farmer.id},${id}) ON CONFLICT DO NOTHING`;return json({active:!e.length});
  }
  if(pathname==='/api/marketplace/cart'&&method==='GET'){
    const {farmer,response}=await requireFarmer(request);if(response)return response;const cart=(await ensureCart(farmer.id))[0];const rows=await db.sql`SELECT ci.product_id,ci.quantity AS cart_quantity,p.* FROM cart_items ci JOIN products p ON p.id=ci.product_id WHERE ci.cart_id=${cart.id} AND p.status!='deleted' ORDER BY ci.product_id`;const items=[];for(const row of rows)items.push(await productPayload(row));const subtotal=Math.round(items.reduce((sum,item)=>sum+Number(item.price)*Number(item.cart_quantity),0)*100)/100;const delivery_charge=subtotal>=500||subtotal===0?0:50;const tax=Math.round(subtotal*0.05*100)/100;return json({items,subtotal,delivery_charge,tax,total:Math.round((subtotal+delivery_charge+tax)*100)/100});
  }
  if(pathname==='/api/marketplace/cart/items'&&method==='POST'){
    const {farmer,response}=await requireFarmer(request);if(response)return response;const b=await bodyJson(request);const productId=Number(b.product_id),quantity=Number(b.quantity);if(!Number.isInteger(productId)||!Number.isFinite(quantity)||quantity<=0)return json({error:'valid_product_and_quantity_required'},400);
    const products=await db.sql`SELECT * FROM products WHERE id=${productId} AND status='available'`;const product=products[0];if(!product||quantity<Number(product.min_order_quantity))return json({error:'invalid_product_or_minimum_quantity'},400);const cart=(await ensureCart(farmer.id))[0];const old=await db.sql`SELECT quantity FROM cart_items WHERE cart_id=${cart.id} AND product_id=${productId}`;const next=quantity+Number(old[0]?.quantity||0);if(next>Number(product.quantity))return json({error:'insufficient_stock',available:product.quantity},409);await db.sql`INSERT INTO cart_items(cart_id,product_id,quantity) VALUES (${cart.id},${productId},${next}) ON CONFLICT(cart_id,product_id) DO UPDATE SET quantity=EXCLUDED.quantity`;return json({success:true},201);
  }
  const cartItem=pathname.match(/^\/api\/marketplace\/cart\/items\/(\d+)$/);
  if(cartItem&&(method==='PATCH'||method==='DELETE')){
    const {farmer,response}=await requireFarmer(request);if(response)return response;const productId=Number(cartItem[1]);const carts=await db.sql`SELECT c.id AS cart_id,p.quantity AS stock FROM cart_items ci JOIN carts c ON c.id=ci.cart_id JOIN products p ON p.id=ci.product_id WHERE c.buyer_id=${farmer.id} AND ci.product_id=${productId}`;if(method==='DELETE'){await db.sql`DELETE FROM cart_items WHERE product_id=${productId} AND cart_id IN (SELECT id FROM carts WHERE buyer_id=${farmer.id})`;return json({success:true});}if(!carts[0])return json({error:'cart_item_not_found'},404);const quantity=Number((await bodyJson(request)).quantity);if(quantity<=0)await db.sql`DELETE FROM cart_items WHERE cart_id=${carts[0].cart_id} AND product_id=${productId}`;else if(quantity>Number(carts[0].stock))return json({error:'insufficient_stock',available:carts[0].stock},409);else await db.sql`UPDATE cart_items SET quantity=${quantity} WHERE cart_id=${carts[0].cart_id} AND product_id=${productId}`;return json({success:true});
  }
  if(pathname==='/api/marketplace/addresses'&&method==='GET'){
    const {farmer,response}=await requireFarmer(request);if(response)return response;return json({addresses:await db.sql`SELECT * FROM addresses WHERE user_id=${farmer.id} ORDER BY is_default DESC,id DESC`});
  }
  if(pathname==='/api/marketplace/addresses'&&method==='POST'){
    const {farmer,response}=await requireFarmer(request);if(response)return response;const b=await bodyJson(request);for(const k of ['recipient_name','phone','line1','state','postal_code'])if(!String(b[k]||'').trim())return json({error:'address_required_fields_missing'},400);if(b.is_default)await db.sql`UPDATE addresses SET is_default=0 WHERE user_id=${farmer.id}`;
    const rows=await db.sql`INSERT INTO addresses(user_id,label,recipient_name,phone,line1,village,district,state,postal_code,is_default) VALUES (${farmer.id},${String(b.label||'Home').slice(0,40)},${String(b.recipient_name).trim().slice(0,120)},${String(b.phone).trim().slice(0,20)},${String(b.line1).trim().slice(0,300)},${String(b.village||'').slice(0,120)},${String(b.district||'').slice(0,120)},${String(b.state).trim().slice(0,120)},${String(b.postal_code).trim().slice(0,12)},${b.is_default?1:0}) RETURNING *`;return json({address:rows[0]},201);
  }

  if(pathname==='/api/marketplace/upload-image'&&method==='POST'){
    const {farmer,response}=await requireFarmer(request);if(response)return response;const form=await request.formData();const image=form.get('image');if(!image||typeof image.arrayBuffer!=='function'||!image.name)return json({error:'image_required'},400);if(image.size>4*1024*1024||!/\.(jpg|jpeg|png|webp)$/i.test(image.name))return json({error:'invalid_image_type_or_size'},400);return json({image_url:await saveUpload(image,`market-${farmer.id}`)},201);
  }

  const review=pathname.match(/^\/api\/marketplace\/products\/(\d+)\/reviews$/);
  if(review&&method==='POST'){
    const {farmer,response}=await requireFarmer(request);if(response)return response;const b=await bodyJson(request);const rating=Number(b.rating);if(!Number.isInteger(rating))return json({error:'rating_required'},400);if(rating<1||rating>5)return json({error:'rating_must_be_between_1_and_5'},400);const productId=Number(review[1]);const delivered=await db.sql`SELECT oi.order_id FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.product_id=${productId} AND o.buyer_id=${farmer.id} AND o.status='delivered' LIMIT 1`;if(!delivered.length)return json({error:'review_requires_delivered_order'},403);
    try{await db.sql`INSERT INTO reviews(product_id,order_id,reviewer_id,rating,body) VALUES (${productId},${delivered[0].order_id},${farmer.id},${rating},${String(b.body||'').trim().slice(0,1000)})`;}catch{return json({error:'review_already_submitted'},409);}await db.sql`UPDATE products SET rating=(SELECT ROUND(AVG(rating)::numeric,2) FROM reviews WHERE product_id=${productId}),review_count=(SELECT COUNT(*) FROM reviews WHERE product_id=${productId}) WHERE id=${productId}`;return json({success:true},201);
  }
  if(pathname==='/api/marketplace/checkout'&&method==='POST'){
    const {farmer,response}=await requireFarmer(request);if(response)return response;const b=await bodyJson(request);const addressId=Number(b.address_id);if(!Number.isInteger(addressId))return json({error:'address_required'},400);const client=await db.pool.connect();
    try{
      await client.query('BEGIN');const address=(await client.query('SELECT id FROM addresses WHERE id=$1 AND user_id=$2',[addressId,farmer.id])).rows[0];const cart=(await client.query('SELECT id FROM carts WHERE buyer_id=$1',[farmer.id])).rows[0];if(!address||!cart){await client.query('ROLLBACK');return json({error:'address_or_cart_not_found'},400);}
      const items=(await client.query("SELECT ci.product_id,ci.quantity,p.price,p.name,p.unit,p.owner_id,p.quantity AS stock,p.min_order_quantity FROM cart_items ci JOIN products p ON p.id=ci.product_id WHERE ci.cart_id=$1 AND p.status='available' ORDER BY ci.product_id FOR UPDATE OF p",[cart.id])).rows;if(!items.length){await client.query('ROLLBACK');return json({error:'cart_empty'},400);}
      let subtotal=0;for(const item of items){if(Number(item.quantity)>Number(item.stock)||Number(item.quantity)<Number(item.min_order_quantity)){await client.query('ROLLBACK');return json({error:'stock_changed',product_id:item.product_id},409);}subtotal+=Number(item.price)*Number(item.quantity);}
      const delivery=subtotal>=500?0:50,tax=Math.round(subtotal*0.05*100)/100,total=Math.round((subtotal+delivery+tax)*100)/100,orderNumber=`SF-${randomBytes(5).toString('hex').toUpperCase()}`;
      const order=(await client.query("INSERT INTO orders(order_number,buyer_id,address_id,subtotal,delivery_charge,tax,total,payment_status,status) VALUES ($1,$2,$3,$4,$5,$6,$7,'pending','placed') RETURNING *",[orderNumber,farmer.id,addressId,subtotal,delivery,tax,total])).rows[0];
      for(const item of items){const upd=await client.query("UPDATE products SET quantity=quantity-$1,updated_at=NOW() WHERE id=$2 AND quantity >= $1",[item.quantity,item.product_id]);if(!upd.rowCount)throw new Error('stock_changed');await client.query('INSERT INTO order_items(order_id,product_id,seller_id,product_name,unit,quantity,unit_price,line_total) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',[order.id,item.product_id,item.owner_id,item.name,item.unit,item.quantity,item.price,Number(item.price)*Number(item.quantity)]);await client.query('INSERT INTO notifications(farmer_id,message) VALUES ($1,$2)',[item.owner_id,`New order received: ${orderNumber}.`]);}
      await client.query('INSERT INTO payments(order_id,provider,status,amount) VALUES ($1,$2,$3,$4)',[order.id,String(b.payment_method||'cod').slice(0,30),'pending',total]);await client.query("INSERT INTO delivery_assignments(order_id,status) VALUES ($1,'searching')",[order.id]);await client.query('DELETE FROM cart_items WHERE cart_id=$1',[cart.id]);await client.query('COMMIT');return json({order},201);
    }catch(error){await client.query('ROLLBACK');if(error.message==='stock_changed')return json({error:'stock_changed'},409);throw error;}finally{client.release();}
  }
  if(pathname==='/api/marketplace/orders'&&method==='GET'){
    const {farmer,response}=await requireFarmer(request);if(response)return response;const orders=await db.sql`SELECT * FROM orders WHERE buyer_id=${farmer.id} ORDER BY id DESC`;const result=[];
    for(const order of orders){const items=await db.sql`SELECT * FROM order_items WHERE order_id=${order.id}`;const delivery=await db.sql`SELECT da.*,f.name AS partner_name,f.phone AS partner_phone,dpp.vehicle_type,dpp.vehicle_number FROM delivery_assignments da LEFT JOIN farmers f ON f.id=da.partner_id LEFT JOIN delivery_partner_profiles dpp ON dpp.user_id=da.partner_id WHERE da.order_id=${order.id}`;result.push({...order,items,delivery:delivery[0]||null});}return json({orders:result});
  }
  const cancelOrder=pathname.match(/^\/api\/marketplace\/orders\/(\d+)\/cancel$/);
  if(cancelOrder&&method==='PATCH'){
    const {farmer,response}=await requireFarmer(request);if(response)return response;const id=Number(cancelOrder[1]);const client=await db.pool.connect();try{await client.query('BEGIN');const order=(await client.query('SELECT * FROM orders WHERE id=$1 AND buyer_id=$2 FOR UPDATE',[id,farmer.id])).rows[0];if(!order){await client.query('ROLLBACK');return json({error:'order_not_found'},404);}if(!['placed','confirmed'].includes(order.status)){await client.query('ROLLBACK');return json({error:'order_cannot_be_cancelled'},409);}const items=(await client.query('SELECT product_id,quantity,seller_id FROM order_items WHERE order_id=$1',[id])).rows;for(const item of items){await client.query('UPDATE products SET quantity=quantity+$1,updated_at=NOW() WHERE id=$2',[item.quantity,item.product_id]);await client.query('INSERT INTO notifications(farmer_id,message) VALUES ($1,$2)',[item.seller_id,`Order ${order.order_number} was cancelled by the buyer.`]);}await client.query("UPDATE orders SET status='cancelled',updated_at=NOW() WHERE id=$1",[id]);await client.query("UPDATE delivery_assignments SET status='cancelled' WHERE order_id=$1",[id]);await client.query('COMMIT');return json({success:true,status:'cancelled'});}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  }
  if(pathname==='/api/marketplace/farmer/orders'&&method==='GET'){
    const {farmer,response}=await requireFarmer(request);if(response)return response;const orders=await db.sql`SELECT DISTINCT o.*,a.recipient_name,a.phone,a.line1,a.district,a.state FROM orders o JOIN order_items oi ON oi.order_id=o.id JOIN addresses a ON a.id=o.address_id WHERE oi.seller_id=${farmer.id} ORDER BY o.id DESC`;const result=[];for(const order of orders){result.push({...order,items:await db.sql`SELECT * FROM order_items WHERE order_id=${order.id} AND seller_id=${farmer.id}`});}return json({orders:result});
  }
  const sellerStatus=pathname.match(/^\/api\/marketplace\/farmer\/orders\/(\d+)\/status$/);
  if(sellerStatus&&method==='PATCH'){
    const {farmer,response}=await requireFarmer(request);if(response)return response;const status=(await bodyJson(request)).status;if(!['confirmed','preparing','ready_for_pickup','cancelled'].includes(status))return json({error:'invalid_farmer_status'},400);const rows=await db.sql`SELECT DISTINCT o.id,o.buyer_id FROM orders o JOIN order_items oi ON oi.order_id=o.id WHERE o.id=${Number(sellerStatus[1])} AND oi.seller_id=${farmer.id}`;if(!rows.length)return json({error:'seller_order_not_found'},404);await db.sql`UPDATE orders SET status=${status},updated_at=NOW() WHERE id=${Number(sellerStatus[1])} AND status NOT IN ('delivered','cancelled')`;await db.sql`INSERT INTO notifications(farmer_id,message) VALUES (${rows[0].buyer_id},${`Order ${sellerStatus[1]} status updated: ${status}.`})`;return json({success:true,status});
  }
  if(pathname==='/api/marketplace/delivery-partner'&&method==='POST'){
    const {farmer,response}=await requireFarmer(request);if(response)return response;const b=await bodyJson(request);if(!String(b.vehicle_type||'').trim()||!String(b.service_area||'').trim())return json({error:'vehicle_and_service_area_required'},400);await db.sql`UPDATE farmers SET role='delivery_partner' WHERE id=${farmer.id}`;const rows=await db.sql`INSERT INTO delivery_partner_profiles(user_id,vehicle_type,vehicle_number,service_area) VALUES (${farmer.id},${String(b.vehicle_type).trim().slice(0,50)},${String(b.vehicle_number||'').trim().slice(0,30)},${String(b.service_area).trim().slice(0,200)}) ON CONFLICT(user_id) DO UPDATE SET vehicle_type=EXCLUDED.vehicle_type,vehicle_number=EXCLUDED.vehicle_number,service_area=EXCLUDED.service_area RETURNING *`;return json({profile:rows[0]},201);
  }
  if(pathname==='/api/marketplace/delivery-partner'&&method==='PATCH'){
    const {farmer,response}=await requireFarmer(request);if(response)return response;const availability=(await bodyJson(request)).availability_status;if(!['available','offline','busy'].includes(availability))return json({error:'invalid_availability_status'},400);const rows=await db.sql`UPDATE delivery_partner_profiles SET availability_status=${availability} WHERE user_id=${farmer.id} RETURNING user_id`;if(!rows.length)return json({error:'delivery_partner_profile_required'},404);return json({success:true,availability_status:availability});
  }
  if(pathname==='/api/marketplace/delivery/requests'&&method==='GET'){
    const {farmer,response}=await requireFarmer(request);if(response)return response;const profile=await db.sql`SELECT verification_status FROM delivery_partner_profiles WHERE user_id=${farmer.id}`;if(!profile.length||profile[0].verification_status!=='approved')return json({error:'verified_delivery_partner_required'},403);return json({requests:await db.sql`SELECT da.*,o.order_number,o.status AS order_status,a.line1,a.district,a.state FROM delivery_assignments da JOIN orders o ON o.id=da.order_id JOIN addresses a ON a.id=o.address_id WHERE da.status='searching' OR da.partner_id=${farmer.id} ORDER BY da.id DESC`});
  }
  const assignmentAccept=pathname.match(/^\/api\/marketplace\/delivery\/assignments\/(\d+)\/accept$/);
  if(assignmentAccept&&method==='POST'){
    const {farmer,response}=await requireFarmer(request);if(response)return response;const prof=await db.sql`SELECT verification_status,availability_status FROM delivery_partner_profiles WHERE user_id=${farmer.id}`;if(!prof.length||prof[0].verification_status!=='approved'||prof[0].availability_status!=='available')return json({error:'available_verified_partner_required'},403);const assigned=await db.sql`UPDATE delivery_assignments SET partner_id=${farmer.id},status='assigned',assigned_at=NOW() WHERE id=${Number(assignmentAccept[1])} AND status='searching' AND partner_id IS NULL RETURNING order_id`;if(!assigned.length)return json({error:'assignment_already_taken'},409);await db.sql`UPDATE orders SET status='assigned',updated_at=NOW() WHERE id=${assigned[0].order_id} AND status NOT IN ('cancelled','delivered')`;return json({success:true});
  }
  const assignmentStatus=pathname.match(/^\/api\/marketplace\/delivery\/assignments\/(\d+)\/status$/);
  if(assignmentStatus&&method==='PATCH'){
    const {farmer,response}=await requireFarmer(request);if(response)return response;const status=(await bodyJson(request)).status;if(!['picked_up','in_transit','near_delivery','delivered'].includes(status))return json({error:'invalid_delivery_status'},400);const rows=await db.sql`SELECT order_id FROM delivery_assignments WHERE id=${Number(assignmentStatus[1])} AND partner_id=${farmer.id}`;if(!rows.length)return json({error:'assigned_partner_required'},403);await db.sql`UPDATE delivery_assignments SET status=${status},completed_at=CASE WHEN ${status}='delivered' THEN NOW() ELSE completed_at END WHERE id=${Number(assignmentStatus[1])}`;await db.sql`UPDATE orders SET status=${status},updated_at=NOW() WHERE id=${rows[0].order_id}`;await db.sql`INSERT INTO notifications(farmer_id,message) SELECT buyer_id,${`Order delivery status updated: ${status}.`} FROM orders WHERE id=${rows[0].order_id}`;if(status==='delivered')await db.sql`UPDATE delivery_partner_profiles SET completed_deliveries=completed_deliveries+1,availability_status='available' WHERE user_id=${farmer.id}`;return json({success:true,status});
  }
  const location=pathname.match(/^\/api\/marketplace\/delivery\/assignments\/(\d+)\/location$/);
  if(location&&method==='POST'){
    const {farmer,response}=await requireFarmer(request);if(response)return response;const b=await bodyJson(request);const lat=Number(b.latitude),lng=Number(b.longitude);if(!Number.isFinite(lat)||!Number.isFinite(lng)||lat < -90||lat>90||lng < -180||lng>180)return json({error:'valid_coordinates_required'},400);const id=Number(location[1]);const rows=await db.sql`SELECT id FROM delivery_assignments WHERE id=${id} AND partner_id=${farmer.id} AND status NOT IN ('delivered','cancelled')`;if(!rows.length)return json({error:'active_assignment_required'},403);await db.sql`INSERT INTO delivery_locations(assignment_id,partner_id,latitude,longitude) VALUES (${id},${farmer.id},${lat},${lng})`;await db.sql`UPDATE delivery_partner_profiles SET current_lat=${lat},current_lng=${lng} WHERE user_id=${farmer.id}`;return json({success:true});
  }
  const tracking=pathname.match(/^\/api\/marketplace\/orders\/(\d+)\/tracking$/);
  if(tracking&&method==='GET'){
    const {farmer,response}=await requireFarmer(request);if(response)return response;const id=Number(tracking[1]);const order=(await db.sql`SELECT id,buyer_id,status FROM orders WHERE id=${id}`)[0];const assignment=(await db.sql`SELECT * FROM delivery_assignments WHERE order_id=${id}`)[0];if(!order||!assignment)return json({error:'tracking_not_found'},404);const seller=(await db.sql`SELECT seller_id FROM order_items WHERE order_id=${id} LIMIT 1`)[0];if(![order.buyer_id,assignment.partner_id,seller?.seller_id].includes(farmer.id))return json({error:'tracking_access_denied'},403);let locations=await db.sql`SELECT latitude,longitude,recorded_at FROM delivery_locations WHERE assignment_id=${assignment.id} ORDER BY id DESC LIMIT 20`;if(['delivered','cancelled'].includes(order.status))locations=[];return json({tracking:{...assignment,order_status:order.status,locations}});
  }

  return null;
}
