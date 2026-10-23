// Universal API & SQLite Database Bridge for Android Phone & Browser
(function() {
  if (typeof window === 'undefined' || !window.fetch) return;
  if (window.__smartFarmBridgeReady) return;
  window.__smartFarmBridgeReady = true;

  var PC_LAN_HOST = 'http://10.86.67.6:5000';
  var USB_REVERSE_HOST = 'http://127.0.0.1:5000';
  var activeBackend = null;

  async function checkHost(host) {
    try {
      var ctrl = new AbortController();
      var tid = setTimeout(function () { ctrl.abort(); }, 1500);
      var res = await originalFetch(host + '/api/marketplace/health', {
        credentials: 'include',
        signal: ctrl.signal
      });
      clearTimeout(tid);
      return res.ok;
    } catch (e) {
      return false;
    }
  }

  async function getBackend() {
    if (activeBackend) return activeBackend;
    var host = window.location.hostname;
    var isLocalHost = host === 'localhost' || host === '127.0.0.1';
    if (window.location.port === '5000' || (window.location.protocol === 'https:' && !isLocalHost)) {
      activeBackend = window.location.origin;
      return activeBackend;
    }
    if (await checkHost(USB_REVERSE_HOST)) {
      activeBackend = USB_REVERSE_HOST;
      return activeBackend;
    }
    if (await checkHost(PC_LAN_HOST)) {
      activeBackend = PC_LAN_HOST;
      return activeBackend;
    }
    return USB_REVERSE_HOST;
  }

  var originalFetch = window.fetch;

  window.fetch = async function(url, options) {
    options = options || {};
    options.credentials = 'include';

    try {
      var stored = localStorage.getItem('farmer');
      if (stored) {
        var farmer = JSON.parse(stored);
        if (farmer && farmer.id) {
          options.headers = Object.assign({}, options.headers, {
            'X-Farmer-Id': farmer.id
          });
        }
      }
    } catch (e) {}

    var isApi = typeof url === 'string' && (
      url.startsWith('/api/') || 
      url.startsWith('/send_otp') || 
      url.startsWith('/verify_otp') || 
      url.startsWith('/uploads/')
    );

    if (!isApi) {
      return originalFetch(url, options);
    }

    if (window.location.port === '5000') {
      try {
        var directRes = await originalFetch(url, options);
        if (directRes.status !== 502 && directRes.status !== 503) {
          return directRes;
        }
      } catch (directErr) {}
    }

    var primary = await getBackend();
    var secondary = primary === USB_REVERSE_HOST ? PC_LAN_HOST : USB_REVERSE_HOST;

    try {
      var res = await originalFetch(primary + url, options);
      if (res.status !== 502 && res.status !== 503) {
        return res;
      }
    } catch (e1) {}

    try {
      var fallbackRes = await originalFetch(secondary + url, options);
      activeBackend = secondary;
      return fallbackRes;
    } catch (e2) {}

    return originalFetch(url, options);
  };
})();

function initAppNavigation() {
  const body = document.body;
  if (!body || body.dataset.appNavigation === 'ready') return;
  body.dataset.appNavigation = 'ready';

  const homePage = body.classList.contains('home-page');
  const segments = location.pathname.split('/').filter(Boolean);
  const prefix = '../'.repeat(Math.max(0, segments.length - 1));
  const current = location.pathname.toLowerCase();
  const brandSource = document.querySelector('.sf-brand strong, .brand strong, .site-header .logo h1');
  const brandName = homePage ? 'Kisan Mantri' : brandSource?.textContent.trim() || (current.includes('/marketplace/') ? 'Farmer Marketplace' : 'Smart Farm');
  const destinations = [
    ['होम', 'pages/index.html', '/pages/index.html'],
    ['बाज़ार', 'marketplace/marketplace.html', '/marketplace/'],
    ['मेरी टोकरी', 'marketplace/cart.html', '/marketplace/cart.html'],
    ['मौसम', 'pages/weather.html', '/pages/weather.html'],
    ['किसान चौपाल', 'features/chaupal/chaupal.html', '/features/chaupal/'],
    ['सरकारी योजनाएँ', 'features/schemes/schemes.html', '/features/schemes/'],
    ['किसान बैंक', 'features/kisan-bank/kisan-bank.html', '/features/kisan-bank/'],
    ['खेती की आवाज़', 'features/kisan-radio/kisan-radio.html', '/features/kisan-radio/'],
    ['खेत की जानकारी', 'features/satellite-ai/satellite-ai.html', '/features/satellite-ai/'],
    ['फसल की बीमारी', 'features/disease-diagnosis/disease-diagnosis.html', '/features/disease-diagnosis/'],
    ['खेत नापें', 'pages/ar-measure.html', '/pages/ar-measure.html'],
    ['किसान समुदाय', 'pages/agriverse.html', '/pages/agriverse.html'],
    ['किसान लॉगिन', 'pages/login.html', '/pages/login.html']
  ];

  let toggle;
  if (homePage) {
    toggle = document.createElement('button');
    toggle.className = 'app-menu-toggle';
    toggle.type = 'button';
    toggle.setAttribute('aria-label', 'नेविगेशन मेन्यू खोलें');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.innerHTML = '<span></span><span></span><span></span>';
    document.querySelector('.app-header-actions')?.append(toggle) || document.querySelector('.app-header')?.append(toggle);
  } else {
    const topbar = document.createElement('header');
    topbar.className = 'app-topbar';
    topbar.innerHTML = '<a class="app-topbar-brand" href="' + prefix + 'pages/index.html"><span class="app-topbar-mark" aria-hidden="true">SF</span><strong></strong></a><button class="app-menu-toggle" type="button" aria-label="Open navigation menu" aria-expanded="false"><span></span><span></span><span></span></button>';
    topbar.querySelector('strong').textContent = brandName;
    body.prepend(topbar);
    toggle = topbar.querySelector('.app-menu-toggle');
  }

  const backdrop = document.createElement('div');
  backdrop.className = 'app-menu-backdrop';
  backdrop.hidden = true;
  const menu = document.createElement('nav');
  menu.className = 'app-menu-panel';
  menu.setAttribute('aria-label', 'App navigation');
  for (const [label, path, match] of destinations) {
    const link = document.createElement('a');
    link.href = prefix + path;
    link.textContent = label;
    if (current.includes(match)) {
      link.classList.add('active');
      link.setAttribute('aria-current', 'page');
    }
    menu.append(link);
  }
  if (current.includes('/pages/agriverse.html')) {
    for (const [label, hash] of [['Messages', '#messages'], ['Notifications', '#notifications'], ['Create post', '#create'], ['Profile', '#profile']]) {
      const link = document.createElement('a');
      link.href = hash;
      link.textContent = label;
      menu.append(link);
    }
  }
  if (body.classList.contains('sf-feature')) {
    for (const [label, hash] of [['Messages', '#messages'], ['Notifications', '#notifications']]) {
      const link = document.createElement('a');
      link.href = hash;
      link.textContent = label;
      menu.append(link);
    }
  }
  backdrop.append(menu);
  body.append(backdrop);

  function closeMenu() {
    backdrop.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'मेन्यू खोलें');
  }
  toggle.addEventListener('click', () => {
    const open = backdrop.hidden;
    backdrop.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'मेन्यू बंद करें' : 'मेन्यू खोलें');
  });
  backdrop.addEventListener('click', event => { if (event.target === backdrop) closeMenu(); });
  menu.addEventListener('click', event => { if (event.target.closest('a')) closeMenu(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !backdrop.hidden) closeMenu(); });

  if (homePage) return;

  const agriversePage = current.includes('/pages/agriverse.html');
  const bottomItems = [
    ['\u2302', 'होम', 'pages/index.html', '/pages/index.html'],
    ...(agriversePage ? [['\u25b6', 'Reels', '#reels', '#reels']] : []),
    ['\u25a6', 'बाज़ार', 'marketplace/marketplace.html', '/marketplace/'],
    ['\u2600', 'मौसम', 'pages/weather.html', '/pages/weather.html'],
    ['\u25ce', 'चौपाल', 'features/chaupal/chaupal.html', '/features/chaupal/'],
    ['\u22ef', 'और', 'pages/agriverse.html', '/pages/agriverse.html']
  ];
  const bottom = document.createElement('nav');
  bottom.className = 'app-bottom-nav' + (agriversePage ? ' has-reels' : '');
  bottom.setAttribute('aria-label', 'Quick navigation');
  for (const [icon, label, path, match] of bottomItems) {
    const link = document.createElement('a');
    link.href = match === '#reels' ? '#reels' : prefix + path;
    link.dataset.match = match;
    const glyph = document.createElement('span');
    glyph.textContent = icon;
    glyph.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.textContent = label;
    link.append(glyph, text);
    bottom.append(link);
  }
  function updateBottomActive() {
    for (const link of bottom.querySelectorAll('a')) {
      const match = link.dataset.match;
      const active = match === '#reels'
        ? location.hash === '#reels'
        : current.includes(match) && !(agriversePage && location.hash === '#reels' && match === '/pages/agriverse.html');
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
  }
  updateBottomActive();
  window.addEventListener('hashchange', updateBottomActive);
  body.append(bottom);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAppNavigation);
} else {
  initAppNavigation();
}
