#!/usr/bin/env python3
"""Inject the shared app.css into every Yours frontend page.

- Adds <link rel="stylesheet" href=".../css/app.css"> after the Tailwind CDN script
  (or before </head> as a fallback). Subdirectory pages get a relative path.
- Normalizes the viewport meta to 'width=device-width, initial-scale=1.0, viewport-fit=cover'
  (drops user-scalable=no / maximum-scale=1.0 which hurt accessibility).
- Adds the 'app-page' class to <body> so the shared phone-frame layout applies.
- Skips t.html (unrelated developer-portfolio template).
"""
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
SKIP = {'t.html'}

VIEWPORT = '<meta content="width=device-width, initial-scale=1.0, viewport-fit=cover" name="viewport">'

viewport_re = re.compile(r'<meta\s+[^>]*name=["\']viewport["\'][^>]*>', re.IGNORECASE)
tailwind_re = re.compile(r'(<script[^>]*cdn\.tailwindcss[^>]*></script>)', re.IGNORECASE)
body_re = re.compile(r'<body([^>]*)>', re.IGNORECASE)


def rel_css(path):
    rel = os.path.relpath(os.path.join(ROOT, 'css', 'app.css'), os.path.dirname(path))
    return rel.replace(os.sep, '/')


def process(path):
    with open(path, 'r', encoding='utf-8', errors='replace') as f:
        html = f.read()
    orig = html

    # 1) Normalize viewport
    if viewport_re.search(html):
        html = viewport_re.sub(VIEWPORT, html, count=1)
    else:
        html = html.replace('<head>', '<head>\n' + VIEWPORT, 1)

    # 2) Inject stylesheet link (skip if already present)
    link = f'<link rel="stylesheet" href="{rel_css(path)}">'
    if 'css/app.css' not in html:
        m = tailwind_re.search(html)
        if m:
            html = html.replace(m.group(1), m.group(1) + '\n' + link, 1)
        else:
            html = html.replace('</head>', link + '\n</head>', 1)

    # 3) Add app-page class to <body>
    m = body_re.search(html)
    if m and 'app-page' not in html[m.start():m.end()]:
        attrs = m.group(1)
        if re.search(r'class=["\']', attrs):
            attrs = re.sub(
                r'(class=["\'])([^"\']*)(["\'])',
                lambda mm: mm.group(1) + mm.group(2) + ' app-page' + mm.group(3),
                attrs,
                count=1,
            )
        else:
            attrs = attrs + ' class="app-page"'
        html = html[:m.start()] + '<body' + attrs + '>' + html[m.end():]

    if html != orig:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(html)
        return True
    return False


changed = 0
skipped = 0
for dirpath, _dirs, files in os.walk(ROOT):
    for name in files:
        if not name.endswith('.html'):
            continue
        if name in SKIP:
            skipped += 1
            continue
        path = os.path.join(dirpath, name)
        if process(path):
            changed += 1
            print('updated:', os.path.relpath(path, ROOT))

print(f'\nDone. {changed} files updated, {skipped} skipped.')
