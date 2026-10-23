"""Syntax-check the feature JavaScript files with esprima (ES5/ES6 parser)."""
import glob
import os
import sys

import esprima

root = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'frontend', 'features')
files = glob.glob(os.path.join(root, '**', '*.js'), recursive=True)
bad = 0
for path in files:
    with open(path, 'r', encoding='utf-8') as handle:
        source = handle.read()
    try:
        esprima.parseScript(source, {'tolerant': False})
        print('OK  ', os.path.relpath(path, root))
    except Exception as error:  # noqa: BLE001
        bad += 1
        print('FAIL', os.path.relpath(path, root), '->', error)
print('JS files:', len(files), 'failures:', bad)
sys.exit(1 if bad else 0)
