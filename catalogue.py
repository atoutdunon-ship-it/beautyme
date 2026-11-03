"""BeautyMe — référentiels partenaires : communes réelles et modèles de prestations par activité.

Un modèle est une prestation type, cochée puis ajustée (prix, durée, pose, domicile) par le
prestataire. Durées en minutes, multiples de 15 ; prix indicatifs en euros ; `pose` =
(décalage, durée) pendant laquelle le collaborateur est libre.
"""
from __future__ import annotations

COMMUNES: dict[str, list[str]] = {
    "MQ": [
        "L'Ajoupa-Bouillon", "Les Anses-d'Arlet", "Basse-Pointe", "Bellefontaine", "Le Carbet",
        "Case-Pilote", "Le Diamant", "Ducos", "Fonds-Saint-Denis", "Fort-de-France", "Le François",
        "Grand'Rivière", "Gros-Morne", "Le Lamentin", "Le Lorrain", "Macouba", "Le Marigot",
        "Le Marin", "Le Morne-Rouge", "Le Morne-Vert", "Le Prêcheur", "Rivière-Pilote",
        "Rivière-Salée", "Le Robert", "Saint-Esprit", "Saint-Joseph", "Saint-Pierre", "Sainte-Anne",
        "Sainte-Luce", "Sainte-Marie", "Schœlcher", "La Trinité", "Les Trois-Îlets", "Le Vauclin",
    ],
    "GP": [
        "Les Abymes", "Anse-Bertrand", "Baie-Mahault", "Baillif", "Basse-Terre", "Bouillante",
        "Capesterre-Belle-Eau", "Capesterre-de-Marie-Galante", "Deshaies", "La Désirade",
        "Le Gosier", "Gourbeyre", "Goyave", "Grand-Bourg", "Lamentin", "Morne-à-l'Eau", "Le Moule",
        "Petit-Bourg", "Petit-Canal", "Pointe-à-Pitre", "Pointe-Noire", "Port-Louis", "Saint-Claude",
        "Saint-François", "Saint-Louis", "Sainte-Anne", "Sainte-Rose", "Terre-de-Bas",
        "Terre-de-Haut", "Trois-Rivières", "Vieux-Fort", "Vieux-Habitants",
    ],
    "GF": [
        "Apatou", "Awala-Yalimapo", "Camopi", "Cayenne", "Grand-Santi", "Iracoubo", "Kourou",
        "Macouria", "Mana", "Maripasoula", "Matoury", "Montsinéry-Tonnegrande", "Ouanary",
        "Papaïchton", "Régina", "Rémire-Montjoly", "Roura", "Saint-Élie", "Saint-Georges",
        "Saint-Laurent-du-Maroni", "Saül", "Sinnamary",
    ],
}


def T(tid, name, section, dur, price, *, pose=None, home=False, frm=False, desc=""):
    return {"id": tid, "name": name, "section": section, "duration": dur, "price": price,
            "price_from": frm, "pose": list(pose) if pose else None, "home_ok": home, "description": desc}


TEMPLATES: dict[str, list[dict]] = {
    "coiffure": [
        T("coupe-femme", "Coupe femme et brushing", "Coupes", 60, 45),
        T("coupe-homme", "Coupe homme", "Coupes", 30, 25),
        T("coupe-enfant", "Coupe enfant −12 ans", "Coupes", 30, 18),
        T("brushing", "Brushing", "Coiffage", 45, 30, home=True),
        T("soin-boucles", "Soin profond cheveux bouclés et crépus", "Soins", 60, 38, pose=(15, 20)),
        T("coloration", "Coloration racines", "Couleur", 90, 55, pose=(20, 35)),
        T("balayage", "Balayage", "Couleur", 180, 120, pose=(60, 45), frm=True),
        T("lissage", "Lissage brésilien", "Lissage", 180, 180, pose=(45, 60), frm=True, desc="Tarif selon longueur, confirmé au salon."),
        T("chignon", "Chignon de cérémonie", "Événements", 60, 60, home=True),
    ],
    "tresses-locks": [
        T("tresses-collees", "Tresses collées", "Tresses", 150, 70, home=True),
        T("box-braids", "Box braids mi-longues", "Tresses", 240, 130, home=True, frm=True, desc="Mèches non comprises."),
        T("knotless", "Knotless braids", "Tresses", 270, 150, frm=True),
        T("twists", "Twists vanilles", "Tresses", 180, 80, home=True),
        T("creation-locks", "Création de locks", "Locks", 240, 180, frm=True),
        T("entretien-locks", "Entretien locks", "Locks", 90, 55, home=True),
        T("retwist", "Retwist et coiffage", "Locks", 120, 65),
        T("soin-cuir-chevelu", "Soin cuir chevelu", "Soins", 45, 30, pose=(15, 15)),
    ],
    "barbier": [
        T("coupe-homme", "Coupe homme", "Coupes", 30, 22),
        T("degrade", "Dégradé et contours", "Coupes", 45, 28),
        T("barbe", "Taille de barbe", "Barbe", 30, 15),
        T("coupe-barbe", "Coupe et barbe", "Formules", 60, 35),
        T("rasage", "Rasage à la serviette chaude", "Barbe", 30, 25),
        T("coupe-enfant", "Coupe enfant −12 ans", "Coupes", 30, 15),
    ],
    "ongles": [
        T("pose-gel", "Pose gel avec capsules", "Mains", 75, 45),
        T("semi-permanent", "Semi-permanent mains", "Mains", 45, 30, home=True),
        T("remplissage", "Remplissage gel", "Mains", 60, 38),
        T("depose", "Dépose", "Mains", 30, 15),
        T("pieds", "Beauté des pieds et semi-permanent", "Pieds", 60, 40, home=True),
        T("nail-art", "Nail art (par ongle)", "Options", 15, 3, frm=True),
    ],
    "esthetique": [
        T("sourcils", "Épilation sourcils", "Épilation", 15, 12),
        T("jambes", "Épilation jambes complètes", "Épilation", 45, 35),
        T("aisselles", "Épilation aisselles", "Épilation", 15, 12),
        T("soin-visage", "Soin visage hydratant", "Visage", 60, 60, pose=(25, 15)),
        T("rehaussement", "Rehaussement de cils", "Regard", 60, 55, pose=(15, 30)),
        T("maquillage", "Maquillage de soirée", "Maquillage", 45, 50, home=True),
    ],
    "bien-etre": [
        T("massage-relaxant", "Massage relaxant", "Massages", 60, 70, home=True),
        T("massage-huiles", "Massage aux huiles locales", "Massages", 90, 95, home=True),
        T("pierres-chaudes", "Massage pierres chaudes", "Massages", 75, 85),
        T("reflexologie", "Réflexologie plantaire", "Soins", 45, 50, home=True),
        T("gommage", "Gommage corps", "Soins", 45, 45),
    ],
}

# Documents demandés à la validation, par activité
DOCUMENTS = {
    "siret": {"label": "Numéro SIRET", "required": True},
    "rc_pro": {"label": "Attestation d'assurance RC Pro", "required": True},
    "diplome": {"label": "Diplôme ou certification (CAP, BP, BTS…)", "required": False},
}
