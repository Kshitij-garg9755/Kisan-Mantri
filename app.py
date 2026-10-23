from flask import Flask, send_from_directory, render_template_string, request, jsonify, session
import os
from dotenv import load_dotenv
import requests
import random
import time
from twilio.rest import Client
import json
import sqlite3
import secrets
import hashlib
import firebase_admin
from firebase_admin import auth as firebase_admin_auth, credentials as firebase_admin_credentials
from werkzeug.utils import secure_filename
from backend.marketplace.routes import marketplace_blueprint
from backend.marketplace.services.validation import MARKETPLACE_STATUSES, parse_product
from backend.features.models import init_feature_db
from backend.features.routes import features_blueprint

load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

FRONTEND_FOLDER = os.path.join(os.path.dirname(__file__), 'frontend')
app = Flask(__name__, static_folder=FRONTEND_FOLDER, static_url_path='/_frontend')
app.secret_key = os.environ.get('SMART_FARM_SECRET_KEY', 'smart-farm-local-development-key')
app.register_blueprint(marketplace_blueprint)
app.register_blueprint(features_blueprint)

@app.after_request
def add_cors_headers(response):
    origin = request.headers.get('Origin')
    if origin:
        response.headers['Access-Control-Allow-Origin'] = origin
        response.headers['Access-Control-Allow-Credentials'] = 'true'
        response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS'
        req_headers = request.headers.get('Access-Control-Request-Headers')
        response.headers['Access-Control-Allow-Headers'] = req_headers if req_headers else 'Content-Type, Authorization, X-Requested-With, X-Farmer-Id, x-farmer-id'
    return response

@app.route('/<path:dummy>', methods=['OPTIONS'])
@app.route('/', methods=['OPTIONS'])
def options_handler(dummy=''):
    response = jsonify({})
    origin = request.headers.get('Origin')
    if origin:
        response.headers['Access-Control-Allow-Origin'] = origin
        response.headers['Access-Control-Allow-Credentials'] = 'true'
        response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS'
        req_headers = request.headers.get('Access-Control-Request-Headers')
        response.headers['Access-Control-Allow-Headers'] = req_headers if req_headers else 'Content-Type, Authorization, X-Requested-With, X-Farmer-Id, x-farmer-id'
    return response

TWILIO_SID = os.environ.get('TWILIO_SID')
TWILIO_AUTH = os.environ.get('TWILIO_AUTH')
TWILIO_FROM = os.environ.get('TWILIO_FROM')
client = Client(TWILIO_SID, TWILIO_AUTH) if TWILIO_SID and TWILIO_AUTH else None
DEMO_OTP_SETTING = os.environ.get('KISAN_MANTRI_DEMO_AUTH', '').strip().lower()
if DEMO_OTP_SETTING:
    DEMO_OTP_ENABLED = DEMO_OTP_SETTING in {'1', 'true', 'yes', 'on'}
else:
    # Keep the local demo convenient, while requiring a real auth provider in cloud deployments.
    DEMO_OTP_ENABLED = not (client and TWILIO_FROM) and not FIREBASE_ADMIN_APP

FIREBASE_PROJECT_ID = os.environ.get('FIREBASE_PROJECT_ID', '').strip()
FIREBASE_CLIENT_CONFIG = {
    'apiKey': os.environ.get('FIREBASE_API_KEY', '').strip(),
    'authDomain': os.environ.get('FIREBASE_AUTH_DOMAIN', '').strip(),
    'projectId': FIREBASE_PROJECT_ID,
    'messagingSenderId': os.environ.get('FIREBASE_MESSAGING_SENDER_ID', '').strip(),
    'appId': os.environ.get('FIREBASE_APP_ID', '').strip(),
}
FIREBASE_CLIENT_CONFIGURED = all(FIREBASE_CLIENT_CONFIG.values())
FIREBASE_ADMIN_APP = None
FIREBASE_ADMIN_CREDENTIALS = os.environ.get('GOOGLE_APPLICATION_CREDENTIALS', '').strip()
FIREBASE_ADMIN_CREDENTIALS_JSON = os.environ.get('FIREBASE_ADMIN_CREDENTIALS_JSON', '').strip()
if FIREBASE_PROJECT_ID and (FIREBASE_ADMIN_CREDENTIALS_JSON or FIREBASE_ADMIN_CREDENTIALS):
    try:
        if FIREBASE_ADMIN_CREDENTIALS_JSON:
            admin_credential_data = json.loads(FIREBASE_ADMIN_CREDENTIALS_JSON)
            admin_credential = firebase_admin_credentials.Certificate(admin_credential_data)
        else:
            credentials_path = os.path.abspath(os.path.expanduser(FIREBASE_ADMIN_CREDENTIALS))
            admin_credential = firebase_admin_credentials.Certificate(credentials_path) if os.path.isfile(credentials_path) else None
        if admin_credential:
            try:
                FIREBASE_ADMIN_APP = firebase_admin.initialize_app(
                    admin_credential,
                    {'projectId': FIREBASE_PROJECT_ID},
                    name='kisan-mantri-auth',
                )
            except ValueError:
                FIREBASE_ADMIN_APP = firebase_admin.get_app('kisan-mantri-auth')
    except Exception as error:
        app.logger.error('Firebase Admin initialization failed (%s).', type(error).__name__)

FARMERS_FILE = 'farmers.json'
APP_DATA_DIR = os.path.abspath(os.environ.get('SMART_FARM_DATA_DIR', os.path.dirname(__file__)))
os.makedirs(APP_DATA_DIR, exist_ok=True)
DATABASE_FILE = os.path.join(APP_DATA_DIR, 'smart_farm.db')
UPLOAD_FOLDER = os.path.join(APP_DATA_DIR, 'agriverse_uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

def get_db():
    db = sqlite3.connect(DATABASE_FILE)
    db.row_factory = sqlite3.Row
    return db

def init_community_db():
    with get_db() as db:
        db.executescript('''
            CREATE TABLE IF NOT EXISTS farmers (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT UNIQUE NOT NULL,
                username TEXT UNIQUE NOT NULL, bio TEXT NOT NULL DEFAULT '',
                photo_url TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS posts (
                id INTEGER PRIMARY KEY AUTOINCREMENT, farmer_id TEXT NOT NULL,
                kind TEXT NOT NULL CHECK(kind IN ('post', 'reel', 'video')),
                caption TEXT NOT NULL DEFAULT '', media_url TEXT NOT NULL DEFAULT '',
                thumbnail_url TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '',
                description TEXT NOT NULL DEFAULT '', crop TEXT NOT NULL DEFAULT '',
                category TEXT NOT NULL DEFAULT '', language TEXT NOT NULL DEFAULT '',
                tags TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(farmer_id) REFERENCES farmers(id)
            );
            CREATE TABLE IF NOT EXISTS likes (post_id INTEGER NOT NULL, farmer_id TEXT NOT NULL, PRIMARY KEY(post_id, farmer_id));
            CREATE TABLE IF NOT EXISTS saves (post_id INTEGER NOT NULL, farmer_id TEXT NOT NULL, PRIMARY KEY(post_id, farmer_id));
            CREATE TABLE IF NOT EXISTS follows (follower_id TEXT NOT NULL, followed_id TEXT NOT NULL, PRIMARY KEY(follower_id, followed_id));
            CREATE TABLE IF NOT EXISTS follow_requests (
                requester_id TEXT NOT NULL, target_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY(requester_id, target_id)
            );
            CREATE INDEX IF NOT EXISTS idx_follow_requests_target ON follow_requests(target_id, created_at DESC);
            CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL, farmer_id TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, farmer_id TEXT NOT NULL, message TEXT NOT NULL, read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE IF NOT EXISTS conversations (id INTEGER PRIMARY KEY AUTOINCREMENT, user1_id TEXT NOT NULL, user2_id TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id INTEGER NOT NULL, sender_id TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE IF NOT EXISTS land_measurements (
                id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, name TEXT NOT NULL,
                coordinates TEXT NOT NULL, area_m2 REAL NOT NULL, area_ft2 REAL NOT NULL,
                acres REAL NOT NULL, hectares REAL NOT NULL, perimeter_m REAL NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES farmers(id)
            );
            CREATE TABLE IF NOT EXISTS farmer_profiles (
                user_id TEXT PRIMARY KEY, village TEXT NOT NULL DEFAULT '', district TEXT NOT NULL DEFAULT '',
                state TEXT NOT NULL DEFAULT '', farm_name TEXT NOT NULL DEFAULT '', about TEXT NOT NULL DEFAULT '',
                verification_status TEXT NOT NULL DEFAULT 'pending', rating REAL NOT NULL DEFAULT 0,
                review_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES farmers(id)
            );
            CREATE TABLE IF NOT EXISTS delivery_partner_profiles (
                user_id TEXT PRIMARY KEY, vehicle_type TEXT NOT NULL DEFAULT '', vehicle_number TEXT NOT NULL DEFAULT '',
                service_area TEXT NOT NULL DEFAULT '', availability_status TEXT NOT NULL DEFAULT 'offline',
                current_lat REAL, current_lng REAL, verification_status TEXT NOT NULL DEFAULT 'pending',
                rating REAL NOT NULL DEFAULT 0, completed_deliveries INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY(user_id) REFERENCES farmers(id)
            );
            CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL, name TEXT NOT NULL,
                category TEXT NOT NULL, product_type TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
                price REAL NOT NULL CHECK(price >= 0), unit TEXT NOT NULL, quantity REAL NOT NULL CHECK(quantity >= 0),
                min_order_quantity REAL NOT NULL DEFAULT 1 CHECK(min_order_quantity > 0), organic INTEGER NOT NULL DEFAULT 0,
                harvest_date TEXT, delivery_time TEXT NOT NULL DEFAULT '', village TEXT NOT NULL DEFAULT '',
                farm_location TEXT NOT NULL DEFAULT '', quality_details TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'available',
                rating REAL NOT NULL DEFAULT 0, review_count INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(owner_id) REFERENCES farmers(id)
            );
            CREATE INDEX IF NOT EXISTS idx_products_owner ON products(owner_id);
            CREATE INDEX IF NOT EXISTS idx_products_search ON products(category, product_type, status);
            CREATE TABLE IF NOT EXISTS product_images (
                id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL, image_url TEXT NOT NULL,
                FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS carts (
                id INTEGER PRIMARY KEY AUTOINCREMENT, buyer_id TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(buyer_id) REFERENCES farmers(id)
            );
            CREATE TABLE IF NOT EXISTS cart_items (
                cart_id INTEGER NOT NULL, product_id INTEGER NOT NULL, quantity REAL NOT NULL CHECK(quantity > 0),
                PRIMARY KEY(cart_id, product_id), FOREIGN KEY(cart_id) REFERENCES carts(id) ON DELETE CASCADE,
                FOREIGN KEY(product_id) REFERENCES products(id)
            );
            CREATE TABLE IF NOT EXISTS addresses (
                id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, label TEXT NOT NULL DEFAULT 'Home',
                recipient_name TEXT NOT NULL, phone TEXT NOT NULL, line1 TEXT NOT NULL, village TEXT NOT NULL DEFAULT '',
                district TEXT NOT NULL DEFAULT '', state TEXT NOT NULL, postal_code TEXT NOT NULL, is_default INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES farmers(id)
            );
            CREATE TABLE IF NOT EXISTS orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT, order_number TEXT NOT NULL UNIQUE, buyer_id TEXT NOT NULL,
                address_id INTEGER NOT NULL, subtotal REAL NOT NULL, delivery_charge REAL NOT NULL DEFAULT 0,
                tax REAL NOT NULL DEFAULT 0, total REAL NOT NULL, payment_status TEXT NOT NULL DEFAULT 'pending',
                status TEXT NOT NULL DEFAULT 'placed', expected_delivery TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(buyer_id) REFERENCES farmers(id),
                FOREIGN KEY(address_id) REFERENCES addresses(id)
            );
            CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders(buyer_id, created_at);
            CREATE TABLE IF NOT EXISTS order_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, product_id INTEGER NOT NULL,
                seller_id TEXT NOT NULL, product_name TEXT NOT NULL, unit TEXT NOT NULL, quantity REAL NOT NULL,
                unit_price REAL NOT NULL, line_total REAL NOT NULL, FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE,
                FOREIGN KEY(product_id) REFERENCES products(id), FOREIGN KEY(seller_id) REFERENCES farmers(id)
            );
            CREATE TABLE IF NOT EXISTS payments (
                id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL UNIQUE, provider TEXT NOT NULL DEFAULT 'cod',
                provider_reference TEXT, status TEXT NOT NULL DEFAULT 'pending', amount REAL NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(order_id) REFERENCES orders(id)
            );
            CREATE TABLE IF NOT EXISTS delivery_assignments (
                id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL UNIQUE, partner_id TEXT,
                status TEXT NOT NULL DEFAULT 'searching', pickup_lat REAL, pickup_lng REAL,
                assigned_at TEXT, accepted_at TEXT, completed_at TEXT, FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE,
                FOREIGN KEY(partner_id) REFERENCES farmers(id)
            );
            CREATE TABLE IF NOT EXISTS delivery_locations (
                id INTEGER PRIMARY KEY AUTOINCREMENT, assignment_id INTEGER NOT NULL, partner_id TEXT NOT NULL,
                latitude REAL NOT NULL, longitude REAL NOT NULL, recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(assignment_id) REFERENCES delivery_assignments(id) ON DELETE CASCADE,
                FOREIGN KEY(partner_id) REFERENCES farmers(id)
            );
            CREATE TABLE IF NOT EXISTS reviews (
                id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL, order_id INTEGER NOT NULL,
                reviewer_id TEXT NOT NULL, rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5), body TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(product_id, order_id, reviewer_id),
                FOREIGN KEY(product_id) REFERENCES products(id), FOREIGN KEY(order_id) REFERENCES orders(id),
                FOREIGN KEY(reviewer_id) REFERENCES farmers(id)
            );
            CREATE TABLE IF NOT EXISTS wishlists (
                buyer_id TEXT NOT NULL, product_id INTEGER NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY(buyer_id, product_id), FOREIGN KEY(buyer_id) REFERENCES farmers(id),
                FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS login_otps (
                phone TEXT PRIMARY KEY, otp_hash TEXT NOT NULL, created_at REAL NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_id, created_at);
        ''')
        for column, definition in (
            ('role', "TEXT NOT NULL DEFAULT 'buyer'"),
            ('blocked', 'INTEGER NOT NULL DEFAULT 0'),
        ):
            try:
                db.execute(f'ALTER TABLE farmers ADD COLUMN {column} {definition}')
            except sqlite3.OperationalError:
                pass

init_community_db()

init_feature_db()


def save_farmer_data(data):
    farmers = []
    if os.path.exists(FARMERS_FILE):
        with open(FARMERS_FILE, 'r', encoding='utf-8') as f:
            try:
                farmers = json.load(f)
            except Exception:
                farmers = []
    existing = next((farmer for farmer in farmers if farmer.get('phone') == data.get('phone')), None)
    if existing:
        existing.update(data)
    else:
        farmers.append(data)
    with open(FARMERS_FILE, 'w', encoding='utf-8') as f:
        json.dump(farmers, f, ensure_ascii=False, indent=2)

@app.route('/')
def root():
    # Smart Farm remains the default application; login is an explicit entry point.
    return send_from_directory(os.path.join(FRONTEND_FOLDER, 'pages'), 'index.html')

@app.route('/agriverse')
def agriverse():
    return send_from_directory(os.path.join(FRONTEND_FOLDER, 'pages'), 'agriverse.html')

@app.route('/uploads/<path:filename>')
def uploaded_file(filename):
    return send_from_directory(UPLOAD_FOLDER, filename)

def current_farmer_id():
    return session.get('farmer_id') or request.headers.get('X-Farmer-Id')

def require_farmer():
    farmer_id = current_farmer_id()
    if not farmer_id:
        return None, (jsonify({'error': 'authentication_required'}), 401)
    return farmer_id, None

def farmer_payload(row):
    if not row:
        return None
    return {
        'id': row['id'], 'name': row['name'], 'username': row['username'],
        'bio': row['bio'], 'photo_url': row['photo_url'], 'role': row['role'] if 'role' in row.keys() else 'buyer',
        'blocked': bool(row['blocked']) if 'blocked' in row.keys() else False
    }

def post_payload(db, post, viewer_id=None):
    author = db.execute('SELECT * FROM farmers WHERE id = ?', (post['farmer_id'],)).fetchone()
    likes = db.execute('SELECT COUNT(*) AS count FROM likes WHERE post_id = ?', (post['id'],)).fetchone()['count']
    comments = db.execute('SELECT COUNT(*) AS count FROM comments WHERE post_id = ?', (post['id'],)).fetchone()['count']
    saved = bool(viewer_id and db.execute('SELECT 1 FROM saves WHERE post_id = ? AND farmer_id = ?', (post['id'], viewer_id)).fetchone())
    liked = bool(viewer_id and db.execute('SELECT 1 FROM likes WHERE post_id = ? AND farmer_id = ?', (post['id'], viewer_id)).fetchone())
    following = bool(viewer_id and db.execute('SELECT 1 FROM follows WHERE follower_id = ? AND followed_id = ?', (viewer_id, post['farmer_id'])).fetchone())
    follow_requested = bool(viewer_id and db.execute('SELECT 1 FROM follow_requests WHERE requester_id = ? AND target_id = ?', (viewer_id, post['farmer_id'])).fetchone())
    result = dict(post)
    result['creatorId'] = post['farmer_id']
    result['author'] = farmer_payload(author)
    result['likes'] = likes
    result['comments'] = comments
    result['saved'] = saved
    result['liked'] = liked
    result['following'] = following
    result['follow_requested'] = follow_requested
    return result

def normalize_indian_phone(raw_phone):
    phone = ''.join(ch for ch in str(raw_phone or '') if ch.isdigit())
    if len(phone) == 12 and phone.startswith('91'):
        phone = phone[2:]
    elif len(phone) == 11 and phone.startswith('0'):
        phone = phone[1:]
    return phone if len(phone) == 10 and phone[0] in '6789' else None


def login_or_create_farmer(name, phone):
    with get_db() as db:
        farmer = db.execute('SELECT * FROM farmers WHERE phone = ?', (phone,)).fetchone()
        if farmer:
            db.execute('UPDATE farmers SET name = ? WHERE id = ?', (name, farmer['id']))
            farmer = db.execute('SELECT * FROM farmers WHERE id = ?', (farmer['id'],)).fetchone()
        else:
            farmer_id = secrets.token_urlsafe(16)
            username_base = ''.join(ch.lower() if ch.isalnum() else '_' for ch in name).strip('_') or 'farmer'
            username = username_base
            suffix = 1
            while db.execute('SELECT 1 FROM farmers WHERE username = ?', (username,)).fetchone():
                suffix += 1
                username = f'{username_base}_{suffix}'
            db.execute('INSERT INTO farmers (id, name, phone, username) VALUES (?, ?, ?, ?)', (farmer_id, name, phone, username))
            farmer = db.execute('SELECT * FROM farmers WHERE id = ?', (farmer_id,)).fetchone()
    session.clear()
    session['farmer_id'] = farmer['id']
    return jsonify({'success': True, 'farmer': farmer_payload(farmer)})


@app.post('/api/auth/login')
def auth_login():
    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()
    phone = normalize_indian_phone(data.get('phone'))
    verified_phone = session.pop('verified_phone', None)
    if not name or not phone:
        return jsonify({'error': 'name_and_phone_required'}), 400
    if verified_phone != phone:
        return jsonify({'error': 'phone_verification_required'}), 403
    return login_or_create_farmer(name, phone)


@app.route('/api/auth/profile-photo', methods=['POST', 'DELETE'])
def auth_profile_photo():
    farmer_id, error = require_farmer()
    if error:
        return error
    with get_db() as db:
        farmer = db.execute('SELECT * FROM farmers WHERE id = ?', (farmer_id,)).fetchone()
        if not farmer:
            return jsonify({'error': 'farmer_not_found'}), 404
        old_photo = farmer['photo_url'] or ''
        if request.method == 'DELETE':
            db.execute('UPDATE farmers SET photo_url = ? WHERE id = ?', ('', farmer_id))
            result = db.execute('SELECT * FROM farmers WHERE id = ?', (farmer_id,)).fetchone()
        else:
            photo = request.files.get('photo')
            allowed = {'.jpg', '.jpeg', '.png', '.webp'}
            extension = os.path.splitext(secure_filename(photo.filename if photo else ''))[1].lower()
            if not photo or not photo.filename:
                return jsonify({'error': 'photo_required'}), 400
            if extension not in allowed or (request.content_length or 0) > 5 * 1024 * 1024:
                return jsonify({'error': 'invalid_photo_type_or_size'}), 400
            filename = secure_filename(f'profile-{farmer_id}-{secrets.token_urlsafe(12)}{extension}')
            photo.save(os.path.join(UPLOAD_FOLDER, filename))
            photo_url = f'/uploads/{filename}'
            db.execute('UPDATE farmers SET photo_url = ? WHERE id = ?', (photo_url, farmer_id))
            result = db.execute('SELECT * FROM farmers WHERE id = ?', (farmer_id,)).fetchone()
    if old_photo.startswith(f'/uploads/profile-{farmer_id}-'):
        old_path = local_upload_path(old_photo)
        if old_path and os.path.isfile(old_path):
            try:
                os.remove(old_path)
            except OSError:
                app.logger.warning('Could not remove replaced profile photo for farmer %s.', farmer_id)
    return jsonify({'success': True, 'farmer': farmer_payload(result)})

@app.get('/api/firebase-config')
def firebase_public_config():
    if not FIREBASE_CLIENT_CONFIGURED or not FIREBASE_ADMIN_APP:
        return jsonify({'configured': False}), 503
    return jsonify({'configured': True, 'config': FIREBASE_CLIENT_CONFIG})


@app.post('/api/auth/firebase-login')
def auth_firebase_login():
    if not FIREBASE_CLIENT_CONFIGURED or not FIREBASE_ADMIN_APP:
        return jsonify({'success': False, 'message': 'Firebase is not configured on the server yet.'}), 503

    authorization = request.headers.get('Authorization', '')
    id_token = authorization[7:].strip() if authorization.startswith('Bearer ') else ''
    if not id_token:
        return jsonify({'success': False, 'message': 'Firebase sign-in is required.'}), 401

    try:
        claims = firebase_admin_auth.verify_id_token(id_token, app=FIREBASE_ADMIN_APP, check_revoked=True)
    except Exception as error:
        app.logger.info('Firebase ID token rejected (%s).', type(error).__name__)
        return jsonify({'success': False, 'message': 'Firebase verification failed. Please request a new code.'}), 401

    phone = normalize_indian_phone(claims.get('phone_number'))
    name = (request.get_json(silent=True) or {}).get('name', '').strip()
    if not phone or not name:
        return jsonify({'success': False, 'message': 'A verified Indian phone number and your name are required.'}), 400

    submitted_phone = normalize_indian_phone((request.get_json(silent=True) or {}).get('phone'))
    if submitted_phone and submitted_phone != phone:
        return jsonify({'success': False, 'message': 'The verified number does not match the phone number entered.'}), 403
    return login_or_create_farmer(name, phone)

@app.route('/api/auth/me', methods=['GET', 'PUT'])
def auth_me():
    farmer_id = current_farmer_id()
    if not farmer_id:
        return jsonify({'farmer': None})
    if request.method == 'PUT':
        data = request.get_json(silent=True) or {}
        bio = data.get('bio')
        photo_url = data.get('photo_url')
        with get_db() as db:
            if bio is not None:
                db.execute('UPDATE farmers SET bio = ? WHERE id = ?', (bio, farmer_id))
            if photo_url is not None:
                db.execute('UPDATE farmers SET photo_url = ? WHERE id = ?', (photo_url, farmer_id))
    with get_db() as db:
        farmer = db.execute('SELECT * FROM farmers WHERE id = ?', (farmer_id,)).fetchone()
    return jsonify({'farmer': farmer_payload(farmer)})

@app.post('/api/auth/logout')
def auth_logout():
    session.pop('farmer_id', None)
    return jsonify({'success': True})

@app.get('/api/measurements')
def list_measurements():
    farmer_id, error = require_farmer()
    if error:
        return error
    with get_db() as db:
        rows = db.execute('SELECT * FROM land_measurements WHERE user_id = ? ORDER BY datetime(created_at) DESC, id DESC', (farmer_id,)).fetchall()
    return jsonify({'measurements': [dict(row) for row in rows]})

@app.post('/api/measurements')
def create_measurement():
    farmer_id, error = require_farmer()
    if error:
        return error
    data = request.get_json(silent=True) or {}
    name = str(data.get('name') or '').strip()[:80]
    coordinates = data.get('coordinates')
    if not name or not isinstance(coordinates, list) or len(coordinates) < 3:
        return jsonify({'error': 'name_and_three_coordinates_required'}), 400
    if any(not isinstance(point, dict) or not isinstance(point.get('lat'), (int, float)) or not isinstance(point.get('lng'), (int, float)) for point in coordinates):
        return jsonify({'error': 'invalid_coordinates'}), 400
    try:
        area_m2 = float(data.get('area_m2'))
        area_ft2 = float(data.get('area_ft2'))
        acres = float(data.get('acres'))
        hectares = float(data.get('hectares'))
        perimeter_m = float(data.get('perimeter_m'))
    except (TypeError, ValueError):
        return jsonify({'error': 'invalid_measurement_values'}), 400
    with get_db() as db:
        cursor = db.execute('''INSERT INTO land_measurements
            (user_id, name, coordinates, area_m2, area_ft2, acres, hectares, perimeter_m)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)''',
            (farmer_id, name, json.dumps(coordinates), area_m2, area_ft2, acres, hectares, perimeter_m))
        row = db.execute('SELECT * FROM land_measurements WHERE id = ?', (cursor.lastrowid,)).fetchone()
    measurement = dict(row)
    measurement['coordinates'] = json.loads(measurement['coordinates'])
    measurement['userId'] = measurement.pop('user_id')
    return jsonify({'measurement': measurement}), 201

@app.delete('/api/measurements/<int:measurement_id>')
def delete_measurement(measurement_id):
    farmer_id, error = require_farmer()
    if error:
        return error
    with get_db() as db:
        row = db.execute('SELECT id FROM land_measurements WHERE id = ? AND user_id = ?', (measurement_id, farmer_id)).fetchone()
        if not row:
            return jsonify({'error': 'measurement_not_found'}), 404
        db.execute('DELETE FROM land_measurements WHERE id = ? AND user_id = ?', (measurement_id, farmer_id))
    return jsonify({'success': True})

@app.get('/api/agriverse/feed')
def agriverse_feed():
    viewer_id = current_farmer_id()
    kind = request.args.get('kind')
    query = 'SELECT * FROM posts'
    params = []
    if kind in ('post', 'reel', 'video'):
        query += ' WHERE kind = ?'
        params.append(kind)
    query += ' ORDER BY datetime(created_at) DESC, id DESC'
    with get_db() as db:
        posts = db.execute(query, params).fetchall()
        payload = [post_payload(db, post, viewer_id) for post in posts]
        farmers = db.execute('SELECT * FROM farmers ORDER BY created_at DESC LIMIT 8').fetchall()
    return jsonify({'posts': payload, 'farmers': [farmer_payload(farmer) for farmer in farmers]})

@app.get('/api/agriverse/profile/<farmer_id>')
def agriverse_profile(farmer_id):
    viewer_id = current_farmer_id()
    with get_db() as db:
        farmer = db.execute('SELECT * FROM farmers WHERE id = ?', (farmer_id,)).fetchone()
        if not farmer:
            return jsonify({'error': 'farmer_not_found'}), 404
        posts = db.execute('SELECT * FROM posts WHERE farmer_id = ? ORDER BY datetime(created_at) DESC, id DESC', (farmer_id,)).fetchall()
        followers = db.execute('SELECT COUNT(*) AS count FROM follows WHERE followed_id = ?', (farmer_id,)).fetchone()['count']
        following = db.execute('SELECT COUNT(*) AS count FROM follows WHERE follower_id = ?', (farmer_id,)).fetchone()['count']
        follow_requests = db.execute('SELECT COUNT(*) AS count FROM follow_requests WHERE target_id = ?', (farmer_id,)).fetchone()['count']
    return jsonify({'farmer': farmer_payload(farmer), 'followers': followers, 'following': following, 'follow_requests': follow_requests, 'posts': [post_payload(db, post, viewer_id) for post in posts]})

@app.get('/api/agriverse/relationships')
def agriverse_relationships():
    farmer_id, error = require_farmer()
    if error:
        return error
    with get_db() as db:
        followers = db.execute('''SELECT f.* FROM follows r JOIN farmers f ON f.id = r.follower_id
            WHERE r.followed_id = ? ORDER BY f.name COLLATE NOCASE''', (farmer_id,)).fetchall()
        following = db.execute('''SELECT f.* FROM follows r JOIN farmers f ON f.id = r.followed_id
            WHERE r.follower_id = ? ORDER BY f.name COLLATE NOCASE''', (farmer_id,)).fetchall()
        requests = db.execute('''SELECT f.*, r.created_at AS request_created_at FROM follow_requests r
            JOIN farmers f ON f.id = r.requester_id WHERE r.target_id = ?
            ORDER BY datetime(r.created_at) DESC''', (farmer_id,)).fetchall()
    return jsonify({
        'followers': [farmer_payload(row) for row in followers],
        'following': [farmer_payload(row) for row in following],
        'requests': [dict(farmer_payload(row), created_at=row['request_created_at']) for row in requests],
    })

@app.post('/api/agriverse/follow-requests/<requester_id>/<action>')
def agriverse_follow_request_action(requester_id, action):
    farmer_id, error = require_farmer()
    if error:
        return error
    if action not in ('accept', 'decline') or requester_id == farmer_id:
        return jsonify({'error': 'invalid_follow_request_action'}), 400
    with get_db() as db:
        pending = db.execute('SELECT 1 FROM follow_requests WHERE requester_id = ? AND target_id = ?', (requester_id, farmer_id)).fetchone()
        if not pending:
            return jsonify({'error': 'follow_request_not_found'}), 404
        if action == 'accept':
            db.execute('INSERT OR IGNORE INTO follows (follower_id, followed_id) VALUES (?, ?)', (requester_id, farmer_id))
            db.execute('INSERT INTO notifications (farmer_id, message) VALUES (?, ?)', (requester_id, 'Your AgriVerse follow request was accepted.'))
        db.execute('DELETE FROM follow_requests WHERE requester_id = ? AND target_id = ?', (requester_id, farmer_id))
    return jsonify({'success': True, 'accepted': action == 'accept'})

@app.post('/api/agriverse/posts')
def create_agriverse_post():
    farmer_id, error = require_farmer()
    if error:
        return error
    data = request.get_json(silent=True) or {}
    kind = data.get('kind', 'post')
    if kind not in ('post', 'reel', 'video'):
        return jsonify({'error': 'invalid_post_type'}), 400
    with get_db() as db:
        cursor = db.execute('''INSERT INTO posts (farmer_id, kind, caption, media_url, thumbnail_url, title, description, crop, category, language, tags)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''', (farmer_id, kind, data.get('caption', '').strip(), data.get('media_url', '').strip(), data.get('thumbnail_url', '').strip(), data.get('title', '').strip(), data.get('description', '').strip(), data.get('crop', '').strip(), data.get('category', '').strip(), data.get('language', '').strip(), data.get('tags', '').strip()))
        post = db.execute('SELECT * FROM posts WHERE id = ?', (cursor.lastrowid,)).fetchone()
    return jsonify({'post': post_payload(db, post, farmer_id)}), 201

@app.post('/api/agriverse/upload')
def upload_agriverse_video():
    farmer_id, error = require_farmer()
    if error:
        return error
    video = request.files.get('video')
    kind = request.form.get('kind', 'reel')
    if not video or video.filename == '' or kind not in ('reel', 'video'):
        return jsonify({'error': 'video_and_valid_kind_required'}), 400
    extension = os.path.splitext(secure_filename(video.filename))[1].lower() or '.mp4'
    filename = f'{secrets.token_urlsafe(18)}{extension}'
    path = os.path.join(UPLOAD_FOLDER, filename)
    video.save(path)
    media_url = f'/uploads/{filename}'
    data = request.form
    with get_db() as db:
        cursor = db.execute('''INSERT INTO posts (farmer_id, kind, caption, media_url, thumbnail_url, title, description, crop, category, language, tags)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''', (farmer_id, kind, data.get('caption', '').strip(), media_url, data.get('thumbnail_url', '').strip(), data.get('title', '').strip(), data.get('description', '').strip(), data.get('crop', '').strip(), data.get('category', '').strip(), data.get('language', '').strip(), data.get('tags', '').strip()))
        post = db.execute('SELECT * FROM posts WHERE id = ?', (cursor.lastrowid,)).fetchone()
    return jsonify({'post': post_payload(db, post, farmer_id)}), 201

def local_upload_path(media_url):
    """Resolve only files owned by the AgriVerse upload directory."""
    if not media_url or not str(media_url).startswith('/uploads/'):
        return None
    relative_name = str(media_url)[len('/uploads/'):]
    path = os.path.abspath(os.path.join(UPLOAD_FOLDER, relative_name))
    upload_root = os.path.abspath(UPLOAD_FOLDER)
    if os.path.commonpath([upload_root, path]) != upload_root:
        return None
    return path

def remove_post_files(posts):
    failed_files = []
    attempted = set()
    for post in posts:
        for field in ('media_url', 'thumbnail_url'):
            path = local_upload_path(post[field])
            if not path or path in attempted:
                continue
            attempted.add(path)
            if not os.path.exists(path):
                continue
            try:
                os.remove(path)
            except OSError as exc:
                failed_files.append({'post_id': post['id'], 'path': path, 'error': str(exc)})
    return failed_files

def remove_post_rows(db, posts):
    post_ids = [post['id'] for post in posts]
    if not post_ids:
        return
    placeholders = ','.join('?' for _ in post_ids)
    for table in ('likes', 'comments', 'saves'):
        db.execute(f'DELETE FROM {table} WHERE post_id IN ({placeholders})', post_ids)
    db.execute(f'DELETE FROM posts WHERE id IN ({placeholders}) AND farmer_id = ?', post_ids + [current_farmer_id()])

@app.post('/api/agriverse/posts/<int:post_id>/<action>')
def agriverse_action(post_id, action):
    farmer_id, error = require_farmer()
    if error:
        return error
    if action not in ('like', 'save', 'follow'):
        return jsonify({'error': 'invalid_action'}), 400
    with get_db() as db:
        post = db.execute('SELECT * FROM posts WHERE id = ?', (post_id,)).fetchone()
        if not post:
            return jsonify({'error': 'post_not_found'}), 404
        if action == 'follow':
            target_id = post['farmer_id']
            if target_id == farmer_id:
                return jsonify({'error': 'cannot_follow_self'}), 400
            existing = db.execute('SELECT 1 FROM follows WHERE follower_id = ? AND followed_id = ?', (farmer_id, target_id)).fetchone()
            pending = db.execute('SELECT 1 FROM follow_requests WHERE requester_id = ? AND target_id = ?', (farmer_id, target_id)).fetchone()
            if existing:
                db.execute('DELETE FROM follows WHERE follower_id = ? AND followed_id = ?', (farmer_id, target_id))
                return jsonify({'active': False, 'pending': False})
            if pending:
                db.execute('DELETE FROM follow_requests WHERE requester_id = ? AND target_id = ?', (farmer_id, target_id))
                return jsonify({'active': False, 'pending': False, 'cancelled': True})
            db.execute('INSERT INTO follow_requests (requester_id, target_id) VALUES (?, ?)', (farmer_id, target_id))
            db.execute('INSERT INTO notifications (farmer_id, message) VALUES (?, ?)', (target_id, 'A farmer sent you an AgriVerse follow request.'))
            return jsonify({'active': False, 'pending': True})
        else:
            table, columns = ('likes', '(post_id, farmer_id)') if action == 'like' else ('saves', '(post_id, farmer_id)')
            values = (post_id, farmer_id)
        existing = db.execute(f'SELECT 1 FROM {table} WHERE ' + ('follower_id = ? AND followed_id = ?' if action == 'follow' else 'post_id = ? AND farmer_id = ?'), values).fetchone()
        if existing:
            db.execute(f'DELETE FROM {table} WHERE ' + ('follower_id = ? AND followed_id = ?' if action == 'follow' else 'post_id = ? AND farmer_id = ?'), values)
            active = False
        else:
            db.execute(f'INSERT INTO {table} {columns} VALUES (?, ?)', values)
            active = True
            target_id = post['farmer_id']
            if target_id != farmer_id:
                labels = {'like': 'liked', 'save': 'saved'}
                db.execute('INSERT INTO notifications (farmer_id, message) VALUES (?, ?)', (target_id, f'A farmer {labels[action]} your AgriVerse activity.'))
    return jsonify({'active': active})

@app.post('/api/agriverse/posts/<int:post_id>/comments')
def add_comment(post_id):
    farmer_id, error = require_farmer()
    if error:
        return error
    body = ((request.get_json(silent=True) or {}).get('body') or '').strip()
    if not body:
        return jsonify({'error': 'comment_required'}), 400
    with get_db() as db:
        post = db.execute('SELECT * FROM posts WHERE id = ?', (post_id,)).fetchone()
        if not post:
            return jsonify({'error': 'post_not_found'}), 404
        db.execute('INSERT INTO comments (post_id, farmer_id, body) VALUES (?, ?, ?)', (post_id, farmer_id, body))
        if post['farmer_id'] != farmer_id:
            db.execute('INSERT INTO notifications (farmer_id, message) VALUES (?, ?)', (post['farmer_id'], 'A farmer commented on your field note.'))
    return jsonify({'success': True}), 201

@app.get('/api/agriverse/posts/<int:post_id>/comments')
def get_comments(post_id):
    with get_db() as db:
        rows = db.execute('''SELECT comments.body, comments.created_at, farmers.name, farmers.username
            FROM comments JOIN farmers ON farmers.id = comments.farmer_id
            WHERE comments.post_id = ? ORDER BY comments.id ASC''', (post_id,)).fetchall()
    return jsonify({'comments': [dict(row) for row in rows]})

@app.get('/api/agriverse/notifications')
def get_notifications():
    farmer_id, error = require_farmer()
    if error:
        return error
    with get_db() as db:
        rows = db.execute('SELECT id, message, read, created_at FROM notifications WHERE farmer_id = ? ORDER BY id DESC', (farmer_id,)).fetchall()
    return jsonify({'notifications': [dict(row) for row in rows]})

@app.delete('/api/agriverse/posts/<int:post_id>')
def delete_agriverse_post(post_id):
    farmer_id, error = require_farmer()
    if error:
        return error
    with get_db() as db:
        post = db.execute('SELECT * FROM posts WHERE id = ?', (post_id,)).fetchone()
        if not post:
            return jsonify({'error': 'post_not_found'}), 404
        if post['farmer_id'] != farmer_id:
            return jsonify({'error': 'unauthorized'}), 403
        failed_files = remove_post_files([post])
        if failed_files:
            return jsonify({'error': 'storage_delete_failed', 'failed_files': failed_files}), 500
        remove_post_rows(db, [post])
    return jsonify({'success': True, 'deleted_count': 1})

@app.post('/api/agriverse/content/bulk-delete')
def bulk_delete_agriverse_content():
    farmer_id, error = require_farmer()
    if error:
        return error
    data = request.get_json(silent=True) or {}
    requested_ids = data.get('ids') or []
    scope = data.get('scope', 'selected')
    if scope not in ('selected', 'reels', 'videos', 'all'):
        return jsonify({'error': 'invalid_delete_scope'}), 400
    try:
        requested_ids = [int(post_id) for post_id in requested_ids]
    except (TypeError, ValueError):
        return jsonify({'error': 'invalid_content_ids'}), 400

    with get_db() as db:
        query = 'SELECT * FROM posts WHERE farmer_id = ? AND kind IN (?, ?)'
        params = [farmer_id, 'reel', 'video']
        if scope == 'selected':
            if not requested_ids:
                return jsonify({'error': 'no_content_selected'}), 400
            placeholders = ','.join('?' for _ in requested_ids)
            query += f' AND id IN ({placeholders})'
            params.extend(requested_ids)
        elif scope == 'reels':
            query += ' AND kind = ?'
            params.append('reel')
        elif scope == 'videos':
            query += ' AND kind = ?'
            params.append('video')
        posts = db.execute(query, params).fetchall()
        failed_files = remove_post_files(posts)
        if failed_files:
            return jsonify({'error': 'storage_delete_failed', 'failed_files': failed_files}), 500
        remove_post_rows(db, posts)
        counts = {'reels': sum(post['kind'] == 'reel' for post in posts), 'videos': sum(post['kind'] == 'video' for post in posts)}
    return jsonify({'success': True, 'deleted_count': len(posts), 'counts': counts})

@app.get('/api/agriverse/conversations')
def get_conversations():
    farmer_id, error = require_farmer()
    if error:
        return error
    with get_db() as db:
        rows = db.execute('SELECT * FROM conversations WHERE user1_id = ? OR user2_id = ? ORDER BY updated_at DESC', (farmer_id, farmer_id)).fetchall()
        result = []
        for row in rows:
            other_id = row['user1_id'] if row['user2_id'] == farmer_id else row['user2_id']
            other_user = db.execute('SELECT * FROM farmers WHERE id = ?', (other_id,)).fetchone()
            last_message = db.execute('SELECT body, created_at FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1', (row['id'],)).fetchone()
            result.append({
                'id': row['id'],
                'other_user': farmer_payload(other_user),
                'updated_at': row['updated_at'],
                'last_message': last_message['body'] if last_message else ''
            })
    return jsonify({'conversations': result})

@app.post('/api/agriverse/conversations/start')
def start_conversation():
    farmer_id, error = require_farmer()
    if error:
        return error
    target_id = (request.get_json(silent=True) or {}).get('target_id')
    if not target_id or target_id == farmer_id:
        return jsonify({'error': 'invalid_target'}), 400
    with get_db() as db:
        conv = db.execute('SELECT id FROM conversations WHERE (user1_id = ? AND user2_id = ?) OR (user1_id = ? AND user2_id = ?)', (farmer_id, target_id, target_id, farmer_id)).fetchone()
        if not conv:
            cursor = db.execute('INSERT INTO conversations (user1_id, user2_id) VALUES (?, ?)', (farmer_id, target_id))
            conv_id = cursor.lastrowid
        else:
            conv_id = conv['id']
    return jsonify({'conversation_id': conv_id})

@app.get('/api/agriverse/conversations/<int:conv_id>/messages')
def get_messages(conv_id):
    farmer_id, error = require_farmer()
    if error:
        return error
    with get_db() as db:
        conv = db.execute('SELECT * FROM conversations WHERE id = ?', (conv_id,)).fetchone()
        if not conv or (conv['user1_id'] != farmer_id and conv['user2_id'] != farmer_id):
            return jsonify({'error': 'unauthorized'}), 403
        rows = db.execute('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id ASC', (conv_id,)).fetchall()
    return jsonify({'messages': [dict(row) for row in rows]})

@app.post('/api/agriverse/conversations/<int:conv_id>/messages')
def send_message(conv_id):
    farmer_id, error = require_farmer()
    if error:
        return error
    body = (request.get_json(silent=True) or {}).get('body')
    if not body:
        return jsonify({'error': 'message_required'}), 400
    with get_db() as db:
        conv = db.execute('SELECT * FROM conversations WHERE id = ?', (conv_id,)).fetchone()
        if not conv or (conv['user1_id'] != farmer_id and conv['user2_id'] != farmer_id):
            return jsonify({'error': 'unauthorized'}), 403
        
        db.execute('INSERT INTO messages (conversation_id, sender_id, body) VALUES (?, ?, ?)', (conv_id, farmer_id, body))
        db.execute('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', (conv_id,))
        target_id = conv['user1_id'] if conv['user2_id'] == farmer_id else conv['user2_id']
        db.execute('INSERT INTO notifications (farmer_id, message) VALUES (?, ?)', (target_id, 'You have a new message.'))
    return jsonify({'success': True})

# ---------------- API: Farmer marketplace ----------------
def marketplace_product_payload(db, row):
    product = dict(row)
    images = db.execute('SELECT image_url FROM product_images WHERE product_id = ? ORDER BY id', (row['id'],)).fetchall()
    farmer = db.execute('SELECT id, name, phone, username FROM farmers WHERE id = ?', (row['owner_id'],)).fetchone()
    profile = db.execute('SELECT village, district, state, farm_name, verification_status FROM farmer_profiles WHERE user_id = ?', (row['owner_id'],)).fetchone()
    product['images'] = [item['image_url'] for item in images]
    product['organic'] = bool(product['organic'])
    product['farmer'] = dict(farmer) if farmer else None
    product['farmer_profile'] = dict(profile) if profile else None
    product['reviews'] = [dict(review) for review in db.execute('''SELECT r.rating, r.body, r.created_at, f.name AS reviewer_name
        FROM reviews r JOIN farmers f ON f.id = r.reviewer_id WHERE r.product_id = ? ORDER BY r.id DESC LIMIT 20''', (row['id'],)).fetchall()]
    return product

def ensure_buyer(db, user_id):
    db.execute('INSERT OR IGNORE INTO carts (buyer_id) VALUES (?)', (user_id,))

@app.post('/api/marketplace/become-seller')
def become_seller():
    user_id, error = require_farmer()
    if error:
        return error
    data = request.get_json(silent=True) or {}
    with get_db() as db:
        db.execute('UPDATE farmers SET role = ? WHERE id = ?', ('seller', user_id))
        db.execute('''INSERT INTO farmer_profiles (user_id, village, district, state, farm_name, about)
            VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET village=excluded.village, district=excluded.district,
            state=excluded.state, farm_name=excluded.farm_name, about=excluded.about''',
            (user_id, str(data.get('village') or '').strip()[:120], str(data.get('district') or '').strip()[:120],
             str(data.get('state') or '').strip()[:120], str(data.get('farm_name') or '').strip()[:160], str(data.get('about') or '').strip()[:2000]))
        profile = db.execute('SELECT * FROM farmer_profiles WHERE user_id = ?', (user_id,)).fetchone()
    return jsonify({'profile': dict(profile), 'verification_status': profile['verification_status']}), 201

@app.route('/api/marketplace/farmer-profile/<farmer_id>', methods=['GET', 'PUT'])
def marketplace_farmer_profile(farmer_id):
    viewer_id = current_farmer_id()
    if request.method == 'PUT' and viewer_id != farmer_id:
        return jsonify({'error': 'unauthorized'}), 403
    with get_db() as db:
        farmer = db.execute('SELECT id, name, phone, username, role FROM farmers WHERE id = ? AND blocked = 0', (farmer_id,)).fetchone()
        if not farmer:
            return jsonify({'error': 'farmer_not_found'}), 404
        if request.method == 'PUT':
            data = request.get_json(silent=True) or {}
            fields = ('village', 'district', 'state', 'farm_name', 'about')
            values = [str(data.get(field) or '').strip()[:200] for field in fields]
            db.execute('''INSERT INTO farmer_profiles (user_id, village, district, state, farm_name, about)
                VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET village=excluded.village, district=excluded.district,
                state=excluded.state, farm_name=excluded.farm_name, about=excluded.about''', (farmer_id, *values))
        profile = db.execute('SELECT * FROM farmer_profiles WHERE user_id = ?', (farmer_id,)).fetchone()
        products = db.execute('SELECT * FROM products WHERE owner_id = ? AND status != \'deleted\' ORDER BY id DESC', (farmer_id,)).fetchall()
        completed = db.execute('SELECT COUNT(*) AS count FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.seller_id = ? AND o.status = \'delivered\'', (farmer_id,)).fetchone()['count']
    return jsonify({'farmer': dict(farmer), 'profile': dict(profile) if profile else None, 'products': [marketplace_product_payload(db, item) for item in products], 'completed_orders': completed})

@app.get('/api/marketplace/products')
def marketplace_products():
    query = (request.args.get('q') or '').strip()
    category = (request.args.get('category') or '').strip()
    product_type = (request.args.get('product_type') or '').strip()
    location = (request.args.get('location') or '').strip()
    organic = request.args.get('organic')
    sort = request.args.get('sort', 'latest')
    clauses = ["p.status = 'available'", 'p.quantity > 0']
    params = []
    if query:
        clauses.append('(p.name LIKE ? OR p.description LIKE ? OR p.category LIKE ?)')
        params.extend([f'%{query}%', f'%{query}%', f'%{query}%'])
    if category:
        clauses.append('p.category = ?'); params.append(category)
    if product_type:
        clauses.append('p.product_type = ?'); params.append(product_type)
    if location:
        clauses.append('(p.village LIKE ? OR fp.district LIKE ? OR fp.state LIKE ?)')
        params.extend([f'%{location}%', f'%{location}%', f'%{location}%'])
    if organic in ('1', 'true'):
        clauses.append('p.organic = 1')
    try:
        if request.args.get('min_price') is not None:
            clauses.append('p.price >= ?'); params.append(float(request.args['min_price']))
        if request.args.get('max_price') is not None:
            clauses.append('p.price <= ?'); params.append(float(request.args['max_price']))
    except ValueError:
        return jsonify({'error': 'invalid_price_filter'}), 400
    order = {'price_asc': 'p.price ASC', 'price_desc': 'p.price DESC', 'rating': 'p.rating DESC, p.review_count DESC', 'latest': 'p.created_at DESC'}.get(sort, 'p.created_at DESC')
    with get_db() as db:
        rows = db.execute(f'''SELECT p.* FROM products p LEFT JOIN farmer_profiles fp ON fp.user_id = p.owner_id
            WHERE {' AND '.join(clauses)} ORDER BY {order}, p.id DESC LIMIT 100''', params).fetchall()
        products = [marketplace_product_payload(db, row) for row in rows]
    return jsonify({'products': products, 'count': len(products)})

@app.route('/api/marketplace/products', methods=['POST'])
def create_marketplace_product():
    user_id, error = require_farmer()
    if error:
        return error
    data = request.get_json(silent=True) or {}
    product, validation_error = parse_product(data)
    if validation_error:
        return jsonify({'error': validation_error}), 400
    with get_db() as db:
        role = db.execute('SELECT role FROM farmers WHERE id = ?', (user_id,)).fetchone()['role']
        if role not in ('seller', 'admin'):
            return jsonify({'error': 'seller_profile_required'}), 403
        cursor = db.execute('''INSERT INTO products (owner_id, name, category, product_type, description, price, unit, quantity,
            min_order_quantity, organic, harvest_date, delivery_time, village, farm_location, quality_details)
            VALUES (:owner_id, :name, :category, :product_type, :description, :price, :unit, :quantity, :min_order_quantity,
            :organic, :harvest_date, :delivery_time, :village, :farm_location, :quality_details)''', {**product, 'owner_id': user_id})
        product_id = cursor.lastrowid
        for image in data.get('images') or []:
            if isinstance(image, str) and image.startswith(('/uploads/', 'https://', 'http://')):
                db.execute('INSERT INTO product_images (product_id, image_url) VALUES (?, ?)', (product_id, image[:500]))
        db.execute('INSERT INTO notifications (farmer_id, message) VALUES (?, ?)', (user_id, 'Product listed successfully.'))
        row = db.execute('SELECT * FROM products WHERE id = ?', (product_id,)).fetchone()
    return jsonify({'product': marketplace_product_payload(db, row)}), 201

@app.route('/api/marketplace/products/<int:product_id>', methods=['GET', 'PUT', 'DELETE'])
def marketplace_product(product_id):
    user_id = current_farmer_id()
    with get_db() as db:
        row = db.execute('SELECT * FROM products WHERE id = ?', (product_id,)).fetchone()
        if not row:
            return jsonify({'error': 'product_not_found'}), 404
        if request.method == 'GET':
            return jsonify({'product': marketplace_product_payload(db, row)})
        if not user_id:
            return jsonify({'error': 'authentication_required'}), 401
        if row['owner_id'] != user_id:
            return jsonify({'error': 'product_owner_required'}), 403
        if request.method == 'DELETE':
            db.execute("UPDATE products SET status = 'deleted', updated_at = CURRENT_TIMESTAMP WHERE id = ?", (product_id,))
            return jsonify({'success': True})
        data = request.get_json(silent=True) or {}
        product, validation_error = parse_product({**dict(row), **data})
        if validation_error:
            return jsonify({'error': validation_error}), 400
        db.execute('''UPDATE products SET name=:name, category=:category, product_type=:product_type, description=:description,
            price=:price, unit=:unit, quantity=:quantity, min_order_quantity=:min_order_quantity, organic=:organic,
            harvest_date=:harvest_date, delivery_time=:delivery_time, village=:village, farm_location=:farm_location,
            quality_details=:quality_details, status=:status, updated_at=CURRENT_TIMESTAMP WHERE id=:id''',
            {**product, 'status': data.get('status', row['status']), 'id': product_id})
        updated = db.execute('SELECT * FROM products WHERE id = ?', (product_id,)).fetchone()
    return jsonify({'product': marketplace_product_payload(db, updated)})

@app.get('/api/marketplace/wishlist')
def marketplace_wishlist():
    user_id, error = require_farmer()
    if error:
        return error
    with get_db() as db:
        rows = db.execute('''SELECT p.* FROM wishlists w JOIN products p ON p.id=w.product_id
            WHERE w.buyer_id=? AND p.status != 'deleted' ORDER BY w.created_at DESC''', (user_id,)).fetchall()
        products = [marketplace_product_payload(db, row) for row in rows]
    return jsonify({'products': products})

@app.post('/api/marketplace/wishlist/<int:product_id>')
def toggle_marketplace_wishlist(product_id):
    user_id, error = require_farmer()
    if error:
        return error
    with get_db() as db:
        if not db.execute('SELECT 1 FROM products WHERE id=? AND status != \'deleted\'', (product_id,)).fetchone():
            return jsonify({'error': 'product_not_found'}), 404
        existing = db.execute('SELECT 1 FROM wishlists WHERE buyer_id=? AND product_id=?', (user_id, product_id)).fetchone()
        if existing:
            db.execute('DELETE FROM wishlists WHERE buyer_id=? AND product_id=?', (user_id, product_id))
            active = False
        else:
            db.execute('INSERT INTO wishlists (buyer_id, product_id) VALUES (?, ?)', (user_id, product_id))
            active = True
    return jsonify({'active': active})

@app.post('/api/marketplace/products/<int:product_id>/reviews')
def create_marketplace_review(product_id):
    user_id, error = require_farmer()
    if error:
        return error
    data = request.get_json(silent=True) or {}
    try:
        rating = int(data.get('rating'))
    except (TypeError, ValueError):
        return jsonify({'error': 'rating_required'}), 400
    body = str(data.get('body') or '').strip()[:1000]
    if rating < 1 or rating > 5:
        return jsonify({'error': 'rating_must_be_between_1_and_5'}), 400
    with get_db() as db:
        delivered = db.execute('''SELECT oi.order_id FROM order_items oi JOIN orders o ON o.id=oi.order_id
            WHERE oi.product_id=? AND o.buyer_id=? AND o.status='delivered' LIMIT 1''', (product_id, user_id)).fetchone()
        if not delivered:
            return jsonify({'error': 'review_requires_delivered_order'}), 403
        try:
            db.execute('INSERT INTO reviews (product_id, order_id, reviewer_id, rating, body) VALUES (?, ?, ?, ?, ?)', (product_id, delivered['order_id'], user_id, rating, body))
        except sqlite3.IntegrityError:
            return jsonify({'error': 'review_already_submitted'}), 409
        aggregate = db.execute('SELECT AVG(rating) AS rating, COUNT(*) AS count FROM reviews WHERE product_id=?', (product_id,)).fetchone()
        db.execute('UPDATE products SET rating=?, review_count=? WHERE id=?', (round(aggregate['rating'] or 0, 2), aggregate['count'], product_id))
    return jsonify({'success': True}), 201

@app.get('/api/marketplace/cart')
def get_marketplace_cart():
    user_id, error = require_farmer()
    if error:
        return error
    with get_db() as db:
        ensure_buyer(db, user_id)
        rows = db.execute('''SELECT ci.product_id, ci.quantity, p.* FROM cart_items ci JOIN carts c ON c.id = ci.cart_id
            JOIN products p ON p.id = ci.product_id WHERE c.buyer_id = ? AND p.status != 'deleted' ORDER BY ci.rowid''', (user_id,)).fetchall()
        items = []
        for row in rows:
            item = marketplace_product_payload(db, row); item['cart_quantity'] = row['quantity']; items.append(item)
    subtotal = round(sum(item['price'] * item['cart_quantity'] for item in items), 2)
    delivery_charge = 0 if subtotal >= 500 or subtotal == 0 else 50
    tax = round(subtotal * 0.05, 2)
    return jsonify({'items': items, 'subtotal': subtotal, 'delivery_charge': delivery_charge, 'tax': tax, 'total': round(subtotal + delivery_charge + tax, 2)})

@app.post('/api/marketplace/cart/items')
def add_marketplace_cart_item():
    user_id, error = require_farmer()
    if error:
        return error
    data = request.get_json(silent=True) or {}
    try:
        product_id, quantity = int(data.get('product_id')), float(data.get('quantity'))
    except (TypeError, ValueError):
        return jsonify({'error': 'valid_product_and_quantity_required'}), 400
    with get_db() as db:
        product = db.execute("SELECT * FROM products WHERE id = ? AND status = 'available'", (product_id,)).fetchone()
        if not product or quantity <= 0 or quantity < product['min_order_quantity']:
            return jsonify({'error': 'invalid_product_or_minimum_quantity'}), 400
        ensure_buyer(db, user_id)
        cart = db.execute('SELECT id FROM carts WHERE buyer_id = ?', (user_id,)).fetchone()
        existing = db.execute('SELECT quantity FROM cart_items WHERE cart_id = ? AND product_id = ?', (cart['id'], product_id)).fetchone()
        next_quantity = quantity + (existing['quantity'] if existing else 0)
        if next_quantity > product['quantity']:
            return jsonify({'error': 'insufficient_stock', 'available': product['quantity']}), 409
        db.execute('INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (?, ?, ?) ON CONFLICT(cart_id, product_id) DO UPDATE SET quantity=excluded.quantity', (cart['id'], product_id, next_quantity))
    return jsonify({'success': True}), 201

@app.patch('/api/marketplace/cart/items/<int:product_id>')
def update_marketplace_cart_item(product_id):
    user_id, error = require_farmer()
    if error:
        return error
    try:
        quantity = float((request.get_json(silent=True) or {}).get('quantity'))
    except (TypeError, ValueError):
        return jsonify({'error': 'valid_quantity_required'}), 400
    with get_db() as db:
        row = db.execute('''SELECT ci.cart_id, p.quantity AS stock FROM cart_items ci JOIN carts c ON c.id=ci.cart_id JOIN products p ON p.id=ci.product_id
            WHERE c.buyer_id=? AND ci.product_id=?''', (user_id, product_id)).fetchone()
        if not row:
            return jsonify({'error': 'cart_item_not_found'}), 404
        if quantity <= 0:
            db.execute('DELETE FROM cart_items WHERE cart_id=? AND product_id=?', (row['cart_id'], product_id))
        elif quantity > row['stock']:
            return jsonify({'error': 'insufficient_stock', 'available': row['stock']}), 409
        else:
            db.execute('UPDATE cart_items SET quantity=? WHERE cart_id=? AND product_id=?', (quantity, row['cart_id'], product_id))
    return jsonify({'success': True})

@app.delete('/api/marketplace/cart/items/<int:product_id>')
def delete_marketplace_cart_item(product_id):
    user_id, error = require_farmer()
    if error:
        return error
    with get_db() as db:
        db.execute('DELETE FROM cart_items WHERE cart_id IN (SELECT id FROM carts WHERE buyer_id=?) AND product_id=?', (user_id, product_id))
    return jsonify({'success': True})

@app.post('/api/marketplace/addresses')
def create_marketplace_address():
    user_id, error = require_farmer()
    if error:
        return error
    data = request.get_json(silent=True) or {}
    fields = ('recipient_name', 'phone', 'line1', 'state', 'postal_code')
    if any(not str(data.get(field) or '').strip() for field in fields):
        return jsonify({'error': 'address_required_fields_missing'}), 400
    with get_db() as db:
        if data.get('is_default'):
            db.execute('UPDATE addresses SET is_default=0 WHERE user_id=?', (user_id,))
        cursor = db.execute('''INSERT INTO addresses (user_id, label, recipient_name, phone, line1, village, district, state, postal_code, is_default)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''', (user_id, str(data.get('label') or 'Home')[:40], str(data['recipient_name']).strip()[:120], str(data['phone']).strip()[:20], str(data['line1']).strip()[:300], str(data.get('village') or '').strip()[:120], str(data.get('district') or '').strip()[:120], str(data['state']).strip()[:120], str(data['postal_code']).strip()[:12], 1 if data.get('is_default') else 0))
        address = db.execute('SELECT * FROM addresses WHERE id=?', (cursor.lastrowid,)).fetchone()
    return jsonify({'address': dict(address)}), 201

@app.get('/api/marketplace/addresses')
def list_marketplace_addresses():
    user_id, error = require_farmer()
    if error:
        return error
    with get_db() as db:
        addresses = db.execute('SELECT * FROM addresses WHERE user_id=? ORDER BY is_default DESC, id DESC', (user_id,)).fetchall()
    return jsonify({'addresses': [dict(address) for address in addresses]})

@app.post('/api/marketplace/checkout')
def marketplace_checkout():
    user_id, error = require_farmer()
    if error:
        return error
    data = request.get_json(silent=True) or {}
    try:
        address_id = int(data.get('address_id'))
    except (TypeError, ValueError):
        return jsonify({'error': 'address_required'}), 400
    with get_db() as db:
        db.execute('BEGIN IMMEDIATE')
        address = db.execute('SELECT * FROM addresses WHERE id=? AND user_id=?', (address_id, user_id)).fetchone()
        cart = db.execute('SELECT id FROM carts WHERE buyer_id=?', (user_id,)).fetchone()
        if not address or not cart:
            return jsonify({'error': 'address_or_cart_not_found'}), 400
        cart_items = db.execute('''SELECT ci.product_id, ci.quantity, p.* FROM cart_items ci JOIN products p ON p.id=ci.product_id
            WHERE ci.cart_id=? AND p.status='available' ORDER BY ci.product_id''', (cart['id'],)).fetchall()
        if not cart_items:
            return jsonify({'error': 'cart_empty'}), 400
        subtotal = 0
        for item in cart_items:
            locked = db.execute("SELECT quantity, min_order_quantity, price, name, unit, owner_id FROM products WHERE id=? AND status='available'", (item['product_id'],)).fetchone()
            if not locked or item['quantity'] > locked['quantity'] or item['quantity'] < locked['min_order_quantity']:
                return jsonify({'error': 'stock_changed', 'product_id': item['product_id']}), 409
            subtotal += locked['price'] * item['quantity']
        delivery_charge = 0 if subtotal >= 500 else 50
        tax = round(subtotal * 0.05, 2)
        total = round(subtotal + delivery_charge + tax, 2)
        order_number = f'SF-{secrets.token_hex(5).upper()}'
        cursor = db.execute('''INSERT INTO orders (order_number, buyer_id, address_id, subtotal, delivery_charge, tax, total, payment_status, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)''', (order_number, user_id, address_id, subtotal, delivery_charge, tax, total, 'pending', 'placed'))
        order_id = cursor.lastrowid
        for item in cart_items:
            locked = db.execute('SELECT quantity, price, name, unit, owner_id FROM products WHERE id=?', (item['product_id'],)).fetchone()
            db.execute('UPDATE products SET quantity=quantity-?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND quantity>=?', (item['quantity'], item['product_id'], item['quantity']))
            db.execute('''INSERT INTO order_items (order_id, product_id, seller_id, product_name, unit, quantity, unit_price, line_total)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)''', (order_id, item['product_id'], locked['owner_id'], locked['name'], locked['unit'], item['quantity'], locked['price'], locked['price'] * item['quantity']))
            db.execute('INSERT INTO notifications (farmer_id, message) VALUES (?, ?)', (locked['owner_id'], f'New order received: {order_number}.'))
        db.execute('INSERT INTO payments (order_id, provider, status, amount) VALUES (?, ?, ?, ?)', (order_id, str(data.get('payment_method') or 'cod')[:30], 'pending', total))
        db.execute('INSERT INTO delivery_assignments (order_id, status) VALUES (?, ?)', (order_id, 'searching'))
        db.execute('DELETE FROM cart_items WHERE cart_id=?', (cart['id'],))
        order = db.execute('SELECT * FROM orders WHERE id=?', (order_id,)).fetchone()
    return jsonify({'order': dict(order)}), 201

@app.get('/api/marketplace/orders')
def marketplace_orders():
    user_id, error = require_farmer()
    if error:
        return error
    with get_db() as db:
        orders = db.execute('SELECT * FROM orders WHERE buyer_id=? ORDER BY id DESC', (user_id,)).fetchall()
        result = []
        for order in orders:
            payload = dict(order)
            payload['items'] = [dict(item) for item in db.execute('SELECT * FROM order_items WHERE order_id=?', (order['id'],)).fetchall()]
            delivery = db.execute('''SELECT da.*, f.name AS partner_name, f.phone AS partner_phone,
                dpp.vehicle_type, dpp.vehicle_number FROM delivery_assignments da
                LEFT JOIN farmers f ON f.id=da.partner_id LEFT JOIN delivery_partner_profiles dpp ON dpp.user_id=da.partner_id
                WHERE da.order_id=?''', (order['id'],)).fetchone()
            payload['delivery'] = dict(delivery) if delivery else None
            result.append(payload)
    return jsonify({'orders': result})

@app.patch('/api/marketplace/orders/<int:order_id>/cancel')
def cancel_marketplace_order(order_id):
    user_id, error = require_farmer()
    if error:
        return error
    with get_db() as db:
        db.execute('BEGIN IMMEDIATE')
        order = db.execute('SELECT * FROM orders WHERE id=? AND buyer_id=?', (order_id, user_id)).fetchone()
        if not order:
            return jsonify({'error': 'order_not_found'}), 404
        if order['status'] not in ('placed', 'confirmed'):
            return jsonify({'error': 'order_cannot_be_cancelled'}), 409
        items = db.execute('SELECT product_id, quantity, seller_id FROM order_items WHERE order_id=?', (order_id,)).fetchall()
        for item in items:
            db.execute('UPDATE products SET quantity=quantity+?, updated_at=CURRENT_TIMESTAMP WHERE id=?', (item['quantity'], item['product_id']))
            db.execute('INSERT INTO notifications (farmer_id, message) VALUES (?, ?)', (item['seller_id'], f'Order {order["order_number"]} was cancelled by the buyer.'))
        db.execute("UPDATE orders SET status='cancelled', updated_at=CURRENT_TIMESTAMP WHERE id=?", (order_id,))
        db.execute("UPDATE delivery_assignments SET status='cancelled' WHERE order_id=?", (order_id,))
    return jsonify({'success': True, 'status': 'cancelled'})

@app.post('/api/marketplace/delivery-partner')
def create_delivery_partner_profile():
    user_id, error = require_farmer()
    if error:
        return error
    data = request.get_json(silent=True) or {}
    if not str(data.get('vehicle_type') or '').strip() or not str(data.get('service_area') or '').strip():
        return jsonify({'error': 'vehicle_and_service_area_required'}), 400
    with get_db() as db:
        db.execute('UPDATE farmers SET role = ? WHERE id = ?', ('delivery_partner', user_id))
        db.execute('''INSERT INTO delivery_partner_profiles (user_id, vehicle_type, vehicle_number, service_area)
            VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET vehicle_type=excluded.vehicle_type,
            vehicle_number=excluded.vehicle_number, service_area=excluded.service_area''',
            (user_id, str(data['vehicle_type']).strip()[:50], str(data.get('vehicle_number') or '').strip()[:30], str(data['service_area']).strip()[:200]))
        profile = db.execute('SELECT * FROM delivery_partner_profiles WHERE user_id=?', (user_id,)).fetchone()
    return jsonify({'profile': dict(profile)}), 201

@app.patch('/api/marketplace/delivery-partner')
def update_delivery_partner_profile():
    user_id, error = require_farmer()
    if error:
        return error
    data = request.get_json(silent=True) or {}
    availability = data.get('availability_status')
    if availability not in ('available', 'offline', 'busy'):
        return jsonify({'error': 'invalid_availability_status'}), 400
    with get_db() as db:
        profile = db.execute('SELECT * FROM delivery_partner_profiles WHERE user_id=?', (user_id,)).fetchone()
        if not profile:
            return jsonify({'error': 'delivery_partner_profile_required'}), 404
        db.execute('UPDATE delivery_partner_profiles SET availability_status=? WHERE user_id=?', (availability, user_id))
    return jsonify({'success': True, 'availability_status': availability})

@app.get('/api/marketplace/delivery/requests')
def delivery_requests():
    user_id, error = require_farmer()
    if error:
        return error
    with get_db() as db:
        profile = db.execute('SELECT verification_status, availability_status FROM delivery_partner_profiles WHERE user_id=?', (user_id,)).fetchone()
        if not profile or profile['verification_status'] != 'approved':
            return jsonify({'error': 'verified_delivery_partner_required'}), 403
        rows = db.execute('''SELECT da.*, o.order_number, o.status AS order_status, a.line1, a.district, a.state
            FROM delivery_assignments da JOIN orders o ON o.id=da.order_id JOIN addresses a ON a.id=o.address_id
            WHERE da.status='searching' OR da.partner_id=? ORDER BY da.id DESC''', (user_id,)).fetchall()
    return jsonify({'requests': [dict(row) for row in rows]})

@app.post('/api/marketplace/delivery/assignments/<int:assignment_id>/accept')
def accept_delivery_assignment(assignment_id):
    user_id, error = require_farmer()
    if error:
        return error
    with get_db() as db:
        profile = db.execute('SELECT verification_status, availability_status FROM delivery_partner_profiles WHERE user_id=?', (user_id,)).fetchone()
        if not profile or profile['verification_status'] != 'approved' or profile['availability_status'] != 'available':
            return jsonify({'error': 'available_verified_partner_required'}), 403
        db.execute('BEGIN IMMEDIATE')
        cursor = db.execute("UPDATE delivery_assignments SET partner_id=?, status='assigned', assigned_at=CURRENT_TIMESTAMP WHERE id=? AND status='searching' AND partner_id IS NULL", (user_id, assignment_id))
        if cursor.rowcount != 1:
            return jsonify({'error': 'assignment_already_taken'}), 409
        assignment = db.execute('SELECT order_id FROM delivery_assignments WHERE id=?', (assignment_id,)).fetchone()
        db.execute("UPDATE orders SET status='assigned', updated_at=CURRENT_TIMESTAMP WHERE id=? AND status NOT IN ('cancelled','delivered')", (assignment['order_id'],))
    return jsonify({'success': True})

@app.patch('/api/marketplace/delivery/assignments/<int:assignment_id>/status')
def update_delivery_status(assignment_id):
    user_id, error = require_farmer()
    if error:
        return error
    status = (request.get_json(silent=True) or {}).get('status')
    allowed = {'picked_up': 'picked_up', 'in_transit': 'in_transit', 'near_delivery': 'near_delivery', 'delivered': 'delivered'}
    if status not in allowed:
        return jsonify({'error': 'invalid_delivery_status'}), 400
    with get_db() as db:
        assignment = db.execute('SELECT * FROM delivery_assignments WHERE id=? AND partner_id=?', (assignment_id, user_id)).fetchone()
        if not assignment:
            return jsonify({'error': 'assigned_partner_required'}), 403
        db.execute('UPDATE delivery_assignments SET status=?, completed_at=CASE WHEN ?=\'delivered\' THEN CURRENT_TIMESTAMP ELSE completed_at END WHERE id=?', (status, status, assignment_id))
        db.execute('UPDATE orders SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?', (status, assignment['order_id']))
        db.execute('INSERT INTO notifications (farmer_id, message) SELECT buyer_id, ? FROM orders WHERE id=?', (f'Order delivery status updated: {status}.', assignment['order_id']))
        if status == 'delivered':
            db.execute('UPDATE delivery_partner_profiles SET completed_deliveries=completed_deliveries+1, availability_status=\'available\' WHERE user_id=?', (user_id,))
    return jsonify({'success': True, 'status': status})

@app.post('/api/marketplace/delivery/assignments/<int:assignment_id>/location')
def update_delivery_location(assignment_id):
    user_id, error = require_farmer()
    if error:
        return error
    data = request.get_json(silent=True) or {}
    try:
        latitude, longitude = float(data.get('latitude')), float(data.get('longitude'))
    except (TypeError, ValueError):
        return jsonify({'error': 'valid_coordinates_required'}), 400
    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        return jsonify({'error': 'coordinates_out_of_range'}), 400
    with get_db() as db:
        assignment = db.execute("SELECT id FROM delivery_assignments WHERE id=? AND partner_id=? AND status NOT IN ('delivered','cancelled')", (assignment_id, user_id)).fetchone()
        if not assignment:
            return jsonify({'error': 'active_assignment_required'}), 403
        db.execute('INSERT INTO delivery_locations (assignment_id, partner_id, latitude, longitude) VALUES (?, ?, ?, ?)', (assignment_id, user_id, latitude, longitude))
        db.execute('UPDATE delivery_partner_profiles SET current_lat=?, current_lng=? WHERE user_id=?', (latitude, longitude, user_id))
    return jsonify({'success': True})

@app.get('/api/marketplace/orders/<int:order_id>/tracking')
def marketplace_order_tracking(order_id):
    user_id, error = require_farmer()
    if error:
        return error
    with get_db() as db:
        order = db.execute('SELECT id, buyer_id, status FROM orders WHERE id=?', (order_id,)).fetchone()
        assignment = db.execute('SELECT * FROM delivery_assignments WHERE order_id=?', (order_id,)).fetchone()
        if not order or not assignment:
            return jsonify({'error': 'tracking_not_found'}), 404
        seller = db.execute('SELECT seller_id FROM order_items WHERE order_id=? LIMIT 1', (order_id,)).fetchone()
        allowed = {order['buyer_id'], assignment['partner_id'], seller['seller_id'] if seller else None}
        if user_id not in allowed:
            return jsonify({'error': 'tracking_access_denied'}), 403
        payload = dict(assignment)
        payload['order_status'] = order['status']
        payload['locations'] = [dict(location) for location in db.execute('''SELECT latitude, longitude, recorded_at FROM delivery_locations
            WHERE assignment_id=? ORDER BY id DESC LIMIT 20''', (assignment['id'],)).fetchall()]
        if order['status'] in ('delivered', 'cancelled'):
            payload['locations'] = []
    return jsonify({'tracking': payload})

@app.get('/api/marketplace/farmer/orders')
def farmer_marketplace_orders():
    user_id, error = require_farmer()
    if error:
        return error
    with get_db() as db:
        rows = db.execute('''SELECT DISTINCT o.*, a.recipient_name, a.phone, a.line1, a.district, a.state
            FROM orders o JOIN order_items oi ON oi.order_id=o.id JOIN addresses a ON a.id=o.address_id
            WHERE oi.seller_id=? ORDER BY o.id DESC''', (user_id,)).fetchall()
        result = []
        for row in rows:
            payload = dict(row)
            payload['items'] = [dict(item) for item in db.execute('SELECT * FROM order_items WHERE order_id=? AND seller_id=?', (row['id'], user_id)).fetchall()]
            result.append(payload)
    return jsonify({'orders': result})

@app.patch('/api/marketplace/farmer/orders/<int:order_id>/status')
def farmer_update_order_status(order_id):
    user_id, error = require_farmer()
    if error:
        return error
    status = (request.get_json(silent=True) or {}).get('status')
    if status not in ('confirmed', 'preparing', 'ready_for_pickup', 'cancelled'):
        return jsonify({'error': 'invalid_farmer_status'}), 400
    with get_db() as db:
        row = db.execute('SELECT DISTINCT o.id, o.buyer_id FROM orders o JOIN order_items oi ON oi.order_id=o.id WHERE o.id=? AND oi.seller_id=?', (order_id, user_id)).fetchone()
        if not row:
            return jsonify({'error': 'seller_order_not_found'}), 404
        db.execute('UPDATE orders SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND status NOT IN (\'delivered\',\'cancelled\')', (status, order_id))
        db.execute('INSERT INTO notifications (farmer_id, message) VALUES (?, ?)', (row['buyer_id'], f'Order {order_id} status updated: {status}.'))
    return jsonify({'success': True, 'status': status})

@app.post('/api/marketplace/upload-image')
def upload_marketplace_image():
    user_id, error = require_farmer()
    if error:
        return error
    image = request.files.get('image')
    if not image or not image.filename:
        return jsonify({'error': 'image_required'}), 400
    allowed = {'.jpg', '.jpeg', '.png', '.webp'}
    extension = os.path.splitext(secure_filename(image.filename))[1].lower()
    if extension not in allowed or (request.content_length or 0) > 5 * 1024 * 1024:
        return jsonify({'error': 'invalid_image_type_or_size'}), 400
    filename = f'market-{user_id}-{secrets.token_urlsafe(12)}{extension}'
    image.save(os.path.join(UPLOAD_FOLDER, filename))
    return jsonify({'image_url': f'/uploads/{filename}'}), 201
@app.route('/<path:path>')
def static_proxy(path):
    # Keep the public URL space stable while serving the reorganized frontend.
    frontend_path = os.path.join(FRONTEND_FOLDER, path)
    if os.path.isfile(frontend_path):
        return send_from_directory(FRONTEND_FOLDER, path)
    page_path = os.path.join(FRONTEND_FOLDER, 'pages', path)
    if os.path.isfile(page_path):
        return send_from_directory(os.path.join(FRONTEND_FOLDER, 'pages'), path)
    if os.path.isdir(frontend_path):
        index_path = os.path.join(frontend_path, 'index.html')
        if os.path.exists(index_path):
            return send_from_directory(frontend_path, 'index.html')
    return render_template_string('<h1>404 Not Found</h1>'), 404


# ---------------- API: OpenAI chat proxy ----------------
@app.post('/api/chat')
def api_chat():
    try:
        data = request.get_json(silent=True) or {}
        message = (data.get('message') or '').strip()
        if not message:
            return jsonify({ 'error': 'empty_message' }), 400

        api_key = os.environ.get('OPENAI_API_KEY')
        if not api_key:
            # Graceful note if no key configured
            return jsonify({ 'error': 'no_api_key', 'answer': 'Backend not configured with OpenAI API key.' }), 500

        # Minimal call to Chat Completions API
        url = 'https://api.openai.com/v1/chat/completions'
        headers = {
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json'
        }
        payload = {
            'model': 'gpt-4o-mini',
            'messages': [
                { 'role': 'system', 'content': 'You are a helpful assistant for a farm products website. Keep answers concise and friendly.' },
                { 'role': 'user', 'content': message }
            ],
            'temperature': 0.3
        }
        resp = requests.post(url, headers=headers, json=payload, timeout=30)
        if resp.status_code >= 400:
            return jsonify({ 'error': 'upstream_error', 'status': resp.status_code, 'answer': 'Service temporarily unavailable.' }), 502
        data = resp.json()
        answer = (data.get('choices') or [{}])[0].get('message', {}).get('content', '').strip()
        if not answer:
            answer = 'Sorry, I could not generate a reply right now.'
        return jsonify({ 'answer': answer })
    except Exception as e:
        return jsonify({ 'error': 'exception', 'message': str(e)[:200] }), 500

# ---------------- API: Weather (OpenWeatherMap) ----------------
@app.get('/api/weather')
def api_weather():
    try:
        city = (request.args.get('city') or '').strip()
        if not city:
            return jsonify({ 'error': 'missing_city' }), 400
        api_key = os.environ.get('OPENWEATHER_API_KEY')
        if not api_key:
            return jsonify({ 'error': 'no_api_key', 'message': 'Missing OPENWEATHER_API_KEY' }), 500
        params = {
            'q': city,
            'appid': api_key,
            'units': 'metric'
        }
        r = requests.get('https://api.openweathermap.org/data/2.5/weather', params=params, timeout=20)
        if r.status_code >= 400:
            return jsonify({ 'error': 'upstream_error', 'status': r.status_code }), 502
        data = r.json()
        out = {
            'city': data.get('name'),
            'temp_c': (data.get('main') or {}).get('temp'),
            'feels_like_c': (data.get('main') or {}).get('feels_like'),
            'humidity': (data.get('main') or {}).get('humidity'),
            'wind_ms': (data.get('wind') or {}).get('speed'),
            'weather': ((data.get('weather') or [{}])[0]).get('description')
        }
        return jsonify(out)
    except Exception as e:
        return jsonify({ 'error': 'exception', 'message': str(e)[:200] }), 500

@app.get('/api/weather/locations')
def api_weather_locations():
    query = (request.args.get('query') or '').strip()
    if len(query) < 2:
        return jsonify({'error': 'location_query_required'}), 400
    try:
        response = requests.get('https://geocoding-api.open-meteo.com/v1/search', params={
            'name': query, 'count': 12, 'language': 'en', 'format': 'json'
        }, timeout=15)
        if response.status_code >= 400:
            return jsonify({'error': 'location_service_error'}), 502
        results = response.json().get('results') or []
        locations = [{
            'name': item.get('name'), 'latitude': item.get('latitude'), 'longitude': item.get('longitude'),
            'country': item.get('country'), 'admin1': item.get('admin1'), 'timezone': item.get('timezone')
        } for item in results if item.get('latitude') is not None and item.get('longitude') is not None]
        return jsonify({'locations': locations})
    except requests.RequestException:
        return jsonify({'error': 'location_network_error'}), 502

@app.get('/api/weather/forecast')
def api_weather_forecast():
    try:
        latitude = float(request.args.get('lat'))
        longitude = float(request.args.get('lon'))
    except (TypeError, ValueError):
        return jsonify({'error': 'valid_coordinates_required'}), 400
    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        return jsonify({'error': 'coordinates_out_of_range'}), 400
    try:
        response = requests.get('https://api.open-meteo.com/v1/forecast', params={
            'latitude': latitude, 'longitude': longitude, 'timezone': 'auto',
            'forecast_days': 7,
            'current': 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,rain,showers,snowfall,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m',
            'hourly': 'temperature_2m,precipitation_probability,precipitation,rain,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m',
            'daily': 'weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,sunrise,sunset,precipitation_sum,rain_sum,precipitation_probability_max,wind_speed_10m_max,wind_direction_10m_dominant',
        }, timeout=20)
        if response.status_code >= 400:
            return jsonify({'error': 'forecast_service_error'}), 502
        data = response.json()
        data['alerts'] = []
        data['alert_note'] = 'Open-Meteo forecast data does not include official weather alerts.'
        return jsonify(data)
    except requests.RequestException:
        return jsonify({'error': 'forecast_network_error'}), 502

# ---------------- API: Mandi rates (AGMARKNET via data.gov.in) ----------------
@app.get('/api/mandi')
def api_mandi():
    try:
        # Inputs
        state = (request.args.get('state') or '').strip()
        district = (request.args.get('district') or '').strip()
        market = (request.args.get('market') or '').strip()
        commodity = (request.args.get('commodity') or '').strip()
        limit = int(request.args.get('limit') or 25)
        api_key = os.environ.get('AGMARKNET_API_KEY')
        if not api_key:
            return jsonify({ 'error': 'no_api_key', 'message': 'Missing AGMARKNET_API_KEY' }), 500
        # AGMARKNET Prices resource
        resource_id = '9ef84268-d588-465a-a308-a864a43d0070'
        params = {
            'api-key': api_key,
            'format': 'json',
            'resource_id': resource_id,
            'limit': limit,
            'sort': 'arrival_date desc'
        }
        # Build filters
        filters = {}
        if state: filters['state'] = state
        if district: filters['district'] = district
        if market: filters['market'] = market
        if commodity: filters['commodity'] = commodity
        if filters:
            params['filters'] = filters
        r = requests.get('https://api.data.gov.in/resource/{rid}'.format(rid=resource_id), params=params, timeout=25)
        if r.status_code >= 400:
            return jsonify({ 'error': 'upstream_error', 'status': r.status_code }), 502
        data = r.json()
        records = data.get('records') or []
        # Normalize key fields
        out = []
        for rec in records:
            out.append({
                'state': rec.get('state'),
                'district': rec.get('district'),
                'market': rec.get('market'),
                'commodity': rec.get('commodity'),
                'variety': rec.get('variety'),
                'arrival_date': rec.get('arrival_date'),
                'min_price': rec.get('min_price'),
                'max_price': rec.get('max_price'),
                'modal_price': rec.get('modal_price'),
                'unit_of_price': rec.get('price_unit') or 'Rs/Quintal'
            })
        return jsonify({ 'count': len(out), 'results': out })
    except Exception as e:
        return jsonify({ 'error': 'exception', 'message': str(e)[:200] }), 500

# ---------------- API: OTP Authentication ----------------
@app.route('/send_otp', methods=['POST'])
def send_otp():
    data = request.get_json(silent=True) or {}
    phone = normalize_indian_phone(data.get('phone'))
    if not phone:
        return jsonify({'success': False, 'message': 'Enter a valid 10-digit Indian mobile number.'}), 400

    now = time.time()
    with get_db() as db:
        previous = db.execute('SELECT created_at FROM login_otps WHERE phone=?', (phone,)).fetchone()
        if previous and (now - previous['created_at'] < 15):
            wait_seconds = max(1, 15 - int(now - previous['created_at']))
            return jsonify({'success': False, 'message': f'Please wait {wait_seconds} seconds before requesting another code.'}), 429
        db.execute('DELETE FROM login_otps WHERE phone=?', (phone,))

    # Do not return generated OTPs to callers when SMS delivery is not configured.
    use_twilio = bool(client and TWILIO_FROM and not DEMO_OTP_ENABLED)
    if not use_twilio and not DEMO_OTP_ENABLED:
        return jsonify({'success': False, 'message': 'SMS sign-in is not configured. Use Firebase phone sign-in or contact the administrator.'}), 503
    otp = f'{secrets.randbelow(1_000_000):06d}' if not DEMO_OTP_ENABLED else '123456'

    if use_twilio:
        try:
            client.messages.create(
                body=f'Your Smart Farm login code is {otp}. It expires in 5 minutes.',
                from_=TWILIO_FROM,
                to=f'+91{phone}',
            )
            message = 'OTP sent to your mobile via SMS. It is valid for 5 minutes.'
            demo_code = None
        except Exception:
            app.logger.exception('Could not send login OTP via Twilio')
            return jsonify({'success': False, 'message': 'SMS delivery failed. Please try again later.'}), 503
    else:
        message = f'Demo OTP: {otp}. (Testing mode active)'
        demo_code = otp

    otp_hash = hashlib.sha256(f'{phone}:{otp}:{app.secret_key}'.encode('utf-8')).hexdigest()
    with get_db() as db:
        db.execute('INSERT OR REPLACE INTO login_otps (phone, otp_hash, created_at, attempts) VALUES (?, ?, ?, 0)', (phone, otp_hash, now))

    resp = {'success': True, 'message': message}
    if demo_code:
        resp['otp'] = demo_code
    return jsonify(resp)

@app.route('/verify_otp', methods=['POST'])
def verify_otp():
    data = request.get_json(silent=True) or {}
    phone = normalize_indian_phone(data.get('phone'))
    otp = str(data.get('otp') or '').strip()
    name = str(data.get('name') or '').strip()

    if not phone or len(otp) != 6 or not otp.isdigit():
        return jsonify({'success': False, 'message': 'Enter the 6-digit code sent to your phone.'}), 400

    now = time.time()
    with get_db() as db:
        db.execute('BEGIN IMMEDIATE')
        entry = db.execute('SELECT otp_hash, created_at, attempts FROM login_otps WHERE phone=?', (phone,)).fetchone()
        is_demo_match = (DEMO_OTP_ENABLED and otp == '123456')

        if not entry and not is_demo_match:
            return jsonify({'success': False, 'message': 'Code expired or not requested. Request a new OTP.'}), 400

        if entry:
            if (now - entry['created_at'] >= 300 or entry['attempts'] >= 5) and not is_demo_match:
                db.execute('DELETE FROM login_otps WHERE phone=?', (phone,))
                return jsonify({'success': False, 'message': 'Code expired. Request a new OTP.'}), 400

            candidate = hashlib.sha256(f'{phone}:{otp}:{app.secret_key}'.encode('utf-8')).hexdigest()
            if not secrets.compare_digest(candidate, entry['otp_hash']) and not is_demo_match:
                attempts = entry['attempts'] + 1
                db.execute('UPDATE login_otps SET attempts=? WHERE phone=?', (attempts, phone))
                remaining = max(0, 5 - attempts)
                return jsonify({'success': False, 'message': f'Incorrect code. {remaining} attempts remaining.'}), 400

            db.execute('DELETE FROM login_otps WHERE phone=?', (phone,))

    session['verified_phone'] = phone
    if name:
        return login_or_create_farmer(name, phone)
    return jsonify({'success': True, 'message': 'Phone number verified.'})

# ---------------- API: Products (Demo Data) ----------------
@app.route('/api/products')
def api_products():
    # Demo data, आप इसे DB या किसी external API से भी ला सकते हैं
    products = [
        { "name": "Wheat", "category": "Grain", "price": 1200, "units": 820, "stock": "In Stock", "currency": "₹" },
        { "name": "Rice", "category": "Grain", "price": 860, "units": 640, "stock": "In Stock", "currency": "₹" },
        { "name": "Tomato", "category": "Vegetable", "price": 40, "units": 980, "stock": "In Stock", "currency": "₹/kg" },
        { "name": "Green Peas", "category": "Vegetable", "price": 95, "units": 420, "stock": "In Stock", "currency": "₹/kg" },
        { "name": "Pulses", "category": "Grain", "price": 860, "units": 530, "stock": "Low", "currency": "₹" },
        { "name": "Cabbage", "category": "Vegetable", "price": 35, "units": 610, "stock": "In Stock", "currency": "₹/kg" },
        { "name": "Eggplant", "category": "Vegetable", "price": 70, "units": 380, "stock": "Low", "currency": "₹/kg" }
    ]
    return jsonify(products)

@app.route('/api/save_farmer', methods=['POST'])
def save_farmer():
    data = request.get_json()
    # Example fields: name, phone, address, etc.
    name = data.get('name')
    phone = data.get('phone')
    address = data.get('address')
    if not name or not phone:
        return jsonify({'success': False, 'message': 'Name and phone are required'}), 400
    # Keep this legacy endpoint idempotent for existing pages and integrations.
    with get_db() as db:
        farmer = db.execute('SELECT * FROM farmers WHERE phone = ?', (phone,)).fetchone()
        if farmer:
            db.execute('UPDATE farmers SET name = ? WHERE id = ?', (name, farmer['id']))
        else:
            farmer_id = secrets.token_urlsafe(16)
            username = ''.join(ch.lower() if ch.isalnum() else '_' for ch in name).strip('_') or 'farmer'
            db.execute('INSERT INTO farmers (id, name, phone, username) VALUES (?, ?, ?, ?)', (farmer_id, name, phone, username))
    save_farmer_data({'name': name, 'phone': phone, 'address': address})
    return jsonify({'success': True, 'message': 'Farmer data saved successfully'})

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    host = os.environ.get('SMART_FARM_HOST', '0.0.0.0')
    debug = os.environ.get('SMART_FARM_DEBUG', '').lower() in {'1', 'true', 'yes'}
    ssl_certificate = os.environ.get('SMART_FARM_SSL_CERT')
    ssl_private_key = os.environ.get('SMART_FARM_SSL_KEY')
    if bool(ssl_certificate) != bool(ssl_private_key):
        raise RuntimeError('SMART_FARM_SSL_CERT and SMART_FARM_SSL_KEY must be set together.')
    ssl_context = (ssl_certificate, ssl_private_key) if ssl_certificate and ssl_private_key else None
    if host in {'127.0.0.1', 'localhost'}:
        app.run(host=host, port=port, debug=debug, ssl_context=ssl_context)
    else:
        from threading import Thread
        from werkzeug.serving import make_server

        lan_server = make_server(host, port, app, threaded=True, ssl_context=ssl_context)
        loopback_server = make_server('127.0.0.1', port, app, threaded=True)
        Thread(target=loopback_server.serve_forever, daemon=True).start()
        lan_scheme = 'https' if ssl_context else 'http'
        print(f' * Running on {lan_scheme}://{host}:{port} and http://127.0.0.1:{port}', flush=True)
        try:
            lan_server.serve_forever()
        finally:
            loopback_server.shutdown()


