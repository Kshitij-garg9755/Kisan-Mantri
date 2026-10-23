(() => {
  const root = document.querySelector('#items');
  const subtotal = document.querySelector('#subtotal');
  const total = document.querySelector('#total');
  if (!root) return;

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const money = value => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  const cartApi = async (url, options = {}) => {
    const response = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  };

  async function loadCart() {
    root.innerHTML = '<p class="cart-state">Loading your cart…</p>';
    try {
      const data = await cartApi('/api/marketplace/cart');
      subtotal.textContent = money(data.subtotal);
      total.textContent = money(data.total);
      if (!data.items.length) {
        root.innerHTML = '<div class="cart-state"><strong>Your cart is empty</strong><p>Browse fresh produce from nearby farmers.</p><a class="button" href="marketplace.html">Explore marketplace</a></div>';
        return;
      }
      root.innerHTML = data.items.map(item => {
        const image = item.images?.[0] || '/_frontend/assets/images/background1.jpg';
        const quantity = Number(item.cart_quantity || 1);
        const min = Number(item.min_order_quantity || 1);
        return `<article class="cart-item">
          <img src="${escapeHtml(image)}" alt="${escapeHtml(item.name)}" onerror="this.src='/_frontend/assets/images/background1.jpg'">
          <div class="cart-item-copy"><strong>${escapeHtml(item.name)}</strong><span>${money(item.price)} / ${escapeHtml(item.unit)}</span>
            <div class="cart-quantity" aria-label="Quantity controls"><button type="button" data-quantity="-1" data-id="${item.id}" data-current="${quantity}" data-min="${min}" aria-label="Decrease quantity" ${quantity <= min ? 'disabled' : ''}>−</button><span>${escapeHtml(quantity)}</span><button type="button" data-quantity="1" data-id="${item.id}" data-current="${quantity}" data-min="${min}" aria-label="Increase quantity">+</button></div>
          </div>
          <div class="cart-item-end"><strong>${money(item.price * quantity)}</strong><button class="cart-remove" type="button" data-remove="${item.id}">Remove</button></div>
        </article>`;
      }).join('');
    } catch (error) {
      const login = /login|authentication|farmer_required/i.test(error.message);
      root.innerHTML = `<div class="cart-state"><strong>Cart could not load</strong><p>${escapeHtml(login ? 'Log in to view and manage your cart.' : error.message)}</p>${login ? '<a class="button" href="../pages/login.html">Farmer login</a>' : '<button type="button" data-reload-cart>Try again</button>'}</div>`;
    }
  }

  root.addEventListener('click', async event => {
    const remove = event.target.closest('[data-remove]');
    const quantity = event.target.closest('[data-quantity]');
    const retry = event.target.closest('[data-reload-cart]');
    if (!remove && !quantity && !retry) return;
    if (retry) return loadCart();
    const button = remove || quantity;
    button.disabled = true;
    try {
      if (remove) await cartApi(`/api/marketplace/cart/items/${remove.dataset.remove}`, { method: 'DELETE' });
      else {
        const next = Number(quantity.dataset.current) + Number(quantity.dataset.quantity);
        const min = Number(quantity.dataset.min);
        if (next < min) {
          await cartApi(`/api/marketplace/cart/items/${quantity.dataset.id}`, { method: 'DELETE' });
        } else {
          await cartApi(`/api/marketplace/cart/items/${quantity.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ quantity: next }) });
        }
      }
      await loadCart();
    } catch (error) {
      window.alert(error.message);
      button.disabled = false;
    }
  });

  loadCart();
})();
