from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

import adminauth
import main
import pro
from seed import INACTIVE, META, SALONS
from store import Store

NOW = datetime(2026, 11, 2, 12, tzinfo=timezone.utc)


@pytest.fixture
def client():
    ps, st, ast = pro.ProStore(), Store(demo_occupancy=False), adminauth.AdminState()
    before = set(SALONS)
    main.app.dependency_overrides.update({
        pro.pro_store: lambda: ps, pro.now_dep: lambda: NOW,
        main.store: lambda: st, main.now_utc: lambda: NOW,
        adminauth.admin_state: lambda: ast, adminauth.admin_now: lambda: NOW,
    })
    c = TestClient(main.app)
    c.ps, c.ast = ps, ast
    tok = c.post("/v1/admin/connexion", json={"login": "ADMIN", "password": "MUSIC7"}).json()["token"]
    c.admin = {"Authorization": "Bearer " + tok}
    yield c
    main.app.dependency_overrides.clear()
    for k in set(SALONS) - before:
        SALONS.pop(k)
        META.pop(k, None)
    INACTIVE.clear()


def login_phone(c, phone="0696 12 34 56"):
    assert c.post("/v1/pro/auth/code", json={"phone": phone}).status_code == 202
    r = c.post("/v1/pro/auth/code/verifier", json={"phone": phone, "code": "2026"})
    assert r.status_code == 200
    return {"Authorization": "Bearer " + r.json()["token"]}


DRAFT = {
    "activity": "tresses-locks", "other_activities": ["coiffure"],
    "name": "Atelier Zétwal", "territory": "MQ", "commune": "Le Robert",
    "address": "12 rue de la Mairie, 97231 Le Robert",
    "about": "Tresses, locks et soins des cheveux texturés, au salon ou chez vous dans le Nord Atlantique.",
    "price_level": 2, "deposit_pct": 20, "home_zones": {"Le Robert": 10, "La Trinité": 20},
    "services": [
        {"id": "tresses-collees", "template": "tresses-collees", "name": "Tresses collées", "section": "Tresses",
         "duration": 150, "price": 70, "home_ok": True},
        {"id": "soin", "name": "Soin cuir chevelu", "section": "Soins", "duration": 45, "price": 30, "pose": [15, 15]},
    ],
    "staff": [{"id": "lea", "name": "Léa", "home": True, "skills": ["tresses-collees", "soin"],
               "hours": {"1": [["08:00", "12:00"], ["13:30", "18:00"]], "5": [["08:00", "14:00"]]}}],
    "documents": {"siret": "732 829 320 00074", "rc_pro": "attestation-rcpro.pdf", "rc_pro_expiry": "2027-06-30"},
}


def test_phone_normalization():
    assert pro.normalize_phone("0696 12 34 56") == "+596696123456"
    assert pro.normalize_phone("0690123456") == "+590690123456"
    assert pro.normalize_phone("06 94 12 34 56") == "+594694123456"
    assert pro.normalize_phone("0612345678") == "+33612345678"
    with pytest.raises(ValueError):
        pro.normalize_phone("12345")


def test_siret_luhn():
    assert pro.siret_ok("73282932000074") and not pro.siret_ok("73282932000075")


def test_otp_wrong_code_and_resend_limit(client):
    client.post("/v1/pro/auth/code", json={"phone": "0696000001"})
    assert client.post("/v1/pro/auth/code", json={"phone": "0696000001"}).status_code == 429
    r = client.post("/v1/pro/auth/code/verifier", json={"phone": "0696000001", "code": "1111"})
    assert r.status_code == 401 and "4 essai" in r.json()["detail"]


def test_email_register_and_login(client):
    r = client.post("/v1/pro/auth/inscription", json={"email": "Pro@Exemple.fr", "password": "motdepasse26"})
    assert r.status_code == 201
    assert client.post("/v1/pro/auth/inscription", json={"email": "pro@exemple.fr", "password": "autremdp2026"}).status_code == 409
    assert client.post("/v1/pro/auth/connexion", json={"email": "pro@exemple.fr", "password": "mauvais2026"}).status_code == 401
    assert client.post("/v1/pro/auth/connexion", json={"email": "pro@exemple.fr", "password": "motdepasse26"}).status_code == 200
    weak = client.post("/v1/pro/auth/inscription", json={"email": "b@exemple.fr", "password": "seulementlettres"})
    assert weak.status_code == 422


def test_requires_session(client):
    assert client.get("/v1/pro/etablissement").status_code == 401


def test_incomplete_draft_lists_what_is_missing(client):
    h = login_phone(client)
    r = client.put("/v1/pro/etablissement", json={"activity": "barbier"}, headers=h).json()
    assert r["status"] == "brouillon" and "Indiquez le nom de l'établissement." in r["missing"]
    s = client.post("/v1/pro/etablissement/soumettre", headers=h)
    assert s.status_code == 422 and s.json()["detail"]["missing"]


def test_business_rules(client):
    h = login_phone(client)
    bad = {**DRAFT, "services": [{**DRAFT["services"][0], "duration": 140}, DRAFT["services"][1]],
           "staff": [{**DRAFT["staff"][0], "home": False, "skills": ["soin"]}],
           "documents": {"siret": "73282932000075", "rc_pro": "a.pdf", "rc_pro_expiry": "2026-01-01"}}
    miss = client.put("/v1/pro/etablissement", json=bad, headers=h).json()["missing"]
    joined = " | ".join(miss)
    for frag in ("tranches de 15 minutes", "Personne ne réalise", "personne ne se déplace", "SIRET invalide", "à venir"):
        assert frag in joined, frag


def test_full_journey_submit_review_publish_book(client):
    h = login_phone(client)
    r = client.put("/v1/pro/etablissement", json=DRAFT, headers=h).json()
    assert r["missing"] == []
    assert client.post("/v1/pro/etablissement/soumettre", headers=h).json()["status"] == "en_revue"
    assert client.put("/v1/pro/etablissement", json=DRAFT, headers=h).status_code == 409
    assert client.get("/v1/admin/demandes").status_code == 401

    queue = client.get("/v1/admin/demandes", headers=client.admin).json()
    assert len(queue) == 1
    ok = client.post(f"/v1/admin/demandes/{queue[0]['id']}/valider", headers=client.admin).json()
    assert ok["status"] == "valide" and ok["slug"] == "atelier-zetwal-le-robert"

    found = client.get("/v1/salons", params={"territory": "MQ", "domicile": True, "commune": "La Trinité"}).json()
    assert "atelier-zetwal-le-robert" in {c["slug"] for c in found}
    slots = client.get("/v1/salons/atelier-zetwal-le-robert/disponibilites",
                       params={"services": "tresses-collees", "date": "2026-11-03", "mode": "domicile", "commune": "La Trinité"}).json()
    assert slots and slots[0]["start"].startswith("2026-11-03T08:00:00-04:00")
    assert any("est en ligne" in m["text"] for m in client.ps.outbox)


def test_reject_then_resubmit(client):
    h = login_phone(client)
    client.put("/v1/pro/etablissement", json=DRAFT, headers=h)
    app_id = client.post("/v1/pro/etablissement/soumettre", headers=h).json()["id"]
    assert client.post(f"/v1/admin/demandes/{app_id}/refuser", json={"reason": "court"}, headers=client.admin).status_code == 422
    r = client.post(f"/v1/admin/demandes/{app_id}/refuser", json={"reason": "Attestation RC Pro illisible, merci de la redéposer."}, headers=client.admin)
    assert r.json()["status"] == "refuse"
    mine = client.get("/v1/pro/etablissement", headers=h).json()
    assert mine["reason"].startswith("Attestation")
    assert client.put("/v1/pro/etablissement", json=DRAFT, headers=h).json()["status"] == "brouillon"
    assert client.post("/v1/pro/etablissement/soumettre", headers=h).json()["status"] == "en_revue"
