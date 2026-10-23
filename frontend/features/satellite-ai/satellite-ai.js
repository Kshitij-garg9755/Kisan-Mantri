/* Satellite AI — Leaflet map (street + Esri satellite), weather, saved fields */
(function () {
  'use strict';
  var SF = window.SF;
  var map, streetLayer, satLayer, marker;
  var current = null; // { latitude, longitude, name }

  var STREET = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  var SAT = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  var ATTR_STREET = '&copy; OpenStreetMap contributors';
  var ATTR_SAT = 'Tiles &copy; Esri';

  function initMap() {
    var errorEl = document.getElementById('sat-map-error');
    if (typeof L === 'undefined') {
      errorEl.textContent = 'Map library could not be loaded. Check your network connection.';
      errorEl.classList.remove('sf-hidden');
      return;
    }
    map = L.map('sat-map', { zoomControl: true }).setView([22.5, 78.9], 5);
    streetLayer = L.tileLayer(STREET, { maxZoom: 19, attribution: ATTR_STREET }).addTo(map);
    satLayer = L.tileLayer(SAT, { maxZoom: 18, attribution: ATTR_SAT });
    map.on('click', function (e) { selectLocation({ latitude: e.latlng.lat, longitude: e.latlng.lng, name: 'Selected point' }); });
  }

  function setBase(kind) {
    if (!map) return;
    if (kind === 'satellite') {
      if (map.hasLayer(streetLayer)) map.removeLayer(streetLayer);
      if (!map.hasLayer(satLayer)) satLayer.addTo(map);
    } else {
      if (map.hasLayer(satLayer)) map.removeLayer(satLayer);
      if (!map.hasLayer(streetLayer)) streetLayer.addTo(map);
    }
  }

  function selectLocation(loc) {
    current = loc;
    if (map) {
      map.setView([loc.latitude, loc.longitude], loc.zoom || 13);
      if (marker) marker.remove();
      marker = L.marker([loc.latitude, loc.longitude]).addTo(map);
    }
    loadWeather(loc);
    renderCropHealth(loc);
  }

  function search() {
    var q = document.getElementById('sat-search').value.trim();
    if (q.length < 2) { SF.toast('Type at least 2 characters.', 'error'); return; }
    SF.get('/api/weather/locations?query=' + encodeURIComponent(q)).then(function (res) {
      var locs = (res.data && res.data.locations) || [];
      if (!locs.length) { SF.toast('No matching location found.', 'error'); return; }
      var first = locs[0];
      selectLocation({ latitude: first.latitude, longitude: first.longitude, name: first.name + (first.admin1 ? ', ' + first.admin1 : ''), zoom: 11 });
    });
  }

  function locate() {
    if (!navigator.geolocation) { SF.toast('Geolocation is not supported.', 'error'); return; }
    navigator.geolocation.getCurrentPosition(function (pos) {
      selectLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, name: 'My location', zoom: 13 });
    }, function () { SF.toast('Could not get your location.', 'error'); });
  }

  function loadWeather(loc) {
    var box = document.getElementById('sat-weather');
    box.innerHTML = '<div class="sf-loading">Loading live weather…</div>';
    SF.get('/api/weather/forecast?lat=' + loc.latitude + '&lon=' + loc.longitude).then(function (res) {
      if (!res.ok || !res.data.current) { box.innerHTML = '<div class="sf-error">Weather is unavailable right now.</div>'; return; }
      var c = res.data.current;
      box.innerHTML =
        '<div class="sat-stat"><span>Temperature</span><strong>' + c.temperature_2m + ' °C</strong></div>' +
        '<div class="sat-stat"><span>Humidity</span><strong>' + c.relative_humidity_2m + ' %</strong></div>' +
        '<div class="sat-stat"><span>Rain (now)</span><strong>' + (c.rain || 0) + ' mm</strong></div>' +
        '<div class="sat-stat"><span>Wind</span><strong>' + c.wind_speed_10m + ' km/h</strong></div>' +
        '<div style="margin-top:8px;">' + SF.statusPill('live') + ' <span class="sf-muted">Open-Meteo</span></div>';
    });
  }

  function renderCropHealth(loc) {
    var box = document.getElementById('crop-health');
    // NDVI is only real when a satellite API is connected; otherwise honest demo data.
    var ndviStatus = window.__SAT_NDVI_STATUS__ || 'unavailable';
    box.innerHTML =
      '<div class="sat-stat"><span>Location</span><strong>' + SF.esc(loc.name) + '</strong></div>' +
      '<div class="sat-stat"><span>Latitude</span><strong>' + loc.latitude.toFixed(4) + '</strong></div>' +
      '<div class="sat-stat"><span>Longitude</span><strong>' + loc.longitude.toFixed(4) + '</strong></div>' +
      '<div class="sat-stat"><span>NDVI / crop health</span><strong>' + (ndviStatus === 'live' ? 'Available' : 'Not connected') + '</strong></div>' +
      '<div style="margin-top:8px;">' + SF.statusPill(ndviStatus === 'live' ? 'live' : 'unavailable') +
      ' <span class="sf-muted">' + (ndviStatus === 'live' ? 'Satellite API' : 'No NDVI API configured') + '</span></div>' +
      (ndviStatus === 'live' ? '' : '<p class="sf-muted" style="margin-top:10px;">Crop-health values are illustrative only until a satellite analysis API is connected to the backend.</p>');
  }

  function renderLayerStatus() {
    SF.get(SF.API + '/satellite/status').then(function (res) {
      var panel = document.getElementById('layer-status');
      if (!res.ok) { panel.className = 'sf-error'; panel.textContent = 'Could not read data-source status.'; return; }
      panel.className = '';
      window.__SAT_NDVI_STATUS__ = res.data.layers.ndvi.status;
      var rows = Object.keys(res.data.layers).map(function (key) {
        var layer = res.data.layers[key];
        var label = key.replace(/_/g, ' ');
        return '<div class="sat-layer-row"><span>' + SF.esc(label) + '<br><span class="sf-muted">' + SF.esc(layer.note) + '</span></span>' + SF.statusPill(layer.status) + '</div>';
      }).join('');
      panel.innerHTML = rows + '<p class="sf-muted" style="margin-top:10px;">' + SF.esc(res.data.note) + '</p>';
    });
  }

  function saveField() {
    if (!SF.isLoggedIn()) { SF.toast('Please log in to save a field.', 'error'); return; }
    if (!current) { SF.toast('Select a location on the map first.', 'error'); return; }
    var name = document.getElementById('field-name').value.trim();
    if (!name) { document.getElementById('sat-save-msg').textContent = 'Enter a field name.'; return; }
    SF.postJson(SF.API + '/satellite/fields', {
      name: name,
      crop: document.getElementById('field-crop').value.trim(),
      notes: document.getElementById('field-notes').value.trim(),
      latitude: current.latitude,
      longitude: current.longitude
    }).then(function (res) {
      if (!res.ok) { document.getElementById('sat-save-msg').textContent = SF.errorMessage(res.data); return; }
      document.getElementById('sat-save-msg').textContent = '';
      document.getElementById('field-name').value = '';
      document.getElementById('field-crop').value = '';
      document.getElementById('field-notes').value = '';
      SF.toast('Field saved.', 'success');
      loadFields();
    });
  }

  function loadFields() {
    var box = document.getElementById('sat-fields');
    if (!SF.isLoggedIn()) { box.innerHTML = '<p class="sf-muted">Log in to save fields.</p>'; return; }
    SF.get(SF.API + '/satellite/fields').then(function (res) {
      var fields = res.data.fields || [];
      if (!fields.length) { box.innerHTML = '<p class="sf-muted">No saved fields yet.</p>'; return; }
      box.innerHTML = fields.map(function (f) {
        return '<div class="sat-field-item">' +
          '<div class="sat-field-body"><strong>' + SF.esc(f.name) + '</strong>' +
          (f.crop ? '<span>' + SF.esc(f.crop) + '</span><br>' : '') +
          '<span class="sf-muted">' + Number(f.latitude).toFixed(3) + ', ' + Number(f.longitude).toFixed(3) + '</span></div>' +
          '<div class="sf-stack" style="gap:6px;">' +
          '<button class="sf-btn sf-btn-outline sf-btn-sm" data-view="' + f.id + '">View</button>' +
          '<button class="sf-btn sf-btn-ghost sf-btn-sm" data-del="' + f.id + '">Delete</button>' +
          '</div></div>';
      }).join('');
      window.__SAT_FIELDS__ = fields;
    });
  }

  function deleteField(id) {
    SF.confirm('Delete this saved field?', 'This removes the field from your list.', 'Delete').then(function (ok) {
      if (!ok) return;
      SF.del(SF.API + '/satellite/fields/' + id).then(function (res) {
        if (res.ok) { SF.toast('Field deleted.', 'success'); loadFields(); }
        else SF.toast(SF.errorMessage(res.data), 'error');
      });
    });
  }

  // Events
  document.getElementById('sat-search-btn').addEventListener('click', search);
  document.getElementById('sat-search').addEventListener('keydown', function (e) { if (e.key === 'Enter') search(); });
  document.getElementById('sat-locate-btn').addEventListener('click', locate);
  document.getElementById('sat-save-btn').addEventListener('click', saveField);
  document.querySelectorAll('[name="sat-base"]').forEach(function (radio) {
    radio.addEventListener('change', function () { setBase(radio.value); });
  });
  document.getElementById('sat-fields').addEventListener('click', function (e) {
    var view = e.target.closest('[data-view]');
    var del = e.target.closest('[data-del]');
    if (view && window.__SAT_FIELDS__) {
      var f = window.__SAT_FIELDS__.filter(function (x) { return String(x.id) === view.dataset.view; })[0];
      if (f) selectLocation({ latitude: f.latitude, longitude: f.longitude, name: f.name, zoom: 14 });
    }
    if (del) deleteField(del.dataset.del);
  });

  // Boot
  initMap();
  SF.bootHeader().then(function (farmer) {
    if (!farmer) {
      document.getElementById('sat-locked').classList.remove('sf-hidden');
      document.getElementById('sat-save-body').classList.add('sf-hidden');
    }
    renderLayerStatus();
    loadFields();
  });
}());
