class WeatherApp {
    map = null;

    constructor() {
        this.layers = {};
        this.markers = new Map();
        this.selected = null;
        this.favorites = this.readFavorites();
        this.bindEvents();
        this.initMap();
        queueMicrotask(() => this.fetchLocations('India', false));
    }

    bindEvents() {
        document.getElementById('search-form').addEventListener('submit', (event) => {
            event.preventDefault();
            const query = document.getElementById('search-input').value.trim();
            if (query) this.fetchLocations(query, true);
        });
        document.getElementById('location-btn').addEventListener('click', () => this.useLocation(true));
        document.getElementById('weather-location-btn').addEventListener('click', () => this.useLocation(true));
        document.getElementById('weather-refresh-btn').addEventListener('click', () => this.refresh());
        document.getElementById('weather-retry-btn').addEventListener('click', () => this.refresh());
        document.getElementById('weather-reset-btn').addEventListener('click', () => this.resetMap());
        document.getElementById('weather-fullscreen-btn').addEventListener('click', () => {
            const target = document.querySelector('.weather-map-stage');
            if (target.requestFullscreen) target.requestFullscreen();
        });
        document.getElementById('weather-map-type').addEventListener('change', (event) => this.selectMapType(event.target.value));
        document.querySelectorAll('[data-overlay]').forEach((button) => button.addEventListener('click', () => this.toggleOverlay(button)));
        window.addEventListener('offline', () => this.showError('You are offline. Please check your internet connection.', 'You are offline.'));
        window.addEventListener('app-language-change', () => {
            if (!this.selected) return;
            this.renderBulletin(this.selected.location, this.selected.forecast);
            this.renderMapDetails(this.selected.location, this.selected.forecast);
            this.renderForecastGrid(this.selected.location, this.selected.forecast);
            const marker = this.markers.get(this.locationKey(this.selected.location));
            if (marker) marker.setIcon(this.markerIcon(this.selected.location, this.selected.forecast));
        });
    }

    initMap() {
        const error = document.getElementById('weather-map-error');
        if (typeof L === 'undefined') { error.textContent = 'Map library failed to load. Check your network connection.'; error.hidden = false; return; }
        this.map = L.map('weather-map', { zoomControl: true, worldCopyJump: true, maxZoom: 19 }).setView([22.5, 78.9], 5);
        this.layers.street = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(this.map);
        this.layers.satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxNativeZoom: 18, maxZoom: 19, attribution: 'Tiles © Esri' });
        this.layers.forecast = L.layerGroup().addTo(this.map);
        this.layers.wind = L.layerGroup(); this.layers.temperature = L.layerGroup(); this.layers.clouds = L.layerGroup();
        document.getElementById('weather-map-loading').hidden = true;
    }

    async fetchLocations(query, showChoices = true) {
        this.showLoading(true);
        try {
            const data = await this.request('/api/weather/locations?query=' + encodeURIComponent(query));
            if (!Array.isArray(data.locations) || !data.locations.length) throw new Error('No village, town, city or district found.');
            this.renderLocationResults(data.locations, showChoices);
            this.addLocationMarkers(data.locations);
            if (this.map) {
                this.map.invalidateSize();
                this.map.flyTo([data.locations[0].latitude, data.locations[0].longitude], 10, { duration: 0.7 });
            }
            await this.selectLocation(data.locations[0]);
            if (showChoices) document.querySelector('.weather-command-center')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (error) { this.showError(this.friendlyError(error), 'Unable to load weather information.'); }
        finally { this.showLoading(false); }
    }

    renderLocationResults(locations, visible) {
        const panel = document.getElementById('weather-location-results');
        if (!panel) return;
        if (!visible) { panel.hidden = true; panel.innerHTML = ''; return; }
        panel.innerHTML = '<span class="weather-location-results-title">Choose the correct place</span>' + locations.slice(0, 6).map((location, index) => {
            const label = [location.name, location.admin1, location.country].filter(Boolean).join(', ');
            return `<button type="button" class="weather-location-option${index === 0 ? ' is-selected' : ''}" role="option" aria-selected="${index === 0}" data-location-index="${index}"><i class="fas fa-location-dot" aria-hidden="true"></i><span>${this.escape(label)}</span><small>${Number(location.latitude).toFixed(3)}, ${Number(location.longitude).toFixed(3)}</small></button>`;
        }).join('');
        panel.hidden = false;
        panel.querySelectorAll('[data-location-index]').forEach((button) => button.addEventListener('click', async () => {
            const location = locations[Number(button.dataset.locationIndex)];
            if (!location) return;
            panel.querySelectorAll('.weather-location-option').forEach((option) => {
                const active = option === button;
                option.classList.toggle('is-selected', active);
                option.setAttribute('aria-selected', String(active));
            });
            document.getElementById('search-input').value = location.name || '';
            this.addLocationMarkers([location]);
            if (this.map) {
                this.map.invalidateSize();
                this.map.flyTo([location.latitude, location.longitude], 11, { duration: 0.7 });
            }
            await this.selectLocation(location);
            document.querySelector('.weather-command-center')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }));
    }

    async refresh() {
        if (this.selected) await this.selectLocation(this.selected.location);
        else await this.fetchLocations('India');
    }

    async useLocation(select) {
        if (!navigator.geolocation) { this.showError('Location permission is unavailable. Please select your location manually.', 'Location unavailable.'); return; }
        navigator.geolocation.getCurrentPosition(async (position) => {
            const location = { name: 'Current location', latitude: position.coords.latitude, longitude: position.coords.longitude, country: '', admin1: '' };
            if (this.map) this.map.setView([location.latitude, location.longitude], 11);
            this.addLocationMarkers([location]);
            if (select) await this.selectLocation(location);
        }, () => this.showError('Location permission is unavailable. Please select your location manually.', 'Location unavailable.'));
    }

    addLocationMarkers(locations) {
        if (!this.map) return;
        this.markers.forEach((marker) => this.map.removeLayer(marker)); this.markers.clear();
        locations.slice(0, 12).forEach((location) => {
            const marker = L.marker([location.latitude, location.longitude], { icon: this.locationIcon(location), title: location.name || 'Weather location' }).addTo(this.map);
            marker.bindTooltip(location.name || 'Weather location', { direction: 'top', offset: [0, -24] });
            marker.on('click', () => this.selectLocation(location));
            this.markers.set(this.locationKey(location), marker);
        });
    }

    async fetchForecast(location) { return this.request('/api/weather/forecast?lat=' + encodeURIComponent(location.latitude) + '&lon=' + encodeURIComponent(location.longitude)); }

    async selectLocation(location, existingForecast) {
        this.showLoading(true); this.hideError();
        try {
            const forecast = existingForecast || await this.fetchForecast(location);
            this.selected = { location, forecast };
            if (this.map) this.map.setView([location.latitude, location.longitude], Math.max(this.map.getZoom(), 9));
            this.renderBulletin(location, forecast);
            this.renderMapDetails(location, forecast);
            const marker = this.markers.get(this.locationKey(location));
            if (marker) marker.setIcon(this.markerIcon(location, forecast));
            this.renderForecastGrid(location, forecast);
        } catch (error) { this.showError(this.friendlyError(error), 'Unable to load weather information.'); }
        finally { this.showLoading(false); }
    }

    renderBulletin(location, forecast) {
        const current = forecast.current || {}; const daily = forecast.daily || {}; const hourly = forecast.hourly || {};
        const name = [location.name, location.admin1, location.country].filter(Boolean).join(', ') || 'Selected location';
        const probability = this.number(hourly.precipitation_probability?.[0]);
        const condition = this.condition(current.weather_code);
        this.text('bulletin-location', name); this.text('bulletin-updated', 'Last updated: ' + (current.time ? this.dateTime(current.time) : 'Not available')); this.text('current-weather-title', name);
        this.text('current-date-time', current.time ? this.dateTime(current.time) : 'Not available');
        this.text('current-temperature', this.value(current.temperature_2m, '°C')); this.text('current-condition', condition.label);
        this.text('current-feels-like', 'Feels like ' + this.value(current.apparent_temperature, '°C'));
        this.text('current-rain', this.value(probability, '%')); this.text('current-humidity', this.value(current.relative_humidity_2m, '%')); this.text('current-wind', this.value(current.wind_speed_10m, ' km/h'));
        this.text('sun-times', daily.sunrise?.[0] && daily.sunset?.[0] ? `${this.time(daily.sunrise[0])} / ${this.time(daily.sunset[0])}` : 'Not available');
        const icon = document.getElementById('current-weather-icon'); icon.className = condition.icon; icon.setAttribute('aria-label', condition.label);
        this.renderDaily(daily); this.renderHourly(hourly, current.weather_code); this.renderAdvisory(current, probability); this.renderAlerts(forecast, current, probability); this.renderTicker(current, probability);
        document.getElementById('weather-content').hidden = false; document.getElementById('weather-ticker').hidden = false; document.getElementById('weather-data-status').textContent = 'LIVE FORECAST';
    }

    renderDaily(daily) {
        const items = (daily.time || []).slice(0, 7).map((date, index) => `<article class="forecast-day"><span>${this.dateLabel(date)}</span><i class="${this.condition(daily.weather_code?.[index]).icon}" aria-hidden="true"></i><strong>${this.value(daily.temperature_2m_max?.[index], '°C')}</strong><small>Low ${this.value(daily.temperature_2m_min?.[index], '°C')}</small><em>Rain ${this.value(daily.precipitation_probability_max?.[index], '%')}</em><p>${this.condition(daily.weather_code?.[index]).label}</p></article>`).join('');
        document.getElementById('daily-forecast').innerHTML = items || '<p class="empty-message">Seven-day forecast: Not available</p>';
    }

    renderHourly(hourly, fallback) {
        const items = (hourly.time || []).slice(0, 12).map((time, index) => `<article class="forecast-hour"><span>${this.time(time)}</span><i class="${this.condition(hourly.weather_code?.[index] ?? fallback).icon}" aria-hidden="true"></i><strong>${this.value(hourly.temperature_2m?.[index], '°C')}</strong><small>Rain ${this.value(hourly.precipitation_probability?.[index], '%')}</small></article>`).join('');
        document.getElementById('hourly-forecast').innerHTML = items || '<p class="empty-message">Hourly forecast: Not available</p>';
    }

    renderAdvisory(current, probability) {
        const rain = probability >= 60 || this.number(current.precipitation) >= 5; const wind = this.number(current.wind_speed_10m) >= 30; const humidity = this.number(current.relative_humidity_2m) >= 75;
        const cards = [['Irrigation', rain ? 'Rain is expected; check soil moisture before irrigating.' : 'Plan irrigation according to soil moisture and rainfall conditions.'], ['Crop disease risk', humidity ? 'High humidity may increase crop disease risk; inspect leaves regularly.' : 'Inspect crops regularly for disease and pest symptoms.'], ['Pest activity', 'Monitor crop edges and new growth for pest activity after weather changes.'], ['Spraying', wind || rain ? 'Avoid spraying during rainfall or strong wind.' : 'Choose calm, dry conditions and follow product guidance.'], ['Harvesting', rain ? 'Protect harvested produce and review field drainage before harvest.' : 'Check crop readiness and local field conditions before harvest.'], ['Field inspection', 'Walk the field after significant weather and check drainage, lodging and soil moisture.']];
        document.getElementById('farmer-advisory').innerHTML = cards.map(([title, text]) => `<article class="advisory-card"><i class="fas ${this.advisoryIcon(title)}" aria-hidden="true"></i><div><h3>${title}</h3><p>${text}</p></div></article>`).join('');
    }

    renderAlerts(forecast, current, probability) {
        const alerts = Array.isArray(forecast.alerts) ? forecast.alerts : []; const generated = [];
        if (probability >= 85) generated.push('Heavy rain possible. Check field drainage and monitor low-lying areas.');
        if (this.number(current.wind_speed_10m) >= 45) generated.push('Strong wind conditions possible. Secure loose farm materials.');
        if (this.number(current.temperature_2m) >= 38) generated.push('High temperature conditions. Monitor crops, livestock and water availability.');
        const all = alerts.concat(generated); document.getElementById('weather-alerts').innerHTML = all.length ? all.map((item) => `<div class="alert-item"><i class="fas fa-circle-exclamation" aria-hidden="true"></i><span>${this.escape(item)}</span></div>`).join('') : '<div class="alert-item alert-neutral"><i class="fas fa-circle-check" aria-hidden="true"></i><span>No active weather alert from the available forecast.</span></div>';
        document.getElementById('alert-note').textContent = forecast.alert_note || 'Advisory conditions are generated from forecast values and are not official warnings.';
    }

    renderTicker(current, probability) {
        let message = probability >= 60 ? 'Rain is expected; check field drainage.' : 'Plan irrigation according to rainfall conditions.';
        if (this.number(current.relative_humidity_2m) >= 75) message += ' High humidity may increase crop disease risk.';
        if (this.number(current.wind_speed_10m) >= 30) message += ' Avoid spraying during strong wind.';
        document.getElementById('ticker-content').textContent = message;
    }

    renderForecastGrid(location, forecast) {
        if (!this.map) return;
        Object.values(this.layers).forEach(layer => layer?.clearLayers?.());
        const current = forecast.current || {};
        const hourly = forecast.hourly || {};
        const probability = this.number(hourly.precipitation_probability?.[0] ?? forecast.daily?.precipitation_probability_max?.[0]);
        const rainColor = probability === null ? '#6b8d55' : probability >= 70 ? '#b83245' : probability >= 40 ? '#e28a32' : '#238be8';
        L.circleMarker([location.latitude, location.longitude], {
            radius: 13, color: rainColor, fillColor: rainColor, fillOpacity: .3, weight: 3
        }).bindPopup(`<strong>${this.escape(location.name || 'Selected location')}</strong><br>Rain chance: ${this.value(probability, '%')}`).addTo(this.layers.forecast);

        const cloud = this.number(current.cloud_cover);
        if (cloud !== null) this.mapDataMarker(location, `<i class="fas fa-cloud"></i><span>Cloud cover ${this.value(cloud, '%')}</span>`).addTo(this.layers.clouds);
        const wind = this.number(current.wind_speed_10m);
        if (wind !== null) {
            const direction = this.number(current.wind_direction_10m) || 0;
            this.mapDataMarker(location, `<i class="fas fa-arrow-up" style="transform:rotate(${direction}deg)"></i><span>Wind ${this.value(wind, ' km/h')}</span>`).addTo(this.layers.wind);
        }
        const condition = this.condition(current.weather_code);
        const temperature = this.number(current.temperature_2m);
        if (temperature !== null) this.mapDataMarker(location, `<i class="${condition.icon}"></i><span>${this.value(temperature, '°C')} · ${this.escape(condition.label)}</span>`).addTo(this.layers.temperature);
    }

    mapDataMarker(location, html) {
        return L.marker([location.latitude, location.longitude], {
            interactive: false,
            icon: L.divIcon({ className: 'weather-news-label', html, iconSize: null })
        });
    }

    renderMapDetails(location, forecast) {
        const panel = document.getElementById('weather-details-panel');
        const current = forecast.current || {};
        const hourly = forecast.hourly || {};
        const condition = this.condition(current.weather_code);
        const name = [location.name, location.admin1, location.country].filter(Boolean).join(', ') || 'Selected location';
        const rain = this.number(hourly.precipitation_probability?.[0] ?? forecast.daily?.precipitation_probability_max?.[0]);
        const nextHours = (hourly.time || []).slice(0, 6).map((time, index) => `<div class="forecast-item"><span>${this.time(time)}</span><i class="${this.condition(hourly.weather_code?.[index] ?? current.weather_code).icon}" aria-hidden="true"></i><strong>${this.value(hourly.temperature_2m?.[index], '°C')}</strong><span>Rain ${this.value(hourly.precipitation_probability?.[index], '%')}</span></div>`).join('');
        panel.innerHTML = `<div class="weather-selected-heading"><div><span class="broadcast-kicker">Selected location</span><h3>${this.escape(name)}</h3><span class="weather-condition">${this.escape(condition.label)}</span></div></div><div class="weather-current-summary"><i class="${condition.icon}" aria-hidden="true"></i><div><strong>${this.value(current.temperature_2m, '°C')}</strong><span>${this.escape(condition.label)} · Feels like ${this.value(current.apparent_temperature, '°C')}</span></div></div><div class="weather-stat-grid"><div><span>Chance of rain</span><strong>${this.value(rain, '%')}</strong></div><div><span>Humidity</span><strong>${this.value(current.relative_humidity_2m, '%')}</strong></div><div><span>Wind speed</span><strong>${this.value(current.wind_speed_10m, ' km/h')}</strong></div><div><span>Cloud cover</span><strong>${this.value(current.cloud_cover, '%')}</strong></div></div><div class="weather-panel-section"><h4>Next 6 hours</h4><div class="hourly-list">${nextHours || '<p class="empty-message">Hourly forecast: Not available</p>'}</div></div><p class="weather-map-data-note">Forecast for this location · Tap another pin to compare.</p>`;
    }

    toggleOverlay(button) { const type = button.dataset.overlay; const layer = type === 'rain' ? this.layers.forecast : this.layers[type]; if (!layer || !this.map) return; const show = !button.classList.contains('is-active'); button.classList.toggle('is-active', show); button.textContent = (show ? 'Hide ' : 'Show ') + type[0].toUpperCase() + type.slice(1); if (show) layer.addTo(this.map); else this.map.removeLayer(layer); }
    selectMapType(type) { if (!this.map) return; if (type === 'satellite') { this.map.removeLayer(this.layers.street); this.layers.satellite.addTo(this.map); } else { this.map.removeLayer(this.layers.satellite); this.layers.street.addTo(this.map); } }
    resetMap() { if (this.map) this.map.setView(this.selected ? [this.selected.location.latitude, this.selected.location.longitude] : [22.5, 78.9], this.selected ? 9 : 5); }
    markerIcon(location, forecast) { const current = forecast.current || {}; const condition = this.condition(current.weather_code); return L.divIcon({ className: 'weather-map-marker weather-map-marker-data', html: `<span class="weather-marker-name">${this.escape(location.name || 'Weather')}</span><strong>${this.value(current.temperature_2m, '°C')}</strong><small><i class="${condition.icon}"></i>${this.escape(condition.label)}</small>`, iconSize: [112, 68], iconAnchor: [56, 64] }); }
    locationIcon(location) { return L.divIcon({ className: 'weather-map-marker weather-map-marker-data', html: `<span class="weather-marker-name">${this.escape(location?.name || 'Weather')}</span><strong>...</strong><small>Tap for forecast</small>`, iconSize: [112, 68], iconAnchor: [56, 64] }); }
    markerLabel(location, forecast) { return `${location.name} - ${this.value(forecast.current?.temperature_2m, '°C')} - ${this.condition(forecast.current?.weather_code).label}`; }
    addNewsLabel(location, forecast) { if (this.layers.forecast) L.marker([location.latitude, location.longitude], { icon: L.divIcon({ className: 'weather-news-label', html: this.condition(forecast.current?.weather_code).label }) }).addTo(this.layers.forecast); }
    condition(code) { const value = Number(code); if ([95, 96, 99].includes(value)) return { label: 'Thunderstorm', icon: 'fas fa-bolt' }; if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(value)) return { label: 'Rain', icon: 'fas fa-cloud-rain' }; if ([71, 73, 75, 77, 85, 86].includes(value)) return { label: 'Snow', icon: 'fas fa-snowflake' }; if ([2, 3].includes(value)) return { label: 'Cloudy', icon: 'fas fa-cloud' }; return { label: 'Sunny', icon: 'fas fa-sun' }; }
    advisoryIcon(title) { return { Irrigation: 'fa-droplet', 'Crop disease risk': 'fa-leaf', 'Pest activity': 'fa-bug', Spraying: 'fa-spray-can-sparkles', Harvesting: 'fa-wheat-awn', 'Field inspection': 'fa-magnifying-glass' }[title] || 'fa-circle-info'; }
    async request(url) {
        let localError;
        try {
            const response = await fetch(url);
            const data = await response.json();
            if (!response.ok) throw new Error(data.message || data.error || 'Weather service unavailable.');
            if (url.includes('/api/weather/locations') && !Array.isArray(data.locations)) throw new Error('Weather service returned an invalid location response.');
            if (url.includes('/api/weather/forecast') && !data.current) throw new Error('Weather service returned an invalid forecast response.');
            return data;
        } catch (error) { localError = error; }
        try { return await this.requestOpenMeteo(url); }
        catch (error) { throw new Error(error.message || localError?.message || 'Weather service unavailable.'); }
    }
    async requestOpenMeteo(url) {
        const requestUrl = new URL(url, window.location.href);
        let upstream;
        if (requestUrl.pathname.endsWith('/locations')) {
            const params = new URLSearchParams({ name: requestUrl.searchParams.get('query') || 'India', count: '12', language: 'en', format: 'json' });
            upstream = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`);
            const data = await upstream.json();
            if (!upstream.ok) throw new Error('Location forecast service is unavailable.');
            return { locations: (data.results || []).filter(item => item.latitude != null && item.longitude != null).map(item => ({ name: item.name, latitude: item.latitude, longitude: item.longitude, country: item.country, admin1: item.admin1, timezone: item.timezone })) };
        }
        if (requestUrl.pathname.endsWith('/forecast')) {
            const params = new URLSearchParams({
                latitude: requestUrl.searchParams.get('lat'), longitude: requestUrl.searchParams.get('lon'), timezone: 'auto', forecast_days: '7',
                current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,rain,showers,snowfall,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m',
                hourly: 'temperature_2m,precipitation_probability,precipitation,rain,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m',
                daily: 'weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,sunrise,sunset,precipitation_sum,rain_sum,precipitation_probability_max,wind_speed_10m_max,wind_direction_10m_dominant'
            });
            upstream = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
            const data = await upstream.json();
            if (!upstream.ok || !data.current) throw new Error('Forecast service is unavailable.');
            data.alerts = [];
            data.alert_note = 'Open-Meteo forecast data does not include official weather alerts.';
            return data;
        }
        throw new Error('Weather request is not supported.');
    }
    friendlyError(error) { if (!navigator.onLine || error.message === 'offline' || error instanceof TypeError) return 'You are offline. Please check your internet connection.'; return error.message || 'Please try again in a moment.'; }
    showLoading(active) { document.getElementById('weather-loading').hidden = !active; if (active) document.getElementById('weather-content').hidden = true; }
    showError(message, title) { this.showLoading(false); document.getElementById('weather-error-title').textContent = title || 'Unable to load weather information.'; document.getElementById('weather-error-message').textContent = message; document.getElementById('weather-error').hidden = false; document.getElementById('weather-data-status').textContent = 'UPDATE UNAVAILABLE'; }
    hideError() { document.getElementById('weather-error').hidden = true; }
    text(id, value) { document.getElementById(id).textContent = value; }
    number(value) { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
    value(value, suffix) { const number = this.number(value); return number === null ? 'Not available' : `${Math.round(number * 10) / 10}${suffix || ''}`; }
    dateTime(value) { const locale = document.documentElement.lang === 'hi' ? 'hi-IN' : undefined; return new Date(value).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }); }
    dateLabel(value) { const locale = document.documentElement.lang === 'hi' ? 'hi-IN' : undefined; return new Date(value).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' }); }
    time(value) { const locale = document.documentElement.lang === 'hi' ? 'hi-IN' : undefined; return new Date(value).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }); }
    escape(value) { return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character])); }
    locationKey(location) { return `${Number(location.latitude).toFixed(4)},${Number(location.longitude).toFixed(4)}`; }
    readFavorites() { try { return JSON.parse(localStorage.getItem('smart_farm_weather_favorites') || '[]'); } catch (error) { return []; } }
}

document.addEventListener('DOMContentLoaded', () => { new WeatherApp(); });
