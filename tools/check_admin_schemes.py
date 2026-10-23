"""Verify the admin scheme upsert/deactivate workflow (role-based access)."""
import os
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import app  # noqa: E402

client = app.app.test_client()
response = client.post('/api/auth/login', json={'name': 'Admin Test', 'phone': '9555555000'})
farmer_id = response.get_json()['farmer']['id']

db = sqlite3.connect(app.DATABASE_FILE)
db.execute("UPDATE farmers SET role = 'admin' WHERE id = ?", (farmer_id,))
db.commit()
db.close()

up = client.post('/api/features/admin/schemes', json={
    'slug': 'test-scheme-admin', 'title': 'Admin Created Scheme',
    'category': 'Credit', 'summary': 'created by admin test'
})
print('admin upsert:', up.status_code, up.get_json())

got = client.get('/api/features/schemes/test-scheme-admin')
print('detail fetch:', got.status_code, got.get_json().get('scheme', {}).get('title'))

dele = client.delete('/api/features/admin/schemes/test-scheme-admin')
print('deactivate:', dele.status_code)

gone = client.get('/api/features/schemes/test-scheme-admin')
print('after deactivate (expect 404):', gone.status_code)
