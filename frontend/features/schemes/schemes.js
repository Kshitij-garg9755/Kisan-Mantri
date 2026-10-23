/* Government Schemes — list, filters, search, bookmark, details, admin info */
(function () {
  'use strict';
  var SF = window.SF;
  var grid = document.getElementById('scheme-grid');
  var statusEl = document.getElementById('scheme-status');
  var onlySaved = false;

  function setStatus(html, cls) {
    if (!html) { statusEl.classList.add('sf-hidden'); statusEl.textContent = ''; return; }
    statusEl.className = cls || 'sf-loading';
    statusEl.innerHTML = html;
  }

  function tags(items) {
    return (items || []).map(function (t) { return '<span class="scheme-tag">' + SF.esc(t) + '</span>'; }).join('');
  }

  function card(scheme) {
    return '<article class="sf-card scheme-card" data-slug="' + SF.esc(scheme.slug) + '">' +
      '<div class="scheme-cat">' + SF.esc(scheme.category || 'Scheme') + '</div>' +
      '<h3>' + SF.esc(scheme.title) + '</h3>' +
      (scheme.title_hi ? '<div class="scheme-title-hi">' + SF.esc(scheme.title_hi) + '</div>' : '') +
      '<p class="scheme-summary">' + SF.esc(scheme.summary) + '</p>' +
      '<div class="scheme-tags">' + tags(scheme.states) + tags(scheme.farmer_categories) + '</div>' +
      '<div class="scheme-card-actions">' +
        '<button class="sf-btn sf-btn-dark sf-btn-sm" data-action="details" data-slug="' + SF.esc(scheme.slug) + '">View details</button>' +
        '<button class="sf-btn sf-btn-outline sf-btn-sm scheme-bookmark-btn' + (scheme.bookmarked ? ' saved' : '') + '" ' +
          'data-action="bookmark" data-slug="' + SF.esc(scheme.slug) + '">' +
          (scheme.bookmarked ? '★ Saved' : '☆ Save') + '</button>' +
      '</div></article>';
  }

  function loadMeta() {
    return SF.get(SF.API + '/schemes/meta').then(function (res) {
      var data = res.data || {};
      fill('scheme-state', data.states || ['All'], 'All states');
      fill('scheme-category', data.categories || [], 'All categories');
      fill('scheme-farmer', data.farmer_categories || [], 'All farmers');
    });
  }

  function fill(id, values, allLabel) {
    var select = document.getElementById(id);
    if (!select) return;
    select.innerHTML = '<option value="">' + allLabel + '</option>';
    values.forEach(function (value) {
      if (value === 'All') return;
      var opt = document.createElement('option');
      opt.value = value;
      opt.textContent = value;
      select.appendChild(opt);
    });
  }

  function load() {
    setStatus('Loading schemes…', 'sf-loading');
    if (onlySaved) {
      if (!SF.isLoggedIn()) {
        setStatus('Please log in to see your saved schemes.', 'sf-notice');
        grid.innerHTML = '';
        return;
      }
      SF.get(SF.API + '/schemes/bookmarks/mine').then(function (res) {
        render(res.data.schemes || []);
      });
      return;
    }
    var params = new URLSearchParams();
    var q = document.getElementById('scheme-q').value.trim();
    var state = document.getElementById('scheme-state').value;
    var category = document.getElementById('scheme-category').value;
    var farmer = document.getElementById('scheme-farmer').value;
    if (q) params.set('q', q);
    if (state) params.set('state', state);
    if (category) params.set('category', category);
    if (farmer) params.set('farmer_category', farmer);
    SF.get(SF.API + '/schemes?' + params.toString()).then(function (res) {
      if (!res.ok) { setStatus('Could not load schemes right now.', 'sf-error'); return; }
      render(res.data.schemes || []);
    });
  }

  function render(schemes) {
    if (!schemes.length) {
      grid.innerHTML = '';
      setStatus('No schemes match your filters. Try clearing the search or choosing a different state.', 'sf-empty');
      return;
    }
    setStatus('');
    grid.innerHTML = schemes.map(card).join('');
  }

  function openDetails(slug) {
    var backdrop = document.getElementById('scheme-detail');
    var body = document.getElementById('scheme-detail-body');
    body.innerHTML = '<div class="sf-loading">Loading scheme…</div>';
    backdrop.classList.remove('sf-hidden');
    SF.get(SF.API + '/schemes/' + encodeURIComponent(slug)).then(function (res) {
      if (!res.ok) { body.innerHTML = '<div class="sf-error">This scheme could not be found.</div>'; return; }
      var s = res.data.scheme;
      body.innerHTML =
        '<h2 id="scheme-detail-title">' + SF.esc(s.title) + '</h2>' +
        (s.title_hi ? '<div class="scheme-detail-hi">' + SF.esc(s.title_hi) + '</div>' : '') +
        '<div class="scheme-tags">' + tags(s.states) + tags(s.farmer_categories) +
          '<span class="scheme-tag">' + SF.esc(s.category) + '</span></div>' +
        section('Description', s.description) +
        section('Eligibility', s.eligibility) +
        section('Benefits', s.benefits) +
        section('Required documents', s.required_documents) +
        section('How to apply', s.application_process) +
        (s.department ? section('Department', s.department) : '') +
        '<div class="scheme-card-actions">' +
          (s.official_url ? '<a class="sf-btn sf-btn-primary" href="' + SF.esc(s.official_url) + '" target="_blank" rel="noopener noreferrer">Official website ↗</a>' : '') +
          '<button class="sf-btn sf-btn-outline" id="detail-bookmark" data-slug="' + SF.esc(s.slug) + '">' + (s.bookmarked ? '★ Saved' : '☆ Save scheme') + '</button>' +
        '</div>' +
        '<div class="scheme-source-note">' + SF.esc(s.source_note || 'Verify all details on the official portal before applying.') + '</div>';
      var bm = document.getElementById('detail-bookmark');
      if (bm) bm.addEventListener('click', function () { toggleBookmark(s.slug); });
    });
  }

  function section(title, value) {
    if (!value) return '';
    return '<section><h4>' + SF.esc(title) + '</h4><p>' + SF.esc(value) + '</p></section>';
  }

  function toggleBookmark(slug) {
    if (!SF.isLoggedIn()) { SF.toast('Please log in to save a scheme.', 'error'); return; }
    SF.postJson(SF.API + '/schemes/' + encodeURIComponent(slug) + '/bookmark', {}).then(function (res) {
      if (!res.ok) { SF.toast(SF.errorMessage(res.data), 'error'); return; }
      SF.toast(res.data.bookmarked ? 'Scheme saved.' : 'Removed from saved.', 'success');
      load();
    });
  }

  // Events
  document.getElementById('scheme-filters').addEventListener('submit', function (e) { e.preventDefault(); load(); });
  document.getElementById('scheme-reset').addEventListener('click', function () {
    document.getElementById('scheme-filters').reset();
    onlySaved = false;
    load();
  });
  document.getElementById('scheme-only-saved').addEventListener('change', function (e) {
    onlySaved = e.target.checked;
    load();
  });
  document.getElementById('scheme-detail-close').addEventListener('click', function () {
    document.getElementById('scheme-detail').classList.add('sf-hidden');
  });
  document.getElementById('scheme-detail').addEventListener('click', function (e) {
    if (e.target.id === 'scheme-detail') document.getElementById('scheme-detail').classList.add('sf-hidden');
  });
  grid.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'details') openDetails(btn.dataset.slug);
    if (btn.dataset.action === 'bookmark') toggleBookmark(btn.dataset.slug);
  });

  // Boot
  SF.bootHeader().then(loadMeta).then(load);
}());
