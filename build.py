"""Régénère index.html (autonome : CSS et données intégrés) et .nojekyll, dans ce dossier.

    python3 build.py            # réexporte data.json depuis seed.py puis assemble
    python3 build.py --no-seed  # assemble à partir du data.json existant
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent

if "--no-seed" not in sys.argv:
    sys.path.insert(0, str(ROOT))
    from export_web import dump
    (ROOT / "data.json").write_text(json.dumps(dump(), ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

data = (ROOT / "data.json").read_text(encoding="utf-8")
json.loads(data)
css = (ROOT / "luxury.css").read_text(encoding="utf-8")
html = (ROOT / "template.html").read_text(encoding="utf-8")
link = '<link rel="stylesheet" href="luxury.css">'
assert link in html and "/*__DATA__*/null" in html and "/*__PARTNER__*/" in html, "template.html incomplet"
html = html.replace(link, "<style>\n" + css + "\n</style>").replace("/*__DATA__*/null", data)
html = html.replace("/*__PARTNER__*/", (ROOT / "partner.js").read_text(encoding="utf-8")).replace("/*__ADMIN__*/", (ROOT / "admin.js").read_text(encoding="utf-8"))
(ROOT / "index.html").write_text(html, encoding="utf-8")
(ROOT / ".nojekyll").touch()
print(f"index.html : {len(html.encode()) / 1024:.1f} Ko · .nojekyll présent")
