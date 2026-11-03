"""Exporte le référentiel de démonstration vers le prototype web (source unique).

    python3 export_web.py data.json
"""
from __future__ import annotations

import json
import sys

from catalogue import COMMUNES, DOCUMENTS, TEMPLATES
from seed import CATEGORIES, META, SALONS, TERRITORIES


def dump() -> dict:
    salons = []
    for s in SALONS.values():
        salons.append({
            "slug": s.slug, "name": s.name, "t": s.territory.value, "commune": s.commune,
            "cat": s.category, "deposit": s.deposit_pct, "zones": dict(s.home_zones),
            **{k: META[s.slug][k] for k in ("rating", "reviews", "price", "address", "about")},
            "services": [{
                "id": v.id, "name": v.name, "sec": v.category, "dur": v.duration,
                "price": v.price_cents, "from": v.price_from, "pose": list(v.pose) if v.pose else None,
                "home": v.home_ok, "online": v.online, "desc": v.description,
            } for v in s.services],
            "staff": [{
                "id": p.id, "name": p.name, "home": p.home, "skills": sorted(p.skills),
                "hours": {str(d): [list(iv) for iv in ivs] for d, ivs in p.hours.items()},
            } for p in s.staff],
        })
    return {"territories": TERRITORIES, "categories": CATEGORIES, "salons": salons,
            "pro": {"modeles": TEMPLATES, "communes": COMMUNES, "documents": DOCUMENTS}}


if __name__ == "__main__":
    out = json.dumps(dump(), ensure_ascii=False, separators=(",", ":"))
    if len(sys.argv) > 1:
        open(sys.argv[1], "w", encoding="utf-8").write(out)
    else:
        print(out)
