(function () {
  'use strict';
  if (window.smartFarmInteractionsLoaded) return;
  window.smartFarmInteractionsLoaded = true;

  function showNotice(message) {
    var notice = document.getElementById('notice');
    if (!notice) {
      notice = document.createElement('div');
      notice.id = 'notice';
      document.body.appendChild(notice);
    }
    notice.textContent = message;
    notice.classList.add('is-visible');
    window.clearTimeout(showNotice.timer);
    showNotice.timer = window.setTimeout(function () {
      notice.classList.remove('is-visible');
    }, 2200);
  }

  function setupMobileNavigation() {
    var header = document.querySelector('.site-header');
    var nav = document.querySelector('.nav');
    if (!header || !nav || document.querySelector('.menu-toggle')) return;
    var toggle = document.createElement('button');
    toggle.className = 'menu-toggle';
    toggle.type = 'button';
    toggle.setAttribute('aria-label', 'Open navigation');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', 'primary-nav');
    toggle.textContent = '\u2630';
    header.querySelector('.header-inner').appendChild(toggle);
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
      toggle.textContent = open ? '\u00d7' : '\u2630';
    });
    nav.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        nav.classList.remove('is-open');
        toggle.textContent = '\u2630';
        toggle.setAttribute('aria-label', 'Open navigation');
        toggle.setAttribute('aria-expanded', 'false');
      });
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && nav.classList.contains('is-open')) {
        nav.classList.remove('is-open');
        toggle.textContent = '\u2630';
        toggle.setAttribute('aria-label', 'Open navigation');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.focus();
      }
    });
  }

  function setupHelpline() {
    var button = document.getElementById('helpline-btn') || document.querySelector('.cta .btn');
    if (!button || document.getElementById('site-help-modal')) return;
    var modal = document.createElement('div');
    modal.id = 'site-help-modal';
    modal.className = 'site-modal';
    modal.innerHTML = '<div class="site-modal-card" role="dialog" aria-modal="true" aria-label="Kisan Mantri support">' +
      '<button class="modal-close" type="button" aria-label="Close">&times;</button>' +
      '<span class="eyebrow">Need a hand?</span><h2>Talk to Kisan Mantri.</h2>' +
      '<p>Call our support line for orders, produce availability, or farmer assistance.</p>' +
      '<a class="btn btn-primary" href="tel:+918871368782">Call +91 8871368782</a></div>';
    document.body.appendChild(modal);
    function close() {
      modal.classList.remove('is-open');
      button.focus();
    }
    button.addEventListener('click', function (event) {
      event.preventDefault();
      modal.classList.add('is-open');
      modal.querySelector('.modal-close').focus();
    });
    modal.querySelector('.modal-close').addEventListener('click', close);
    modal.addEventListener('click', function (event) { if (event.target === modal) close(); });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && modal.classList.contains('is-open')) close();
    });
  }

  function setupImageFallbacks() {
    document.querySelectorAll('img').forEach(function (image) {
      image.addEventListener('error', function () {
        if (image.dataset.fallbackApplied) return;
        image.dataset.fallbackApplied = 'true';
        image.src = '../assets/images/background1.jpg';
        image.classList.add('image-fallback');
      });
    });
  }

  function setupCommonButtons() {
    document.querySelectorAll('.product-card .btn, .card .btn').forEach(function (button) {
      if ((button.textContent || '').trim().toLowerCase() !== 'view') return;
      button.addEventListener('click', function (event) {
        if (button.tagName.toLowerCase() === 'a') return;
        event.preventDefault();
        var card = button.closest('.product-card, .card');
        var title = card?.querySelector('h4, .title');
        showNotice('Opening ' + (title ? title.textContent.trim() : 'product'));
      });
    });
    document.querySelectorAll('.accordion button').forEach(function (button) {
      button.addEventListener('click', function () {
        var item = button.closest('.item');
        if (item) item.classList.toggle('active');
      });
    });
    document.querySelectorAll('footer form').forEach(function (form) {
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        showNotice('You are on the Kisan Mantri list.');
        form.reset();
      });
    });
  }

  window.orderNow = function (itemName) {
    localStorage.setItem('order_draft', JSON.stringify({ product: itemName || 'Product' }));
    window.location.href = '../pages/orders-dashboard.html';
  };

  window.showNotice = showNotice;

  document.addEventListener('DOMContentLoaded', function () {
    setupMobileNavigation();
    setupHelpline();
    setupImageFallbacks();
    setupCommonButtons();
  });
}());
