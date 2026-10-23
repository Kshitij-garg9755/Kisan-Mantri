/* Kisan Radio — program list + audio player (honest empty state) */
(function () {
  'use strict';
  var SF = window.SF;
  var audio = document.getElementById('radio-audio');
  var programs = [];
  var index = -1;
  var onlySaved = false;

  function fmt(seconds) {
    if (!isFinite(seconds)) seconds = 0;
    var m = Math.floor(seconds / 60);
    var s = Math.floor(seconds % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function setStatus(html, cls) {
    var el = document.getElementById('radio-status-msg');
    if (!html) { el.classList.add('sf-hidden'); return; }
    el.className = cls || 'sf-loading';
    el.innerHTML = html;
  }

  function card(program) {
    var hasAudio = program.has_audio;
    return '<article class="sf-card radio-card' + (program.id === index ? ' active' : '') + '" data-id="' + program.id + '">' +
      '<span class="radio-card-cat">' + SF.esc(program.category) + '</span>' +
      '<h3>' + SF.esc(program.title) + '</h3>' +
      (program.title_hi ? '<div class="radio-card-hi">' + SF.esc(program.title_hi) + '</div>' : '') +
      '<p>' + SF.esc(program.description) + '</p>' +
      '<div class="radio-card-meta">' + SF.esc(program.host || 'Kisan Radio') + ' · ' +
      (hasAudio ? fmt(program.duration_seconds) : 'No audio') + ' · ' +
      (hasAudio ? '<span class="sf-pill sf-pill-live">Audio available</span>' : '<span class="sf-pill sf-pill-unavailable">Audio not available</span>') +
      '</div>' +
      '<div class="radio-card-actions">' +
      '<button class="sf-btn sf-btn-primary sf-btn-sm" data-play="' + program.id + '"' + (hasAudio ? '' : ' disabled') + '>▶ Play</button>' +
      '<button class="sf-btn sf-btn-outline sf-btn-sm" data-save="' + program.id + '">' + (program.saved ? '★ Saved' : '☆ Save') + '</button>' +
      '</div>' +
      '</article>';
  }

  function load() {
    setStatus('Loading programs…', 'sf-loading');
    var url = SF.API + (onlySaved ? '/radio/saved' : '/radio/programs');
    if (onlySaved && !SF.isLoggedIn()) { setStatus('Log in to see your saved programs.', 'sf-notice'); document.getElementById('radio-list').innerHTML = ''; return; }
    var category = document.getElementById('radio-category').value;
    if (!onlySaved && category) url += '?category=' + encodeURIComponent(category);
    SF.get(url).then(function (res) {
      if (!res.ok) { setStatus('Could not load programs.', 'sf-error'); return; }
      programs = res.data.programs || [];
      document.getElementById('radio-no-audio').classList.toggle('sf-hidden', res.data.has_audio !== false);
      if (!programs.length) {
        document.getElementById('radio-list').innerHTML = '';
        setStatus('No programs match your filter yet.', 'sf-empty');
        return;
      }
      setStatus('');
      document.getElementById('radio-list').innerHTML = programs.map(card).join('');
    });
  }

  function loadCategories() {
    SF.get(SF.API + '/radio/programs').then(function (res) {
      var select = document.getElementById('radio-category');
      (res.data.categories || []).forEach(function (cat) {
        var opt = document.createElement('option');
        opt.value = cat; opt.textContent = cat;
        select.appendChild(opt);
      });
    });
  }

  function play(id) {
    var program = programs.filter(function (p) { return p.id === id; })[0];
    if (!program) return;
    if (!program.has_audio || !program.audio_url) {
      SF.toast('This program has no audio file attached yet.', 'error');
      return;
    }
    index = id;
    audio.src = program.audio_url;
    document.getElementById('radio-title').textContent = program.title;
    document.getElementById('radio-host').textContent = program.host || '';
    document.getElementById('radio-save').dataset.id = id;
    document.getElementById('radio-save').textContent = program.saved ? '★ Saved' : '☆ Save program';
    audio.play().then(function () {
      document.getElementById('radio-status').textContent = 'Playing';
      document.getElementById('radio-status').className = 'sf-pill sf-pill-live';
    }).catch(function () { SF.toast('Could not start playback.', 'error'); });
    load();
  }

  function step(delta) {
    var playable = programs.filter(function (p) { return p.has_audio; });
    if (!playable.length) { SF.toast('No playable programs available.', 'error'); return; }
    var pos = playable.map(function (p) { return p.id; }).indexOf(index);
    pos = (pos + delta + playable.length) % playable.length;
    play(playable[pos].id);
  }

  function toggleSave(id) {
    if (!SF.isLoggedIn()) { SF.toast('Please log in to save a program.', 'error'); return; }
    SF.postJson(SF.API + '/radio/programs/' + id + '/save', {}).then(function (res) {
      if (res.ok) { SF.toast(res.data.saved ? 'Program saved.' : 'Removed from saved.', 'success'); load(); }
      else SF.toast(SF.errorMessage(res.data), 'error');
    });
  }

  // Player events
  document.getElementById('radio-play').addEventListener('click', function () {
    if (audio.paused) { audio.play().catch(function () { SF.toast('Nothing to play.', 'error'); }); }
    else audio.pause();
  });
  audio.addEventListener('play', function () { setPlayLabel('⏸ Pause'); });
  audio.addEventListener('pause', function () { setPlayLabel('▶ Play'); });
  function setPlayLabel(text) { document.getElementById('radio-play').textContent = text; }
  audio.addEventListener('ended', function () { step(1); });
  audio.addEventListener('timeupdate', function () {
    if (!audio.duration) return;
    document.getElementById('radio-progress').value = (audio.currentTime / audio.duration) * 100;
    document.getElementById('radio-current-time').textContent = fmt(audio.currentTime);
  });
  audio.addEventListener('loadedmetadata', function () {
    document.getElementById('radio-duration').textContent = fmt(audio.duration);
  });
  document.getElementById('radio-progress').addEventListener('input', function (e) {
    if (audio.duration) audio.currentTime = (e.target.value / 100) * audio.duration;
  });
  document.getElementById('radio-volume').addEventListener('input', function (e) { audio.volume = e.target.value / 100; });
  audio.volume = 0.8;
  document.getElementById('radio-prev').addEventListener('click', function () { step(-1); });
  document.getElementById('radio-next').addEventListener('click', function () { step(1); });
  document.getElementById('radio-save').addEventListener('click', function () { if (this.dataset.id) toggleSave(Number(this.dataset.id)); });

  document.getElementById('radio-category').addEventListener('change', load);
  document.getElementById('radio-only-saved').addEventListener('change', function (e) { onlySaved = e.target.checked; load(); });
  document.getElementById('radio-list').addEventListener('click', function (e) {
    var playBtn = e.target.closest('[data-play]');
    var saveBtn = e.target.closest('[data-save]');
    if (playBtn) play(Number(playBtn.dataset.play));
    if (saveBtn) toggleSave(Number(saveBtn.dataset.save));
  });

  // Boot
  SF.bootHeader().then(function () { loadCategories(); load(); });
}());
