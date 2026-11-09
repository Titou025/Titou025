'use strict';
/* La Pêche : suivi calories/macros ADHD friendly. Données 100% locales (téléphone). */

// ---------- stockage ----------
const S = {
  get(k, d) { try { const v = localStorage.getItem('lp_' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('lp_' + k, JSON.stringify(v)); } catch (e) { toast('Stockage plein : fais une sauvegarde puis supprime de vieilles photos.'); } }
};
const DEF = {
  kcal: 1800, p: 110, f: 60, c: 200,
  compensate: true, maxPct: 10, minKcal: 1400, skipBinge: true,
  meals: { pdj: '08:30', dej: '12:30', gouter: '16:30', diner: '19:30' },
  photoDay: 0, // 0 = dimanche
  showWeight: false, set: false
};
let cfg = Object.assign({}, DEF, S.get('cfg', {}));
cfg.meals = Object.assign({}, DEF.meals, cfg.meals);
let entries = S.get('entries', {});   // { 'YYYY-MM-DD': [entry] }
let foods = S.get('foods', {});       // { key: {name,brand,per100,lastQty,uses,last,serving} }
let binges = S.get('binges', {});     // { date: {triggers:[], note, ts} }
let weights = S.get('weights', []);   // [{date,kg}]
let meta = S.get('meta', {});         // {lastCompare}
const save = () => { S.set('cfg', cfg); S.set('entries', entries); S.set('foods', foods); S.set('binges', binges); S.set('weights', weights); S.set('meta', meta); };

// ---------- photos (IndexedDB) ----------
const DB = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      const r = indexedDB.open('lapeche', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('photos', { keyPath: 'id' });
      r.onsuccess = () => { this.db = r.result; res(this.db); };
      r.onerror = () => rej(r.error);
    });
  },
  async tx(mode, fn) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction('photos', mode); const st = t.objectStore('photos'); const out = fn(st); t.oncomplete = () => res(out && out.result !== undefined ? out.result : out); t.onerror = () => rej(t.error); }); },
  put(p) { return this.tx('readwrite', s => s.put(p)); },
  del(id) { return this.tx('readwrite', s => s.delete(id)); },
  all() { return this.tx('readonly', s => s.getAll()).then(a => (a || []).sort((x, y) => x.date < y.date ? -1 : 1)); }
};

// ---------- dates ----------
const pad = n => String(n).padStart(2, '0');
const dkey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (k, n) => { const d = parse(k); d.setDate(d.getDate() + n); return dkey(d); };
const today = () => dkey(new Date());
const dow = k => (parse(k).getDay() + 6) % 7; // 0 = lundi
const monday = k => addDays(k, -dow(k));
const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
const JOURS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const fmtDate = k => parse(k).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtShort = k => parse(k).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

// ---------- helpers ----------
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r0 = n => Math.round(n || 0);
const r1 = n => Math.round((n || 0) * 10) / 10;
const pick = a => a[Math.floor(Math.random() * a.length)];
const MEALS = { pdj: '☀️ Petit-déj', dej: '🥗 Déjeuner', gouter: '🍎 Goûter', diner: '🌙 Dîner' };
const mealNow = () => { const h = new Date().getHours(); return h < 11 ? 'pdj' : h < 15 ? 'dej' : h < 18 ? 'gouter' : 'diner'; };
const sum = list => list.reduce((a, e) => ({ kcal: a.kcal + e.kcal, p: a.p + e.p, f: a.f + e.f, c: a.c + e.c }), { kcal: 0, p: 0, f: 0, c: 0 });
const dayTotal = k => sum(entries[k] || []);
const logged = k => (entries[k] || []).length > 0;

const MSG = {
  add: ['Noté ! Ton futur toi te remercie 🍑', 'Et hop, dans la boîte ✅', 'Noter, c\'est déjà gagner.', 'Petit geste, gros impact 💪', 'Tu gères. Vraiment.', 'Un repas noté = un pas de plus.', 'Ton cerveau TDAH vient de battre la flemme. Respect.', 'Constance > perfection. Et là t\'es constante.'],
  over: ['Pas grave du tout. Une journée ne fait pas une semaine.', 'Ça arrive à tout le monde. Tu feras mieux dans la semaine, et l\'app t\'aide à lisser.', 'Aucune culpabilité ici. Le plus important : tu as noté. C\'est ça qui compte.', 'Une journée au-dessus, ce n\'est pas un échec, c\'est une donnée. On continue.'],
  first: ['Premier repas noté aujourd\'hui. La journée est lancée 🚀', 'Go ! Journée démarrée.'],
  binge: ['Merci de l\'avoir noté. Ça demande du courage, et c\'est exactement ce qui aide à comprendre et à avancer.', 'Une crise ne définit pas ta semaine ni toi. Tu es là, tu notes, tu continues.', 'Respire. Pas de punition, pas de rattrapage brutal. Prochain repas : normal, comme prévu.']
};

// ---------- objectifs + compensation ----------
function target(k) {
  const base = { kcal: cfg.kcal, p: cfg.p, f: cfg.f, c: cfg.c };
  let reduce = 0, net = 0;
  if (cfg.compensate) {
    for (let d = monday(k); d < k; d = addDays(d, 1)) {
      if (!logged(d)) continue;
      if (cfg.skipBinge && binges[d]) continue;
      net += dayTotal(d).kcal - base.kcal;
    }
    if (net > 0) {
      const left = 7 - dow(k);
      reduce = Math.min(net / left, base.kcal * cfg.maxPct / 100, Math.max(0, base.kcal - cfg.minKcal));
      reduce = Math.round(reduce / 10) * 10;
    }
  }
  const pk = base.p * 4, rest = base.kcal - pk;
  const fac = rest > 0 ? Math.max(0, (rest - reduce) / rest) : 1;
  return { kcal: base.kcal - reduce, p: base.p, f: r0(base.f * fac), c: r0(base.c * fac), reduce, net: r0(net) };
}

// ---------- UI global ----------
let tab = 'today';
document.querySelectorAll('#nav button').forEach(b => b.onclick = () => { tab = b.dataset.tab; document.querySelectorAll('#nav button').forEach(x => x.classList.toggle('on', x === b)); render(); scrollTo(0, 0); });
$('#fab').onclick = () => openAdd();
$('#sheet').onclick = e => { if (e.target.id === 'sheet') closeSheet(); };

function toast(t, ms = 2600) { const el = $('#toast'); el.textContent = t; el.classList.remove('hidden'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.add('hidden'), ms); }
function openSheet(html) { $('#sheetIn').innerHTML = html; $('#sheet').classList.remove('hidden'); document.body.style.overflow = 'hidden'; }
function closeSheet() { if (typeof stopScan === 'function') stopScan(); $('#sheet').classList.add('hidden'); document.body.style.overflow = ''; }

function render() {
  $('#fab').classList.toggle('hidden', tab !== 'today' && tab !== 'week');
  ({ today: renderToday, week: renderWeek, body: renderBody, settings: renderSettings })[tab]();
}

function barHTML(val, max, color) {
  const pct = max > 0 ? Math.min(100, val / max * 100) : 0;
  return `<div class="bar s ${val > max ? 'over' : ''}"><i style="width:${pct}%;${color && val <= max ? 'background:' + color : ''}"></i></div>`;
}

// ---------- AUJOURD'HUI ----------
let viewDay = today();
function renderToday() {
  const k = viewDay, isToday = k === today();
  const t = target(k), tot = dayTotal(k), list = entries[k] || [];
  const weekLogged = [...Array(7)].filter((_, i) => logged(addDays(monday(k), i))).length;
  $('#sub').innerHTML = `${isToday ? 'Aujourd\'hui, ' : ''}${fmtDate(k)}`;
  const over = tot.kcal > t.kcal;
  const left = t.kcal - tot.kcal;
  let h = '';
  h += `<div class="row between" style="margin-top:6px"><button class="btn3" style="font-size:22px" onclick="shiftDay(-1)" aria-label="Jour précédent">‹</button>
    <small>${weekLogged}/7 jours notés cette semaine</small>
    <button class="btn3" style="font-size:22px;${isToday ? 'opacity:.3' : ''}" onclick="shiftDay(1)" aria-label="Jour suivant">›</button></div>`;
  h += `<div class="card">
    <div class="row between"><div><div class="big">${over ? r0(tot.kcal) : r0(left)}</div>
    <div class="mute">${over ? 'kcal mangées' : 'kcal restantes'} · objectif ${t.kcal}</div></div>
    <div style="font-size:42px">${over ? '🫶' : tot.kcal === 0 ? '🍽️' : left < t.kcal * 0.25 ? '🎯' : '🍑'}</div></div>
    <div class="bar ${over ? 'over' : ''}"><i style="width:${Math.min(100, tot.kcal / t.kcal * 100)}%"></i></div>
    ${macroHTML('Protéines', tot.p, t.p, 'var(--p)')}${macroHTML('Glucides', tot.c, t.c, 'var(--c)')}${macroHTML('Lipides', tot.f, t.f, 'var(--f)')}
  </div>`;
  if (over) h += `<div class="msg warm">🫶 <b>${pick(MSG.over)}</b><br><small>${dow(k) === 6 ? 'Demain une nouvelle semaine commence, compteur à zéro.' : cfg.compensate && !(cfg.skipBinge && binges[k]) ? `L'écart sera lissé en douceur sur les jours restants (max -${cfg.maxPct}%/jour, jamais sous ${cfg.minKcal} kcal).` : 'Pas de rattrapage prévu pour ce jour. C\'est voulu.'}</small></div>`;
  if (t.reduce > 0) h += `<div class="msg">🔧 Objectif ajusté de <b>-${t.reduce} kcal</b> aujourd'hui pour lisser la semaine. Protéines inchangées.</div>`;
  if (isToday) h += todosHTML();
  if (binges[k]) h += `<div class="msg">💜 Crise notée ce jour. ${cfg.skipBinge ? 'Pas de rattrapage calorique dessus, c\'est voulu.' : ''}</div>`;

  for (const m of Object.keys(MEALS)) {
    const ml = list.map((e, i) => ({ e, i })).filter(x => x.e.meal === m);
    const st = sum(ml.map(x => x.e));
    const yest = (entries[addDays(k, -1)] || []).filter(e => e.meal === m);
    h += `<div class="card"><div class="row between"><b>${MEALS[m]}</b><small>${ml.length ? r0(st.kcal) + ' kcal' : ''}</small></div>`;
    h += ml.map(({ e, i }) => `<div class="item"><div><div class="n">${esc(e.name)}${e.brand ? ` <span class="tag">${esc(e.brand)}</span>` : ''}</div>
      <small>${e.qty ? e.qty + ' g · ' : ''}${r0(e.kcal)} kcal · P${r0(e.p)} G${r0(e.c)} L${r0(e.f)}</small></div>
      <button class="del" onclick="delEntry('${k}',${i})" aria-label="Supprimer">✕</button></div>`).join('');
    h += `<div class="row wrap" style="margin-top:8px"><button class="chip" onclick="openAdd('${m}')">＋ Ajouter</button>
      ${!ml.length && yest.length ? `<button class="chip" onclick="copyMeal('${k}','${m}')">↺ Comme hier (${r0(sum(yest).kcal)} kcal)</button>` : ''}</div></div>`;
  }
  h += `<div class="card"><button class="btn2 full" onclick="openBinge()">💜 J'ai fait une crise</button>
    <small style="display:block;margin-top:8px;text-align:center">Zéro jugement. Ça aide à repérer ce qui la déclenche.</small></div>`;
  $('#view').innerHTML = h;
}
function macroHTML(n, v, max, col) {
  return `<div class="macro"><div class="lbl"><span>${n}</span><span><b>${r0(v)}</b> / ${max} g</span></div>${barHTML(v, max, col)}</div>`;
}
window.shiftDay = n => { const nk = addDays(viewDay, n); if (nk <= today()) { viewDay = nk; render(); } };
window.delEntry = (k, i) => { entries[k].splice(i, 1); if (!entries[k].length) delete entries[k]; save(); render(); };
window.copyMeal = (k, m) => {
  const y = (entries[addDays(k, -1)] || []).filter(e => e.meal === m).map(e => ({ ...e, ts: Date.now() }));
  entries[k] = (entries[k] || []).concat(y); save(); render(); toast('Copié depuis hier ✅'); confetti(40);
};

function todosHTML() {
  const out = [], now = new Date(), hm = pad(now.getHours()) + ':' + pad(now.getMinutes());
  const list = entries[today()] || [];
  for (const [m, t] of Object.entries(cfg.meals)) {
    if (!t) continue;
    const [hh, mm] = t.split(':').map(Number), due = new Date(); due.setHours(hh, mm + 45, 0, 0);
    const next = Object.keys(MEALS)[Object.keys(MEALS).indexOf(m) + 1];
    const nextT = next && cfg.meals[next];
    const sk = cfg._skipped && cfg._skipped.d === today() ? cfg._skipped.m : [];
    if (now > due && !list.some(e => e.meal === m) && !sk.includes(m) && (!nextT || hm < nextT)) {
      out.push(`<div class="card todo"><b>⏰ Tu as noté ton ${MEALS[m].slice(3).toLowerCase()} ?</b><div class="row" style="margin-top:8px">
        <button onclick="openAdd('${m}')">Je note</button><button class="btn2" onclick="skipMeal('${m}')">Pas mangé</button></div></div>`);
    }
  }
  return out.join('') + bodyTodos();
}
window.skipMeal = m => { if (!cfg._skipped || cfg._skipped.d !== today()) cfg._skipped = { d: today(), m: [] }; cfg._skipped.m.push(m); save(); toast('OK, noté. Pense à manger un peu plus tard si tu as faim.'); render(); };

let photoCache = null;
async function loadPhotos() { photoCache = await DB.all().catch(() => []); return photoCache; }
function bodyTodos() {
  let h = '';
  const ph = photoCache || [];
  const lastP = ph.length ? ph[ph.length - 1].date : null;
  if (!lastP || daysBetween(lastP, today()) >= 7) h += `<div class="card todo row between"><div><b>📸 Photo de la semaine</b><div class="mute">30 secondes, même lumière.</div></div><button onclick="goBody()">Go</button></div>`;
  const lastW = weights.length ? weights[weights.length - 1].date : null;
  if (!lastW || daysBetween(lastW, today()) >= 30) h += `<div class="card todo row between"><div><b>⚖️ Pesée du mois</b><div class="mute">Le matin, à jeun.</div></div><button onclick="goBody()">Go</button></div>`;
  if (compareDue()) h += `<div class="card todo row between"><b>🔍 Bilan photo du mois</b><button onclick="goBody(true)">Voir</button></div>`;
  return h;
}
window.goBody = cmp => { tab = 'body'; document.querySelectorAll('#nav button').forEach(x => x.classList.toggle('on', x.dataset.tab === 'body')); render(); if (cmp) setTimeout(openCompare, 300); };
function compareDue() {
  const ph = photoCache || []; if (ph.length < 2) return false;
  if (daysBetween(ph[0].date, ph[ph.length - 1].date) < 21) return false;
  return !meta.lastCompare || daysBetween(meta.lastCompare, today()) >= 28;
}

// ---------- AJOUT ----------
let A = {};
window.openAdd = (meal) => { stopScan(); A = { meal: meal || mealNow(), day: tab === 'today' ? viewDay : today() }; addSearch(''); };
function recentFoods(q) {
  q = (q || '').toLowerCase();
  return Object.entries(foods).filter(([, f]) => !q || (f.name + ' ' + (f.brand || '')).toLowerCase().includes(q))
    .sort((a, b) => (b[1].last || 0) - (a[1].last || 0)).slice(0, q ? 20 : 10);
}
function addSearch(q) {
  const rec = recentFoods(q), R = A.recipe;
  openSheet(`<div class="row between"><h2 style="margin:0">${R ? '🍲 Ajouter un ingrédient' : 'Qu\'as-tu mangé ?'}</h2><button class="btn3" onclick="${R ? 'recipeEdit()' : 'closeSheet()'}">${R ? '‹ Plat' : 'Fermer'}</button></div>
    ${R ? '' : `<div class="chips">${Object.entries(MEALS).map(([k, v]) => `<button class="chip ${A.meal === k ? 'on' : ''}" onclick="A.meal='${k}';addSearch($('#q').value)">${v}</button>`).join('')}</div>`}
    <div class="grid2" style="grid-template-columns:1fr ${R ? '' : '1fr'}"><button onclick="openScan()">📷 Scanner</button>${R ? '' : '<button class="btn2" onclick="openRecipes()">🍲 Plats maison</button>'}</div>
    <input id="q" style="margin-top:8px" placeholder="Ex : skyr Siggi's, pâtes Barilla" value="${esc(q)}" autocomplete="off" enterkeyhint="search">
    <button class="full" style="margin-top:8px" onclick="offGo()">🔎 Chercher la marque sur internet</button>
    <div class="row" style="margin-top:8px"><button class="btn2" style="flex:1" onclick="manualFood()">✍️ À la main</button>${R ? '' : '<button class="btn2" style="flex:1" onclick="quickKcal()">⚡ Juste les kcal</button>'}</div>
    <div id="res"></div>
    <h2>${q ? 'Dans mes aliments' : 'Récents (1 tap)'}</h2>
    <div>${rec.length ? rec.map(([key, f]) => `<div class="res" onclick="pickFood('${encodeURIComponent(key)}')"><b>${f.recipe ? '🍲 ' : ''}${esc(f.name)}</b>${f.brand ? ` <span class="tag">${esc(f.brand)}</span>` : ''}<br><small>${f.recipe && f.serving ? `${r0(f.per100.kcal * f.serving / 100)} kcal/portion` : `${r0(f.per100.kcal)} kcal/100g`} · dernière fois ${f.lastQty} g</small></div>`).join('') : '<small>Rien encore. Cherche un produit ou ajoute-le à la main, il apparaîtra ici ensuite.</small>'}</div>`);
  const qi = $('#q');
  qi.oninput = () => { clearTimeout(window._qt); window._qt = setTimeout(() => { const v = qi.value; addSearch(v); const n = $('#q'); n.focus(); n.setSelectionRange(v.length, v.length); }, 350); };
  qi.onkeydown = e => { if (e.key === 'Enter') offGo(); };
}
window.pickFood = key => { key = decodeURIComponent(key); const f = foods[key]; A.food = { name: f.name, brand: f.brand, per100: f.per100, serving: f.serving, code: f.code, key: f.recipe ? key : null }; addQty(f.lastQty || f.serving || 100); };

// Open Food Facts (base collaborative ouverte, gratuite)
function offParse(p) {
  const n = p.nutriments || {};
  let kcal = n['energy-kcal_100g'];
  if (kcal == null && n.energy_100g != null) kcal = n.energy_100g / 4.184;
  if (kcal == null) return null;
  return {
    name: p.product_name_fr || p.product_name || 'Produit sans nom', brand: (p.brands || '').split(',')[0].trim(),
    per100: { kcal: +kcal, p: +(n.proteins_100g || 0), f: +(n.fat_100g || 0), c: +(n.carbohydrates_100g || 0) },
    serving: p.serving_quantity ? +p.serving_quantity : null, qtyLabel: p.quantity || '', code: p.code || ''
  };
}
let offResults = [];
window.offGo = async () => {
  clearTimeout(window._qt);
  const q = $('#q').value.trim(); if (!q) { toast('Tape un nom de produit + la marque'); return; }
  const known = Object.entries(foods).find(([, f]) => f.code && f.code === q);
  if (known) { pickFood(encodeURIComponent(known[0])); return; }
  const res = $('#res'); res.innerHTML = '<p class="mute">Recherche en cours…</p>';
  const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 15000);
  const F = 'code,product_name,product_name_fr,brands,nutriments,quantity,serving_quantity';
  try {
    let prods = [];
    if (/^\d{8,14}$/.test(q)) {
      const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${q}.json?fields=${F}`, { signal: ctl.signal }).then(r => r.json());
      if (r.product) prods = [r.product];
    } else {
      const r = await fetch(`https://fr.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=20&fields=${F}`, { signal: ctl.signal }).then(r => r.json());
      prods = r.products || [];
    }
    offResults = prods.map(offParse).filter(Boolean);
    res.innerHTML = `<h2>Résultats internet</h2>` + (offResults.length ? offResults.map((f, i) => `<div class="res" onclick="pickOff(${i})"><b>${esc(f.name)}</b>${f.brand ? ` <span class="tag">${esc(f.brand)}</span>` : ''} <small>${esc(f.qtyLabel)}</small><br><small>${r0(f.per100.kcal)} kcal · P${r1(f.per100.p)} G${r1(f.per100.c)} L${r1(f.per100.f)} /100g</small></div>`).join('')
      : '<p class="mute">Rien trouvé. Essaie moins de mots (ex : « skyr siggi »), le code-barres, ou ajoute à la main avec l\'étiquette.</p>');
  } catch (e) {
    res.innerHTML = '<p class="mute">Pas de réponse (réseau ou serveur lent). Réessaie dans un instant, ou ajoute à la main.</p>';
  } finally { clearTimeout(to); }
};
window.pickOff = i => { A.food = offResults[i]; addQty(A.food.serving || 100); };

function addQty(qty) {
  const f = A.food;
  const chips = [50, 100, 150, 200, 250].concat(f.serving ? [] : []);
  openSheet(`<div class="row between"><h2 style="margin:0">${esc(f.name)}</h2><button class="btn3" onclick="addSearch('')">‹ Retour</button></div>
    ${f.brand ? `<span class="tag">${esc(f.brand)}</span>` : ''}
    ${f.key ? `<button class="btn3" onclick="recipeEdit('${encodeURIComponent(f.key)}')">✏️ Modifier la recette</button>` : ''}
    <p class="mute">Pour 100 g : ${r0(f.per100.kcal)} kcal · P${r1(f.per100.p)} G${r1(f.per100.c)} L${r1(f.per100.f)}</p>
    <label>Quantité (g ou ml)</label><input id="qty" type="number" inputmode="decimal" value="${qty}">
    <div class="chips">${f.serving ? `<button class="chip" onclick="setQ(${f.serving})">1 portion (${f.serving} g)</button>` : ''}${chips.map(c => `<button class="chip" onclick="setQ(${c})">${c} g</button>`).join('')}</div>
    <div class="card" id="calc"></div>
    <div class="chips ${A.recipe ? 'hidden' : ''}">${Object.entries(MEALS).map(([k, v]) => `<button class="chip ${A.meal === k ? 'on' : ''}" onclick="A.meal='${k}';this.parentNode.querySelectorAll('.chip').forEach(c=>c.classList.remove('on'));this.classList.add('on')">${v}</button>`).join('')}</div>
    <button class="full" style="font-size:18px;padding:16px" onclick="confirmAdd()">✅ ${A.recipe ? 'Ajouter au plat' : 'Ajouter'}</button>`);
  const upd = () => { const q = +$('#qty').value || 0, x = q / 100; $('#calc').innerHTML = `<div class="big">${r0(f.per100.kcal * x)} <small>kcal</small></div><div class="mute">Protéines ${r1(f.per100.p * x)} g · Glucides ${r1(f.per100.c * x)} g · Lipides ${r1(f.per100.f * x)} g</div>`; };
  $('#qty').oninput = upd; upd();
  window.setQ = v => { $('#qty').value = v; upd(); };
}
window.confirmAdd = () => {
  const f = A.food, q = +$('#qty').value || 0; if (!q) { toast('Mets une quantité'); return; }
  const x = q / 100;
  const key = f.key || (f.name + '|' + (f.brand || '')).toLowerCase(), old = foods[key] || {};
  foods[key] = { ...old, name: f.name, brand: f.brand || '', per100: f.per100, serving: f.serving || old.serving || null, code: f.code || old.code || '', lastQty: A.recipe ? (old.lastQty || q) : q, uses: (old.uses || 0) + 1, last: Date.now() };
  save();
  if (A.recipe) { A.recipe.items.push({ name: f.name, brand: f.brand || '', qty: q, per100: f.per100 }); recipeEdit(); return; }
  pushEntry({ name: f.name, brand: f.brand || '', qty: q, meal: A.meal, kcal: f.per100.kcal * x, p: f.per100.p * x, f: f.per100.f * x, c: f.per100.c * x });
};

// ---------- PLATS MAISON ----------
window.openRecipes = () => {
  const list = Object.entries(foods).filter(([, f]) => f.recipe).sort((a, b) => (b[1].last || 0) - (a[1].last || 0));
  openSheet(`<div class="row between"><h2 style="margin:0">🍲 Plats maison</h2><button class="btn3" onclick="addSearch('')">‹ Retour</button></div>
    <p class="mute">Tu crées la recette une fois, ensuite c'est 1 tap.</p>
    <button class="full" onclick="recipeEdit()">＋ Nouveau plat</button>
    <div style="margin-top:10px">${list.length ? list.map(([k, f]) => `<div class="res" onclick="pickFood('${encodeURIComponent(k)}')"><b>${esc(f.name)}</b><br><small>${f.serving ? r0(f.per100.kcal * f.serving / 100) + ' kcal/portion · ' : ''}${f.recipe.items.length} ingrédients</small></div>`).join('') : '<small>Aucun plat pour l\'instant.</small>'}</div>`);
};
window.recipeEdit = key => {
  if (key !== undefined) {
    key = decodeURIComponent(key); const f = foods[key];
    A.recipe = { key, name: f.name, items: f.recipe.items.slice(), cooked: f.recipe.cooked || '', portions: f.recipe.portions || 1 };
  } else if (!A.recipe) A.recipe = { key: null, name: '', items: [], cooked: '', portions: 2 };
  const R = A.recipe, t = sum(R.items.map(i => ({ kcal: i.per100.kcal * i.qty / 100, p: i.per100.p * i.qty / 100, f: i.per100.f * i.qty / 100, c: i.per100.c * i.qty / 100 })));
  const raw = R.items.reduce((a, i) => a + i.qty, 0), por = Math.max(1, +R.portions || 1);
  openSheet(`<div class="row between"><h2 style="margin:0">🍲 ${R.key ? 'Modifier le plat' : 'Nouveau plat'}</h2><button class="btn3" onclick="A.recipe=null;openRecipes()">Annuler</button></div>
    <label>Nom du plat</label><input id="rn" value="${esc(R.name)}" placeholder="Ex : Bolo de Tanit" oninput="A.recipe.name=this.value">
    <h2>Ingrédients</h2>
    ${R.items.map((i, n) => `<div class="item"><div><div class="n">${esc(i.name)}${i.brand ? ` <span class="tag">${esc(i.brand)}</span>` : ''}</div><small>${i.qty} g · ${r0(i.per100.kcal * i.qty / 100)} kcal</small></div><button class="del" onclick="A.recipe.items.splice(${n},1);recipeEdit()">✕</button></div>`).join('') || '<small>Ajoute les ingrédients avec leur poids <b>cru</b>.</small>'}
    <button class="btn2 full" style="margin-top:10px" onclick="addSearch('')">＋ Ingrédient</button>
    <div class="grid2"><div><label>Nombre de portions</label><input type="number" inputmode="numeric" value="${R.portions}" oninput="A.recipe.portions=this.value"></div>
    <div><label>Poids cuit total (g, optionnel)</label><input type="number" inputmode="numeric" value="${R.cooked}" placeholder="${r0(raw)}" oninput="A.recipe.cooked=this.value"></div></div>
    <small>Le poids cuit sert si tu te sers « au poids » dans la casserole. Sinon, les portions suffisent.</small>
    ${R.items.length ? `<div class="card"><b>${r0(t.kcal)} kcal au total</b><div class="mute">1 portion ≈ ${r0(t.kcal / por)} kcal · P${r0(t.p / por)} G${r0(t.c / por)} L${r0(t.f / por)}</div></div>` : ''}
    <button class="full" style="margin-top:8px;padding:16px" onclick="recipeSave()">💾 Enregistrer le plat</button>
    ${R.key ? '<button class="btn3 full" onclick="recipeDel()">Supprimer ce plat</button>' : ''}`);
};
window.recipeSave = () => {
  const R = A.recipe; if (!R.name.trim()) { toast('Donne un nom au plat'); return; }
  if (!R.items.length) { toast('Ajoute au moins un ingrédient'); return; }
  const t = R.items.reduce((a, i) => { for (const m of ['kcal', 'p', 'f', 'c']) a[m] += i.per100[m] * i.qty / 100; return a; }, { kcal: 0, p: 0, f: 0, c: 0 });
  const weight = +R.cooked || R.items.reduce((a, i) => a + i.qty, 0), por = Math.max(1, +R.portions || 1);
  const per100 = { kcal: t.kcal * 100 / weight, p: t.p * 100 / weight, f: t.f * 100 / weight, c: t.c * 100 / weight };
  const key = 'plat|' + R.name.trim().toLowerCase(), old = (R.key && foods[R.key]) || foods[key] || {};
  if (R.key && R.key !== key) delete foods[R.key];
  const serving = r0(weight / por);
  foods[key] = { ...old, name: R.name.trim(), brand: 'Maison', per100, serving, lastQty: serving, uses: old.uses || 0, last: Date.now(), recipe: { items: R.items, cooked: R.cooked, portions: por } };
  A.recipe = null; save(); toast('Plat enregistré 🍲'); confetti(60);
  A.food = { name: foods[key].name, brand: 'Maison', per100, serving, key }; addQty(serving);
};
window.recipeDel = () => { if (!confirm('Supprimer ce plat ?')) return; delete foods[A.recipe.key]; A.recipe = null; save(); openRecipes(); };

// ---------- SCANNER CODE-BARRES ----------
let scanner = null;
function loadScanLib() {
  if (window.Html5Qrcode) return Promise.resolve();
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'lib/html5-qrcode.min.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
}
async function stopScan() { if (scanner) { try { await scanner.stop(); } catch { } try { scanner.clear(); } catch { } scanner = null; } }
function scanned(code) {
  if (navigator.vibrate) navigator.vibrate(80);
  stopScan(); addSearch(code); offGo();
}
window.openScan = async () => {
  openSheet(`<div class="row between"><h2 style="margin:0">📷 Scanner</h2><button class="btn3" onclick="stopScan();addSearch('')">‹ Retour</button></div>
    <p class="mute">Vise le code-barres du produit (les traits noirs).</p>
    <div id="reader" style="width:100%;border-radius:16px;overflow:hidden;background:#000;min-height:220px"></div>
    <label class="btn btn2 full" style="text-align:center;margin-top:10px">🖼️ La caméra ne marche pas ? Prends le code en photo<input id="scf" type="file" accept="image/*" hidden></label>`);
  try { await loadScanLib(); } catch { toast('Scanner indisponible hors ligne'); return; }
  const F = Html5QrcodeSupportedFormats, formats = [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E];
  $('#scf').onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    await stopScan();
    try { const r = await new Html5Qrcode('reader', { formatsToSupport: formats, verbose: false }).scanFile(file, false); scanned(r); }
    catch { toast('Code non lu. Rapproche-toi, bonne lumière, code bien à plat.'); }
  };
  try {
    scanner = new Html5Qrcode('reader', { formatsToSupport: formats, verbose: false });
    await scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: (w, h) => ({ width: Math.min(300, w * 0.85), height: Math.min(160, h * 0.5) }) }, scanned, () => { });
  } catch { scanner = null; toast('Caméra refusée ou indisponible. Utilise la photo juste en dessous.'); }
};
window.stopScan = stopScan;
function pushEntry(e) {
  const k = A.day || today();
  const first = !logged(k);
  (entries[k] = entries[k] || []).push({ ...e, ts: Date.now() });
  save(); closeSheet(); viewDay = k; tab = 'today';
  document.querySelectorAll('#nav button').forEach(x => x.classList.toggle('on', x.dataset.tab === 'today'));
  render(); confetti(first ? 120 : 50); toast(first ? pick(MSG.first) : pick(MSG.add));
}
window.manualFood = () => {
  openSheet(`<div class="row between"><h2 style="margin:0">Aliment à la main</h2><button class="btn3" onclick="addSearch('')">‹ Retour</button></div>
    <p class="mute">Recopie l'étiquette (valeurs pour 100 g). Il sera gardé dans tes aliments.</p>
    <label>Nom</label><input id="mn" placeholder="Ex : Skyr nature">
    <label>Marque (optionnel)</label><input id="mb">
    <div class="grid2"><div><label>kcal /100g</label><input id="mk" type="number" inputmode="decimal"></div><div><label>Protéines /100g</label><input id="mp" type="number" inputmode="decimal"></div>
    <div><label>Glucides /100g</label><input id="mc" type="number" inputmode="decimal"></div><div><label>Lipides /100g</label><input id="mf" type="number" inputmode="decimal"></div></div>
    <button class="full" style="margin-top:14px" onclick="manualNext()">Suivant</button>`);
};
window.manualNext = () => {
  const n = $('#mn').value.trim(), k = +$('#mk').value;
  if (!n || !k) { toast('Il faut au moins le nom et les kcal'); return; }
  A.food = { name: n, brand: $('#mb').value.trim(), per100: { kcal: k, p: +$('#mp').value || 0, c: +$('#mc').value || 0, f: +$('#mf').value || 0 } };
  addQty(100);
};
window.quickKcal = () => {
  openSheet(`<div class="row between"><h2 style="margin:0">⚡ Ajout rapide</h2><button class="btn3" onclick="addSearch('')">‹ Retour</button></div>
    <p class="mute">Pas le temps ou pas l'info ? Une estimation, c'est mieux que rien.</p>
    <label>C'était quoi ? (optionnel)</label><input id="qn" placeholder="Ex : resto italien">
    <label>kcal (total)</label><input id="qk" type="number" inputmode="decimal">
    <div class="grid2" style="grid-template-columns:1fr 1fr 1fr"><div><label>Prot. g</label><input id="qp" type="number" inputmode="decimal"></div><div><label>Gluc. g</label><input id="qc" type="number" inputmode="decimal"></div><div><label>Lip. g</label><input id="qf" type="number" inputmode="decimal"></div></div>
    <button class="full" style="margin-top:14px" onclick="quickSave()">✅ Ajouter</button>`);
};
window.quickSave = () => {
  const k = +$('#qk').value; if (!k) { toast('Mets au moins les kcal'); return; }
  pushEntry({ name: $('#qn').value.trim() || 'Ajout rapide', brand: '', qty: 0, meal: A.meal, kcal: k, p: +$('#qp').value || 0, c: +$('#qc').value || 0, f: +$('#qf').value || 0 });
};

// ---------- CRISE ----------
const TRIG = ['Faim (repas sauté / trop peu mangé)', 'Émotion difficile', 'Stress', 'Ennui', 'Fatigue', 'Règle alimentaire « cassée »', 'Seule / isolée', 'Je ne sais pas'];
window.openBinge = () => {
  const k = viewDay, b = binges[k] || { triggers: [], note: '' };
  openSheet(`<div class="row between"><h2 style="margin:0">💜 Crise</h2><button class="btn3" onclick="closeSheet()">Fermer</button></div>
    <div class="msg">${pick(MSG.binge)}</div>
    <label>Qu'est-ce qui a pu la déclencher ? (optionnel, plusieurs choix)</label>
    <div class="chips" id="trg">${TRIG.map(t => `<button class="chip ${b.triggers.includes(t) ? 'on' : ''}" onclick="this.classList.toggle('on')">${esc(t)}</button>`).join('')}</div>
    <label>Une note pour toi (optionnel)</label><textarea id="bn" rows="3">${esc(b.note)}</textarea>
    <p class="mute">Si tu veux, ajoute ce que tu as mangé avec « ⚡ Juste les kcal » (une estimation suffit). Tu peux aussi ne rien noter. Les deux sont OK.</p>
    <button class="full" onclick="saveBinge()">Enregistrer</button>
    ${binges[k] ? '<button class="btn3 full" onclick="delBinge()">Retirer la crise de ce jour</button>' : ''}
    <div class="msg warm" style="margin-top:14px"><b>Pour la suite :</b> mange ton prochain repas normalement, sans le sauter. Sauter des repas après une crise entretient souvent le cycle. Si les crises sont fréquentes, un·e pro (médecin, psy, diététicien·ne spécialisé·e TCA) peut vraiment aider.</div>`);
};
window.saveBinge = () => {
  binges[viewDay] = { triggers: [...document.querySelectorAll('#trg .chip.on')].map(c => c.textContent), note: $('#bn').value, ts: Date.now() };
  save(); closeSheet(); render(); toast('Noté. Tu as bien fait 💜');
};
window.delBinge = () => { delete binges[viewDay]; save(); closeSheet(); render(); };

// ---------- SEMAINE ----------
function renderWeek() {
  const m = monday(today());
  $('#sub').textContent = `Semaine du ${fmtShort(m)}`;
  let tot = 0, budget = 0, nLog = 0, mac = { p: 0, c: 0, f: 0 };
  const days = [...Array(7)].map((_, i) => { const k = addDays(m, i), t = dayTotal(k); return { k, t, tg: target(k) }; });
  const maxV = Math.max(cfg.kcal * 1.3, ...days.map(d => d.t.kcal));
  days.forEach(d => { if (logged(d.k)) { tot += d.t.kcal; budget += cfg.kcal; nLog++; mac.p += d.t.p; mac.c += d.t.c; mac.f += d.t.f; } });
  const avg = nLog ? r0(tot / nLog) : 0;
  let h = `<div class="card"><b>Jours notés</b><div class="dots">${days.map((d, i) => `<b class="${logged(d.k) ? 'ok' : ''}">${logged(d.k) ? '✓' : JOURS[i][0]}</b>`).join('')}</div>
    <div class="mute" style="text-align:center">${nLog === 7 ? 'Semaine parfaite côté suivi 🏆' : nLog >= 5 ? 'Super régularité 🔥' : nLog >= 3 ? 'Bonne base, continue 💪' : 'Chaque jour noté compte. On y va un jour à la fois.'}</div></div>`;
  h += `<div class="card"><b>Calories par jour</b><div class="week">${days.map((d, i) => `<div><small>${d.t.kcal ? r0(d.t.kcal) : ''}</small><i class="${d.k === today() ? 'today' : d.t.kcal > d.tg.kcal ? 'over' : ''}" style="height:${d.t.kcal / maxV * 100}%"></i>${JOURS[i]}${binges[d.k] ? '💜' : ''}</div>`).join('')}</div>
    <small>Violet = au-dessus de l'objectif du jour. Pas un échec, juste une info.</small></div>`;
  const diff = r0(tot - budget);
  h += `<div class="card"><b>Bilan des jours notés</b>
    <p>Moyenne : <b>${avg} kcal/jour</b> (objectif ${cfg.kcal})</p>
    ${nLog ? `<p>Protéines moy. : <b>${r0(mac.p / nLog)} g</b> · Glucides : <b>${r0(mac.c / nLog)} g</b> · Lipides : <b>${r0(mac.f / nLog)} g</b></p>` : ''}
    <div class="msg ${diff > 0 ? 'warm' : ''}">${!nLog ? 'Note ton premier repas et le bilan apparaît ici.' : diff > 0 ? `Écart de +${diff} kcal sur la semaine. Pas grave : ${cfg.compensate ? 'l\'app lisse doucement sur les jours restants.' : 'la semaine prochaine repart à zéro.'}` : `Dans les clous (${diff} kcal). Bravo, sérieux 👏`}</div></div>`;
  const bw = Object.entries(binges).filter(([d]) => d >= m);
  if (bw.length) {
    const trg = {}; Object.values(binges).forEach(b => b.triggers.forEach(t => trg[t] = (trg[t] || 0) + 1));
    const top = Object.entries(trg).sort((a, b) => b[1] - a[1]).slice(0, 3);
    h += `<div class="card"><b>💜 Crises</b><p class="mute">${bw.length} cette semaine. ${top.length ? 'Déclencheurs les plus fréquents (depuis le début) : ' + top.map(t => `${esc(t[0])} (${t[1]})`).join(', ') + '.' : ''}</p>
      <small>Repérer les déclencheurs, c'est ce qui permet d'agir dessus. Tu fais déjà le plus dur.</small></div>`;
  }
  $('#view').innerHTML = h;
}

// ---------- CORPS ----------
async function renderBody() {
  $('#sub').textContent = 'Photos chaque semaine · poids chaque mois';
  const ph = await loadPhotos();
  const urls = ph.map(p => URL.createObjectURL(p.blob));
  const lastP = ph.length ? ph[ph.length - 1].date : null;
  const dueP = !lastP || daysBetween(lastP, today()) >= 7;
  let h = `<div class="card ${dueP ? 'todo' : ''}"><b>📸 Photo de la semaine</b>
    <p class="mute">${lastP ? `Dernière : ${fmtShort(lastP)}${dueP ? ' · c\'est l\'heure !' : ` · prochaine dans ${7 - daysBetween(lastP, today())} j`}` : 'Première photo = ton point de départ. Elle aura beaucoup de valeur dans 2 mois.'}</p>
    <label class="btn full" style="text-align:center;color:#fff;margin:0">📷 Prendre / choisir la photo<input id="pf" type="file" accept="image/*" hidden></label>
    <small style="display:block;margin-top:8px">Astuce : même endroit, même lumière, même tenue, même heure. Tes photos restent sur ton téléphone uniquement.</small>
    ${ph.length >= 2 ? `<button class="btn2 full" style="margin-top:10px" onclick="openCompare()">🔍 Comparer ${compareDue() ? '(bilan du mois dispo !)' : ''}</button>` : ''}
    <div class="photos" style="margin-top:12px">${ph.slice().reverse().map((p, i) => `<div><img src="${urls[ph.length - 1 - i]}" onclick="viewPhoto('${p.id}')"><small>${fmtShort(p.date)}</small></div>`).join('')}</div></div>`;
  h += weightHTML();
  $('#view').innerHTML = h;
  $('#pf').onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    try { const blob = await shrink(file); await DB.put({ id: String(Date.now()), date: today(), blob }); toast('Photo enregistrée 📸 Bravo !'); confetti(80); render(); }
    catch { toast('Impossible d\'enregistrer la photo'); }
  };
}
function shrink(file) {
  return new Promise((res, rej) => {
    const img = new Image(); img.onload = () => {
      const s = Math.min(1, 1400 / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = img.width * s; c.height = img.height * s; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(b => b ? res(b) : rej(), 'image/jpeg', 0.85); URL.revokeObjectURL(img.src);
    }; img.onerror = rej; img.src = URL.createObjectURL(file);
  });
}
window.viewPhoto = id => {
  const p = photoCache.find(x => x.id === id);
  openSheet(`<div class="row between"><b>${fmtDate(p.date)}</b><button class="btn3" onclick="closeSheet()">Fermer</button></div>
    <img src="${URL.createObjectURL(p.blob)}" style="width:100%;border-radius:16px;margin:10px 0">
    <button class="btn2 full" onclick="delPhoto('${id}')">Supprimer cette photo</button>`);
};
window.delPhoto = async id => { if (!confirm('Supprimer cette photo ?')) return; await DB.del(id); closeSheet(); render(); };
window.openCompare = () => {
  const ph = photoCache || []; if (ph.length < 2) return;
  const B = ph[ph.length - 1];
  // photo la plus proche d'il y a ~4 semaines (sinon la plus ancienne)
  const goal = addDays(B.date, -28);
  const older = ph.slice(0, -1);
  const A0 = older.reduce((best, p) => Math.abs(daysBetween(p.date, goal)) < Math.abs(daysBetween(best.date, goal)) ? p : best, older[0]);
  const first = ph[0];
  const opts = [A0, first].filter((p, i, a) => a.findIndex(x => x.id === p.id) === i);
  window._cmp = { A: A0, B };
  openSheet(`<div class="row between"><h2 style="margin:0">🔍 Avant / maintenant</h2><button class="btn3" onclick="closeSheet()">Fermer</button></div>
    <div class="chips">${opts.map(p => `<button class="chip ${p.id === A0.id ? 'on' : ''}" onclick="setCmpA('${p.id}',this)">${p.id === first.id ? 'Depuis le début' : 'Il y a ~1 mois'} (${fmtShort(p.date)})</button>`).join('')}</div>
    <div class="cmp"><img id="ca" src="${URL.createObjectURL(B.blob)}"><img id="cb" class="top" src="${URL.createObjectURL(A0.blob)}"></div>
    <input type="range" min="0" max="100" value="50" oninput="$('#cb').style.clipPath='inset(0 '+(100-this.value)+'% 0 0)'" style="margin:12px 0">
    <div class="row between"><small id="cad">◀ ${fmtShort(A0.date)}</small><small>${fmtShort(B.date)} ▶</small></div>
    <h2>Tu observes un changement ?</h2>
    <div class="grid2"><button onclick="cmpAns(1)">Oui 👀</button><button class="btn2" onclick="cmpAns(0)">Pas encore</button></div>
    <div id="cmpMsg"></div>`);
};
window.setCmpA = (id, el) => { const p = photoCache.find(x => x.id === id); _cmp.A = p; $('#cb').src = URL.createObjectURL(p.blob); $('#cad').textContent = '◀ ' + fmtShort(p.date); el.parentNode.querySelectorAll('.chip').forEach(c => c.classList.remove('on')); el.classList.add('on'); };
window.cmpAns = yes => {
  meta.lastCompare = today(); save();
  const weeks = Math.max(1, Math.round(daysBetween(photoCache[0].date, today()) / 7));
  $('#cmpMsg').innerHTML = yes
    ? `<div class="msg warm">🎉 <b>Énorme !</b> Ton travail se voit. Garde cette photo en tête les jours difficiles.</div>`
    : `<div class="msg">💪 <b>C'est normal, ce n'est que le début (${weeks} semaine${weeks > 1 ? 's' : ''}).</b> Le corps change plus lentement que ce que le cerveau voudrait, et on ne voit pas ses propres changements au quotidien. Les photos sont là pour ça : continue chaque semaine, la comparaison sur plusieurs mois sera bien plus parlante.</div>`;
  if (yes) confetti(150);
};
function weightHTML() {
  const last = weights[weights.length - 1], prev = weights[weights.length - 2];
  const due = !last || daysBetween(last.date, today()) >= 30;
  let trend = '';
  if (last && prev) {
    const d = last.kg - prev.kg;
    trend = Math.abs(d) < 0.5 ? '➡️ Stable. La stabilité aussi est une réussite, surtout si les photos ou les vêtements bougent.'
      : d < 0 ? '↘️ En baisse. Ce que tu fais fonctionne 🔥'
        : '↗️ Un peu en hausse. Le poids varie avec l\'eau, les hormones, le sel : un seul point ne dit pas tout. On regarde la tendance sur plusieurs mois.';
  }
  return `<div class="card ${due ? 'todo' : ''}"><b>⚖️ Pesée du mois</b>
    <p class="mute">${last ? `Dernière : ${fmtShort(last.date)}${due ? ' · c\'est le moment !' : ` · prochaine dans ${30 - daysBetween(last.date, today())} j`}` : '1 fois par mois suffit. Le matin, à jeun.'}</p>
    ${trend ? `<div class="msg">${trend}</div>` : ''}
    <div class="row"><input id="wk" type="number" inputmode="decimal" step="0.1" placeholder="kg"><button onclick="saveW()">Enregistrer</button></div>
    <button class="btn3" onclick="cfg.showWeight=!cfg.showWeight;save();render()">${cfg.showWeight ? 'Masquer les chiffres' : 'Afficher les chiffres'}</button>
    ${cfg.showWeight && weights.length ? `<div>${weights.slice().reverse().map((w, i, a) => `<div class="item"><span>${fmtShort(w.date)}</span><span><b>${w.kg} kg</b> ${a[i + 1] ? `<small>(${w.kg - a[i + 1].kg > 0 ? '+' : ''}${r1(w.kg - a[i + 1].kg)})</small>` : ''}</span><button class="del" onclick="delW(${a.length - 1 - i})">✕</button></div>`).join('')}</div>` : ''}
  </div>`;
}
window.saveW = () => {
  const v = parseFloat(String($('#wk').value).replace(',', '.')); if (!v || v < 25 || v > 350) { toast('Poids invalide'); return; }
  weights = weights.filter(w => w.date !== today()); weights.push({ date: today(), kg: r1(v) }); weights.sort((a, b) => a.date < b.date ? -1 : 1);
  save(); toast('Pesée notée ✅ Rendez-vous dans un mois.'); confetti(60); render();
};
window.delW = i => { weights.splice(i, 1); save(); render(); };

// ---------- RÉGLAGES ----------
function renderSettings() {
  $('#sub').textContent = 'Tes objectifs et rappels';
  const mk = r0(cfg.p * 4 + cfg.c * 4 + cfg.f * 9);
  $('#view').innerHTML = `
  <div class="card"><b>🎯 Objectifs du jour</b>
    <div class="grid2"><div><label>Calories</label><input id="sk" type="number" inputmode="numeric" value="${cfg.kcal}"></div>
    <div><label>Protéines (g)</label><input id="sp" type="number" inputmode="numeric" value="${cfg.p}"></div>
    <div><label>Glucides (g)</label><input id="sc" type="number" inputmode="numeric" value="${cfg.c}"></div>
    <div><label>Lipides (g)</label><input id="sf" type="number" inputmode="numeric" value="${cfg.f}"></div></div>
    <small id="mk">Tes macros font ${mk} kcal (P×4 + G×4 + L×9).</small></div>
  <div class="card"><b>🔧 Lissage après un dépassement</b>
    <label><input type="checkbox" id="scomp" style="width:auto" ${cfg.compensate ? 'checked' : ''}> Réduire un peu l'objectif des jours suivants (même semaine)</label>
    <div class="grid2"><div><label>Réduction max / jour (%)</label><input id="smax" type="number" value="${cfg.maxPct}"></div>
    <div><label>Plancher (kcal min)</label><input id="smin" type="number" value="${cfg.minKcal}"></div></div>
    <label><input type="checkbox" id="sskip" style="width:auto" ${cfg.skipBinge ? 'checked' : ''}> Ne pas rattraper les jours de crise (recommandé)</label>
    <small>Pourquoi : la restriction après une crise entretient souvent le cycle crise/restriction. Les protéines ne baissent jamais.</small></div>
  <div class="card"><b>⏰ Heures des repas (rappels)</b>
    <div class="grid2">${Object.entries(MEALS).map(([k, v]) => `<div><label>${v}</label><input type="time" id="t_${k}" value="${cfg.meals[k] || ''}"></div>`).join('')}</div>
    <label>Jour de la photo hebdo</label><select id="sday">${['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'].map((d, i) => `<option value="${i}" ${+cfg.photoDay === i ? 'selected' : ''}>${d}</option>`).join('')}</select>
    <button class="full" style="margin-top:14px" onclick="saveCfg()">💾 Enregistrer</button></div>
  <div class="card"><b>🔔 Rappels sur ton iPhone</b>
    <p class="mute">Ajoute les rappels à ton calendrier : repas, photo hebdo, pesée du 1er du mois. Ils sonneront même app fermée.</p>
    <button class="full" onclick="exportICS()">📅 Ajouter les rappels au calendrier</button>
    <small style="display:block;margin-top:8px">Si rien ne se passe depuis l'app installée, ouvre la même page dans Safari et appuie à nouveau. Puis « Tout ajouter ».</small></div>
  <div class="card"><b>💾 Sauvegarde</b><p class="mute">Tout est stocké sur ton téléphone. Fais une sauvegarde de temps en temps (Fichiers / iCloud).</p>
    <button class="btn2 full" onclick="backup()">⬇️ Exporter mes données</button>
    <label class="btn btn2 full" style="text-align:center;margin-top:8px">⬆️ Importer une sauvegarde<input type="file" id="imp" accept="application/json,.json" hidden></label></div>
  <div class="card"><b>📲 Installer sur l'iPhone</b><p class="mute">Dans Safari : bouton Partager ⬆️ → « Sur l'écran d'accueil ». L'app s'ouvre ensuite en plein écran comme une vraie app.</p></div>
  <p class="mute" style="text-align:center">Données nutritionnelles des marques : <a href="https://fr.openfoodfacts.org" target="_blank" rel="noopener">Open Food Facts</a> (base collaborative, vérifie l'étiquette en cas de doute).</p>`;
  ['sp', 'sc', 'sf'].forEach(id => $('#' + id).oninput = () => { $('#mk').textContent = `Tes macros font ${r0(+$('#sp').value * 4 + +$('#sc').value * 4 + +$('#sf').value * 9)} kcal (P×4 + G×4 + L×9).`; });
  $('#imp').onchange = restore;
}
window.saveCfg = () => {
  cfg.kcal = +$('#sk').value || cfg.kcal; cfg.p = +$('#sp').value || 0; cfg.c = +$('#sc').value || 0; cfg.f = +$('#sf').value || 0;
  cfg.compensate = $('#scomp').checked; cfg.skipBinge = $('#sskip').checked;
  cfg.maxPct = Math.min(25, Math.max(0, +$('#smax').value || 0)); cfg.minKcal = +$('#smin').value || 0;
  Object.keys(MEALS).forEach(k => cfg.meals[k] = $('#t_' + k).value); cfg.photoDay = +$('#sday').value; cfg.set = true;
  save(); toast('Enregistré ✅'); render();
};

function exportICS() {
  const url = location.href.split('?')[0].split('#')[0];
  const t = new Date(); t.setDate(t.getDate() + 1);
  const ds = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const ev = (id, date, time, title, desc, rrule) => {
    const [h, m] = time.split(':');
    return ['BEGIN:VEVENT', `UID:lapeche-${id}@local`, `DTSTAMP:${stamp}`, `DTSTART:${ds(date)}T${h}${m}00`, 'DURATION:PT10M', `RRULE:${rrule}`, `SUMMARY:${title}`, `DESCRIPTION:${desc}\\n${url}`, `URL:${url}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:PT0M', `DESCRIPTION:${title}`, 'END:VALARM', 'END:VEVENT'].join('\r\n');
  };
  const evs = [];
  const T = { pdj: '🍑 Note ton petit-déj', dej: '🍑 Note ton déjeuner', gouter: '🍑 Goûter ? Note-le', diner: '🍑 Note ton dîner' };
  for (const [k, time] of Object.entries(cfg.meals)) if (time) {
    const [h, m] = time.split(':').map(Number); const tt = `${pad(Math.min(23, h + (m + 30 >= 60 ? 1 : 0)))}:${pad((m + 30) % 60)}`;
    evs.push(ev('meal-' + k, t, tt, T[k], '30 secondes. Ouvre La Pêche et note-le.', 'FREQ=DAILY'));
  }
  const pd = new Date(t); while (pd.getDay() !== +cfg.photoDay) pd.setDate(pd.getDate() + 1);
  evs.push(ev('photo', pd, '10:00', '📸 Photo de la semaine', 'Même endroit, même lumière. 30 secondes.', 'FREQ=WEEKLY;BYDAY=' + ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][+cfg.photoDay]));
  const md = new Date(t.getFullYear(), t.getMonth() + 1, 1);
  evs.push(ev('weight', md, '08:00', '⚖️ Pesée du mois', 'Le matin, à jeun. Puis note-la dans La Pêche.', 'FREQ=MONTHLY;BYMONTHDAY=1'));
  evs.push(ev('weekly', pd, '18:00', '💜 Bilan de la semaine', 'Regarde ta semaine dans La Pêche. Fière de toi pour chaque jour noté.', 'FREQ=WEEKLY;BYDAY=' + ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][+cfg.photoDay]));
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//La Peche//FR', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:La Pêche', ...evs, 'END:VCALENDAR'].join('\r\n');
  download(new Blob([ics], { type: 'text/calendar;charset=utf-8' }), 'la-peche-rappels.ics');
}
window.exportICS = exportICS;
function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}
const b64 = blob => new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
window.backup = async () => {
  const ph = await DB.all().catch(() => []);
  const photos = []; for (const p of ph) photos.push({ id: p.id, date: p.date, data: await b64(p.blob) });
  const data = { v: 1, at: new Date().toISOString(), cfg, entries, foods, binges, weights, meta, photos };
  download(new Blob([JSON.stringify(data)], { type: 'application/json' }), `la-peche-sauvegarde-${today()}.json`);
};
async function restore(e) {
  const f = e.target.files[0]; if (!f) return;
  try {
    const d = JSON.parse(await f.text()); if (!d.entries) throw 0;
    if (!confirm('Remplacer les données actuelles par cette sauvegarde ?')) return;
    cfg = Object.assign({}, DEF, d.cfg); entries = d.entries || {}; foods = d.foods || {}; binges = d.binges || {}; weights = d.weights || []; meta = d.meta || {};
    for (const p of d.photos || []) { const blob = await (await fetch(p.data)).blob(); await DB.put({ id: p.id, date: p.date, blob }); }
    save(); toast('Sauvegarde restaurée ✅'); render();
  } catch { toast('Fichier de sauvegarde invalide'); }
}

// ---------- confettis ----------
function confetti(n = 60) {
  const c = $('#confetti'), x = c.getContext('2d'); c.width = innerWidth; c.height = innerHeight;
  const cols = ['#FF7A59', '#FFB38A', '#4CAF7A', '#9C8CF0', '#F2B33D', '#5B8DEF'];
  const ps = [...Array(n)].map(() => ({ x: c.width / 2, y: c.height * 0.75, vx: (Math.random() - .5) * 14, vy: -Math.random() * 16 - 6, s: Math.random() * 6 + 4, c: pick(cols), r: Math.random() * 6 }));
  let f = 0; (function step() {
    x.clearRect(0, 0, c.width, c.height);
    ps.forEach(p => { p.x += p.vx; p.y += p.vy; p.vy += .5; p.r += .1; x.save(); x.translate(p.x, p.y); x.rotate(p.r); x.fillStyle = p.c; x.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * .6); x.restore(); });
    if (++f < 90) requestAnimationFrame(step); else x.clearRect(0, 0, c.width, c.height);
  })();
}

// ---------- démarrage ----------
window.closeSheet = closeSheet;
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
document.addEventListener('visibilitychange', () => { if (!document.hidden) { if (viewDay > today()) viewDay = today(); render(); } });
loadPhotos().then(render);
render();
if (!cfg.set) setTimeout(() => {
  openSheet(`<h2 style="margin-top:0">Bienvenue Tanit 🍑</h2>
    <p>3 étapes, 2 minutes :</p>
    <div class="msg">1️⃣ Mets tes objectifs (calories + macros)<br>2️⃣ Ajoute les rappels au calendrier<br>3️⃣ Installe l'app : Partager ⬆️ → « Sur l'écran d'accueil »</div>
    <p class="mute">Ici pas de rouge, pas de jugement. On note, on apprend, on avance.</p>
    <button class="full" onclick="closeSheet();tab='settings';document.querySelectorAll('#nav button').forEach(x=>x.classList.toggle('on',x.dataset.tab==='settings'));render()">C'est parti</button>`);
}, 400);
