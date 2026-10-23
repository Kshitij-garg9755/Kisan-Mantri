const orderRoot = document.querySelector('#orders');
const orderLabels = { placed: 'Order placed', confirmed: 'Order confirmed', preparing: 'Farmer preparing your product', ready_for_pickup: 'Ready for pickup', assigned: 'Delivery partner assigned', picked_up: 'Picked up', in_transit: 'In transit', near_delivery: 'Near delivery', delivered: 'Delivered', cancelled: 'Cancelled' };
const orderStages = ['placed', 'confirmed', 'preparing', 'ready_for_pickup', 'assigned', 'picked_up', 'in_transit', 'near_delivery', 'delivered'];
const escapeOrder = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const orderApi = async (url, options = {}) => { const response = await fetch(url, options); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || 'Request failed'); return data; };
const loginForOrders = () => `../pages/login.html?next=${encodeURIComponent(location.pathname + location.search)}`;

async function renderOrders() {
  orderRoot.innerHTML = '<p class="notice">Loading your orders...</p>';
  try {
    const { farmer } = await orderApi('/api/auth/me');
    if (!farmer) { location.href = loginForOrders(); return; }
    const { orders } = await orderApi('/api/marketplace/orders');
    if (!orders.length) { orderRoot.innerHTML = '<section class="panel empty-state"><h2>No orders yet</h2><p>When you buy from a farmer, your order and delivery updates will show here.</p><a class="button" href="marketplace.html">Explore products</a></section>'; return; }
    orderRoot.innerHTML = orders.map(order => {
      const currentIndex = orderStages.indexOf(order.status);
      const timeline = order.status === 'cancelled' ? `<span class="status">Order cancelled</span>` : `<div class="timeline">${orderStages.slice(0, Math.max(currentIndex + 1, 1)).map((stage, index) => `<span class="${index === currentIndex ? 'active' : ''}">${escapeOrder(orderLabels[stage])}</span>`).join('')}</div>`;
      const items = order.items.map(item => `${escapeOrder(item.product_name)} x ${escapeOrder(item.quantity)} ${escapeOrder(item.unit)}`).join('<br>');
      const cancel = ['placed', 'confirmed'].includes(order.status) ? `<button type="button" class="button alt" data-cancel-order="${order.id}">Cancel order</button>` : '';
      return `<article class="panel buyer-order"><div class="seller-order-head"><div><h2>${escapeOrder(order.order_number)}</h2><p>${new Date(order.created_at).toLocaleString()}</p></div><span class="status">${escapeOrder(orderLabels[order.status] || order.status)}</span></div>${timeline}<p>${items}</p><strong>INR ${Number(order.total).toLocaleString('en-IN')}</strong><div class="actions"><a class="button" href="delivery-tracking.html?order=${order.id}">Track delivery</a>${cancel}</div></article>`;
    }).join('');
  } catch (error) {
    if (error.message === 'authentication_required') { location.href = loginForOrders(); return; }
    orderRoot.innerHTML = `<section class="panel error-state"><h2>Orders could not load</h2><p>${escapeOrder(error.message)}</p><button type="button" data-retry-orders>Try again</button></section>`;
  }
}

document.addEventListener('click', async event => {
  if (event.target.closest('[data-retry-orders]')) return renderOrders();
  const cancel = event.target.closest('[data-cancel-order]');
  if (!cancel) return;
  cancel.disabled = true;
  try { await orderApi(`/api/marketplace/orders/${cancel.dataset.cancelOrder}/cancel`, { method: 'PATCH' }); await renderOrders(); }
  catch (error) { cancel.disabled = false; window.alert(error.message); }
});
renderOrders();
