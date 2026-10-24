(function () {
  'use strict';
  var reelsSoundEnabled = localStorage.getItem('agriverse-reels-sound-enabled') === 'true';
  var state = { farmer: null, filter: 'all', posts: [] };
  var feed = document.getElementById('feed');
  var reelsFeed = document.getElementById('reels-feed');
  var videosFeed = document.getElementById('videos-feed');
  var profileCard = document.getElementById('profile-card');
  var manageContentCard = document.getElementById('manage-content-card');
  var profilePosts = [];
  var relationshipData = { followers: [], following: [], requests: [] };
  var relationshipView = 'followers';
  var manageFilter = 'all';
  var esc = function (value) { return String(value || '').replace(/[&<>"']/g, function (char) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]; }); };
  var media = function (post) { return post.media_url ? (post.kind === 'post' ? '<div class="media-placeholder">🌱</div>' : '<video src="' + esc(post.media_url) + '" controls muted playsinline></video>') : '<div class="media-placeholder">FIELD NOTE</div>'; };
  var followButton = function (post) { var isOwnPost = state.farmer && post.author && state.farmer.id === post.author.id; var label = isOwnPost ? 'Your post' : (post.following ? 'Following' : (post.follow_requested ? 'Requested' : 'Request to follow')); return '<button data-action="follow" data-id="' + post.id + '" class="' + (post.following || post.follow_requested ? 'active' : '') + '"' + (isOwnPost ? ' disabled' : '') + '>' + label + ' @' + esc(post.author && post.author.username) + '</button>'; };
  var isOwner = function (post) { return Boolean(state.farmer && post.creatorId === state.farmer.id); };
  var ownerMenu = function (post) { return isOwner(post) ? '<div class="content-menu"><button class="menu-trigger" data-action="menu" data-id="' + post.id + '" aria-label="Content options">⋯</button><div class="menu-options" data-menu="' + post.id + '"><button data-action="edit" data-id="' + post.id + '">Edit</button><button data-action="delete-request" data-id="' + post.id + '">Delete</button><button data-action="menu-close" data-id="' + post.id + '">Cancel</button></div></div>' : ''; };
  var actions = function (post) { return '<div class="card-actions"><button data-action="like" data-id="' + post.id + '" class="' + (post.liked ? 'active' : '') + '">♥ ' + post.likes + '</button><button data-action="comment" data-id="' + post.id + '">Comment ' + post.comments + '</button><button data-action="save" data-id="' + post.id + '" class="' + (post.saved ? 'active' : '') + '">Save</button>' + followButton(post) + '<button data-action="share" data-id="' + post.id + '">Share</button><button data-action="watch" data-id="' + post.id + '">Watch</button></div>'; };
  var card = function (post) { return '<article class="feed-card content-card">' + ownerMenu(post) + media(post) + '<div class="meta">' + esc(post.kind.toUpperCase()) + ' · @' + esc(post.author && post.author.username) + '</div><h3>' + esc(post.title || post.caption || 'A field note') + '</h3><p>' + esc(post.description || post.caption) + '</p>' + actions(post) + '</article>'; };
  function load() {
    fetch('/api/auth/me').then(function (response) { return response.json(); }).then(function (data) { state.farmer = data.farmer; return fetch('/api/agriverse/feed'); }).then(function (response) { return response.json(); }).then(function (data) { state.posts = data.posts || []; render(state.posts); renderProfile(); });
  }
  function render(posts) {
    var filtered = state.filter === 'all' ? posts : posts.filter(function (post) { return post.kind === state.filter; });
    feed.innerHTML = filtered.length ? filtered.map(card).join('') : '<p class="empty">No content in this view yet. Be the first farmer to share.</p>';
    var reels = posts.filter(function (post) { return post.kind === 'reel'; });
    reelsFeed.innerHTML = reels.length ? reels.map(function (post) { return '<article class="reel-card content-card">' + ownerMenu(post) + '<video src="' + esc(post.media_url) + '" autoplay muted loop playsinline webkit-playsinline preload="metadata"></video><div class="reel-info"><strong>@' + esc(post.author && post.author.username) + '</strong><p>' + esc(post.caption) + '</p></div><div class="reel-actions"><button data-action="like" data-id="' + post.id + '" class="' + (post.liked ? 'active' : '') + '"><span class="icon">♥</span> ' + post.likes + '</button><button data-action="comment" data-id="' + post.id + '"><span class="icon">💬</span> ' + post.comments + '</button><button data-action="save" data-id="' + post.id + '" class="' + (post.saved ? 'active' : '') + '"><span class="icon">💾</span></button><button data-action="share" data-id="' + post.id + '"><span class="icon">↗</span></button></div></article>'; }).join('') : '<p class="empty">Upload the first 9:16 reel for the community.</p>';
    reelsFeed.querySelectorAll('.reel-card').forEach(function (reelCard) {
      var audioButton = document.createElement('button');
      audioButton.type = 'button';
      audioButton.className = 'reel-audio-toggle';
      audioButton.dataset.action = 'toggle-audio';
      audioButton.setAttribute('aria-label', 'Turn sound on');
      audioButton.title = 'Turn sound on';
      audioButton.innerHTML = '<span class="icon" aria-hidden="true">🔇</span>';
      reelCard.querySelector('.reel-actions').appendChild(audioButton);
      var reelVideo = reelCard.querySelector('video');
      setVideoMuted(reelVideo, !reelsSoundEnabled);
      reelVideo.addEventListener('click', function () {
        if (reelVideo.muted) { setReelSound(reelVideo, true); return; }
        if (reelVideo.paused) {
          var playback = reelVideo.play();
          if (playback && playback.catch) playback.catch(function () {});
        } else {
          reelVideo.pause();
        }
      });
    });
    var videos = posts.filter(function (post) { return post.kind === 'video'; });
    videosFeed.innerHTML = videos.length ? videos.map(function (post) { return '<article class="video-card content-card">' + ownerMenu(post) + '<video src="' + esc(post.media_url) + '" controls preload="metadata"></video><div class="meta">@' + esc(post.author && post.author.username) + ' · ' + esc(post.category) + '</div><h3>' + esc(post.title || 'Untitled lesson') + '</h3><p>' + esc(post.description) + '</p>' + actions(post) + '</article>'; }).join('') : '<p class="empty">Long educational videos will appear here after upload.</p>';
    setupAutoplay();
    resolveVideoSources(document);
  }

  function resolveVideoSources(root) {
    var resolveUrl = window.SMART_FARM_DEV_CONFIG && window.SMART_FARM_DEV_CONFIG.resolveMediaUrl;
    if (!resolveUrl) return;
    root.querySelectorAll('video[src^="/uploads/"]').forEach(function (video) {
      if (video.dataset.resolvingMedia) return;
      video.dataset.resolvingMedia = 'true';
      resolveUrl(video.getAttribute('src')).then(function (url) {
        if (!video.isConnected || !url) return;
        video.src = url;
        video.load();
        if (video.closest('.reel-card') && video.getBoundingClientRect().height > 0) {
          video.muted = true;
          var playback = video.play();
          if (playback && playback.catch) playback.catch(function () {});
        }
      }).catch(function () { video.dataset.resolvingMedia = ''; });
    });
  }
  function renderProfile() {
    if (!state.farmer) {
      profileCard.innerHTML = '<div class="profile-logged-out"><div class="profile-logged-icon" aria-hidden="true">AV</div><div><p class="profile-eyebrow">YOUR SPACE IN THE COMMUNITY</p><h3>Your field story starts here.</h3><p>Log in to see your profile, connect with other farmers, and keep all your field notes together.</p><a class="button dark" href="../pages/login.html">Log in to AgriVerse <span aria-hidden="true">&rarr;</span></a></div></div>';
      return;
    }
    fetch('/api/agriverse/profile/' + encodeURIComponent(state.farmer.id)).then(function (response) { return response.json(); }).then(function (data) {
      var posts = data.posts || [];
      var farmer = data.farmer || state.farmer;
      var name = farmer.name || 'Farmer';
      var username = farmer.username || 'farmer';
      var initial = String(name).trim().charAt(0).toUpperCase() || 'F';
      var photoUrl = String(farmer.photo_url || '').trim();
      var avatar = photoUrl && (/^https?:\/\//i.test(photoUrl) || photoUrl.indexOf('/uploads/') === 0)
        ? '<img src="' + esc(photoUrl) + '" alt="">'
        : esc(initial);
      var intro = String(farmer.bio || '').trim() || 'Sharing practical ideas and lessons from the field with the AgriVerse community.';
      profilePosts = posts;
      profileCard.innerHTML = '<div class="profile-cover"><div class="profile-cover-orbit"></div><span class="profile-cover-label"><span class="profile-cover-dot"></span> AGRIVERSE COMMUNITY</span><span class="profile-cover-mark" aria-hidden="true">GROW<br>TOGETHER</span></div>' +
        '<div class="profile-body"><div class="profile-identity"><div class="profile-avatar-wrap"><div class="profile-avatar" aria-hidden="true">' + avatar + '</div><button type="button" class="profile-photo-edit" data-action="change-photo" aria-label="' + (photoUrl ? 'Change profile photo' : 'Add profile photo') + '" title="' + (photoUrl ? 'Change profile photo' : 'Add profile photo') + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7.5h3l1.5-2h7l1.5 2h3A1.5 1.5 0 0 1 21.5 9v9A1.5 1.5 0 0 1 20 19.5H4A1.5 1.5 0 0 1 2.5 18V9A1.5 1.5 0 0 1 4 7.5Z"/><circle cx="12" cy="13" r="3.5"/></svg></button><input id="profile-photo-input" class="profile-photo-input" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Choose profile photo"></div><div class="profile-name-block"><p class="profile-eyebrow">FARMER PROFILE</p><h3>' + esc(name) + '</h3><p class="profile-handle">@' + esc(username) + '<span class="profile-member-tag">AgriVerse member</span></p></div><div class="profile-header-actions"><a class="button profile-share-button" href="#create"><span aria-hidden="true">&#43;</span> Share a field note</a><button class="button dark" data-action="manage">Manage content <span aria-hidden="true">&nearr;</span></button></div></div><p id="profile-photo-status" class="profile-photo-status" role="status" aria-live="polite"></p>' +
        '<p class="profile-intro">' + esc(intro) + '</p>' +
        '<div class="profile-stats" aria-label="Profile activity"><div class="profile-stat"><span class="profile-stat-icon" aria-hidden="true">&#10022;</span><span><strong>' + posts.length + '</strong><small>Contributions</small></span></div><button class="profile-stat" data-action="relationship-view" data-view="followers"><span class="profile-stat-icon" aria-hidden="true">&#9678;</span><span><strong>' + (Number(data.followers) || 0) + '</strong><small>Followers</small></span></button><button class="profile-stat" data-action="relationship-view" data-view="following"><span class="profile-stat-icon" aria-hidden="true">&nearr;</span><span><strong>' + (Number(data.following) || 0) + '</strong><small>Following</small></span></button><button class="profile-stat profile-stat-requests" data-action="relationship-view" data-view="requests"><span class="profile-stat-icon" aria-hidden="true">&#9825;</span><span><strong>' + (Number(data.follow_requests) || 0) + '</strong><small>Requests</small></span></button></div>' +
        '<section id="relationship-panel" class="relationship-panel" hidden aria-label="Your AgriVerse connections"><div class="relationship-panel-heading"><div><p class="profile-eyebrow">YOUR COMMUNITY</p><h4>Connections</h4></div><button type="button" class="relationship-close" data-action="relationship-close" aria-label="Close connections">&times;</button></div><div class="relationship-tabs"><button type="button" data-action="relationship-tab" data-view="followers">Followers <span>' + (Number(data.followers) || 0) + '</span></button><button type="button" data-action="relationship-tab" data-view="following">Following <span>' + (Number(data.following) || 0) + '</span></button><button type="button" data-action="relationship-tab" data-view="requests">Requests <span class="relationship-request-count">' + (Number(data.follow_requests) || 0) + '</span></button></div><div id="relationship-list" class="relationship-list"><p class="relationship-loading">Loading your connections...</p></div></section>' +
        '<div class="profile-journal-heading"><div><p class="profile-eyebrow">MADE IN THE FIELD</p><h4>My field journal</h4></div><span>' + posts.length + ' ' + (posts.length === 1 ? 'entry' : 'entries') + '</span></div>' +
        '<div class="profile-posts">' + (posts.length ? posts.map(function (post) { return '<article class="profile-content content-card">' + ownerMenu(post) + '<div class="profile-content-media">' + (post.media_url ? '<video src="' + esc(post.media_url) + '" controls muted playsinline preload="metadata"></video>' : '<div class="profile-note-art"><span class="profile-note-sun"></span><span class="profile-note-lines"></span><span class="profile-note-label">FIELD NOTE</span></div>') + '<span class="profile-kind">' + esc(post.kind || 'post') + '</span></div><div class="profile-content-copy"><strong>' + esc(post.title || post.caption || 'Field note') + '</strong><span>' + esc(post.kind === 'reel' ? 'A quick lesson from the field' : post.kind === 'video' ? 'A farmer masterclass' : 'Shared with the community') + '</span></div></article>'; }).join('') : '<div class="profile-empty-journal"><span class="profile-empty-icon" aria-hidden="true">&#10022;</span><div><strong>Your journal is ready for its first entry.</strong><p>Share a small win, a new method, or something you learned this season.</p></div><a class="button profile-share-button" href="#create">Create your first post <span aria-hidden="true">&rarr;</span></a></div>') + '</div></div>';
      resolveVideoSources(profileCard);
      renderManageContent();
    });
  }

  function renderRelationships() {
    var list = profileCard.querySelector('#relationship-list');
    if (!list) return;
    var items = relationshipData[relationshipView] || [];
    profileCard.querySelectorAll('[data-action="relationship-tab"]').forEach(function (tab) {
      tab.classList.toggle('active', tab.dataset.view === relationshipView);
      tab.setAttribute('aria-pressed', tab.dataset.view === relationshipView ? 'true' : 'false');
    });
    if (!items.length) {
      var emptyText = relationshipView === 'requests' ? 'You have no new follow requests.' : relationshipView === 'followers' ? 'No followers yet. Your community is just getting started.' : 'You are not following anyone yet.';
      list.innerHTML = '<div class="relationship-empty"><span aria-hidden="true">&#10022;</span><p>' + emptyText + '</p></div>';
      return;
    }
    list.innerHTML = items.map(function (person) {
      var initial = String(person.name || 'F').trim().charAt(0).toUpperCase() || 'F';
      var personInfo = '<span class="relationship-avatar" aria-hidden="true">' + esc(initial) + '</span><span class="relationship-person-copy"><strong>' + esc(person.name || 'Farmer') + '</strong><small>@' + esc(person.username || 'farmer') + '</small></span>';
      if (relationshipView === 'requests') return '<article class="relationship-person">' + personInfo + '<span class="relationship-person-actions"><button type="button" class="relationship-accept" data-action="follow-request" data-id="' + esc(person.id) + '" data-decision="accept">Accept</button><button type="button" class="relationship-decline" data-action="follow-request" data-id="' + esc(person.id) + '" data-decision="decline">Decline</button></span></article>';
      return '<article class="relationship-person">' + personInfo + '<span class="relationship-person-status">' + (relationshipView === 'followers' ? 'Follows you' : 'You follow') + '</span></article>';
    }).join('');
  }

  function updateRelationshipCounts() {
    var counts = { followers: relationshipData.followers.length, following: relationshipData.following.length, requests: relationshipData.requests.length };
    Object.keys(counts).forEach(function (key) {
      var stat = profileCard.querySelector('.profile-stats [data-view="' + key + '"] strong');
      if (stat) stat.textContent = counts[key];
    });
    profileCard.querySelectorAll('.relationship-tabs [data-view]').forEach(function (tab) {
      var badge = tab.querySelector('span');
      if (badge) badge.textContent = counts[tab.dataset.view];
    });
  }

  function openRelationships(view) {
    relationshipView = view || 'followers';
    var panel = profileCard.querySelector('#relationship-panel');
    if (!panel) return;
    panel.hidden = false;
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    profileCard.querySelector('#relationship-list').innerHTML = '<p class="relationship-loading">Loading your connections...</p>';
    fetch('/api/agriverse/relationships').then(function (response) { return response.json(); }).then(function (data) {
      relationshipData = data;
      updateRelationshipCounts();
      renderRelationships();
    }).catch(function () {
      var list = profileCard.querySelector('#relationship-list');
      if (list) list.innerHTML = '<p class="relationship-loading">Could not load connections. Please try again.</p>';
    });
  }
  function renderManageContent() {
    if (!manageContentCard) return;
    var mediaPosts = profilePosts.filter(function (post) { return post.kind === 'reel' || post.kind === 'video'; });
    var reels = mediaPosts.filter(function (post) { return post.kind === 'reel'; });
    var videos = mediaPosts.filter(function (post) { return post.kind === 'video'; });
    var visiblePosts = manageFilter === 'all' ? mediaPosts : mediaPosts.filter(function (post) { return post.kind === manageFilter; });
    var postRows = visiblePosts.map(function (post) {
      var title = post.title || post.caption || (post.kind === 'reel' ? 'Untitled reel' : 'Untitled video');
      var description = post.description || post.caption || 'No description added';
      var kindLabel = post.kind === 'reel' ? 'Short reel' : 'Long video';
      return '<label class="manage-item"><input type="checkbox" data-action="bulk-select" data-id="' + post.id + '"><span class="manage-kind-icon ' + (post.kind === 'reel' ? 'is-reel' : 'is-video') + '" aria-hidden="true">&#9654;</span><span class="manage-item-copy"><strong>' + esc(title) + '</strong><small>' + esc(description) + '</small></span><span class="manage-item-type">' + kindLabel + '</span></label>';
    }).join('');
    manageContentCard.innerHTML = '<div class="manage-shell"><header class="manage-hero"><div><p class="manage-overline">YOUR CREATOR STUDIO</p><h3>Your content library</h3><p>Review your videos and reels. Select an item to remove it from AgriVerse.</p></div><div class="manage-total"><span class="manage-total-icon" aria-hidden="true">&#9654;</span><strong>' + mediaPosts.length + '</strong><small>published<br>uploads</small></div></header>' +
      '<div class="manage-summary"><div class="manage-summary-card"><span class="manage-summary-icon is-reel" aria-hidden="true">&#9654;</span><span><strong>' + reels.length + '</strong><small>Reels</small></span></div><div class="manage-summary-card"><span class="manage-summary-icon is-video" aria-hidden="true">&#9654;</span><span><strong>' + videos.length + '</strong><small>Long videos</small></span></div><div class="manage-summary-note"><span aria-hidden="true">&#9432;</span> Deleting a video also removes its likes and comments.</div></div>' +
      '<div class="manage-toolbar"><div class="manage-filter-tabs" role="group" aria-label="Filter uploads"><button type="button" data-action="manage-filter" data-filter="all" class="' + (manageFilter === 'all' ? 'active' : '') + '">All <span>' + mediaPosts.length + '</span></button><button type="button" data-action="manage-filter" data-filter="reel" class="' + (manageFilter === 'reel' ? 'active' : '') + '">Reels <span>' + reels.length + '</span></button><button type="button" data-action="manage-filter" data-filter="video" class="' + (manageFilter === 'video' ? 'active' : '') + '">Videos <span>' + videos.length + '</span></button></div><label class="manage-select-all"><input id="manage-select-all" type="checkbox" data-action="manage-select-all"><span>Select visible</span></label></div>' +
      '<div class="manage-list">' + (postRows || '<div class="manage-empty"><span aria-hidden="true">&#10022;</span><strong>' + (mediaPosts.length ? 'Nothing in this filter' : 'Your video library is empty') + '</strong><p>' + (mediaPosts.length ? 'Choose another filter to see your uploads.' : 'Reels and long videos that you publish will show up here.') + '</p></div>') + '</div>' +
      '<details class="manage-more-actions"><summary>More delete options</summary><div><button type="button" data-action="bulk-delete" data-scope="reels" ' + (reels.length ? '' : 'disabled') + '>Delete all reels</button><button type="button" data-action="bulk-delete" data-scope="videos" ' + (videos.length ? '' : 'disabled') + '>Delete all long videos</button><button type="button" data-action="bulk-delete" data-scope="all" ' + (mediaPosts.length ? '' : 'disabled') + '>Delete all uploads</button></div></details>' +
      '<div class="manage-selection-bar"><div><strong id="manage-selected-count">0 selected</strong><small>Select one or more uploads to delete them.</small></div><button type="button" class="manage-delete-selected" data-action="bulk-delete" data-scope="selected" disabled><span aria-hidden="true">&#128465;</span> Delete selected</button></div></div>';
  }

  function updateManageSelection() {
    if (!manageContentCard) return;
    var boxes = Array.prototype.slice.call(manageContentCard.querySelectorAll('[data-action="bulk-select"]'));
    var checked = boxes.filter(function (box) { return box.checked; });
    var count = manageContentCard.querySelector('#manage-selected-count');
    var deleteButton = manageContentCard.querySelector('[data-scope="selected"]');
    var selectAll = manageContentCard.querySelector('#manage-select-all');
    if (count) count.textContent = checked.length + ' selected';
    if (deleteButton) deleteButton.disabled = checked.length === 0;
    if (selectAll) {
      selectAll.checked = boxes.length > 0 && checked.length === boxes.length;
      selectAll.indeterminate = checked.length > 0 && checked.length < boxes.length;
    }
  }
  function uploadProfilePhoto(file, input) {
    var status = profileCard.querySelector('#profile-photo-status');
    var button = profileCard.querySelector('.profile-photo-edit');
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      if (status) status.textContent = 'Choose an image under 5 MB.';
      input.value = '';
      return;
    }
    var extension = String(file.name || '').split('.').pop().toLowerCase();
    if (['jpg', 'jpeg', 'png', 'webp'].indexOf(extension) === -1) {
      if (status) status.textContent = 'Choose a JPG, PNG, or WebP image.';
      input.value = '';
      return;
    }
    if (status) status.textContent = 'Uploading your profile photo...';
    if (button) button.disabled = true;
    var form = new FormData();
    form.append('photo', file);
    fetch('/api/auth/profile-photo', { method: 'POST', body: form })
      .then(function (response) { return response.json().then(function (data) { if (!response.ok) { var error = new Error(data.error || 'upload_failed'); error.status = response.status; throw error; } return data; }); })
      .then(function (data) {
        if (!data.farmer || !data.farmer.photo_url) throw new Error('photo_not_saved');
        state.farmer = data.farmer;
        renderProfile();
      })
      .catch(function (error) {
        if (status) status.textContent = error.status === 401 ? 'Please log in again, then add your profile photo.' : error.message === 'invalid_photo_type_or_size' ? 'Use a JPG, PNG, or WebP image under 5 MB.' : error.message === 'photo_not_saved' ? 'The server did not save this photo. Please try again.' : 'Photo upload failed. Check your connection and try again.';
        if (button) button.disabled = false;
      })
      .finally(function () { input.value = ''; });
  }

  function handleRoute() {
    var hash = window.location.hash || '#home';
    document.body.classList.toggle('reels-open', hash === '#reels');
    document.querySelectorAll('main > section').forEach(function(sec) { sec.style.display = 'none'; });
    
    // Simple routing logic
    if (hash === '#home') {
      document.getElementById('home').style.display = 'grid';
      document.getElementById('social_feed').style.display = 'block';
      document.getElementById('reels').style.display = 'block';
    } else {
      var target = document.getElementById(hash.substring(1));
      if (target) target.style.display = 'block';
    }

    // Update active nav link
    document.querySelectorAll('nav a').forEach(function(link) {
      if(link.getAttribute('href') === hash) link.classList.add('active');
      else link.classList.remove('active');
    });

    if (hash === '#messages') loadMessages();
    if (hash === '#notifications') loadNotifications();
    if (hash === '#profile') renderProfile();
    if (hash === '#manage-content') { renderProfile(); document.getElementById('manage-content').style.display = 'block'; }
  }

  function showModal(title, message, confirmLabel, onConfirm) {
    var modal = document.createElement('div');
    modal.className = 'content-modal';
    modal.innerHTML = '<div class="content-modal-panel" role="dialog" aria-modal="true"><h2>' + esc(title) + '</h2><p>' + esc(message) + '</p><div class="modal-actions"><button class="button" data-modal-action="cancel">Cancel</button><button class="button dark" data-modal-action="confirm">' + esc(confirmLabel) + '</button></div></div>';
    document.body.appendChild(modal);
    modal.addEventListener('click', function (event) {
      if (event.target === modal || event.target.dataset.modalAction === 'cancel') { modal.remove(); return; }
      if (event.target.dataset.modalAction === 'confirm') { modal.remove(); onConfirm(); }
    });
  }

  function requestDelete(postId) {
    var post = profilePosts.find(function (item) { return String(item.id) === String(postId); });
    if (!post) {
      return fetch('/api/agriverse/feed').then(function (response) { return response.json(); }).then(function (data) { return data.posts.find(function (item) { return String(item.id) === String(postId); }); });
    }
    return Promise.resolve(post);
  }

  function deleteOne(postId) {
    requestDelete(postId).then(function (post) {
      if (!post || !isOwner(post)) throw new Error('Only the content owner can delete this item.');
      showModal('Delete this content?', 'This action cannot be undone. Your reel/video, likes, comments and related data will be removed.', 'Delete permanently', function () {
        fetch('/api/agriverse/posts/' + encodeURIComponent(postId), { method: 'DELETE' }).then(function (response) { return response.json().then(function (data) { if (!response.ok) throw new Error(data.error || 'delete_failed'); return data; }); }).then(function () { load(); }).catch(function (error) { window.alert('Could not delete content: ' + error.message); });
      });
    }).catch(function (error) { window.alert(error.message); });
  }

  function bulkDelete(scope) {
    var ids = Array.prototype.slice.call(document.querySelectorAll('[data-action="bulk-select"]:checked')).map(function (input) { return Number(input.dataset.id); });
    if (scope === 'selected' && !ids.length) { window.alert('Select at least one reel or video.'); return; }
    var candidates = scope === 'selected' ? profilePosts.filter(function (post) { return ids.includes(post.id); }) : profilePosts.filter(function (post) { return post.kind === 'reel' || post.kind === 'video'; });
    if (scope === 'reels') candidates = candidates.filter(function (post) { return post.kind === 'reel'; });
    if (scope === 'videos') candidates = candidates.filter(function (post) { return post.kind === 'video'; });
    if (!candidates.length) { window.alert('There is no content to delete.'); return; }
    var message = scope === 'all' ? 'Are you sure you want to permanently delete all your uploaded reels and videos? This action cannot be undone.' : 'Delete ' + candidates.length + ' selected item' + (candidates.length === 1 ? '' : 's') + '? This action cannot be undone.';
    showModal('Delete ' + candidates.length + ' item' + (candidates.length === 1 ? '' : 's') + '?', message, 'Yes, delete everything', function () {
      fetch('/api/agriverse/content/bulk-delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: ids, scope: scope }) }).then(function (response) { return response.json().then(function (data) { if (!response.ok) throw new Error((data.error || 'bulk_delete_failed') + (data.failed_files ? ': ' + data.failed_files.map(function (file) { return file.path; }).join(', ') : '')); return data; }); }).then(function (data) { window.alert(data.counts.reels + ' reels and ' + data.counts.videos + ' videos deleted successfully.'); load(); }).catch(function (error) { window.alert('Nothing was deleted successfully: ' + error.message); });
    });
  }

  function loadMessages() {
    if (!state.farmer) return;
    fetch('/api/agriverse/conversations').then(res => res.json()).then(data => {
      var list = document.getElementById('conv-list');
      list.innerHTML = data.conversations.length ? data.conversations.map(c => '<div class="conv-item" data-id="'+c.id+'"><strong>'+esc(c.other_user.name)+'</strong><p>'+esc(c.last_message)+'</p></div>').join('') : '<p class="empty">No conversations yet.</p>';
    });
  }

  function loadNotifications() {
    if (!state.farmer) return;
    fetch('/api/agriverse/notifications').then(res => res.json()).then(data => {
      document.getElementById('notif-list').innerHTML = data.notifications.length ? data.notifications.map(n => '<div class="notif"><strong>Alert</strong>: '+esc(n.message)+'</div>').join('') : '<p class="empty">No notifications yet.</p>';
    });
  }

  function setupAutoplay() {
    var observer = new IntersectionObserver(function (entries) { entries.forEach(function (entry) { var video = entry.target; if (entry.isIntersecting) { if (video.dataset.soundEnabled !== 'true') setVideoMuted(video, true); video.playsInline = true; var playback = video.play(); if (playback && playback.catch) playback.catch(function () {}); } else { video.pause(); video.dataset.soundEnabled = 'false'; setVideoMuted(video, true); } }); }, { threshold: .55 });
    document.querySelectorAll('.reel-card video').forEach(function (video) { observer.observe(video); });
  }

  function setVideoMuted(video, muted) {
    video.muted = muted;
    var button = video.closest('.reel-card')?.querySelector('.reel-audio-toggle');
    if (!button) return;
    button.classList.toggle('active', !muted);
    button.setAttribute('aria-label', muted ? 'Turn sound on' : 'Turn sound off');
    button.title = muted ? 'Turn sound on' : 'Turn sound off';
    button.textContent = muted ? 'Unmute' : 'Mute';
    button.innerHTML = '<span class="icon" aria-hidden="true">' + (muted ? '🔇' : '🔊') + '</span>';
  }

  function setReelSound(video, enabled) {
    reelsSoundEnabled = enabled;
    localStorage.setItem('agriverse-reels-sound-enabled', String(enabled));
    document.querySelectorAll('.reels-strip .reel-card video').forEach(function (item) { item.dataset.soundEnabled = 'false'; setVideoMuted(item, true); });
    video.dataset.soundEnabled = String(enabled);
    setVideoMuted(video, !enabled);
    if (enabled) {
      var playback = video.play();
      if (playback && playback.catch) playback.catch(function () { setVideoMuted(video, true); });
    }
  }
  window.addEventListener('hashchange', handleRoute);
  document.getElementById('close-reels').addEventListener('click', function () { window.location.hash = 'home'; });
  document.addEventListener('keydown', function (event) { if (event.key === 'Escape' && document.body.classList.contains('reels-open')) window.location.hash = 'home'; });

  document.querySelectorAll('.tab').forEach(function (button) { button.addEventListener('click', function () { document.querySelectorAll('.tab').forEach(function (item) { item.classList.remove('active'); }); button.classList.add('active'); state.filter = button.dataset.filter; load(); }); });
  document.querySelectorAll('.mode').forEach(function (button) { button.addEventListener('click', function () { document.querySelectorAll('.mode').forEach(function (item) { item.classList.remove('active'); }); button.classList.add('active'); document.getElementById('post-kind').value = button.dataset.kind; document.getElementById('video-fields').hidden = button.dataset.kind === 'post'; }); });
  
  document.addEventListener('click', function (event) {
    var button = event.target.closest('[data-action]');
    if (!button) return;
    var action = button.dataset.action;

    if (action === 'toggle-audio') {
      var reelVideo = button.closest('.reel-card')?.querySelector('video');
      if (!reelVideo) return;
      setReelSound(reelVideo, reelVideo.muted);
      return;
    }
    // Selection checkboxes are handled by the browser. Let their checked state
    // stay in place until the user confirms a bulk delete.
    if (action === 'bulk-select') return;

    if (action === 'relationship-view') { openRelationships(button.dataset.view); return; }
    if (action === 'change-photo') { var photoPicker = profileCard.querySelector('#profile-photo-input'); if (photoPicker) photoPicker.click(); return; }
    if (action === 'relationship-tab') { relationshipView = button.dataset.view; renderRelationships(); return; }
    if (action === 'manage-filter') { manageFilter = button.dataset.filter; renderManageContent(); return; }
    if (action === 'relationship-close') { profileCard.querySelector('#relationship-panel').hidden = true; return; }
    if (action === 'follow-request') {
      button.disabled = true;
      fetch('/api/agriverse/follow-requests/' + encodeURIComponent(button.dataset.id) + '/' + button.dataset.decision, { method: 'POST' })
        .then(function (response) { return response.json().then(function (data) { if (!response.ok) throw new Error(data.error || 'Could not update request.'); return data; }); })
        .then(function () {
          var person = relationshipData.requests.find(function (item) { return String(item.id) === String(button.dataset.id); });
          relationshipData.requests = relationshipData.requests.filter(function (item) { return String(item.id) !== String(button.dataset.id); });
          if (button.dataset.decision === 'accept' && person && !relationshipData.followers.some(function (item) { return String(item.id) === String(person.id); })) relationshipData.followers.push(person);
          updateRelationshipCounts();
          renderRelationships();
        })
        .catch(function () { button.disabled = false; button.textContent = 'Try again'; });
      return;
    }

    if (action === 'menu') { var menu = document.querySelector('[data-menu="' + button.dataset.id + '"]'); if (menu) menu.classList.toggle('open'); return; }
    if (action === 'menu-close') { var openMenu = document.querySelector('[data-menu="' + button.dataset.id + '"]'); if (openMenu) openMenu.classList.remove('open'); return; }
    if (action === 'delete-request') { deleteOne(button.dataset.id); return; }
    if (action === 'edit') { window.alert('Edit is ready for this content in the composer.'); return; }
    if (action === 'manage') { window.location.hash = 'manage-content'; return; }
    if (action === 'bulk-delete') { bulkDelete(button.dataset.scope); return; }
    if (action === 'watch') { window.location.hash = 'watch'; var watch = document.getElementById('watch-container'); var source = state.posts.find(function (post) { return String(post.id) === String(button.dataset.id); }); if (source) watch.innerHTML = '<div class="watch-content">' + ownerMenu(source) + '<video src="' + esc(source.media_url) + '" controls autoplay></video><h2>' + esc(source.title || source.caption || 'AgriVerse video') + '</h2><p>' + esc(source.description || source.caption) + '</p></div>'; return; }
    
    if (action === 'comment') { var body = window.prompt('Add a farming tip or question:'); if (!body) return; fetch('/api/agriverse/posts/' + button.dataset.id + '/comments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: body }) }).then(load); return; }
    if (action === 'share') { navigator.clipboard.writeText(window.location.href + '#post-' + button.dataset.id).then(function () { button.textContent = 'Copied'; }); return; }
    if (['like', 'save', 'follow'].indexOf(action) === -1) return;
    fetch('/api/agriverse/posts/' + button.dataset.id + '/' + action, { method: 'POST' }).then(function (response) { if (response.status === 401) { window.location.href = '../pages/login.html'; return; } return response.json().then(function (data) { if (!response.ok) throw new Error(data.error || 'Request failed.'); return data; }); }).then(load).catch(function (error) { window.alert('Could not update this item: ' + error.message); });
  });

  manageContentCard.addEventListener('change', function (event) {
    if (event.target.matches('[data-action="manage-select-all"]')) {
      manageContentCard.querySelectorAll('[data-action="bulk-select"]').forEach(function (box) { box.checked = event.target.checked; });
    }
    if (event.target.matches('[data-action="bulk-select"], [data-action="manage-select-all"]')) updateManageSelection();
  });

  profileCard.addEventListener('change', function (event) {
    if (event.target.matches('#profile-photo-input')) uploadProfilePhoto(event.target.files[0], event.target);
  });
  
  document.getElementById('create-form').addEventListener('submit', function (event) {
    event.preventDefault();
    if (!state.farmer) { window.location.href = '../pages/login.html'; return; }
    var kind = document.getElementById('post-kind').value;
    var message = document.getElementById('form-message');
    var file = document.getElementById('video').files[0];
    var request;
    if (kind === 'post') { request = fetch('/api/agriverse/posts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: kind, caption: document.getElementById('caption').value }) }); }
    else {
      if (!file) { message.textContent = 'Choose a video before publishing.'; return; }
      if (file.size > 100 * 1024 * 1024) { message.textContent = 'Choose a video smaller than 100 MB.'; return; }
      var uploadId = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : String(Date.now()) + '_' + Math.random().toString(36).slice(2);
      var chunkSize = 3 * 1024 * 1024;
      var totalParts = Math.ceil(file.size / chunkSize);
      var fields = ['caption', 'title', 'description', 'crop', 'category', 'language', 'tags'];
      request = (async function () {
        for (var partIndex = 0; partIndex < totalParts; partIndex++) {
          var partForm = new FormData();
          partForm.append('kind', kind);
          partForm.append('upload_action', 'chunk');
          partForm.append('upload_id', uploadId);
          partForm.append('part_index', String(partIndex));
          partForm.append('total_parts', String(totalParts));
          partForm.append('video', file.slice(partIndex * chunkSize, Math.min(file.size, (partIndex + 1) * chunkSize)), file.name + '.part');
          var partResponse = await fetch('/api/agriverse/upload', { method: 'POST', body: partForm });
          var partData = await partResponse.json().catch(function () { return {}; });
          if (!partResponse.ok) throw new Error(partData.error || 'Video upload failed.');
          message.textContent = 'Uploading video: ' + Math.round(((partIndex + 1) / totalParts) * 100) + '%';
        }
        var finishForm = new FormData();
        finishForm.append('kind', kind);
        finishForm.append('upload_action', 'finalize');
        finishForm.append('upload_id', uploadId);
        finishForm.append('total_parts', String(totalParts));
        finishForm.append('file_name', file.name);
        finishForm.append('content_type', file.type || 'video/mp4');
        fields.forEach(function (id) { finishForm.append(id, document.getElementById(id).value); });
        return fetch('/api/agriverse/upload', { method: 'POST', body: finishForm });
      }());
    }
    message.textContent = 'Saving your work...'; request.then(function (response) { return response.json().then(function (data) { if (!response.ok) throw new Error(data.error); return data; }); }).then(function () { message.textContent = 'Published successfully.'; document.getElementById('create-form').reset(); load(); }).catch(function (error) { message.textContent = 'Could not publish: ' + error.message; });
  });
  
  document.getElementById('login-link').addEventListener('click', function () { window.location.href = state.farmer ? '#profile' : '../pages/login.html'; });
  
  load();
  handleRoute();
}());
