/* ═══════════ Administration ═══════════
   Même contrat que l'API (api/app/admin.py, adminauth.py). Adaptateur HTTP si window.BEAUTYME_API est défini,
   sinon démonstration locale. En démonstration statique, la connexion n'est qu'une porte d'accès : la vraie
   protection est côté serveur (mot de passe hors du code, sessions, limitation des essais). */
const ADKEY="beautyme.admin.v1";
let ADB=null;
try{ADB=JSON.parse(localStorage.getItem(ADKEY)||"null")}catch(e){ADB=null}
ADB=ADB||{content:{},refs:null,inactive:[],edited:{},log:[]};
function saveADB(){try{localStorage.setItem(ADKEY,JSON.stringify(ADB))}catch(e){toast("Stockage du navigateur plein : retirez une image.")}}
function adLog(action,detail){ADB.log.push({at:new Date().toISOString(),by:"ADMIN",action,detail});ADB.log=ADB.log.slice(-500);saveADB()}

/* Champs de contenu — miroir de CONTENT_FIELDS (api/app/admin.py) */
const CONTENT_GROUPS=[
  ["Bandeau",[["bandeau","Texte du bandeau","t",120]]],
  ["Accueil",[["hero_lieu","Sur-titre","t",120],["hero_titre","Titre principal","t",90],["hero_texte","Texte d'accroche","t",240],["hero_note","Note sous l'accroche","t",300],["hero_image","Photo principale","i"],["hero_legende","Légende de la photo","t",80],["recherche_accroche","Phrase au-dessus de la recherche","t",120]]],
  ["Univers",[["univers_titre","Titre de la section","t",90],["univers_sous_titre","Sous-titre","t",160]]],
  ["Engagements",[1,2,3].flatMap(i=>[["promesse_"+i+"_titre","Engagement "+i+" : titre","t",60],["promesse_"+i+"_texte","Engagement "+i+" : texte","t",220]])],
  ["À domicile",[["domicile_titre","Titre","t",90],["domicile_texte","Texte","t",300],["domicile_bouton","Bouton","t",40],["domicile_image","Photo","i"]]],
  ["Pied de page",[["pied_texte","Texte sous le logo","t",200]]],
];
const MAX_IMG=1500000,MAX_CONTENT=9000000,IMG_RE=/^data:image\/(webp|jpeg|png|avif);base64,[A-Za-z0-9+/=]+$/;
function contentFields(){const f={};for(const[,list]of CONTENT_GROUPS)for(const[k,,t,m]of list)f[k]={t,m};for(const c of Object.keys(DATA.categories))f["photo_"+c]={t:"i"};return f}

/* Texte enrichi minimal : retour à la ligne, *italique* */
function toMarkup(html){const x=document.createElement("div");x.innerHTML=String(html).replace(/<br\s*\/?>/gi,"\n").replace(/<i>([\s\S]*?)<\/i>/gi,"*$1*");return x.textContent.trim()}
function fromMarkup(t){return esc(t).replace(/\*([^*\n]+)\*/g,"<i>$1</i>").replace(/\n/g,"<br>")}
const CONTENT_DEFAULTS={};
document.querySelectorAll("[data-edit]").forEach(el=>{CONTENT_DEFAULTS[el.dataset.edit]=toMarkup(el.innerHTML)});
document.querySelectorAll("[data-edit-img]").forEach(el=>{CONTENT_DEFAULTS[el.dataset.editImg]=el.getAttribute("src")});
function contentValue(k){return(ADB.content&&ADB.content[k])||CONTENT_DEFAULTS[k]||""}
function photoOf(cat){return(ADB.content&&ADB.content["photo_"+cat])||CATEGORY_PHOTOS[cat]||CATEGORY_PHOTOS.coiffure}
function applyContent(){
  document.querySelectorAll("[data-edit]").forEach(el=>{const k=el.dataset.edit;el.innerHTML=fromMarkup(contentValue(k))});
  document.querySelectorAll("[data-edit-img]").forEach(el=>{const v=contentValue(el.dataset.editImg);if(v&&el.getAttribute("src")!==v)el.setAttribute("src",v)});
}

/* Application des réglages admin au catalogue, au démarrage */
function applyRefs(r){
  if(!r)return;
  for(const[k,n]of Object.entries(r.territoires||{}))if(DATA.territories[k])DATA.territories[k].name=n;
  if(r.categories){for(const k of Object.keys(DATA.categories))delete DATA.categories[k];Object.assign(DATA.categories,r.categories)}
  if(r.communes)for(const[t,l]of Object.entries(r.communes))PRO.communes[t]=l;
  if(r.modeles){for(const k of Object.keys(PRO.modeles))delete PRO.modeles[k];Object.assign(PRO.modeles,r.modeles)}
  for(const c of Object.keys(DATA.categories))PRO.modeles[c]=PRO.modeles[c]||[];
}
applyRefs(ADB.refs);
for(const[slug,salon]of Object.entries(ADB.edited||{})){const i=DATA.salons.findIndex(s=>s.slug===slug);if(i>=0)DATA.salons[i]=salon;else DATA.salons.push(salon)}
applyContent();

/* ── Fiche ↔ établissement ── */
function salonToDraft(s){
  const tpl=Object.fromEntries((PRO.modeles[s.cat]||[]).map(t=>[t.name,t.id]));
  return{activity:s.cat,other_activities:[...(s.others||[])],name:s.name,territory:s.t,commune:s.commune,address:s.address,about:s.about,price_level:s.price,deposit_pct:s.deposit||0,home_zones:{...s.zones},
    services:s.services.map(v=>({id:v.id,template:tpl[v.name]||null,name:v.name,section:v.sec,duration:v.dur,price:v.price==null?null:v.price/100,price_from:!!v.from,pose:v.pose?[...v.pose]:null,home_ok:!!v.home,online:v.online!==false,description:v.desc||""})),
    staff:s.staff.map(p=>({id:p.id,name:p.name,home:!!p.home,skills:[...p.skills],hours:Object.fromEntries(Object.entries(p.hours).map(([w,ivs])=>[w,ivs.map(([a,b])=>[hm(a),hm(b)])]))})),
    documents:{siret:null,rc_pro:null,rc_pro_expiry:null,diplome:null}};
}
function ownerOf(slug){const a=Object.values(PDB.apps).find(x=>x.slug===slug);return a?PDB.accounts[a.account_id]:null}

/* ── Adaptateur local ── */
const ADMIN_HASH="9c5c8194";
const LocalAdmin={
  mode:"demo",fails:[],
  signedIn(){try{return sessionStorage.getItem("beautyme.admin.session")==="1"}catch(e){return!!this._s}},
  async login(l,p){const now=Date.now();this.fails=this.fails.filter(t=>now-t<900000);
    if(this.fails.length>=5)throw perr("Trop d'essais. Réessayez dans 15 minutes.");
    if(fnv1a(String(l).trim().toUpperCase()+"|"+p).toString(16)!==ADMIN_HASH){this.fails.push(now);throw perr("Identifiant ou mot de passe incorrect.")}
    this.fails=[];this._s=true;try{sessionStorage.setItem("beautyme.admin.session","1")}catch(e){}adLog("connexion","Connexion à l'administration")},
  async logout(){this._s=false;try{sessionStorage.removeItem("beautyme.admin.session")}catch(e){}},
  async dashboard(){const live=DATA.salons.filter(isLive),apps=Object.values(PDB.apps),acc=Object.values(PDB.accounts);
    const today=new Date().toISOString().slice(0,10);
    return{etablissements_en_ligne:live.length,etablissements_desactives:DATA.salons.length-live.length,demandes_en_attente:apps.filter(a=>a.status==="en_revue").length,
      comptes_prestataires:acc.length,comptes_desactives:acc.filter(a=>a.disabled).length,
      rendez_vous_a_venir:BOOKINGS.filter(b=>b.status==="confirmed"&&b.day>=today).length,
      par_territoire:Object.fromEntries(Object.keys(DATA.territories).map(t=>[t,live.filter(s=>s.t===t).length]))}},
  async salons(){return DATA.salons.map(s=>{const o=ownerOf(s.slug);return{slug:s.slug,name:s.name,territory:s.t,commune:s.commune,category:s.cat,active:isLive(s),rating:s.rating,reviews:s.reviews,
    source:o?"partenaire":"démonstration",owner:o?{id:o.id,email:o.email||null,phone:o.phone||null,active:!o.disabled}:null}}).sort((a,b)=>(a.territory+a.name).localeCompare(b.territory+b.name,"fr"))},
  async accounts(){return Object.values(PDB.accounts).map(a=>{const app=PDB.apps[a.id];return{id:a.id,email:a.email||null,phone:a.phone||null,active:!a.disabled,status:app?app.status:null,name:app?app.draft.name:null,slug:app?app.slug:null}})},
  async setSalonStatus(slug,active,reason){const s=salonBy(slug);if(!s)throw perr("Établissement introuvable.");
    ADB.inactive=(ADB.inactive||[]).filter(x=>x!==slug);if(!active)ADB.inactive.push(slug);
    const o=ownerOf(slug);if(o){o.disabled=!active;savePDB()}
    adLog("établissement "+(active?"réactivé":"désactivé"),s.name+(reason?" — "+reason:""));return{slug,active,owner_active:o?active:null}},
  async setAccountStatus(id,active){const a=PDB.accounts[id];if(!a)throw perr("Compte introuvable.");a.disabled=!active;
    const app=PDB.apps[id];if(app&&app.slug){ADB.inactive=(ADB.inactive||[]).filter(x=>x!==app.slug);if(!active)ADB.inactive.push(app.slug)}
    if(!active&&PDB.session&&PDB.session.account_id===id)PDB.session=null;
    savePDB();adLog("compte "+(active?"réactivé":"désactivé"),a.email||a.phone||id);return{id,active}},
  async salonDraft(slug){const s=salonBy(slug);if(!s)throw perr("Établissement introuvable.");return salonToDraft(s)},
  async updateSalon(slug,draft){const old=salonBy(slug);if(!old)throw perr("Établissement introuvable.");
    const miss=checkDraft(draft,paToday()).filter(x=>x.s!==5);if(miss.length)throw perr("Fiche incomplète.",miss.map(x=>x.m));
    const s=draftToSalon(draft,slug);Object.assign(s,{rating:old.rating,reviews:old.reviews,isNew:old.isNew,others:[...draft.other_activities],owner:old.owner});
    const i=DATA.salons.findIndex(x=>x.slug===slug);DATA.salons[i]=s;ADB.edited[slug]=s;
    const app=Object.values(PDB.apps).find(a=>a.slug===slug);if(app){app.salon=s;savePDB()}
    adLog("fiche modifiée",old.name+(s.name!==old.name?" → "+s.name:""));return{slug,name:s.name}},
  async getContent(){return{...ADB.content}},
  async putContent(vals){const f=contentFields(),errs=[];
    for(const[k,v]of Object.entries(vals)){if(!f[k]){errs.push("Champ inconnu : "+k+".");continue}if(!v)continue;
      if(f[k].t==="t"&&v.length>f[k].m)errs.push(adLabel(k)+" : "+f[k].m+" caractères maximum.");
      if(f[k].t==="i"&&(v.length>MAX_IMG||!IMG_RE.test(v)))errs.push(adLabel(k)+" : image WebP, JPEG, PNG ou AVIF de 1,1 Mo maximum.")}
    if(errs.length)throw perr("Contenu refusé.",errs);
    const merged=Object.fromEntries(Object.entries({...ADB.content,...vals}).filter(([,v])=>v));
    if(Object.values(merged).reduce((n,v)=>n+v.length,0)>MAX_CONTENT)throw perr("Trop d'images : 9 Mo au total maximum.");
    ADB.content=merged;saveADB();adLog("contenu modifié",Object.keys(vals).map(adLabel).join(", ")||"aucun champ");return{...ADB.content}},
  async getRefs(){return JSON.parse(JSON.stringify({territoires:Object.fromEntries(Object.entries(DATA.territories).map(([k,v])=>[k,v.name])),categories:DATA.categories,communes:PRO.communes,modeles:PRO.modeles}))},
  async putRefs(r){const errs=refsErrors(r);if(errs.length)throw perr("Référentiels refusés.",errs);
    const clean={territoires:Object.fromEntries(Object.entries(r.territoires).map(([k,v])=>[k,v.trim()])),categories:Object.fromEntries(Object.entries(r.categories).map(([k,v])=>[k,v.trim()])),
      communes:Object.fromEntries(Object.entries(r.communes).map(([t,l])=>[t,[...new Set(l.map(c=>c.trim()))].sort((a,b)=>a.localeCompare(b,"fr"))])),modeles:r.modeles};
    ADB.refs=clean;saveADB();applyRefs(clean);
    adLog("référentiels modifiés",Object.keys(clean.categories).length+" univers, "+Object.values(clean.communes).reduce((n,l)=>n+l.length,0)+" communes, "+Object.values(clean.modeles).reduce((n,l)=>n+l.length,0)+" prestations types");
    return this.getRefs()},
  async journal(){return[...ADB.log].reverse()},
};
/* Règles des référentiels — miroir de put_refs (api/app/admin.py) */
function refsErrors(r){
  const e=[],drafts=Object.values(PDB.apps).filter(a=>a.status!=="valide").map(a=>a.draft);
  for(const[k,n]of Object.entries(r.territoires))if(!(n.trim().length>=2&&n.trim().length<=40))e.push("Nom du territoire "+k+" : 2 à 40 caractères.");
  for(const[k,n]of Object.entries(r.categories)){if(!/^[a-z0-9-]{2,30}$/.test(k))e.push("Identifiant d'univers invalide : "+k+".");if(!(n.trim().length>=2&&n.trim().length<=40))e.push("Nom de l'univers "+k+" : 2 à 40 caractères.")}
  const used=new Set([...DATA.salons.map(s=>s.cat),...drafts.flatMap(d=>[d.activity,...(d.other_activities||[])]).filter(Boolean)]);
  for(const c of[...used].sort())if(!(c in r.categories))e.push("L'univers « "+(DATA.categories[c]||c)+" » est utilisé : impossible de le supprimer.");
  for(const[t,l]of Object.entries(r.communes)){const T=DATA.territories[t].name;
    if(new Set(l).size!==l.length)e.push("Commune en double ("+T+").");
    if(l.some(c=>!(c.trim().length>=2&&c.trim().length<=60)))e.push("Nom de commune invalide ("+T+").");
    const u=new Set();DATA.salons.filter(s=>s.t===t).forEach(s=>{u.add(s.commune);Object.keys(s.zones).forEach(z=>u.add(z))});
    drafts.filter(d=>d.territory===t).forEach(d=>{if(d.commune)u.add(d.commune);Object.keys(d.home_zones||{}).forEach(z=>u.add(z))});
    for(const c of[...u].sort())if(!l.includes(c))e.push("La commune « "+c+" » est utilisée par un établissement : impossible de la supprimer.")}
  for(const[cat,tpls]of Object.entries(r.modeles)){
    if(!(cat in r.categories))e.push("Prestations types pour un univers inconnu : "+cat+".");
    if(new Set(tpls.map(t=>t.id)).size!==tpls.length)e.push("Deux prestations types portent le même identifiant ("+(r.categories[cat]||cat)+").");
    for(const t of tpls){if(!t.name||t.name.trim().length<2)e.push("Une prestation type n'a pas de nom ("+(r.categories[cat]||cat)+").");
      if(t.duration%15)e.push("« "+t.name+" » : durée par tranches de 15 minutes.");
      if(t.pose&&!(0<t.pose[0]&&0<t.pose[1]&&t.pose[0]+t.pose[1]<t.duration))e.push("« "+t.name+" » : le temps de pose doit tenir dans la prestation.")}}
  return[...new Set(e)];
}

/* ── Adaptateur HTTP ── */
function HttpAdmin(base){
  let tok=null;try{tok=sessionStorage.getItem("beautyme.admin.token")}catch(e){}
  const call=async(m,p,b)=>{const r=await fetch(base+p,{method:m,headers:{"Content-Type":"application/json",...(tok?{Authorization:"Bearer "+tok}:{})},body:b?JSON.stringify(b):undefined});
    if(r.status===204)return null;const j=await r.json().catch(()=>({}));
    if(r.status===401&&p!=="/v1/admin/connexion"){tok=null;try{sessionStorage.removeItem("beautyme.admin.token")}catch(e){}}
    if(!r.ok){const d=j.detail;if(d&&d.missing)throw perr(d.message,d.missing);throw perr(typeof d==="string"?d:"Le service ne répond pas comme prévu ("+r.status+").")}return j};
  return{mode:"api",signedIn:()=>!!tok,
    async login(l,p){const r=await call("POST","/v1/admin/connexion",{login:l,password:p});tok=r.token;try{sessionStorage.setItem("beautyme.admin.token",tok)}catch(e){}if(ProAPI.setAdmin)ProAPI.setAdmin(tok)},
    async logout(){await call("POST","/v1/admin/deconnexion").catch(()=>{});tok=null;try{sessionStorage.removeItem("beautyme.admin.token")}catch(e){}},
    dashboard:()=>call("GET","/v1/admin/tableau-de-bord"),salons:()=>call("GET","/v1/admin/etablissements"),accounts:()=>call("GET","/v1/admin/comptes"),
    setSalonStatus:(slug,active,reason)=>call("POST","/v1/admin/etablissements/"+encodeURIComponent(slug)+"/statut",{active,reason:reason||null}),
    setAccountStatus:(id,active)=>call("POST","/v1/admin/comptes/"+encodeURIComponent(id)+"/statut",{active}),
    salonDraft:slug=>call("GET","/v1/admin/etablissements/"+encodeURIComponent(slug)+"/fiche"),
    updateSalon:(slug,d)=>call("PUT","/v1/admin/etablissements/"+encodeURIComponent(slug),d),
    getContent:async()=>(await call("GET","/v1/contenu")).valeurs,putContent:async v=>(await call("PUT","/v1/admin/contenu",v)).valeurs,
    getRefs:()=>call("GET","/v1/admin/referentiels"),putRefs:r=>call("PUT","/v1/admin/referentiels",r),journal:()=>call("GET","/v1/admin/journal")};
}
const AdminAPI=window.BEAUTYME_API?HttpAdmin(String(window.BEAUTYME_API).replace(/\/$/,"")):LocalAdmin;
if(AdminAPI.mode==="api"){
  try{const t=sessionStorage.getItem("beautyme.admin.token");if(t&&ProAPI.setAdmin)ProAPI.setAdmin(t)}catch(e){}
  fetch(String(window.BEAUTYME_API).replace(/\/$/,"")+"/v1/contenu").then(r=>r.json()).then(j=>{ADB.content=j.valeurs||{};applyContent()}).catch(()=>{});
}

/* ── État ── */
const AD={tab:"tableau",err:"",msg:"",missing:null,edit:null,filters:{t:"",st:"",q:""},confirm:null,reason:"",content:null,refs:null,refT:"MQ",refCat:null,data:null};
const AD_TABS=[["tableau","Tableau de bord"],["demandes","Demandes"],["prestataires","Prestataires"],["contenu","Contenu du site"],["referentiels","Référentiels"],["journal","Journal"]];
const ST_LABEL={brouillon:"Brouillon",en_revue:"En revue",valide:"En ligne",refuse:"À corriger"};
function adLabel(k){for(const[,l]of CONTENT_GROUPS)for(const[key,lab]of l)if(key===k)return lab;if(k.startsWith("photo_"))return"Photo « "+(DATA.categories[k.slice(6)]||k.slice(6))+" »";return k}
async function adBadge(){const b=document.querySelector('#ad-tabs [data-tab="demandes"] .ad-count');if(!b||!AdminAPI.signedIn())return;try{const d=await AdminAPI.dashboard();b.textContent=d.demandes_en_attente||"";b.hidden=!d.demandes_en_attente}catch(e){}}
async function adRun(fn,ok){AD.err="";AD.missing=null;try{await fn();if(ok)toast(ok)}catch(e){AD.err=e.message;AD.missing=e.missing||null}renderAdmin()}
const adErr=()=>(AD.err?'<div class="err" role="alert">'+esc(AD.err)+(AD.missing?'<ul class="ad-miss">'+AD.missing.map(m=>"<li>"+esc(m)+"</li>").join("")+"</ul>":"")+"</div>":"");

/* ── Rendu ── */
async function renderAdmin(){
  const root=$("ad-root");if(!root)return;
  if(!AdminAPI.signedIn()){ED.mode="partner";root.innerHTML=adLoginView();return}
  if(AD.edit){ED.mode="admin";const pr=$("pa-root");if(pr)pr.innerHTML="";root.innerHTML=adEditView();renderPaNav();return}
  ED.mode="partner";
  let h='<div class="pa-top"><div><p class="eyebrow">Équipe BeautyMe</p><h2>Administration</h2></div><div class="pa-top-r"><span class="pa-status">Connecté : ADMIN</span><button class="btn ghost" type="button" onclick="adLogout()">Se déconnecter</button></div></div>'
   +'<div class="ad-tabs" id="ad-tabs" role="tablist" aria-label="Rubriques d\'administration">'+AD_TABS.map(([k,l])=>'<button type="button" role="tab" data-tab="'+k+'" aria-selected="'+(AD.tab===k)+'" onclick="adTab(\''+k+'\')">'+l+(k==="demandes"?' <span class="ad-count" hidden></span>':"")+"</button>").join("")+"</div>"
   +'<div class="ad-body" id="ad-body" role="tabpanel">'+adErr()+'<p class="note">Chargement…</p></div>';
  root.innerHTML=h;adBadge();
  const body=$("ad-body"),err=adErr();
  try{
    if(AD.tab==="tableau")body.innerHTML=err+await adDashboard();
    else if(AD.tab==="demandes"){body.innerHTML=err+'<p class="pa-lead">Vérifiez le SIRET et l\'assurance, puis publiez l\'établissement ou expliquez au prestataire ce qu\'il doit corriger.</p><div id="va-list" aria-live="polite"></div>';await renderValidation()}
    else if(AD.tab==="prestataires")body.innerHTML=err+await adProviders();
    else if(AD.tab==="contenu")body.innerHTML=err+await adContent();
    else if(AD.tab==="referentiels")body.innerHTML=err+await adRefs();
    else body.innerHTML=err+await adJournal();
  }catch(e){body.innerHTML='<p class="err">'+esc(e.message)+"</p>"}
}
function adTab(k){AD.tab=k;AD.err="";AD.missing=null;AD.confirm=null;renderAdmin()}
function adLoginView(){
  return'<div class="pa-auth"><div class="pa-pitch"><p class="eyebrow">Équipe BeautyMe</p><h2>Administration du site.</h2><ul><li><b>Prestataires</b>Validez les inscriptions, activez ou désactivez un compte, corrigez une fiche.</li><li><b>Contenu</b>Modifiez les textes et les photos des pages sans toucher au code.</li><li><b>Référentiels</b>Univers, prestations types, communes de chaque territoire.</li></ul></div>'
   +'<form class="pa-card" onsubmit="event.preventDefault();adLogin()" novalidate>'+(AD.err?'<p class="err" role="alert">'+esc(AD.err)+"</p>":"")
   +'<div class="field"><label for="ad-login">Identifiant</label><input id="ad-login" autocomplete="username" autocapitalize="characters"></div>'
   +'<div class="field"><label for="ad-pw">Mot de passe</label><input id="ad-pw" type="password" autocomplete="current-password"></div>'
   +'<button class="btn block" type="submit">Se connecter</button>'+(AdminAPI.mode==="demo"?'<p class="note" style="margin-top:14px">Démonstration : l\'accès est vérifié dans le navigateur. En production, il passe par le serveur.</p>':"")+"</form></div>";
}
function adLogin(){const l=$("ad-login").value,p=$("ad-pw").value;AD.err="";AdminAPI.login(l,p).then(()=>{AD.tab=AD.tab||"tableau";renderAdmin()}).catch(e=>{AD.err=e.message;renderAdmin()})}
function adLogout(){AdminAPI.logout().then(()=>{AD.edit=null;AD.content=null;AD.refs=null;renderAdmin()})}

async function adDashboard(){
  const d=await AdminAPI.dashboard();
  const k=(l,v)=>'<div><span class="lbl">'+l+'</span><b class="num">'+v+"</b></div>";
  let h='<div class="kpis">'+k("Établissements en ligne",d.etablissements_en_ligne)+k("Demandes en attente",d.demandes_en_attente)+k("Comptes prestataires",d.comptes_prestataires)+k("Rendez-vous à venir",d.rendez_vous_a_venir)+"</div>";
  h+='<div class="ad-grid2"><div class="ad-panel"><h3>À traiter</h3>'
   +(d.demandes_en_attente?'<p>'+d.demandes_en_attente+" demande"+(d.demandes_en_attente>1?"s":"")+' d\'inscription à vérifier.</p><button class="btn" type="button" onclick="adTab(\'demandes\')">Voir les demandes</button>':'<p class="note">Aucune demande en attente.</p>')
   +(d.etablissements_desactives||d.comptes_desactives?'<p style="margin-top:14px">'+d.etablissements_desactives+" établissement(s) et "+d.comptes_desactives+' compte(s) désactivé(s).</p><button class="btn ghost" type="button" onclick="AD.filters.st=\'off\';adTab(\'prestataires\')">Voir les désactivés</button>':"")+"</div>"
   +'<div class="ad-panel"><h3>En ligne par territoire</h3><dl class="recap">'+Object.entries(d.par_territoire).map(([t,n])=>"<div><dt>"+esc(DATA.territories[t].name)+'</dt><dd class="num">'+n+"</dd></div>").join("")+"</dl></div></div>";
  return h;
}

async function adProviders(){
  const[list,accs]=await Promise.all([AdminAPI.salons(),AdminAPI.accounts()]);const f=AD.filters,q=f.q.trim().toLowerCase();
  const rows=list.filter(s=>(!f.t||s.territory===f.t)&&(!f.st||(f.st==="on"?s.active:!s.active))&&(!q||(s.name+" "+s.commune).toLowerCase().includes(q)));
  const seg=(key,opts)=>'<div class="seg" role="group">'+opts.map(([v,l])=>'<button type="button" aria-pressed="'+(f[key]===v)+'" onclick="AD.filters.'+key+'=\''+v+'\';renderAdmin()">'+l+"</button>").join("")+"</div>";
  let h='<div class="ad-filters">'+seg("t",[["","Tous"],...Object.entries(DATA.territories).map(([k,v])=>[k,v.name])])+seg("st",[["","Tous"],["on","En ligne"],["off","Désactivés"]])
   +'<div class="field" style="margin:0;flex:1;min-width:200px"><label class="sr" for="ad-q">Rechercher un établissement</label><input id="ad-q" placeholder="Rechercher par nom ou commune" value="'+esc(f.q)+'" oninput="AD.filters.q=this.value;clearTimeout(adProviders._t);adProviders._t=setTimeout(()=>{renderAdmin().then(()=>{const e=$(\'ad-q\');if(e){e.focus();e.setSelectionRange(e.value.length,e.value.length)}})},250)"></div></div>';
  h+='<p class="note" style="margin:12px 0">'+rows.length+" établissement"+(rows.length>1?"s":"")+"</p>";
  h+=rows.map(s=>{const c=AD.confirm===s.slug;
    return'<article class="ad-row'+(s.active?"":" off")+'"><div class="ad-row-main"><p class="eyebrow">'+esc(DATA.categories[s.category]||s.category)+" · "+esc(s.commune)+", "+esc(DATA.territories[s.territory].name)+"</p><h3>"+esc(s.name)+'</h3><p class="note">'+(s.owner?"Partenaire · "+esc(s.owner.email||s.owner.phone):"Établissement de démonstration")+(s.reviews?" · "+String(s.rating).replace(".",",")+" / 5, "+s.reviews+" avis":" · Nouveau")+"</p></div>"
     +'<span class="pa-status '+(s.active?"s-valide":"s-refuse")+'">'+(s.active?"En ligne":"Désactivé")+"</span>"
     +'<div class="ad-row-act">'+(c?'<div class="field" style="margin:0"><label for="ad-reason">Motif (facultatif, visible dans le journal)</label><input id="ad-reason" maxlength="300" oninput="AD.reason=this.value"></div><button class="btn ghost" type="button" onclick="AD.confirm=null;renderAdmin()">Annuler</button><button class="btn" type="button" onclick="adToggleSalon(\''+s.slug+'\',false)">Confirmer la désactivation</button>'
       :'<button class="btn ghost" type="button" onclick="adEdit(\''+s.slug+'\')">Modifier la fiche</button><button class="btn ghost" type="button" onclick="B=null;showPage(\'salon\',{slug:\''+s.slug+'\'})">Voir</button>'+(s.active?'<button class="btn ghost" type="button" onclick="AD.confirm=\''+s.slug+'\';AD.reason=\'\';renderAdmin()">Désactiver</button>':'<button class="btn" type="button" onclick="adToggleSalon(\''+s.slug+'\',true)">Réactiver</button>'))+"</div></article>"}).join("")||'<div class="empty"><p>Aucun établissement ne correspond.</p></div>';
  h+='<h3 class="ad-h3">Comptes prestataires</h3><p class="pa-lead">Un compte désactivé ne peut plus se connecter ; son établissement est masqué et ses rendez-vous déjà pris sont conservés.</p>';
  h+=accs.length?accs.map(a=>'<article class="ad-row'+(a.active?"":" off")+'"><div class="ad-row-main"><h3 style="font-size:20px">'+esc(a.name||"Fiche non commencée")+'</h3><p class="note">'+esc(a.email||a.phone||a.id)+" · Fiche : "+(a.status?ST_LABEL[a.status]:"aucune")+'</p></div><span class="pa-status '+(a.active?"s-valide":"s-refuse")+'">'+(a.active?"Compte actif":"Compte désactivé")+'</span><div class="ad-row-act"><button class="btn '+(a.active?"ghost":"")+'" type="button" onclick="adToggleAccount(\''+a.id+'\','+!a.active+')">'+(a.active?"Désactiver le compte":"Réactiver le compte")+"</button></div></article>").join(""):'<div class="empty"><p>Aucun compte prestataire pour l\'instant.</p></div>';
  return h;
}
function adToggleSalon(slug,active){const r=AD.reason;adRun(async()=>{await AdminAPI.setSalonStatus(slug,active,r);AD.confirm=null},active?"Établissement réactivé.":"Établissement désactivé.")}
function adToggleAccount(id,active){adRun(()=>AdminAPI.setAccountStatus(id,active),active?"Compte réactivé.":"Compte désactivé.")}
function adEdit(slug){adRun(async()=>{const d=await AdminAPI.salonDraft(slug);AD.edit={slug,draft:d,step:0,dirty:false,name:d.name}})}
function adEditView(){
  const e=AD.edit,miss=paMissing();
  return'<div class="pa-top"><div><p class="eyebrow">Administration · Modifier la fiche</p><h2>'+esc(e.name)+'</h2></div><div class="pa-top-r"><button class="btn ghost" type="button" onclick="adCancelEdit()">Retour à la liste</button></div></div>'
   +adErr()+'<div class="pa-shell"><nav class="pa-nav" id="pa-nav" aria-label="Rubriques de la fiche"></nav><div class="pa-panel">'+stepView(e.step)
   +'<div class="ad-savebar"><p class="note">'+(miss.length?miss.length+" point"+(miss.length>1?"s":"")+" à corriger avant de publier":e.dirty?"Modifications prêtes à publier":"Aucune modification")+'</p><button class="btn" type="button" id="ad-save"'+(miss.length||!e.dirty?" disabled":"")+' onclick="adSaveEdit()">Enregistrer et publier</button></div></div></div>';
}
function adSaveEdit(){const e=AD.edit;adRun(async()=>{await AdminAPI.updateSalon(e.slug,e.draft);AD.edit=null;AD.tab="prestataires";if(B&&B.slug===e.slug)B=null},"Fiche publiée.")}
function adCancelEdit(){AD.edit=null;AD.err="";AD.missing=null;renderAdmin()}

async function adContent(){
  if(!AD.content)AD.content=await AdminAPI.getContent();
  const cur=k=>AD.content[k]!==undefined?AD.content[k]:"";
  const groups=[...CONTENT_GROUPS,["Photos des univers",Object.entries(DATA.categories).map(([c,n])=>["photo_"+c,n,"i"])]];
  let h='<p class="pa-lead">Retour à la ligne : nouvelle ligne. Texte entre astérisques : <i>italique</i>. Laissez un champ vide pour revenir au texte d\'origine.</p>';
  for(const[g,list]of groups){h+='<div class="ad-panel"><h3>'+esc(g)+'</h3><div class="ad-fields">';
    for(const[k,l,t,m]of list){const id="ct-"+k,v=cur(k);
      if(t==="t")h+='<div class="field"><label for="'+id+'">'+esc(l)+'</label><textarea id="'+id+'" rows="'+(m>150?3:2)+'" maxlength="'+m+'" placeholder="'+esc(CONTENT_DEFAULTS[k]||"")+'" oninput="AD.content[\''+k+'\']=this.value;AD.dirtyC=true;$(\'cn-'+k+'\').textContent=this.value.length+\' / '+m+'\'">'+esc(v)+'</textarea><span class="hint" id="cn-'+k+'">'+v.length+" / "+m+"</span></div>";
      else{const src=v||(k.startsWith("photo_")?photoOf(k.slice(6)):CONTENT_DEFAULTS[k]);
        h+='<div class="field ad-img"><span class="lbl">'+esc(l)+'</span><img src="'+esc(src)+'" alt=""><label class="btn ghost" for="'+id+'">Remplacer l\'image</label><input class="sr" id="'+id+'" type="file" accept="image/webp,image/jpeg,image/png,image/avif" onchange="adImage(\''+k+'\',this)">'+(v?'<button type="button" class="pa-link" onclick="AD.content[\''+k+'\']=null;AD.dirtyC=true;renderAdmin()">Revenir à l\'image d\'origine</button>':'<span class="hint">Image d\'origine</span>')+"</div>"}}
    h+="</div></div>"}
  return h+'<div class="ad-savebar ad-sticky"><p class="note">'+(AD.dirtyC?"Modifications non publiées":"Contenu à jour")+'</p><button class="btn ghost" type="button" onclick="AD.content=null;AD.dirtyC=false;renderAdmin()">Annuler les changements</button><button class="btn" type="button" id="ad-content-save" onclick="adSaveContent()">Publier le contenu</button></div>';
}
function adImage(k,input){const f=input.files&&input.files[0];if(!f)return;
  if(!/^image\/(webp|jpeg|png|avif)$/.test(f.type)){AD.err="Format non accepté : WebP, JPEG, PNG ou AVIF.";return renderAdmin()}
  if(f.size>1100000){AD.err="Image trop lourde ("+(f.size/1e6).toFixed(1).replace(".",",")+" Mo) : 1,1 Mo maximum. Réduisez-la avant de l'envoyer.";return renderAdmin()}
  const r=new FileReader();r.onload=()=>{AD.content[k]=r.result;AD.dirtyC=true;AD.err="";renderAdmin()};r.readAsDataURL(f)}
function adSaveContent(){adRun(async()=>{const v={};for(const[k,val]of Object.entries(AD.content))v[k]=val||null;const saved=await AdminAPI.putContent(v);ADB.content=saved;AD.content={...saved};AD.dirtyC=false;applyContent();renderHome()},"Contenu publié.")}

async function adRefs(){
  if(!AD.refs)AD.refs=await AdminAPI.getRefs();
  const r=AD.refs,cats=Object.keys(r.categories);if(!AD.refCat||!(AD.refCat in r.categories))AD.refCat=cats[0];
  let h='<div class="ad-panel"><h3>Territoires</h3><p class="note">Les fuseaux horaires sont fixes : UTC−4 aux Antilles, UTC−3 en Guyane.</p><div class="ad-fields">'+Object.entries(r.territoires).map(([k,v])=>'<div class="field"><label for="rt-'+k+'">'+k+" · "+DATA.territories[k].utc+'</label><input id="rt-'+k+'" maxlength="40" value="'+esc(v)+'" oninput="AD.refs.territoires[\''+k+'\']=this.value;AD.dirtyR=true"></div>').join("")+"</div></div>";
  h+='<div class="ad-panel"><h3>Univers</h3><div class="ad-list">'+cats.map(k=>'<div class="ad-li"><div class="field" style="margin:0;flex:1"><label for="rc-'+k+'">'+k+'</label><input id="rc-'+k+'" maxlength="40" value="'+esc(r.categories[k])+'" oninput="AD.refs.categories[\''+k+'\']=this.value;AD.dirtyR=true"></div><button class="btn ghost" type="button" onclick="adDelCat(\''+k+'\')">Retirer</button></div>').join("")
   +'</div><div class="pa-add"><div class="field" style="flex:1;margin:0"><label for="rc-new">Nouvel univers</label><input id="rc-new" maxlength="40" placeholder="Ex. Maquillage"></div><button class="btn" type="button" onclick="adAddCat()">Ajouter</button></div></div>';
  const T=AD.refT,list=r.communes[T];
  h+='<div class="ad-panel"><h3>Communes</h3><div class="seg" role="group" aria-label="Territoire">'+Object.keys(r.communes).map(t=>'<button type="button" aria-pressed="'+(t===T)+'" onclick="AD.refT=\''+t+'\';renderAdmin()">'+esc(r.territoires[t])+" ("+r.communes[t].length+")</button>").join("")+"</div>"
   +'<div class="ad-communes">'+list.map((c,i)=>'<div class="ad-commune"><span>'+esc(c)+'</span><button type="button" class="pa-link" onclick="AD.refs.communes[\''+T+'\'].splice('+i+',1);AD.dirtyR=true;renderAdmin()">Retirer</button></div>').join("")+"</div>"
   +'<div class="pa-add"><div class="field" style="flex:1;margin:0"><label for="rcm-new">Ajouter une commune ou un quartier</label><input id="rcm-new" maxlength="60" placeholder="Ex. Cacao"></div><button class="btn" type="button" onclick="adAddCommune()">Ajouter</button></div></div>';
  const tpls=r.modeles[AD.refCat]||(r.modeles[AD.refCat]=[]);
  h+='<div class="ad-panel"><h3>Prestations types</h3><p class="note">Proposées aux prestataires lors de l\'inscription, selon leur activité.</p><div class="pa-chips" style="margin:12px 0 16px">'+cats.map(k=>'<button type="button" class="chip" aria-pressed="'+(k===AD.refCat)+'" onclick="AD.refCat=\''+k+'\';renderAdmin()">'+esc(r.categories[k])+" ("+(r.modeles[k]||[]).length+")</button>").join("")+"</div>"
   +tpls.map((t,i)=>{const p="AD.refs.modeles[\'"+AD.refCat+"\']["+i+"]";
     return'<div class="ad-tpl"><div class="field"><label for="tn-'+i+'">Nom</label><input id="tn-'+i+'" maxlength="80" value="'+esc(t.name)+'" oninput="'+p+'.name=this.value;AD.dirtyR=true"></div><div class="field"><label for="ts-'+i+'">Rubrique</label><input id="ts-'+i+'" maxlength="40" value="'+esc(t.section)+'" oninput="'+p+'.section=this.value;AD.dirtyR=true"></div>'
     +'<div class="field"><label for="td-'+i+'">Durée</label><select id="td-'+i+'" onchange="'+p+'.duration=+this.value;if('+p+'.pose&&'+p+'.pose[0]+'+p+'.pose[1]>=+this.value)'+p+'.pose=null;AD.dirtyR=true;renderAdmin()">'+durOpts(t.duration)+'</select></div><div class="field"><label for="tp-'+i+'">Prix (€)</label><input id="tp-'+i+'" inputmode="decimal" value="'+(t.price==null?"":t.price)+'" oninput="'+p+'.price=this.value===\'\'?null:+this.value.replace(\',\',\'.\');AD.dirtyR=true"></div>'
     +'<label class="check"><input type="checkbox" '+(t.home_ok?"checked":"")+' onchange="'+p+'.home_ok=this.checked;AD.dirtyR=true"> À domicile</label><button class="btn ghost" type="button" onclick="AD.refs.modeles[\''+AD.refCat+'\'].splice('+i+',1);AD.dirtyR=true;renderAdmin()">Retirer</button></div>'}).join("")
   +'<button class="btn ghost" type="button" style="margin-top:12px" onclick="adAddTpl()">Ajouter une prestation type</button></div>';
  return h+'<div class="ad-savebar ad-sticky"><p class="note">'+(AD.dirtyR?"Modifications non enregistrées":"Référentiels à jour")+'</p><button class="btn ghost" type="button" onclick="AD.refs=null;AD.dirtyR=false;renderAdmin()">Annuler les changements</button><button class="btn" type="button" id="ad-refs-save" onclick="adSaveRefs()">Enregistrer les référentiels</button></div>';
}
function adAddCat(){const n=$("rc-new").value.trim();const k=slugify(n).slice(0,30);
  if(n.length<2||k.length<2){AD.err="Donnez un nom d'au moins 2 caractères au nouvel univers.";return renderAdmin()}
  if(AD.refs.categories[k]){AD.err="Cet univers existe déjà.";return renderAdmin()}
  AD.refs.categories[k]=n;AD.refs.modeles[k]=[];AD.refCat=k;AD.dirtyR=true;AD.err="";renderAdmin()}
function adDelCat(k){delete AD.refs.categories[k];delete AD.refs.modeles[k];AD.dirtyR=true;renderAdmin()}
function adAddCommune(){const n=$("rcm-new").value.trim(),l=AD.refs.communes[AD.refT];
  if(n.length<2){AD.err="Indiquez le nom de la commune.";return renderAdmin()}
  if(l.some(c=>c.toLowerCase()===n.toLowerCase())){AD.err="« "+n+" » figure déjà dans la liste.";return renderAdmin()}
  l.push(n);l.sort((a,b)=>a.localeCompare(b,"fr"));AD.dirtyR=true;AD.err="";renderAdmin()}
function adAddTpl(){const l=AD.refs.modeles[AD.refCat];l.push({id:uniqueId("prestation",l.map(t=>t.id)),name:"Nouvelle prestation",section:"Prestations",duration:60,price:null,price_from:true,pose:null,home_ok:false,description:""});AD.dirtyR=true;renderAdmin()}
function adSaveRefs(){adRun(async()=>{const r=AD.refs;for(const l of Object.values(r.modeles))for(const t of l)if(/^prestation(-\d+)?$/.test(t.id)&&t.name.trim().length>1)t.id=uniqueId(slugify(t.name).slice(0,40)||t.id,l.filter(x=>x!==t).map(x=>x.id));
  AD.refs=await AdminAPI.putRefs(r);AD.dirtyR=false;renderHome()},"Référentiels enregistrés.")}

async function adJournal(){
  const l=await AdminAPI.journal();const f=new Intl.DateTimeFormat("fr-FR",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"});
  return l.length?'<div class="ad-journal">'+l.map(e=>'<div class="ad-log"><span class="note num">'+f.format(new Date(e.at))+'</span><b>'+esc(e.action)+"</b><span>"+esc(e.detail)+"</span></div>").join("")+"</div>":'<div class="empty"><p>Aucune action enregistrée.</p></div>';
}
