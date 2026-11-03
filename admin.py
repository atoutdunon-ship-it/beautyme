"""BeautyMe — espace d'administration : prestataires, fiches, contenu des pages, référentiels.

Désactiver un établissement le retire de la recherche et de la réservation et bloque la
connexion de son compte ; les rendez-vous déjà pris restent visibles et honorables.
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from adminauth import AS, ANow, require_admin
from catalogue import COMMUNES, TEMPLATES
from engine import STEP_MIN, Salon
from pro import PS, AppStatus, DraftIn, ProStore, build_salon, check_draft, slugify
from seed import CATEGORIES, INACTIVE, META, SALONS, TERRITORIES
from store import Status, Store

router = APIRouter(prefix="/v1/admin", dependencies=[Depends(require_admin)])
public = APIRouter(prefix="/v1")


def _hm(m: int) -> str:
    return f"{m // 60:02d}:{m % 60:02d}"


def salon_to_draft(s: Salon) -> DraftIn:
    meta = META[s.slug]
    tpl = {t["name"]: t["id"] for t in TEMPLATES.get(s.category, [])}
    return DraftIn(
        activity=s.category, other_activities=meta.get("others", []), name=s.name, territory=s.territory,
        commune=s.commune, address=meta["address"], about=meta["about"], price_level=meta["price"],
        deposit_pct=s.deposit_pct, home_zones=dict(s.home_zones),
        services=[{"id": v.id, "template": tpl.get(v.name), "name": v.name, "section": v.category,
                   "duration": v.duration, "price": None if v.price_cents is None else v.price_cents / 100,
                   "price_from": v.price_from, "pose": v.pose, "home_ok": v.home_ok, "online": v.online,
                   "description": v.description} for v in s.services],
        staff=[{"id": p.id, "name": p.name, "home": p.home, "skills": sorted(p.skills),
                "hours": {wd: [(_hm(a), _hm(b)) for a, b in ivs] for wd, ivs in p.hours.items()}} for p in s.staff],
    )


def _owner(ps: ProStore, slug: str):
    acc_id = META.get(slug, {}).get("owner")
    return ps.accounts.get(acc_id) if acc_id else None


def _salon(slug: str) -> Salon:
    s = SALONS.get(slug)
    if not s:
        raise HTTPException(404, "Établissement introuvable.")
    return s


# ── Tableau de bord ───────────────────────────────────────────────────────
def booking_store() -> Store:
    from main import _store  # import différé : main importe ce module
    return _store


@router.get("/tableau-de-bord")
def dashboard(ps: PS, now: ANow, st: Annotated[Store, Depends(booking_store)]) -> dict:
    upcoming = [b for b in st._bookings.values() if b.status is Status.CONFIRMED and b.end > now]
    by_status = {k.value: 0 for k in AppStatus}
    for a in ps.apps.values():
        by_status[a.status.value] += 1
    return {
        "etablissements_en_ligne": sum(1 for k in SALONS if k not in INACTIVE),
        "etablissements_desactives": len(INACTIVE & SALONS.keys()),
        "demandes_en_attente": by_status["en_revue"],
        "demandes": by_status,
        "comptes_prestataires": len(ps.accounts),
        "comptes_desactives": sum(1 for a in ps.accounts.values() if not a.active),
        "rendez_vous_a_venir": len(upcoming),
        "par_territoire": {t: sum(1 for s in SALONS.values() if s.territory == t and s.slug not in INACTIVE) for t in TERRITORIES},
    }


# ── Prestataires et établissements ───────────────────────────────────────
@router.get("/etablissements")
def list_salons(ps: PS) -> list[dict]:
    out = []
    for s in SALONS.values():
        acc = _owner(ps, s.slug)
        out.append({
            "slug": s.slug, "name": s.name, "territory": s.territory, "commune": s.commune, "category": s.category,
            "active": s.slug not in INACTIVE, "rating": META[s.slug]["rating"], "reviews": META[s.slug]["reviews"],
            "source": "partenaire" if acc else "démonstration",
            "owner": {"id": acc.id, "email": acc.email, "phone": acc.phone, "active": acc.active} if acc else None,
        })
    return sorted(out, key=lambda x: (x["territory"], x["name"]))


@router.get("/comptes")
def list_accounts(ps: PS) -> list[dict]:
    """Comptes prestataires, y compris ceux dont l'établissement n'est pas (encore) en ligne."""
    out = []
    for acc in ps.accounts.values():
        app = ps.apps.get(acc.id)
        out.append({"id": acc.id, "email": acc.email, "phone": acc.phone, "active": acc.active,
                    "created_at": acc.created_at, "status": app.status if app else None,
                    "name": (app.draft.get("name") if app else None), "slug": app.slug if app else None})
    return sorted(out, key=lambda x: x["created_at"], reverse=True)


class StatusIn(BaseModel):
    active: bool
    reason: str | None = Field(None, max_length=300)


@router.post("/etablissements/{slug}/statut")
def set_salon_status(slug: str, body: StatusIn, ps: PS, ast: AS, now: ANow) -> dict:
    s = _salon(slug)
    (INACTIVE.discard if body.active else INACTIVE.add)(slug)
    acc = _owner(ps, slug)
    if acc:
        acc.active = body.active
    verb = "réactivé" if body.active else "désactivé"
    ast.record(f"établissement {verb}", s.name + (f" — {body.reason}" if body.reason else ""), now)
    return {"slug": slug, "active": body.active, "owner_active": acc.active if acc else None}


@router.post("/comptes/{account_id}/statut")
def set_account_status(account_id: str, body: StatusIn, ps: PS, ast: AS, now: ANow) -> dict:
    acc = ps.accounts.get(account_id)
    if not acc:
        raise HTTPException(404, "Compte introuvable.")
    acc.active = body.active
    app = ps.apps.get(acc.id)
    if app and app.slug and app.slug in SALONS:
        (INACTIVE.discard if body.active else INACTIVE.add)(app.slug)
    ast.record("compte " + ("réactivé" if body.active else "désactivé"), acc.email or acc.phone or acc.id, now)
    return {"id": acc.id, "active": acc.active}


@router.get("/etablissements/{slug}/fiche", response_model=DraftIn)
def get_salon_draft(slug: str) -> DraftIn:
    return salon_to_draft(_salon(slug))


@router.put("/etablissements/{slug}")
def update_salon(slug: str, body: DraftIn, ast: AS, now: ANow) -> dict:
    old = _salon(slug)
    miss = check_draft(body, now.date(), documents=False)
    if miss:
        raise HTTPException(422, {"message": "Fiche incomplète.", "missing": miss})
    try:
        new = build_salon(body, slug)
    except ValueError as e:
        raise HTTPException(422, {"message": "Fiche incohérente.", "missing": [str(e)]}) from None
    SALONS[slug] = new
    META[slug].update(price=body.price_level, address=body.address, about=body.about, others=list(body.other_activities))
    ast.record("fiche modifiée", f"{old.name}" + (f" → {new.name}" if new.name != old.name else ""), now)
    return {"slug": slug, "name": new.name}


# ── Contenu des pages ────────────────────────────────────────────────────
TEXT, IMAGE = "texte", "image"
CONTENT_FIELDS: dict[str, tuple[str, int]] = {
    "bandeau": (TEXT, 120), "hero_lieu": (TEXT, 120), "hero_titre": (TEXT, 90), "hero_texte": (TEXT, 240),
    "hero_note": (TEXT, 300), "hero_legende": (TEXT, 80), "hero_image": (IMAGE, 0),
    "recherche_accroche": (TEXT, 120), "univers_titre": (TEXT, 90), "univers_sous_titre": (TEXT, 160),
    **{f"promesse_{i}_{k}": (TEXT, 60 if k == "titre" else 220) for i in (1, 2, 3) for k in ("titre", "texte")},
    "domicile_titre": (TEXT, 90), "domicile_texte": (TEXT, 300), "domicile_bouton": (TEXT, 40), "domicile_image": (IMAGE, 0),
    "pied_texte": (TEXT, 200),
}
MAX_IMAGE = 1_500_000      # octets de data-URL par image
MAX_CONTENT = 9_000_000    # total
_DATA_URL = re.compile(r"^data:image/(webp|jpeg|png|avif);base64,[A-Za-z0-9+/=]+$")
CONTENT: dict[str, str] = {}


def _content_fields() -> dict[str, tuple[str, int]]:
    return {**CONTENT_FIELDS, **{f"photo_{k}": (IMAGE, 0) for k in CATEGORIES}}


@public.get("/contenu")
def get_content() -> dict:
    return {"valeurs": CONTENT, "champs": {k: {"type": t, "max": m} for k, (t, m) in _content_fields().items()}}


@router.put("/contenu")
def put_content(body: dict[str, str | None], ast: AS, now: ANow) -> dict:
    fields, errors = _content_fields(), []
    for k, v in body.items():
        if k not in fields:
            errors.append(f"Champ inconnu : {k}.")
            continue
        kind, mx = fields[k]
        if v is None or v == "":
            continue
        if kind == TEXT and len(v) > mx:
            errors.append(f"{k} : {mx} caractères maximum.")
        if kind == IMAGE and (len(v) > MAX_IMAGE or not _DATA_URL.match(v)):
            errors.append(f"{k} : image WebP, JPEG, PNG ou AVIF de 1,1 Mo maximum.")
    if errors:
        raise HTTPException(422, {"message": "Contenu refusé.", "missing": errors})
    merged = {**CONTENT, **{k: v for k, v in body.items()}}
    merged = {k: v for k, v in merged.items() if v}
    if sum(len(v) for v in merged.values()) > MAX_CONTENT:
        raise HTTPException(413, "Trop d'images : 9 Mo au total maximum.")
    CONTENT.clear()
    CONTENT.update(merged)
    ast.record("contenu modifié", ", ".join(sorted(body)) or "aucun champ", now)
    return {"valeurs": CONTENT}


# ── Référentiels ─────────────────────────────────────────────────────────
class TemplateIn(BaseModel):
    id: str = Field(pattern=r"^[a-z0-9-]{2,40}$")
    name: str = Field(min_length=2, max_length=80)
    section: str = Field(min_length=2, max_length=40)
    duration: int = Field(ge=15, le=600)
    price: float | None = Field(None, ge=0, le=5000)
    price_from: bool = False
    pose: tuple[int, int] | None = None
    home_ok: bool = False
    description: str = Field("", max_length=300)


class RefsIn(BaseModel):
    territoires: dict[Literal["MQ", "GP", "GF"], str]
    categories: dict[str, str]
    communes: dict[Literal["MQ", "GP", "GF"], list[str]]
    modeles: dict[str, list[TemplateIn]]


@router.get("/referentiels")
def get_refs() -> dict:
    return {"territoires": {k: v["name"] for k, v in TERRITORIES.items()}, "categories": CATEGORIES,
            "communes": COMMUNES, "modeles": TEMPLATES}


@router.put("/referentiels")
def put_refs(body: RefsIn, ps: PS, ast: AS, now: ANow) -> dict:
    errors: list[str] = []
    for k, name in body.territoires.items():
        if not 2 <= len(name.strip()) <= 40:
            errors.append(f"Nom du territoire {k} : 2 à 40 caractères.")
    for k, name in body.categories.items():
        if not re.fullmatch(r"[a-z0-9-]{2,30}", k):
            errors.append(f"Identifiant d'univers invalide : {k}.")
        if not 2 <= len(name.strip()) <= 40:
            errors.append(f"Nom de l'univers {k} : 2 à 40 caractères.")
    drafts = [DraftIn.model_validate(a.draft) for a in ps.apps.values() if a.status is not AppStatus.APPROVED]
    used_cats = {s.category for s in SALONS.values()} | {c for d in drafts for c in [d.activity, *d.other_activities] if c}
    for c in sorted(used_cats - body.categories.keys()):
        errors.append(f"L'univers « {CATEGORIES.get(c, c)} » est utilisé : impossible de le supprimer.")
    for t, lst in body.communes.items():
        if len(set(lst)) != len(lst):
            errors.append(f"Commune en double ({TERRITORIES[t]['name']}).")
        if any(not 2 <= len(c.strip()) <= 60 for c in lst):
            errors.append(f"Nom de commune invalide ({TERRITORIES[t]['name']}).")
        used = {s.commune for s in SALONS.values() if s.territory == t} | {z for s in SALONS.values() if s.territory == t for z in s.home_zones}
        used |= {d.commune for d in drafts if d.territory == t and d.commune} | {z for d in drafts if d.territory == t for z in d.home_zones}
        for c in sorted(used - set(lst)):
            errors.append(f"La commune « {c} » est utilisée par un établissement : impossible de la supprimer.")
    for cat, tpls in body.modeles.items():
        if cat not in body.categories:
            errors.append(f"Prestations types pour un univers inconnu : {cat}.")
        if len({t.id for t in tpls}) != len(tpls):
            errors.append(f"Deux prestations types portent le même identifiant ({body.categories.get(cat, cat)}).")
        for t in tpls:
            if t.duration % STEP_MIN:
                errors.append(f"« {t.name} » : durée par tranches de 15 minutes.")
            if t.pose and not (0 < t.pose[0] and 0 < t.pose[1] and sum(t.pose) < t.duration):
                errors.append(f"« {t.name} » : le temps de pose doit tenir dans la prestation.")
    if errors:
        raise HTTPException(422, {"message": "Référentiels refusés.", "missing": list(dict.fromkeys(errors))})
    for k, name in body.territoires.items():
        TERRITORIES[k]["name"] = name.strip()
    CATEGORIES.clear()
    CATEGORIES.update({k: v.strip() for k, v in body.categories.items()})
    for t, lst in body.communes.items():
        COMMUNES[t] = sorted({c.strip() for c in lst}, key=lambda c: slugify(c))
    TEMPLATES.clear()
    TEMPLATES.update({c: [{**t.model_dump(), "pose": list(t.pose) if t.pose else None, "home_ok": t.home_ok} for t in tpls]
                      for c, tpls in body.modeles.items()})
    for c in CATEGORIES:
        TEMPLATES.setdefault(c, [])
    ast.record("référentiels modifiés", f"{len(CATEGORIES)} univers, {sum(map(len, COMMUNES.values()))} communes, "
               f"{sum(map(len, TEMPLATES.values()))} prestations types", now)
    return get_refs()
