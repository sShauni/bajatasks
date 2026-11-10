"use strict";
let C = {statuses:[], priorities:[], permissions:[], app:'Baja de Galpão Tasks', version:''};
let STATUS = {}, PRIO = {}, PERM_LABEL = {};
function setConst(c) {
  C = c;
  STATUS = Object.fromEntries(C.statuses.map(s => [s.id, s]));
  PRIO = Object.fromEntries(C.priorities.map(p => [p.id, p]));
  PERM_LABEL = Object.fromEntries(C.permissions.map(p => [p.id, p.label]));
}
const State = {me:null, perms:new Set(), level:0, users:[], items:[], roles:[], tasks:[], posts:[], recurrences:[], v:null, prefs:{}, module:'home', refreshPending:false};
const MOBILE_MQ = matchMedia('(max-width: 760px)');
const isMobile = () => MOBILE_MQ.matches;

// ───────── utilitários ─────────
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const opt = (v, l, sel) => `<option value="${esc(v)}" ${String(v) === String(sel ?? '') ? 'selected' : ''}>${esc(l)}</option>`;
const can = p => State.perms.has(p);
const isAdmin = () => can('system.admin');
const userById = id => State.users.find(u => u.id === id);
const itemById = id => State.items.find(i => i.id === id);
const taskById = id => State.tasks.find(t => t.id === id);
const seriesById = id => State.recurrences.find(r => r.id === id);
// "Minha" = sou o responsável principal; "ajudo" = estou no apoio ou tenho alguma etapa.
const isMine = t => t.assignee_id === State.me.id;
// Repetições geram semanas de tarefas à frente; fora do calendário, mostra só a próxima
// ocorrência "a fazer" de cada série (as que já andaram ou estão atrasadas continuam aparecendo).
function collapseRecur(list) {
  const seen = new Set(), today = todayISO(); let hidden = 0;
  const out = [...list].sort((a, b) => (a.due_date || '').localeCompare(b.due_date || '')).filter(t => {
    if (!t.recur_id || t.status !== 'todo' || (t.due_date && t.due_date < today)) return true;
    if (seen.has(t.recur_id)) { hidden++; return false; }
    seen.add(t.recur_id); return true;
  });
  const keep = new Set(out);
  return {list:list.filter(t => keep.has(t)), hidden};
}
const helpsIn = t => !isMine(t) && ((t.members || []).includes(State.me.id) || (t.sub_users || []).includes(State.me.id));
const pad = n => String(n).padStart(2, '0');
const toISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayISO = () => toISO(new Date());
const parseISO = s => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
const daysUntil = s => Math.round((parseISO(s) - parseISO(todayISO())) / 864e5);
const isLate = t => t.status !== 'done' && t.due_date && t.due_date < todayISO();
const WEEKDAYS = ['domingo','segunda','terça','quarta','quinta','sexta','sábado'];
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
function fmtDate(s, full) { if (!s) return ''; const d = parseISO(s); const o = {day:'2-digit', month:'2-digit'}; if (full || d.getFullYear() !== new Date().getFullYear()) o.year = 'numeric'; return d.toLocaleDateString('pt-BR', o); }
function fmtDateTime(iso) { return new Date(iso).toLocaleString('pt-BR', {day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'}); }
function timeAgo(iso) { const s = (Date.now() - Date.parse(iso)) / 1000; if (s < 60) return 'agora'; if (s < 3600) return `há ${Math.floor(s/60)} min`; if (s < 86400) return `há ${Math.floor(s/3600)} h`; if (s < 86400*7) return `há ${Math.floor(s/86400)} d`; return fmtDateTime(iso).slice(0, 10); }
function fmtBytes(n) { return n < 1024 ? n + ' B' : n < 1048576 ? (n/1024).toFixed(1) + ' KB' : (n/1048576).toFixed(1) + ' MB'; }
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;
function download(name, content, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], {type})); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}

async function call(name, payload = {}) {
  let r;
  try { r = await fetch('/api/' + name, {method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json','X-Requested-With':'bt'}, body:JSON.stringify(payload)}); }
  catch (e) { throw Object.assign(new Error('Sem conexão com a internet. Confira o Wi-Fi ou os dados móveis.'), {code:'net'}); }
  let j;
  try { j = await r.json(); } catch (e) { throw Object.assign(new Error('O servidor não respondeu corretamente. Tente de novo.'), {code:'net'}); }
  if (!j.ok) {
    if (j.code === 'auth' && State.me) { State.me = null; showLogin(); }
    throw Object.assign(new Error(j.error), {code:j.code, data:j.data});
  }
  return j.data;
}
function loadPrefs() { try { return JSON.parse(localStorage.getItem('bt_prefs') || '{}') || {}; } catch (e) { return {}; } }
const savePrefs = debounce(() => { try { localStorage.setItem('bt_prefs', JSON.stringify(State.prefs)); } catch (e) {} }, 300);

// ───────── ícones ─────────
const P = {
  logo:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 3v6M12 15v6M3 12h6M15 12h6"/>',
  home:'<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
  tasks:'<rect x="3" y="3" width="18" height="18" rx="5"/><path d="m8 12 3 3 5-6"/>',
  layers:'<path d="m12 2 9 5-9 5-9-5 9-5z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
  users:'<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6.5 7-6.5s7 2.5 7 6.5"/><path d="M16 4a4 4 0 0 1 0 8"/><path d="M22 21c0-3-1.6-5.2-4-6"/>',
  shield:'<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3z"/><path d="m9 12 2 2 4-4"/>',
  db:'<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  list:'<path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4" cy="6" r="1.2"/><circle cx="4" cy="12" r="1.2"/><circle cx="4" cy="18" r="1.2"/>',
  board:'<rect x="3" y="3" width="5" height="18" rx="1.5"/><rect x="10" y="3" width="5" height="12" rx="1.5"/><rect x="17" y="3" width="4" height="8" rx="1.5"/>',
  calendar:'<rect x="3" y="4.5" width="18" height="16.5" rx="3"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
  plus:'<path d="M12 5v14M5 12h14"/>', search:'<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  logout:'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon:'<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>', monitor:'<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  chevL:'<path d="m15 18-6-6 6-6"/>', chevR:'<path d="m9 18 6-6-6-6"/>', x:'<path d="M18 6 6 18M6 6l12 12"/>',
  download:'<path d="M12 3v12m0 0-4-4m4 4 4-4"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  edit:'<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>',
  trash:'<path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15"/>', check:'<path d="m5 12 5 5L20 7"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  alert:'<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/>',
  folder:'<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  tree:'<rect x="9" y="2" width="6" height="5" rx="1"/><rect x="2" y="16" width="6" height="5" rx="1"/><rect x="16" y="16" width="6" height="5" rx="1"/><path d="M12 7v5M5 16v-4h14v4"/>',
  chat:'<path d="M21 12a8 8 0 0 1-11.7 7.1L3 21l1.9-6.3A8 8 0 1 1 21 12z"/>', history:'<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
  refresh:'<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>', lock:'<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  sync:'<path d="M4 12a8 8 0 0 1 14-5.3L20 9"/><path d="M20 4v5h-5"/><path d="M20 12a8 8 0 0 1-14 5.3L4 15"/><path d="M4 20v-5h5"/>',
  flag:'<path d="M4 22V4"/><path d="M4 4h12l-2 4 2 4H4"/>', send:'<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
  sparkle:'<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
  megaphone:'<path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M15 8a5 5 0 0 1 0 8"/><path d="M18 5a9 9 0 0 1 0 14"/>',
  crown:'<path d="m3 7 4.5 4L12 4l4.5 7L21 7l-2 12H5z"/>', repeat:'<path d="m17 2 4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="m7 22-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
  pin:'<path d="M12 17v5"/><path d="M5 17h14l-2-4V6a2 2 0 0 0 0-4H7a2 2 0 0 0 0 4v7z"/>', checklist:'<path d="m3 6 2 2 3-3"/><path d="m3 13 2 2 3-3"/><path d="M11 7h10M11 14h10M11 20h10"/><path d="M4 20h2"/>',
};
const icon = (n, s = 18) => `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${P[n] || ''}</svg>`;

// ───────── componentes visuais ─────────
function initials(name) { const p = String(name || '?').trim().split(/\s+/); return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase(); }
function shortName(name) { const p = String(name || '').trim().split(/\s+/); return p.length > 1 ? `${p[0]} ${p[p.length - 1]}` : p[0] || ''; }
function hue(id) { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
function avatar(u, size = 28) { if (!u) return ''; return `<span class="avatar" style="--h:${hue(u.id)};width:${size}px;height:${size}px;font-size:${Math.round(size * .38)}px" title="${esc(u.full_name)}">${esc(initials(u.full_name))}</span>`; }
function pill(label, color, act) { return `<span class="pill ${act ? 'click' : ''}" ${act ? `data-act="${act}"` : ''} style="--c:${color}"><span class="dot"></span>${esc(label)}</span>`; }
function userCell(id) { const u = userById(id); return u ? `<div class="user-cell">${avatar(u, 26)}<span>${esc(shortName(u.full_name))}</span></div>` : '<span class="muted">—</span>'; }
function itemTag(t) { return t.item_id ? `<span class="item-tag" style="--c:${t.item_color || '#94a3b8'}"><span class="sq"></span>${esc(t.item_name)}</span>` : '<span class="muted">—</span>'; }
function rolePill(u) { return u.role_name ? pill(u.role_name, u.role_color || '#64748b') : ''; }
// Selo de capitão / vice-capitão (título de destaque; não muda permissões).
const BADGES = {captain:{label:'Capitão', color:'#eab308'}, vice:{label:'Vice-capitão', color:'#a855f7'}};
function badgeHtml(u, compact) {
  const b = u && BADGES[u.badge]; if (!b) return '';
  return `<span class="capt ${compact ? 'compact' : ''}" style="--c:${b.color}" title="${b.label} da equipe">${icon('crown', compact ? 12 : 13)}${compact ? '' : b.label}</span>`;
}
function avatarStack(ids, size = 24, max = 4) {
  const us = ids.map(userById).filter(Boolean); if (!us.length) return '';
  return `<span class="astack">${us.slice(0, max).map(u => avatar(u, size)).join('')}${us.length > max ? `<span class="avatar more-av" style="width:${size}px;height:${size}px;font-size:${Math.round(size * .38)}px">+${us.length - max}</span>` : ''}</span>`;
}
const peopleOf = t => [t.assignee_id, ...(t.members || [])].filter(Boolean);
function subChip(t) { return t.sub_total ? `<span class="subchip ${t.sub_done === t.sub_total ? 'full' : ''}" title="Etapas concluídas">${icon('checklist', 13)}${t.sub_done}/${t.sub_total}</span>` : ''; }
function recurMark(t) { return t.recur_id ? `<span class="recur-mark" title="Tarefa que se repete">${icon('repeat', 13)}</span>` : ''; }
const WD_SHORT = ['dom','seg','ter','qua','qui','sex','sáb'];
function freqText(r) {
  const n = r.every || 1, unit = {daily:['dia','dias'], weekly:['semana','semanas'], monthly:['mês','meses']}[r.freq] || ['',''];
  let txt = n === 1 ? (r.freq === 'daily' ? 'Todo dia' : r.freq === 'weekly' ? 'Toda semana' : 'Todo mês') : `A cada ${n} ${unit[1]}`;
  if (r.freq === 'weekly' && r.weekdays && r.weekdays.length) txt += ` (${r.weekdays.map(d => WD_SHORT[d]).join(', ')})`;
  if (r.freq === 'monthly') txt += `, dia ${parseISO(r.start_date).getDate()}`;
  if (r.due_time) txt += ` às ${r.due_time}`;
  if (r.end_date) txt += ` · até ${fmtDate(r.end_date, true)}`;
  return txt;
}
function progressHtml(p) { return `<div class="prog-cell"><div class="progress"><i style="width:${p}%"></i></div>${p}%</div>`; }
function dueHtml(t) {
  if (!t.due_date) return '<span class="muted">—</span>';
  const n = daysUntil(t.due_date); let cls = '', txt;
  if (t.status === 'done') txt = fmtDate(t.due_date);
  else if (n < 0) { cls = 'late'; txt = `${fmtDate(t.due_date)} · ${-n}d atraso`; }
  else if (n === 0) { cls = 'soon'; txt = 'Hoje'; }
  else if (n === 1) { cls = 'soon'; txt = 'Amanhã'; }
  else if (n < 7) txt = cap(WEEKDAYS[parseISO(t.due_date).getDay()]);
  else txt = fmtDate(t.due_date);
  if (t.due_time) txt += ` · ${t.due_time}`;
  return `<span class="due ${cls}" title="${fmtDate(t.due_date, true)}${t.due_time ? ' às ' + t.due_time : ''}">${icon(cls === 'late' ? 'alert' : 'calendar', 14)}${txt}</span>`;
}
function emptyState(title, text, btn) {
  return `<div class="empty"><div class="big">${icon('sparkle', 34)}</div><h3>${esc(title)}</h3><p>${esc(text)}</p>${btn || ''}</div>`;
}
function toast(msg, type = 'info') {
  const el = document.createElement('div'); el.className = 'toast ' + type;
  el.innerHTML = `${icon(type === 'err' ? 'alert' : type === 'ok' ? 'check' : 'info', 18)}<span>${esc(msg)}</span>`;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, type === 'err' ? 6000 : 3500);
}

// ───────── modal, confirmação e menus ─────────
function openModal({title, body, foot = '', size = '', dismissable = true, backdrop = true, onClose}) {
  const ov = document.createElement('div'); ov.className = 'overlay';
  ov.innerHTML = `<div class="modal ${size}" role="dialog"><div class="modal-head"><h3>${esc(title)}</h3>${dismissable ? `<button class="btn ghost icon ml" data-close title="Fechar (Esc)">${icon('x')}</button>` : ''}</div><div class="modal-body">${body}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ''}</div>`;
  document.body.appendChild(ov);
  const onKey = e => { if (e.key === 'Escape' && dismissable && ov === $$('.overlay').pop()) { e.stopPropagation(); close(); } };
  function close() {
    ov.remove(); document.removeEventListener('keydown', onKey); onClose && onClose();
    if (State.refreshPending && !isBusy()) { State.refreshPending = false; reload(); }
  }
  document.addEventListener('keydown', onKey);
  let down = false;
  ov.addEventListener('mousedown', e => { down = e.target === ov; });
  ov.addEventListener('mouseup', e => { if (down && e.target === ov && dismissable && backdrop) close(); down = false; });
  $$('[data-close]', ov).forEach(b => b.onclick = close);
  const m = $('.modal', ov);
  setTimeout(() => { const f = $('[autofocus]', m); if (f) f.focus(); }, 30);
  return {el:m, close, q:s => $(s, m)};
}
function confirmDlg(msg, okLabel = 'Confirmar', danger = false) {
  return new Promise(res => {
    let ok = false;
    const m = openModal({title:'Confirmar', body:`<p style="margin:0;line-height:1.55">${esc(msg)}</p>`,
      foot:`<span class="spacer"></span><button class="btn" data-close>Cancelar</button><button class="btn ${danger ? 'danger' : 'primary'}" id="cOk">${esc(okLabel)}</button>`,
      onClose:() => res(ok)});
    m.q('#cOk').onclick = () => { ok = true; m.close(); };
    m.q('#cOk').focus();
  });
}
function showMenu(anchor, opts, title) {
  closeMenu();
  const m = document.createElement('div'); m.className = 'menu';
  m.innerHTML = (title ? `<div class="mtitle">${esc(title)}</div>` : '') + opts.map((o, i) => `<button data-i="${i}">${o.color ? `<span class="dot" style="background:${o.color}"></span>` : ''}${o.html || esc(o.label)}${o.active ? `<span class="ml" style="color:var(--accent)">${icon('check', 15)}</span>` : ''}</button>`).join('');
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect(); let top = r.bottom + 6, left = r.left;
  if (top + m.offsetHeight > innerHeight - 8) top = Math.max(8, r.top - m.offsetHeight - 6);
  if (left + m.offsetWidth > innerWidth - 8) left = innerWidth - m.offsetWidth - 8;
  m.style.top = top + 'px'; m.style.left = left + 'px';
  m.onclick = e => { const b = e.target.closest('button'); if (!b) return; closeMenu(); opts[+b.dataset.i].onPick(); };
  setTimeout(() => document.addEventListener('mousedown', menuOutside), 0);
}
function menuOutside(e) { if (!e.target.closest('.menu')) closeMenu(); }
function closeMenu() { $$('.menu').forEach(m => m.remove()); document.removeEventListener('mousedown', menuOutside); }

// ───────── tema ─────────
function applyTheme() {
  const t = State.prefs.theme || 'system';
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const b = $('#themeBtn');
  if (b) b.innerHTML = `${icon(t === 'dark' ? 'moon' : t === 'light' ? 'sun' : 'monitor')} Tema: ${({light:'Claro', dark:'Escuro', system:'Automático'})[t]}`;
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
function cycleTheme() { const order = ['system', 'light', 'dark']; State.prefs.theme = order[(order.indexOf(State.prefs.theme || 'system') + 1) % 3]; applyTheme(); savePrefs(); }

// ───────── inicialização / login ─────────
async function boot() {
  State.prefs = loadPrefs(); applyTheme();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  let info;
  try { info = await call('sys.info'); } catch (e) { return showBlocker('Não foi possível conectar', e.message, true); }
  setConst(info.const); State.info = info;
  if (info.needs_setup) return showSetup();
  if (info.logged) { try { return await enterApp(); } catch (e) { /* sessão inválida: cai no login */ } }
  showLogin();
}
function showBlocker(title, text, retry) {
  $('#root').innerHTML = `<div class="blocker"><div class="card" style="padding:36px;max-width:480px"><div class="empty" style="padding:0"><div class="big">${icon('alert', 34)}</div><h3>${esc(title)}</h3><p>${esc(text)}</p>${retry ? '<button class="btn primary" id="retryBtn">Tentar de novo</button>' : ''}</div></div></div>`;
  if (retry) $('#retryBtn').onclick = () => location.reload();
}
function authShell(inner) {
  $('#root').innerHTML = `<div class="auth"><div class="auth-hero"><svg class="wheel" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1">${P.logo}</svg>
    <div class="brand-row"><div class="logo">${icon('logo', 24)}</div>${esc(C.app)}</div>
    <div><h1>Organize a equipe.<br>Acelere o projeto. 🏁</h1><p>Todas as tarefas do carro num lugar só — por subsistema, por integrante, com prazos e prioridades claros.</p>
      <div class="feat"><div><span>${icon('board', 17)}</span>Lista, quadro e calendário</div><div><span>${icon('layers', 17)}</span>Tarefas por item e por integrante</div><div><span>${icon('sync', 17)}</span>Na nuvem: use no PC ou no celular</div></div></div>
    <div style="opacity:.6;font-size:12px">v${esc(C.version)}</div></div>
    <div class="auth-form"><div class="auth-card"><div class="brand-row auth-mobile-brand"><div class="logo">${icon('logo', 24)}</div>${esc(C.app)}</div>${inner}</div></div></div>`;
}
function showLogin() {
  stopPolling(); closeMenu(); $$('.overlay').forEach(o => o.remove());
  authShell(`<h2>Bem-vindo de volta 👋</h2><p class="muted" style="margin:0 0 24px">Entre com o seu usuário da equipe.</p>
    <form id="loginForm" class="stack">
      <div class="field"><label>Usuário</label><input class="input" name="username" value="${esc(State.prefs.last_username || '')}" spellcheck="false" autocomplete="username" autocapitalize="none"></div>
      <div class="field"><label>Senha</label><input class="input" type="password" name="password" autocomplete="current-password"></div>
      <div class="form-err" id="loginErr"></div>
      <button class="btn primary lg block" type="submit">Entrar</button>
    </form><p class="hint" style="text-align:center;margin-top:18px">Esqueceu a senha? Peça para um gerente ou admin redefinir.</p>`);
  const f = $('#loginForm'); (f.username.value ? f.password : f.username).focus();
  f.onsubmit = async e => {
    e.preventDefault(); const b = $('button', f); b.disabled = true; $('#loginErr').textContent = '';
    try { await call('auth.login', {username:f.username.value, password:f.password.value}); State.prefs.last_username = f.username.value.trim().toLowerCase(); savePrefs(); await enterApp(); }
    catch (err) { $('#loginErr').textContent = err.message; f.password.select(); b.disabled = false; }
  };
}
function showSetup() {
  authShell(`<h2>Vamos começar 🚀</h2><p class="muted" style="margin:0 0 22px">Primeiro acesso: crie a conta do <b>administrador</b>. Depois você cadastra a equipe, os cargos e os itens.</p>
    <form id="setupForm" class="stack">
      <div class="field"><label>Seu nome completo</label><input class="input" name="full_name" autofocus></div>
      <div class="field"><label>Usuário (login)</label><input class="input" name="username" placeholder="ex.: joao.silva" spellcheck="false"></div>
      <div class="grid2"><div class="field"><label>Senha</label><input class="input" type="password" name="password"></div>
      <div class="field"><label>Confirmar</label><input class="input" type="password" name="confirm"></div></div>
      <div class="form-err" id="setupErr"></div>
      <button class="btn primary lg block" type="submit">Criar e entrar</button>
    </form><p class="hint">Quem cria esta primeira conta vira o administrador do sistema.</p>`);
  const f = $('#setupForm'); f.full_name.focus();
  f.onsubmit = async e => {
    e.preventDefault();
    if (f.password.value !== f.confirm.value) { $('#setupErr').textContent = 'As senhas não conferem.'; return; }
    try { await call('sys.setup', {full_name:f.full_name.value, username:f.username.value, password:f.password.value}); await enterApp(); toast('Tudo pronto! Agora cadastre a equipe em “Equipe”.', 'ok'); }
    catch (err) { $('#setupErr').textContent = err.message; }
  };
}
async function enterApp() {
  await refreshData();
  renderShell();
  go(State.prefs.module || 'home');
  startPolling();
  if (State.me.must_change_pw) forcePasswordChange();
}
async function refreshData() {
  const d = await call('app.data');
  Object.assign(State, {me:d.me, perms:new Set(d.perms), level:d.level, users:d.users, items:d.items, roles:d.roles, tasks:d.tasks,
    posts:d.posts || [], recurrences:d.recurrences || [], v:d.v});
}
async function reload() {
  try { await refreshData(); } catch (e) { return; }
  renderNav(); renderMe(); rerender();
}
function rerender() { const m = Modules.find(m => m.id === State.module); if (!m) return; if (m.refresh) m.refresh(); else go(m.id); }
async function logout() { await call('auth.logout').catch(() => {}); State.me = null; showLogin(); }

// ───────── sincronização: verifica mudanças de outros integrantes ─────────
let pollTimer = null;
const DnD = {active:false, id:null};
// Checa a cada 15 s e só com o app visível na tela (economiza o limite grátis da Cloudflare).
function startPolling() { stopPolling(); pollTimer = setInterval(() => { if (document.visibilityState === 'visible') poll(); }, 15000); }
function stopPolling() { clearInterval(pollTimer); pollTimer = null; }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && pollTimer) poll(); });
function isBusy() { return !!$('.overlay') || !!$('.menu') || DnD.active; }
async function poll() {
  let r; try { r = await call('sys.poll'); } catch (e) { return; }
  if ((r.v && r.v !== State.v) || State.refreshPending) {
    if (isBusy()) { State.refreshPending = true; return; }
    State.refreshPending = false; await reload();
  }
}

// ───────── módulos (menu lateral) ─────────
const Modules = [];
function registerModule(m) { Modules.push(m); }
const visibleModules = () => Modules.filter(m => !m.visible || m.visible());
function renderShell() {
  $('#root').innerHTML = `<div class="app"><aside class="sidebar">
      <div class="brand"><div class="logo">${icon('logo', 22)}</div><div><b>${esc(C.app)}</b><small>Gestão da equipe</small></div></div>
      <nav class="nav" id="nav"></nav>
      <div class="side-bottom"><button class="btn ghost" id="themeBtn"></button><div class="me" id="meBox" title="Meu perfil"></div><button class="btn ghost" id="logoutBtn">${icon('logout')} Sair</button></div>
    </aside><main><header class="topbar"><div class="tb-title"><h1 id="pageTitle"></h1><div class="sub" id="pageSub"></div></div><div class="actions" id="pageActions"></div><button class="me-mobile" id="meMobile" title="Minha conta"></button></header><section id="view"></section></main></div>`;
  $('#themeBtn').onclick = cycleTheme; $('#logoutBtn').onclick = logout; $('#meBox').onclick = openProfile;
  $('#meMobile').onclick = e => showMenu(e.currentTarget, [
    {html:`${icon('users', 16)}<span>Meu perfil</span>`, onPick:openProfile},
    {html:`${icon('moon', 16)}<span>Trocar tema</span>`, onPick:cycleTheme},
    {html:`${icon('logout', 16)}<span>Sair</span>`, onPick:logout}], State.me.full_name);
  applyTheme(); renderNav(); renderMe();
}
function renderNav() {
  const nav = $('#nav'); if (!nav) return;
  let html = '', sec = null;
  for (const m of visibleModules()) {
    if (m.section !== sec) { sec = m.section; html += `<div class="nav-label">${esc(sec)}</div>`; }
    const b = m.badge ? m.badge() : null;
    html += `<a data-mod="${m.id}" class="${State.module === m.id ? 'active' : ''}">${icon(m.icon, 19)}<span>${esc(m.title)}</span>${b && b.n ? `<span class="badge ${b.hot ? 'hot' : ''}">${b.n}</span>` : ''}</a>`;
  }
  nav.innerHTML = html;
  $$('a', nav).forEach(a => a.onclick = () => go(a.dataset.mod));
}
function renderMe() {
  const bd = BADGES[State.me && State.me.badge];
  const b = $('#meBox'); if (b && State.me) b.innerHTML = `${avatar(State.me, 36)}<div class="who"><b>${esc(State.me.full_name)}</b><small>${esc(bd ? bd.label : State.me.role_name || '')}</small></div>`;
  const mm = $('#meMobile'); if (mm && State.me) mm.innerHTML = avatar(State.me, 36);
}
MOBILE_MQ.addEventListener('change', () => { if (State.me && $('#view')) rerender(); });
function go(id, opts) {
  const vis = visibleModules(); const m = vis.find(x => x.id === id) || vis[0];
  State.module = m.id; State.prefs.module = m.id; savePrefs(); closeMenu();
  renderNav();
  $('#pageTitle').textContent = m.title;
  $('#pageSub').textContent = typeof m.subtitle === 'function' ? m.subtitle() : (m.subtitle || '');
  const actions = $('#pageActions'); actions.innerHTML = '';
  const view = $('#view'); view.innerHTML = ''; view.scrollTop = 0;
  m.render(view, actions, opts || {});
}
document.addEventListener('click', e => { if (e.target.closest('[data-newtask]')) openTask(null); });
document.addEventListener('keydown', e => {
  if (!State.me || isBusy() || e.ctrlKey || e.altKey || e.metaKey) return;
  if (e.target.matches('input,textarea,select')) return;
  if (e.key === 'n' && can('tasks.create')) { e.preventDefault(); openTask(null); }
  if (e.key === '/') { const s = $('#fQ'); if (s) { e.preventDefault(); s.focus(); } }
});

// ═══════════ MÓDULO: INÍCIO ═══════════
function greeting() { const h = new Date().getHours(); return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'; }
function gotoTasks(filters) { Object.assign(TS(), {item:'', user:'', status:'open', prio:'', q:''}, filters); savePrefs(); go('tasks'); }
registerModule({id:'home', title:'Início', icon:'home', section:'Trabalho',
  subtitle:() => cap(new Date().toLocaleDateString('pt-BR', {weekday:'long', day:'numeric', month:'long'})),
  render(view, actions) {
    if (can('tasks.create')) { actions.innerHTML = `<button class="btn primary" id="hNew">${icon('plus')} Nova tarefa</button>`; $('#hNew').onclick = () => openTask(null); }
    const me = State.me.id, open = State.tasks.filter(t => t.status !== 'done');
    const mine = collapseRecur(open.filter(t => t.assignee_id === me)).list, late = mine.filter(isLate), helping = collapseRecur(open.filter(helpsIn)).list;
    const week = mine.filter(t => t.due_date && daysUntil(t.due_date) >= 0 && daysUntil(t.due_date) <= 7);
    const done30 = State.tasks.filter(t => t.status === 'done' && t.completed_at && Date.now() - Date.parse(t.completed_at) < 30 * 864e5);
    const stat = (label, n, ic, c, key) => `<div class="card stat" data-stat="${key}" style="--c:${c}"><div class="sico">${icon(ic, 22)}</div><div><b>${n}</b><span>${label}</span></div></div>`;
    const next = [...mine].sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999') || b.priority - a.priority).slice(0, 7);
    const mineHtml = (next.length ? next.map(t => `<div class="mini-task" data-id="${t.id}"><span class="sdot" style="--c:${PRIO[t.priority].color}"></span><div class="t"><b>${recurMark(t)}${esc(t.title)}</b><span class="muted sm">${esc(t.item_name || 'Sem item')} · ${STATUS[t.status].label}${t.sub_total ? ` · ${t.sub_done}/${t.sub_total} etapas` : ''}</span></div>${dueHtml(t)}</div>`).join('')
      : `<div class="empty" style="padding:30px"><h3>Nada pendente 🎉</h3><p>Você não tem tarefas abertas.</p></div>`)
      + (helping.length ? `<a class="help-line" data-stat="help">${icon('users', 15)} Você também ajuda em ${plural(helping.length, 'tarefa aberta', 'tarefas abertas')} →</a>` : '');
    const posts = State.posts.slice(0, 3);
    const muralHtml = posts.length ? `<div class="card mural-home"><div class="card-h"><h3>${icon('megaphone', 17)} Mural</h3><a class="ml" data-go="mural">Ver tudo</a></div><div class="card-b">${posts.map(p => postHtml(p, true)).join('')}</div></div>` : '';
    const itemsHtml = State.items.map(i => {
      const ts = State.tasks.filter(t => t.item_id === i.id); if (!ts.length) return '';
      const seg = C.statuses.map(s => { const n = ts.filter(t => t.status === s.id).length; return n ? `<i style="width:${n / ts.length * 100}%;background:${s.color}" title="${s.label}: ${n}"></i>` : ''; }).join('');
      const pct = Math.round(ts.filter(t => t.status === 'done').length / ts.length * 100);
      return `<div class="ip-row" data-item="${i.id}"><span class="nm item-tag" style="--c:${i.color}"><span class="sq"></span>${esc(i.name)}</span><div class="stackbar">${seg}</div><span class="muted sm" style="width:38px;text-align:right">${pct}%</span></div>`;
    }).join('') || '<p class="muted">Nenhuma tarefa cadastrada ainda.</p>';
    let teamHtml = '';
    if (can('tasks.view_all')) {
      const openC = collapseRecur(open).list;
      const loads = State.users.filter(u => u.active).map(u => ({u, n:openC.filter(t => t.assignee_id === u.id).length, l:openC.filter(t => t.assignee_id === u.id && isLate(t)).length})).filter(x => x.n).sort((a, b) => b.n - a.n).slice(0, 10);
      const max = Math.max(1, ...loads.map(x => x.n));
      teamHtml = `<div class="card mt"><div class="card-h"><h3>Carga da equipe</h3><span class="muted sm">tarefas abertas por integrante</span></div><div class="card-b">${loads.length ? loads.map(x => `<div class="load-row" data-user="${x.u.id}" style="cursor:pointer"><span class="nm">${avatar(x.u, 24)}${esc(shortName(x.u.full_name))}</span><div class="load-bar"><i style="width:${x.n / max * 100}%"></i></div><span class="sm" style="width:90px;text-align:right"><b>${x.n}</b>${x.l ? ` <span class="red">· ${x.l} atras.</span>` : ''}</span></div>`).join('') : '<p class="muted">Ninguém com tarefas abertas.</p>'}</div></div>`;
    }
    view.innerHTML = `<div class="hello"><h2>${greeting()}, ${esc(State.me.full_name.split(' ')[0])}! 👋</h2><p>Você tem <b>${plural(mine.length, 'tarefa aberta', 'tarefas abertas')}</b>${late.length ? ` — <b class="red">${plural(late.length, 'atrasada', 'atrasadas')}</b>` : ''}.</p></div>
      ${muralHtml}<div class="stats">${stat('Minhas abertas', mine.length, 'tasks', '#3b82f6', 'mine')}${stat('Minhas atrasadas', late.length, 'alert', '#ef4444', 'late')}${stat('Vencem em 7 dias', week.length, 'clock', '#f59e0b', 'week')}${stat('Concluídas em 30 dias', done30.length, 'check', '#22c55e', 'done')}</div>
      <div class="dash"><div class="card"><div class="card-h"><h3>Minhas próximas tarefas</h3><a class="ml" data-stat="mine">Ver todas</a></div><div style="padding-bottom:8px">${mineHtml}</div></div>
      <div class="card"><div class="card-h"><h3>Andamento por item</h3></div><div class="card-b">${itemsHtml}<div class="legend mt">${C.statuses.map(s => `<span><i style="background:${s.color}"></i>${s.label}</span>`).join('')}</div></div></div></div>${teamHtml}`;
    $$('[data-stat]', view).forEach(el => el.onclick = () => {
      const k = el.dataset.stat;
      if (k === 'mine') gotoTasks({user:'__me'}); else if (k === 'help') gotoTasks({user:'__help'}); else if (k === 'late') gotoTasks({user:'__me', status:'late'});
      else if (k === 'week') gotoTasks({user:'__me', status:'week'}); else gotoTasks({status:'done'});
    });
    $$('[data-id]', view).forEach(el => el.onclick = () => openTask(el.dataset.id));
    $$('[data-go]', view).forEach(el => el.onclick = () => go(el.dataset.go));
    $$('[data-post]', view).forEach(el => el.onclick = () => go('mural'));
    $$('[data-item]', view).forEach(el => el.onclick = () => gotoTasks({item:el.dataset.item}));
    $$('[data-user]', view).forEach(el => el.onclick = () => gotoTasks({user:el.dataset.user}));
  }});

// ═══════════ MÓDULO: MURAL ═══════════
function postHtml(p, compact) {
  const u = userById(p.user_id) || {id:p.user_id || 'x', full_name:p.user_name || '?'};
  const edited = p.updated_at && p.updated_at !== p.created_at;
  const acts = compact ? '' : `<span class="post-acts">${can('mural.manage') ? `<button class="btn ghost icon" data-pin="${p.id}" title="${p.pinned ? 'Desafixar' : 'Fixar no topo'}">${icon('pin', 16)}</button>` : ''}${p.can_edit ? `<button class="btn ghost icon" data-pedit="${p.id}" title="Editar">${icon('edit', 16)}</button>` : ''}${p.can_delete ? `<button class="btn ghost icon" data-pdel="${p.id}" title="Apagar">${icon('trash', 16)}</button>` : ''}</span>`;
  return `<div class="post ${p.pinned ? 'pinned' : ''} ${compact ? 'compact' : ''}" data-post="${p.id}">
    <div class="post-head">${avatar(u, compact ? 26 : 34)}<div class="who"><b>${esc(shortName(u.full_name))}</b>${badgeHtml(userById(p.user_id), true)}<span class="muted sm" title="${fmtDateTime(p.created_at)}">${timeAgo(p.created_at)}${edited ? ' · editado' : ''}</span></div>${p.pinned ? `<span class="pin-tag">${icon('pin', 13)} Fixado</span>` : ''}${acts}</div>
    ${p.title ? `<div class="post-title">${esc(p.title)}</div>` : ''}<div class="post-body">${esc(p.body)}</div></div>`;
}
const unseenPosts = () => State.posts.filter(p => p.user_id !== State.me.id && p.created_at > (State.prefs.mural_seen || '')).length;
registerModule({id:'mural', title:'Mural', icon:'megaphone', section:'Trabalho', subtitle:'Recados gerais para toda a equipe',
  badge:() => { const n = State.module === 'mural' ? 0 : unseenPosts(); return {n, hot:n > 0}; },
  render(view) {
    view.innerHTML = `<div class="card composer"><div class="post-head">${avatar(State.me, 34)}<input class="input" id="pmTitle" placeholder="Título (opcional)" maxlength="120"></div>
      <textarea class="input" id="pmBody" rows="3" placeholder="Escreva um recado para a equipe… (Ctrl+Enter publica)"></textarea>
      <div class="row">${can('mural.manage') ? '<label class="inline-check"><input type="checkbox" id="pmPin"> Fixar no topo</label>' : ''}<button class="btn primary ml" id="pmSend">${icon('send', 15)} Publicar</button></div></div>
      <div id="muralList" class="mural-list"></div>`;
    const send = async () => {
      const body = $('#pmBody').value.trim(); if (!body) return $('#pmBody').focus();
      const b = $('#pmSend'); b.disabled = true;
      try {
        await call('posts.save', {post:{title:$('#pmTitle').value, body, pinned:!!($('#pmPin') && $('#pmPin').checked)}});
        $('#pmTitle').value = ''; $('#pmBody').value = ''; if ($('#pmPin')) $('#pmPin').checked = false;
        toast('Recado publicado 📣', 'ok'); await reload();
      } catch (e) { toast(e.message, 'err'); }
      b.disabled = false;
    };
    $('#pmSend').onclick = send;
    $('#pmBody').addEventListener('keydown', e => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); send(); } });
    $('#muralList').onclick = async e => {
      const pin = e.target.closest('[data-pin]'), ed = e.target.closest('[data-pedit]'), del = e.target.closest('[data-pdel]');
      const btn = pin || ed || del; if (!btn) return;
      const p = State.posts.find(x => x.id === (btn.dataset.pin || btn.dataset.pedit || btn.dataset.pdel));
      if (!p) return;
      try {
        if (pin) { await call('posts.pin', {id:p.id, pinned:!p.pinned}); await reload(); }
        else if (ed) openPost(p);
        else if (await confirmDlg('Apagar este recado do mural?', 'Apagar', true)) { await call('posts.delete', {id:p.id}); toast('Recado apagado'); await reload(); }
      } catch (err) { toast(err.message, 'err'); }
    };
    this.refresh();
  },
  refresh() {
    const el = $('#muralList'); if (!el) return;
    State.prefs.mural_seen = new Date().toISOString(); savePrefs();
    el.innerHTML = State.posts.length ? State.posts.map(p => postHtml(p)).join('')
      : `<div class="card">${emptyState('Mural vazio', 'Avisos, combinados da oficina, horários de reunião… tudo que a equipe inteira precisa saber.')}</div>`;
    renderNav();
  }});
function openPost(p) {
  const m = openModal({title:'Editar recado', size:'mid', body:`<div class="stack"><div class="field"><label>Título (opcional)</label><input class="input" id="epTitle" value="${esc(p.title || '')}" maxlength="120"></div>
    <div class="field"><label>Recado</label><textarea class="input" id="epBody" rows="6" autofocus>${esc(p.body)}</textarea></div></div>`,
    foot:`<span class="spacer"></span><button class="btn" data-close>Cancelar</button><button class="btn primary" id="epSave">Salvar</button>`});
  m.q('#epSave').onclick = async () => {
    try { await call('posts.save', {post:{id:p.id, title:m.q('#epTitle').value, body:m.q('#epBody').value}}); m.close(); toast('Recado atualizado', 'ok'); await reload(); }
    catch (e) { toast(e.message, 'err'); }
  };
}

// ═══════════ MÓDULO: TAREFAS ═══════════
function TS() {
  if (!State._ts) {
    const d = {view:'list', q:'', item:'', user:'', status:'open', prio:'', group:'none', sortKey:'due', sortDir:1, month:'', calColor:'priority'};
    State._ts = Object.assign(d, State.prefs.tasks || {}); State._ts.q = ''; State.prefs.tasks = State._ts;
  }
  return State._ts;
}
function filterTasks(f, board) {
  const q = f.q.trim().toLowerCase(), me = State.me.id;
  return State.tasks.filter(t => {
    if (f.item && t.item_id !== f.item) return false;
    if (f.user === '__me') { if (t.assignee_id !== me) return false; }
    else if (f.user === '__help') { if (!helpsIn(t)) return false; }
    else if (f.user === '__none') { if (t.assignee_id) return false; }
    else if (f.user && t.assignee_id !== f.user) return false;
    if (f.prio && String(t.priority) !== String(f.prio)) return false;
    const st = f.status;
    if (st === 'late') { if (!isLate(t)) return false; }
    else if (st === 'week') { if (t.status === 'done' || !t.due_date) return false; const n = daysUntil(t.due_date); if (n < 0 || n > 7) return false; }
    else if (!board) { if (st === 'open') { if (t.status === 'done') return false; } else if (st && st !== 'all' && t.status !== st) return false; }
    if (q && !`${t.title} ${t.description || ''} ${t.item_name || ''} ${t.assignee_name || ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
}
function sortTasks(list) {
  const f = TS(), k = f.sortKey, d = f.sortDir, order = C.statuses.map(s => s.id);
  const val = t => ({title:t.title.toLowerCase(), item:(t.item_name || '~').toLowerCase(), assignee:(t.assignee_name || '~').toLowerCase(), priority:-t.priority,
    status:order.indexOf(t.status), due:t.due_date || '9999-99-99', progress:t.progress})[k];
  return [...list].sort((a, b) => { const x = val(a), y = val(b); return ((x < y ? -1 : x > y ? 1 : 0) * d) || (b.priority - a.priority) || (a.due_date || '9999').localeCompare(b.due_date || '9999'); });
}
function toolbarSelects() {
  const f = TS();
  if (f.item && !itemById(f.item)) f.item = '';
  if (f.user && !f.user.startsWith('__') && !userById(f.user)) f.user = '';
  return {
    item: opt('', 'Todos os itens', f.item) + State.items.map(i => opt(i.id, i.name, f.item)).join(''),
    user: opt('', 'Todos os responsáveis', f.user) + opt('__me', '★ Minhas tarefas', f.user) + opt('__help', '☆ Em que eu ajudo', f.user) + opt('__none', 'Sem responsável', f.user) + State.users.filter(u => u.active).map(u => opt(u.id, u.full_name, f.user)).join(''),
    status: opt('open', 'Abertas', f.status) + opt('all', 'Todos os status', f.status) + opt('late', '⚠ Atrasadas', f.status) + opt('week', 'Vencem em 7 dias', f.status) + C.statuses.map(s => opt(s.id, s.label, f.status)).join(''),
    prio: opt('', 'Todas as prioridades', f.prio) + [...C.priorities].reverse().map(p => opt(p.id, p.label, f.prio)).join(''),
    group: [['none','Sem agrupamento'],['item','Agrupar por item'],['user','Agrupar por responsável'],['status','Agrupar por status'],['priority','Agrupar por prioridade']].map(([v, l]) => opt(v, l, f.group)).join(''),
  };
}
registerModule({id:'tasks', title:'Tarefas', icon:'tasks', section:'Trabalho',
  subtitle:() => 'Veja por item, por integrante — em lista, quadro ou calendário',
  badge:() => { const mine = collapseRecur(State.tasks.filter(t => t.assignee_id === State.me.id && t.status !== 'done')).list; const late = mine.filter(isLate).length; return {n:late || mine.length, hot:late > 0}; },
  render(view, actions) {
    const f = TS(), o = toolbarSelects();
    actions.innerHTML = (State.recurrences.length || can('tasks.create') ? `<button class="btn" id="recBtn" title="Tarefas que se repetem (reuniões etc.)">${icon('repeat')} Repetições</button>` : '')
      + `<button class="btn" id="expBtn" title="Abrir as tarefas filtradas no Excel">${icon('download')} Exportar</button>` + (can('tasks.create') ? `<button class="btn primary" id="newBtn" title="Atalho: N">${icon('plus')} Nova tarefa</button>` : '');
    view.innerHTML = `<div class="toolbar">
      <div class="seg" id="viewSeg">${[['list','list','Lista'],['board','board','Quadro'],['cal','calendar','Calendário']].map(([v, ic, l]) => `<button data-v="${v}" class="${f.view === v ? 'on' : ''}">${icon(ic, 16)}${l}</button>`).join('')}</div>
      <div class="search">${icon('search', 16)}<input class="input" id="fQ" placeholder="Buscar…  ( / )" value="${esc(f.q)}"></div>
      <select class="input" id="fItem">${o.item}</select><select class="input" id="fUser">${o.user}</select>
      <select class="input" id="fStatus">${o.status}</select><select class="input" id="fPrio">${o.prio}</select>
      <select class="input" id="fGroup" ${f.view !== 'list' ? 'hidden' : ''}>${o.group}</select>
      <button class="btn ghost" id="fClear" title="Limpar filtros">${icon('x', 16)} Limpar</button></div><div id="tasksBody"></div>`;
    $$('#viewSeg button').forEach(b => b.onclick = () => { f.view = b.dataset.v; savePrefs(); $$('#viewSeg button').forEach(x => x.classList.toggle('on', x === b)); $('#fGroup').hidden = f.view !== 'list'; renderTasksBody(); });
    $('#fQ').oninput = debounce(e => { f.q = $('#fQ').value; renderTasksBody(); }, 120);
    [['fItem','item'],['fUser','user'],['fStatus','status'],['fPrio','prio'],['fGroup','group']].forEach(([id, k]) => $('#' + id).onchange = e => { f[k] = e.target.value; savePrefs(); renderTasksBody(); });
    $('#fClear').onclick = () => { Object.assign(f, {q:'', item:'', user:'', status:'open', prio:'', group:'none'}); savePrefs(); go('tasks'); };
    if ($('#newBtn')) $('#newBtn').onclick = () => openTask(null);
    if ($('#recBtn')) $('#recBtn').onclick = openSeriesList;
    $('#expBtn').onclick = () => {
      const list = sortTasks(filterTasks(f, f.view === 'board'));
      if (!list.length) return toast('Nenhuma tarefa para exportar com esses filtros.', 'err');
      const br = d => d ? fmtDate(d, true) : '';
      const cell = v => { const x = String(v ?? ''); return /[;"\n\r]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
      const names = ids => ids.map(id => (userById(id) || {}).full_name).filter(Boolean).join(', ');
      const rows = [['Título','Item','Responsável','Apoio','Prioridade','Status','Início','Prazo','Horário','Progresso (%)','Etapas','Descrição','Criada por','Concluída em']]
        .concat(list.map(t => [t.title, t.item_name, t.assignee_name, names(t.members || []), PRIO[t.priority].label, STATUS[t.status].label, br(t.start_date), br(t.due_date), t.due_time || '',
          t.progress, t.sub_total ? `${t.sub_done}/${t.sub_total}` : '', t.description, t.creator_name, t.completed_at ? br(t.completed_at.slice(0, 10)) : '']));
      download(`tarefas_${todayISO()}.csv`, '\ufeff' + rows.map(r => r.map(cell).join(';')).join('\r\n'), 'text/csv;charset=utf-8');
      toast(`${plural(list.length, 'tarefa exportada', 'tarefas exportadas')} — abra o arquivo no Excel`, 'ok');
    };
    renderTasksBody();
  },
  refresh() {
    const o = toolbarSelects();
    [['fItem','item'],['fUser','user'],['fStatus','status'],['fPrio','prio']].forEach(([id, k]) => { const el = $('#' + id); if (el) el.innerHTML = o[k]; });
    renderTasksBody();
  }});
function renderTasksBody() {
  const el = $('#tasksBody'); if (!el) return;
  const f = TS(), all = filterTasks(f, f.view === 'board');
  if (f.view === 'cal') return renderCalendar(el, all);
  const {list, hidden} = collapseRecur(all);
  if (f.view === 'board') renderBoard(el, list); else renderList(el, list);
  if (hidden) el.insertAdjacentHTML('beforeend', `<div class="foot-note">${icon('repeat', 13)} ${plural(hidden, 'ocorrência futura de repetições está oculta', 'ocorrências futuras de repetições estão ocultas')} — veja todas no <a data-tocal>Calendário</a>.</div>`);
  const tc = $('[data-tocal]', el); if (tc) tc.onclick = () => { f.view = 'cal'; savePrefs(); go('tasks'); };
}
function groupOf(t, g) {
  if (g === 'item') return {key:t.item_id || '', label:t.item_name || 'Sem item', color:t.item_color || '#94a3b8', ord:t.item_id ? State.items.findIndex(i => i.id === t.item_id) : 9999};
  if (g === 'user') return {key:t.assignee_id || '', label:t.assignee_name || 'Sem responsável', color:t.assignee_id ? `hsl(${hue(t.assignee_id)} 62% 52%)` : '#94a3b8', ord:(t.assignee_name || '~~~').toLowerCase()};
  if (g === 'status') return {key:t.status, label:STATUS[t.status].label, color:STATUS[t.status].color, ord:C.statuses.findIndex(s => s.id === t.status)};
  return {key:String(t.priority), label:PRIO[t.priority].label, color:PRIO[t.priority].color, ord:-t.priority};
}
function renderList(el, list) {
  const f = TS();
  if (!list.length) { el.innerHTML = `<div class="card">${emptyState('Nenhuma tarefa por aqui', 'Ajuste os filtros ou crie uma nova tarefa.', can('tasks.create') ? `<button class="btn primary" data-newtask>${icon('plus')} Nova tarefa</button>` : '')}</div>`; return; }
  const sorted = sortTasks(list);
  let groups = [{tasks:sorted}];
  if (f.group !== 'none') {
    const map = new Map();
    for (const t of sorted) { const g = groupOf(t, f.group); if (!map.has(g.key)) map.set(g.key, {...g, tasks:[]}); map.get(g.key).tasks.push(t); }
    groups = [...map.values()].sort((a, b) => a.ord < b.ord ? -1 : a.ord > b.ord ? 1 : 0);
  }
  if (isMobile()) return renderMobileList(el, groups, list.length);
  const cols = [['title','Tarefa'],['item','Item'],['assignee','Responsável'],['priority','Prioridade'],['status','Status'],['due','Prazo'],['progress','Progresso']];
  const th = cols.map(([k, l]) => `<th data-sort="${k}">${l}${f.sortKey === k ? (f.sortDir > 0 ? ' ↑' : ' ↓') : ''}</th>`).join('');
  const row = t => `<tr class="trow ${t.status === 'done' ? 'done' : ''}" data-id="${t.id}">
    <td><button class="check ${t.status === 'done' ? 'on' : ''}" data-act="toggle" ${t.can_edit ? '' : 'disabled'} title="${t.status === 'done' ? 'Reabrir' : 'Marcar como concluída'}">${icon('check', 12)}</button></td>
    <td><div class="t-title">${recurMark(t)}${esc(t.title)}${subChip(t)}</div>${t.description ? `<div class="t-sub">${esc(t.description.slice(0, 160))}</div>` : ''}</td>
    <td>${itemTag(t)}</td><td><div class="row">${userCell(t.assignee_id)}${(t.members || []).length ? `<span class="plus-help" title="Apoio: ${esc((t.members || []).map(id => (userById(id) || {}).full_name).filter(Boolean).join(', '))}">+${t.members.length}</span>` : ''}</div></td>
    <td>${pill(PRIO[t.priority].label, PRIO[t.priority].color, t.can_edit ? 'prio' : '')}</td>
    <td>${pill(STATUS[t.status].label, STATUS[t.status].color, t.can_edit ? 'status' : '')}</td>
    <td>${dueHtml(t)}</td><td>${progressHtml(t.progress)}</td></tr>`;
  let body = '';
  for (const g of groups) {
    if (f.group !== 'none') body += `<tr class="grp"><td colspan="8"><span class="gdot" style="--c:${g.color}"></span>${esc(g.label)}<span class="gcount">${g.tasks.length}</span></td></tr>`;
    body += g.tasks.map(row).join('');
  }
  el.innerHTML = `<div class="card table-wrap"><table class="tbl"><thead><tr><th class="nosort" style="width:46px"></th>${th}</tr></thead><tbody>${body}</tbody></table></div><div class="foot-note">${plural(list.length, 'tarefa', 'tarefas')} · clique no status ou na prioridade para mudar rápido</div>`;
  $$('th[data-sort]', el).forEach(h => h.onclick = () => { const k = h.dataset.sort; if (f.sortKey === k) f.sortDir *= -1; else { f.sortKey = k; f.sortDir = 1; } savePrefs(); renderTasksBody(); });
  $('tbody', el).onclick = handleTaskClick;
}
function renderMobileList(el, groups, n) {
  const f = TS();
  const card = t => `<div class="mtask ${t.status === 'done' ? 'done' : ''}" data-id="${t.id}">
    <button class="check ${t.status === 'done' ? 'on' : ''}" data-act="toggle" ${t.can_edit ? '' : 'disabled'} title="Concluir">${icon('check', 12)}</button>
    <div class="mt-main"><div class="t-title">${recurMark(t)}${esc(t.title)}</div>
      <div class="mt-meta">${t.item_id ? itemTag(t) : ''}${dueHtml(t)}${subChip(t)}</div>
      <div class="mt-meta">${pill(STATUS[t.status].label, STATUS[t.status].color, t.can_edit ? 'status' : '')}${pill(PRIO[t.priority].label, PRIO[t.priority].color, t.can_edit ? 'prio' : '')}<span class="ml">${avatarStack(peopleOf(t), 26, 3)}</span></div></div></div>`;
  let html = '';
  for (const g of groups) {
    if (f.group !== 'none') html += `<div class="mgroup"><span class="gdot" style="--c:${g.color}"></span>${esc(g.label)}<span class="gcount">${g.tasks.length}</span></div>`;
    html += g.tasks.map(card).join('');
  }
  el.innerHTML = `<div class="mlist">${html}</div><div class="foot-note">${plural(n, 'tarefa', 'tarefas')} · toque no status ou na prioridade para mudar rápido</div>`;
  $('.mlist', el).onclick = handleTaskClick;
}
function handleTaskClick(e) {
  const rowEl = e.target.closest('[data-id]'); if (!rowEl) return;
  const t = taskById(rowEl.dataset.id); if (!t) return;
  const a = e.target.closest('[data-act]');
  if (a && t.can_edit) {
    e.stopPropagation();
    if (a.dataset.act === 'toggle') return quickUpdate(t, {status:t.status === 'done' ? 'todo' : 'done'});
    if (a.dataset.act === 'status') return showMenu(a, C.statuses.map(s => ({label:s.label, color:s.color, active:s.id === t.status, onPick:() => quickUpdate(t, {status:s.id})})), 'Status');
    if (a.dataset.act === 'prio') return showMenu(a, [...C.priorities].reverse().map(p => ({label:p.label, color:p.color, active:p.id === t.priority, onPick:() => quickUpdate(t, {priority:p.id})})), 'Prioridade');
  }
  if (a && a.dataset.act === 'toggle') return;
  openTask(t.id);
}
async function quickUpdate(t, changes) {
  const backup = {...t};
  Object.assign(t, changes); if (changes.status === 'done') t.progress = 100;
  rerender();
  try {
    await call('tasks.quick', {id:t.id, changes});
    if (changes.status === 'done' && backup.status !== 'done') toast('Tarefa concluída! 🎉', 'ok');
    await reload();
  } catch (e) { Object.assign(t, backup); rerender(); toast(e.message, 'err'); }
}
function enableDnD(root, itemSel, zoneSel, onDrop) {
  $$(itemSel, root).forEach(c => {
    if (c.getAttribute('draggable') !== 'true') return;
    c.addEventListener('dragstart', e => { DnD.active = true; DnD.id = c.dataset.id; e.dataTransfer.setData('text/plain', c.dataset.id); e.dataTransfer.effectAllowed = 'move'; setTimeout(() => c.classList.add('dragging')); });
    c.addEventListener('dragend', () => { DnD.active = false; c.classList.remove('dragging'); $$('.over', root).forEach(z => z.classList.remove('over')); });
  });
  $$(zoneSel, root).forEach(z => {
    z.addEventListener('dragover', e => { if (!DnD.active) return; e.preventDefault(); z.classList.add('over'); });
    z.addEventListener('dragleave', e => { if (!z.contains(e.relatedTarget)) z.classList.remove('over'); });
    z.addEventListener('drop', e => { e.preventDefault(); z.classList.remove('over'); const id = DnD.id; DnD.active = false; DnD.id = null; if (id) onDrop(id, z); });
  });
}
function renderBoard(el, list) {
  const cardHtml = t => `<div class="ktask ${t.status === 'done' ? 'done' : ''}" draggable="${t.can_edit}" data-id="${t.id}" style="--c:${PRIO[t.priority].color}">
      <div class="kt-top">${t.item_id ? itemTag(t) : '<span></span>'}${pill(PRIO[t.priority].label, PRIO[t.priority].color)}</div>
      <div class="kt-title">${recurMark(t)}${esc(t.title)}</div>
      <div class="kt-foot">${dueHtml(t)}${subChip(t) || (t.progress && t.status !== 'done' ? `<div class="progress sm"><i style="width:${t.progress}%"></i></div>` : '')}<span class="ml">${avatarStack(peopleOf(t), 24, 3)}</span></div></div>`;
  el.innerHTML = `<div class="board">${C.statuses.map(s => {
    let ts = list.filter(t => t.status === s.id), extra = 0;
    if (s.id === 'done') { ts.sort((a, b) => (b.completed_at || '').localeCompare(a.completed_at || '')); if (ts.length > 25) { extra = ts.length - 25; ts = ts.slice(0, 25); } }
    else ts = [...ts].sort((a, b) => b.priority - a.priority || (a.due_date || '9999').localeCompare(b.due_date || '9999'));
    return `<div class="col"><div class="col-head"><span class="sdot" style="--c:${s.color}"></span>${s.label}<span class="count">${ts.length + extra}</span></div>
      <div class="col-body" data-status="${s.id}">${ts.map(cardHtml).join('')}${extra ? `<div class="more">+${extra} concluídas mais antigas (veja na Lista)</div>` : ''}</div>
      ${can('tasks.create') ? `<button class="btn ghost add" data-new="${s.id}">${icon('plus', 16)} Adicionar</button>` : ''}</div>`;
  }).join('')}</div><div class="foot-note">Arraste os cartões entre as colunas para mudar o status.</div>`;
  $$('.ktask', el).forEach(c => c.onclick = () => openTask(c.dataset.id));
  $$('[data-new]', el).forEach(b => b.onclick = () => openTask(null, {status:b.dataset.new}));
  enableDnD(el, '.ktask', '.col-body', (id, z) => { const t = taskById(id); if (t && t.status !== z.dataset.status) quickUpdate(t, {status:z.dataset.status}); });
}
function renderAgenda(el, list) {
  const f = TS(); if (!f.month) f.month = todayISO().slice(0, 7);
  const [y, m] = f.month.split('-').map(Number), today = todayISO();
  const byDate = {}; for (const t of list) if (t.due_date && t.due_date.slice(0, 7) === f.month) (byDate[t.due_date] ||= []).push(t);
  const days = Object.keys(byDate).sort(), noDue = list.filter(t => !t.due_date).length;
  const row = t => `<div class="mtask ${t.status === 'done' ? 'done' : ''}" data-id="${t.id}"><span class="sdot" style="--c:${PRIO[t.priority].color}"></span><div class="mt-main"><div class="t-title">${recurMark(t)}${t.due_time ? `<span class="time-tag">${t.due_time}</span>` : ''}${esc(t.title)}</div><div class="mt-meta">${t.item_id ? itemTag(t) : ''}${pill(STATUS[t.status].label, STATUS[t.status].color)}${subChip(t)}<span class="ml">${avatarStack(peopleOf(t), 24, 3)}</span></div></div></div>`;
  const dayHtml = d => { const dd = parseISO(d);
    return `<div class="agenda-day ${d === today ? 'today' : ''} ${d < today ? 'past' : ''}"><div class="ad-head"><b>${dd.getDate()}</b><span>${cap(WEEKDAYS[dd.getDay()])}${d === today ? ' · hoje' : ''}</span>${can('tasks.create') ? `<button class="add-day" data-add="${d}" title="Nova tarefa neste dia">${icon('plus', 14)}</button>` : ''}</div>${byDate[d].sort((a, b) => (a.status === 'done') - (b.status === 'done') || b.priority - a.priority).map(row).join('')}</div>`; };
  el.innerHTML = `<div class="agenda"><div class="cal-head"><button class="btn icon" data-nav="-1">${icon('chevL')}</button><h2 class="agenda-title">${cap(new Date(y, m - 1, 1).toLocaleDateString('pt-BR', {month:'long'}))} ${y}</h2><button class="btn icon" data-nav="1">${icon('chevR')}</button><button class="btn" data-nav="0">Hoje</button></div>
    ${days.length ? days.map(dayHtml).join('') : `<div class="card">${emptyState('Nada neste mês', 'Nenhuma tarefa com prazo neste mês para os filtros escolhidos.')}</div>`}
    ${noDue ? `<div class="foot-note">${plural(noDue, 'tarefa sem prazo não aparece', 'tarefas sem prazo não aparecem')} aqui.</div>` : ''}</div>`;
  const box = $('.agenda', el);
  box.onclick = e => {
    const nav = e.target.closest('[data-nav]');
    if (nav) { const n = +nav.dataset.nav; f.month = n === 0 ? todayISO().slice(0, 7) : toISO(new Date(y, m - 1 + n, 1)).slice(0, 7); savePrefs(); return renderTasksBody(); }
    const a = e.target.closest('[data-add]'); if (a) return openTask(null, {due_date:a.dataset.add});
    const t = e.target.closest('[data-id]'); if (t) openTask(t.dataset.id);
  };
}
function renderCalendar(el, list) {
  if (isMobile()) return renderAgenda(el, list);
  const f = TS(); if (!f.month) f.month = todayISO().slice(0, 7);
  const [y, m] = f.month.split('-').map(Number);
  const first = new Date(y, m - 1, 1), lastDay = new Date(y, m, 0).getDate();
  const weeks = Math.ceil((first.getDay() + lastDay) / 7), start = new Date(y, m - 1, 1 - first.getDay());
  const byDate = {}; for (const t of list) if (t.due_date) (byDate[t.due_date] ||= []).push(t);
  const noDue = list.filter(t => !t.due_date).length, today = todayISO();
  const colorOf = t => f.calColor === 'item' ? (t.item_color || '#94a3b8') : f.calColor === 'status' ? STATUS[t.status].color : PRIO[t.priority].color;
  const chip = t => `<div class="chip ${t.status === 'done' ? 'done' : ''} ${isLate(t) ? 'late' : ''}" draggable="${t.can_edit}" data-id="${t.id}" style="--c:${colorOf(t)}" title="${esc(t.title)} — ${esc(t.assignee_name || 'sem responsável')} · ${STATUS[t.status].label}">${t.due_time ? `<span class="ini">${t.due_time}</span>` : t.assignee_id ? `<span class="ini">${esc(initials(t.assignee_name))}</span>` : ''}${esc(t.title)}</div>`;
  let cells = '';
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const iso = toISO(d), ts = (byDate[iso] || []).sort((a, b) => (a.status === 'done') - (b.status === 'done') || b.priority - a.priority);
    const shown = ts.slice(0, 4), more = ts.length - shown.length;
    cells += `<div class="day ${d.getMonth() !== m - 1 ? 'other' : ''} ${iso === today ? 'today' : ''} ${d.getDay() % 6 === 0 ? 'weekend' : ''}" data-date="${iso}">
      <div class="day-top"><span class="dn">${d.getDate()}</span>${can('tasks.create') ? `<button class="add-day" data-add="${iso}" title="Nova tarefa com prazo neste dia">${icon('plus', 14)}</button>` : ''}</div>
      ${shown.map(chip).join('')}${more ? `<div class="more" data-more="${iso}">+${more} mais</div>` : ''}</div>`;
  }
  el.innerHTML = `<div class="cal-head"><button class="btn icon" data-nav="-1" title="Mês anterior">${icon('chevL')}</button><button class="btn icon" data-nav="1" title="Próximo mês">${icon('chevR')}</button>
      <h2>${cap(first.toLocaleDateString('pt-BR', {month:'long'}))} ${y}</h2><button class="btn" data-nav="0">Hoje</button>
      <div class="ml row"><span class="muted sm" style="font-weight:600">Cor por</span><div class="seg sm" id="calColor">${[['priority','Prioridade'],['item','Item'],['status','Status']].map(([v, l]) => `<button data-c="${v}" class="${f.calColor === v ? 'on' : ''}">${l}</button>`).join('')}</div></div></div>
    <div class="cal">${['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].map(w => `<div class="wd">${w}</div>`).join('')}${cells}</div>
    <div class="foot-note">As tarefas aparecem no dia do <b>prazo</b>. Arraste para mudar a data.${noDue ? ` · ${plural(noDue, 'tarefa sem prazo não aparece', 'tarefas sem prazo não aparecem')} aqui.` : ''}</div>`;
  $$('[data-nav]', el).forEach(b => b.onclick = () => {
    const n = +b.dataset.nav;
    f.month = n === 0 ? todayISO().slice(0, 7) : toISO(new Date(y, m - 1 + n, 1)).slice(0, 7); savePrefs(); renderTasksBody();
  });
  $$('#calColor button', el).forEach(b => b.onclick = () => { f.calColor = b.dataset.c; savePrefs(); renderTasksBody(); });
  $('.cal', el).onclick = e => {
    const c = e.target.closest('.chip'); if (c) return openTask(c.dataset.id);
    const a = e.target.closest('[data-add]'); if (a) return openTask(null, {due_date:a.dataset.add});
    const mo = e.target.closest('[data-more]');
    if (mo) showMenu(mo, byDate[mo.dataset.more].map(t => ({html:`<span class="sdot" style="--c:${colorOf(t)}"></span><span style="flex:1">${esc(t.title)}</span>`, onPick:() => openTask(t.id)})), fmtDate(mo.dataset.more, true));
  };
  enableDnD(el, '.chip', '.day', (id, z) => {
    const t = taskById(id), nd = z.dataset.date; if (!t || t.due_date === nd) return;
    const ch = {due_date:nd}; if (t.start_date && t.start_date > nd) ch.start_date = nd;
    quickUpdate(t, ch);
  });
}

// ───────── janela da tarefa ─────────
// Abre uma tarefa existente (id), uma nova (id = null) ou o modelo de uma repetição (series).
async function openTask(id, defaults = {}, series = null) {
  let t, comments = [], activity = [], subs = [];
  if (id) {
    try { const d = await call('tasks.get', {id}); t = d.task; comments = d.comments; activity = d.activity; subs = d.subtasks || []; }
    catch (e) { toast(e.message, 'err'); return; }
  } else if (series) {
    t = {id:null, title:series.title, description:series.description || '', item_id:series.item_id || '', assignee_id:series.assignee_id || '', members:[...series.members],
         priority:series.priority, status:'todo', start_date:'', due_date:series.start_date, due_time:series.due_time || '', progress:0, can_edit:series.can_edit, can_delete:false};
    subs = series.subtasks.map(x => ({...x}));
  } else {
    if (!can('tasks.create')) return toast('Você não tem permissão para criar tarefas.', 'err');
    const f = TS(), fu = f.user && !f.user.startsWith('__') ? f.user : null;
    t = {id:null, title:'', description:'', item_id:f.item || State.me.item_id || '', assignee_id:can('tasks.assign') ? (fu || State.me.id) : State.me.id, members:[],
         priority:2, status:'todo', start_date:'', due_date:'', due_time:'', progress:0, can_edit:true, can_delete:false, ...defaults};
  }
  const live = !!id;                       // etapas gravadas na hora (tarefa existente)
  const ro = !t.can_edit, dis = ro ? 'disabled' : '';
  const canAssign = can('tasks.assign') && !ro;
  const users = State.users.filter(u => u.active || u.id === t.assignee_id);
  const activeUsers = State.users.filter(u => u.active);
  let prio = t.priority, status = t.status, members = [...(t.members || [])];
  const rep = series ? {freq:series.freq, every:series.every, weekdays:[...series.weekdays], end_date:series.end_date || ''}
    : {freq:defaults.repeat || '', every:1, weekdays:[], end_date:''};
  const canRepeat = !id;                   // repetição se define ao criar (ou editando a série)
  const parent = t.recur_id ? seriesById(t.recur_id) : null;
  const banner = t.recur_id ? `<div class="recur-banner">${icon('repeat', 16)}<span>${parent ? `Faz parte de uma repetição: <b>${esc(freqText(parent))}</b>` : 'Esta tarefa veio de uma repetição que já foi encerrada.'}</span>${parent && parent.can_edit ? '<a id="tEditSeries">Editar repetição</a>' : ''}</div>` : '';
  const repeatHtml = canRepeat ? `<div class="field span2 repeat-box"><label>${icon('repeat', 13)} Repetir</label>
      <div class="row wrap"><select class="input" id="rFreq" ${dis} style="max-width:190px">${series ? '' : opt('', 'Não repete', rep.freq)}${opt('daily', 'Diariamente', rep.freq)}${opt('weekly', 'Semanalmente', rep.freq)}${opt('monthly', 'Mensalmente', rep.freq)}</select>
        <span class="rp-more row"><span class="muted sm">a cada</span><input class="input" type="number" min="1" max="12" id="rEvery" value="${rep.every}" style="width:70px" ${dis}><span class="muted sm" id="rUnit"></span></span></div>
      <div class="rp-more rp-week choice wd-choice" id="rDays">${WD_SHORT.map((w, i) => `<button type="button" data-d="${i}" style="--c:var(--accent)" class="${rep.weekdays.includes(i) ? 'on' : ''}" ${dis}>${w}</button>`).join('')}</div>
      <div class="rp-more row wrap"><span class="muted sm">Termina em</span><input type="date" class="input" id="rEnd" value="${rep.end_date}" style="max-width:180px" ${dis}><span class="hint" style="margin:0">vazio = sem fim · as próximas 8 semanas ficam sempre visíveis</span></div></div>` : '';
  const main = `${ro ? `<div class="readonly-note">${icon('lock', 16)} Somente leitura — você pode comentar${subs.some(s => s.assignee_id === State.me.id) ? ' e marcar as suas etapas' : ''}.</div>` : ''}${banner}
    <input class="title-input" id="tTitle" placeholder="O que precisa ser feito?" value="${esc(t.title)}" ${dis} ${id ? '' : 'autofocus'}>
    <div class="tm-grid">
      <div class="field"><label>${icon('layers', 13)} Item / subsistema</label><select class="input" id="tItem" ${dis}>${opt('', '— Sem item —', t.item_id)}${State.items.map(i => opt(i.id, i.name, t.item_id)).join('')}</select></div>
      <div class="field"><label>${icon('users', 13)} Responsável principal</label><select class="input" id="tAssignee" ${canAssign ? '' : 'disabled'}>${opt('', '— Sem responsável —', t.assignee_id)}${users.map(u => opt(u.id, u.full_name, t.assignee_id)).join('')}</select>${!can('tasks.assign') && !ro ? '<div class="hint">Seu cargo só permite tarefas para você mesmo.</div>' : ''}</div>
      <div class="field span2"><label>${icon('users', 13)} Apoio</label><div class="mpick" id="tMembers"></div></div>
      <div class="field span2"><label>${icon('flag', 13)} Prioridade</label><div class="choice" id="tPrio">${C.priorities.map(p => `<button type="button" data-v="${p.id}" style="--c:${p.color}" class="${p.id == prio ? 'on' : ''}" ${dis}>${p.label}</button>`).join('')}</div></div>
      <div class="field span2 no-rep"><label>${icon('refresh', 13)} Status</label><div class="choice" id="tStatus">${C.statuses.map(s => `<button type="button" data-v="${s.id}" style="--c:${s.color}" class="${s.id === status ? 'on' : ''}" ${dis}>${s.label}</button>`).join('')}</div></div>
      <div class="field no-rep"><label>${icon('calendar', 13)} Início</label><input type="date" class="input" id="tStart" value="${t.start_date || ''}" ${dis}></div>
      <div class="field"><label>${icon('clock', 13)} <span id="tDueLbl">Prazo</span></label><div class="row"><input type="date" class="input" id="tDue" value="${t.due_date || ''}" ${dis}><input type="time" class="input" id="tTime" value="${t.due_time || ''}" title="Horário (opcional)" style="max-width:120px" ${dis}></div></div>
      ${repeatHtml}
      <div class="field span2 no-rep"><label>Progresso · <span id="tProgVal" style="color:var(--accent)">${t.progress}%</span><span class="muted" id="tProgHint" style="text-transform:none;letter-spacing:0;font-weight:600"></span></label><input type="range" min="0" max="100" step="5" id="tProg" value="${t.progress}" ${dis}></div>
    </div>
    <div class="subs"><div class="subs-head">${icon('checklist', 15)}<b>Etapas</b><span class="muted sm" id="subCount"></span></div><div id="subList"></div>
      ${!ro ? `<div class="sub-add"><input class="input" id="subNew" placeholder="Adicionar etapa… (Enter)" maxlength="200"><select class="input" id="subWho" title="Responsável pela etapa">${opt('', 'Sem responsável', '')}${activeUsers.map(u => opt(u.id, shortName(u.full_name), '')).join('')}</select><button class="btn" id="subAddBtn" type="button">${icon('plus', 16)}</button></div>` : ''}</div>
    <div class="field"><label>Descrição</label><textarea class="input" id="tDesc" rows="4" placeholder="Detalhes, links, peças, medidas, referências…" ${dis}>${esc(t.description)}</textarea></div>`;
  const side = id ? `<div class="side"><div class="seg sm" id="sideTabs"><button data-t="c" class="on">${icon('chat', 14)} <span>Comentários (<span id="cCount">${comments.length}</span>)</span></button><button data-t="a">${icon('history', 14)} Histórico</button></div>
      <div class="side-list" id="sideC"></div><div class="side-list" id="sideA" hidden>${activity.map(a => `<div class="act"><span>${avatar(userById(a.user_id) || {id:a.user_id || 'x', full_name:a.user_name || '?'}, 22)}</span><span><b>${esc(shortName(a.user_name || '?'))}</b> · ${esc(a.detail)}</span><span class="when" title="${fmtDateTime(a.created_at)}">${timeAgo(a.created_at)}</span></div>`).join('') || '<p class="muted">Sem histórico.</p>'}</div>
      <div id="cBox"><textarea class="input" id="cText" rows="2" style="min-height:62px" placeholder="Escreva um comentário… (Ctrl+Enter envia)"></textarea><div class="row" style="margin-top:8px"><span class="meta-line">Criada por ${esc(t.creator_name || '—')} em ${fmtDateTime(t.created_at)}</span><button class="btn primary ml" id="cSend" style="height:32px">${icon('send', 15)} Enviar</button></div></div></div>` : '';
  const foot = `${id && t.can_delete ? `<button class="btn danger" id="tDel">${icon('trash', 16)} Excluir</button>` : ''}${series && series.can_edit ? `<button class="btn danger" id="tStop">${icon('x', 16)} Encerrar repetição</button>` : ''}<span class="spacer"></span>
    ${ro ? '<button class="btn" data-close>Fechar</button>' : `<span class="muted sm">Ctrl+Enter salva</span><button class="btn" data-close>Cancelar</button><button class="btn primary" id="tSave">${icon('check', 16)} ${id || series ? 'Salvar' : 'Criar tarefa'}</button>`}`;
  const m = openModal({title:series ? 'Repetição' : id ? 'Tarefa' : 'Nova tarefa', size:id ? 'wide' : 'mid', backdrop:false, body:`<div class="task-layout ${id ? '' : 'single'}"><div>${main}</div>${side}</div>`, foot});
  const q = m.q;
  const repeating = () => canRepeat && !!q('#rFreq').value;

  // ── apoio ──
  function renderMembers() {
    const assignee = q('#tAssignee').value;
    members = members.filter(x => x !== assignee);
    const chips = members.map(uid => { const u = userById(uid); if (!u) return '';
      return `<span class="mchip">${avatar(u, 22)}${esc(shortName(u.full_name))}${canAssign || (uid === State.me.id && !ro) ? `<button type="button" data-rm="${uid}" title="Tirar do apoio">${icon('x', 13)}</button>` : ''}</span>`; }).join('');
    let add = '';
    if (canAssign) {
      const avail = activeUsers.filter(u => u.id !== assignee && !members.includes(u.id));
      add = avail.length ? `<select class="input mini" id="mAdd"><option value="">+ Adicionar pessoa</option>${avail.map(u => opt(u.id, u.full_name, '')).join('')}</select>` : '';
    } else if (!ro && assignee !== State.me.id && !members.includes(State.me.id)) add = `<button type="button" class="btn sm-btn" id="mMe">${icon('plus', 14)} Quero ajudar</button>`;
    q('#tMembers').innerHTML = (chips + add) || '<span class="muted sm">Ninguém no apoio.</span>';
    if (q('#mAdd')) q('#mAdd').onchange = e => { if (e.target.value) { members.push(e.target.value); renderMembers(); } };
    if (q('#mMe')) q('#mMe').onclick = () => { members.push(State.me.id); renderMembers(); };
    $$('[data-rm]', q('#tMembers')).forEach(b => b.onclick = () => { members = members.filter(x => x !== b.dataset.rm); renderMembers(); });
  }
  q('#tAssignee').onchange = renderMembers;
  renderMembers();

  // ── etapas ──
  const canToggle = st => live && (!ro || st.assignee_id === State.me.id);
  function setProgress(p) { q('#tProg').value = p; q('#tProgVal').textContent = p + '%'; }
  function renderSubs() {
    const done = subs.filter(s => s.done).length;
    q('#subCount').textContent = subs.length ? (live ? `${done} de ${subs.length} concluídas` : plural(subs.length, 'etapa', 'etapas')) : '';
    q('#subList').innerHTML = subs.length ? subs.map((st, i) => { const u = userById(st.assignee_id);
      return `<div class="sub-row ${st.done ? 'done' : ''}" data-i="${i}">${live ? `<button type="button" class="check ${st.done ? 'on' : ''}" data-sact="toggle" ${canToggle(st) ? '' : 'disabled'} title="${st.done ? 'Reabrir etapa' : 'Concluir etapa'}">${icon('check', 12)}</button>` : `<span class="sub-dot"></span>`}
        <span class="sub-title">${esc(st.title)}</span>${u ? `<span class="sub-who" title="${esc(u.full_name)}">${avatar(u, 22)}<span>${esc(shortName(u.full_name))}</span></span>` : ''}
        ${!ro ? `<button type="button" class="btn ghost icon sub-del" data-sact="del" title="Remover etapa">${icon('x', 14)}</button>` : ''}</div>`; }).join('')
      : `<p class="muted sm" style="margin:2px 0 6px">${ro ? 'Sem etapas.' : 'Divida a tarefa em etapas: cada etapa concluída soma no progresso.'}</p>`;
    const auto = subs.length > 0;
    q('#tProg').disabled = ro || auto;
    q('#tProgHint').textContent = auto ? ' · calculado pelas etapas' : '';
    if (auto && !live) setProgress(status === 'done' ? 100 : 0);
  }
  async function subCall(name, payload) {
    try {
      const r = await call(name, payload);
      subs = r.subtasks; t.updated_at = r.task.updated_at; setProgress(r.task.progress);
      State.refreshPending = true; renderSubs();
    } catch (e) { toast(e.message, 'err'); }
  }
  q('#subList').onclick = e => {
    const b = e.target.closest('[data-sact]'); if (!b) return;
    const i = +b.closest('[data-i]').dataset.i, st = subs[i];
    if (b.dataset.sact === 'toggle') return subCall('subtasks.update', {id:st.id, changes:{done:!st.done}});
    if (b.dataset.sact === 'del') { if (live) return subCall('subtasks.delete', {id:st.id}); subs.splice(i, 1); renderSubs(); }
  };
  const addSub = () => {
    const title = q('#subNew').value.trim(); if (!title) return q('#subNew').focus();
    const who = q('#subWho').value || null;
    q('#subNew').value = ''; q('#subNew').focus();
    if (live) return subCall('subtasks.add', {task_id:t.id, title, assignee_id:who});
    subs.push({title, assignee_id:who}); renderSubs();
  };
  if (q('#subAddBtn')) { q('#subAddBtn').onclick = addSub; q('#subNew').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.ctrlKey) { e.preventDefault(); addSub(); } }); }
  renderSubs();

  // ── repetição ──
  function syncRepeat() {
    const on = repeating(), f = canRepeat ? q('#rFreq').value : '';
    $$('.no-rep', m.el).forEach(el => el.hidden = on);
    q('#tDueLbl').textContent = on ? 'Primeira data' : 'Prazo';
    if (!canRepeat) return;
    $$('.rp-more', m.el).forEach(el => el.hidden = !on);
    q('.rp-week').hidden = f !== 'weekly';
    const n = +q('#rEvery').value || 1;
    q('#rUnit').textContent = {daily:n > 1 ? 'dias' : 'dia', weekly:n > 1 ? 'semanas' : 'semana', monthly:n > 1 ? 'meses' : 'mês'}[f] || '';
    if (on && !q('#tDue').value) q('#tDue').value = todayISO();
  }
  if (canRepeat) {
    q('#rFreq').onchange = syncRepeat; q('#rEvery').oninput = syncRepeat;
    $$('#rDays button', m.el).forEach(b => b.onclick = () => b.classList.toggle('on'));
  }
  syncRepeat();
  if (q('#tEditSeries')) q('#tEditSeries').onclick = () => { m.close(); openTask(null, {}, parent); };

  $$('#tPrio button', m.el).forEach(b => b.onclick = () => { prio = +b.dataset.v; $$('#tPrio button', m.el).forEach(x => x.classList.toggle('on', x === b)); });
  $$('#tStatus button', m.el).forEach(b => b.onclick = () => {
    status = b.dataset.v; $$('#tStatus button', m.el).forEach(x => x.classList.toggle('on', x === b));
    if (status === 'done') setProgress(100);
    else if (subs.length) setProgress(live ? Math.round(subs.filter(s => s.done).length / subs.length * 100) : 0);
  });
  q('#tProg').oninput = () => q('#tProgVal').textContent = q('#tProg').value + '%';
  const save = async (force = false) => {
    const title = q('#tTitle').value;
    if (!title.trim()) { q('#tTitle').focus(); return toast('Dê um título para a tarefa.', 'err'); }
    const common = {title, item_id:q('#tItem').value || null, assignee_id:q('#tAssignee').value || null, members, priority:prio,
      due_time:q('#tTime').value || null, description:q('#tDesc').value};
    const b = q('#tSave'); b.disabled = true;
    try {
      if (repeating()) {
        if (!q('#tDue').value) { b.disabled = false; q('#tDue').focus(); return toast('Escolha a data da primeira ocorrência.', 'err'); }
        const r = await call('recur.save', {series:{...common, id:series ? series.id : null, subtasks:subs.map(s => ({title:s.title, assignee_id:s.assignee_id})),
          freq:q('#rFreq').value, every:+q('#rEvery').value || 1, weekdays:$$('#rDays button.on', m.el).map(x => +x.dataset.d),
          start_date:q('#tDue').value, end_date:q('#rEnd').value || null}});
        m.close(); toast(series ? 'Repetição atualizada' : `Repetição criada — ${plural(r.created, 'tarefa', 'tarefas')} no calendário 🔁`, 'ok'); await reload(); return;
      }
      const payload = {...common, id:t.id, status, start_date:q('#tStart').value || null, due_date:q('#tDue').value || null, progress:+q('#tProg').value};
      if (!id) payload.subtasks = subs;
      await call('tasks.save', {task:payload, expected_updated_at:t.updated_at, force});
      m.close(); toast(id ? 'Tarefa salva' : 'Tarefa criada ✨', 'ok'); await reload();
    } catch (e) {
      b.disabled = false;
      if (e.code === 'conflict') { if (await confirmDlg(e.message + ' Deseja sobrescrever com as suas alterações?', 'Sobrescrever')) save(true); }
      else toast(e.message, 'err');
    }
  };
  if (q('#tSave')) q('#tSave').onclick = () => save();
  m.el.addEventListener('keydown', e => { if (e.key === 'Enter' && e.ctrlKey && e.target.id !== 'cText' && q('#tSave')) { e.preventDefault(); save(); } });
  if (q('#tDel')) q('#tDel').onclick = async () => {
    if (!await confirmDlg(`Excluir a tarefa “${t.title}”?${t.recur_id ? ' (Só esta ocorrência; a repetição continua.)' : ''}`, 'Excluir', true)) return;
    try { await call('tasks.delete', {id:t.id}); m.close(); toast('Tarefa excluída'); await reload(); } catch (e) { toast(e.message, 'err'); }
  };
  if (q('#tStop')) q('#tStop').onclick = async () => {
    if (!await confirmDlg(`Encerrar a repetição “${series.title}”? As próximas ocorrências que ninguém mexeu serão removidas; as passadas e as já editadas ficam.`, 'Encerrar', true)) return;
    try { const r = await call('recur.stop', {id:series.id}); m.close(); toast(`Repetição encerrada${r.removed ? ` — ${plural(r.removed, 'ocorrência futura removida', 'ocorrências futuras removidas')}` : ''}`); await reload(); }
    catch (e) { toast(e.message, 'err'); }
  };
  if (id) {
    const renderComments = () => {
      const box = q('#sideC');
      box.innerHTML = comments.length ? comments.map(c => `<div class="comment">${avatar(userById(c.user_id) || {id:c.user_id || 'x', full_name:c.user_name || '?'}, 28)}<div class="bubble"><div class="meta"><b>${esc(shortName(c.user_name || '?'))}</b> · <span title="${fmtDateTime(c.created_at)}">${timeAgo(c.created_at)}</span></div><div class="txt">${esc(c.body)}</div></div></div>`).join('')
        : '<p class="muted" style="text-align:center;margin-top:24px">Nenhum comentário ainda.<br>Combine detalhes com a equipe aqui. 💬</p>';
      box.scrollTop = box.scrollHeight; q('#cCount').textContent = comments.length;
    };
    renderComments();
    $$('#sideTabs button', m.el).forEach(b => b.onclick = () => { $$('#sideTabs button', m.el).forEach(x => x.classList.toggle('on', x === b)); q('#sideC').hidden = b.dataset.t !== 'c'; q('#cBox').hidden = b.dataset.t !== 'c'; q('#sideA').hidden = b.dataset.t !== 'a'; });
    const send = async () => {
      const body = q('#cText').value.trim(); if (!body) return;
      try { comments.push(await call('comments.add', {task_id:t.id, body})); q('#cText').value = ''; renderComments(); } catch (e) { toast(e.message, 'err'); }
    };
    q('#cSend').onclick = send;
    q('#cText').addEventListener('keydown', e => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); send(); } });
  }
}

// Lista das repetições (reuniões ordinárias, revisões semanais…)
function openSeriesList() {
  const today = todayISO();
  const nextOf = r => State.tasks.filter(t => t.recur_id === r.id && t.status !== 'done' && t.due_date >= today).map(t => t.due_date).sort()[0];
  const rows = State.recurrences.map(r => { const nx = nextOf(r);
    return `<div class="series-row" data-sid="${r.id}"><div class="sico">${icon('repeat', 18)}</div><div class="mt-main"><div class="t-title">${esc(r.title)}</div>
      <div class="mt-meta"><span class="muted sm">${esc(freqText(r))}</span>${nx ? `<span class="sm">· próxima: <b>${fmtDate(nx)}</b></span>` : ''}</div></div>
      ${avatarStack([r.assignee_id, ...r.members].filter(Boolean), 24, 3)}${r.can_edit ? `<button class="btn ghost icon" data-sedit="${r.id}" title="Editar">${icon('edit', 16)}</button>` : ''}</div>`; }).join('');
  const m = openModal({title:'Repetições', size:'mid', body:rows ? `<div class="stack" style="gap:8px">${rows}</div><p class="hint">Cada repetição cria tarefas normais no calendário, sempre 8 semanas à frente. Marque cada ocorrência como concluída quando acontecer.</p>`
      : emptyState('Nenhuma repetição', 'Use para reuniões ordinárias, revisões semanais, checagens do carro… Crie uma tarefa e escolha “Repetir”.'),
    foot:`<span class="spacer"></span><button class="btn" data-close>Fechar</button>${can('tasks.create') ? `<button class="btn primary" id="sNew">${icon('plus', 16)} Nova repetição</button>` : ''}`});
  $$('[data-sedit]', m.el).forEach(b => b.onclick = () => { m.close(); openTask(null, {}, seriesById(b.dataset.sedit)); });
  if (m.q('#sNew')) m.q('#sNew').onclick = () => { m.close(); openTask(null, {repeat:'weekly'}); };
}

// ═══════════ MÓDULO: ITENS ═══════════
const SWATCHES = ['#ef4444','#f97316','#f59e0b','#eab308','#84cc16','#22c55e','#10b981','#14b8a6','#0ea5e9','#3b82f6','#6366f1','#8b5cf6','#a855f7','#ec4899','#64748b','#78716c'];
function swatchPicker(id, val) { return `<div class="swatches" id="${id}">${SWATCHES.map(c => `<button type="button" class="sw ${c === val ? 'on' : ''}" data-c="${c}" style="--c:${c}"></button>`).join('')}</div>`; }
function wireSwatches(root, id, cb) { $$(`#${id} .sw`, root).forEach(b => b.onclick = () => { $$(`#${id} .sw`, root).forEach(x => x.classList.toggle('on', x === b)); cb(b.dataset.c); }); }
registerModule({id:'items', title:'Itens', icon:'layers', section:'Trabalho', subtitle:'Subsistemas e frentes de trabalho do projeto',
  render(view, actions) {
    if (can('items.manage')) { actions.innerHTML = `<button class="btn primary" id="newItem">${icon('plus')} Novo item</button>`; $('#newItem').onclick = () => openItem(null); }
    if (!State.items.length) { view.innerHTML = `<div class="card">${emptyState('Nenhum item cadastrado', 'Crie itens como Suspensão, Freios, Powertrain…')}</div>`; return; }
    view.innerHTML = `<div class="grid-cards">${State.items.map(i => {
      const ts = State.tasks.filter(t => t.item_id === i.id), open = ts.filter(t => t.status !== 'done'), late = open.filter(isLate).length;
      const pct = ts.length ? Math.round((ts.length - open.length) / ts.length * 100) : 0, leader = userById(i.leader_id);
      const crew = State.users.filter(u => u.active && userItems(u).includes(i.id));
      return `<div class="card icard" style="--c:${i.color}"><div class="band"></div><div class="ib">
        <h3><span class="sq" style="width:11px;height:11px;border-radius:4px;background:${i.color}"></span>${esc(i.name)}</h3>
        ${i.description ? `<p>${esc(i.description)}</p>` : ''}
        <div class="row">${leader ? `${avatar(leader, 26)}<span class="sm"><span class="muted">Líder:</span> <b>${esc(shortName(leader.full_name))}</b></span>` : '<span class="muted sm">Sem líder definido</span>'}${crew.length ? `<span class="ml row" title="${esc(crew.map(u => u.full_name).join(', '))}">${avatarStack(crew.map(u => u.id), 22, 4)}</span>` : ''}</div>
        <div class="nums"><div><b>${open.length}</b><span>abertas</span></div><div><b class="${late ? 'red' : ''}">${late}</b><span>atrasadas</span></div><div><b>${ts.length - open.length}</b><span>concluídas</span></div></div>
        <div class="row"><div class="progress" style="flex:1;width:auto"><i style="width:${pct}%;background:${i.color}"></i></div><span class="sm muted" style="font-weight:700">${pct}%</span></div></div>
        <div class="if"><button class="btn" data-see="${i.id}">${icon('tasks', 16)} Ver tarefas</button>${can('items.manage') ? `<button class="btn ghost icon ml" data-edit="${i.id}" title="Editar">${icon('edit', 16)}</button>` : ''}</div></div>`;
    }).join('')}</div>`;
    $$('[data-see]', view).forEach(b => b.onclick = () => gotoTasks({item:b.dataset.see}));
    $$('[data-edit]', view).forEach(b => b.onclick = () => openItem(itemById(b.dataset.edit)));
  }});
function openItem(it) {
  const isNew = !it; it = it || {name:'', description:'', color:SWATCHES[Math.floor(Math.random() * SWATCHES.length)], leader_id:'', sort:State.items.length};
  let color = it.color;
  const m = openModal({title:isNew ? 'Novo item' : 'Editar item', body:`<div class="stack">
      <div class="field"><label>Nome</label><input class="input" id="iName" value="${esc(it.name)}" placeholder="ex.: Suspensão" autofocus></div>
      <div class="field"><label>Descrição</label><textarea class="input" id="iDesc" rows="3">${esc(it.description)}</textarea></div>
      <div class="grid2"><div class="field"><label>Líder</label><select class="input" id="iLeader">${opt('', '— Nenhum —', it.leader_id)}${State.users.filter(u => u.active).map(u => opt(u.id, u.full_name, it.leader_id)).join('')}</select><div class="hint">O líder pode editar todas as tarefas do item.</div></div>
      <div class="field"><label>Ordem no menu</label><input class="input" type="number" id="iSort" value="${it.sort || 0}"></div></div>
      <div class="field"><label>Cor</label>${swatchPicker('iColor', color)}</div></div>`,
    foot:`${!isNew ? `<button class="btn danger" id="iDel">${icon('trash', 16)} Excluir</button>` : ''}<span class="spacer"></span><button class="btn" data-close>Cancelar</button><button class="btn primary" id="iSave">Salvar</button>`});
  wireSwatches(m.el, 'iColor', c => color = c);
  m.q('#iSave').onclick = async () => {
    try { await call('items.save', {item:{id:it.id, name:m.q('#iName').value, description:m.q('#iDesc').value, leader_id:m.q('#iLeader').value || null, sort:+m.q('#iSort').value, color}}); m.close(); toast('Item salvo', 'ok'); await reload(); }
    catch (e) { toast(e.message, 'err'); }
  };
  if (m.q('#iDel')) m.q('#iDel').onclick = async () => {
    if (!await confirmDlg(`Excluir o item “${it.name}”?`, 'Excluir', true)) return;
    try { await call('items.delete', {id:it.id}); m.close(); toast('Item excluído'); await reload(); } catch (e) { toast(e.message, 'err'); }
  };
}

// ═══════════ MÓDULO: EQUIPE ═══════════
const canManageUser = u => can('users.manage') && (isAdmin() || ((u.role_level || 0) < State.level && u.id !== State.me.id));
const userItems = u => [u.item_id, u.item2_id, u.item3_id].filter(Boolean);
function userItemTags(u, small) {
  return userItems(u).map((id, k) => { const it = itemById(id); if (!it) return '';
    return `<span class="item-tag ${small ? 'sm' : ''} ${k ? 'sec' : ''}" style="--c:${it.color}" title="${k === 0 ? 'Item principal' : k === 1 ? 'Item secundário' : 'Item terciário'}"><span class="sq"></span>${esc(it.name)}</span>`; }).join('');
}
function captainCard() {
  const cap_ = State.users.find(u => u.active && u.badge === 'captain'), vice = State.users.find(u => u.active && u.badge === 'vice');
  if (!cap_ && !vice && !can('team.captain')) return '';
  const who = (u, b) => u ? `<div class="capt-who">${avatar(u, 40)}<div><span class="capt" style="--c:${BADGES[b].color}">${icon('crown', 13)}${BADGES[b].label}</span><b>${esc(u.full_name)}</b></div></div>`
    : `<div class="capt-who empty-capt"><div class="avatar ghost-av" style="width:40px;height:40px">?</div><div><span class="muted sm">${BADGES[b].label}</span><b class="muted">Não definido</b></div></div>`;
  return `<div class="card capt-card">${who(cap_, 'captain')}${who(vice, 'vice')}${can('team.captain') ? `<button class="btn ml" id="capBtn">${icon('crown', 16)} Nomear</button>` : ''}</div>`;
}
function openCaptain() {
  const act = State.users.filter(u => u.active), cur = b => (act.find(u => u.badge === b) || {}).id || '';
  const m = openModal({title:'Capitão e vice-capitão', body:`<div class="stack"><p class="muted" style="margin:0;line-height:1.5">É um título de destaque: aparece no perfil, na equipe e no organograma. As permissões continuam vindo do cargo.</p>
    <div class="field"><label>${icon('crown', 13)} Capitão</label><select class="input" id="cCap">${opt('', '— Ninguém —', cur('captain'))}${act.map(u => opt(u.id, u.full_name, cur('captain'))).join('')}</select></div>
    <div class="field"><label>${icon('crown', 13)} Vice-capitão</label><select class="input" id="cVice">${opt('', '— Ninguém —', cur('vice'))}${act.map(u => opt(u.id, u.full_name, cur('vice'))).join('')}</select></div></div>`,
    foot:`<span class="spacer"></span><button class="btn" data-close>Cancelar</button><button class="btn primary" id="cSave">Salvar</button>`});
  m.q('#cSave').onclick = async () => {
    try { await call('users.badge', {captain_id:m.q('#cCap').value || null, vice_id:m.q('#cVice').value || null}); m.close(); toast('Capitania atualizada 🏁', 'ok'); await reload(); }
    catch (e) { toast(e.message, 'err'); }
  };
}
const assignableRoles = () => State.roles.filter(r => isAdmin() || r.level < State.level);
registerModule({id:'team', title:'Equipe', icon:'users', section:'Equipe', subtitle:() => `${plural(State.users.filter(u => u.active).length, 'integrante ativo', 'integrantes ativos')}`,
  render(view, actions) {
    if (can('users.manage')) { actions.innerHTML = `<button class="btn primary" id="newUser">${icon('plus')} Novo integrante</button>`; $('#newUser').onclick = () => openUser(null); }
    const tab = State.prefs.teamTab || 'list';
    view.innerHTML = `<div id="captBox"></div><div class="toolbar"><div class="seg" id="teamTabs"><button data-t="list" class="${tab === 'list' ? 'on' : ''}">${icon('list', 16)}Integrantes</button><button data-t="org" class="${tab === 'org' ? 'on' : ''}">${icon('tree', 16)}Organograma</button></div>
      <div class="search">${icon('search', 16)}<input class="input" id="uQ" placeholder="Buscar integrante…"></div>
      <label class="inline-check"><input type="checkbox" id="uInactive"> Mostrar inativos</label></div><div id="teamBody"></div>`;
    $$('#teamTabs button').forEach(b => b.onclick = () => { State.prefs.teamTab = b.dataset.t; savePrefs(); $$('#teamTabs button').forEach(x => x.classList.toggle('on', x === b)); renderTeamBody(); });
    $('#uQ').oninput = debounce(renderTeamBody, 120); $('#uInactive').onchange = renderTeamBody;
    renderTeamBody();
  },
  refresh() { renderTeamBody(); }});
function renderTeamBody() {
  const el = $('#teamBody'); if (!el) return;
  const cb = $('#captBox'); if (cb) { cb.innerHTML = captainCard(); if ($('#capBtn')) $('#capBtn').onclick = openCaptain; }
  const q = ($('#uQ').value || '').toLowerCase(), showInactive = $('#uInactive').checked;
  const openOf = id => collapseRecur(State.tasks.filter(t => t.assignee_id === id && t.status !== 'done')).list;
  const users = State.users.filter(u => (showInactive || u.active) && (!q || `${u.full_name} ${u.username} ${u.role_name || ''}`.toLowerCase().includes(q)))
    .sort((a, b) => (b.role_level || 0) - (a.role_level || 0) || a.full_name.localeCompare(b.full_name));
  if ((State.prefs.teamTab || 'list') === 'org') {
    const active = State.users.filter(u => u.active), ids = new Set(active.map(u => u.id)), kids = {};
    active.forEach(u => { const k = u.manager_id && ids.has(u.manager_id) ? u.manager_id : '__root'; (kids[k] ||= []).push(u); });
    Object.values(kids).forEach(a => a.sort((x, y) => (y.role_level || 0) - (x.role_level || 0) || x.full_name.localeCompare(y.full_name)));
    const seen = new Set();
    const node = u => { if (seen.has(u.id)) return ''; seen.add(u.id);
      return `<li><div class="node" data-uid="${u.id}">${avatar(u, 36)}<div><b>${esc(u.full_name)} ${badgeHtml(u, true)}</b><div class="row" style="margin-top:3px">${rolePill(u)}${userItemTags(u, true)}</div></div><span class="cnt">${openOf(u.id).length} abertas</span></div>${(kids[u.id] || []).length ? `<ul>${kids[u.id].map(node).join('')}</ul>` : ''}</li>`; };
    el.innerHTML = `<div class="card" style="padding:20px;overflow:auto"><ul class="tree">${(kids.__root || []).map(node).join('')}</ul></div><div class="foot-note">O organograma é montado pelo campo “Superior direto” de cada integrante.</div>`;
    $$('.node', el).forEach(n => n.onclick = () => { const u = userById(n.dataset.uid); canManageUser(u) ? openUser(u) : gotoTasks({user:u.id}); });
    return;
  }
  if (isMobile()) {
    el.innerHTML = `<div class="mlist">${users.map(u => { const o = openOf(u.id), l = o.filter(isLate).length;
      return `<div class="mtask" data-uid="${u.id}">${avatar(u, 38)}<div class="mt-main"><div class="t-title">${esc(u.full_name)} ${badgeHtml(u, true)}${u.active ? '' : ' <span class="muted sm">(inativo)</span>'}</div><div class="mt-meta">${rolePill(u)}${userItemTags(u, true)}<span class="muted sm">${o.length} abertas${l ? ` · <span class="red">${l} atras.</span>` : ''}</span></div></div>${canManageUser(u) ? `<button class="btn ghost icon" data-edit="${u.id}" title="Editar">${icon('edit', 16)}</button>` : ''}</div>`; }).join('')}</div>`;
    $('.mlist', el).onclick = e => { const r = e.target.closest('[data-uid]'); if (!r) return; const u = userById(r.dataset.uid); if (e.target.closest('[data-edit]')) return openUser(u); gotoTasks({user:u.id}); };
    return;
  }
  el.innerHTML = `<div class="card table-wrap"><table class="tbl"><thead><tr><th class="nosort">Integrante</th><th class="nosort">Cargo</th><th class="nosort">Itens</th><th class="nosort">Superior</th><th class="nosort">Abertas</th><th class="nosort">Situação</th><th class="nosort"></th></tr></thead><tbody>
    ${users.map(u => { const mg = userById(u.manager_id), o = openOf(u.id), l = o.filter(isLate).length;
      return `<tr class="trow" data-uid="${u.id}"><td><div class="user-cell">${avatar(u, 34)}<div><b>${esc(u.full_name)}</b> ${badgeHtml(u)}<div class="muted sm">@${esc(u.username)}</div></div></div></td>
        <td>${rolePill(u)}</td><td><div class="item-stack">${userItemTags(u) || '<span class="muted">—</span>'}</div></td>
        <td>${mg ? userCell(mg.id) : '<span class="muted">—</span>'}</td><td><b>${o.length}</b>${l ? ` <span class="red sm">· ${l} atras.</span>` : ''}</td>
        <td>${u.active ? pill('Ativo', '#22c55e') : pill('Inativo', '#94a3b8')}</td>
        <td style="text-align:right;white-space:nowrap"><button class="btn ghost icon" data-tasks="${u.id}" title="Ver tarefas">${icon('tasks', 16)}</button>${canManageUser(u) ? `<button class="btn ghost icon" data-edit="${u.id}" title="Editar">${icon('edit', 16)}</button>` : ''}</td></tr>`; }).join('')}
    </tbody></table></div>`;
  $('tbody', el).onclick = e => {
    const r = e.target.closest('[data-uid]'); if (!r) return; const u = userById(r.dataset.uid);
    if (e.target.closest('[data-tasks]')) return gotoTasks({user:u.id});
    canManageUser(u) ? openUser(u) : gotoTasks({user:u.id});
  };
}
function openUser(u) {
  const isNew = !u, roles = assignableRoles();
  if (isNew) { const def = [...roles].sort((a, b) => a.level - b.level).find(r => /integrante/i.test(r.name)) || roles[roles.length - 1]; u = {full_name:'', username:'', email:'', role_id:def ? def.id : '', manager_id:State.me.id, item_id:'', active:1}; }
  const roleOpts = State.roles.filter(r => roles.includes(r) || r.id === u.role_id).map(r => `<option value="${r.id}" ${r.id === u.role_id ? 'selected' : ''} ${roles.includes(r) ? '' : 'disabled'}>${esc(r.name)} (nível ${r.level})</option>`).join('');
  const m = openModal({title:isNew ? 'Novo integrante' : 'Editar integrante', size:'mid', body:`<div class="grid2">
      <div class="field span2"><label>Nome completo</label><input class="input" id="uName" value="${esc(u.full_name)}" autofocus></div>
      <div class="field"><label>Usuário (login)</label><input class="input" id="uUser" value="${esc(u.username)}" placeholder="ex.: maria.souza" spellcheck="false"></div>
      <div class="field"><label>E-mail (opcional)</label><input class="input" id="uEmail" value="${esc(u.email || '')}"></div>
      <div class="field"><label>Cargo</label><select class="input" id="uRole">${roleOpts}</select></div>
      <div class="field"><label>Superior direto</label><select class="input" id="uMgr">${opt('', '— Nenhum —', u.manager_id)}${State.users.filter(x => x.active && x.id !== u.id).map(x => opt(x.id, x.full_name, u.manager_id)).join('')}</select></div>
      <div class="field"><label>Item principal</label><select class="input" id="uItem">${opt('', '— Nenhum —', u.item_id)}${State.items.map(i => opt(i.id, i.name, u.item_id)).join('')}</select></div>
      <div class="field"><label>Item secundário</label><select class="input" id="uItem2">${opt('', '— Nenhum —', u.item2_id)}${State.items.map(i => opt(i.id, i.name, u.item2_id)).join('')}</select></div>
      <div class="field"><label>Item terciário</label><select class="input" id="uItem3">${opt('', '— Nenhum —', u.item3_id)}${State.items.map(i => opt(i.id, i.name, u.item3_id)).join('')}</select></div>
      <div class="field"><label>${isNew ? 'Senha inicial' : 'Redefinir senha'}</label><input class="input" type="text" id="uPw" placeholder="${isNew ? 'mín. 6 caracteres' : 'deixe vazio para manter'}" spellcheck="false"><div class="hint">O integrante troca a senha no próximo acesso.</div></div>
      ${!isNew ? `<label class="switch span2"><input type="checkbox" id="uActive" ${u.active ? 'checked' : ''}><span class="lbl"><b>Acesso ativo</b><small>Desative quem saiu da equipe (o histórico é mantido).</small></span></label>` : ''}</div>`,
    foot:`<span class="spacer"></span><button class="btn" data-close>Cancelar</button><button class="btn primary" id="uSave">Salvar</button>`});
  m.q('#uSave').onclick = async () => {
    const user = {id:u.id, full_name:m.q('#uName').value, username:m.q('#uUser').value, email:m.q('#uEmail').value, role_id:m.q('#uRole').value,
      manager_id:m.q('#uMgr').value || null, item_id:m.q('#uItem').value || null, item2_id:m.q('#uItem2').value || null, item3_id:m.q('#uItem3').value || null, password:m.q('#uPw').value, active:isNew ? true : m.q('#uActive').checked};
    try { await call('users.save', {user}); m.close(); toast(isNew ? 'Integrante cadastrado 🎉' : 'Integrante atualizado', 'ok'); await reload(); } catch (e) { toast(e.message, 'err'); }
  };
}

// ═══════════ MÓDULO: CARGOS ═══════════
const canEditRole = r => can('roles.manage') && (isAdmin() || r.level < State.level);
registerModule({id:'roles', title:'Cargos', icon:'shield', section:'Equipe', subtitle:'Hierarquia e permissões', visible:() => can('roles.manage'),
  render(view, actions) {
    actions.innerHTML = `<button class="btn primary" id="newRole">${icon('plus')} Novo cargo</button>`; $('#newRole').onclick = () => openRole(null);
    view.innerHTML = `<div class="card info-card"><div class="sico">${icon('info', 20)}</div><div><b>Como funciona a hierarquia</b><p>Cada cargo tem um <b>nível</b>. Quem gerencia integrantes ou cargos só consegue mexer em quem está <b>abaixo</b> do próprio nível, e não pode dar permissões que não tem. O seu nível é <b>${State.level}</b>.</p></div></div>
      <div class="grid-cards">${State.roles.map(r => `<div class="card icard" style="--c:${r.color}"><div class="band"></div><div class="ib">
        <h3>${pill(r.name, r.color)}<span class="ml muted sm">Nível ${r.level}</span></h3>
        <div class="muted sm">${plural(r.user_count, 'integrante', 'integrantes')}</div>
        <div class="chiplist">${r.permissions.length ? r.permissions.map(p => `<span class="tag">${esc(PERM_LABEL[p] || p)}</span>`).join('') : '<span class="muted sm">Sem permissões extras</span>'}</div></div>
        ${canEditRole(r) ? `<div class="if"><button class="btn" data-edit="${r.id}">${icon('edit', 16)} Editar</button></div>` : `<div class="if"><span class="muted sm">${icon('lock', 14)} Nível igual ou acima do seu</span></div>`}</div>`).join('')}</div>`;
    $$('[data-edit]', view).forEach(b => b.onclick = () => openRole(State.roles.find(r => r.id === b.dataset.edit)));
  }});
function openRole(r) {
  const isNew = !r; r = r || {name:'', level:Math.max(1, Math.min(20, State.level - 1)), color:'#3b82f6', permissions:['tasks.view_all', 'tasks.create'], user_count:0};
  let color = r.color;
  const m = openModal({title:isNew ? 'Novo cargo' : 'Editar cargo', size:'mid', body:`<div class="grid2">
      <div class="field"><label>Nome do cargo</label><input class="input" id="rName" value="${esc(r.name)}" autofocus></div>
      <div class="field"><label>Nível hierárquico</label><input class="input" type="number" min="1" max="999" id="rLevel" value="${r.level}"><div class="hint">Maior = mais alto. ${isAdmin() ? '' : `Precisa ser menor que ${State.level}.`}</div></div>
      <div class="field span2"><label>Cor</label>${swatchPicker('rColor', color)}</div>
      <div class="field span2"><label>Permissões</label><div class="stack" style="gap:8px">${C.permissions.map(p => { const lock = !isAdmin() && !can(p.id);
        return `<label class="switch ${lock ? 'dis' : ''}"><input type="checkbox" data-perm="${p.id}" ${r.permissions.includes(p.id) ? 'checked' : ''} ${lock ? 'disabled' : ''}><span class="lbl"><b>${esc(p.label)}</b><small>${p.id}</small></span></label>`; }).join('')}</div></div></div>`,
    foot:`${!isNew ? `<button class="btn danger" id="rDel">${icon('trash', 16)} Excluir</button>` : ''}<span class="spacer"></span><button class="btn" data-close>Cancelar</button><button class="btn primary" id="rSave">Salvar</button>`});
  wireSwatches(m.el, 'rColor', c => color = c);
  m.q('#rSave').onclick = async () => {
    const role = {id:r.id, name:m.q('#rName').value, level:+m.q('#rLevel').value, color, permissions:$$('[data-perm]', m.el).filter(x => x.checked).map(x => x.dataset.perm)};
    try { await call('roles.save', {role}); m.close(); toast('Cargo salvo', 'ok'); await reload(); } catch (e) { toast(e.message, 'err'); }
  };
  if (m.q('#rDel')) m.q('#rDel').onclick = async () => {
    if (!await confirmDlg(`Excluir o cargo “${r.name}”?`, 'Excluir', true)) return;
    try { await call('roles.delete', {id:r.id}); m.close(); toast('Cargo excluído'); await reload(); } catch (e) { toast(e.message, 'err'); }
  };
}

// ═══════════ MÓDULO: SISTEMA ═══════════
registerModule({id:'system', title:'Sistema', icon:'db', section:'Administração', subtitle:'Situação e backups', visible:isAdmin,
  async render(view) {
    view.innerHTML = '<p class="muted">Carregando…</p>';
    let s; try { s = await call('system.status'); } catch (e) { view.innerHTML = `<p class="red">${esc(e.message)}</p>`; return; }
    view.innerHTML = `<div class="dash">
      <div class="card"><div class="card-h"><h3>${icon('db', 18)} Banco de dados</h3></div><div class="card-b"><dl class="kv">
        <dt>Onde fica</dt><dd>Cloudflare D1 (SQLite na nuvem)</dd>
        <dt>Registros</dt><dd>${s.counts.tasks} tarefas · ${s.counts.comments} comentários · ${s.counts.users} integrantes · ${s.counts.items} itens · ${s.counts.posts ?? 0} recados · ${s.counts.series ?? 0} repetições</dd>
        <dt>Sessões ativas</dt><dd>${s.counts.sessions}</dd><dt>Alterações</dt><dd>${esc(s.data_version)}</dd><dt>Versão</dt><dd>${esc(s.version)}</dd></dl></div></div>
      <div class="card"><div class="card-h"><h3>${icon('history', 18)} Backups</h3></div><div class="card-b">
        <p class="muted" style="margin-top:0;line-height:1.55">A Cloudflare guarda sozinha o histórico dos <b>últimos 7 dias</b> (dá para voltar o banco a qualquer minuto desse período). Para guardar por mais tempo, baixe um backup completo de vez em quando — sugestão: toda semana, numa pasta do Drive.</p>
        <button class="btn primary" id="doBk">${icon('download', 16)} Baixar backup completo (.sql)</button>
        <p class="hint">O arquivo contém os dados de todos e os hashes das senhas. Guarde em local seguro.</p></div></div></div>`;
    $('#doBk').onclick = async () => {
      try { const r = await call('system.backup'); download(r.filename, r.content, 'application/sql'); toast('Backup baixado', 'ok'); } catch (e) { toast(e.message, 'err'); }
    };
  }});

// ───────── perfil ─────────
function openProfile() {
  const me = State.me, t = State.prefs.theme || 'system';
  const m = openModal({title:'Meu perfil', size:'mid', body:`<div class="row" style="gap:14px;margin-bottom:18px">${avatar(me, 56)}<div><b style="font-size:17px">${esc(me.full_name)}</b><div class="muted row" style="flex-wrap:wrap">@${esc(me.username)} · ${rolePill(me)}${badgeHtml(me)}</div></div></div>
    <div class="grid2"><div class="field"><label>Nome completo</label><input class="input" id="pName" value="${esc(me.full_name)}"></div>
    <div class="field"><label>E-mail</label><input class="input" id="pEmail" value="${esc(me.email || '')}"></div>
    <div class="field span2"><label>Tema</label><div class="seg" id="pTheme">${[['system','monitor','Automático'],['light','sun','Claro'],['dark','moon','Escuro']].map(([v, ic, l]) => `<button data-v="${v}" class="${t === v ? 'on' : ''}">${icon(ic, 15)}${l}</button>`).join('')}</div></div>
    <div class="span2" style="border-top:1px solid var(--border);margin-top:6px;padding-top:14px"><b>Trocar senha</b></div>
    <div class="field"><label>Senha atual</label><input class="input" type="password" id="pOld"></div><div></div>
    <div class="field"><label>Nova senha</label><input class="input" type="password" id="pNew"></div><div class="field"><label>Confirmar</label><input class="input" type="password" id="pNew2"></div></div>`,
    foot:`<span class="spacer"></span><button class="btn" data-close>Fechar</button><button class="btn primary" id="pSave">Salvar</button>`});
  $$('#pTheme button', m.el).forEach(b => b.onclick = () => { State.prefs.theme = b.dataset.v; applyTheme(); savePrefs(); $$('#pTheme button', m.el).forEach(x => x.classList.toggle('on', x === b)); });
  m.q('#pSave').onclick = async () => {
    try {
      if (m.q('#pName').value !== me.full_name || m.q('#pEmail').value !== (me.email || '')) await call('auth.update_profile', {full_name:m.q('#pName').value, email:m.q('#pEmail').value});
      if (m.q('#pNew').value) {
        if (m.q('#pNew').value !== m.q('#pNew2').value) return toast('As novas senhas não conferem.', 'err');
        await call('auth.change_password', {old:m.q('#pOld').value, new:m.q('#pNew').value});
      }
      m.close(); toast('Perfil salvo', 'ok'); await reload();
    } catch (e) { toast(e.message, 'err'); }
  };
}
function forcePasswordChange() {
  const m = openModal({title:'Crie a sua senha 🔐', dismissable:false, body:`<p class="muted" style="margin-top:0">Esta é uma senha temporária. Escolha uma senha só sua para continuar.</p>
    <div class="stack"><div class="field"><label>Nova senha</label><input class="input" type="password" id="fNew" autofocus></div><div class="field"><label>Confirmar</label><input class="input" type="password" id="fNew2"></div></div>`,
    foot:`<span class="spacer"></span><button class="btn primary" id="fSave">Salvar senha</button>`});
  m.q('#fSave').onclick = async () => {
    if (m.q('#fNew').value !== m.q('#fNew2').value) return toast('As senhas não conferem.', 'err');
    try { await call('auth.change_password', {new:m.q('#fNew').value}); m.close(); State.me.must_change_pw = 0; toast('Senha criada!', 'ok'); } catch (e) { toast(e.message, 'err'); }
  };
}

boot();
