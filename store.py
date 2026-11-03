"""Dépôt en mémoire, interface identique à la future implémentation PostgreSQL.

Garantie d'intégrité : toute écriture revalide les segments sous verrou, ce qui
reproduit la contrainte d'exclusion GiST de sql/schema.sql. En production, c'est
la base qui tranche (IntegrityError -> 409), le verrou applicatif disparaît.
"""
from __future__ import annotations

import secrets
import threading
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from enum import StrEnum

from engine import Interval, Mode, Salon, _is_free, _merge, demo_busy

HOLD_TTL = timedelta(minutes=10)


class Status(StrEnum):
    HELD = "held"
    CONFIRMED = "confirmed"
    CANCELLED = "cancelled"


@dataclass(slots=True)
class Booking:
    id: str
    salon: str
    staff_id: str
    day: date
    start: datetime
    end: datetime
    segments: tuple[Interval, ...]
    services: tuple[str, ...]
    mode: Mode
    commune: str | None
    total_cents: int
    deposit_cents: int
    status: Status = Status.HELD
    expires_at: datetime | None = None
    customer: dict = field(default_factory=dict)


class Conflict(Exception):
    pass


class Store:
    def __init__(self, demo_occupancy: bool = True) -> None:
        self._lock = threading.Lock()
        self._bookings: dict[str, Booking] = {}
        self._demo = demo_occupancy

    def _purge(self, now: datetime) -> None:
        for b in self._bookings.values():
            if b.status is Status.HELD and b.expires_at and b.expires_at <= now:
                b.status = Status.CANCELLED

    def busy(self, salon: Salon, day: date, now: datetime | None = None) -> dict[str, list[Interval]]:
        now = now or datetime.now(timezone.utc)
        with self._lock:
            self._purge(now)
            out: dict[str, list[Interval]] = {
                s.id: (demo_busy(salon, s, day) if self._demo else []) for s in salon.staff
            }
            for b in self._bookings.values():
                if b.salon == salon.slug and b.day == day and b.status is not Status.CANCELLED:
                    out.setdefault(b.staff_id, []).extend(b.segments)
            return {k: _merge(v) for k, v in out.items()}

    def hold(self, salon: Salon, b: Booking, now: datetime | None = None) -> Booking:
        now = now or datetime.now(timezone.utc)
        with self._lock:
            self._purge(now)
            taken = demo_busy(salon, salon.staff_member(b.staff_id), b.day) if self._demo else []
            taken += [
                seg
                for o in self._bookings.values()
                if o.salon == b.salon and o.staff_id == b.staff_id and o.day == b.day
                and o.status is not Status.CANCELLED
                for seg in o.segments
            ]
            merged = _merge(taken)
            if not all(_is_free(merged, g) for g in b.segments):
                raise Conflict("Ce créneau vient d'être réservé.")
            b.id = b.id or secrets.token_urlsafe(9)
            b.status = Status.HELD
            b.expires_at = now + HOLD_TTL
            self._bookings[b.id] = b
            return b

    def confirm(self, booking_id: str, customer: dict, now: datetime | None = None) -> Booking:
        now = now or datetime.now(timezone.utc)
        with self._lock:
            self._purge(now)
            b = self._bookings.get(booking_id)
            if not b or b.status is not Status.HELD:
                raise Conflict("La réservation a expiré. Choisissez à nouveau un créneau.")
            b.status, b.expires_at, b.customer = Status.CONFIRMED, None, customer
            return b

    def cancel(self, booking_id: str) -> Booking:
        with self._lock:
            b = self._bookings.get(booking_id)
            if not b:
                raise KeyError(booking_id)
            b.status = Status.CANCELLED
            return b

    def get(self, booking_id: str) -> Booking | None:
        return self._bookings.get(booking_id)
