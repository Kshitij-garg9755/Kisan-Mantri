/* Crop Disease Diagnosis — upload, camera, preview, submit, history */
(function () {
  'use strict';
  var SF = window.SF;
  var selectedFile = null;
  var preview = document.getElementById('diag-preview');
  var previewWrap = document.getElementById('diag-preview-wrap');

  var ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
  var MAX_BYTES = 5 * 1024 * 1024;

  function setFile(file) {
    var msg = document.getElementById('diag-msg');
    if (!file) return;
    if (ALLOWED.indexOf(file.type) === -1) { msg.textContent = 'Only JPG, PNG or WEBP images are allowed.'; selectedFile = null; return; }
    if (file.size > MAX_BYTES) { msg.textContent = 'The image is larger than 5 MB.'; selectedFile = null; return; }
    selectedFile = file;
    msg.textContent = '';
    preview.src = URL.createObjectURL(file);
    previewWrap.classList.remove('sf-hidden');
  }

  function submit() {
    if (!SF.isLoggedIn()) { SF.toast('Please log in to submit a photo for diagnosis.', 'error'); return; }
    var msg = document.getElementById('diag-msg');
    var crop = document.getElementById('diag-crop').value;
    if (!selectedFile) { msg.textContent = 'Please add a crop photo first.'; return; }
    if (!crop) { msg.textContent = 'Please select the crop type.'; return; }
    msg.textContent = 'Submitting…';
    var form = new FormData();
    form.append('image', selectedFile);
    form.append('crop', crop);
    SF.postForm(SF.API + '/diagnosis/analyze', form).then(function (res) {
      if (!res.ok) { msg.textContent = SF.errorMessage(res.data); return; }
      msg.textContent = '';
      renderResult(res.data.result);
      loadHistory();
    });
  }

  function renderResult(result) {
    var panel = document.getElementById('diag-result-panel');
    var box = document.getElementById('diag-result');
    panel.classList.remove('sf-hidden');
    box.innerHTML =
      '<div class="diag-status-badge">' + SF.statusPill(result.status) + '</div>' +
      '<div class="diag-result-title">' + SF.esc(result.result_label) + '</div>' +
      '<div class="diag-result-grid">' +
      item('Crop', result.crop) +
      item('Confidence score', result.confidence == null ? 'Not available' : (result.confidence + '%')) +
      item('Symptoms', result.symptoms || 'Not available') +
      item('Prevention', result.prevention || 'Not available') +
      item('Treatment guidance', result.treatment || 'Not available') +
      '</div>' +
      '<p class="sf-muted">' + SF.esc(result.message || '') + '</p>';
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function item(label, value) {
    return '<div class="diag-result-item"><span>' + SF.esc(label) + '</span><strong>' + SF.esc(value) + '</strong></div>';
  }

  function loadHistory() {
    var box = document.getElementById('diag-history');
    if (!SF.isLoggedIn()) { box.innerHTML = '<p class="sf-muted">Log in to save and view your history.</p>'; return; }
    SF.get(SF.API + '/diagnosis/history').then(function (res) {
      var history = res.data.history || [];
      if (!history.length) { box.innerHTML = '<p class="sf-muted">No diagnosis records yet.</p>'; return; }
      box.innerHTML = history.map(function (h) {
        return '<div class="diag-history-item">' +
          '<img src="' + SF.esc(h.image_url) + '" alt="Diagnosis record for ' + SF.esc(h.crop) + '">' +
          '<div class="diag-history-body">' +
          '<strong>' + SF.esc(h.crop) + '</strong>' +
          '<span class="sf-muted">' + SF.esc(h.result_label) + '</span><br>' +
          '<span class="sf-muted">' + SF.esc(h.created_at) + '</span>' +
          '</div>' +
          '<button class="sf-btn sf-btn-outline sf-btn-sm" data-delete="' + h.id + '">Delete</button>' +
          '</div>';
      }).join('');
    });
  }

  function deleteRecord(id) {
    SF.confirm('Delete this record?', 'The saved diagnosis record and its image will be removed.', 'Delete').then(function (ok) {
      if (!ok) return;
      SF.del(SF.API + '/diagnosis/history/' + id).then(function (res) {
        if (res.ok) { SF.toast('Record deleted.', 'success'); loadHistory(); }
        else SF.toast(SF.errorMessage(res.data), 'error');
      });
    });
  }

  // Events
  document.getElementById('diag-file').addEventListener('change', function (e) { setFile(e.target.files[0]); });
  document.getElementById('diag-camera').addEventListener('change', function (e) { setFile(e.target.files[0]); });
  document.getElementById('diag-camera-btn').addEventListener('click', function () { document.getElementById('diag-camera').click(); });
  document.getElementById('diag-submit').addEventListener('click', submit);
  document.getElementById('diag-history').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-delete]');
    if (btn) deleteRecord(btn.dataset.delete);
  });

  SF.bootHeader().then(function (farmer) {
    document.getElementById('diag-model-note').innerHTML = farmer
      ? document.getElementById('diag-model-note').innerHTML
      : '⚙️ <strong>Important:</strong> Log in to submit a photo and save your diagnosis history. No trained AI model is connected yet — results will be clearly marked as demo.';
    loadHistory();
  });
}());
