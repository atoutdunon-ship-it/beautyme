import copy

from test_pro import DRAFT, NOW, client, login_phone  # noqa: F401  (fixture partagée)

from seed import INACTIVE, SALONS


def test_admin_login_rules(client):
    assert client.post("/v1/admin/connexion", json={"login": "ADMIN", "password": "music7"}).status_code == 401
    assert client.post("/v1/admin/connexion", json={"login": "admin", "password": "MUSIC7"}).status_code == 200
    for _ in range(5):
        client.post("/v1/admin/connexion", json={"login": "ADMIN", "password": "faux"})
    assert client.post("/v1/admin/connexion", json={"login": "ADMIN", "password": "MUSIC7"}).status_code == 429
    assert client.get("/v1/admin/etablissements").status_code == 401


def publish(client):
    h = login_phone(client)
    client.put("/v1/pro/etablissement", json=DRAFT, headers=h)
    app_id = client.post("/v1/pro/etablissement/soumettre", headers=h).json()["id"]
    client.post(f"/v1/admin/demandes/{app_id}/valider", headers=client.admin)
    return h, "atelier-zetwal-le-robert"


def test_deactivate_hides_blocks_login_keeps_bookings(client):
    h, slug = publish(client)
    slot = client.get(f"/v1/salons/{slug}/disponibilites", params={"services": "soin", "date": "2026-11-03"}).json()[0]
    hold = client.post("/v1/holds", json={"salon": slug, "services": ["soin"], "start": slot["start"]}).json()
    bk = client.post("/v1/bookings", json={"hold_id": hold["id"], "customer": {"first_name": "Léa", "phone": "0696123456"}}).json()
    assert bk["status"] == "confirmed"

    lst = {x["slug"]: x for x in client.get("/v1/admin/etablissements", headers=client.admin).json()}
    assert lst[slug]["source"] == "partenaire" and lst[slug]["owner"]["active"]
    r = client.post(f"/v1/admin/etablissements/{slug}/statut", json={"active": False, "reason": "Assurance expirée"}, headers=client.admin)
    assert r.json() == {"slug": slug, "active": False, "owner_active": False}

    assert slug not in {c["slug"] for c in client.get("/v1/salons", params={"territory": "MQ"}).json()}
    assert client.get(f"/v1/salons/{slug}").json()["active"] is False
    assert client.get(f"/v1/salons/{slug}/disponibilites", params={"services": "soin", "date": "2026-11-03"}).status_code == 410
    assert client.get("/v1/pro/etablissement", headers=h).status_code == 403
    client.post("/v1/pro/auth/code", json={"phone": "0696 12 34 56"})
    assert client.post("/v1/pro/auth/code/verifier", json={"phone": "0696 12 34 56", "code": "2026"}).status_code == 403
    assert client.delete(f"/v1/bookings/{bk['id']}").status_code == 200  # RDV existant toujours géré

    client.post(f"/v1/admin/etablissements/{slug}/statut", json={"active": True}, headers=client.admin)
    assert slug in {c["slug"] for c in client.get("/v1/salons", params={"territory": "MQ"}).json()}
    assert client.get("/v1/pro/etablissement", headers=h).status_code == 200
    actions = [e["action"] for e in client.get("/v1/admin/journal", headers=client.admin).json()]
    assert actions[:2] == ["établissement réactivé", "établissement désactivé"]


def test_deactivate_demo_salon_and_account_without_salon(client):
    r = client.post("/v1/admin/etablissements/atelier-du-lamentin/statut", json={"active": False}, headers=client.admin)
    assert r.json()["owner_active"] is None and "atelier-du-lamentin" in INACTIVE
    h = login_phone(client, "0690 11 22 33")
    acc = client.get("/v1/admin/comptes", headers=client.admin).json()[0]
    assert acc["phone"] == "+590690112233" and acc["status"] is None  # pas encore de fiche ouverte
    client.post(f"/v1/admin/comptes/{acc['id']}/statut", json={"active": False}, headers=client.admin)
    assert client.get("/v1/pro/etablissement", headers=h).status_code == 403


def test_admin_edits_salon(client):
    slug = "kourou-barber-club"
    d = client.get(f"/v1/admin/etablissements/{slug}/fiche", headers=client.admin).json()
    assert d["services"][0]["template"] == "coupe-homme" and d["staff"][0]["hours"]["1"] == [["09:00", "19:00"]]
    bad = copy.deepcopy(d)
    bad["services"][0]["duration"] = 40
    assert client.put(f"/v1/admin/etablissements/{slug}", json=bad, headers=client.admin).status_code == 422
    d["name"] = "Kourou Barber Club Spatial"
    d["services"][0]["price"] = 24
    assert client.put(f"/v1/admin/etablissements/{slug}", json=d, headers=client.admin).status_code == 200
    det = client.get(f"/v1/salons/{slug}").json()
    assert det["name"] == "Kourou Barber Club Spatial" and det["services"][0]["price_cents"] == 2400
    SALONS[slug] = __import__("seed").S[9]  # restaure le jeu de démonstration


def test_content(client):
    assert client.put("/v1/admin/contenu", json={"hero_titre": "x" * 200}, headers=client.admin).status_code == 422
    assert client.put("/v1/admin/contenu", json={"inconnu": "x"}, headers=client.admin).status_code == 422
    assert client.put("/v1/admin/contenu", json={"hero_image": "data:text/html;base64,AAAA"}, headers=client.admin).status_code == 422
    ok = client.put("/v1/admin/contenu", json={"hero_titre": "La beauté,\n*à votre heure.*", "photo_barbier": "data:image/webp;base64,UklGRg=="}, headers=client.admin)
    assert ok.status_code == 200
    assert client.get("/v1/contenu").json()["valeurs"]["hero_titre"].startswith("La beauté")
    client.put("/v1/admin/contenu", json={"hero_titre": None, "photo_barbier": None}, headers=client.admin)
    assert client.get("/v1/contenu").json()["valeurs"] == {}


def test_referentials(client):
    refs = client.get("/v1/admin/referentiels", headers=client.admin).json()
    assert len(refs["communes"]["MQ"]) == 34 and len(refs["communes"]["GP"]) == 32 and len(refs["communes"]["GF"]) == 22
    used = copy.deepcopy(refs)
    used["communes"]["MQ"].remove("Fort-de-France")
    del used["categories"]["barbier"]
    miss = " ".join(client.put("/v1/admin/referentiels", json=used, headers=client.admin).json()["detail"]["missing"])
    assert "Fort-de-France" in miss and "Barbier" in miss
    new = copy.deepcopy(refs)
    new["categories"]["maquillage"] = "Maquillage"
    new["modeles"]["maquillage"] = [{"id": "mariee", "name": "Maquillage mariée", "section": "Événements", "duration": 60, "price": 90, "home_ok": True}]
    new["communes"]["GF"].append("Cacao")
    r = client.put("/v1/admin/referentiels", json=new, headers=client.admin)
    assert r.status_code == 200 and "Cacao" in r.json()["communes"]["GF"]
    assert client.get("/v1/pro/referentiel").json()["modeles"]["maquillage"][0]["name"] == "Maquillage mariée"
    client.put("/v1/admin/referentiels", json=refs, headers=client.admin)  # restaure
