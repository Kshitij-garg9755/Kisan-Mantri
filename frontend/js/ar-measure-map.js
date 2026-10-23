(function () {
  'use strict';

  var map;
  var layers = {};
  var pointLatLngs = [];
  var pointMarkers = [];
  var boundaryLine;
  var boundaryPolygon;
  var completed = false;
  var droneMarker;
  var droneShadowMarker;
  var droneFrame;
  var droneRoute = [];
  var droneProgress = 0;
  var droneSpeed = 1;
  var droneVisible = true;
  var savedMeasurements = [];
  var defaultCenter = [0, 0];
  var defaultZoom = 2;
  var mapReady = false;

  var $ = function (id) { return document.getElementById(id); };
  var mapSection = $('satellite-mode');
  var cameraSection = document.querySelector('.layout');
  var mapLoading = $('map-loading');
  var mapError = $('map-error');
  var emptyState = $('map-empty-state');
  var resultPanel = $('map-measurement-results');
  var emptyPanel = $('map-measurement-empty');
  var pointCount = $('map-point-count');
  var coordinateList = $('map-coordinate-list');
  var savedList = $('saved-measurements-list');
  var measurementName = $('measurement-name');
  var activeSavedMeasurement;

  function setMapError(message) {
    mapLoading.hidden = true;
    mapError.textContent = message;
    mapError.hidden = false;
  }

  function setButtons() {
    $('add-map-point').disabled = !mapReady || completed;
    $('undo-map-point').disabled = pointLatLngs.length === 0 || completed;
    $('complete-map-measurement').disabled = pointLatLngs.length < 3 || completed;
    $('save-map-measurement').disabled = pointLatLngs.length < 3 || !completed;
    $('generate-land-model').disabled = pointLatLngs.length < 3 || !completed;
    pointCount.textContent = pointLatLngs.length + (pointLatLngs.length === 1 ? ' point' : ' points');
  }

  function createLayers() {
    layers.satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxNativeZoom: 18, maxZoom: 22, attribution: 'Tiles © Esri' });
    layers.street = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxNativeZoom: 19, maxZoom: 22, attribution: '© OpenStreetMap contributors' });
    layers.hybridBase = layers.satellite;
    layers.hybridLabels = L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxNativeZoom: 18, maxZoom: 22, attribution: 'Labels © Esri' });
  }

  function selectMapType(type) {
    if (!map) return;
    Object.keys(layers).forEach(function (name) { if (map.hasLayer(layers[name])) map.removeLayer(layers[name]); });
    if (type === 'hybrid') {
      layers.hybridBase.addTo(map);
      layers.hybridLabels.addTo(map);
    } else {
      (layers[type] || layers.satellite).addTo(map);
    }
  }

  function initMap() {
    if (mapReady) { map.invalidateSize(); return; }
    if (typeof L === 'undefined') { setMapError('Map library failed to load. Check your network connection and reload the page.'); return; }
    try {
      map = L.map('satellite-map', { zoomControl: true, preferCanvas: true, worldCopyJump: true, maxZoom: 22, maxBounds: [[-85, -180], [85, 180]] }).setView(defaultCenter, defaultZoom);
      createLayers();
      selectMapType('satellite');
      map.on('click', function (event) { if (!completed && $('start-map-measurement').dataset.active === 'true') addPoint(event.latlng); });
      mapReady = true;
      mapLoading.hidden = true;
      setButtons();
      updateDroneRoute();
      setDroneVisible(true);
      loadSavedMeasurements();
    } catch (error) {
      setMapError('Map loading failed. Please reload the page or check the map service connection.');
      console.error('Satellite map initialization failed', error);
    }
  }

  function addPoint(latlng) {
    var duplicate = pointLatLngs.some(function (point) { return map.distance(point, latlng) < 1; });
    if (duplicate) return;
    var normalizedLongitude = ((latlng.lng + 180) % 360 + 360) % 360 - 180;
    var normalizedLatitude = Math.max(-85, Math.min(85, latlng.lat));
    pointLatLngs.push(L.latLng(normalizedLatitude, normalizedLongitude));
    var marker = L.circleMarker(latlng, { radius: 6, color: '#fff', weight: 2, fillColor: '#e88f67', fillOpacity: 1 }).addTo(map);
    pointMarkers.push(marker);
    completed = false;
    emptyState.hidden = true;
    redrawMeasurement();
    setButtons();
  }

  function redrawMeasurement() {
    var options = { color: '#e88f67', weight: 3, dashArray: completed ? null : '8 6', fillColor: '#c9f15c', fillOpacity: completed ? 0.28 : 0.12 };
    if (boundaryLine) map.removeLayer(boundaryLine);
    if (boundaryPolygon) map.removeLayer(boundaryPolygon);
    if (pointLatLngs.length > 1) boundaryLine = L.polyline(pointLatLngs, options).addTo(map);
    if (completed && pointLatLngs.length >= 3) boundaryPolygon = L.polygon(pointLatLngs, options).addTo(map);
    renderResults();
    updateDroneRoute();
  }

  function localMeters(points) {
    var origin = points[0];
    var radius = 6371008.8;
    var lat0 = origin.lat * Math.PI / 180;
    return points.map(function (point) {
      return {
        x: radius * (point.lng - origin.lng) * Math.PI / 180 * Math.cos(lat0),
        y: radius * (point.lat - origin.lat) * Math.PI / 180
      };
    });
  }

  function calculateMeasurement() {
    if (pointLatLngs.length < 3) return null;
    var projected = localMeters(pointLatLngs);
    var sum = 0;
    projected.forEach(function (point, index) {
      var next = projected[(index + 1) % projected.length];
      sum += point.x * next.y - next.x * point.y;
    });
    var areaM2 = Math.abs(sum / 2);
    var perimeterM = pointLatLngs.reduce(function (total, point, index) { return total + map.distance(point, pointLatLngs[(index + 1) % pointLatLngs.length]); }, 0);
    return { areaM2: areaM2, areaFt2: areaM2 * 10.7639104167, acres: areaM2 / 4046.8564224, hectares: areaM2 / 10000, perimeterM: perimeterM };
  }

  function renderResults() {
    var result = calculateMeasurement();
    emptyPanel.hidden = Boolean(result);
    resultPanel.hidden = !result;
    coordinateList.innerHTML = '';
    pointLatLngs.forEach(function (point, index) {
      var item = document.createElement('li');
      item.textContent = '#' + (index + 1) + ' ' + point.lat.toFixed(6) + ', ' + point.lng.toFixed(6);
      coordinateList.appendChild(item);
    });
    if (!result) return;
    $('result-square-feet').textContent = result.areaFt2.toFixed(2) + ' ft²';
    $('result-square-meters').textContent = result.areaM2.toFixed(2) + ' m²';
    $('result-acres').textContent = result.acres.toFixed(4) + ' ac';
    $('result-hectares').textContent = result.hectares.toFixed(4) + ' ha';
    $('result-perimeter').textContent = result.perimeterM.toFixed(2) + ' m';
    $('result-points').textContent = String(pointLatLngs.length);
  }

  function completeMeasurement() {
    if (pointLatLngs.length < 3) { window.alert('Add at least 3 different points before completing the measurement.'); return; }
    completed = true;
    $('start-map-measurement').dataset.active = 'false';
    $('start-map-measurement').textContent = 'Start Measurement';
    redrawMeasurement();
    setButtons();
    emptyState.hidden = true;
    openLandModel();
  }

  function currentMeasurementForModel() {
    var result = calculateMeasurement();
    if (!result || pointLatLngs.length < 3) return null;
    return {
      name: (measurementName.value || 'Field measurement').trim() || 'Field measurement',
      coordinates: pointLatLngs.map(function (point) { return { lat: point.lat, lng: point.lng }; }),
      areaM2: result.areaM2,
      areaFt2: result.areaFt2,
      acres: result.acres,
      hectares: result.hectares,
      perimeterM: result.perimeterM,
      createdAt: new Date().toISOString()
    };
  }

  function openLandModel() {
    var measurement = currentMeasurementForModel();
    if (!measurement) return;
    window.dispatchEvent(new CustomEvent('smartfarm:open-land-model', { detail: measurement }));
  }

  function clearMeasurement() {
    pointMarkers.forEach(function (marker) { map.removeLayer(marker); });
    pointMarkers = [];
    if (boundaryLine) map.removeLayer(boundaryLine);
    if (boundaryPolygon) map.removeLayer(boundaryPolygon);
    boundaryLine = null;
    boundaryPolygon = null;
    pointLatLngs = [];
    activeSavedMeasurement = null;
    completed = false;
    $('start-map-measurement').dataset.active = 'false';
    $('start-map-measurement').textContent = 'Start Measurement';
    emptyState.hidden = false;
    renderResults();
    setButtons();
    updateDroneRoute();
  }

  function undoPoint() {
    if (!pointLatLngs.length || completed) return;
    pointLatLngs.pop();
    var marker = pointMarkers.pop();
    if (marker) map.removeLayer(marker);
    redrawMeasurement();
    setButtons();
  }

  function showLocationError(error) {
    var message = error?.code === 1 ? 'Location permission was denied. You can still search or pan to your field.' : 'Unable to determine your location. Check device location settings.';
    window.alert(message);
  }

  function locateMap() {
    if (!navigator.geolocation) { window.alert('Location is not supported by this browser.'); return; }
    navigator.geolocation.getCurrentPosition(function (position) {
      var location = [position.coords.latitude, position.coords.longitude];
      map.setView(location, 18);
      L.marker(location).addTo(map).bindPopup('Current location').openPopup();
    }, showLocationError, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  }

  function searchLocation() {
    var query = window.prompt('Enter a farm, village, or place to search:');
    if (!query?.trim()) return;
    fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=' + encodeURIComponent(query.trim()), { headers: { Accept: 'application/json' } })
      .then(function (response) { if (!response.ok) throw new Error('search_failed'); return response.json(); })
      .then(function (results) {
        if (!results.length) { window.alert('No location was found.'); return; }
        map.setView([Number(results[0].lat), Number(results[0].lon)], 16);
      })
      .catch(function () { window.alert('Location search is unavailable right now.'); });
  }

  function saveLocally(measurement) {
    var list;
    try { list = JSON.parse(localStorage.getItem('smart_farm_measurements') || '[]'); } catch (error) { list = []; }
    measurement.id = 'local-' + Date.now();
    measurement.userId = null;
    measurement.createdAt = new Date().toISOString();
    list.unshift(measurement);
    localStorage.setItem('smart_farm_measurements', JSON.stringify(list));
    return measurement;
  }

  function measurementPayload() {
    var result = calculateMeasurement();
    return { name: (measurementName.value || 'Field measurement').trim() || 'Field measurement', coordinates: pointLatLngs.map(function (point) { return { lat: point.lat, lng: point.lng }; }), area_m2: result.areaM2, area_ft2: result.areaFt2, acres: result.acres, hectares: result.hectares, perimeter_m: result.perimeterM };
  }

  function saveMeasurement() {
    if (!completed || pointLatLngs.length < 3) return;
    var payload = measurementPayload();
    fetch('/api/measurements', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (response) { if (response.status === 401) return null; if (!response.ok) throw new Error('save_failed'); return response.json(); })
      .then(function (data) { if (data?.measurement) { activeSavedMeasurement = data.measurement; savedMeasurements.unshift(data.measurement); } else if (!data) { activeSavedMeasurement = saveLocally(payload); savedMeasurements.unshift(activeSavedMeasurement); } else { throw new Error('save_failed'); } renderSavedMeasurements(); window.alert('Measurement saved.'); })
      .catch(function () { savedMeasurements.unshift(saveLocally(payload)); renderSavedMeasurements(); window.alert('Server save was unavailable. Measurement was saved on this device.'); });
  }

  function localMeasurements() {
    try { return JSON.parse(localStorage.getItem('smart_farm_measurements') || '[]'); } catch (error) { return []; }
  }

  function loadSavedMeasurements() {
    fetch('/api/auth/me')
      .then(function (response) { if (!response.ok) throw new Error('auth_check_failed'); return response.json(); })
      .then(function (auth) {
        if (!auth.farmer) { savedMeasurements = localMeasurements(); return null; }
        return fetch('/api/measurements').then(function (response) { if (!response.ok) throw new Error('load_failed'); return response.json(); });
      })
      .then(function (data) { if (data) savedMeasurements = data.measurements; renderSavedMeasurements(); })
      .catch(function () { savedMeasurements = localMeasurements(); renderSavedMeasurements(); });
  }

  function openSavedMeasurement(measurement) {
    var coordinates = typeof measurement.coordinates === 'string' ? JSON.parse(measurement.coordinates) : measurement.coordinates;
    clearMeasurement();
    activeSavedMeasurement = measurement;
    coordinates.forEach(function (point) { addPoint(L.latLng(Number(point.lat), Number(point.lng))); });
    completed = true;
    measurementName.value = measurement.name || 'Field measurement';
    redrawMeasurement();
    setButtons();
    map.fitBounds(L.latLngBounds(pointLatLngs), { padding: [50, 50] });
  }

  function deleteSavedMeasurement(measurement) {
    var remove = function () { savedMeasurements = savedMeasurements.filter(function (item) { return String(item.id) !== String(measurement.id); }); renderSavedMeasurements(); };
    if (String(measurement.id).startsWith('local-')) {
      var local = localMeasurements().filter(function (item) { return String(item.id) !== String(measurement.id); });
      localStorage.setItem('smart_farm_measurements', JSON.stringify(local));
      remove();
      return;
    }
    fetch('/api/measurements/' + encodeURIComponent(measurement.id), { method: 'DELETE' }).then(function (response) { if (!response.ok) throw new Error('delete_failed'); remove(); }).catch(function () { window.alert('Could not delete this saved measurement.'); });
  }

  function deleteCurrentMeasurement() {
    if (activeSavedMeasurement) deleteSavedMeasurement(activeSavedMeasurement);
    clearMeasurement();
    window.dispatchEvent(new CustomEvent('smartfarm:close-land-model'));
    activeSavedMeasurement = null;
  }

  function renderSavedMeasurements() {
    savedList.innerHTML = '';
    if (!savedMeasurements.length) { savedList.textContent = 'No saved measurements yet.'; return; }
    savedMeasurements.forEach(function (measurement) {
      var row = document.createElement('div');
      row.className = 'saved-row';
      var button = document.createElement('button');
      button.type = 'button'; button.textContent = 'Delete';
      button.addEventListener('click', function () { deleteSavedMeasurement(measurement); });
      var open = document.createElement('button');
      open.type = 'button'; open.className = 'text-button'; open.textContent = measurement.name || 'Untitled field';
      open.addEventListener('click', function () { openSavedMeasurement(measurement); });
      var details = document.createElement('div');
      details.appendChild(open);
      var date = document.createElement('span');
      date.textContent = Number(measurement.area_m2 || 0).toFixed(2) + ' m² · ' + new Date(measurement.created_at || measurement.createdAt || Date.now()).toLocaleDateString();
      details.appendChild(date); row.appendChild(details); row.appendChild(button); savedList.appendChild(row);
    });
  }

  function droneIcon() {
    return L.divIcon({ className: 'drone-icon', iconSize: [76, 76], iconAnchor: [38, 38], html: '<div class="drone-flight"><svg viewBox="0 0 100 100" aria-label="Survey drone"><ellipse class="drone-glow" cx="50" cy="58" rx="27" ry="8"/><path class="drone-arm" d="M22 42L40 50M78 42L60 50M29 68L43 58M71 68L57 58"/><ellipse class="drone-rotor" cx="17" cy="39" rx="15" ry="4"/><ellipse class="drone-rotor" cx="83" cy="39" rx="15" ry="4"/><ellipse class="drone-rotor" cx="24" cy="73" rx="15" ry="4"/><ellipse class="drone-rotor" cx="76" cy="73" rx="15" ry="4"/><path class="drone-body" d="M33 44Q50 34 67 44L62 62Q50 70 38 62Z"/><path class="drone-camera" d="M44 59h12v9H44z"/><circle class="drone-light drone-light-left" cx="39" cy="51" r="2.5"/><circle class="drone-light drone-light-right" cx="61" cy="51" r="2.5"/></svg></div>' });
  }

  function droneShadowIcon() {
    return L.divIcon({ className: 'drone-shadow-icon', iconSize: [70, 30], iconAnchor: [35, 15], html: '<span class="drone-shadow"></span>' });
  }

  function routeAroundCenter() {
    var center = map.getCenter();
    var meters = Math.max(20, 260 / Math.pow(2, Math.max(0, map.getZoom() - 14)));
    var latDelta = meters / 111320;
    var lngDelta = meters / (111320 * Math.max(0.2, Math.cos(center.lat * Math.PI / 180)));
    return [L.latLng(center.lat + latDelta, center.lng - lngDelta), L.latLng(center.lat + latDelta, center.lng + lngDelta), L.latLng(center.lat - latDelta, center.lng + lngDelta), L.latLng(center.lat - latDelta, center.lng - lngDelta)];
  }

  function updateDroneRoute() {
    if (!map) return;
    droneRoute = pointLatLngs.length >= 3 ? pointLatLngs.slice() : routeAroundCenter();
    droneProgress = 0;
    if (droneMarker && droneVisible) droneMarker.setLatLng(droneRoute[0]);
    if (droneShadowMarker && droneVisible) droneShadowMarker.setLatLng(droneRoute[0]);
  }

  function interpolateRoute(progress) {
    var segmentCount = droneRoute.length;
    var scaled = progress * segmentCount;
    var index = Math.floor(scaled) % segmentCount;
    var nextIndex = (index + 1) % segmentCount;
    var fraction = scaled - Math.floor(scaled);
    var current = droneRoute[index]; var next = droneRoute[nextIndex];
    return { position: L.latLng(current.lat + (next.lat - current.lat) * fraction, current.lng + (next.lng - current.lng) * fraction), next: next, current: current };
  }

  function animateDrone(timestamp) {
    if (!droneVisible || !droneMarker || !droneRoute.length) { droneFrame = null; return; }
    droneProgress = (droneProgress + droneSpeed / 12000) % 1;
    var flight = interpolateRoute(droneProgress);
    droneMarker.setLatLng(flight.position);
    droneShadowMarker.setLatLng(flight.position);
    var angle = Math.atan2(flight.next.lng - flight.current.lng, flight.next.lat - flight.current.lat) * 180 / Math.PI;
    var element = droneMarker.getElement();
    var droneSvg = element?.querySelector('svg');
    if (droneSvg) droneSvg.style.transform = 'rotate(' + angle.toFixed(1) + 'deg)';
    var flightElement = element?.querySelector('.drone-flight');
    if (flightElement) flightElement.style.transform = 'translateY(' + (Math.sin(timestamp / 230) * 3).toFixed(1) + 'px)';
    droneFrame = window.requestAnimationFrame(animateDrone);
  }

  function setDroneVisible(visible) {
    droneVisible = visible;
    if (!map) return;
    if (visible) {
      if (!droneMarker) droneMarker = L.marker(droneRoute[0] || map.getCenter(), { icon: droneIcon(), interactive: false, keyboard: false }).addTo(map);
      if (!droneShadowMarker) droneShadowMarker = L.marker(droneRoute[0] || map.getCenter(), { icon: droneShadowIcon(), interactive: false, keyboard: false, zIndexOffset: -100 }).addTo(map);
      if (!droneFrame) droneFrame = window.requestAnimationFrame(animateDrone);
    } else {
      if (droneMarker) map.removeLayer(droneMarker);
      if (droneShadowMarker) map.removeLayer(droneShadowMarker);
      droneMarker = null;
      droneShadowMarker = null;
      if (droneFrame) window.cancelAnimationFrame(droneFrame);
      droneFrame = null;
    }
  }

  function bindEvents() {
    $('open-map-mode').addEventListener('click', function () { mapSection.hidden = false; cameraSection.hidden = true; $('open-map-mode').classList.add('is-active'); $('open-camera-mode').classList.remove('is-active'); initMap(); });
    $('open-camera-mode').addEventListener('click', function () { mapSection.hidden = true; cameraSection.hidden = false; $('open-camera-mode').classList.add('is-active'); $('open-map-mode').classList.remove('is-active'); });
    $('map-type').addEventListener('change', function (event) { selectMapType(event.target.value); });
    $('locate-map').addEventListener('click', locateMap);
    $('reset-map').addEventListener('click', function () { map.setView(defaultCenter, defaultZoom); });
    $('start-map-measurement').addEventListener('click', function (event) { var active = event.currentTarget.dataset.active === 'true'; event.currentTarget.dataset.active = String(!active); event.currentTarget.textContent = active ? 'Start Measurement' : 'Stop Adding Points'; completed = false; setButtons(); });
    $('add-map-point').addEventListener('click', function () { $('start-map-measurement').dataset.active = 'true'; $('start-map-measurement').textContent = 'Stop Adding Points'; });
    $('undo-map-point').addEventListener('click', undoPoint);
    $('complete-map-measurement').addEventListener('click', completeMeasurement);
    $('clear-map-measurement').addEventListener('click', clearMeasurement);
    $('save-map-measurement').addEventListener('click', saveMeasurement);
    $('generate-land-model').addEventListener('click', openLandModel);
    $('edit-land-measurement').addEventListener('click', function () { window.dispatchEvent(new CustomEvent('smartfarm:close-land-model')); });
    window.addEventListener('smartfarm:delete-land-measurement', deleteCurrentMeasurement);
    $('refresh-saved-measurements').addEventListener('click', loadSavedMeasurements);
    $('show-drone').addEventListener('click', function () { setDroneVisible(true); });
    $('hide-drone').addEventListener('click', function () { setDroneVisible(false); });
    $('drone-speed').addEventListener('change', function (event) {
      if (event.target.value === 'slow') droneSpeed = .55;
      else if (event.target.value === 'fast') droneSpeed = 2;
      else droneSpeed = 1;
    });
    $('reset-map').insertAdjacentHTML('afterend', '<button id="search-map" class="map-control" type="button">Search location</button>');
    $('search-map').addEventListener('click', searchLocation);
  }

  document.addEventListener('DOMContentLoaded', function () { bindEvents(); setButtons(); });
}());
