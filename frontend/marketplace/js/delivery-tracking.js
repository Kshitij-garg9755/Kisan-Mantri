const trackingRoot = document.querySelector('#tracking');
const orderId = new URLSearchParams(window.location.search).get('order');
const trackingLabels = { placed: 'Order placed', confirmed: 'Order confirmed', preparing: 'Farmer preparing your product', ready_for_pickup: 'Ready for pickup', assigned: 'Delivery partner assigned', picked_up: 'Picked up', in_transit: 'On the way', near_delivery: 'Near delivery', delivered: 'Delivered', cancelled: 'Cancelled' };
const trackingStages = ['placed', 'confirmed', 'preparing', 'ready_for_pickup', 'assigned', 'picked_up', 'in_transit', 'near_delivery', 'delivered'];
const safeTrackingText = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const trackingLogin = () => `../pages/login.html?next=${encodeURIComponent(location.pathname + location.search)}`;

(async () => {
  if (!orderId || !/^\d+$/.test(orderId)) { trackingRoot.innerHTML = '<section class="panel"><p class="notice">Open tracking from one of your orders to see its latest status.</p><a class="button" href="my-orders.html">My orders</a></section>'; return; }
  try {
    const response = await fetch(`/api/marketplace/orders/${encodeURIComponent(orderId)}/tracking`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (data.error === 'authentication_required') { location.href = trackingLogin(); return; }
      throw new Error(data.error || 'Tracking unavailable');
    }
    const tracking = data.tracking;
    const status = tracking.order_status;
    const currentIndex = trackingStages.indexOf(status);
    const timeline = status === 'cancelled' ? '<span class="status">Order cancelled</span>' : `<div class="timeline">${trackingStages.slice(0, Math.max(currentIndex + 1, 1)).map((stage, index) => `<span class="${index === currentIndex ? 'active' : ''}">${safeTrackingText(trackingLabels[stage] || stage)}</span>`).join('')}</div>`;
    const hasLocation = tracking.locations?.length > 0;
    trackingRoot.innerHTML = `<section class="panel tracking-card"><p class="card-kicker">LIVE ORDER UPDATE</p><h1>${safeTrackingText(trackingLabels[status] || status)}</h1>${timeline}<p>${hasLocation ? 'Your delivery partner shared a recent location.' : status === 'delivered' ? 'Your order has been delivered.' : status === 'cancelled' ? 'This order is no longer active.' : 'The order status will update here as the farmer and delivery partner prepare it.'}</p>${hasLocation ? '<div id="map" class="tracking-map"></div>' : ''}<a class="button alt" href="my-orders.html">Back to my orders</a></section>`;
    if (hasLocation && window.L) {
      const latest = tracking.locations[0];
      const map = L.map('map').setView([latest.latitude, latest.longitude], 12);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
      L.marker([latest.latitude, latest.longitude]).addTo(map).bindPopup('Delivery partner location').openPopup();
    }
  } catch (error) { trackingRoot.innerHTML = `<section class="panel error-state"><p>${safeTrackingText(error.message)}</p><a class="button alt" href="my-orders.html">My orders</a></section>`; }
})();
