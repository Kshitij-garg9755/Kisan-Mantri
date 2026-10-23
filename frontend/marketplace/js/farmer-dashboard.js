const dashboardRoot = document.querySelector('#dashboard');
let sellerOrdersRoot;
const escapeDashboard = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const sellerStatusLabel = { placed: 'New order', confirmed: 'Confirmed', preparing: 'Preparing', ready_for_pickup: 'Ready for pickup', assigned: 'Delivery assigned', picked_up: 'Picked up', in_transit: 'On the way', near_delivery: 'Near delivery', delivered: 'Delivered', cancelled: 'Cancelled' };
const sellerFetch = async (url, options = {}) => { const response = await fetch(url, options); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || 'Request failed'); return data; };
const loginForDashboard = () => `../pages/login.html?next=${encodeURIComponent(location.pathname + location.search)}`;

async function renderSellerOrders() {
  if (!sellerOrdersRoot) return;
  const { orders } = await sellerFetch('/api/marketplace/farmer/orders');
  sellerOrdersRoot.innerHTML = orders.length ? orders.map(order => {
    const controls = order.status === 'placed' ? `<button type="button" data-order-status="confirmed" data-order-id="${order.id}">Confirm order</button>`
      : order.status === 'confirmed' ? `<button type="button" data-order-status="preparing" data-order-id="${order.id}">Start preparing</button>`
      : order.status === 'preparing' ? `<button type="button" data-order-status="ready_for_pickup" data-order-id="${order.id}">Ready for pickup</button>` : '';
    const items = order.items.map(item => `${escapeDashboard(item.product_name)} x ${escapeDashboard(item.quantity)} ${escapeDashboard(item.unit)}`).join('<br>');
    return `<article class="panel seller-order-card"><div class="seller-order-head"><div><h3>${escapeDashboard(order.order_number)}</h3><span class="status">${escapeDashboard(sellerStatusLabel[order.status] || order.status)}</span></div><strong>INR ${Number(order.total).toLocaleString('en-IN')}</strong></div><p>${items}</p><p class="product-meta">Deliver to ${escapeDashboard(order.recipient_name)} - ${escapeDashboard(order.district || order.state || '')}</p><div class="actions">${controls}<a class="button alt" href="delivery-tracking.html?order=${order.id}">Track delivery</a></div></article>`;
  }).join('') : '<p class="notice">No buyer orders yet. Your new orders will show here.</p>';
}

(async () => {
  try {
    const { farmer } = await sellerFetch('/api/auth/me');
    if (!farmer) { location.href = loginForDashboard(); return; }
    if (!['seller', 'admin'].includes(farmer.role)) {
      dashboardRoot.innerHTML = '<section class="panel"><h2>Start selling from your farm</h2><p>Create a seller profile to publish products and receive buyer orders.</p><a class="button" href="farmer-profile.html">Set up seller profile</a></section>';
      sellerOrdersRoot?.closest('.seller-orders')?.remove();
      return;
    }
    const data = await sellerFetch(`/api/marketplace/farmer-profile/${encodeURIComponent(farmer.id)}`);
    dashboardRoot.innerHTML = `<section class="panel"><h2>${escapeDashboard(data.profile?.farm_name || farmer.name)}</h2><p>${escapeDashboard(data.profile?.village || '')}, ${escapeDashboard(data.profile?.district || '')} | ${escapeDashboard(data.profile?.verification_status || 'pending')} verification</p><p>${data.products.length} listed products | ${data.completed_orders} completed orders</p><a class="button" href="sell-product.html">Publish another product</a></section><section class="product-grid">${data.products.length ? data.products.map(product => `<article class="product-card"><img loading="lazy" src="${escapeDashboard(product.images?.[0] || '/_frontend/assets/images/background1.jpg')}" alt="${escapeDashboard(product.name)}"><div class="body"><h3>${escapeDashboard(product.name)}</h3><p>${escapeDashboard(product.quantity)} ${escapeDashboard(product.unit)} available</p><strong>INR ${Number(product.price).toLocaleString('en-IN')} / ${escapeDashboard(product.unit)}</strong><p class="product-meta">${escapeDashboard(product.status)}</p></div></article>`).join('') : '<p class="notice">No products listed yet. Publish your first product to reach buyers.</p>'}</section><section class="panel seller-orders"><h2>Buyer orders</h2><p>Review new orders and update buyers as you prepare their produce.</p><div id="seller-orders" class="stack">Loading buyer orders...</div></section>`;
    sellerOrdersRoot = document.querySelector('#seller-orders');
    await renderSellerOrders();
  } catch (error) {
    if (error.message === 'authentication_required') { location.href = loginForDashboard(); return; }
    dashboardRoot.textContent = error.message;
    if (sellerOrdersRoot) sellerOrdersRoot.textContent = error.message;
  }
})();

document.addEventListener('click', async event => {
  const button = event.target.closest('[data-order-status]');
  if (!button) return;
  button.disabled = true;
  try {
    await sellerFetch(`/api/marketplace/farmer/orders/${button.dataset.orderId}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: button.dataset.orderStatus }) });
    await renderSellerOrders();
  } catch (error) { button.disabled = false; window.alert(error.message); }
});
