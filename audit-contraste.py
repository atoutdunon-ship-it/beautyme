#!/usr/bin/env python3
"""Audit bloquant des contrastes — Portfolio Humanum Business Group.
Usage : python3 audit-contraste.py   (code de sortie 1 en cas de faute)"""
import re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent

def jetons(html):
    root = re.search(r":root\{(.*?)\}", html, re.S).group(1)
    return {k: v.upper() for k, v in re.findall(r"--([\w-]+):\s*(#[0-9A-Fa-f]{6})", root)}

def _lum(h):
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    c = [x / 12.92 if x <= .03928 else ((x + .055) / 1.055) ** 2.4 for x in c]
    return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]

def contraste(a, b):
    la, lb = _lum(a), _lum(b)
    return (max(la, lb) + .05) / (min(la, lb) + .05)

T, A = 7.0, 4.5  # titres / menus / accents  —  texte courant
CATS = ("mag", "cya", "blu", "vio", "ver")
PAIRES = {
    "index.html": [
        ("Hero — titre", "on-dark", "black", T), ("Hero — accent du titre", "accent-on-dark", "black", T),
        ("Hero — surtitre", "cya-d", "black", T), ("Hero — texte", "on-dark-2", "black", A),
        ("Hero — chiffres, libellés", "on-dark-3", "black", A), ("Bandeau", "on-dark-2", "navy-800", A),
        ("Marque", "ink", "white", T), ("Marque — accent", "accent", "white", T), ("Marque — sous-titre", "gray", "white", A),
        ("Menu — entrée", "ink", "white", T), ("Menu — entrée active", "on-dark", "navy-800", T),
        ("Tiroir — entrée", "on-dark-2", "navy-900", T), ("Tiroir — entrée active", "ink", "white", T),
        ("Tiroir — titre", "on-dark", "navy-900", T), ("Barre de contexte — libellé", "gray", "white", A),
        ("Barre de contexte — titre", "ink", "white", T), ("Bouton navy", "on-dark", "navy-800", T),
        ("Surtitre de section", "accent", "white", T), ("Titre de section", "ink", "white", T),
        ("Texte courant", "body", "white", A), ("Texte courant sur gris clair", "body", "cream", A),
        ("Étiquette", "ink", "sand", T), ("Étiquette « En ligne »", "cya-l", "cya-t", A),
        ("Étape — titre", "ink", "cream", T), ("Parcours — année", "accent", "white", T),
        ("Encart navy — titre", "on-dark", "navy-900", T), ("Encart navy — surtitre", "accent-on-dark", "navy-900", T),
        ("Encart navy — texte", "on-dark-2", "navy-900", A), ("Message — succès", "ok", "cya-t", A),
        ("Message — erreur", "err", "mag-t", A), ("Fiche — intertitre", "accent", "white", T),
        ("Fiche — fonctionnalité", "ink", "cream", T), ("Fiche — libellé", "gray", "white", A),
        ("Pied — titre", "on-dark", "navy-900", T), ("Pied — intertitre", "accent-on-dark", "navy-900", T),
        ("Pied — texte", "on-dark-2", "navy-900", A), ("Pied — mentions", "on-dark-3", "navy-900", A),
        ("Bandeau aperçu", "mag-l", "mag-t", A),
        ("Vidéo — bouton de lecture", "ink", "white", T),
    ] + [(f"Domaine {c} — carte et pastille", "ink", f"{c}-f", T) for c in CATS]
      + [(f"Domaine {c} — libellé de carte", f"{c}-l", "white", T) for c in CATS]
      + [(f"Domaine {c} — numéro d'étape", f"{c}-l", "cream", T) for c in CATS]
      + [(f"Domaine {c} — encart", "ink", f"{c}-t", T) for c in CATS]
      + [
        ("Carrousel — titre du site", "on-dark", "navy-900", T), ("Carrousel — texte", "on-dark-2", "navy-900", A),
        ("Carrousel — adresse", "on-dark-3", "navy-900", A), ("Carrousel — barre d'adresse", "on-dark-2", "navy-700", A),
        ("Carrousel — compteur", "ink", "white", T), ("Carrousel — bouton blanc", "ink", "white", T),
    ] + [(f"Carrousel — domaine {c}", f"{c}-d", "navy-900", T) for c in CATS],
    "admin.html": [
        ("Connexion — titre", "ink", "white", T), ("Connexion — marque", "accent", "white", T),
        ("En-tête — titre", "on-dark", "navy-900", T), ("En-tête — surtitre", "accent-on-dark", "navy-900", T),
        ("Menu — entrée", "on-dark-2", "navy-900", T), ("Menu — entrée survolée", "on-dark", "navy-700", T),
        ("Menu — entrée active", "ink", "white", T), ("Menu — section", "on-dark-3", "navy-900", T),
        ("Menu — compteur", "on-dark", "navy-700", T), ("Menu — compteur actif", "ink", "sand", T),
        ("Barre de contexte — libellé", "gray", "white", A), ("Barre de contexte — titre", "ink", "white", T),
        ("Surtitre de page", "accent", "white", T), ("Surtitre sur gris clair", "accent", "cream", T),
        ("Titres", "ink", "white", T), ("Titres sur gris clair", "ink", "cream", T),
        ("Texte courant", "body", "white", A), ("Aide", "gray", "white", A), ("Aide sur gris clair", "gray", "cream", A),
        ("Pastille / statut neutre", "ink", "sand", T), ("Statut — succès", "ok", "ok-t", A),
        ("Statut — alerte", "err", "err-t", A), ("Statut — à traiter", "warn", "warn-t", A),
        ("Bouton navy", "on-dark", "navy-800", T), ("Bouton supprimer", "err", "white", A),
        ("Bouton désactivé", "gray", "sand", A),
    ],
}

fautes, lignes = [], []
for fichier, paires in PAIRES.items():
    html = (ROOT / fichier).read_text(encoding="utf-8")
    css = "\n".join(re.findall(r"<style[^>]*>(.*?)</style>", html, re.S))
    if re.search(r"(?<![-\w])color:\s*rgba\(", css):
        fautes.append(f"{fichier} : texte défini par une opacité")
    j = jetons(html)
    for nom, t, f, seuil in paires:
        r = contraste(j[t], j[f])
        ok = r >= seuil
        lignes.append(f"{'OK ' if ok else 'KO '} {r:5.2f}:1  (min {seuil:g})  {fichier:<10} {nom}")
        if not ok:
            fautes.append(f"{fichier} — {nom} : {r:.2f} < {seuil:g}")

print("\n".join(lignes))
if fautes:
    sys.exit("\nARRÊT : contraste insuffisant\n - " + "\n - ".join(fautes))
print(f"\n{len(lignes)} paires vérifiées, aucune faute.")
