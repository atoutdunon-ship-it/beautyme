from datetime import date, datetime, timezone

import pytest
from fastapi.testclient import TestClient

import main
from engine import BookingError, Mode, Salon, Service, Staff, Territory, build_plan, find_slots
from seed import SALONS, hours
from store import Store

TUE = date(2026, 11, 3)  # mardi


def mk(services, team, **kw) -> Salon:
    return Salon(slug="t", name="Test", territory=Territory.MQ, commune="Fort-de-France",
                 category="coiffure", staff=tuple(team), services=tuple(services), **kw)


COL = Service("col", "Coloration", "Couleur", 90, 6000, pose=(30, 30))
CUT = Service("cut", "Coupe", "Coupes", 30, 2500, home_ok=True)
A = Staff("a", "Ana", frozenset({"col", "cut"}), hours("mar-sam 09:00-12:00"), home=True)
B = Staff("b", "Ben", frozenset({"cut"}), hours("mar-sam 09:00-12:00"))


def starts(slots):
    return [s.start.strftime("%H:%M") for s in slots]


def test_empty_day_returns_every_step():
    s = mk([CUT], [A])
    assert starts(find_slots(s, ["cut"], TUE, {}))[:3] == ["09:00", "09:15", "09:30"]
    assert starts(find_slots(s, ["cut"], TUE, {}))[-1] == "11:30"


def test_closed_day():
    assert find_slots(mk([CUT], [A]), ["cut"], date(2026, 11, 2), {}) == []  # lundi


def test_pose_frees_staff_for_another_client():
    s = mk([COL, CUT], [A])
    col = find_slots(s, ["col"], TUE, {})[0]
    assert col.segments == ((540, 570), (600, 630))  # 9:00-9:30 et 10:00-10:30
    cut = find_slots(s, ["cut"], TUE, {"a": list(col.segments)})
    assert "09:30" in starts(cut)  # coupe glissée pendant la pose


def test_sequence_and_staff_fallback():
    s = mk([COL, CUT], [A, B])
    slots = find_slots(s, ["cut", "col"], TUE, {"a": [(540, 600)]})
    assert slots[0].start.strftime("%H:%M") == "10:00" and slots[0].staff_id == "a"


def test_load_balancing_prefers_least_busy():
    s = mk([CUT], [A, B])
    assert find_slots(s, ["cut"], TUE, {"a": [(660, 690)]})[0].staff_id == "b"


def test_home_mode_requires_zone_and_blocks_travel():
    s = mk([CUT], [A, B], home_zones={"Schœlcher": 20})
    with pytest.raises(BookingError):
        build_plan(s, ["cut"], Mode.HOME, "Le Robert")
    p = build_plan(s, ["cut"], Mode.HOME, "Schœlcher")
    assert (p.travel, p.span, p.active) == (30, 90, ((0, 90),))  # 20 min arrondi à 30
    slots = find_slots(s, ["cut"], TUE, {}, mode=Mode.HOME, commune="Schœlcher")
    assert {x.staff_id for x in slots} == {"a"}  # Ben ne se déplace pas


def test_lead_time_uses_salon_timezone():
    s = mk([CUT], [A])
    now = datetime(2026, 11, 3, 13, 40, tzinfo=timezone.utc)  # 09:40 en Martinique
    assert starts(find_slots(s, ["cut"], TUE, {}, now=now))[0] == "10:45"


def test_guyane_is_utc_minus_3():
    s = SALONS["atelier-maripa-cayenne"]
    slot = find_slots(s, ["ch"], TUE, {})[0]
    assert slot.start.utcoffset().total_seconds() == -3 * 3600


def test_offline_service_rejected():
    with pytest.raises(BookingError):
        build_plan(SALONS["kaz-bien-etre-le-diamant"], ["md"], Mode.SALON, None)


# ── API ───────────────────────────────────────────────────────────────────
@pytest.fixture
def client():
    st = Store(demo_occupancy=False)
    main.app.dependency_overrides[main.store] = lambda: st
    main.app.dependency_overrides[main.now_utc] = lambda: datetime(2026, 11, 2, 12, tzinfo=timezone.utc)
    yield TestClient(main.app)
    main.app.dependency_overrides.clear()


def test_search_filters_home_service(client):
    r = client.get("/v1/salons", params={"territory": "GP", "domicile": True, "commune": "Le Gosier"})
    assert {c["slug"] for c in r.json()} == {"institut-le-gosier", "natty-locks-sainte-anne"}


def test_full_booking_flow_and_double_booking_blocked(client):
    slug = "atelier-du-lamentin"
    slots = client.get(f"/v1/salons/{slug}/disponibilites",
                       params={"services": "cbh", "date": "2026-11-03", "staff": "yannick"}).json()
    first = slots[0]
    body = {"salon": slug, "services": ["cbh"], "start": first["start"], "staff_id": "yannick"}
    h = client.post("/v1/holds", json=body)
    assert h.status_code == 201 and h.json()["status"] == "held"
    assert client.post("/v1/holds", json=body).status_code == 409
    c = client.post("/v1/bookings", json={"hold_id": h.json()["id"],
                    "customer": {"first_name": "Léa", "phone": "0696 12 34 56"}})
    assert c.status_code == 200 and c.json()["status"] == "confirmed"


def test_home_booking_requires_address(client):
    slug = "kaz-bien-etre-le-diamant"
    slot = client.get(f"/v1/salons/{slug}/disponibilites", params={
        "services": "mr", "date": "2026-11-03", "mode": "domicile", "commune": "Sainte-Luce"}).json()[0]
    h = client.post("/v1/holds", json={"salon": slug, "services": ["mr"], "start": slot["start"],
                                        "mode": "domicile", "commune": "Sainte-Luce"}).json()
    assert h["deposit_cents"] == 2100
    r = client.post("/v1/bookings", json={"hold_id": h["id"],
                    "customer": {"first_name": "Léa", "phone": "0696123456"}})
    assert r.status_code == 422
