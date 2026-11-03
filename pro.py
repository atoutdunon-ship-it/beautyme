"""BeautyMe — espace partenaire.

Parcours : connexion (mobile + code OU e-mail + mot de passe) → choix de l'activité →
fiche établissement → prestations (modèles + ajout libre) → équipe et horaires →
domicile et acompte → documents → soumission → validation par l'équipe BeautyMe →
publication (l'établissement devient cherchable et réservable).

Stockage en mémoire, interface calquée sur les tables `provider_account`,
`provider_session`, `salon_application` de sql/schema.sql.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import re
import secrets
import threading
import unicodedata
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from enum import StrEnum
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field, field_validator

from adminauth import AS, require_admin
from catalogue import COMMUNES, DOCUMENTS, TEMPLATES
from engine import STEP_MIN, Salon, Service, Staff, Territory
from seed import CATEGORIES, META, SALONS

DEMO = os.getenv("BEAUTYME_DEMO", "1") == "1"
DEMO_CODE = "2026"
SECRET = os.getenv("BEAUTYME_SECRET", secrets.token_hex(32)).encode()

OTP_TTL = timedelta(minutes=10)
OTP_RESEND = timedelta(seconds=30)
OTP_ATTEMPTS = 5
SESSION_TTL = timedelta(days=30)

router = APIRouter(prefix="/v1")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ── Téléphone : numérotation des DROM ────────────────────────────────────
# Mobiles : 0696/0697 Martinique (+596), 0690/0691 Guadeloupe (+590), 0694 Guyane (+594).
_DROM_MOBILE = {"0696": "596", "0697": "596", "0690": "590", "0691": "590", "0694": "594"}


def normalize_phone(raw: str) -> str:
    d = re.sub(r"[^\d+]", "", raw)
    if d.startswith("00"):
        d = "+" + d[2:]
    if d.startswith("+"):
        digits = d[1:]
        if not re.fullmatch(r"(596|590|594)\d{9}|33\d{9}", digits):
            raise ValueError("Numéro international non reconnu.")
        return "+" + digits
    if not re.fullmatch(r"0\d{9}", d):
        raise ValueError("10 chiffres attendus, par exemple 0696 12 34 56.")
    cc = _DROM_MOBILE.get(d[:4], "33")
    return f"+{cc}{d[1:]}"


def siret_ok(s: str) -> bool:
    d = re.sub(r"\s", "", s)
    if not re.fullmatch(r"\d{14}", d):
        return False
    total = 0
    for i, ch in enumerate(reversed(d)):
        n = int(ch) * (2 if i % 2 else 1)
        total += n - 9 if n > 9 else n
    return total % 10 == 0


def slugify(s: str) -> str:
    s = unicodedata.normalize("NFKD", s.replace("œ", "oe")).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


# ── Mots de passe et codes ───────────────────────────────────────────────
def hash_password(pw: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    dk = hashlib.scrypt(pw.encode(), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return f"scrypt${salt.hex()}${dk.hex()}"


def check_password(pw: str, stored: str) -> bool:
    _, salt, _dk = stored.split("$")
    return hmac.compare_digest(hash_password(pw, bytes.fromhex(salt)), stored)


def _mac(s: str) -> str:
    return hmac.new(SECRET, s.encode(), hashlib.sha256).hexdigest()


# ── Modèle ────────────────────────────────────────────────────────────────
class AppStatus(StrEnum):
    DRAFT = "brouillon"
    REVIEW = "en_revue"
    APPROVED = "valide"
    REJECTED = "refuse"


@dataclass(slots=True)
class Account:
    id: str
    email: str | None = None
    password: str | None = None
    phone: str | None = None
    active: bool = True
    created_at: datetime = field(default_factory=utcnow)


@dataclass(slots=True)
class Application:
    id: str
    account_id: str
    draft: dict = field(default_factory=dict)
    status: AppStatus = AppStatus.DRAFT
    reason: str | None = None
    slug: str | None = None
    submitted_at: datetime | None = None
    decided_at: datetime | None = None
    updated_at: datetime = field(default_factory=utcnow)


class ProStore:
    def __init__(self) -> None:
        self.lock = threading.RLock()
        self.accounts: dict[str, Account] = {}
        self.by_email: dict[str, str] = {}
        self.by_phone: dict[str, str] = {}
        self.sessions: dict[str, tuple[str, datetime]] = {}
        self.otps: dict[str, dict] = {}
        self.apps: dict[str, Application] = {}  # par account_id
        self.outbox: list[dict] = []  # messages « envoyés » (WhatsApp/SMS/e-mail)

    def new_account(self, **kw) -> Account:
        a = Account(id="acc_" + secrets.token_hex(6), **kw)
        self.accounts[a.id] = a
        if a.email:
            self.by_email[a.email] = a.id
        if a.phone:
            self.by_phone[a.phone] = a.id
        return a

    def open_session(self, acc: Account, now: datetime) -> str:
        tok = secrets.token_urlsafe(32)
        self.sessions[_mac(tok)] = (acc.id, now + SESSION_TTL)
        return tok

    def application(self, account_id: str) -> Application:
        app = self.apps.get(account_id)
        if not app:
            app = self.apps[account_id] = Application(id="dem_" + secrets.token_hex(6), account_id=account_id)
        return app


_pro = ProStore()


def pro_store() -> ProStore:
    return _pro


def now_dep() -> datetime:
    return utcnow()


PS = Annotated[ProStore, Depends(pro_store)]
Now = Annotated[datetime, Depends(now_dep)]


def current_account(st: PS, now: Now, authorization: Annotated[str | None, Header()] = None) -> Account:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Connectez-vous à votre espace partenaire.")
    entry = st.sessions.get(_mac(authorization[7:]))
    if not entry or entry[1] < now:
        raise HTTPException(401, "Session expirée. Reconnectez-vous.")
    acc = st.accounts[entry[0]]
    _ensure_active(acc)
    return acc


DISABLED_MSG = "Ce compte est désactivé. Contactez l'équipe BeautyMe."


def _ensure_active(acc: Account) -> None:
    if not acc.active:
        raise HTTPException(403, DISABLED_MSG)


Me = Annotated[Account, Depends(current_account)]
Email = Annotated[str, Field(pattern=r"^[^@\s]{1,64}@[^@\s]{1,190}\.[A-Za-z]{2,24}$", max_length=254)]


# ── Connexion ─────────────────────────────────────────────────────────────
class PhoneIn(BaseModel):
    phone: str
    channel: Literal["whatsapp", "sms"] = "whatsapp"


class OtpIn(BaseModel):
    phone: str
    code: str = Field(pattern=r"^\d{4,6}$")


class RegisterIn(BaseModel):
    email: Email
    password: str = Field(min_length=10, max_length=128)
    phone: str | None = None

    @field_validator("password")
    @classmethod
    def strong(cls, v: str) -> str:
        if not (re.search(r"[A-Za-z]", v) and re.search(r"\d", v)):
            raise ValueError("Le mot de passe doit mêler lettres et chiffres.")
        return v


class LoginIn(BaseModel):
    email: Email
    password: str


class SessionOut(BaseModel):
    token: str
    account_id: str
    method: Literal["telephone", "email"]
    new_account: bool


def _phone(raw: str) -> str:
    try:
        return normalize_phone(raw)
    except ValueError as e:
        raise HTTPException(422, str(e)) from None


@router.post("/pro/auth/code", status_code=202)
def request_code(body: PhoneIn, st: PS, now: Now) -> dict:
    phone = _phone(body.phone)
    with st.lock:
        prev = st.otps.get(phone)
        if prev and now - prev["sent"] < OTP_RESEND:
            raise HTTPException(429, "Patientez 30 secondes avant de demander un nouveau code.")
        code = DEMO_CODE if DEMO else f"{secrets.randbelow(10**4):04d}"
        st.otps[phone] = {"mac": _mac(phone + code), "exp": now + OTP_TTL, "sent": now, "left": OTP_ATTEMPTS}
        st.outbox.append({"to": phone, "channel": body.channel, "text": f"BeautyMe : votre code est {code}. Il expire dans 10 minutes."})
    return {"sent_to": phone[:-4] + "••••", "channel": body.channel, "expires_in": int(OTP_TTL.total_seconds())}


@router.post("/pro/auth/code/verifier", response_model=SessionOut)
def verify_code(body: OtpIn, st: PS, now: Now) -> SessionOut:
    phone = _phone(body.phone)
    with st.lock:
        o = st.otps.get(phone)
        if not o or o["exp"] < now:
            raise HTTPException(410, "Code expiré. Demandez-en un nouveau.")
        if o["left"] <= 0:
            raise HTTPException(429, "Trop d'essais. Demandez un nouveau code.")
        if not hmac.compare_digest(o["mac"], _mac(phone + body.code)):
            o["left"] -= 1
            raise HTTPException(401, f"Code incorrect. {o['left']} essai(s) restant(s).")
        del st.otps[phone]
        new = phone not in st.by_phone
        acc = st.new_account(phone=phone) if new else st.accounts[st.by_phone[phone]]
        _ensure_active(acc)
        return SessionOut(token=st.open_session(acc, now), account_id=acc.id, method="telephone", new_account=new)


@router.post("/pro/auth/inscription", response_model=SessionOut, status_code=201)
def register(body: RegisterIn, st: PS, now: Now) -> SessionOut:
    email = body.email.lower()
    phone = _phone(body.phone) if body.phone else None
    with st.lock:
        if email in st.by_email:
            raise HTTPException(409, "Un compte existe déjà avec cet e-mail. Connectez-vous.")
        if phone and phone in st.by_phone:
            raise HTTPException(409, "Ce numéro est déjà rattaché à un compte. Connectez-vous par code.")
        acc = st.new_account(email=email, password=hash_password(body.password), phone=phone)
        return SessionOut(token=st.open_session(acc, now), account_id=acc.id, method="email", new_account=True)


@router.post("/pro/auth/connexion", response_model=SessionOut)
def login(body: LoginIn, st: PS, now: Now) -> SessionOut:
    acc_id = st.by_email.get(body.email.lower())
    acc = st.accounts.get(acc_id) if acc_id else None
    # Vérification à coût constant, que le compte existe ou non
    ok = check_password(body.password, acc.password if acc and acc.password else hash_password("x"))
    if not (acc and acc.password and ok):
        raise HTTPException(401, "E-mail ou mot de passe incorrect.")
    _ensure_active(acc)
    return SessionOut(token=st.open_session(acc, now), account_id=acc.id, method="email", new_account=False)


@router.post("/pro/auth/deconnexion", status_code=204)
def logout(st: PS, authorization: Annotated[str | None, Header()] = None) -> None:
    if authorization and authorization.startswith("Bearer "):
        st.sessions.pop(_mac(authorization[7:]), None)


# ── Référentiel partenaire ────────────────────────────────────────────────
@router.get("/pro/referentiel")
def pro_referentiel() -> dict:
    return {"activites": CATEGORIES, "modeles": TEMPLATES, "communes": COMMUNES, "documents": DOCUMENTS}


# ── Fiche établissement (brouillon) ──────────────────────────────────────
HM = Annotated[str, Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")]


class ServiceIn(BaseModel):
    id: str = Field(pattern=r"^[a-z0-9-]{2,40}$")
    template: str | None = None
    name: str = Field(min_length=2, max_length=80)
    section: str = Field(min_length=2, max_length=40)
    duration: int = Field(ge=15, le=600)
    price: float | None = Field(None, ge=0, le=5000)
    price_from: bool = False
    pose: tuple[int, int] | None = None
    home_ok: bool = False
    online: bool = True
    description: str = Field("", max_length=300)


class StaffIn(BaseModel):
    id: str = Field(pattern=r"^[a-z0-9-]{2,40}$")
    name: str = Field(min_length=1, max_length=40)
    home: bool = False
    skills: list[str] = []
    hours: dict[int, list[tuple[HM, HM]]] = {}


class DocumentsIn(BaseModel):
    siret: str | None = None
    rc_pro: str | None = None  # nom du fichier déposé
    rc_pro_expiry: date | None = None
    diplome: str | None = None


class DraftIn(BaseModel):
    activity: str | None = None
    other_activities: list[str] = []
    name: str | None = Field(None, max_length=60)
    territory: Territory | None = None
    commune: str | None = None
    address: str | None = Field(None, max_length=140)
    about: str | None = Field(None, max_length=900)
    price_level: int | None = Field(None, ge=1, le=4)
    deposit_pct: int = Field(0, ge=0, le=50)
    home_zones: dict[str, int] = {}
    services: list[ServiceIn] = []
    staff: list[StaffIn] = []
    documents: DocumentsIn = DocumentsIn()


def _hm(s: str) -> int:
    h, m = s.split(":")
    return int(h) * 60 + int(m)


def check_draft(d: DraftIn, today: date, documents: bool = True) -> list[str]:
    """Liste des points bloquants, formulés pour le prestataire. Vide = prête à soumettre."""
    miss: list[str] = []
    if d.activity not in CATEGORIES:
        miss.append("Choisissez votre activité principale.")
    if any(a not in CATEGORIES for a in d.other_activities):
        miss.append("Une activité secondaire est inconnue.")
    if not d.name or len(d.name.strip()) < 2:
        miss.append("Indiquez le nom de l'établissement.")
    if not d.territory:
        miss.append("Choisissez le territoire.")
    elif d.commune not in COMMUNES[d.territory]:
        miss.append("Choisissez la commune de l'établissement.")
    if not d.address or len(d.address.strip()) < 8:
        miss.append("Indiquez l'adresse complète.")
    if not d.about or len(d.about.strip()) < 40:
        miss.append("Présentez l'établissement en quelques phrases (40 caractères minimum).")
    if not d.price_level:
        miss.append("Indiquez la gamme de prix.")
    if d.territory:
        bad = [c for c in d.home_zones if c not in COMMUNES[d.territory]]
        if bad:
            miss.append(f"Commune desservie inconnue : {', '.join(bad)}.")
    if any(not 5 <= t <= 120 for t in d.home_zones.values()):
        miss.append("Temps de trajet à domicile : entre 5 et 120 minutes.")

    if not d.services:
        miss.append("Ajoutez au moins une prestation.")
    ids = [s.id for s in d.services]
    if len(ids) != len(set(ids)):
        miss.append("Deux prestations portent le même identifiant.")
    for s in d.services:
        if s.duration % STEP_MIN:
            miss.append(f"« {s.name} » : durée par tranches de 15 minutes.")
        if s.pose and not (0 < s.pose[0] and 0 < s.pose[1] and s.pose[0] + s.pose[1] < s.duration):
            miss.append(f"« {s.name} » : le temps de pose doit tenir dans la prestation.")
        if s.price is None and not s.price_from:
            miss.append(f"« {s.name} » : indiquez un prix ou cochez « sur devis ».")
        if s.home_ok and not d.home_zones:
            miss.append(f"« {s.name} » est proposée à domicile : ajoutez au moins une commune desservie.")

    if not d.staff:
        miss.append("Ajoutez au moins un membre de l'équipe.")
    online = {s.id for s in d.services if s.online}
    covered: set[str] = set()
    for p in d.staff:
        unknown = set(p.skills) - set(ids)
        if unknown:
            miss.append(f"{p.name} : prestation inconnue ({', '.join(sorted(unknown))}).")
        covered |= set(p.skills)
        if not any(p.hours.get(i) for i in range(7)):
            miss.append(f"{p.name} : renseignez au moins un jour de travail.")
        for wd, ivs in p.hours.items():
            if wd not in range(7):
                miss.append(f"{p.name} : jour invalide.")
                continue
            prev = -1
            for a, b in sorted((_hm(x), _hm(y)) for x, y in ivs):
                if b <= a or a < prev or a % STEP_MIN or b % STEP_MIN:
                    miss.append(f"{p.name} : horaires incohérents le {['lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche'][wd]}.")
                    break
                prev = b
    orphan = online - covered
    if orphan:
        names = [s.name for s in d.services if s.id in orphan]
        miss.append(f"Personne ne réalise : {', '.join(names)}.")
    if any(s.home_ok for s in d.services) and not any(p.home for p in d.staff):
        miss.append("Une prestation est proposée à domicile mais personne ne se déplace.")

    if not documents:
        return list(dict.fromkeys(miss))
    doc = d.documents
    if not doc.siret or not siret_ok(doc.siret):
        miss.append("Numéro SIRET invalide (14 chiffres).")
    if not doc.rc_pro:
        miss.append("Déposez l'attestation d'assurance RC Pro.")
    elif not doc.rc_pro_expiry or doc.rc_pro_expiry <= today:
        miss.append("Indiquez une date de fin de validité de l'assurance RC Pro à venir.")
    return list(dict.fromkeys(miss))


def build_salon(d: DraftIn, slug: str) -> Salon:
    services = tuple(
        Service(id=s.id, name=s.name, category=s.section, duration=s.duration,
                price_cents=None if s.price is None else round(s.price * 100), price_from=s.price_from,
                pose=s.pose, home_ok=s.home_ok, online=s.online, description=s.description)
        for s in d.services
    )
    staff = tuple(
        Staff(id=p.id, name=p.name, skills=frozenset(p.skills), home=p.home,
              hours={wd: tuple(sorted((_hm(a), _hm(b)) for a, b in ivs)) for wd, ivs in p.hours.items() if ivs})
        for p in d.staff
    )
    return Salon(slug=slug, name=d.name.strip(), territory=d.territory, commune=d.commune, category=d.activity,
                 staff=staff, services=services, home_zones=dict(d.home_zones), deposit_pct=d.deposit_pct)


class ApplicationOut(BaseModel):
    id: str
    status: AppStatus
    draft: DraftIn
    missing: list[str]
    reason: str | None
    slug: str | None
    submitted_at: datetime | None
    decided_at: datetime | None


def _out(app: Application, today: date) -> ApplicationOut:
    d = DraftIn.model_validate(app.draft)
    return ApplicationOut(id=app.id, status=app.status, draft=d, missing=check_draft(d, today), reason=app.reason,
                          slug=app.slug, submitted_at=app.submitted_at, decided_at=app.decided_at)


@router.get("/pro/etablissement", response_model=ApplicationOut)
def get_draft(me: Me, st: PS, now: Now) -> ApplicationOut:
    return _out(st.application(me.id), now.date())


@router.put("/pro/etablissement", response_model=ApplicationOut)
def save_draft(body: DraftIn, me: Me, st: PS, now: Now) -> ApplicationOut:
    with st.lock:
        app = st.application(me.id)
        if app.status is AppStatus.REVIEW:
            raise HTTPException(409, "Votre demande est en cours de vérification ; elle ne peut pas être modifiée.")
        app.draft = body.model_dump(mode="json")
        app.updated_at = now
        if app.status is AppStatus.REJECTED:
            app.status = AppStatus.DRAFT
        return _out(app, now.date())


@router.post("/pro/etablissement/soumettre", response_model=ApplicationOut)
def submit(me: Me, st: PS, now: Now) -> ApplicationOut:
    with st.lock:
        app = st.application(me.id)
        if app.status is not AppStatus.DRAFT:
            raise HTTPException(409, "Cette demande a déjà été soumise.")
        d = DraftIn.model_validate(app.draft)
        miss = check_draft(d, now.date())
        if miss:
            raise HTTPException(422, {"message": "Fiche incomplète.", "missing": miss})
        try:
            build_salon(d, "controle")  # mêmes invariants que le moteur
        except ValueError as e:
            raise HTTPException(422, {"message": "Fiche incohérente.", "missing": [str(e)]}) from None
        app.status, app.submitted_at, app.reason = AppStatus.REVIEW, now, None
        return _out(app, now.date())


# ── Validation par l'équipe BeautyMe ─────────────────────────────────────
class DecisionIn(BaseModel):
    reason: str | None = Field(None, max_length=500)


@router.get("/admin/demandes", dependencies=[Depends(require_admin)])
def list_applications(st: PS, now: Now, status: AppStatus | None = AppStatus.REVIEW) -> list[ApplicationOut]:
    apps = [a for a in st.apps.values() if status is None or a.status is status]
    apps.sort(key=lambda a: a.submitted_at or a.updated_at)
    return [_out(a, now.date()) for a in apps]


def _find(st: ProStore, app_id: str) -> Application:
    for a in st.apps.values():
        if a.id == app_id:
            return a
    raise HTTPException(404, "Demande introuvable.")


@router.post("/admin/demandes/{app_id}/valider", response_model=ApplicationOut, dependencies=[Depends(require_admin)])
def approve(app_id: str, st: PS, now: Now, ast: AS) -> ApplicationOut:
    with st.lock:
        app = _find(st, app_id)
        if app.status is not AppStatus.REVIEW:
            raise HTTPException(409, "Seule une demande en cours de vérification peut être validée.")
        d = DraftIn.model_validate(app.draft)
        base = slugify(f"{d.name}-{d.commune}")
        slug, n = base, 2
        while slug in SALONS:
            slug, n = f"{base}-{n}", n + 1
        SALONS[slug] = build_salon(d, slug)
        META[slug] = {"rating": 0.0, "reviews": 0, "price": d.price_level, "address": d.address, "about": d.about,
                      "owner": app.account_id, "others": list(d.other_activities)}
        app.status, app.slug, app.decided_at = AppStatus.APPROVED, slug, now
        acc = st.accounts[app.account_id]
        st.outbox.append({"to": acc.phone or acc.email, "channel": "whatsapp" if acc.phone else "email",
                          "text": f"BeautyMe : {d.name} est en ligne. Vos clients peuvent réserver dès maintenant."})
    ast.record("demande validée", f"{d.name} ({slug}) publié", now)
    return _out(app, now.date())


@router.post("/admin/demandes/{app_id}/refuser", response_model=ApplicationOut, dependencies=[Depends(require_admin)])
def reject(app_id: str, body: DecisionIn, st: PS, now: Now, ast: AS) -> ApplicationOut:
    if not body.reason or len(body.reason.strip()) < 10:
        raise HTTPException(422, "Expliquez au prestataire ce qu'il doit corriger (10 caractères minimum).")
    with st.lock:
        app = _find(st, app_id)
        if app.status is not AppStatus.REVIEW:
            raise HTTPException(409, "Seule une demande en cours de vérification peut être refusée.")
        app.status, app.reason, app.decided_at = AppStatus.REJECTED, body.reason.strip(), now
    ast.record("demande refusée", f"{app.draft.get('name') or app.id} : {body.reason.strip()}", now)
    return _out(app, now.date())
