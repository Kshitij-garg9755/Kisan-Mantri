"""Validate local frontend references after a Smart Farm reorganization."""
from __future__ import annotations

import re
import sys
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOTS = (ROOT / "frontend", ROOT / "app.py")
SKIP_PREFIXES = ("http:", "https:", "//", "data:", "blob:", "mailto:", "tel:", "javascript:", "#", "/api/", "/uploads/")
FILE_SUFFIXES = {".html", ".css", ".js", ".json", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".mp4", ".webm", ".wav", ".mp3", ".woff", ".woff2", ".ttf", ".otf"}


def is_external(reference: str) -> bool:
    return not reference or reference.startswith(SKIP_PREFIXES) or bool(urlsplit(reference).scheme)


def clean_reference(reference: str) -> str:
    return reference.split("#", 1)[0].split("?", 1)[0].strip()


def check_local_references() -> list[tuple[Path, str, Path]]:
    failures = []
    patterns = {
        ".html": re.compile(r"(?:href|src|action)\s*=\s*[\"']([^\"']+)[\"']", re.I),
        ".css": re.compile(r"url\(\s*[\"']?([^\)\"']+)", re.I),
        ".js": re.compile(r"(?:import\s+(?:[^;]+?\s+from\s+)?|import\(\s*)[\"']([^\"']+)[\"']", re.I),
    }
    for file_path in (ROOT / "frontend").rglob("*"):
        if not file_path.is_file() or file_path.suffix.lower() not in patterns:
            continue
        text = file_path.read_text(encoding="utf-8")
        for match in patterns[file_path.suffix.lower()].finditer(text):
            reference = clean_reference(match.group(1))
            if is_external(reference) or reference.startswith("/"):
                continue
            if file_path.suffix.lower() == ".js" and not reference.startswith((".", "/")):
                continue
            if reference.startswith("${") or reference in {"url", "blob"}:
                continue
            target = (file_path.parent / reference).resolve()
            if target.suffix.lower() not in FILE_SUFFIXES:
                continue
            if not target.exists():
                failures.append((file_path.relative_to(ROOT), reference, target.relative_to(ROOT)))
    return failures


def check_backend_contract() -> list[str]:
    app_text = (ROOT / "app.py").read_text(encoding="utf-8")
    required = ["/api/auth/login", "/api/auth/me", "/api/weather", "/api/agriverse/upload", "/api/agriverse/posts"]
    return [route for route in required if route not in app_text]


def main() -> int:
    failures = check_local_references()
    missing_routes = check_backend_contract()
    print(f"local_reference_failures={len(failures)}")
    for file_path, reference, target in failures:
        print(f"BROKEN {file_path}: {reference} -> {target}")
    print(f"missing_required_backend_routes={len(missing_routes)}")
    for route in missing_routes:
        print(f"MISSING_ROUTE {route}")
    return 1 if failures or missing_routes else 0


if __name__ == "__main__":
    sys.exit(main())
