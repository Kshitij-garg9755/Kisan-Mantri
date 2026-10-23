(function (window) {
  var config = window.SMART_FARM_DEV_CONFIG || {};
  if (!config.n8nBaseUrl) {
    var n8nOrigin = new URL(window.location.origin);
    n8nOrigin.port = '5678';
    config.n8nBaseUrl = n8nOrigin.origin;
  }
  config.n8nBaseUrl = config.n8nBaseUrl.replace(/\/+$/, '');
  config.n8nUrl = function (path) {
    return config.n8nBaseUrl + '/' + String(path).replace(/^\/+/, '');
  };
  window.SMART_FARM_DEV_CONFIG = config;

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
    var hostname = window.location.hostname;
    var isCapacitorLocalHost = (hostname === 'localhost' || hostname === '127.0.0.1') && !window.location.port;
    if (!isCapacitorLocalHost) {
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

  // Video element requests do not pass through window.fetch, so rewrite upload
  // paths to the same backend selected for API calls before playback starts.
  config.resolveMediaUrl = async function (url) {
    if (typeof url !== 'string' || !url.startsWith('/uploads/')) return url;
    if (window.location.port === '5000') return url;
    return (await getBackend()) + url;
  };
  window.SMART_FARM_DEV_CONFIG = config;

  var originalFetch = window.fetch;

  window.fetch = async function (url, options) {
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

    // If loaded directly from Flask port 5000, try local relative fetch first
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
})(window);
