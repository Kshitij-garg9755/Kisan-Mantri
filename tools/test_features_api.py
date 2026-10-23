"""End-to-end smoke test for the integrated feature APIs (uses Flask test client)."""
import io
import os
import sys
import time
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import app as appmod  # noqa: E402
# Unique 10-digit phones per run so the test is fully repeatable.
_run = str(int(time.time()))[-6:]
PHONE_A = '9' + _run + '111'
PHONE_B = '9' + _run + '222'

client = appmod.app.test_client()
results = []


def check(name, cond, detail=''):
    results.append((name, bool(cond), detail))
    print(('PASS' if cond else 'FAIL'), name, detail)


# --- auth ---
r = client.post('/api/features/chaupal/posts', json={'caption': 'no auth'})
check('chaupal requires auth', r.status_code == 401, r.status_code)

r = client.post('/api/auth/login', json={'name': 'Test Farmer', 'phone': PHONE_A})
check('login', r.status_code == 200 and r.get_json().get('success'), r.get_json())
farmer = r.get_json().get('farmer')
fid = farmer['id']

# --- schemes ---
r = client.get('/api/features/schemes?q=kisan')
check('scheme search', r.status_code == 200, r.get_json().get('count'))
slug = client.get('/api/features/schemes').get_json()['schemes'][0]['slug']
r = client.post(f'/api/features/schemes/{slug}/bookmark')
first_state = r.get_json().get('bookmarked')
# Toggle should flip on the second call (idempotent regardless of prior state).
r2 = client.post(f'/api/features/schemes/{slug}/bookmark')
check('bookmark scheme toggles', r2.get_json().get('bookmarked') is (not first_state))
client.post(f'/api/features/schemes/{slug}/bookmark')
check('my bookmarks has entry', len(client.get('/api/features/schemes/bookmarks/mine').get_json()['schemes']) >= 1)
r = client.post('/api/features/admin/schemes', json={'slug': 'x', 'title': 'X'})
check('admin route blocked for non-admin', r.status_code == 403, r.status_code)

# --- chaupal ---
r = client.post('/api/features/chaupal/posts', json={'caption': 'My first field note', 'category': 'Wheat'})
check('create post', r.status_code == 201, r.get_json())
post_id = r.get_json()['post']['id']
r = client.get('/api/features/chaupal/feed?category=Wheat')
check('feed filter', any(p['id'] == post_id for p in r.get_json()['posts']))
check('like post', client.post(f'/api/features/chaupal/posts/{post_id}/like').get_json()['liked'] is True)
check('save post', client.post(f'/api/features/chaupal/posts/{post_id}/save').get_json()['saved'] is True)
check('comment', client.post(f'/api/features/chaupal/posts/{post_id}/comments', json={'body': 'Nice'}).status_code == 201)
cid = client.get(f'/api/features/chaupal/posts/{post_id}/comments').get_json()['comments'][0]['id']
check('reply', client.post(f'/api/features/chaupal/comments/{cid}/reply', json={'body': 'Thanks'}).status_code == 201)
check('report', client.post(f'/api/features/chaupal/posts/{post_id}/report', json={'reason': 'spam'}).status_code == 201)
check('report duplicate blocked', client.post(f'/api/features/chaupal/posts/{post_id}/report', json={'reason': 'spam'}).status_code == 409)

# second user cannot delete
c2 = appmod.app.test_client()
c2.post('/api/auth/login', json={'name': 'Other Farmer', 'phone': PHONE_B})
check('non-owner delete blocked', c2.delete(f'/api/features/chaupal/posts/{post_id}').status_code == 403)
f1 = c2.post(f'/api/features/chaupal/farmers/{fid}/follow').get_json()['following']
check('follow farmer toggles', c2.post(f'/api/features/chaupal/farmers/{fid}/follow').get_json()['following'] is (not f1))
c2.post(f'/api/features/chaupal/farmers/{fid}/follow')
check('cannot follow self', c2.post('/api/features/chaupal/farmers/' + c2.get('/api/auth/me').get_json()['farmer']['id'] + '/follow').status_code == 400)
check('farmer search', len(client.get('/api/features/chaupal/farmers?q=Test').get_json()['farmers']) >= 1)

# image post
img = (io.BytesIO(b'\x89PNG\r\n\x1a\n' + b'0' * 100), 'leaf.png')
r = client.post('/api/features/chaupal/upload', data={'image': img, 'caption': 'Image post'}, content_type='multipart/form-data')
check('image post upload', r.status_code == 201, r.get_json())

check('owner delete post', client.delete(f'/api/features/chaupal/posts/{post_id}').status_code == 200)

# --- diagnosis ---
img = (io.BytesIO(b'\x89PNG\r\n\x1a\n' + b'0' * 100), 'leaf.png')
r = client.post('/api/features/diagnosis/analyze', data={'image': img, 'crop': 'Tomato'}, content_type='multipart/form-data')
check('diagnosis demo labelled', r.status_code == 201 and r.get_json()['result']['status'] == 'demo', r.get_json()['result']['status'])
rec = r.get_json()['result']['id']
hist = client.get('/api/features/diagnosis/history').get_json()['history']
check('diagnosis history saved', any(h['id'] == rec for h in hist))
bad = (io.BytesIO(b'nope'), 'evil.exe')
check('diagnosis rejects bad type', client.post('/api/features/diagnosis/analyze', data={'image': bad, 'crop': 'X'}, content_type='multipart/form-data').status_code == 400)
check('diagnosis delete owner', client.delete(f'/api/features/diagnosis/history/{rec}').status_code == 200)

# --- satellite fields ---
r = client.post('/api/features/satellite/fields', json={'name': 'North Field', 'latitude': 23.2, 'longitude': 77.4, 'crop': 'Wheat'})
check('create field', r.status_code == 201, r.get_json())
field_id = r.get_json()['field']['id']
check('list fields', len(client.get('/api/features/satellite/fields').get_json()['fields']) >= 1)
check('bad coords rejected', client.post('/api/features/satellite/fields', json={'name': 'x', 'latitude': 999, 'longitude': 0}).status_code == 400)
check('field delete owner', client.delete(f'/api/features/satellite/fields/{field_id}').status_code == 200)

# --- radio ---
prog = client.get('/api/features/radio/programs').get_json()['programs'][0]['id']
s1 = client.post(f'/api/features/radio/programs/{prog}/save').get_json()['saved']
check('save program toggles', client.post(f'/api/features/radio/programs/{prog}/save').get_json()['saved'] is (not s1))
client.post(f'/api/features/radio/programs/{prog}/save')
check('saved programs has entry', len(client.get('/api/features/radio/saved').get_json()['programs']) >= 1)

# --- notifications ---
check('notifications endpoint', client.get('/api/features/notifications').status_code == 200)

# --- logout ---
check('logout', client.post('/api/auth/logout').status_code == 200)

failed = [r for r in results if not r[1]]
print('\nTOTAL', len(results), 'PASSED', len(results) - len(failed), 'FAILED', len(failed))
sys.exit(1 if failed else 0)
