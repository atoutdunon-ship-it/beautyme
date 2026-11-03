// Tests jsdom : navigation mobile (standard), parcours de réservation, parité moteur JS/Python.
const fs = require("fs"), path = require("path");
const { JSDOM } = require("jsdom");
const { TextEncoder } = require("util");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const parity = JSON.parse(fs.readFileSync(path.join(__dirname, "parity.json"), "utf8"));
const dom = new JSDOM("<!doctype html><html><head></head><body>" + html + "</body></html>", {
  runScripts: "dangerously", url: "https://beautyme.test/", pretendToBeVisual: true,
  beforeParse(w) { w.TextEncoder = TextEncoder; w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = () => {}; },
});
const w = dom.window, d = w.document, $ = id => d.getElementById(id), ev = s => w.eval(s);
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log("ÉCHEC :", msg); } };
const touch = (type, x) => { const e = new w.Event(type, { bubbles: true }); Object.defineProperty(e, type === "touchstart" ? "touches" : "changedTouches", { value: [{ clientX: x }] }); d.dispatchEvent(e); };
const isOpen = () => $("sidebar").classList.contains("open");

// 1. Structure
ok(d.querySelector(".mobilebar") && $("backdrop") && d.querySelector(".drawer-head"), "barre de contexte, voile, en-tête de tiroir");
ok(d.querySelectorAll("header button").length === 1 && d.querySelector("header .dh-x"), "aucun bouton de navigation résiduel dans l'en-tête");

// 2. Ouverture
ev("openNav()");
ok(isOpen() && $("backdrop").classList.contains("on") && d.body.classList.contains("nav-open"), "ouverture : tiroir, voile, verrou");
ok($("mb-btn").getAttribute("aria-expanded") === "true" && $("mb-btn").textContent === "Fermer", "aria-expanded et libellé");
ok(d.activeElement && d.activeElement.dataset.page === "accueil", "focus sur l'entrée active");

// 3. Cinq voies de fermeture
d.querySelector(".dh-x").click(); ok(!isOpen() && $("mb-btn").textContent === "Menu", "fermeture : bouton Fermer");
ev("openNav()"); $("backdrop").click(); ok(!isOpen(), "fermeture : voile");
ev("openNav()"); d.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape" })); ok(!isOpen(), "fermeture : Échap");
ev("openNav()"); touch("touchstart", 300); touch("touchend", 200); ok(!isOpen(), "fermeture : balayage gauche");
ev("openNav()"); touch("touchstart", 100); touch("touchend", 260); ok(isOpen(), "balayage droite ne ferme pas");
ev("showPage('rdv')"); ok(!isOpen() && !d.body.classList.contains("nav-open"), "fermeture : navigation");

// 4. Titre de contexte sur toutes les pages + clavier
for (const a of d.querySelectorAll("#sidebar a")) {
  ev(`showPage('${a.dataset.page}')`);
  ok($("mb-title").textContent === a.dataset.label && $("page-" + a.dataset.page).classList.contains("active"), "titre de contexte : " + a.dataset.page);
}
d.querySelector('#sidebar a[data-page="pro"]').dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
ok($("page-pro").classList.contains("active"), "navigation clavier (Entrée)");
d.querySelector('#sidebar a[data-page="rdv"]').dispatchEvent(new w.KeyboardEvent("keydown", { key: " ", bubbles: true }));
ok($("page-rdv").classList.contains("active"), "navigation clavier (Espace)");
ev("showPage('inexistante')"); ok($("page-accueil").classList.contains("active") && $("mb-title").textContent === "Accueil", "page inconnue → accueil");

// 5. Règles CSS
const css = d.querySelector("style").textContent;
for (const r of ["max-width:900px", "body.nav-open{overflow:hidden}", "translateX(-101%)", "font-size:16px", "min-height:44px", ".cats,.promise,.info-grid{grid-template-columns:1fr}"])
  ok(css.includes(r), "règle CSS présente : " + r);

// 6. Parité moteur JS / Python
let same = 0;
for (const [k, v] of Object.entries(parity)) {
  const [slug, sid, day] = k.split("|");
  const js = ev(`(()=>{const s=salonBy('${slug}');return JSON.stringify(demoBusy(s,s.staff.find(p=>p.id==='${sid}'),'${day}'))})()`);
  if (js === JSON.stringify(v)) same++;
}
ok(same === Object.keys(parity).length, `parité occupation JS/Python (${same}/${Object.keys(parity).length})`);

// 7. Recherche : chaque territoire a des résultats
for (const t of ["MQ", "GP", "GF"]) { ev(`S.t='${t}';S.cat='';S.commune='';S.home=false;S.day=''`); ev("showPage('recherche')"); ok(d.querySelectorAll("#cards .card").length === 4, "résultats " + t); }
ev("S.t='GP';S.home=true;S.commune='Le Gosier'"); ev("renderResults()");
ok(d.querySelectorAll("#cards .card").length === 2, "filtre domicile Le Gosier : 2 établissements");

// 8. Parcours complet de réservation
ev("S.home=false;S.commune='';B=null"); ev("showPage('salon',{slug:'atelier-du-lamentin'})");
ok($("mb-title").textContent === "L'Atelier du Lamentin" && w.location.hash === "#salon-atelier-du-lamentin", "fiche salon : titre et ancre");
$("sv-cbh").click();
ok($("sv-cbh").getAttribute("aria-pressed") === "true", "prestation sélectionnée");
// premier jour avec des créneaux
let found = false;
for (const b of d.querySelectorAll(".day:not([disabled])")) { b.click(); if (d.querySelector(".slot")) { found = true; break; } }
ok(found, "créneaux affichés");
const t0 = d.querySelector(".slot").textContent;
d.querySelector(".slot").click();
const chosen = ev("JSON.stringify({day:B.day,start:B.slot.start,staff:B.slot.staff})");
d.querySelector("#book .btn.block").click();
ok(ev("B.step") === "details" && $("hold-t"), "créneau bloqué, compte à rebours");
ok(ev("BOOKINGS.some(b=>b.status==='held')"), "hold enregistré");
$("c-name").value = "Léa"; $("c-tel").value = "696 12 34 56"; $("c-cgu").checked = true;
d.querySelector("#book form").dispatchEvent(new w.Event("submit", { cancelable: true }));
ok($("c-otp"), "code demandé");
$("c-otp").value = "1111"; d.querySelector("#book form").dispatchEvent(new w.Event("submit", { cancelable: true }));
ok(d.querySelector("#book .err") && ev("B.step") === "details", "code erroné refusé");
$("c-otp").value = "2026"; d.querySelector("#book form").dispatchEvent(new w.Event("submit", { cancelable: true }));
ok(ev("B.step") === "done" && ev("BOOKINGS.filter(b=>b.status==='confirmed').length") === 1, "rendez-vous confirmé");
// le créneau n'est plus proposé pour ce collaborateur
const c = JSON.parse(chosen);
const still = ev(`findSlots(salonBy('atelier-du-lamentin'),['cbh'],'${c.day}',busyFor(salonBy('atelier-du-lamentin'),'${c.day}'),{staffId:'${c.staff}'}).some(x=>x.start===${c.start})`);
ok(!still, "double réservation impossible (" + t0 + ")");
ev("showPage('rdv')"); ok(d.querySelectorAll("#rdv-list .rdv").length === 1, "mes rendez-vous");
ev("showPage('pro')"); ok(d.querySelectorAll("#p-tl .tl-row").length >= 1 && $("p-kpis").textContent.includes("Via BeautyMe"), "agenda pro");

// 9. Domicile : trajet bloqué
ev("B=null"); ev("showPage('salon',{slug:'kaz-bien-etre-le-diamant'})"); $("sv-mr").click();
ev("setB('mode','domicile')");
ok($("book").textContent.includes("de trajet aller-retour") && $("b-com"), "mode domicile : trajet et commune");

// 10. Espace partenaire : parité des règles, connexion, parcours, validation, réservation
(async () => {
  const tick = () => new Promise(r => setTimeout(r, 15));
  const fire = (el, type) => el.dispatchEvent(new w.Event(type, { bubbles: true }));
  const pp = JSON.parse(fs.readFileSync(path.join(__dirname, "parity_pro.json"), "utf8"));
  for (const [k, c] of Object.entries(pp)) {
    const js = ev(`JSON.stringify(checkDraft(${JSON.stringify(JSON.stringify(c.draft))}&&JSON.parse(${JSON.stringify(JSON.stringify(c.draft))}),"2026-11-02").map(x=>x.m))`);
    ok(js === JSON.stringify(c.missing), "parité règles JS/Python : " + k + (js === JSON.stringify(c.missing) ? "" : "\n  JS " + js + "\n  PY " + JSON.stringify(c.missing)));
  }
  ok(ev("normalizePhone('0696 12 34 56')") === "+596696123456" && ev("normalizePhone('0694123456')") === "+594694123456", "numéros DROM normalisés");
  ok(ev("siretOk('73282932000074')") && !ev("siretOk('73282932000075')"), "contrôle SIRET (Luhn)");

  ev("showPage('partenaire')");
  ok($("mb-title").textContent === "Espace partenaire" && $("pa-phone"), "espace partenaire : écran de connexion");
  $("pa-phone").value = "0696 55 44 33"; fire(d.querySelector("#pa-root form"), "submit"); await tick();
  ok($("pa-code") && d.querySelector(".pa-info").textContent.includes("+596"), "code envoyé (numéro Martinique)");
  $("pa-code").value = "1111"; fire(d.querySelector("#pa-root form"), "submit"); await tick();
  ok(d.querySelector("#pa-root .err") && d.querySelector("#pa-root .err").textContent.includes("4 essai"), "code erroné refusé");
  $("pa-code").value = "2026"; fire(d.querySelector("#pa-root form"), "submit"); await tick(); await tick();
  ok(d.querySelector(".pa-acts") && d.querySelectorAll(".pa-step").length === 7, "connecté : parcours en 7 étapes");

  // Étape 1 : activité
  d.querySelectorAll(".pa-act")[1].click(); await tick();
  ok(ev("PA.app.draft.activity") === "tresses-locks" && d.querySelector(".pa-act[aria-pressed=true]"), "activité principale choisie");
  [...d.querySelectorAll(".pa-chips .chip")].find(b => b.textContent === "Coiffure").click(); await tick();
  ok(ev("PA.app.draft.other_activities.join()") === "coiffure", "activité complémentaire");
  // Étape 2 : établissement
  ev("paGo(1)");
  const typ = (id, v) => { $(id).value = v; fire($(id), "input"); };
  typ("pa-name", "Atelier Zétwal"); typ("pa-addr", "12 rue de la Mairie, 97231 Le Robert");
  typ("pa-about", "Tresses, locks et soins des cheveux texturés, au salon ou chez vous dans le Nord Atlantique.");
  [...d.querySelectorAll('#pa-panel .seg button')].find(b => b.textContent === "Martinique").click(); await tick();
  $("pa-com").value = "Le Robert"; fire($("pa-com"), "change");
  [...d.querySelectorAll('#pa-panel .seg button')].find(b => b.textContent === "€€").click(); await tick();
  ok(ev("paMissing().filter(x=>x.s===1).length") === 0, "étape établissement complète");
  // Étape 3 : prestations types + libre
  ev("paGo(2)");
  ok(d.querySelectorAll(".pa-tpl-g").length === 3, "modèles des deux activités + personnalisées");
  const pick = name => [...d.querySelectorAll(".pa-svc-pick")].find(l => l.textContent.includes(name)).querySelector("input");
  pick("Tresses collées").click(); await tick(); pick("Entretien locks").click(); await tick();
  ok(ev("PA.app.draft.services.length") === 2 && $("pp-tresses-collees"), "prestations types ajoutées, champs éditables");
  $("pp-tresses-collees").value = "75"; fire($("pp-tresses-collees"), "input");
  ok(ev("PA.app.draft.services[0].price") === 75, "prix ajusté");
  $("pa-ns-name").value = "Coiffure de mariée"; $("pa-ns-price").value = "120"; ev("paAddCustom()"); await tick();
  ok(ev("PA.app.draft.services.some(s=>s.id==='coiffure-de-mariee'&&s.price===120)"), "prestation personnalisée ajoutée");
  // Étape 4 : équipe
  ev("paGo(3)"); $("pa-new-staff").value = "Léa"; ev("paAddStaff()"); await tick();
  ok(ev("PA.app.draft.staff[0].skills.length") === 3 && d.querySelectorAll(".pa-day").length === 7, "membre ajouté avec toutes les prestations et 7 jours");
  [...d.querySelectorAll(".pa-member .check")].find(l => l.textContent.includes("Se déplace")).querySelector("input").click(); await tick();
  // Étape 5 : domicile (commune avec apostrophe)
  ev("paGo(4)");
  [...d.querySelectorAll(".pa-communes .chip")].find(b => b.textContent === "La Trinité").click(); await tick();
  [...d.querySelectorAll(".pa-communes .chip")].find(b => b.textContent === "Le Morne-Vert").click(); await tick();
  ok(ev("Object.keys(PA.app.draft.home_zones).length") === 2, "communes desservies");
  ev("paGo(4)"); [...d.querySelectorAll(".pa-communes .chip")].find(b => b.textContent === "Grand'Rivière").click(); await tick();
  ok(ev("'Grand\\'Rivière' in PA.app.draft.home_zones"), "commune avec apostrophe gérée");
  [...d.querySelectorAll('#pa-panel .seg button')].find(b => b.textContent === "20 %").click(); await tick();
  // Étape 6 : documents
  ev("paGo(5)"); typ("pa-siret", "732 829 320 00074");
  ok($("pa-siret-s").textContent === "Numéro valide", "SIRET validé en direct");
  ev("PA.app.draft.documents.rc_pro='attestation.pdf';PA.app.draft.documents.rc_pro_expiry='2027-06-30';paPersist(true)"); await tick();
  // Étape 7 : soumission
  ev("paGo(6)");
  const left = ev("paMissing().map(x=>x.m).join(' | ')");
  ok(!left && $("pa-submit"), "fiche prête à soumettre" + (left ? " — reste : " + left : ""));
  $("pa-submit").click(); await tick(); $("pa-submit-ok").click(); await tick(); await tick();
  ok(ev("PA.app.status") === "en_revue" && d.querySelector(".pa-status").textContent === "En cours de vérification", "demande en revue");
  const blocked = await ev("(async()=>{try{await ProAPI.saveDraft(PA.app.draft);return 'ok'}catch(e){return e.message}})()");
  ok(blocked.includes("en cours de vérification"), "fiche non modifiable pendant la vérification");
  // Validation par l'équipe
  // Administration : connexion
  ev("showPage('admin')"); await tick();
  ok($("ad-login") && $("mb-title").textContent === "Administration", "admin : écran de connexion");
  $("ad-login").value = "ADMIN"; $("ad-pw").value = "music7"; fire(d.querySelector("#ad-root form"), "submit"); await tick();
  ok(d.querySelector("#ad-root .err") && $("ad-login"), "admin : mot de passe erroné refusé (casse respectée)");
  $("ad-login").value = "admin"; $("ad-pw").value = "MUSIC7"; fire(d.querySelector("#ad-root form"), "submit"); await tick(); await tick();
  ok($("ad-tabs") && d.querySelectorAll("#ad-tabs button").length === 6, "admin : connecté, 6 rubriques");
  ok($("ad-body").textContent.includes("Demandes en attente") && d.querySelector("#ad-tabs .ad-count").textContent === "1", "tableau de bord : 1 demande en attente");
  ev("adTab('demandes')"); await tick(); await tick();
  ok(d.querySelectorAll(".va-item").length === 1 && d.querySelector(".va-checks .tag.ok"), "demande visible côté équipe, contrôles affichés");
  [...d.querySelectorAll(".va-item .btn")].find(b => b.textContent === "Valider et publier").click(); await tick(); await tick();
  ok(ev("!!salonBy('atelier-zetwal-le-robert')"), "établissement publié dans le catalogue");
  ev("S.t='MQ';S.cat='';S.commune='';S.home=false;S.day=''"); ev("showPage('recherche')");
  ok(d.querySelectorAll("#cards .card").length === 5 && $("cards").textContent.includes("Nouveau"), "visible dans la recherche, affiché « Nouveau »");
  const slots = ev("findSlots(salonBy('atelier-zetwal-le-robert'),['tresses-collees'],'2026-11-03',{},{mode:'domicile',commune:'La Trinité',now:false}).length");
  ok(slots > 0, "réservable à domicile (" + slots + " créneaux le mardi)");
  ev("showPage('partenaire')"); await tick();
  ok(d.querySelector(".pa-status.s-valide") && d.querySelector(".pa-banner.b-ok"), "le prestataire voit son établissement en ligne");
  // Inscription par e-mail
  ev("paLogout()"); await tick();
  ev("PA.auth='email';PA.emailMode='inscription';renderPartner()");
  $("pa-email").value = "contact@salon.fr"; $("pa-pw").value = "court"; fire(d.querySelector("#pa-root form"), "submit"); await tick();
  ok(d.querySelector("#pa-root .err").textContent.includes("10 caractères"), "mot de passe faible refusé");
  $("pa-email").value = "contact@salon.fr"; $("pa-pw").value = "SalonKaz2026"; fire(d.querySelector("#pa-root form"), "submit"); await tick(); await tick();
  ok(d.querySelector(".pa-acts") && ev("PA.app.status") === "brouillon", "inscription par e-mail : nouveau brouillon");
  ev("paLogout()"); await tick(); ev("PA.auth='email';PA.emailMode='connexion';renderPartner()");
  $("pa-email").value = "contact@salon.fr"; $("pa-pw").value = "SalonKaz2026"; fire(d.querySelector("#pa-root form"), "submit"); await tick(); await tick();
  ok(d.querySelector(".pa-acts"), "reconnexion par e-mail");

  // ── Administration : prestataires, désactivation, édition, contenu, référentiels, journal ──
  ev("PA.auth='tel';showPage('admin')"); await tick(); await tick();
  ev("adTab('prestataires')"); await tick(); await tick();
  ok(d.querySelectorAll(".ad-row").length >= 13 && $("ad-body").textContent.includes("Partenaire"), "liste des établissements et comptes");
  // Désactiver l'établissement partenaire
  ev("AD.confirm='atelier-zetwal-le-robert';AD.reason='';renderAdmin()"); await tick(); await tick();
  $("ad-reason").value = "Assurance expirée"; fire($("ad-reason"), "input");
  [...d.querySelectorAll(".ad-row .btn")].find(b => b.textContent === "Confirmer la désactivation").click(); await tick(); await tick();
  ok(ev("!isLive(salonBy('atelier-zetwal-le-robert'))"), "établissement désactivé");
  ev("S.t='MQ';S.cat='';S.commune='';S.home=false;S.day=''"); ev("showPage('recherche')");
  ok(!$("cards").textContent.includes("Atelier Zétwal"), "masqué de la recherche");
  ev("B=null;showPage('salon',{slug:'atelier-zetwal-le-robert'})");
  ok($("book").textContent.includes("Réservation indisponible"), "réservation bloquée sur la fiche");
  ev("PDB.session=null;PA.app=null;PA.auth='tel';PA.codeSent=null;showPage('partenaire')"); await tick();
  $("pa-phone").value = "0696 55 44 33"; fire(d.querySelector("#pa-root form"), "submit"); await tick();
  ev("PDB.otp[normalizePhone('0696 55 44 33')].sent=0");
  if (!$("pa-code")) { ev("PA.codeSent=null;renderPartner()"); $("pa-phone").value = "0696 55 44 33"; fire(d.querySelector("#pa-root form"), "submit"); await tick(); }
  $("pa-code").value = "2026"; fire(d.querySelector("#pa-root form"), "submit"); await tick(); await tick();
  ok(d.querySelector("#pa-root .err") && d.querySelector("#pa-root .err").textContent.includes("désactivé"), "connexion du prestataire désactivé refusée");
  // Réactiver
  ev("showPage('admin')"); await tick(); await tick();
  [...d.querySelectorAll(".ad-row .btn")].find(b => b.textContent === "Réactiver").click(); await tick(); await tick();
  ok(ev("isLive(salonBy('atelier-zetwal-le-robert'))") && !ev("PDB.accounts[Object.values(PDB.apps).find(a=>a.slug==='atelier-zetwal-le-robert').account_id].disabled"), "établissement et compte réactivés");
  // Modifier une fiche de démonstration
  ev("adEdit('kourou-barber-club')"); await tick(); await tick();
  ok(d.querySelectorAll("#pa-nav .pa-step").length === 5 && $("ad-save").disabled, "édition : 5 rubriques, rien à publier");
  ev("paGo(1)"); await tick();
  $("pa-name").value = "Kourou Barber Club Spatial"; fire($("pa-name"), "input");
  ev("paGo(2)"); await tick();
  $("pp-ch").value = "24"; fire($("pp-ch"), "input"); ev("renderAdmin()"); await tick();
  ok(!$("ad-save").disabled, "édition : modifications prêtes à publier");
  ev("ED.d.services[1].duration=40;renderAdmin()"); await tick();
  ok($("ad-save").disabled && $("ad-root").textContent.includes("tranches de 15 minutes"), "édition : fiche incohérente non publiable");
  ev("ED.d.services[1].duration=45;renderAdmin()"); await tick();
  $("ad-save").click(); await tick(); await tick();
  ok(ev("salonBy('kourou-barber-club').name") === "Kourou Barber Club Spatial" && ev("salonBy('kourou-barber-club').services[0].price") === 2400, "fiche publiée : nom et prix mis à jour");
  // Désactiver un compte sans établissement
  ev("adTab('prestataires')"); await tick(); await tick();
  const accBtn = [...d.querySelectorAll(".ad-row .btn")].find(b => b.textContent === "Désactiver le compte");
  ok(!!accBtn, "comptes prestataires listés");
  // Contenu du site
  ev("adTab('contenu')"); await tick(); await tick();
  ok($("ct-hero_titre") && $("ct-hero_titre").placeholder.includes("La beauté"), "contenu : champs avec texte d'origine");
  $("ct-hero_titre").value = "La beauté,\n*à votre heure.*"; fire($("ct-hero_titre"), "input");
  $("ct-bandeau").value = "x".repeat(130); fire($("ct-bandeau"), "input");
  $("ad-content-save").click(); await tick(); await tick();
  ok(d.querySelector("#ad-body .err") && d.querySelector("#ad-body .err").textContent.includes("120 caractères"), "contenu : longueur contrôlée");
  ev("AD.content.bandeau=''"); ev("adSaveContent()"); await tick(); await tick();
  ok(d.querySelector('[data-edit="hero_titre"]').innerHTML === "La beauté,<br><i>à votre heure.</i>", "contenu publié sur la page (retour à la ligne, italique)");
  ev("AD.content.hero_image='data:image/webp;base64,UklGRg==';adSaveContent()"); await tick(); await tick();
  ok(d.querySelector('[data-edit-img="hero_image"]').getAttribute("src").startsWith("data:image/webp"), "image remplacée");
  ev("AD.content.hero_titre=null;AD.content.hero_image=null;adSaveContent()"); await tick(); await tick();
  ok(d.querySelector('[data-edit="hero_titre"]').innerHTML === "La beauté,<br>à votre rythme." && d.querySelector('[data-edit-img="hero_image"]').getAttribute("src").endsWith("beautyme-1.webp"), "retour au contenu d'origine");
  // Référentiels
  ev("adTab('referentiels')"); await tick(); await tick();
  ok(ev("AD.refs.communes.MQ.length") === 34 && ev("AD.refs.communes.GP.length") === 32 && ev("AD.refs.communes.GF.length") === 22, "communes complètes : 34 / 32 / 22");
  ev("AD.refs.communes.MQ=AD.refs.communes.MQ.filter(c=>c!=='Le Robert');adSaveRefs()"); await tick(); await tick();
  ok($("ad-body").textContent.includes("« Le Robert » est utilisée"), "commune utilisée protégée");
  ev("AD.refs=null;renderAdmin()"); await tick(); await tick();
  $("rc-new").value = "Maquillage"; ev("adAddCat()"); await tick(); await tick();
  ev("adAddTpl()"); await tick(); await tick();
  $("tn-0").value = "Maquillage mariée"; fire($("tn-0"), "input");
  ev("AD.refT='GF';renderAdmin()"); await tick(); await tick();
  $("rcm-new").value = "Cacao"; ev("adAddCommune()"); await tick(); await tick();
  ev("adSaveRefs()"); await tick(); await tick();
  ok(ev("DATA.categories.maquillage") === "Maquillage" && ev("PRO.modeles.maquillage[0].id") === "maquillage-mariee" && ev("PRO.communes.GF.includes('Cacao')"), "univers, prestation type et commune ajoutés");
  ev("showPage('accueil')");
  ok($("cats").textContent.includes("Maquillage") && $("hs-com").options.length === 35, "accueil : nouvel univers ; liste complète des communes (34 + tout)");
  // Journal
  ev("showPage('admin');adTab('journal')"); await tick(); await tick();
  const logTxt = $("ad-body").textContent;
  ok(["référentiels modifiés", "contenu modifié", "fiche modifiée", "établissement réactivé", "établissement désactivé", "demande validée"].every(a => logTxt.includes(a)), "journal : toutes les actions tracées");
  ev("adLogout()"); await tick(); await tick();
  ok($("ad-login"), "déconnexion admin");

  console.log(`\n${pass} vérifications réussies, ${fail} échec(s)`);
  process.exit(fail ? 1 : 0);
})();
