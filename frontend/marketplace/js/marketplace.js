const marketplaceApi = async (url, options = {}) => {
  const response = await fetch(url, { credentials: 'include', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
};

const escapeMarketplace = value => String(value ?? '').replace(/[&<>\"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;' }[character]));
const imageFor = product => product.images?.[0] || '/_frontend/assets/images/background1.jpg';
const money = value => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

async function updateCartCount() {
  const count = document.querySelector('[data-cart-count]');
  if (!count) return;
  try {
    const data = await marketplaceApi('/api/marketplace/cart');
    count.textContent = data.items.reduce((total, item) => total + Number(item.cart_quantity || 0), 0);
    count.hidden = !data.items.length;
  } catch {
    count.hidden = true;
  }
}

function productCard(product) {
  const available = Number(product.quantity) > 0 && product.status === 'available';
  return `<article class="product-card ${available ? '' : 'is-unavailable'}">
    <a class="product-image-link" href="product-details.html?id=${encodeURIComponent(product.id)}"><img loading="lazy" src="${escapeMarketplace(imageFor(product))}" alt="${escapeMarketplace(product.name)}" onerror="this.src='/_frontend/assets/images/background1.jpg'"></a>
    <div class="body"><div class="card-kicker">${escapeMarketplace(product.category)} ${product.organic ? '<span class="badge">Organic</span>' : ''}</div>
    <h3><a href="product-details.html?id=${encodeURIComponent(product.id)}">${escapeMarketplace(product.name)}</a></h3>
    <p class="product-meta">${escapeMarketplace(product.farmer?.name || 'Farmer')} · ${escapeMarketplace(product.farmer_profile?.village || product.village || 'Location pending')}</p>
    <p class="product-meta">${available ? `${escapeMarketplace(product.quantity)} ${escapeMarketplace(product.unit)} available` : 'Currently unavailable'} · ★ ${Number(product.rating || 0).toFixed(1)}</p>
    <div class="price">${money(product.price)} <small>/ ${escapeMarketplace(product.unit)}</small></div>
    <div class="actions"><button class="icon-button" type="button" data-wishlist="${product.id}" aria-label="Add ${escapeMarketplace(product.name)} to wishlist">♡</button><button type="button" data-buy="${product.id}" data-min="${product.min_order_quantity}" ${available ? '' : 'disabled'}>Buy now</button><button class="button alt" type="button" data-add="${product.id}" data-min="${product.min_order_quantity}" ${available ? '' : 'disabled'}>${available ? 'Add to cart' : 'Out of stock'}</button></div></div></article>`;
}

async function renderProducts() {
  const root = document.querySelector('#product-grid');
  if (!root) return;
  root.innerHTML = '<div class="loading-state">Loading fresh products...</div>';
  try {
    const params = new URLSearchParams(new FormData(document.querySelector('#filters')));
    const { products } = await marketplaceApi(`/api/marketplace/products?${params}`);
    root.innerHTML = products.length ? products.map(productCard).join('') : '<div class="empty-state"><h3>No products found</h3><p>Try another category, location or price range.</p><button type="button" data-retry>Clear filters</button></div>';
  } catch (error) {
    root.innerHTML = `<div class="error-state"><h3>Products could not load</h3><p>${escapeMarketplace(error.message)}</p><button type="button" data-retry>Retry</button></div>`;
  }
}

document.addEventListener('click', async event => {
  const retry = event.target.closest('[data-retry]');
  if (retry) { document.querySelector('#filters')?.reset(); renderProducts(); return; }
  const add = event.target.closest('[data-add]');
  const buy = event.target.closest('[data-buy]');
  const wishlist = event.target.closest('[data-wishlist]');
  try {
    if (add || buy) {
      const productId = Number((add || buy).dataset.add || (add || buy).dataset.buy);
      const quantity = Number((add || buy).dataset.min) || 1;
      await marketplaceApi('/api/marketplace/cart/items', { method: 'POST', body: JSON.stringify({ product_id: productId, quantity }) });
      await updateCartCount();
      if (buy) window.location.href = 'checkout.html'; else { add.textContent = 'Added'; add.disabled = true; }
    }
    if (wishlist) { const result = await marketplaceApi(`/api/marketplace/wishlist/${wishlist.dataset.wishlist}`, { method: 'POST' }); wishlist.textContent = result.active ? '♥' : '♡'; }
  } catch (error) { if (error.message === 'authentication_required') { window.location.href = `../pages/login.html?next=${encodeURIComponent(window.location.pathname + window.location.search)}`; return; } const message = document.querySelector('#page-message'); if (message) message.textContent = error.message; else window.alert(error.message); }
});

document.querySelector('#filters')?.addEventListener('input', renderProducts);
document.querySelector('#filters')?.addEventListener('change', renderProducts);
updateCartCount();
renderProducts();
