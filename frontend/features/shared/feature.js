/* ==========================================================================
   Smart Farm — shared helpers for feature modules
   Exposes window.SF. No global CSS/JS conflicts: everything is namespaced.
   ========================================================================== */
(function () {
  'use strict';

  var API = '/api/features';

  var SF = {
    API: API,
    farmer: null,

    /** Escape untrusted text before inserting into innerHTML. */
    esc: function (value) {
      return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
        return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[ch];
      });
    },

    /** Fetch wrapper that returns { ok, status, data }. */
    request: function (url, options) {
      options = options || {};
      options.credentials = 'include';
      try {
        var stored = localStorage.getItem('farmer');
        if (stored) {
          var f = JSON.parse(stored);
          if (f && f.id) {
            options.headers = Object.assign({}, options.headers, { 'X-Farmer-Id': f.id });
          }
        }
      } catch (e) {}

      var makeCall = function (targetUrl) {
        return fetch(targetUrl, options).then(function (response) {
          var contentType = response.headers.get('content-type') || '';
          var parse = contentType.indexOf('application/json') !== -1
            ? response.json()
            : response.text().then(function (text) { return { raw: text }; });
          return parse.catch(function () { return {}; }).then(function (data) {
            return { ok: response.ok, status: response.status, data: data };
          });
        });
      };

      var host = window.location.hostname;
      var isLocalHost = host === 'localhost' || host === '127.0.0.1';
      var isCloudOrigin = window.location.protocol === 'https:' && !isLocalHost;
      if (typeof url === 'string' && url.startsWith('/') && window.location.port !== '5000' && !isCloudOrigin) {
        return makeCall('http://127.0.0.1:5000' + url).catch(function () {
          return makeCall('http://10.86.67.6:5000' + url).catch(function () {
            return makeCall(url);
          });
        });
      }

      return makeCall(url);
    },

    get: function (url) { return SF.request(url, { credentials: 'include' }); },

    postJson: function (url, body) {
      return SF.request(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {})
      });
    },

    del: function (url) { return SF.request(url, { method: 'DELETE', credentials: 'include' }); },

    postForm: function (url, formData) {
      return SF.request(url, { method: 'POST', credentials: 'include', body: formData });
    },

    /** Load the logged-in farmer (or null). Resolves with the farmer object. */
    loadFarmer: function () {
      return SF.get('/api/auth/me').then(function (res) {
        SF.farmer = (res.data && res.data.farmer) || null;
        return SF.farmer;
      });
    },

    isLoggedIn: function () { return Boolean(SF.farmer); },

    redirectToLogin: function () { window.location.href = '../pages/login.html'; },

    /** Human-readable message for an API error code. */
    errorMessage: function (data, fallback) {
      if (!data) return fallback || 'Something went wrong.';
      var map = {
        authentication_required: 'Please log in to continue.',
        only_owner_can_delete: 'You can only change your own content.',
        admin_required: 'Only an administrator can do this.',
        image_required: 'Please choose an image first.',
        crop_required: 'Please select the crop type.',
        invalid_image_type: 'Only JPG, PNG or WEBP images are allowed.',
        invalid_image_type_or_size: 'Only JPG, PNG or WEBP images up to 5 MB are allowed.',
        image_too_large: 'The image is larger than 5 MB.',
        scheme_not_found: 'That scheme could not be found.',
        post_not_found: 'That post no longer exists.',
        field_name_required: 'Please enter a field name.',
        valid_coordinates_required: 'A valid location is required.',
        coordinates_out_of_range: 'The selected location is not valid.',
        already_reported: 'You have already reported this post.',
        cannot_follow_self: 'You cannot follow yourself.'
      };
      return map[data.error] || data.message || data.error || fallback || 'Something went wrong.';
    },

    /** Toast notification. */
    toast: function (message, kind) {
      var wrap = document.querySelector('.sf-toast-wrap');
      if (!wrap) {
        wrap = document.createElement('div');
        wrap.className = 'sf-toast-wrap';
        document.body.appendChild(wrap);
      }
      var el = document.createElement('div');
      el.className = 'sf-toast' + (kind ? ' ' + kind : '');
      el.textContent = message;
      wrap.appendChild(el);
      setTimeout(function () { el.remove(); }, 3600);
    },

    /** Confirmation modal (promise resolves true/false). */
    confirm: function (title, message, confirmLabel) {
      return new Promise(function (resolve) {
        var backdrop = document.createElement('div');
        backdrop.className = 'sf-modal-backdrop';
        backdrop.innerHTML =
          '<div class="sf-modal" role="dialog" aria-modal="true">' +
          '<h2>' + SF.esc(title) + '</h2>' +
          '<p class="sf-muted">' + SF.esc(message) + '</p>' +
          '<div class="sf-modal-actions">' +
          '<button class="sf-btn sf-btn-ghost" data-modal="cancel">Cancel</button>' +
          '<button class="sf-btn sf-btn-dark" data-modal="confirm">' + SF.esc(confirmLabel || 'Confirm') + '</button>' +
          '</div></div>';
        document.body.appendChild(backdrop);
        backdrop.addEventListener('click', function (event) {
          var action = event.target.getAttribute && event.target.getAttribute('data-modal');
          if (event.target === backdrop || action === 'cancel') { backdrop.remove(); resolve(false); }
          if (action === 'confirm') { backdrop.remove(); resolve(true); }
        });
      });
    },

    /** Render a status pill for a data-source status value. */
    statusPill: function (status) {
      var labels = {
        live: 'Live data', demo: 'Demo result', cached: 'Cached data', unavailable: 'API unavailable'
      };
      var cls = { live: 'sf-pill-live', demo: 'sf-pill-demo', cached: 'sf-pill-cached', unavailable: 'sf-pill-unavailable' };
      var s = labels[status] ? status : 'unavailable';
      return '<span class="sf-pill ' + (cls[s] || 'sf-pill-muted') + '">' + labels[s] + '</span>';
    },

    /** Notification bell markup with live count. */
    notificationsBell: function () {
      return '<a class="sf-btn sf-btn-outline sf-btn-sm" href="chaupal/chaupal.html#notifications" id="sf-notif-link">🔔 <span id="sf-notif-count">0</span></a>';
    },

    /** Update the notification count in the header. */
    refreshNotifications: function () {
      if (!SF.isLoggedIn()) return;
      SF.get(API + '/notifications').then(function (res) {
        var count = (res.data.notifications || []).filter(function (n) { return !n.read; }).length;
        var el = document.getElementById('sf-notif-count');
        if (el) el.textContent = count;
      });
    },

    /** Wire up shared header, auth state and notification count. */
    bootHeader: function (options) {
      options = options || {};
      var loginBtn = document.getElementById('sf-auth-btn');
      return SF.loadFarmer().then(function (farmer) {
        if (loginBtn) {
          loginBtn.textContent = farmer ? ('👤 ' + farmer.name) : 'Login';
          loginBtn.onclick = function () {
            if (farmer) {
              window.location.href = 'chaupal/chaupal.html#profile';
            } else {
              SF.redirectToLogin();
            }
          };
        }
        if (options.onReady) options.onReady(farmer);
        SF.refreshNotifications();
        return farmer;
      });
    }
  };

  window.SF = SF;
}());
