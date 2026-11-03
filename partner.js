/* ═══════════ Espace partenaire ═══════════
   Même contrat que l'API (api/app/pro.py). Adaptateur HTTP si window.BEAUTYME_API est défini,
   sinon démonstration locale (navigateur). Les règles de check_draft sont reproduites à l'identique. */
const PRO=DATA.pro, WD=["Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche"];
const WDL=["lundi","mardi","mercredi","jeudi","vendredi","samedi","dimanche"];
/* Contexte d'édition : la même fiche sert au prestataire (brouillon) et à l'admin (établissement en ligne) */
const ED={mode:"partner",get d(){return ED.mode==="admin"?AD.edit.draft:PA.app.draft},get last(){return ED.mode==="admin"?4:6}};
const PA_STEPS=[["activite","Activité"],["etablissement","Établissement"],["prestations","Prestations"],["equipe","Équipe et horaires"],["domicile","Domicile et acompte"],["documents","Documents"],["verification","Vérification"]];
const STATUS_TXT={brouillon:"Brouillon",en_revue:"En cours de vérification",valide:"En ligne",refuse:"À corriger"};
const DROM_MOBILE={"0696":"596","0697":"596","0690":"590","0691":"590","0694":"594"};

function normalizePhone(raw){
  let d=String(raw||"").replace(/[^\d+]/g,"");if(d.startsWith("00"))d="+"+d.slice(2);
  if(d.startsWith("+")){if(!/^((596|590|594)\d{9}|33\d{9})$/.test(d.slice(1)))throw Error("Numéro international non reconnu.");return d}
  if(!/^0\d{9}$/.test(d))throw Error("10 chiffres attendus, par exemple 0696 12 34 56.");
  return "+"+(DROM_MOBILE[d.slice(0,4)]||"33")+d.slice(1);
}
function siretOk(s){const d=String(s||"").replace(/\s/g,"");if(!/^\d{14}$/.test(d))return false;let t=0;[...d].reverse().forEach((c,i)=>{let n=+c*(i%2?2:1);t+=n>9?n-9:n});return t%10===0}
function slugify(s){return String(s).replace(/œ/g,"oe").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^\x00-\x7f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"")}
const jsq=s=>esc(String(s).replace(/\\/g,"\\\\").replace(/'/g,"\\'"));
const hmToMin=s=>{const[h,m]=s.split(":");return +h*60+ +m};

function emptyDraft(){return{activity:null,other_activities:[],name:null,territory:null,commune:null,address:null,about:null,price_level:null,deposit_pct:0,home_zones:{},services:[],staff:[],documents:{siret:null,rc_pro:null,rc_pro_expiry:null,diplome:null}}}

/* check_draft — miroir exact de api/app/pro.py ; chaque point porte son étape */
function checkDraft(d,today){
  const out=[],add=(s,m)=>out.push({s,m}),CAT=DATA.categories;
  if(!(d.activity in CAT))add(0,"Choisissez votre activité principale.");
  if((d.other_activities||[]).some(a=>!(a in CAT)))add(0,"Une activité secondaire est inconnue.");
  if(!d.name||d.name.trim().length<2)add(1,"Indiquez le nom de l'établissement.");
  if(!d.territory)add(1,"Choisissez le territoire.");
  else if(!PRO.communes[d.territory].includes(d.commune))add(1,"Choisissez la commune de l'établissement.");
  if(!d.address||d.address.trim().length<8)add(1,"Indiquez l'adresse complète.");
  if(!d.about||d.about.trim().length<40)add(1,"Présentez l'établissement en quelques phrases (40 caractères minimum).");
  if(!d.price_level)add(1,"Indiquez la gamme de prix.");
  const zones=d.home_zones||{};
  if(d.territory){const bad=Object.keys(zones).filter(c=>!PRO.communes[d.territory].includes(c));if(bad.length)add(4,"Commune desservie inconnue : "+bad.join(", ")+".")}
  if(Object.values(zones).some(t=>!(t>=5&&t<=120)))add(4,"Temps de trajet à domicile : entre 5 et 120 minutes.");
  const svcs=d.services||[];
  if(!svcs.length)add(2,"Ajoutez au moins une prestation.");
  const ids=svcs.map(s=>s.id);
  if(new Set(ids).size!==ids.length)add(2,"Deux prestations portent le même identifiant.");
  for(const s of svcs){
    if(s.duration%15)add(2,"« "+s.name+" » : durée par tranches de 15 minutes.");
    if(s.pose&&!(0<s.pose[0]&&0<s.pose[1]&&s.pose[0]+s.pose[1]<s.duration))add(2,"« "+s.name+" » : le temps de pose doit tenir dans la prestation.");
    if(s.price==null&&!s.price_from)add(2,"« "+s.name+" » : indiquez un prix ou cochez « sur devis ».");
    if(s.home_ok&&!Object.keys(zones).length)add(4,"« "+s.name+" » est proposée à domicile : ajoutez au moins une commune desservie.");
  }
  const staff=d.staff||[];
  if(!staff.length)add(3,"Ajoutez au moins un membre de l'équipe.");
  const online=new Set(svcs.filter(s=>s.online!==false).map(s=>s.id)),covered=new Set();
  for(const p of staff){
    const unknown=[...new Set(p.skills)].filter(x=>!ids.includes(x)).sort();
    if(unknown.length)add(3,p.name+" : prestation inconnue ("+unknown.join(", ")+").");
    p.skills.forEach(x=>covered.add(x));
    if(![0,1,2,3,4,5,6].some(i=>(p.hours[i]||[]).length))add(3,p.name+" : renseignez au moins un jour de travail.");
    for(const [wd,ivs] of Object.entries(p.hours)){
      const w=+wd;if(!(w>=0&&w<=6)){add(3,p.name+" : jour invalide.");continue}
      let prev=-1;
      for(const [a,b] of ivs.map(([x,y])=>[hmToMin(x),hmToMin(y)]).sort((u,v)=>u[0]-v[0]||u[1]-v[1])){
        if(b<=a||a<prev||a%15||b%15){add(3,p.name+" : horaires incohérents le "+WDL[w]+".");break}prev=b}
    }
  }
  const orphan=svcs.filter(s=>online.has(s.id)&&!covered.has(s.id)).map(s=>s.name);
  if(orphan.length)add(3,"Personne ne réalise : "+orphan.join(", ")+".");
  if(svcs.some(s=>s.home_ok)&&!staff.some(p=>p.home))add(3,"Une prestation est proposée à domicile mais personne ne se déplace.");
  const doc=d.documents||{};
  if(!doc.siret||!siretOk(doc.siret))add(5,"Numéro SIRET invalide (14 chiffres).");
  if(!doc.rc_pro)add(5,"Déposez l'attestation d'assurance RC Pro.");
  else if(!doc.rc_pro_expiry||doc.rc_pro_expiry<=today)add(5,"Indiquez une date de fin de validité de l'assurance RC Pro à venir.");
  const seen=new Set();return out.filter(x=>!seen.has(x.m)&&seen.add(x.m));
}

function draftToSalon(d,slug){
  const hrs=h=>Object.fromEntries(Object.entries(h).filter(([,v])=>v.length).map(([k,v])=>[k,v.map(([a,b])=>[hmToMin(a),hmToMin(b)]).sort((x,y)=>x[0]-y[0])]));
  return{slug,name:d.name.trim(),t:d.territory,commune:d.commune,cat:d.activity,deposit:d.deposit_pct,zones:{...d.home_zones},rating:0,reviews:0,price:d.price_level,address:d.address,about:d.about,isNew:true,
    services:d.services.map(s=>({id:s.id,name:s.name,sec:s.section,dur:s.duration,price:s.price==null?null:Math.round(s.price*100),from:!!s.price_from,pose:s.pose||null,home:!!s.home_ok,online:s.online!==false,desc:s.description||""})),
    staff:d.staff.map(p=>({id:p.id,name:p.name,home:!!p.home,skills:[...p.skills].sort(),hours:hrs(p.hours)}))};
}
const paToday=()=>{let t="MQ";try{t=ED.d.territory||"MQ"}catch(e){}return todayIn(tzOf(t))};

/* ── Adaptateur local (démonstration) ── */
const PKEY="beautyme.pro.v1",DISABLED_MSG="Ce compte est désactivé. Contactez l'équipe BeautyMe.";
let PDB=null;
try{PDB=JSON.parse(localStorage.getItem(PKEY)||"null")}catch(e){PDB=null}
PDB=PDB||{accounts:{},byEmail:{},byPhone:{},apps:{},session:null,otp:{}};
function savePDB(){try{localStorage.setItem(PKEY,JSON.stringify(PDB))}catch(e){}}
function perr(msg,missing){const e=Error(msg);e.missing=missing||null;return e}
const rid=p=>p+Math.random().toString(36).slice(2,10);
const demoHash=(pw,salt)=>"demo$"+salt+"$"+fnv1a(salt+"|"+pw).toString(16);
function appView(a){return{...a,missing:checkDraft(a.draft,paToday()).map(x=>x.m)}}
const LocalPro={
  mode:"demo",
  async requestCode(phone,channel){const p=normalizePhone(phone);const o=PDB.otp[p];if(o&&Date.now()-o.sent<30000)throw perr("Patientez 30 secondes avant de demander un nouveau code.");PDB.otp[p]={code:"2026",exp:Date.now()+600000,sent:Date.now(),left:5,channel};savePDB();return{sent_to:p.slice(0,-4)+"••••",channel}},
  async verifyCode(phone,code){const p=normalizePhone(phone),o=PDB.otp[p];
    if(!o||o.exp<Date.now())throw perr("Code expiré. Demandez-en un nouveau.");if(o.left<=0)throw perr("Trop d'essais. Demandez un nouveau code.");
    if(String(code).trim()!==o.code){o.left--;savePDB();throw perr("Code incorrect. "+o.left+" essai(s) restant(s).")}
    delete PDB.otp[p];let id=PDB.byPhone[p],isNew=!id;if(id&&PDB.accounts[id].disabled)throw perr(DISABLED_MSG);if(isNew){id=rid("acc_");PDB.accounts[id]={id,phone:p};PDB.byPhone[p]=id}
    PDB.session={account_id:id,method:"telephone"};savePDB();return{account_id:id,new_account:isNew}},
  async register(email,password,phone){email=String(email||"").trim().toLowerCase();
    if(!/^[^@\s]{1,64}@[^@\s]{1,190}\.[A-Za-z]{2,24}$/.test(email))throw perr("Adresse e-mail invalide.");
    if(password.length<10||!/[A-Za-z]/.test(password)||!/\d/.test(password))throw perr("Mot de passe : 10 caractères minimum, lettres et chiffres.");
    if(PDB.byEmail[email])throw perr("Un compte existe déjà avec cet e-mail. Connectez-vous.");
    const p=phone?normalizePhone(phone):null;if(p&&PDB.byPhone[p])throw perr("Ce numéro est déjà rattaché à un compte. Connectez-vous par code.");
    const id=rid("acc_"),salt=rid("");PDB.accounts[id]={id,email,phone:p,password:demoHash(password,salt)};PDB.byEmail[email]=id;if(p)PDB.byPhone[p]=id;
    PDB.session={account_id:id,method:"email"};savePDB();return{account_id:id,new_account:true}},
  async login(email,password){const id=PDB.byEmail[String(email||"").trim().toLowerCase()],a=id&&PDB.accounts[id];
    if(!a||!a.password||demoHash(password,a.password.split("$")[1])!==a.password)throw perr("E-mail ou mot de passe incorrect.");
    if(a.disabled)throw perr(DISABLED_MSG);
    PDB.session={account_id:id,method:"email"};savePDB();return{account_id:id,new_account:false}},
  async logout(){PDB.session=null;savePDB()},
  signedIn(){return!!(PDB.session&&PDB.accounts[PDB.session.account_id])},
  account(){return PDB.session&&PDB.accounts[PDB.session.account_id]},
  _app(){const id=PDB.session.account_id;return PDB.apps[id]||(PDB.apps[id]={id:rid("dem_"),account_id:id,status:"brouillon",draft:emptyDraft(),reason:null,slug:null,submitted_at:null,decided_at:null})},
  async getApp(){if(!this.signedIn())throw perr("Connectez-vous à votre espace partenaire.");if(this.account().disabled)throw perr(DISABLED_MSG);return appView(this._app())},
  async saveDraft(draft){const a=this._app();if(a.status==="en_revue")throw perr("Votre demande est en cours de vérification ; elle ne peut pas être modifiée.");
    a.draft=JSON.parse(JSON.stringify(draft));if(a.status==="refuse")a.status="brouillon";savePDB();return appView(a)},
  async submit(){const a=this._app();if(a.status!=="brouillon")throw perr("Cette demande a déjà été soumise.");
    const miss=checkDraft(a.draft,paToday());if(miss.length)throw perr("Fiche incomplète.",miss.map(x=>x.m));
    a.status="en_revue";a.submitted_at=new Date().toISOString();a.reason=null;savePDB();return appView(a)},
  async adminList(){return Object.values(PDB.apps).filter(a=>a.status==="en_revue").sort((x,y)=>(x.submitted_at||"").localeCompare(y.submitted_at||"")).map(appView)},
  async approve(id){const a=Object.values(PDB.apps).find(x=>x.id===id);if(!a||a.status!=="en_revue")throw perr("Seule une demande en cours de vérification peut être validée.");
    const base=slugify(a.draft.name+"-"+a.draft.commune);let slug=base,n=2;while(salonBy(slug))slug=base+"-"+(n++);
    a.status="valide";a.slug=slug;a.decided_at=new Date().toISOString();a.salon=draftToSalon(a.draft,slug);a.salon.others=[...a.draft.other_activities];a.salon.owner=a.account_id;DATA.salons.push(a.salon);savePDB();
    adLog("demande validée",a.draft.name+" ("+slug+") publié");return appView(a)},
  async reject(id,reason){if(!reason||reason.trim().length<10)throw perr("Expliquez au prestataire ce qu'il doit corriger (10 caractères minimum).");
    const a=Object.values(PDB.apps).find(x=>x.id===id);if(!a||a.status!=="en_revue")throw perr("Seule une demande en cours de vérification peut être refusée.");
    a.status="refuse";a.reason=reason.trim();a.decided_at=new Date().toISOString();savePDB();adLog("demande refusée",(a.draft.name||a.id)+" : "+a.reason);return appView(a)},
};
/* Établissements validés en démonstration : réintégrés au catalogue à chaque visite */
for(const a of Object.values(PDB.apps))if(a.status==="valide"&&a.salon&&!salonBy(a.salon.slug))DATA.salons.push(a.salon);

/* ── Adaptateur HTTP (API FastAPI) ── */
function HttpPro(base){
  let token=null,acc=null,admin=null;try{token=sessionStorage.getItem("beautyme.pro.token")}catch(e){}
  const call=async(method,path,body,headers={})=>{
    const r=await fetch(base+path,{method,headers:{"Content-Type":"application/json",...(token?{Authorization:"Bearer "+token}:{}),...headers},body:body?JSON.stringify(body):undefined});
    if(r.status===204)return null;const j=await r.json().catch(()=>({}));
    if(!r.ok){const d=j.detail;if(d&&d.missing)throw perr(d.message,d.missing);throw perr(typeof d==="string"?d:"Le service ne répond pas comme prévu ("+r.status+").")}return j};
  const keep=s=>{token=s.token;acc={id:s.account_id};try{sessionStorage.setItem("beautyme.pro.token",token)}catch(e){}return s};
  return{mode:"api",
    requestCode:(phone,channel)=>call("POST","/v1/pro/auth/code",{phone,channel}),
    verifyCode:async(phone,code)=>keep(await call("POST","/v1/pro/auth/code/verifier",{phone,code})),
    register:async(email,password,phone)=>keep(await call("POST","/v1/pro/auth/inscription",{email,password,phone:phone||null})),
    login:async(email,password)=>keep(await call("POST","/v1/pro/auth/connexion",{email,password})),
    logout:async()=>{await call("POST","/v1/pro/auth/deconnexion").catch(()=>{});token=null;try{sessionStorage.removeItem("beautyme.pro.token")}catch(e){}},
    signedIn:()=>!!token,account:()=>acc,
    getApp:()=>call("GET","/v1/pro/etablissement"),
    saveDraft:d=>call("PUT","/v1/pro/etablissement",d),
    submit:()=>call("POST","/v1/pro/etablissement/soumettre"),
    setAdmin:t=>{admin=t},
    adminList:()=>call("GET","/v1/admin/demandes",null,{Authorization:"Bearer "+(admin||"")}),
    approve:id=>call("POST","/v1/admin/demandes/"+encodeURIComponent(id)+"/valider",null,{Authorization:"Bearer "+(admin||"")}),
    reject:(id,reason)=>call("POST","/v1/admin/demandes/"+encodeURIComponent(id)+"/refuser",{reason},{Authorization:"Bearer "+(admin||"")}),
  };
}
const ProAPI=window.BEAUTYME_API?HttpPro(String(window.BEAUTYME_API).replace(/\/$/,"")):LocalPro;

/* ── État de l'écran ── */
const PA={app:null,step:0,auth:"tel",emailMode:"connexion",phone:"",channel:"whatsapp",codeSent:null,err:"",info:"",loading:false,newSvc:{name:"",section:"",duration:60,price:""},confirmSubmit:false};
const VA={reasons:{},err:"",refusing:null};
let paTimer=null;
function paMissing(){if(ED.mode==='admin')return checkDraft(ED.d,paToday()).filter(x=>x.s!==5);return PA.app?checkDraft(ED.d,paToday()):[]}
function paPersist(rerender){
  if(ED.mode==="admin"){AD.edit.dirty=true;if(rerender)renderAdmin();else renderPaNav();return}
  clearTimeout(paTimer);
  if(rerender)renderPartner();else renderPaNav();
  paTimer=setTimeout(async()=>{try{const a=await ProAPI.saveDraft(ED.d);PA.app.status=a.status;PA.app.reason=a.reason;PA.saved=Date.now();const s=$("pa-saved");if(s)s.textContent="Enregistré"}catch(e){PA.err=e.message;renderPartner()}},ProAPI.mode==="api"?500:0);
}
async function paLoad(){try{PA.app=await ProAPI.getApp();PA.err=""}catch(e){PA.app=null;PA.err=e.message;await ProAPI.logout()}renderPartner()}

/* ── Rendu ── */
const opt=(v,l,sel)=>'<option value="'+esc(v)+'"'+(String(v)===String(sel)?" selected":"")+">"+esc(l)+"</option>";
const timeOpts=sel=>{let o="";for(let m=360;m<=1320;m+=15)o+=opt(hm(m),hm(m),sel);return o};
const durOpts=sel=>{let o="";for(let m=15;m<=600;m+=15)o+=opt(m,dur(m),sel);return o};
function renderPartner(){
  const root=$("pa-root");if(!root)return;
  ED.mode="partner";const ar=$("ad-root");if(ar&&AD.edit)ar.innerHTML="";
  if(!ProAPI.signedIn()){root.innerHTML=authView();return}
  if(!PA.app){root.innerHTML='<p class="note">Chargement de votre espace…</p>';paLoad();return}
  const a=PA.app,st=a.status;
  let h='<div class="pa-top"><div><p class="eyebrow">Espace partenaire</p><h2>'+esc(a.draft.name||"Votre établissement")+'</h2></div><div class="pa-top-r"><span class="pa-status s-'+st+'">'+STATUS_TXT[st]+'</span><button class="btn ghost" type="button" onclick="paLogout()">Se déconnecter</button></div></div>';
  if(PA.err)h+='<p class="err" role="alert">'+esc(PA.err)+"</p>";
  if(st==="refuse")h+='<div class="pa-banner b-alert"><strong>Votre demande est à corriger.</strong><p>'+esc(a.reason||"")+'</p><p class="note">Modifiez votre fiche puis soumettez-la à nouveau.</p></div>';
  if(st==="en_revue"){root.innerHTML=h+reviewView();return}
  if(st==="valide"){root.innerHTML=h+liveView();return}
  h+='<div class="pa-shell"><nav class="pa-nav" id="pa-nav" aria-label="Étapes"></nav><div class="pa-panel" id="pa-panel">'+stepView(PA.step)+"</div></div>";
  root.innerHTML=h;renderPaNav();
}
function renderPaNav(){
  const n=$("pa-nav");if(!n)return;const miss=paMissing();
  const steps=ED.mode==="admin"?PA_STEPS.slice(0,5):PA_STEPS;
  n.innerHTML=steps.map(([k,l],i)=>{const c=miss.filter(x=>x.s===i).length,done=i<6&&!c&&stepTouched(i);
    return'<button type="button" class="pa-step'+(i===PA.step?" on":"")+(done?" done":"")+'" aria-current="'+(i===PA.step?"step":"false")+'" onclick="paGo('+i+')"><span class="pa-n num">'+String(i+1).padStart(2,"0")+'</span><span class="pa-l">'+l+'</span><span class="pa-c">'+(i===6?(miss.length?miss.length+" à compléter":"Prête"):c?c+" à compléter":done?"Complet":"")+"</span></button>"}).join("")
   +(ED.mode==="admin"?'<p class="note pa-saved">'+(AD.edit.dirty?"Modifications non publiées":"Aucune modification")+"</p>":'<p class="note pa-saved" id="pa-saved" aria-live="polite">'+(ProAPI.mode==="demo"?"Enregistré sur cet appareil (démonstration)":"Enregistrement automatique")+"</p>");
}
function stepTouched(i){const d=ED.d;if(ED.mode==='admin')return true;return[!!d.activity,!!d.name,d.services.length>0,d.staff.length>0,true,!!d.documents.siret][i]}
function paGo(i){if(ED.mode==='admin'){AD.edit.step=Math.max(0,Math.min(4,i));renderAdmin();const r=$('ad-root');if(r&&r.scrollIntoView)try{r.scrollIntoView({block:'start'})}catch(e){}return}PA.step=Math.max(0,Math.min(6,i));PA.err="";PA.confirmSubmit=false;renderPartner();const p=$("pa-root");if(p&&p.scrollIntoView)try{p.scrollIntoView({block:"start"})}catch(e){}}
function stepFoot(i){return'<div class="pa-foot nav-btns">'+(i>0?'<button class="btn ghost" type="button" onclick="paGo('+(i-1)+')">Étape précédente</button>':"<span></span>")+(i<ED.last?'<button class="btn" type="button" onclick="paGo('+(i+1)+')">Continuer</button>':"")+"</div>"}

function authView(){
  const t=PA.auth;
  let h='<div class="pa-auth"><div class="pa-pitch"><p class="eyebrow">Espace partenaire</p><h2>Proposez vos prestations sur BeautyMe.</h2><ul><li><b>Votre carte en quelques minutes</b>Des prestations types selon votre activité, que vous ajustez : prix, durée, temps de pose, domicile.</li><li><b>Votre équipe, vos horaires</b>Chaque membre a ses prestations et ses jours ; seuls les vrais créneaux libres sont proposés.</li><li><b>Mise en ligne après vérification</b>L\'équipe BeautyMe contrôle SIRET et assurance avant de publier votre établissement.</li></ul></div>';
  h+='<div class="pa-card"><div class="seg" role="group" aria-label="Méthode de connexion"><button type="button" aria-pressed="'+(t==="tel")+'" onclick="PA.auth=\'tel\';PA.err=\'\';renderPartner()">Par mobile</button><button type="button" aria-pressed="'+(t==="email")+'" onclick="PA.auth=\'email\';PA.err=\'\';renderPartner()">Par e-mail</button></div>';
  if(PA.err)h+='<p class="err" role="alert">'+esc(PA.err)+"</p>";
  if(PA.info)h+='<p class="pa-info" role="status">'+esc(PA.info)+"</p>";
  if(t==="tel"){
    h+='<form onsubmit="event.preventDefault();'+(PA.codeSent?"paVerify()":"paSendCode()")+'" novalidate>'
     +'<div class="field"><label for="pa-phone">Numéro de mobile</label><input id="pa-phone" inputmode="tel" autocomplete="tel" placeholder="0696 12 34 56" value="'+esc(PA.phone)+'"'+(PA.codeSent?" readonly":"")+"></div>";
    if(!PA.codeSent)h+='<span class="lbl">Recevoir le code par</span><div class="radio" style="margin:8px 0 18px"><button type="button" class="chip" aria-pressed="'+(PA.channel==="whatsapp")+'" onclick="PA.channel=\'whatsapp\';PA.phone=$(\'pa-phone\').value;renderPartner()">WhatsApp</button><button type="button" class="chip" aria-pressed="'+(PA.channel==="sms")+'" onclick="PA.channel=\'sms\';PA.phone=$(\'pa-phone\').value;renderPartner()">SMS</button></div><button class="btn block" type="submit">Recevoir mon code</button>';
    else h+='<div class="field"><label for="pa-code">Code reçu par '+(PA.channel==="sms"?"SMS":"WhatsApp")+'</label><input id="pa-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="4 chiffres"></div>'+(ProAPI.mode==="demo"?'<p class="note" style="margin:-4px 0 14px">Démonstration : saisissez 2026.</p>':"")+'<button class="btn block" type="submit">Se connecter</button><button class="btn ghost block" type="button" style="margin-top:8px" onclick="PA.codeSent=null;PA.info=\'\';renderPartner()">Changer de numéro</button>';
    h+="</form>";
  }else{
    const reg=PA.emailMode==="inscription";
    h+='<form onsubmit="event.preventDefault();paEmail()" novalidate><div class="field"><label for="pa-email">E-mail</label><input id="pa-email" type="email" autocomplete="email" placeholder="contact@monsalon.fr"></div>'
     +'<div class="field"><label for="pa-pw">Mot de passe</label><input id="pa-pw" type="password" autocomplete="'+(reg?"new-password":"current-password")+'"'+(reg?' placeholder="10 caractères, lettres et chiffres"':"")+"></div>"
     +(reg?'<div class="field"><label for="pa-pw-tel">Mobile (facultatif, pour les rappels WhatsApp)</label><input id="pa-pw-tel" inputmode="tel" autocomplete="tel" placeholder="0696 12 34 56"></div>':"")
     +'<button class="btn block" type="submit">'+(reg?"Créer mon compte":"Se connecter")+'</button><button class="btn ghost block" type="button" style="margin-top:8px" onclick="PA.emailMode=\''+(reg?"connexion":"inscription")+'\';PA.err=\'\';renderPartner()">'+(reg?"J'ai déjà un compte":"Créer un compte")+"</button></form>";
  }
  return h+'<p class="note" style="margin-top:16px">Vous êtes client ? <button type="button" class="pa-link" onclick="showPage(\'recherche\')">Réservez un rendez-vous</button>.</p></div></div>';
}
async function paRun(fn){PA.err="";PA.info="";try{await fn()}catch(e){PA.err=e.message}renderPartner()}
function paSendCode(){PA.phone=$("pa-phone").value;paRun(async()=>{const r=await ProAPI.requestCode(PA.phone,PA.channel);PA.codeSent=r.sent_to;PA.info="Code envoyé au "+r.sent_to+" par "+(PA.channel==="sms"?"SMS":"WhatsApp")+"."})}
function paVerify(){const c=$("pa-code").value;paRun(async()=>{await ProAPI.verifyCode(PA.phone,c);PA.codeSent=null;PA.app=null;PA.step=0})}
function paEmail(){const e=$("pa-email").value,p=$("pa-pw").value,t=$("pa-pw-tel")?$("pa-pw-tel").value.trim():"";
  paRun(async()=>{if(PA.emailMode==="inscription")await ProAPI.register(e,p,t||null);else await ProAPI.login(e,p);PA.app=null;PA.step=0})}
function paLogout(){paRun(async()=>{await ProAPI.logout();PA.app=null;PA.codeSent=null;PA.phone=""})}

function stepView(i){
  const d=ED.d,miss=paMissing().filter(x=>x.s===i&&i<6);
  let h='<div class="pa-step-h"><p class="eyebrow">'+(ED.mode==="admin"?"Rubrique "+(i+1)+" sur 5":"Étape "+(i+1)+" sur 7")+"</p><h3>"+PA_STEPS[i][1]+"</h3></div>";
  h+=[stepActivity,stepSalon,stepServices,stepTeam,stepHome,stepDocs,stepReview][i](d);
  if(miss.length)h+='<ul class="pa-miss">'+miss.map(x=>"<li>"+esc(x.m)+"</li>").join("")+"</ul>";
  return h+stepFoot(i);
}
function stepActivity(d){
  return'<p class="pa-lead">Votre activité principale détermine votre rubrique sur BeautyMe et les prestations types proposées.</p><div class="pa-acts" role="group" aria-label="Activité principale">'
   +Object.entries(DATA.categories).map(([k,v])=>'<button type="button" class="pa-act" aria-pressed="'+(d.activity===k)+'" onclick="paAct(\''+k+'\')"><span class="pa-act-n">'+esc(v)+'</span><span class="pa-act-c">'+PRO.modeles[k].length+" prestations types</span></button>").join("")+"</div>"
   +(d.activity?'<span class="lbl" style="display:block;margin:26px 0 10px">Activités complémentaires</span><div class="pa-chips">'+Object.entries(DATA.categories).filter(([k])=>k!==d.activity).map(([k,v])=>'<button type="button" class="chip" aria-pressed="'+d.other_activities.includes(k)+'" onclick="paOther(\''+k+'\')">'+esc(v)+"</button>").join("")+'</div><p class="hint">Leurs prestations types s\'ajoutent à l\'étape Prestations.</p>':"");
}
function paAct(k){const d=ED.d;d.activity=k;d.other_activities=d.other_activities.filter(x=>x!==k);paPersist(true)}
function paOther(k){const o=ED.d.other_activities,i=o.indexOf(k);i<0?o.push(k):o.splice(i,1);paPersist(true)}
function stepSalon(d){
  const T=d.territory;
  return'<div class="pa-grid2"><div class="field pa-span2"><label for="pa-name">Nom de l\'établissement</label><input id="pa-name" maxlength="60" value="'+esc(d.name||"")+'" oninput="ED.d.name=this.value;paPersist()"></div>'
   +'<div class="pa-span2"><span class="lbl" style="display:block;margin-bottom:8px">Territoire</span><div class="seg" role="group" aria-label="Territoire">'+Object.entries(DATA.territories).map(([k,v])=>'<button type="button" aria-pressed="'+(T===k)+'" onclick="paTerr(\''+k+'\')">'+v.name+"</button>").join("")+"</div></div>"
   +'<div class="field"><label for="pa-com">Commune</label><select id="pa-com" onchange="ED.d.commune=this.value;paPersist()"'+(T?"":" disabled")+">"+opt("",T?"Choisissez…":"Choisissez d'abord le territoire",d.commune)+(T?PRO.communes[T].map(c=>opt(c,c,d.commune)).join(""):"")+"</select></div>"
   +'<div class="field"><label for="pa-addr">Adresse</label><input id="pa-addr" maxlength="140" autocomplete="street-address" placeholder="Numéro, rue, code postal" value="'+esc(d.address||"")+'" oninput="ED.d.address=this.value;paPersist()"></div>'
   +'<div class="field pa-span2"><label for="pa-about">Présentation</label><textarea id="pa-about" rows="5" maxlength="900" placeholder="Votre spécialité, votre savoir-faire, l\'ambiance, les produits utilisés…" oninput="ED.d.about=this.value;$(\'pa-about-n\').textContent=this.value.length+\' / 900\';paPersist()">'+esc(d.about||"")+'</textarea><span class="hint" id="pa-about-n">'+(d.about||"").length+" / 900</span></div>"
   +'<div class="pa-span2"><span class="lbl" style="display:block;margin-bottom:8px">Gamme de prix</span><div class="seg" role="group" aria-label="Gamme de prix">'+[1,2,3,4].map(n=>'<button type="button" aria-pressed="'+(d.price_level===n)+'" onclick="ED.d.price_level='+n+';paPersist(true)">'+"€".repeat(n)+"</button>").join("")+"</div></div></div>";
}
function paTerr(k){const d=ED.d;if(d.territory!==k){d.territory=k;d.commune=null;d.home_zones={}}paPersist(true)}

function stepServices(d){
  if(!d.activity)return'<p class="pa-lead">Choisissez d\'abord votre activité.</p>';
  const acts=[d.activity,...d.other_activities];
  let h='<p class="pa-lead">Cochez les prestations que vous proposez, puis ajustez prix, durée et temps de pose. Le temps de pose libère le professionnel pour un autre client.</p>';
  for(const a of acts){h+='<div class="pa-tpl-g"><h4>'+esc(DATA.categories[a])+"</h4>";
    for(const t of PRO.modeles[a]){h+=svcRow(d.services.find(x=>x.template===t.id&&x.name===t.name),t,a)}
    h+="</div>"}
  const custom=d.services.filter(s=>!s.template);
  h+='<div class="pa-tpl-g"><h4>Vos prestations personnalisées</h4>'+custom.map(s=>svcRow(s,null,null)).join("")
   +'<div class="pa-new"><div class="field"><label for="pa-ns-name">Nom</label><input id="pa-ns-name" maxlength="80" placeholder="Ex. Coiffure de mariée à domicile"></div>'
   +'<div class="field"><label for="pa-ns-sec">Rubrique</label><input id="pa-ns-sec" maxlength="40" placeholder="Ex. Événements" list="pa-sections"></div>'
   +'<div class="field"><label for="pa-ns-dur">Durée</label><select id="pa-ns-dur">'+durOpts(60)+'</select></div>'
   +'<div class="field"><label for="pa-ns-price">Prix (€)</label><input id="pa-ns-price" inputmode="decimal" placeholder="45"></div>'
   +'<button class="btn" type="button" onclick="paAddCustom()">Ajouter</button></div><datalist id="pa-sections">'+[...new Set(d.services.map(s=>s.section))].map(s=>"<option>"+esc(s)+"</option>").join("")+"</datalist></div>";
  return h;
}
function svcRow(s,t,act){
  const on=!!s,v=s||{...t,price:t.price,home_ok:t.home_ok};
  const key=s?"paSvcSet('"+s.id+"',":"";
  let h='<div class="pa-svc'+(on?" on":"")+'"><label class="pa-svc-pick"><input type="checkbox" '+(on?"checked":"")+' onchange="'+(t?"paTpl('"+act+"','"+t.id+"',this.checked)":"paDelSvc('"+s.id+"')")+'"><span><b>'+esc(v.name)+"</b><small>"+esc(v.section)+(t&&t.description?" · "+esc(t.description):"")+"</small></span></label>";
  if(on){
    const pid=s.id;
    h+='<div class="pa-svc-f"><div class="field"><label for="pp-'+pid+'">Prix (€)</label><input id="pp-'+pid+'" inputmode="decimal" value="'+(s.price==null?"":s.price)+'" oninput="'+key+'\'price\',this.value===\'\'?null:+this.value.replace(\',\',\'.\'),false)"></div>'
     +'<div class="field"><label for="pd-'+pid+'">Durée</label><select id="pd-'+pid+'" onchange="'+key+'\'duration\',+this.value,true)">'+durOpts(s.duration)+"</select></div>"
     +'<div class="field"><label for="pz-'+pid+'">Dont pose</label><select id="pz-'+pid+'" onchange="paPose(\''+pid+'\',+this.value)">'+opt(0,"Aucune",s.pose?s.pose[1]:0)+Array.from({length:Math.max(0,s.duration/15-2)},(_,k)=>(k+1)*15).map(m=>opt(m,dur(m),s.pose?s.pose[1]:0)).join("")+"</select></div>"
     +'<div class="pa-svc-t"><label class="check"><input type="checkbox" '+(s.price_from?"checked":"")+' onchange="'+key+'\'price_from\',this.checked,false)"> Prix « à partir de » / sur devis</label><label class="check"><input type="checkbox" '+(s.home_ok?"checked":"")+' onchange="'+key+'\'home_ok\',this.checked,true)"> Aussi à domicile</label></div></div>';
  }
  return h+"</div>";
}
function uniqueId(base,taken){let id=base||"prestation",n=2;while(taken.includes(id))id=base+"-"+(n++);return id}
function paTpl(act,tid,on){
  const d=ED.d,t=PRO.modeles[act].find(x=>x.id===tid);
  if(on){const id=uniqueId(t.id,d.services.map(s=>s.id));
    d.services.push({id,template:t.id,name:t.name,section:t.section,duration:t.duration,price:t.price,price_from:t.price_from,pose:t.pose?[...t.pose]:null,home_ok:t.home_ok,online:true,description:t.description||""});
    d.staff.forEach(p=>{if(!p.skills.includes(id))p.skills.push(id)});
  }else{const s=d.services.find(x=>x.template===t.id&&x.name===t.name);if(s)paRemoveSvc(s.id)}
  paPersist(true);
}
function paRemoveSvc(id){const d=ED.d;d.services=d.services.filter(s=>s.id!==id);d.staff.forEach(p=>{p.skills=p.skills.filter(x=>x!==id)})}
function paDelSvc(id){paRemoveSvc(id);paPersist(true)}
function paSvcSet(id,k,v,re){const s=ED.d.services.find(x=>x.id===id);s[k]=v;if(k==="duration"&&s.pose&&s.pose[0]+s.pose[1]>=v)s.pose=null;paPersist(re)}
function paPose(id,len){const s=ED.d.services.find(x=>x.id===id);if(!len){s.pose=null}else{const off=Math.max(15,Math.min(s.duration-len-15,Math.floor((s.duration-len)/2/15)*15));s.pose=[off,len]}paPersist(true)}
function paAddCustom(){
  const d=ED.d,name=$("pa-ns-name").value.trim(),sec=$("pa-ns-sec").value.trim()||"Autres prestations",price=$("pa-ns-price").value.trim();
  if(name.length<2){PA.err="Donnez un nom à la prestation (2 caractères minimum).";return renderPartner()}
  if(price&&!(+price.replace(",",".")>=0)){PA.err="Prix invalide : indiquez un nombre, par exemple 45.";return renderPartner()}
  const id=uniqueId(slugify(name).slice(0,40),d.services.map(s=>s.id));
  d.services.push({id,template:null,name,section:sec,duration:+$("pa-ns-dur").value,price:price?+price.replace(",","."):null,price_from:!price,pose:null,home_ok:false,online:true,description:""});
  d.staff.forEach(p=>p.skills.push(id));PA.err="";paPersist(true);
}

function stepTeam(d){
  let h='<p class="pa-lead">Ajoutez chaque personne qui reçoit des clients : ses prestations, ses jours et ses horaires. Les créneaux proposés aux clients en découlent directement.</p>';
  d.staff.forEach((p,i)=>{
    h+='<div class="pa-member"><div class="pa-member-h"><div class="field" style="flex:1;margin:0"><label for="ps-n-'+i+'">Prénom</label><input id="ps-n-'+i+'" maxlength="40" value="'+esc(p.name)+'" oninput="paStaffName('+i+',this.value)"></div><label class="check" style="margin:22px 0 0"><input type="checkbox" '+(p.home?"checked":"")+' onchange="ED.d.staff['+i+'].home=this.checked;paPersist(true)"> Se déplace à domicile</label><button class="btn ghost" type="button" style="margin-top:20px" onclick="paDelStaff('+i+')">Retirer</button></div>';
    h+='<span class="lbl" style="display:block;margin:14px 0 8px">Prestations réalisées</span><div class="pa-chips">'+(d.services.length?d.services.map(s=>'<button type="button" class="chip" aria-pressed="'+p.skills.includes(s.id)+'" onclick="paSkill('+i+',\''+s.id+'\')">'+esc(s.name)+"</button>").join(""):'<p class="note">Ajoutez d\'abord vos prestations.</p>')+"</div>";
    h+='<div class="pa-hours"><span class="lbl">Horaires</span><button type="button" class="pa-link" onclick="paCopyWeek('+i+')">Appliquer le mardi à toute la semaine travaillée</button>';
    for(let w=0;w<7;w++){const ivs=p.hours[w]||[],open=ivs.length>0,start=open?ivs[0][0]:"09:00",end=open?ivs[ivs.length-1][1]:"18:00",pause=ivs.length>1;
      h+='<div class="pa-day'+(open?"":" off")+'"><label class="check"><input type="checkbox" '+(open?"checked":"")+' onchange="paDay('+i+','+w+',this.checked)"> '+WD[w]+"</label>";
      if(open){h+='<select aria-label="'+WD[w]+' début" onchange="paHour('+i+','+w+',\'start\',this.value)">'+timeOpts(start)+'</select><span class="pa-to">à</span><select aria-label="'+WD[w]+' fin" onchange="paHour('+i+','+w+',\'end\',this.value)">'+timeOpts(end)+"</select>"
        +'<label class="check pa-pause"><input type="checkbox" '+(pause?"checked":"")+' onchange="paPause('+i+','+w+',this.checked)"> Pause</label>'
        +(pause?'<select aria-label="'+WD[w]+' début de pause" onchange="paHour('+i+','+w+',\'p1\',this.value)">'+timeOpts(ivs[0][1])+'</select><span class="pa-to">à</span><select aria-label="'+WD[w]+' fin de pause" onchange="paHour('+i+','+w+',\'p2\',this.value)">'+timeOpts(ivs[1][0])+"</select>":"")}
      else h+='<span class="note">Repos</span>';
      h+="</div>"}
    h+="</div></div>";
  });
  return h+'<div class="pa-add"><div class="field" style="flex:1;margin:0"><label for="pa-new-staff">Ajouter un membre</label><input id="pa-new-staff" maxlength="40" placeholder="Prénom"></div><button class="btn" type="button" onclick="paAddStaff()">Ajouter</button></div>';
}
function paAddStaff(){const d=ED.d,el=$("pa-new-staff"),name=(el&&el.value.trim())||(d.staff.length?"":"Moi");
  if(!name){PA.err="Indiquez le prénom du membre à ajouter.";return renderPartner()}
  const hours={};for(let w=1;w<=5;w++)hours[w]=[["09:00","12:30"],["14:00","18:00"]];hours[5]=[["08:30","14:00"]];
  d.staff.push({id:uniqueId(slugify(name)||"membre",d.staff.map(p=>p.id)),name,home:false,skills:d.services.map(s=>s.id),hours});PA.err="";paPersist(true)}
function paDelStaff(i){ED.d.staff.splice(i,1);paPersist(true)}
function paStaffName(i,v){ED.d.staff[i].name=v;paPersist()}
function paSkill(i,id){const sk=ED.d.staff[i].skills,k=sk.indexOf(id);k<0?sk.push(id):sk.splice(k,1);paPersist(true)}
function paDay(i,w,on){const h=ED.d.staff[i].hours;if(on)h[w]=[["09:00","18:00"]];else delete h[w];paPersist(true)}
function paPause(i,w,on){const h=ED.d.staff[i].hours,iv=h[w];if(on){const[a,b]=iv[0],mid=Math.floor((hmToMin(a)+hmToMin(b))/2/15)*15;h[w]=[[a,hm(mid)],[hm(Math.min(mid+60,hmToMin(b)-15)),b]]}else h[w]=[[iv[0][0],iv[iv.length-1][1]]];paPersist(true)}
function paHour(i,w,k,v){const iv=ED.d.staff[i].hours[w];if(k==="start")iv[0][0]=v;if(k==="end")iv[iv.length-1][1]=v;if(k==="p1")iv[0][1]=v;if(k==="p2")iv[1][0]=v;paPersist(true)}
function paCopyWeek(i){const h=ED.d.staff[i].hours,ref=h[1]||Object.values(h)[0];if(!ref)return;for(const w of Object.keys(h))h[w]=JSON.parse(JSON.stringify(ref));paPersist(true);toast("Horaires appliqués à tous les jours travaillés.")}

function stepHome(d){
  const T=d.territory;if(!T)return'<p class="pa-lead">Choisissez d\'abord votre territoire à l\'étape Établissement.</p>';
  const z=d.home_zones,homeSvc=d.services.filter(s=>s.home_ok).length;
  let h='<p class="pa-lead">'+(homeSvc?homeSvc+" prestation"+(homeSvc>1?"s":"")+" proposée"+(homeSvc>1?"s":"")+" à domicile. ":"")+'Sélectionnez les communes où vous vous déplacez et le temps de trajet depuis votre établissement : il est bloqué dans votre agenda, à l\'aller et au retour.</p>';
  h+='<div class="pa-chips pa-communes">'+PRO.communes[T].map(c=>'<button type="button" class="chip" aria-pressed="'+(c in z)+'" onclick="paZone(\''+jsq(c)+'\')">'+esc(c)+"</button>").join("")+"</div>";
  const sel=Object.keys(z);
  if(sel.length)h+='<div class="pa-zones">'+sel.map(c=>'<div class="pa-zone"><span>'+esc(c)+'</span><select aria-label="Trajet vers '+esc(c)+'" onchange="ED.d.home_zones[\''+jsq(c)+'\']=+this.value;paPersist()">'+Array.from({length:24},(_,k)=>(k+1)*5).map(m=>opt(m,m+" min de trajet",z[c])).join("")+"</select></div>").join("")+"</div>";
  h+='<span class="lbl" style="display:block;margin:30px 0 8px">Acompte à la réservation</span><div class="seg" role="group" aria-label="Acompte">'+[0,10,20,30,50].map(p=>'<button type="button" aria-pressed="'+(d.deposit_pct===p)+'" onclick="ED.d.deposit_pct='+p+';paPersist(true)">'+(p?p+" %":"Aucun")+"</button>").join("")+'</div><p class="hint">L\'acompte réduit les rendez-vous non honorés. Il est déduit du prix le jour J ; annulation gratuite jusqu\'à 24 h avant.</p>';
  return h;
}
function paZone(c){const z=ED.d.home_zones;if(c in z)delete z[c];else z[c]=c===ED.d.commune?10:20;paPersist(true)}

function stepDocs(d){
  const doc=d.documents,s=doc.siret||"",ok=siretOk(s);
  return'<p class="pa-lead">Ces documents sont vus uniquement par l\'équipe BeautyMe, pour vérifier votre activité avant la mise en ligne.</p>'
   +'<div class="pa-grid2"><div class="field pa-span2"><label for="pa-siret">Numéro SIRET</label><input id="pa-siret" inputmode="numeric" maxlength="17" placeholder="14 chiffres" value="'+esc(s)+'" oninput="ED.d.documents.siret=this.value;$(\'pa-siret-s\').textContent=siretOk(this.value)?\'Numéro valide\':(this.value.replace(/\\s/g,\'\').length===14?\'Numéro invalide : vérifiez la saisie\':\'\');paPersist()"><span class="hint" id="pa-siret-s">'+(s?ok?"Numéro valide":s.replace(/\s/g,"").length===14?"Numéro invalide : vérifiez la saisie":"":"")+"</span></div>"
   +'<div class="field"><label for="pa-rc">Attestation RC Pro (PDF ou photo)</label><input id="pa-rc" type="file" accept=".pdf,image/*" onchange="if(this.files[0]){ED.d.documents.rc_pro=this.files[0].name;paPersist(true)}">'+(doc.rc_pro?'<span class="hint">Déposé : '+esc(doc.rc_pro)+"</span>":"")+"</div>"
   +'<div class="field"><label for="pa-rc-exp">Valable jusqu\'au</label><input id="pa-rc-exp" type="date" value="'+esc(doc.rc_pro_expiry||"")+'" onchange="ED.d.documents.rc_pro_expiry=this.value||null;paPersist(true)"></div>'
   +'<div class="field pa-span2"><label for="pa-dip">Diplôme ou certification (facultatif)</label><input id="pa-dip" type="file" accept=".pdf,image/*" onchange="if(this.files[0]){ED.d.documents.diplome=this.files[0].name;paPersist(true)}">'+(doc.diplome?'<span class="hint">Déposé : '+esc(doc.diplome)+"</span>":'<span class="hint">CAP, BP, BTS, certification de tresseuse ou de prothésiste ongulaire… Il renforce la confiance des clients.</span>')+"</div></div>"
   +(ProAPI.mode==="demo"?'<p class="note">Démonstration : seul le nom du fichier est conservé, rien n\'est envoyé.</p>':"");
}

function summary(d){
  const svc=d.services,cat=DATA.categories;
  return'<dl class="recap pa-recap"><div><dt>Activité</dt><dd>'+esc(cat[d.activity]||"—")+(d.other_activities.length?" + "+d.other_activities.map(a=>esc(cat[a])).join(", "):"")+"</dd></div>"
   +"<div><dt>Établissement</dt><dd>"+esc(d.name||"—")+"<br>"+esc(d.address||"")+(d.commune?", "+esc(d.commune):"")+"</dd></div>"
   +"<div><dt>Prestations</dt><dd>"+svc.length+(svc.length?" · de "+eur(Math.min(...svc.map(s=>s.price==null?Infinity:s.price*100)))+" à "+eur(Math.max(...svc.map(s=>(s.price||0)*100))):"")+"</dd></div>"
   +"<div><dt>Équipe</dt><dd>"+(d.staff.map(p=>esc(p.name)).join(", ")||"—")+"</dd></div>"
   +"<div><dt>Domicile</dt><dd>"+(Object.keys(d.home_zones).length?Object.keys(d.home_zones).length+" commune(s)":"Non")+"</dd></div>"
   +"<div><dt>Acompte</dt><dd>"+(d.deposit_pct?d.deposit_pct+" %":"Aucun")+"</dd></div>"
   +"<div><dt>SIRET</dt><dd>"+(siretOk(d.documents.siret)?"Valide":"À corriger")+"</dd></div>"
   +"<div><dt>RC Pro</dt><dd>"+(d.documents.rc_pro?"Jusqu'au "+esc(d.documents.rc_pro_expiry||"?"):"Manquante")+"</dd></div></dl>";
}
function stepReview(d){
  const miss=paMissing();
  let h='<p class="pa-lead">Relisez votre fiche. Une fois soumise, elle est vérifiée par l\'équipe BeautyMe puis mise en ligne.</p>'+summary(d);
  if(miss.length){h+='<div class="pa-todo"><p><b>'+miss.length+" point"+(miss.length>1?"s":"")+" à compléter avant l'envoi</b></p><ul>";
    for(const x of miss)h+='<li><span>'+esc(x.m)+'</span><button type="button" class="pa-link" onclick="paGo('+x.s+')">'+PA_STEPS[x.s][1]+"</button></li>";
    h+="</ul></div>"}
  else if(PA.confirmSubmit)h+='<div class="pa-confirm"><p>Votre fiche ne sera plus modifiable pendant la vérification.</p><div class="nav-btns" style="display:flex;gap:10px"><button class="btn ghost" type="button" onclick="PA.confirmSubmit=false;renderPartner()">Relire encore</button><button class="btn" type="button" id="pa-submit-ok" onclick="paSubmit()">Confirmer l\'envoi</button></div></div>';
  else h+='<button class="btn block" type="button" id="pa-submit" onclick="PA.confirmSubmit=true;renderPartner()">Soumettre ma demande</button>';
  return h;
}
function paSubmit(){paRun(async()=>{clearTimeout(paTimer);await ProAPI.saveDraft(ED.d);PA.app=await ProAPI.submit();PA.confirmSubmit=false;toast("Demande envoyée.")})}
function reviewView(){
  const a=PA.app;return'<div class="pa-banner"><strong>Demande envoyée'+(a.submitted_at?" le "+new Intl.DateTimeFormat("fr-FR",{day:"numeric",month:"long",hour:"2-digit",minute:"2-digit"}).format(new Date(a.submitted_at)):"")+'.</strong><p>L\'équipe BeautyMe vérifie votre SIRET et votre assurance. Vous recevez la réponse par WhatsApp ou par e-mail.</p>'
   +(ProAPI.mode==="demo"?'<p class="note">Démonstration : <button type="button" class="pa-link" onclick="AD.tab=\'demandes\';showPage(\'admin\')">ouvrir l\'administration</button> (identifiant ADMIN) pour valider la demande.</p>':"")+"</div>"+summary(a.draft);
}
function liveView(){
  const a=PA.app;return'<div class="pa-banner b-ok"><strong>Votre établissement est en ligne.</strong><p>Les clients peuvent le trouver dans la recherche et réserver vos créneaux dès maintenant.</p><div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px"><button class="btn" type="button" onclick="B=null;showPage(\'salon\',{slug:\''+a.slug+'\'})">Voir ma fiche</button><button class="btn ghost" type="button" onclick="P.salon=\''+a.slug+'\';showPage(\'pro\')">Mon agenda</button></div></div>'+summary(a.draft);
}

/* ── Validation (équipe BeautyMe) ── */
async function renderValidation(){
  const el=$("va-list");if(!el)return;
  let list=[];try{list=await ProAPI.adminList();VA.err=""}catch(e){VA.err=e.message}
  el.innerHTML=(VA.err?'<p class="err">'+esc(VA.err)+"</p>":"")+(list.length?list.map(a=>{const d=a.draft,doc=d.documents,r=VA.refusing===a.id;
    return'<article class="va-item"><div class="va-h"><div><p class="eyebrow">'+esc(DATA.categories[d.activity]||"")+" · "+esc((DATA.territories[d.territory]||{}).name||"")+"</p><h3>"+esc(d.name)+'</h3><p class="note">Envoyée le '+new Intl.DateTimeFormat("fr-FR",{day:"numeric",month:"long",hour:"2-digit",minute:"2-digit"}).format(new Date(a.submitted_at))+"</p></div>"
     +'<div class="va-checks"><span class="tag'+(siretOk(doc.siret)?" ok":"")+'">SIRET '+(siretOk(doc.siret)?"valide":"invalide")+'</span><span class="tag'+(doc.rc_pro_expiry>paToday()?" ok":"")+'">RC Pro jusqu\'au '+esc(doc.rc_pro_expiry||"?")+'</span><span class="tag'+(doc.diplome?" ok":"")+'">'+(doc.diplome?"Diplôme fourni":"Sans diplôme")+"</span></div></div>"
     +summary(d)+'<p class="va-about">'+esc(d.about||"")+"</p>"
     +(r?'<div class="field"><label for="va-r-'+a.id+'">Ce que le prestataire doit corriger</label><textarea id="va-r-'+a.id+'" rows="3" maxlength="500" oninput="VA.reasons[\''+a.id+'\']=this.value">'+esc(VA.reasons[a.id]||"")+'</textarea></div><div class="nav-btns" style="display:flex;gap:10px"><button class="btn ghost" type="button" onclick="VA.refusing=null;renderValidation()">Annuler</button><button class="btn" type="button" onclick="vaReject(\''+a.id+'\')">Envoyer le refus</button></div>'
       :'<div class="nav-btns" style="display:flex;gap:10px"><button class="btn ghost" type="button" onclick="VA.refusing=\''+a.id+'\';renderValidation()">Refuser</button><button class="btn" type="button" onclick="vaApprove(\''+a.id+'\')">Valider et publier</button></div>')+"</article>"}).join("")
    :'<div class="empty"><p>Aucune demande en attente de vérification.</p></div>');
}
async function vaApprove(id){try{const a=await ProAPI.approve(id);toast("Établissement publié.");if(PA.app&&PA.app.id===id)PA.app=a}catch(e){VA.err=e.message}renderValidation();adBadge()}
async function vaReject(id){try{const a=await ProAPI.reject(id,VA.reasons[id]||"");VA.refusing=null;toast("Refus envoyé au prestataire.");if(PA.app&&PA.app.id===id)PA.app=a}catch(e){VA.err=e.message}renderValidation();adBadge()}
