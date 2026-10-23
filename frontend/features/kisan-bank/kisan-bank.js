/* Kisan Bank — safe info section + calculators (no transactions, no credentials) */
(function () {
  'use strict';
  var SF = window.SF;

  function inr(value) {
    if (!isFinite(value)) return '₹0';
    return '₹' + Math.round(value).toLocaleString('en-IN');
  }

  // ---- EMI calculator ----
  function calcEmi() {
    var principal = parseFloat(document.getElementById('emi-amount').value) || 0;
    var annual = parseFloat(document.getElementById('emi-rate').value) || 0;
    var months = parseInt(document.getElementById('emi-months').value, 10) || 0;
    var out = document.getElementById('emi-result');
    if (principal <= 0 || months <= 0) { out.innerHTML = '<p class="sf-muted">Enter a valid amount and tenure.</p>'; return; }
    var monthlyRate = annual / 12 / 100;
    var emi = monthlyRate > 0
      ? principal * monthlyRate * Math.pow(1 + monthlyRate, months) / (Math.pow(1 + monthlyRate, months) - 1)
      : principal / months;
    var total = emi * months;
    out.innerHTML =
      row('Monthly EMI', inr(emi)) +
      row('Total interest', inr(total - principal)) +
      '<div class="bank-result-row bank-result-total"><span>Total payable</span><strong>' + inr(total) + '</strong></div>';
  }

  // ---- Crop loan estimator (simple interest, optional subvention) ----
  function calcCrop() {
    var principal = parseFloat(document.getElementById('crop-amount').value) || 0;
    var months = parseInt(document.getElementById('crop-months').value, 10) || 0;
    var subvention = document.getElementById('crop-subvention').value === '1';
    var out = document.getElementById('crop-result');
    if (principal <= 0 || months <= 0) { out.innerHTML = '<p class="sf-muted">Enter a valid amount and season length.</p>'; return; }
    var baseRate = 7; // illustrative base agricultural rate
    var effectiveRate = subvention ? Math.max(baseRate - 3, 0) : baseRate;
    var interest = principal * (effectiveRate / 100) * (months / 12);
    out.innerHTML =
      row('Effective rate', effectiveRate + '% p.a.') +
      row('Estimated interest', inr(interest)) +
      '<div class="bank-result-row bank-result-total"><span>Amount to repay</span><strong>' + inr(principal + interest) + '</strong></div>';
  }

  // ---- Savings calculator ----
  function calcSave() {
    var monthly = parseFloat(document.getElementById('save-monthly').value) || 0;
    var years = parseInt(document.getElementById('save-years').value, 10) || 0;
    var annual = parseFloat(document.getElementById('save-rate').value) || 0;
    var out = document.getElementById('save-result');
    if (monthly <= 0 || years <= 0) { out.innerHTML = '<p class="sf-muted">Enter a monthly amount and duration.</p>'; return; }
    var months = years * 12;
    var monthlyRate = annual / 12 / 100;
    var future = monthlyRate > 0
      ? monthly * ((Math.pow(1 + monthlyRate, months) - 1) / monthlyRate)
      : monthly * months;
    var invested = monthly * months;
    out.innerHTML =
      row('Total invested', inr(invested)) +
      row('Estimated interest', inr(future - invested)) +
      '<div class="bank-result-row bank-result-total"><span>Estimated value</span><strong>' + inr(future) + '</strong></div>';
  }

  function row(label, value) {
    return '<div class="bank-result-row"><span>' + label + '</span><strong>' + value + '</strong></div>';
  }

  function loadInfo() {
    SF.get(SF.API + '/bank/info').then(function (res) {
      var statusEl = document.getElementById('bank-status');
      if (!res.ok) { statusEl.className = 'sf-error'; statusEl.textContent = 'Could not load financial information.'; return; }
      statusEl.className = 'sf-hidden';
      var data = res.data;

      document.getElementById('bank-schemes').innerHTML = (data.schemes || []).map(function (s) {
        return '<article class="sf-card bank-scheme-card">' +
          '<div class="scheme-cat" style="font-size:11px;font-weight:800;text-transform:uppercase;color:var(--sf-green);">' + SF.esc(s.category) + '</div>' +
          '<h3>' + SF.esc(s.title) + '</h3>' +
          '<p>' + SF.esc(s.summary) + '</p>' +
          (s.official_url ? '<a class="sf-btn sf-btn-dark sf-btn-sm" href="' + SF.esc(s.official_url) + '" target="_blank" rel="noopener noreferrer">Official website ↗</a>' : '') +
          '</article>';
      }).join('') || '<p class="sf-muted">No finance schemes available.</p>';

      document.getElementById('bank-articles').innerHTML = (data.articles || []).map(function (a) {
        return '<article class="sf-card"><h3>' + SF.esc(a.title) + '</h3><p>' + SF.esc(a.body) + '</p></article>';
      }).join('');
    });
  }

  ['emi-amount', 'emi-rate', 'emi-months'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', calcEmi);
  });
  ['crop-amount', 'crop-months', 'crop-subvention'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', calcCrop);
    document.getElementById(id).addEventListener('change', calcCrop);
  });
  ['save-monthly', 'save-years', 'save-rate'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', calcSave);
  });

  SF.bootHeader().then(function () {
    calcEmi(); calcCrop(); calcSave(); loadInfo();
  });
}());
