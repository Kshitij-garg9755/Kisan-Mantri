"""Flask blueprint exposing the integrated Smart Farm feature APIs.

Mounted at ``/api/features``. Authentication reuses the existing Smart Farm
session (``session['farmer_id']``), so a logged-in farmer is automatically
authenticated across every feature. Ownership checks use ``farmer_id``.
"""
from __future__ import annotations

import os
import secrets

from flask import Blueprint, jsonify, request, session
from werkzeug.utils import secure_filename

from . import services
from .models import get_db

features_blueprint = Blueprint('features_module', __name__, url_prefix='/api/features')

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
APP_DATA_DIR = os.path.abspath(os.environ.get('SMART_FARM_DATA_DIR', BASE_DIR))
UPLOAD_FOLDER = os.path.join(APP_DATA_DIR, 'agriverse_uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.webp'}
MAX_IMAGE_BYTES = 5 * 1024 * 1024
POST_KINDS = {'post', 'reel', 'video'}
REPORT_REASONS = {'spam', 'abuse', 'misinformation', 'irrelevant', 'other'}


# ----------------------------- helpers -----------------------------

def current_farmer_id():
    return session.get('farmer_id')


def require_farmer():
    farmer_id = current_farmer_id()
    if not farmer_id:
        return None, (jsonify({'error': 'authentication_required'}), 401)
    return farmer_id, None


def farmer_exists(farmer_id: str) -> bool:
    with get_db() as db:
        return db.execute('SELECT 1 FROM farmers WHERE id = ?', (farmer_id,)).fetchone() is not None


def is_admin(farmer_id: str) -> bool:
    with get_db() as db:
        row = db.execute('SELECT role FROM farmers WHERE id = ?', (farmer_id,)).fetchone()
    return bool(row and row['role'] in ('admin', 'superadmin'))


def json_body() -> dict:
    return request.get_json(silent=True) or {}


def parse_split_list(value: str):
    if not value:
        return []
    return [item.strip() for item in value.split(',') if item.strip()]


# ----------------------------- schemes -----------------------------

def scheme_payload(row, bookmarked=False):
    return {
        'id': row['id'],
        'slug': row['slug'],
        'title': row['title'],
        'title_hi': row['title_hi'],
        'summary': row['summary'],
        'description': row['description'],
        'eligibility': row['eligibility'],
        'benefits': row['benefits'],
        'required_documents': row['required_documents'],
        'application_process': row['application_process'],
        'official_url': row['official_url'],
        'department': row['department'],
        'category': row['category'],
        'states': parse_split_list(row['states']),
        'farmer_categories': parse_split_list(row['farmer_categories']),
        'source_note': row['source_note'],
        'updated_at': row['updated_at'],
        'bookmarked': bookmarked,
    }


@features_blueprint.get('/schemes')
def list_schemes():
    query = (request.args.get('q') or '').strip()
    state = (request.args.get('state') or '').strip()
    category = (request.args.get('category') or '').strip()
    farmer_category = (request.args.get('farmer_category') or '').strip()
    farmer_id = current_farmer_id()

    sql = 'SELECT * FROM schemes WHERE active = 1'
    params = []
    if query:
        like = f'%{query}%'
        sql += ' AND (title LIKE ? OR title_hi LIKE ? OR summary LIKE ? OR description LIKE ?)'
        params += [like, like, like, like]
    if category:
        sql += ' AND category = ?'
        params.append(category)
    sql += ' ORDER BY title COLLATE NOCASE'
    with get_db() as db:
        rows = db.execute(sql, params).fetchall()

    bookmarks = set()
    if farmer_id:
        bookmarks = {r['scheme_id'] for r in db.execute(
            'SELECT scheme_id FROM scheme_bookmarks WHERE farmer_id = ?', (farmer_id,))}

    def matches(row):
        states = parse_split_list(row['states']) or ['All']
        cats = parse_split_list(row['farmer_categories']) or ['All']
        if state and state not in states and 'All' not in states:
            return False
        if farmer_category and farmer_category not in cats and 'All' not in cats:
            return False
        return True

    filtered = [row for row in rows if matches(row)]
    return jsonify({
        'status': services.STATUS_LIVE,
        'count': len(filtered),
        'schemes': [scheme_payload(row, row['id'] in bookmarks) for row in filtered],
    })


@features_blueprint.get('/schemes/meta')
def scheme_meta():
    with get_db() as db:
        categories = [r['category'] for r in db.execute(
            'SELECT DISTINCT category FROM schemes WHERE active = 1 AND category <> "" ORDER BY category')]
        state_set = set()
        category_set = set()
        for row in db.execute('SELECT states, farmer_categories FROM schemes WHERE active = 1'):
            state_set.update(parse_split_list(row['states']))
            category_set.update(parse_split_list(row['farmer_categories']))
    states = ['All'] + sorted(s for s in state_set if s and s != 'All')
    farmer_categories = ['All'] + sorted(s for s in category_set if s and s != 'All')
    return jsonify({
        'categories': categories,
        'states': states,
        'farmer_categories': farmer_categories,
    })


@features_blueprint.get('/schemes/<slug>')
def scheme_detail(slug):
    farmer_id = current_farmer_id()
    with get_db() as db:
        row = db.execute('SELECT * FROM schemes WHERE slug = ? AND active = 1', (slug,)).fetchone()
        if not row:
            return jsonify({'error': 'scheme_not_found'}), 404
        bookmarked = bool(farmer_id and db.execute(
            'SELECT 1 FROM scheme_bookmarks WHERE scheme_id = ? AND farmer_id = ?',
            (row['id'], farmer_id)).fetchone())
    return jsonify({'scheme': scheme_payload(row, bookmarked)})


@features_blueprint.post('/schemes/<slug>/bookmark')
def toggle_scheme_bookmark(slug):
    farmer_id, error = require_farmer()
    if error:
        return error
    with get_db() as db:
        row = db.execute('SELECT id FROM schemes WHERE slug = ? AND active = 1', (slug,)).fetchone()
        if not row:
            return jsonify({'error': 'scheme_not_found'}), 404
        existing = db.execute(
            'SELECT 1 FROM scheme_bookmarks WHERE scheme_id = ? AND farmer_id = ?',
            (row['id'], farmer_id)).fetchone()
        if existing:
            db.execute('DELETE FROM scheme_bookmarks WHERE scheme_id = ? AND farmer_id = ?',
                       (row['id'], farmer_id))
            bookmarked = False
        else:
            db.execute('INSERT INTO scheme_bookmarks (scheme_id, farmer_id) VALUES (?, ?)',
                       (row['id'], farmer_id))
            bookmarked = True
    return jsonify({'success': True, 'bookmarked': bookmarked})


@features_blueprint.get('/schemes/bookmarks/mine')
def my_scheme_bookmarks():
    farmer_id, error = require_farmer()
    if error:
        return error
    with get_db() as db:
        rows = db.execute(
            'SELECT s.* FROM schemes s JOIN scheme_bookmarks b ON b.scheme_id = s.id '
            'WHERE b.farmer_id = ? AND s.active = 1 ORDER BY b.created_at DESC', (farmer_id,)).fetchall()
    return jsonify({'schemes': [scheme_payload(row, True) for row in rows]})


@features_blueprint.post('/admin/schemes')
def admin_upsert_scheme():
    """Create or update a scheme. Restricted to admin / superadmin roles."""
    farmer_id, error = require_farmer()
    if error:
        return error
    if not is_admin(farmer_id):
        return jsonify({'error': 'admin_required'}), 403
    data = json_body()
    slug = (data.get('slug') or '').strip().lower().replace(' ', '-')
    title = (data.get('title') or '').strip()
    if not slug or not title:
        return jsonify({'error': 'slug_and_title_required'}), 400
    fields = {
        'title': title,
        'title_hi': (data.get('title_hi') or '').strip(),
        'summary': (data.get('summary') or '').strip(),
        'description': (data.get('description') or '').strip(),
        'eligibility': (data.get('eligibility') or '').strip(),
        'benefits': (data.get('benefits') or '').strip(),
        'required_documents': (data.get('required_documents') or '').strip(),
        'application_process': (data.get('application_process') or '').strip(),
        'official_url': (data.get('official_url') or '').strip(),
        'department': (data.get('department') or '').strip(),
        'category': (data.get('category') or '').strip(),
        'states': (data.get('states') or 'All').strip(),
        'farmer_categories': (data.get('farmer_categories') or 'All').strip(),
        'source_note': (data.get('source_note') or '').strip(),
    }
    with get_db() as db:
        existing = db.execute('SELECT id FROM schemes WHERE slug = ?', (slug,)).fetchone()
        if existing:
            assignments = ', '.join(f'{column} = ?' for column in fields)
            db.execute(
                f"UPDATE schemes SET {assignments}, updated_at = CURRENT_TIMESTAMP WHERE slug = ?",
                (*fields.values(), slug))
            scheme_id = existing['id']
        else:
            columns = ', '.join(('slug', *fields.keys()))
            placeholders = ', '.join('?' for _ in range(len(fields) + 1))
            cursor = db.execute(
                f'INSERT INTO schemes ({columns}) VALUES ({placeholders})',
                (slug, *fields.values()))
            scheme_id = cursor.lastrowid
    return jsonify({'success': True, 'id': scheme_id, 'slug': slug}), 201


@features_blueprint.delete('/admin/schemes/<slug>')
def admin_deactivate_scheme(slug):
    farmer_id, error = require_farmer()
    if error:
        return error
    if not is_admin(farmer_id):
        return jsonify({'error': 'admin_required'}), 403
    with get_db() as db:
        cursor = db.execute('UPDATE schemes SET active = 0 WHERE slug = ?', (slug,))
    if not cursor.rowcount:
        return jsonify({'error': 'scheme_not_found'}), 404
    return jsonify({'success': True})


# ----------------------------- kisan bank -----------------------------

@features_blueprint.get('/bank/info')
def bank_info():
    """Static-but-maintainable finance information. No transactions, no credentials."""
    with get_db() as db:
        scheme_rows = db.execute(
            "SELECT * FROM schemes WHERE active = 1 AND category IN "
            "('Credit', 'Insurance', 'Subsidy', 'Income Support', 'Pension') "
            'ORDER BY title COLLATE NOCASE').fetchall()
    return jsonify({
        'status': services.STATUS_LIVE,
        'notice': (
            'This section provides financial information and calculators only. '
            'It does not perform any banking transaction and never asks for ATM PIN, '
            'CVV, OTP, passwords or full account credentials.'
        ),
        'schemes': [scheme_payload(row) for row in scheme_rows],
        'articles': [
            {
                'title': 'Understand your crop loan before you borrow',
                'body': 'Compare the total interest, not just the instalment. Ask the bank for the '
                        'effective annual rate after any interest subvention, and read the repayment '
                        'schedule carefully.',
            },
            {
                'title': 'Never share banking secrets',
                'body': 'No bank or government office will ever ask for your ATM PIN, CVV, OTP or '
                        'net-banking password. If someone does, treat it as fraud and report it.',
            },
            {
                'title': 'Keep documents ready for scheme applications',
                'body': 'Aadhaar, land records and bank details are commonly required. Keep clean '
                        'copies ready to avoid delays during application windows.',
            },
            {
                'title': 'Match repayment to harvest cash-flow',
                'body': 'Choose a tenure that ends shortly after your expected harvest and sale, so '
                        'you can repay promptly and benefit from any interest subvention.',
            },
        ],
    })


# ----------------------------- chaupal (community) -----------------------------

def _post_row_to_payload(db, row, viewer_id):
    author = db.execute('SELECT * FROM farmers WHERE id = ?', (row['farmer_id'],)).fetchone()
    likes = db.execute('SELECT COUNT(*) AS c FROM likes WHERE post_id = ?', (row['id'],)).fetchone()['c']
    comments = db.execute('SELECT COUNT(*) AS c FROM comments WHERE post_id = ?', (row['id'],)).fetchone()['c']
    liked = bool(viewer_id and db.execute(
        'SELECT 1 FROM likes WHERE post_id = ? AND farmer_id = ?', (row['id'], viewer_id)).fetchone())
    saved = bool(viewer_id and db.execute(
        'SELECT 1 FROM saves WHERE post_id = ? AND farmer_id = ?', (row['id'], viewer_id)).fetchone())
    following = bool(viewer_id and db.execute(
        'SELECT 1 FROM follows WHERE follower_id = ? AND followed_id = ?',
        (viewer_id, row['farmer_id'])).fetchone())
    keys = row.keys()
    return {
        'id': row['id'],
        'creatorId': row['farmer_id'],
        'kind': row['kind'],
        'media_kind': row['media_kind'] if 'media_kind' in keys else 'none',
        'category': row['category'] if 'category' in keys else 'General',
        'caption': row['caption'],
        'title': row['title'],
        'description': row['description'],
        'media_url': row['media_url'],
        'crop': row['crop'],
        'tags': row['tags'],
        'created_at': row['created_at'],
        'likes': likes,
        'comments': comments,
        'liked': liked,
        'saved': saved,
        'following': following,
        'author': {
            'id': author['id'], 'name': author['name'], 'username': author['username'],
            'bio': author['bio'], 'photo_url': author['photo_url'],
        } if author else None,
    }


@features_blueprint.get('/chaupal/feed')
def chaupal_feed():
    viewer_id = current_farmer_id()
    category = (request.args.get('category') or '').strip()
    kind = (request.args.get('kind') or '').strip()
    query = (request.args.get('q') or '').strip()
    sql = 'SELECT * FROM posts WHERE 1 = 1'
    params = []
    if category:
        sql += ' AND category = ?'
        params.append(category)
    if kind in POST_KINDS:
        sql += ' AND kind = ?'
        params.append(kind)
    if query:
        like = f'%{query}%'
        sql += ' AND (caption LIKE ? OR title LIKE ? OR description LIKE ?)'
        params += [like, like, like]
    sql += ' ORDER BY datetime(created_at) DESC, id DESC LIMIT 200'
    with get_db() as db:
        rows = db.execute(sql, params).fetchall()
        posts = [_post_row_to_payload(db, row, viewer_id) for row in rows]
    return jsonify({'posts': posts})


@features_blueprint.get('/chaupal/farmers')
def chaupal_farmers():
    query = (request.args.get('q') or '').strip()
    viewer_id = current_farmer_id()
    sql = 'SELECT id, name, username, bio, photo_url FROM farmers'
    params = []
    if query:
        like = f'%{query}%'
        sql += ' WHERE name LIKE ? OR username LIKE ?'
        params += [like, like]
    sql += ' ORDER BY name COLLATE NOCASE LIMIT 100'
    with get_db() as db:
        rows = db.execute(sql, params).fetchall()
        farmers = []
        for row in rows:
            following = bool(viewer_id and db.execute(
                'SELECT 1 FROM follows WHERE follower_id = ? AND followed_id = ?',
                (viewer_id, row['id'])).fetchone())
            farmers.append({
                'id': row['id'], 'name': row['name'], 'username': row['username'],
                'bio': row['bio'], 'photo_url': row['photo_url'], 'following': following,
            })
    return jsonify({'farmers': farmers})


@features_blueprint.post('/chaupal/posts')
def chaupal_create_post():
    farmer_id, error = require_farmer()
    if error:
        return error
    data = json_body()
    kind = data.get('kind') if data.get('kind') in POST_KINDS else 'post'
    caption = (data.get('caption') or '').strip()[:2000]
    category = (data.get('category') or 'General').strip()[:60]
    if not caption:
        return jsonify({'error': 'caption_required'}), 400
    with get_db() as db:
        cursor = db.execute(
            'INSERT INTO posts (farmer_id, kind, caption, category, media_kind) '
            'VALUES (?, ?, ?, ?, ?)', (farmer_id, kind, caption, category, 'none'))
        row = db.execute('SELECT * FROM posts WHERE id = ?', (cursor.lastrowid,)).fetchone()
        post = _post_row_to_payload(db, row, farmer_id)
    return jsonify({'post': post}), 201


@features_blueprint.post('/chaupal/upload')
def chaupal_upload_post():
    farmer_id, error = require_farmer()
    if error:
        return error
    image = request.files.get('image')
    if not image or not image.filename:
        return jsonify({'error': 'image_required'}), 400
    extension = os.path.splitext(secure_filename(image.filename))[1].lower()
    if extension not in IMAGE_EXTENSIONS:
        return jsonify({'error': 'invalid_image_type'}), 400
    if (request.content_length or 0) > MAX_IMAGE_BYTES:
        return jsonify({'error': 'image_too_large'}), 400
    filename = f'chaupal-{farmer_id}-{secrets.token_urlsafe(12)}{extension}'
    image.save(os.path.join(UPLOAD_FOLDER, filename))
    media_url = f'/uploads/{filename}'
    caption = (request.form.get('caption') or '').strip()[:2000]
    category = (request.form.get('category') or 'General').strip()[:60]
    with get_db() as db:
        cursor = db.execute(
            'INSERT INTO posts (farmer_id, kind, caption, category, media_kind, media_url) '
            'VALUES (?, ?, ?, ?, ?, ?)', (farmer_id, 'post', caption, category, 'image', media_url))
        row = db.execute('SELECT * FROM posts WHERE id = ?', (cursor.lastrowid,)).fetchone()
        post = _post_row_to_payload(db, row, farmer_id)
    return jsonify({'post': post}), 201


@features_blueprint.post('/chaupal/posts/<int:post_id>/like')
def chaupal_toggle_like(post_id):
    farmer_id, error = require_farmer()
    if error:
        return error
    with get_db() as db:
        if not db.execute('SELECT 1 FROM posts WHERE id = ?', (post_id,)).fetchone():
            return jsonify({'error': 'post_not_found'}), 404
        if db.execute('SELECT 1 FROM likes WHERE post_id = ? AND farmer_id = ?',
                      (post_id, farmer_id)).fetchone():
            db.execute('DELETE FROM likes WHERE post_id = ? AND farmer_id = ?', (post_id, farmer_id))
            liked = False
        else:
            db.execute('INSERT INTO likes (post_id, farmer_id) VALUES (?, ?)', (post_id, farmer_id))
            liked = True
        likes = db.execute('SELECT COUNT(*) AS c FROM likes WHERE post_id = ?', (post_id,)).fetchone()['c']
    return jsonify({'success': True, 'liked': liked, 'likes': likes})


@features_blueprint.post('/chaupal/posts/<int:post_id>/save')
def chaupal_toggle_save(post_id):
    farmer_id, error = require_farmer()
    if error:
        return error
    with get_db() as db:
        if not db.execute('SELECT 1 FROM posts WHERE id = ?', (post_id,)).fetchone():
            return jsonify({'error': 'post_not_found'}), 404
        if db.execute('SELECT 1 FROM saves WHERE post_id = ? AND farmer_id = ?',
                      (post_id, farmer_id)).fetchone():
            db.execute('DELETE FROM saves WHERE post_id = ? AND farmer_id = ?', (post_id, farmer_id))
            saved = False
        else:
            db.execute('INSERT INTO saves (post_id, farmer_id) VALUES (?, ?)', (post_id, farmer_id))
            saved = True
    return jsonify({'success': True, 'saved': saved})


@features_blueprint.get('/chaupal/posts/<int:post_id>/comments')
def chaupal_comments(post_id):
    with get_db() as db:
        rows = db.execute(
            'SELECT c.*, f.name AS author_name, f.username AS author_username '
            'FROM comments c JOIN farmers f ON f.id = c.farmer_id '
            'WHERE c.post_id = ? ORDER BY datetime(c.created_at) ASC, c.id ASC', (post_id,)).fetchall()
        comments = []
        for row in rows:
            replies = db.execute(
                'SELECT r.*, f.name AS author_name, f.username AS author_username '
                'FROM comment_replies r JOIN farmers f ON f.id = r.farmer_id '
                'WHERE r.comment_id = ? ORDER BY datetime(r.created_at) ASC, r.id ASC',
                (row['id'],)).fetchall()
            comments.append({
                'id': row['id'],
                'post_id': row['post_id'],
                'body': row['body'],
                'created_at': row['created_at'],
                'author_id': row['farmer_id'],
                'author_name': row['author_name'],
                'author_username': row['author_username'],
                'replies': [{
                    'id': r['id'], 'body': r['body'], 'created_at': r['created_at'],
                    'author_id': r['farmer_id'], 'author_name': r['author_name'],
                    'author_username': r['author_username'],
                } for r in replies],
            })
    return jsonify({'comments': comments})


@features_blueprint.post('/chaupal/posts/<int:post_id>/comments')
def chaupal_add_comment(post_id):
    farmer_id, error = require_farmer()
    if error:
        return error
    body = (json_body().get('body') or '').strip()[:1000]
    if not body:
        return jsonify({'error': 'comment_body_required'}), 400
    with get_db() as db:
        post = db.execute('SELECT farmer_id FROM posts WHERE id = ?', (post_id,)).fetchone()
        if not post:
            return jsonify({'error': 'post_not_found'}), 404
        db.execute('INSERT INTO comments (post_id, farmer_id, body) VALUES (?, ?, ?)',
                   (post_id, farmer_id, body))
        if post['farmer_id'] != farmer_id:
            db.execute(
                'INSERT INTO notifications_v2 (farmer_id, kind, message, link) VALUES (?, ?, ?, ?)',
                (post['farmer_id'], 'comment', 'Someone commented on your post.', f'#post-{post_id}'))
    return jsonify({'success': True}), 201


@features_blueprint.post('/chaupal/comments/<int:comment_id>/reply')
def chaupal_reply_comment(comment_id):
    farmer_id, error = require_farmer()
    if error:
        return error
    body = (json_body().get('body') or '').strip()[:1000]
    if not body:
        return jsonify({'error': 'reply_body_required'}), 400
    with get_db() as db:
        if not db.execute('SELECT 1 FROM comments WHERE id = ?', (comment_id,)).fetchone():
            return jsonify({'error': 'comment_not_found'}), 404
        db.execute('INSERT INTO comment_replies (comment_id, farmer_id, body) VALUES (?, ?, ?)',
                   (comment_id, farmer_id, body))
    return jsonify({'success': True}), 201


@features_blueprint.get('/chaupal/posts/<int:post_id>')
def chaupal_post_detail(post_id):
    viewer_id = current_farmer_id()
    with get_db() as db:
        row = db.execute('SELECT * FROM posts WHERE id = ?', (post_id,)).fetchone()
        if not row:
            return jsonify({'error': 'post_not_found'}), 404
        post = _post_row_to_payload(db, row, viewer_id)
    return jsonify({'post': post})


@features_blueprint.delete('/chaupal/posts/<int:post_id>')
def chaupal_delete_post(post_id):
    farmer_id, error = require_farmer()
    if error:
        return error
    with get_db() as db:
        row = db.execute('SELECT farmer_id, media_url FROM posts WHERE id = ?', (post_id,)).fetchone()
        if not row:
            return jsonify({'error': 'post_not_found'}), 404
        if row['farmer_id'] != farmer_id and not is_admin(farmer_id):
            return jsonify({'error': 'only_owner_can_delete'}), 403
        media_url = row['media_url']
        db.execute('DELETE FROM likes WHERE post_id = ?', (post_id,))
        db.execute('DELETE FROM saves WHERE post_id = ?', (post_id,))
        db.execute('DELETE FROM comments WHERE post_id = ?', (post_id,))
        db.execute('DELETE FROM post_reports WHERE post_id = ?', (post_id,))
        db.execute('DELETE FROM posts WHERE id = ?', (post_id,))
    if media_url and media_url.startswith('/uploads/'):
        local = os.path.join(UPLOAD_FOLDER, os.path.basename(media_url))
        if os.path.isfile(local):
            try:
                os.remove(local)
            except OSError:
                pass
    return jsonify({'success': True})


@features_blueprint.post('/chaupal/posts/<int:post_id>/report')
def chaupal_report_post(post_id):
    farmer_id, error = require_farmer()
    if error:
        return error
    data = json_body()
    reason = data.get('reason') if data.get('reason') in REPORT_REASONS else 'other'
    details = (data.get('details') or '').strip()[:500]
    with get_db() as db:
        if not db.execute('SELECT 1 FROM posts WHERE id = ?', (post_id,)).fetchone():
            return jsonify({'error': 'post_not_found'}), 404
        try:
            db.execute(
                'INSERT INTO post_reports (post_id, farmer_id, reason, details) VALUES (?, ?, ?, ?)',
                (post_id, farmer_id, reason, details))
        except Exception:
            return jsonify({'error': 'already_reported'}), 409
        db.execute('UPDATE posts SET report_count = report_count + 1 WHERE id = ?', (post_id,))
    return jsonify({'success': True}), 201


@features_blueprint.post('/chaupal/farmers/<farmer_id>/follow')
def chaupal_toggle_follow(farmer_id):
    viewer_id, error = require_farmer()
    if error:
        return error
    if farmer_id == viewer_id:
        return jsonify({'error': 'cannot_follow_self'}), 400
    if not farmer_exists(farmer_id):
        return jsonify({'error': 'farmer_not_found'}), 404
    with get_db() as db:
        if db.execute('SELECT 1 FROM follows WHERE follower_id = ? AND followed_id = ?',
                      (viewer_id, farmer_id)).fetchone():
            db.execute('DELETE FROM follows WHERE follower_id = ? AND followed_id = ?',
                       (viewer_id, farmer_id))
            following = False
        else:
            db.execute('INSERT INTO follows (follower_id, followed_id) VALUES (?, ?)',
                       (viewer_id, farmer_id))
            db.execute(
                'INSERT INTO notifications_v2 (farmer_id, kind, message) VALUES (?, ?, ?)',
                (farmer_id, 'follow', 'A farmer started following you.'))
            following = True
    return jsonify({'success': True, 'following': following})


@features_blueprint.get('/chaupal/profile/<farmer_id>')
def chaupal_profile(farmer_id):
    viewer_id = current_farmer_id()
    with get_db() as db:
        farmer = db.execute('SELECT * FROM farmers WHERE id = ?', (farmer_id,)).fetchone()
        if not farmer:
            return jsonify({'error': 'farmer_not_found'}), 404
        rows = db.execute(
            'SELECT * FROM posts WHERE farmer_id = ? ORDER BY datetime(created_at) DESC, id DESC LIMIT 100',
            (farmer_id,)).fetchall()
        followers = db.execute('SELECT COUNT(*) AS c FROM follows WHERE followed_id = ?', (farmer_id,)).fetchone()['c']
        following = db.execute('SELECT COUNT(*) AS c FROM follows WHERE follower_id = ?', (farmer_id,)).fetchone()['c']
        posts = [_post_row_to_payload(db, row, viewer_id) for row in rows]
    return jsonify({
        'farmer': {
            'id': farmer['id'], 'name': farmer['name'], 'username': farmer['username'],
            'bio': farmer['bio'], 'photo_url': farmer['photo_url'],
        },
        'followers': followers,
        'following': following,
        'posts': posts,
    })


# ----------------------------- disease diagnosis -----------------------------

@features_blueprint.post('/diagnosis/analyze')
def diagnosis_analyze():
    farmer_id, error = require_farmer()
    if error:
        return error
    image = request.files.get('image')
    crop = (request.form.get('crop') or '').strip()[:60]
    if not image or not image.filename:
        return jsonify({'error': 'image_required'}), 400
    if not crop:
        return jsonify({'error': 'crop_required'}), 400
    extension = os.path.splitext(secure_filename(image.filename))[1].lower()
    if extension not in IMAGE_EXTENSIONS:
        return jsonify({'error': 'invalid_image_type'}), 400
    if (request.content_length or 0) > MAX_IMAGE_BYTES:
        return jsonify({'error': 'image_too_large'}), 400
    filename = f'diagnosis-{farmer_id}-{secrets.token_urlsafe(12)}{extension}'
    image.save(os.path.join(UPLOAD_FOLDER, filename))
    image_url = f'/uploads/{filename}'

    # No trained model is connected -> honest demo response, clearly labelled.
    result = services.diagnosis_stub(crop)
    with get_db() as db:
        cursor = db.execute(
            'INSERT INTO diagnosis_history '
            '(farmer_id, crop, image_url, status, result_label, confidence, symptoms, prevention, treatment) '
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            (farmer_id, crop, image_url, result['status'], result['result_label'],
             result['confidence'], result['symptoms'], result['prevention'], result['treatment']))
        record_id = cursor.lastrowid
    result['id'] = record_id
    result['image_url'] = image_url
    result['created_at'] = None
    result['model_configured'] = services.ai_model_configured()
    return jsonify({'result': result}), 201


@features_blueprint.get('/diagnosis/history')
def diagnosis_history():
    farmer_id, error = require_farmer()
    if error:
        return error
    with get_db() as db:
        rows = db.execute(
            'SELECT * FROM diagnosis_history WHERE farmer_id = ? '
            'ORDER BY datetime(created_at) DESC, id DESC', (farmer_id,)).fetchall()
    return jsonify({'history': [dict(row) for row in rows]})


@features_blueprint.delete('/diagnosis/history/<int:record_id>')
def diagnosis_delete(record_id):
    farmer_id, error = require_farmer()
    if error:
        return error
    with get_db() as db:
        row = db.execute('SELECT farmer_id, image_url FROM diagnosis_history WHERE id = ?',
                         (record_id,)).fetchone()
        if not row:
            return jsonify({'error': 'record_not_found'}), 404
        if row['farmer_id'] != farmer_id:
            return jsonify({'error': 'only_owner_can_delete'}), 403
        db.execute('DELETE FROM diagnosis_history WHERE id = ?', (record_id,))
    if row['image_url'] and row['image_url'].startswith('/uploads/'):
        local = os.path.join(UPLOAD_FOLDER, os.path.basename(row['image_url']))
        if os.path.isfile(local):
            try:
                os.remove(local)
            except OSError:
                pass
    return jsonify({'success': True})


# ----------------------------- satellite ai -----------------------------

@features_blueprint.get('/satellite/status')
def satellite_status():
    return jsonify({
        'layers': services.satellite_layers(),
        'note': (
            'Base map and satellite imagery are live map tiles. Crop-health (NDVI) analysis '
            'is only available when a real satellite analysis API is connected to the backend.'
        ),
    })


@features_blueprint.get('/satellite/fields')
def list_fields():
    farmer_id, error = require_farmer()
    if error:
        return error
    with get_db() as db:
        rows = db.execute(
            'SELECT * FROM saved_fields WHERE farmer_id = ? '
            'ORDER BY datetime(created_at) DESC, id DESC', (farmer_id,)).fetchall()
    return jsonify({'fields': [dict(row) for row in rows]})


@features_blueprint.post('/satellite/fields')
def create_field():
    farmer_id, error = require_farmer()
    if error:
        return error
    data = json_body()
    name = (data.get('name') or '').strip()[:80]
    if not name:
        return jsonify({'error': 'field_name_required'}), 400
    try:
        latitude = float(data.get('latitude'))
        longitude = float(data.get('longitude'))
    except (TypeError, ValueError):
        return jsonify({'error': 'valid_coordinates_required'}), 400
    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        return jsonify({'error': 'coordinates_out_of_range'}), 400
    crop = (data.get('crop') or '').strip()[:60]
    notes = (data.get('notes') or '').strip()[:500]
    boundary = data.get('boundary')
    boundary_json = ''
    if isinstance(boundary, list) and len(boundary) >= 3:
        boundary_json = __import__('json').dumps(boundary)
    area = data.get('area_acres')
    try:
        area = float(area) if area is not None else None
    except (TypeError, ValueError):
        area = None
    with get_db() as db:
        cursor = db.execute(
            'INSERT INTO saved_fields (farmer_id, name, crop, latitude, longitude, area_acres, boundary, notes) '
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            (farmer_id, name, crop, latitude, longitude, area, boundary_json, notes))
        row = db.execute('SELECT * FROM saved_fields WHERE id = ?', (cursor.lastrowid,)).fetchone()
    return jsonify({'field': dict(row)}), 201


@features_blueprint.delete('/satellite/fields/<int:field_id>')
def delete_field(field_id):
    farmer_id, error = require_farmer()
    if error:
        return error
    with get_db() as db:
        row = db.execute('SELECT farmer_id FROM saved_fields WHERE id = ?', (field_id,)).fetchone()
        if not row:
            return jsonify({'error': 'field_not_found'}), 404
        if row['farmer_id'] != farmer_id:
            return jsonify({'error': 'only_owner_can_delete'}), 403
        db.execute('DELETE FROM saved_fields WHERE id = ?', (field_id,))
    return jsonify({'success': True})


# ----------------------------- kisan radio -----------------------------

def radio_payload(row, saved=False):
    return {
        'id': row['id'], 'title': row['title'], 'title_hi': row['title_hi'],
        'host': row['host'], 'category': row['category'], 'description': row['description'],
        'audio_url': row['audio_url'], 'duration_seconds': row['duration_seconds'],
        'language': row['language'], 'published_at': row['published_at'],
        'has_audio': bool(row['audio_url']), 'saved': saved,
    }


@features_blueprint.get('/radio/programs')
def radio_programs():
    category = (request.args.get('category') or '').strip()
    farmer_id = current_farmer_id()
    sql = 'SELECT * FROM radio_programs WHERE active = 1'
    params = []
    if category:
        sql += ' AND category = ?'
        params.append(category)
    sql += ' ORDER BY datetime(published_at) DESC, id DESC'
    with get_db() as db:
        rows = db.execute(sql, params).fetchall()
        saved = set()
        if farmer_id:
            saved = {r['program_id'] for r in db.execute(
                'SELECT program_id FROM saved_programs WHERE farmer_id = ?', (farmer_id,))}
        categories = [r['category'] for r in db.execute(
            'SELECT DISTINCT category FROM radio_programs WHERE active = 1 ORDER BY category')]
    return jsonify({
        'programs': [radio_payload(row, row['id'] in saved) for row in rows],
        'categories': categories,
        'has_audio': any(bool(row['audio_url']) for row in rows),
    })


@features_blueprint.post('/radio/programs/<int:program_id>/save')
def radio_toggle_save(program_id):
    farmer_id, error = require_farmer()
    if error:
        return error
    with get_db() as db:
        if not db.execute('SELECT 1 FROM radio_programs WHERE id = ?', (program_id,)).fetchone():
            return jsonify({'error': 'program_not_found'}), 404
        if db.execute('SELECT 1 FROM saved_programs WHERE program_id = ? AND farmer_id = ?',
                      (program_id, farmer_id)).fetchone():
            db.execute('DELETE FROM saved_programs WHERE program_id = ? AND farmer_id = ?',
                       (program_id, farmer_id))
            saved = False
        else:
            db.execute('INSERT INTO saved_programs (program_id, farmer_id) VALUES (?, ?)',
                       (program_id, farmer_id))
            saved = True
    return jsonify({'success': True, 'saved': saved})


@features_blueprint.get('/radio/saved')
def radio_saved():
    farmer_id, error = require_farmer()
    if error:
        return error
    with get_db() as db:
        rows = db.execute(
            'SELECT p.* FROM radio_programs p JOIN saved_programs s ON s.program_id = p.id '
            'WHERE s.farmer_id = ? ORDER BY s.created_at DESC', (farmer_id,)).fetchall()
    return jsonify({'programs': [radio_payload(row, True) for row in rows]})


# ----------------------------- notifications -----------------------------

@features_blueprint.get('/notifications')
def feature_notifications():
    farmer_id, error = require_farmer()
    if error:
        return error
    with get_db() as db:
        rows = db.execute(
            'SELECT * FROM notifications_v2 WHERE farmer_id = ? '
            'ORDER BY datetime(created_at) DESC, id DESC LIMIT 50', (farmer_id,)).fetchall()
    return jsonify({'notifications': [dict(row) for row in rows]})


@features_blueprint.post('/notifications/<int:notification_id>/read')
def mark_notification_read(notification_id):
    farmer_id, error = require_farmer()
    if error:
        return error
    with get_db() as db:
        cursor = db.execute(
            'UPDATE notifications_v2 SET read = 1 WHERE id = ? AND farmer_id = ?',
            (notification_id, farmer_id))
    if not cursor.rowcount:
        return jsonify({'error': 'notification_not_found'}), 404
    return jsonify({'success': True})


@features_blueprint.get('/health')
def features_health():
    return jsonify({'section': 'smart_farm_features', 'status': 'ready'})
