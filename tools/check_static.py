"""Verify static serving of all feature pages/assets over the real Flask routing."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import app  # noqa: E402

client = app.app.test_client()
paths = [
    '/features/schemes/schemes.html', '/features/schemes/schemes.css', '/features/schemes/schemes.js',
    '/features/shared/feature.css', '/features/shared/feature.js',
    '/features/chaupal/chaupal.html', '/features/chaupal/chaupal.css', '/features/chaupal/chaupal.js',
    '/features/kisan-bank/kisan-bank.html', '/features/kisan-bank/kisan-bank.css', '/features/kisan-bank/kisan-bank.js',
    '/features/disease-diagnosis/disease-diagnosis.html', '/features/disease-diagnosis/disease-diagnosis.css',
    '/features/disease-diagnosis/disease-diagnosis.js',
    '/features/satellite-ai/satellite-ai.html', '/features/satellite-ai/satellite-ai.css', '/features/satellite-ai/satellite-ai.js',
    '/features/kisan-radio/kisan-radio.html', '/features/kisan-radio/kisan-radio.css', '/features/kisan-radio/kisan-radio.js',
    '/features/data/schemes.json', '/features/data/radio.json',
    '/index.html', '/pages/index.html', '/agriverse',
]
bad = 0
for path in paths:
    response = client.get(path)
    ok = response.status_code == 200
    if not ok:
        bad += 1
    print(('OK ' if ok else 'BAD'), response.status_code, path)
print('BAD COUNT', bad)
sys.exit(1 if bad else 0)
