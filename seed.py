"""Jeu de données de démonstration BeautyMe — Martinique, Guadeloupe, Guyane.

Salons, collaborateurs, notes et avis sont fictifs. Communes, fuseaux et usages
locaux sont réels. Source unique : exporté en JSON pour le prototype web.
"""
from __future__ import annotations

from engine import Salon, Service, Staff, Territory

CATEGORIES = {
    "coiffure": "Coiffure",
    "tresses-locks": "Tresses & locks",
    "barbier": "Barbier",
    "ongles": "Ongles",
    "esthetique": "Esthétique",
    "bien-etre": "Massage & bien-être",
}

TERRITORIES = {
    "MQ": {"name": "Martinique", "tz": "America/Martinique", "utc": "UTC−4", "dep": "972"},
    "GP": {"name": "Guadeloupe", "tz": "America/Guadeloupe", "utc": "UTC−4", "dep": "971"},
    "GF": {"name": "Guyane", "tz": "America/Cayenne", "utc": "UTC−3", "dep": "973"},
}

_DAYS = {"lun": 0, "mar": 1, "mer": 2, "jeu": 3, "ven": 4, "sam": 5, "dim": 6}


def _hm(s: str) -> int:
    h, m = s.split(":")
    return int(h) * 60 + int(m)


def hours(spec: str) -> dict[int, tuple[tuple[int, int], ...]]:
    """'mar-sam 08:30-12:30 14:00-18:00; lun 09:00-13:00'"""
    out: dict[int, tuple[tuple[int, int], ...]] = {}
    for part in spec.split(";"):
        days, *ranges = part.split()
        a, _, b = days.partition("-")
        span = range(_DAYS[a], _DAYS[b or a] + 1)
        ivs = tuple((_hm(x), _hm(y)) for x, y in (r.split("-") for r in ranges))
        for d in span:
            out[d] = ivs
    return out


def svc(sid, name, cat, dur, euros, *, frm=False, pose=None, home=False, online=True, desc=""):
    return Service(
        id=sid, name=name, category=cat, duration=dur,
        price_cents=None if euros is None else int(euros * 100),
        price_from=frm, pose=pose, home_ok=home, online=online, description=desc,
    )


def staff(sid, name, skills, spec, home=False):
    return Staff(id=sid, name=name, skills=frozenset(skills), hours=hours(spec), home=home)


# Métadonnées d'affichage (hors moteur)
META: dict[str, dict] = {}


def salon(slug, name, terr, commune, cat, services, team, *, zones=None, deposit=0, **meta):
    META[slug] = meta
    return Salon(
        slug=slug, name=name, territory=Territory(terr), commune=commune, category=cat,
        staff=tuple(team), services=tuple(services), home_zones=zones or {}, deposit_pct=deposit,
    )


S = []

# ── Martinique ────────────────────────────────────────────────────────────
S.append(salon(
    "maison-kalinda-fort-de-france", "Maison Kalinda", "MQ", "Fort-de-France", "tresses-locks",
    [
        svc("tc", "Tresses collées", "Tresses", 150, 75, home=True, desc="Nattes plaquées, motif au choix. Mèches non comprises."),
        svc("bb", "Box braids mi-longues", "Tresses", 240, 140, frm=True, home=True, desc="Mèches fournies sur demande, supplément selon longueur."),
        svc("kn", "Knotless braids", "Tresses", 270, 160, frm=True, desc="Sans nœud à la racine, tension réduite sur le cuir chevelu."),
        svc("el", "Entretien locks", "Locks", 90, 55, home=True, desc="Shampoing, resserrage racines au crochet, soin du cuir chevelu."),
        svc("rt", "Retwist et coiffage", "Locks", 120, 65),
        svc("sc", "Soin profond cheveux crépus", "Soins", 60, 35, pose=(15, 20), desc="Bain d'huile et masque sous vapeur, rinçage, démêlage."),
        svc("cb", "Coloration et brushing", "Couleur", 120, 85, frm=True, pose=(30, 40)),
    ],
    [
        staff("nadege", "Nadège", {"tc", "bb", "kn", "el", "rt", "sc"}, "mar-sam 08:00-17:00", home=True),
        staff("sabine", "Sabine", {"tc", "bb", "kn", "sc", "cb"}, "mar-ven 09:00-18:00; sam 08:00-14:00"),
        staff("kevin", "Kévin", {"el", "rt", "sc"}, "mer-sam 10:00-19:00", home=True),
    ],
    zones={"Fort-de-France": 20, "Schœlcher": 25, "Le Lamentin": 30, "Saint-Joseph": 35},
    deposit=30, rating=4.9, reviews=312, price=2,
    address="14 rue Victor Hugo, 97200 Fort-de-France",
    about="Atelier spécialisé cheveux texturés au cœur de Fort-de-France. Tresses, locks et soins, en salon ou chez vous.",
))
S.append(salon(
    "atelier-du-lamentin", "L'Atelier du Lamentin", "MQ", "Le Lamentin", "barbier",
    [
        svc("ch", "Coupe homme", "Coupes", 30, 25),
        svc("df", "Dégradé à blanc", "Coupes", 45, 30),
        svc("tb", "Taille de barbe", "Barbe", 30, 15),
        svc("cbh", "Coupe et barbe", "Formules", 60, 38),
        svc("ce", "Coupe enfant −12 ans", "Coupes", 30, 18),
    ],
    [
        staff("yannick", "Yannick", {"ch", "df", "tb", "cbh", "ce"}, "mar-sam 09:00-19:00"),
        staff("jordan", "Jordan", {"ch", "df", "tb", "cbh", "ce"}, "lun-ven 10:00-19:30"),
    ],
    rating=4.8, reviews=541, price=1,
    address="Centre commercial La Galleria, 97232 Le Lamentin",
    about="Barbier de quartier, dégradés précis et taille de barbe à la serviette chaude.",
))
S.append(salon(
    "ongles-madinina-schoelcher", "Ongles Madinina", "MQ", "Schœlcher", "ongles",
    [
        svc("pg", "Pose gel avec capsules", "Mains", 75, 45),
        svc("sp", "Semi-permanent mains", "Mains", 45, 30),
        svc("rm", "Remplissage gel", "Mains", 60, 38),
        svc("bp", "Beauté des pieds et semi-permanent", "Pieds", 60, 40),
        svc("na", "Nail art (par ongle)", "Options", 15, 3, frm=True),
    ],
    [
        staff("laeticia", "Laëticia", {"pg", "sp", "rm", "bp", "na"}, "lun-sam 09:00-18:00"),
        staff("ines", "Inès", {"sp", "bp", "na"}, "mar-sam 10:00-17:00"),
    ],
    deposit=20, rating=4.7, reviews=188, price=2,
    address="Anse Madame, 97233 Schœlcher",
    about="Prothésistes ongulaires diplômées, produits sans HEMA.",
))
S.append(salon(
    "kaz-bien-etre-le-diamant", "Kaz Bien-être", "MQ", "Le Diamant", "bien-etre",
    [
        svc("mr", "Massage relaxant", "Massages", 60, 70, home=True),
        svc("mh", "Massage aux huiles de coco et vétiver", "Massages", 90, 95, home=True),
        svc("sv", "Soin visage éclat", "Visage", 60, 65),
        svc("md", "Massage duo", "Massages", 60, 130, online=False, desc="Réservation par téléphone uniquement (deux praticiennes)."),
    ],
    [
        staff("marie", "Marie-Josée", {"mr", "mh", "sv"}, "mar-sam 09:00-18:00; dim 09:00-13:00", home=True),
    ],
    zones={"Le Diamant": 10, "Sainte-Luce": 20, "Les Anses-d'Arlet": 25, "Rivière-Salée": 30},
    deposit=30, rating=5.0, reviews=96, price=3,
    address="Route de Dizac, 97223 Le Diamant",
    about="Massages bien-être aux huiles locales, en cabine face à la mer ou à domicile dans le Sud.",
))

# ── Guadeloupe ────────────────────────────────────────────────────────────
S.append(salon(
    "studio-karukera-baie-mahault", "Studio Karukera", "GP", "Baie-Mahault", "coiffure",
    [
        svc("cf", "Coupe femme et brushing", "Coupes", 60, 45),
        svc("bru", "Brushing", "Coiffage", 45, 30),
        svc("lb", "Lissage brésilien", "Lissage", 180, 180, frm=True, pose=(45, 60), desc="Sans formol. Tarif selon longueur, confirmé au salon."),
        svc("col", "Coloration racines", "Couleur", 90, 55, pose=(20, 35)),
        svc("bal", "Balayage", "Couleur", 180, 120, frm=True, pose=(60, 45)),
        svc("chg", "Chignon de cérémonie", "Événements", 60, 60, home=True),
    ],
    [
        staff("manon", "Manon", {"cf", "bru", "lb", "col", "bal", "chg"}, "mar-sam 08:30-12:30 13:30-18:30"),
        staff("cedric", "Cédric", {"cf", "bru", "col", "bal"}, "mar-ven 09:00-18:00"),
        staff("sarah", "Sarah", {"bru", "chg"}, "jeu-sam 08:00-16:00", home=True),
    ],
    zones={"Baie-Mahault": 15, "Les Abymes": 25, "Pointe-à-Pitre": 25, "Petit-Bourg": 30},
    deposit=25, rating=4.8, reviews=427, price=3,
    address="ZAC de Houelbourg, 97122 Baie-Mahault",
    about="Salon mixte, coloristes et spécialistes du lissage. Coiffures de mariage à domicile.",
))
S.append(salon(
    "barber-pointe-a-pitre", "Barber Darboussier", "GP", "Pointe-à-Pitre", "barbier",
    [
        svc("ch", "Coupe homme", "Coupes", 30, 22),
        svc("df", "Dégradé et contours", "Coupes", 45, 28),
        svc("tb", "Taille de barbe", "Barbe", 30, 15),
        svc("cbh", "Coupe et barbe", "Formules", 60, 35),
    ],
    [
        staff("teddy", "Teddy", {"ch", "df", "tb", "cbh"}, "lun-sam 09:00-19:00"),
        staff("anthony", "Anthony", {"ch", "df", "tb", "cbh"}, "mar-sam 11:00-20:00"),
    ],
    rating=4.7, reviews=612, price=1,
    address="Quai Lardenoy, 97110 Pointe-à-Pitre",
    about="Barbier face à la Darse, ouvert tard en semaine.",
))
S.append(salon(
    "institut-le-gosier", "Institut Bas-du-Fort", "GP", "Le Gosier", "esthetique",
    [
        svc("es", "Épilation sourcils", "Épilation", 15, 12),
        svc("ej", "Épilation jambes complètes", "Épilation", 45, 35),
        svc("svh", "Soin visage hydratant", "Visage", 60, 60, pose=(25, 15)),
        svc("ms", "Maquillage de soirée", "Maquillage", 45, 50, home=True),
        svc("rc", "Rehaussement de cils", "Regard", 60, 55, pose=(15, 30)),
    ],
    [
        staff("cindy", "Cindy", {"es", "ej", "svh", "ms", "rc"}, "mar-sam 09:00-18:00", home=True),
        staff("gwlad", "Gwladys", {"es", "ej", "svh", "rc"}, "lun-ven 08:30-17:30"),
    ],
    zones={"Le Gosier": 10, "Pointe-à-Pitre": 20, "Sainte-Anne": 25},
    rating=4.6, reviews=203, price=2,
    address="Marina de Bas-du-Fort, 97190 Le Gosier",
    about="Esthétique, regard et maquillage, à la marina ou à domicile pour vos événements.",
))
S.append(salon(
    "natty-locks-sainte-anne", "Natty Locks", "GP", "Sainte-Anne", "tresses-locks",
    [
        svc("cl", "Création de locks", "Locks", 240, 180, frm=True, desc="Méthode crochet. Durée et tarif selon densité, confirmés au premier rendez-vous."),
        svc("el", "Entretien locks", "Locks", 90, 60, home=True),
        svc("tc", "Tresses collées", "Tresses", 120, 65, home=True),
        svc("sc", "Soin cuir chevelu", "Soins", 45, 30, pose=(15, 15)),
    ],
    [
        staff("ras", "Rudy", {"cl", "el", "sc"}, "mar-sam 09:00-18:00", home=True),
        staff("kelly", "Kelly", {"el", "tc", "sc"}, "mer-dim 08:00-15:00", home=True),
    ],
    zones={"Sainte-Anne": 10, "Saint-François": 20, "Le Moule": 30, "Le Gosier": 25},
    deposit=30, rating=4.9, reviews=154, price=2,
    address="Bourg de Sainte-Anne, 97180 Sainte-Anne",
    about="Spécialistes des locks naturelles depuis 2012, en salon ou à domicile dans la Grande-Terre.",
))

# ── Guyane ────────────────────────────────────────────────────────────────
S.append(salon(
    "atelier-maripa-cayenne", "Atelier Maripa", "GF", "Cayenne", "coiffure",
    [
        svc("cf", "Coupe femme et brushing", "Coupes", 60, 48),
        svc("ch", "Coupe homme", "Coupes", 30, 25),
        svc("sc", "Soin profond cheveux bouclés", "Soins", 60, 38, pose=(15, 20)),
        svc("col", "Coloration et brushing", "Couleur", 120, 80, frm=True, pose=(30, 35)),
        svc("tc", "Tresses collées", "Tresses", 120, 60, home=True),
    ],
    [
        staff("lina", "Lina", {"cf", "sc", "col", "tc"}, "mar-sam 08:00-17:00", home=True),
        staff("bruno", "Bruno", {"cf", "ch", "col"}, "lun-ven 09:00-18:00"),
    ],
    zones={"Cayenne": 15, "Rémire-Montjoly": 25, "Matoury": 30},
    deposit=20, rating=4.8, reviews=239, price=2,
    address="Place des Palmistes, 97300 Cayenne",
    about="Salon mixte au centre de Cayenne, spécialiste des boucles et des cheveux texturés.",
))
S.append(salon(
    "kourou-barber-club", "Kourou Barber Club", "GF", "Kourou", "barbier",
    [
        svc("ch", "Coupe homme", "Coupes", 30, 22),
        svc("df", "Dégradé", "Coupes", 45, 28),
        svc("tb", "Taille de barbe", "Barbe", 30, 15),
        svc("cbh", "Coupe et barbe", "Formules", 60, 35),
    ],
    [staff("mike", "Mickaël", {"ch", "df", "tb", "cbh"}, "mar-sam 09:00-19:00")],
    rating=4.9, reviews=178, price=1,
    address="Avenue des Roches, 97310 Kourou",
    about="Barbier indépendant, sur rendez-vous uniquement.",
))
S.append(salon(
    "ongles-spa-remire", "Spa Montjoly", "GF", "Rémire-Montjoly", "bien-etre",
    [
        svc("mr", "Massage relaxant", "Massages", 60, 65),
        svc("mp", "Massage pierres chaudes", "Massages", 75, 85),
        svc("sp", "Semi-permanent mains", "Ongles", 45, 30),
        svc("bp", "Beauté des pieds", "Ongles", 60, 40),
    ],
    [
        staff("aurelie", "Aurélie", {"mr", "mp"}, "mar-sam 09:00-19:00"),
        staff("jessy", "Jessy", {"sp", "bp"}, "lun-sam 09:00-17:00"),
    ],
    deposit=20, rating=4.7, reviews=121, price=2,
    address="Route des plages, 97354 Rémire-Montjoly",
    about="Spa de jour à deux pas de la plage de Montjoly : massages et soins des mains et des pieds.",
))
S.append(salon(
    "tresses-du-maroni-saint-laurent", "Tresses du Maroni", "GF", "Saint-Laurent-du-Maroni", "tresses-locks",
    [
        svc("tc", "Tresses collées", "Tresses", 150, 55, home=True),
        svc("bb", "Box braids", "Tresses", 240, 110, frm=True, home=True),
        svc("tw", "Twists vanilles", "Tresses", 180, 80, home=True),
    ],
    [
        staff("mylene", "Mylène", {"tc", "bb", "tw"}, "lun-sam 07:30-16:30", home=True),
        staff("fatou", "Fatou", {"tc", "bb", "tw"}, "mar-sam 08:00-15:00", home=True),
    ],
    zones={"Saint-Laurent-du-Maroni": 15, "Mana": 45},
    deposit=30, rating=4.9, reviews=87, price=1,
    address="Rue Hippolyte Létard, 97320 Saint-Laurent-du-Maroni",
    about="Tresseuses expérimentées, en salon ou à domicile à Saint-Laurent et Mana.",
))

SALONS: dict[str, Salon] = {s.slug: s for s in S}

# Établissements désactivés par l'administration : masqués, non réservables, RDV existants conservés
INACTIVE: set[str] = set()
