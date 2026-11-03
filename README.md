# BeautyMe

Réservation beauté pour la Martinique, la Guadeloupe et la Guyane : coiffure, tresses et locks,
barbier, ongles, esthétique, massage, en salon ou à domicile. Nom de code du module : **BeautyMe**.

Prototype de démonstration : établissements fictifs, rendez-vous enregistrés dans le navigateur,
code de validation `2026`, aucun message ni paiement réel.

## Mise en ligne sur GitHub Pages

1. Créer un dépôt, puis **Add file → Upload files**.
2. Dans le Finder, ouvrir ce dossier, afficher les fichiers cachés avec **Cmd + Maj + .**,
   sélectionner tout avec **Cmd + A** et glisser dans GitHub. `.nojekyll` doit faire partie de l'envoi.
3. **Settings → Pages → Source : Deploy from a branch → `main` / `(root)`**.

Le site est `index.html` : CSS et données intégrés, photos `beautyme-1.webp` à `beautyme-8.webp` à côté.

## Espace partenaire

Chaque prestataire se connecte par **mobile + code** (WhatsApp ou SMS) ou par **e-mail + mot de passe**, puis remplit sa fiche en 7 étapes :
activité principale et complémentaires, établissement, prestations (modèles par activité à ajuster + ajout libre),
équipe et horaires, domicile et acompte, documents (SIRET contrôlé, RC Pro, diplôme facultatif), vérification.
La demande part en revue ; l'équipe BeautyMe la valide (publication immédiate dans la recherche et la réservation) ou la refuse avec un motif.

Le site fonctionne seul en démonstration (code `2026`). Pour brancher l'espace partenaire et l'administration sur l'API, définir avant le script :
`<script>window.BEAUTYME_API="https://api.exemple.fr"</script>`. Côté API : variables `BEAUTYME_DEMO=0`,
`BEAUTYME_SECRET`, `BEAUTYME_ADMIN_TOKEN`. Les règles de complétude sont identiques en Python (`pro.py`) et en JavaScript (`partner.js`),
contrôlées par `parity_pro.json`.

## Administration

Accès : pied de page « Administration » ou adresse `#admin`. Identifiant `ADMIN`, mot de passe `MUSIC7` (démonstration).

- **Tableau de bord** : établissements en ligne, demandes en attente, comptes, rendez-vous à venir.
- **Demandes** : vérification SIRET / RC Pro, validation (publication immédiate) ou refus motivé.
- **Prestataires** : filtres par territoire et statut ; désactiver / réactiver un établissement ou un compte
  (masqué de la recherche, réservation fermée, connexion du prestataire refusée, rendez-vous déjà pris conservés) ;
  modification complète d'une fiche (établissement, prestations, équipe, horaires, domicile, acompte).
- **Contenu du site** : textes et photos de l'accueil, des univers, des engagements, du domicile, du pied de page
  (retour à la ligne, `*italique*` ; champ vide = texte d'origine).
- **Référentiels** : noms des territoires, univers, communes (34 Martinique, 32 Guadeloupe, 22 Guyane, ajout de quartiers possible),
  prestations types par univers. Une commune ou un univers utilisé ne peut pas être supprimé.
- **Journal** : chaque action est tracée.

Sécurité : sur un site statique, la connexion admin n'est qu'une porte de démonstration (le code est lisible).
En production, l'accès passe par l'API : `BEAUTYME_ADMIN_LOGIN`, `BEAUTYME_ADMIN_PASSWORD` (obligatoire si `BEAUTYME_DEMO=0`),
mot de passe haché, sessions de 12 h, 5 essais par quart d'heure. **Changez MUSIC7 avant toute mise en ligne réelle.**

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | Le site, généré par `build.py`. Ne pas modifier à la main |
| `template.html`, `luxury.css` | Sources du site (pages, moteur JavaScript, charte) |
| `data.json` | Référentiel exporté depuis `seed.py` |
| `build.py` | Régénère `index.html` et `.nojekyll` |
| `partner.js` | Espace partenaire et validation (injecté dans `index.html`) |
| `admin.js` | Administration (injectée dans `index.html`) |
| `admin.py`, `adminauth.py` | API d'administration : connexion, prestataires, fiches, contenu, référentiels, journal |
| `pro.py`, `catalogue.py` | API partenaire : connexion, fiche, soumission, validation ; communes et modèles de prestations |
| `engine.py` | Moteur de créneaux : temps de pose, domicile, fuseaux UTC−4 / UTC−3 |
| `seed.py` | Les 12 établissements de démonstration |
| `store.py`, `main.py` | API FastAPI (non utilisée par le site statique) |
| `schema.sql` | Schéma PostgreSQL, contrainte anti double réservation |
| `test_engine.py`, `test_pro.py`, `test_admin.py`, `test_web.js`, `parity*.json` | Tests Python et navigateur |
| `audit_contrast.py` | Contrôle des contrastes |

## Commandes

```bash
python3 build.py                      # régénère le site (ou double-clic sur Regenerer-le-site.command)
python3 -m pytest -q test_engine.py test_pro.py test_admin.py   # 27 tests : moteur, API, partenaires, administration
npm i && node test_web.js             # 101 vérifications navigateur
pip install -r requirements-dev.txt && uvicorn main:app --reload   # API sur http://127.0.0.1:8000/docs
```

Charte : camel `#C49A73`, camel clair `#E3CBB3`, noir, rose `#F2D9DF`, anis `#D5E890` ;
titres Instrument Serif, texte Manrope. Logo « Beauty*Me* » conservé dans ses couleurs d'origine.
