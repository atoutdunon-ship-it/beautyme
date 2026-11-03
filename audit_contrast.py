"""Audit de contraste bloquant — thèmes clair et sombre. Code de sortie 1 en cas d'échec."""
import re
import sys
from pathlib import Path

css = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).with_name("template.html")).read_text()


def block(sel: str) -> dict[str, str]:
    m = re.search(re.escape(sel) + r"\{(.*?)\}", css, re.S)
    return dict(re.findall(r"--([\w-]+):\s*(#[0-9A-Fa-f]{6})", m.group(1)))


light = block(":root")
dark = {**light, **block(':root[data-theme="dark"]')}


def lum(h):
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    c = [x / 12.92 if x <= .03928 else ((x + .055) / 1.055) ** 2.4 for x in c]
    return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]


def ratio(a, b):
    la, lb = lum(a), lum(b)
    return (max(la, lb) + .05) / (min(la, lb) + .05)


PAIRS = [  # (élément, texte, fond, seuil)
    ("Titre de page / bandeau", "on-band", "band", 7), ("Accent de bandeau", "on-band-accent", "band", 7),
    ("Entrée de menu", "on-band-2", "band", 7), ("Micro-libellé bandeau", "on-band-3", "band", 4.5),
    ("En-tête du panneau de réservation", "on-band", "band-2", 7), ("Sous-titre panneau", "on-band-2", "band-2", 7),
    ("Titres sur fond de page", "ink", "bg", 7), ("Titres de carte", "ink", "surface", 7),
    ("Texte courant", "body", "surface", 7), ("Libellés secondaires", "muted", "surface", 4.5),
    ("Libellés sur fond de page", "muted", "bg", 4.5), ("Liens et accents", "accent", "surface", 7),
    ("Bouton principal", "btn-fg", "btn-bg", 7), ("Bouton survolé", "btn-fg", "btn-hover", 7),
    ("Sélection (créneau, puce)", "sel-fg", "sel-bg", 7), ("Étiquette", "ink", "surface-2", 7),
    ("État désactivé", "muted", "surface-2", 4.5), ("Succès", "ok", "ok-bg", 4.5), ("Succès sur carte", "ok", "surface", 4.5),
    ("Alerte", "alert", "alert-bg", 4.5), ("Agenda : RDV existant", "busy-fg", "busy", 4.5),
    ("Agenda : temps de pose", "ink", "pose", 4.5), ("Agenda : RDV BeautyMe", "bg", "mine", 4.5),
]
FIXED = [("Monogramme sur navy le plus clair", "#FFFFFF", "#16386A", 7), ("Libellé monogramme", "#BFCBDC", "#16386A", 4.5),
         ("Bouton de la barre de réservation", "#050D1B", "#FFFFFF", 7), ("Notification", "#FFFFFF", "#050D1B", 7)]

if re.search(r"(?<![-\w])color:\s*rgba\(", css):
    sys.exit("ARRÊT : texte défini par une opacité.")

fautes, lignes = [], []
for theme, tok in (("clair", light), ("sombre", dark)):
    for nom, t, f, seuil in PAIRS:
        r = ratio(tok[t], tok[f])
        lignes.append((theme, nom, r, seuil))
        if r < seuil:
            fautes.append(f"[{theme}] {nom} : {r:.2f} < {seuil}")
for nom, t, f, seuil in FIXED:
    r = ratio(t, f)
    lignes.append(("fixe", nom, r, seuil))
    if r < seuil:
        fautes.append(f"[fixe] {nom} : {r:.2f} < {seuil}")

for th, nom, r, s in lignes:
    print(f"{th:7} {nom:38} {r:5.2f}:1  (min {s})")
print(f"Plus faible : {min(l[2] for l in lignes):.2f}:1 · {len(lignes)} paires")
if fautes:
    sys.exit("ARRÊT : contraste insuffisant\n - " + "\n - ".join(fautes))
print("Contrastes conformes.")
