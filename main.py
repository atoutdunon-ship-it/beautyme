"""BeautyMe — API de réservation beauté Antilles-Guyane.

    uvicorn main:app --reload        # http://127.0.0.1:8000/docs
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator

from engine import BookingError, Mode, Salon, Territory, build_plan, find_slots
from catalogue import COMMUNES
from seed import CATEGORIES, INACTIVE, META, SALONS, TERRITORIES
from admin import public as content_router
from admin import router as admin_router
from adminauth import router as admin_auth_router
from pro import router as pro_router
from store import Booking, Conflict, Store

app = FastAPI(title="BeautyMe API", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
for r in (pro_router, admin_auth_router, admin_router, content_router):
    app.include_router(r)

_store = Store()


def store() -> Store:
    return _store


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


StoreDep = Annotated[Store, Depends(store)]
NowDep = Annotated[datetime, Depends(now_utc)]


def get_salon(slug: str) -> Salon:
    try:
        return SALONS[slug]
    except KeyError:
        raise HTTPException(404, "Établissement introuvable.") from None


def bookable_salon(slug: str) -> Salon:
    s = get_salon(slug)
    if slug in INACTIVE:
        raise HTTPException(410, "Cet établissement n'accepte plus de réservations pour le moment.")
    return s


# ── Schémas ───────────────────────────────────────────────────────────────
class ServiceOut(BaseModel):
    id: str
    name: str
    category: str
    duration: int
    price_cents: int | None
    price_from: bool
    home_ok: bool
    online: bool
    description: str


class SalonCard(BaseModel):
    slug: str
    name: str
    territory: Territory
    commune: str
    category: str
    rating: float
    reviews: int
    price_level: int
    home_service: bool
    deposit_pct: int
    available_on_day: bool | None = None
    active: bool = True


class SalonDetail(SalonCard):
    address: str
    about: str
    timezone: str
    services: list[ServiceOut]
    staff: list[dict]
    home_zones: dict[str, int]


class SlotOut(BaseModel):
    start: datetime
    end: datetime
    staff_id: str


class HoldIn(BaseModel):
    salon: str
    services: list[str] = Field(min_length=1, max_length=6)
    start: datetime
    staff_id: str | None = None
    mode: Mode = Mode.SALON
    commune: str | None = None

    @field_validator("start")
    @classmethod
    def aware(cls, v: datetime) -> datetime:
        if v.tzinfo is None:
            raise ValueError("start doit porter un fuseau (ISO 8601 avec décalage).")
        return v


class Customer(BaseModel):
    first_name: str = Field(min_length=1, max_length=60)
    phone: str = Field(pattern=r"^\+?(590|594|596|33)?[0-9 ]{9,14}$")
    channel: Literal["whatsapp", "sms"] = "whatsapp"
    address: str | None = None


class ConfirmIn(BaseModel):
    hold_id: str
    customer: Customer


class BookingOut(BaseModel):
    id: str
    salon: str
    staff_id: str
    start: datetime
    end: datetime
    services: list[str]
    mode: Mode
    commune: str | None
    total_cents: int
    deposit_cents: int
    status: str
    expires_at: datetime | None


def _card(s: Salon) -> SalonCard:
    m = META[s.slug]
    return SalonCard(
        slug=s.slug, name=s.name, territory=s.territory, commune=s.commune, category=s.category,
        rating=m["rating"], reviews=m["reviews"], price_level=m["price"],
        home_service=bool(s.home_zones), deposit_pct=s.deposit_pct, active=s.slug not in INACTIVE,
    )


def _out(b: Booking) -> BookingOut:
    return BookingOut(
        id=b.id, salon=b.salon, staff_id=b.staff_id, start=b.start, end=b.end,
        services=list(b.services), mode=b.mode, commune=b.commune, total_cents=b.total_cents,
        deposit_cents=b.deposit_cents, status=b.status.value, expires_at=b.expires_at,
    )


# ── Routes ────────────────────────────────────────────────────────────────
@app.get("/v1/referentiel")
def referentiel() -> dict:
    return {"territoires": TERRITORIES, "categories": CATEGORIES, "communes": COMMUNES}


@app.get("/v1/salons", response_model=list[SalonCard])
def search(
    st: StoreDep,
    now: NowDep,
    territory: Territory | None = None,
    category: str | None = None,
    commune: str | None = None,
    domicile: bool = False,
    day: date | None = Query(None, alias="date"),
    q: str | None = Query(None, max_length=60),
) -> list[SalonCard]:
    out: list[SalonCard] = []
    for s in SALONS.values():
        if s.slug in INACTIVE:
            continue
        if territory and s.territory != territory:
            continue
        if category and s.category != category:
            continue
        if domicile:
            if not s.home_zones or (commune and commune not in s.home_zones):
                continue
        elif commune and s.commune != commune:
            continue
        if q and q.casefold() not in (s.name + " " + " ".join(v.name for v in s.services)).casefold():
            continue
        card = _card(s)
        if day:
            card.available_on_day = _has_any_slot(s, day, st, now, domicile, commune)
        out.append(card)
    out.sort(key=lambda c: (c.available_on_day is False, -c.rating * min(c.reviews, 500)))
    return out


def _has_any_slot(s: Salon, day: date, st: Store, now: datetime, home: bool, commune: str | None) -> bool:
    mode = Mode.HOME if home else Mode.SALON
    busy = st.busy(s, day, now)
    for v in sorted(s.services, key=lambda v: v.duration):
        try:
            if find_slots(s, [v.id], day, busy, mode=mode, commune=commune, now=now):
                return True
        except BookingError:
            continue
    return False


@app.get("/v1/salons/{slug}", response_model=SalonDetail)
def detail(slug: str) -> SalonDetail:
    s = get_salon(slug)
    m = META[slug]
    return SalonDetail(
        **_card(s).model_dump(),
        address=m["address"], about=m["about"], timezone=str(s.tz),
        services=[ServiceOut(**{k: getattr(v, k) for k in ServiceOut.model_fields}) for v in s.services],
        staff=[{"id": p.id, "name": p.name, "home": p.home, "skills": sorted(p.skills)} for p in s.staff],
        home_zones=dict(s.home_zones),
    )


@app.get("/v1/salons/{slug}/disponibilites", response_model=list[SlotOut])
def availability(
    slug: str,
    st: StoreDep,
    now: NowDep,
    services: Annotated[str, Query(description="Identifiants séparés par des virgules")],
    day: date = Query(alias="date"),
    staff: str | None = None,
    mode: Mode = Mode.SALON,
    commune: str | None = None,
) -> list[SlotOut]:
    s = bookable_salon(slug)
    ids = [x for x in services.split(",") if x]
    try:
        slots = find_slots(s, ids, day, st.busy(s, day, now), staff_id=staff, mode=mode, commune=commune, now=now)
    except (BookingError, KeyError) as e:
        raise HTTPException(422, str(e).strip("'")) from None
    return [SlotOut(start=x.start, end=x.end, staff_id=x.staff_id) for x in slots]


@app.post("/v1/holds", response_model=BookingOut, status_code=201)
def hold(body: HoldIn, st: StoreDep, now: NowDep) -> BookingOut:
    s = bookable_salon(body.salon)
    local = body.start.astimezone(s.tz)
    try:
        slots = find_slots(
            s, body.services, local.date(), st.busy(s, local.date(), now),
            staff_id=body.staff_id, mode=body.mode, commune=body.commune, now=now,
        )
    except (BookingError, KeyError) as e:
        raise HTTPException(422, str(e).strip("'")) from None
    slot = next((x for x in slots if x.start == local), None)
    if slot is None:
        raise HTTPException(409, "Ce créneau n'est plus disponible.")
    total = sum(s.service(i).price_cents or 0 for i in body.services)
    b = Booking(
        id="", salon=s.slug, staff_id=slot.staff_id, day=local.date(), start=slot.start, end=slot.end,
        segments=slot.segments, services=tuple(body.services), mode=body.mode, commune=body.commune,
        total_cents=total, deposit_cents=total * s.deposit_pct // 100,
    )
    try:
        return _out(st.hold(s, b, now))
    except Conflict as e:
        raise HTTPException(409, str(e)) from None


@app.post("/v1/bookings", response_model=BookingOut)
def confirm(body: ConfirmIn, st: StoreDep, now: NowDep) -> BookingOut:
    b = st.get(body.hold_id)
    if b and b.mode is Mode.HOME and not body.customer.address:
        raise HTTPException(422, "Indiquez l'adresse du rendez-vous à domicile.")
    try:
        return _out(st.confirm(body.hold_id, body.customer.model_dump(), now))
    except Conflict as e:
        raise HTTPException(409, str(e)) from None


@app.delete("/v1/bookings/{booking_id}", response_model=BookingOut)
def cancel(booking_id: str, st: StoreDep) -> BookingOut:
    try:
        return _out(st.cancel(booking_id))
    except KeyError:
        raise HTTPException(404, "Réservation introuvable.") from None


@app.get("/v1/plan")
def plan_preview(salon: str, services: str, mode: Mode = Mode.SALON, commune: str | None = None) -> dict:
    """Durée, trajets et tarif d'un panier, avant choix du créneau."""
    s = get_salon(salon)
    ids = [x for x in services.split(",") if x]
    try:
        p = build_plan(s, ids, mode, commune)
    except (BookingError, KeyError) as e:
        raise HTTPException(422, str(e).strip("'")) from None
    total = sum(s.service(i).price_cents or 0 for i in ids)
    return {"span_min": p.span, "travel_min": p.travel, "total_cents": total,
            "deposit_cents": total * s.deposit_pct // 100}
