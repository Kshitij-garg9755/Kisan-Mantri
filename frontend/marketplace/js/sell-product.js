const sellForm = document.querySelector('#sell-form');
const message = document.querySelector('#message');
const loginFor = () => `../pages/login.html?next=${encodeURIComponent(location.pathname + location.search)}`;
const sellerApi = async (url, options = {}) => {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
};

(async () => {
  try {
    const { farmer } = await sellerApi('/api/auth/me');
    if (!farmer) { location.href = loginFor(); return; }
    if (!['seller', 'admin'].includes(farmer.role)) {
      message.innerHTML = 'Set up your farm profile first. <a href="farmer-profile.html">Create seller profile</a>';
      sellForm.querySelector('button[type="submit"]').disabled = true;
    }
  } catch (error) { message.textContent = error.message; }
})();

sellForm?.addEventListener('submit', async event => {
  event.preventDefault();
  const button = sellForm.querySelector('button[type="submit"]');
  button.disabled = true;
  message.className = 'profile-message';
  message.textContent = 'Publishing your product...';
  const formData = new FormData(sellForm);
  const photo = formData.get('product_image');
  const data = Object.fromEntries(formData.entries());
  data.organic = formData.get('organic') === 'on';
  data.images = [];
  delete data.product_image;
  delete data.image_url;
  try {
    if (photo instanceof File && photo.size) {
      if (photo.size > 5 * 1024 * 1024) throw new Error('Photo must be 5 MB or smaller.');
      const upload = new FormData();
      upload.append('image', photo);
      const { image_url } = await sellerApi('/api/marketplace/upload-image', { method: 'POST', body: upload });
      data.images.push(image_url);
    }
    await sellerApi('/api/marketplace/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    message.innerHTML = 'Product is live in the marketplace. <a href="farmer-dashboard.html">View your products and orders</a>';
    sellForm.reset();
  } catch (error) {
    if (error.message === 'authentication_required') { location.href = loginFor(); return; }
    if (error.message === 'seller_profile_required') { message.innerHTML = 'Create your seller profile before publishing. <a href="farmer-profile.html">Set up profile</a>'; }
    else message.textContent = error.message;
    message.classList.add('error');
  } finally { button.disabled = false; }
});
