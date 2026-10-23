"""Cross-check that every getElementById(id) used by a feature JS file exists in its HTML.

Catches the most common client-side runtime failure (null element access) without
a browser, since this host has no Node/Playwright available.
"""
import os
import re

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'frontend', 'features')
PAIRS = [
    ('schemes', 'schemes.html', 'schemes.js'),
    ('chaupal', 'chaupal.html', 'chaupal.js'),
    ('kisan-bank', 'kisan-bank.html', 'kisan-bank.js'),
    ('disease-diagnosis', 'disease-diagnosis.html', 'disease-diagnosis.js'),
    ('satellite-ai', 'satellite-ai.html', 'satellite-ai.js'),
    ('kisan-radio', 'kisan-radio.html', 'kisan-radio.js'),
]

id_getter = re.compile(r"getElementById\(\s*'([^']+)'")
query_getter = re.compile(r"querySelector(?:All)?\(\s*'([^']+)'")

failures = []
for folder, html_name, js_name in PAIRS:
    html_path = os.path.join(ROOT, folder, html_name)
    js_path = os.path.join(ROOT, folder, js_name)
    html = open(html_path, encoding='utf-8').read()
    js = open(js_path, encoding='utf-8').read()
    html_ids = set(re.findall(r'id="([^"]+)"', html))
    # The shared helper also touches a couple of ids provided by every page.
    html_ids.update({'sf-auth-btn', 'sf-notif-count'})
    used_ids = set(id_getter.findall(js))
    missing = sorted(used_ids - html_ids)
    print(folder, 'ids used:', len(used_ids), 'missing:', missing)
    for item in missing:
        failures.append((folder, item))

print('\nTOTAL missing element ids:', len(failures))
for folder, item in failures:
    print('MISSING', folder, item)
