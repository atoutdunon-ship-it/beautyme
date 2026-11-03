"""BeautyMe — moteur de créneaux.

Pur, sans I/O, testable unitairement. Toutes les heures sont exprimées en minutes
depuis minuit, dans le fuseau du salon (America/Martinique, America/Guadeloupe,
America/Cayenne). La conversion vers UTC n'a lieu qu'aux bords (API, base).

Règles métier couvertes :
- enchaînement de plusieurs prestations ;
- temps de pose : le collaborateur est libre pendant la pose (coloration, lissage…) ;
- prestation à domicile : trajet aller/retour bloqué, zone desservie obligatoire ;
- « sans préférence » : attribution au collaborateur le moins chargé ;
- délai de prévenance minimal sur le jour même.
"""
from __future__ import annotations

from bisect import bisect_left
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from enum import StrEnum
from zoneinfo import ZoneInfo

STEP_MIN = 15
DEFAULT_LEAD_MIN = 60

Interval = tuple[int, int]  # [début, fin) en minutes locales


class Territory(StrEnum):
    MQ = "MQ"
    GP = "GP"
    GF = "GF"


TERRITORY_TZ: dict[Territory, ZoneInfo] = {
    Territory.MQ: ZoneInfo("America/Martinique"),
    Territory.GP: ZoneInfo("America/Guadeloupe"),
    Territory.GF: ZoneInfo("America/Cayenne"),
}


class Mode(StrEnum):
    SALON = "salon"
    HOME = "domicile"


@dataclass(frozen=True, slots=True)
class Service:
    id: str
    name: str
    category: str
    duration: int
    price_cents: int | None
    price_from: bool = False
    pose: Interval | None = None  # (décalage, durée) pendant laquelle le pro est libre
    home_ok: bool = False
    online: bool = True
    description: str = ""

    def __post_init__(self) -> None:
        if self.duration <= 0 or self.duration % STEP_MIN:
            raise ValueError(f"{self.id}: durée multiple de {STEP_MIN} min attendue")
        if self.pose:
            off, ln = self.pose
            if off <= 0 or ln <= 0 or off + ln >= self.duration:
                raise ValueError(f"{self.id}: temps de pose hors de la prestation")

    def active_segments(self, start: int) -> list[Interval]:
        """Segments pendant lesquels le collaborateur est mobilisé."""
        if not self.pose:
            return [(start, start + self.duration)]
        off, ln = self.pose
        return [(start, start + off), (start + off + ln, start + self.duration)]


@dataclass(frozen=True, slots=True)
class Staff:
    id: str
    name: str
    skills: frozenset[str]  # identifiants de prestations
    hours: Mapping[int, tuple[Interval, ...]]  # 0 = lundi
    home: bool = False

    def shifts(self, day: date) -> tuple[Interval, ...]:
        return self.hours.get(day.weekday(), ())


@dataclass(frozen=True, slots=True)
class Salon:
    slug: str
    name: str
    territory: Territory
    commune: str
    category: str
    staff: tuple[Staff, ...]
    services: tuple[Service, ...]
    home_zones: Mapping[str, int] = field(default_factory=dict)  # commune -> trajet (min)
    deposit_pct: int = 0

    @property
    def tz(self) -> ZoneInfo:
        return TERRITORY_TZ[self.territory]

    def service(self, sid: str) -> Service:
        for s in self.services:
            if s.id == sid:
                return s
        raise KeyError(sid)

    def staff_member(self, sid: str) -> Staff:
        for s in self.staff:
            if s.id == sid:
                return s
        raise KeyError(sid)


@dataclass(frozen=True, slots=True)
class Plan:
    """Empreinte d'une réservation, relative à son heure de début."""

    active: tuple[Interval, ...]
    span: int  # durée totale occupée, trajets compris
    travel: int

    def at(self, start: int) -> list[Interval]:
        return [(start + a, start + b) for a, b in self.active]


@dataclass(frozen=True, slots=True)
class Slot:
    start: datetime  # aware, fuseau du salon
    staff_id: str
    end: datetime
    segments: tuple[Interval, ...]  # segments actifs en minutes locales


class BookingError(ValueError):
    pass


def build_plan(salon: Salon, service_ids: Sequence[str], mode: Mode, commune: str | None) -> Plan:
    if not service_ids:
        raise BookingError("Choisissez au moins une prestation.")
    services = [salon.service(s) for s in service_ids]
    if any(not s.online for s in services):
        raise BookingError("Une des prestations se réserve uniquement par téléphone.")

    travel = 0
    if mode is Mode.HOME:
        if any(not s.home_ok for s in services):
            raise BookingError("Une des prestations n'est pas proposée à domicile.")
        if commune not in salon.home_zones:
            raise BookingError(f"{salon.name} ne se déplace pas à {commune or 'cette adresse'}.")
        travel = salon.home_zones[commune]
        travel = -(-travel // STEP_MIN) * STEP_MIN  # arrondi au pas supérieur

    active: list[Interval] = []
    cursor = 0
    if travel:
        active.append((0, travel))
        cursor = travel
    for s in services:
        active.extend(s.active_segments(cursor))
        cursor += s.duration
    if travel:
        active.append((cursor, cursor + travel))
        cursor += travel
    return Plan(active=tuple(_merge(active)), span=cursor, travel=travel)


def _merge(ivs: Iterable[Interval]) -> list[Interval]:
    out: list[Interval] = []
    for a, b in sorted(ivs):
        if out and a <= out[-1][1]:
            out[-1] = (out[-1][0], max(out[-1][1], b))
        else:
            out.append((a, b))
    return out


def _is_free(busy: Sequence[Interval], seg: Interval) -> bool:
    """`busy` trié et fusionné : recherche dichotomique, O(log n)."""
    a, b = seg
    i = bisect_left(busy, (a, a))
    if i and busy[i - 1][1] > a:
        return False
    return not (i < len(busy) and busy[i][0] < b)


def _within(shifts: Sequence[Interval], a: int, b: int) -> bool:
    return any(s <= a and b <= e for s, e in shifts)


def eligible_staff(salon: Salon, service_ids: Sequence[str], mode: Mode) -> list[Staff]:
    need = set(service_ids)
    return [s for s in salon.staff if need <= s.skills and (mode is Mode.SALON or s.home)]


def find_slots(
    salon: Salon,
    service_ids: Sequence[str],
    day: date,
    busy: Mapping[str, Sequence[Interval]],
    *,
    staff_id: str | None = None,
    mode: Mode = Mode.SALON,
    commune: str | None = None,
    now: datetime | None = None,
    lead_min: int = DEFAULT_LEAD_MIN,
) -> list[Slot]:
    plan = build_plan(salon, service_ids, mode, commune)
    pool = eligible_staff(salon, service_ids, mode)
    if staff_id:
        pool = [s for s in pool if s.id == staff_id]
    if not pool:
        return []

    tz = salon.tz
    floor = 0
    if now is not None:
        local_now = now.astimezone(tz)
        if local_now.date() > day:
            return []
        if local_now.date() == day:
            floor = local_now.hour * 60 + local_now.minute + lead_min
    floor = -(-floor // STEP_MIN) * STEP_MIN

    norm_busy = {s.id: _merge(busy.get(s.id, ())) for s in pool}
    load = {sid: sum(b - a for a, b in ivs) for sid, ivs in norm_busy.items()}
    pool.sort(key=lambda s: (load[s.id], s.id))  # équilibrage de charge

    lo = min((a for s in pool for a, _ in s.shifts(day)), default=None)
    hi = max((b for s in pool for _, b in s.shifts(day)), default=None)
    if lo is None or hi is None:
        return []

    midnight = datetime.combine(day, time.min, tzinfo=tz)
    slots: list[Slot] = []
    for t in range(max(lo, floor), hi - plan.span + 1, STEP_MIN):
        segs = plan.at(t)
        for s in pool:
            if not _within(s.shifts(day), t, t + plan.span):
                continue
            if all(_is_free(norm_busy[s.id], g) for g in segs):
                slots.append(
                    Slot(
                        start=midnight + timedelta(minutes=t),
                        end=midnight + timedelta(minutes=t + plan.span),
                        staff_id=s.id,
                        segments=tuple(segs),
                    )
                )
                break
    return slots


# ---------------------------------------------------------------------------
# Occupation de démonstration, déterministe et identique côté navigateur
# (même hachage FNV-1a + PRNG mulberry32 que le prototype web).
# ---------------------------------------------------------------------------
def _fnv1a(s: str) -> int:
    h = 0x811C9DC5
    for ch in s.encode():
        h ^= ch
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def _mulberry32(seed: int):
    a = seed & 0xFFFFFFFF

    def nxt() -> float:
        nonlocal a
        a = (a + 0x6D2B79F5) & 0xFFFFFFFF
        t = a
        t = ((t ^ (t >> 15)) * (t | 1)) & 0xFFFFFFFF
        t ^= (t + (((t ^ (t >> 7)) * (t | 61)) & 0xFFFFFFFF)) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296

    return nxt


def demo_busy(salon: Salon, staff: Staff, day: date) -> list[Interval]:
    rnd = _mulberry32(_fnv1a(f"{salon.slug}|{staff.id}|{day.isoformat()}"))
    out: list[Interval] = []
    for a, b in staff.shifts(day):
        t = a
        while t < b:
            if rnd() < 0.3:
                ln = (2 + int(rnd() * 6)) * STEP_MIN
                out.append((t, min(b, t + ln)))
                t += ln
            else:
                t += (1 + int(rnd() * 3)) * STEP_MIN
    return out
