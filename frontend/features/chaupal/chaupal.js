/* Kisan Chaupal — feed, composer, likes, comments, replies, reports, follows */
(function () {
  'use strict';
  var SF = window.SF;
  var feed = document.getElementById('chaupal-feed');
  var feedStatus = document.getElementById('feed-status');

  function setStatus(html, cls) {
    if (!html) { feedStatus.classList.add('sf-hidden'); return; }
    feedStatus.className = cls || 'sf-loading';
    feedStatus.innerHTML = html;
  }

  function initials(name) {
    return SF.esc((name || 'F').trim().charAt(0).toUpperCase());
  }

  function postCard(post) {
    var isOwner = SF.farmer && post.creatorId === SF.farmer.id;
    var image = post.media_kind === 'image' && post.media_url
      ? '<img class="chaupal-post-img" src="' + SF.esc(post.media_url) + '" alt="Field photo shared by ' + SF.esc(post.author && post.author.name) + '">'
      : '';
    var menu = isOwner
      ? '<div class="chaupal-post-menu"><button type="button" data-menu-toggle aria-label="Post options">⋯</button>' +
        '<div class="chaupal-menu-options">' +
        '<button data-action="delete" data-id="' + post.id + '">Delete my post</button>' +
        '</div></div>'
      : '<div class="chaupal-post-menu"><button type="button" data-menu-toggle aria-label="Post options">⋯</button>' +
        '<div class="chaupal-menu-options">' +
        '<button data-action="report" data-id="' + post.id + '">Report post</button>' +
        '</div></div>';
    return '<article class="chaupal-post" id="post-' + post.id + '" data-id="' + post.id + '">' +
      '<div class="chaupal-post-head">' +
        '<div class="chaupal-avatar">' + initials(post.author && post.author.name) + '</div>' +
        '<div class="chaupal-post-meta"><strong>' + SF.esc(post.author && post.author.name) + '</strong>' +
          '<span>@' + SF.esc(post.author && post.author.username) + ' · ' + SF.esc(post.created_at) + '</span></div>' +
        menu +
      '</div>' +
      (post.category ? '<span class="chaupal-post-category">' + SF.esc(post.category) + '</span>' : '') +
      image +
      '<p class="chaupal-post-body">' + SF.esc(post.caption) + '</p>' +
      '<div class="chaupal-actions">' +
        '<button data-action="like" data-id="' + post.id + '" class="' + (post.liked ? 'active' : '') + '">♥ ' + post.likes + '</button>' +
        '<button data-action="comment" data-id="' + post.id + '">💬 ' + post.comments + '</button>' +
        '<button data-action="save" data-id="' + post.id + '" class="' + (post.saved ? 'active' : '') + '">💾 Save</button>' +
        (!isOwner ? '<button data-action="follow" data-id="' + post.id + '" data-farmer="' + SF.esc(post.creatorId) + '" class="' + (post.following ? 'active' : '') + '">' + (post.following ? 'Following' : '＋ Follow') + '</button>' : '') +
      '</div>' +
      '<div class="chaupal-comments sf-hidden" data-comments="' + post.id + '"></div>' +
    '</article>';
  }

  function loadFeed() {
    var params = new URLSearchParams();
    var q = document.getElementById('chaupal-q').value.trim();
    var category = document.getElementById('chaupal-category').value;
    if (q) params.set('q', q);
    if (category) params.set('category', category);
    setStatus('Loading the community feed…', 'sf-loading');
    SF.get(SF.API + '/chaupal/feed?' + params.toString()).then(function (res) {
      if (!res.ok) { setStatus('Could not load the feed.', 'sf-error'); return; }
      var posts = res.data.posts || [];
      if (!posts.length) {
        feed.innerHTML = '';
        setStatus('No posts yet. Be the first farmer to start a discussion.', 'sf-empty');
        return;
      }
      setStatus('');
      feed.innerHTML = posts.map(postCard).join('');
    });
  }

  function toggleLike(id) {
    if (!SF.isLoggedIn()) { SF.toast('Please log in to like a post.', 'error'); return; }
    SF.postJson(SF.API + '/chaupal/posts/' + id + '/like', {}).then(function (res) {
      if (res.ok) loadFeed(); else SF.toast(SF.errorMessage(res.data), 'error');
    });
  }

  function toggleSave(id) {
    if (!SF.isLoggedIn()) { SF.toast('Please log in to save a post.', 'error'); return; }
    SF.postJson(SF.API + '/chaupal/posts/' + id + '/save', {}).then(function (res) {
      if (res.ok) loadFeed(); else SF.toast(SF.errorMessage(res.data), 'error');
    });
  }

  function toggleFollow(farmerId) {
    if (!SF.isLoggedIn()) { SF.toast('Please log in to follow a farmer.', 'error'); return; }
    SF.postJson(SF.API + '/chaupal/farmers/' + encodeURIComponent(farmerId) + '/follow', {}).then(function (res) {
      if (res.ok) { SF.toast(res.data.following ? 'Now following.' : 'Unfollowed.', 'success'); loadFeed(); }
      else SF.toast(SF.errorMessage(res.data), 'error');
    });
  }

  function deletePost(id) {
    SF.confirm('Delete this post?', 'This cannot be undone. Likes and comments on it will also be removed.', 'Delete').then(function (ok) {
      if (!ok) return;
      SF.del(SF.API + '/chaupal/posts/' + id).then(function (res) {
        if (res.ok) { SF.toast('Post deleted.', 'success'); loadFeed(); }
        else SF.toast(SF.errorMessage(res.data), 'error');
      });
    });
  }

  function reportPost(id) {
    if (!SF.isLoggedIn()) { SF.toast('Please log in to report a post.', 'error'); return; }
    var reason = window.prompt('Why are you reporting this post?\nspam / abuse / misinformation / irrelevant / other', 'spam');
    if (!reason) return;
    SF.postJson(SF.API + '/chaupal/posts/' + id + '/report', { reason: reason.trim() }).then(function (res) {
      if (res.ok) SF.toast('Thank you. The post has been reported for review.', 'success');
      else SF.toast(SF.errorMessage(res.data), 'error');
    });
  }

  function openComments(id) {
    var box = document.querySelector('[data-comments="' + id + '"]');
    if (!box) return;
    if (!box.classList.contains('sf-hidden')) { box.classList.add('sf-hidden'); return; }
    box.classList.remove('sf-hidden');
    box.innerHTML = '<div class="sf-loading">Loading comments…</div>';
    SF.get(SF.API + '/chaupal/posts/' + id + '/comments').then(function (res) {
      var comments = res.data.comments || [];
      box.innerHTML = comments.map(commentHtml).join('') + commentForm(id);
    });
  }

  function commentHtml(c) {
    var replies = (c.replies || []).map(function (r) {
      return '<div class="chaupal-comment"><span class="chaupal-comment-author">' + SF.esc(r.author_name) + '</span>: ' + SF.esc(r.body) + '</div>';
    }).join('');
    return '<div class="chaupal-comment" data-comment="' + c.id + '">' +
      '<span class="chaupal-comment-author">' + SF.esc(c.author_name) + '</span>: ' + SF.esc(c.body) +
      '<button class="sf-btn sf-btn-ghost sf-btn-sm" data-action="reply" data-id="' + c.id + '" style="margin-left:8px;">Reply</button>' +
      (replies ? '<div class="chaupal-replies">' + replies + '</div>' : '') +
      '</div>';
  }

  function commentForm(postId) {
    return '<div class="chaupal-comment-form">' +
      '<input class="sf-input" data-comment-input="' + postId + '" placeholder="Add a farming tip or question…">' +
      '<button class="sf-btn sf-btn-primary sf-btn-sm" data-action="comment-submit" data-id="' + postId + '">Send</button>' +
      '</div>';
  }

  function submitComment(postId) {
    if (!SF.isLoggedIn()) { SF.toast('Please log in to comment.', 'error'); return; }
    var input = document.querySelector('[data-comment-input="' + postId + '"]');
    var body = input.value.trim();
    if (!body) return;
    SF.postJson(SF.API + '/chaupal/posts/' + postId + '/comments', { body: body }).then(function (res) {
      if (res.ok) {
        input.value = '';
        SF.get(SF.API + '/chaupal/posts/' + postId + '/comments').then(function (r2) {
          var box = document.querySelector('[data-comments="' + postId + '"]');
          var comments = (r2.data.comments) || [];
          box.innerHTML = comments.map(commentHtml).join('') + commentForm(postId);
        });
      } else {
        SF.toast(SF.errorMessage(res.data), 'error');
      }
    });
  }

  function replyTo(commentId) {
    if (!SF.isLoggedIn()) { SF.toast('Please log in to reply.', 'error'); return; }
    var body = window.prompt('Your reply:');
    if (!body) return;
    SF.postJson(SF.API + '/chaupal/comments/' + commentId + '/reply', { body: body.trim() }).then(function (res) {
      if (res.ok) { SF.toast('Reply added.', 'success'); loadFeed(); }
      else SF.toast(SF.errorMessage(res.data), 'error');
    });
  }

  function publish() {
    if (!SF.isLoggedIn()) { SF.toast('Please log in to post.', 'error'); return; }
    var caption = document.getElementById('post-caption').value.trim();
    var category = document.getElementById('post-category').value;
    var file = document.getElementById('post-image').files[0];
    var msg = document.getElementById('composer-msg');
    if (!caption && !file) { msg.textContent = 'Please type a message or add a photo.'; return; }
    msg.textContent = 'Publishing…';
    var request;
    if (file) {
      var form = new FormData();
      form.append('image', file);
      form.append('caption', caption);
      form.append('category', category);
      request = SF.postForm(SF.API + '/chaupal/upload', form);
    } else {
      request = SF.postJson(SF.API + '/chaupal/posts', { caption: caption, category: category });
    }
    request.then(function (res) {
      if (!res.ok) { msg.textContent = SF.errorMessage(res.data); return; }
      msg.textContent = '';
      document.getElementById('post-caption').value = '';
      document.getElementById('post-image').value = '';
      SF.toast('Published to the community.', 'success');
      loadFeed();
    });
  }

  function loadFarmers() {
    var q = document.getElementById('farmer-search').value.trim();
    SF.get(SF.API + '/chaupal/farmers' + (q ? '?q=' + encodeURIComponent(q) : '')).then(function (res) {
      var farmers = res.data.farmers || [];
      var list = document.getElementById('farmer-list');
      if (!farmers.length) { list.innerHTML = '<p class="sf-muted">No farmers found.</p>'; return; }
      list.innerHTML = farmers.map(function (f) {
        return '<div class="chaupal-farmer">' +
          '<div class="chaupal-avatar">' + initials(f.name) + '</div>' +
          '<div class="chaupal-farmer-name"><strong>' + SF.esc(f.name) + '</strong><span>@' + SF.esc(f.username) + '</span></div>' +
          (SF.farmer && SF.farmer.id === f.id ? '' : '<button class="sf-btn sf-btn-outline sf-btn-sm" data-action="follow-farmer" data-farmer="' + SF.esc(f.id) + '">' + (f.following ? 'Following' : 'Follow') + '</button>') +
        '</div>';
      }).join('');
    });
  }

  function loadNotifications() {
    if (!SF.isLoggedIn()) { document.getElementById('notif-list').innerHTML = '<p class="sf-muted">Log in to see notifications.</p>'; return; }
    SF.get(SF.API + '/notifications').then(function (res) {
      var list = res.data.notifications || [];
      document.getElementById('notif-list').innerHTML = list.length
        ? list.map(function (n) { return '<div class="chaupal-notif' + (n.read ? '' : ' unread') + '">' + SF.esc(n.message) + '</div>'; }).join('')
        : '<p class="sf-muted">No notifications yet.</p>';
    });
  }

  // Events
  document.getElementById('post-submit').addEventListener('click', publish);
  document.getElementById('chaupal-filters').addEventListener('submit', function (e) { e.preventDefault(); loadFeed(); });
  document.getElementById('farmer-search').addEventListener('input', function () { loadFarmers(); });

  feed.addEventListener('click', function (e) {
    var toggle = e.target.closest('[data-menu-toggle]');
    if (toggle) {
      var menu = toggle.parentElement;
      document.querySelectorAll('.chaupal-post-menu.open').forEach(function (m) { if (m !== menu) m.classList.remove('open'); });
      menu.classList.toggle('open');
      return;
    }
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var id = btn.dataset.id;
    switch (btn.dataset.action) {
      case 'like': toggleLike(id); break;
      case 'save': toggleSave(id); break;
      case 'comment': openComments(id); break;
      case 'comment-submit': submitComment(id); break;
      case 'reply': replyTo(id); break;
      case 'follow': toggleFollow(btn.dataset.farmer); break;
      case 'delete': deletePost(id); break;
      case 'report': reportPost(id); break;
    }
  });

  document.getElementById('farmer-list').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-action="follow-farmer"]');
    if (btn) toggleFollow(btn.dataset.farmer);
  });

  // Boot
  SF.bootHeader().then(function (farmer) {
    if (!farmer) {
      document.getElementById('composer-auth-note').classList.remove('sf-hidden');
      document.getElementById('composer-body').classList.add('sf-hidden');
    }
    loadFeed();
    loadFarmers();
    loadNotifications();
  });
}());
