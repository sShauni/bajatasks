// ════════════════════════════════════════════════════════════════════════════
//  BAJA DE GALPÃO TASKS — backend (Cloudflare Worker + D1/SQLite)
// ════════════════════════════════════════════════════════════════════════════
//  • A interface (public/) é servida como arquivos estáticos; /api/* cai aqui.
//  • Todas as chamadas são POST /api/<nome> com JSON e cabeçalho X-Requested-With: bt.
//  • Login por cookie de sessão (HttpOnly, Secure, SameSite=Strict). O banco guarda só o hash.
//  • Toda gravação incrementa meta.data_version; o app consulta só esse número para saber
//    se precisa recarregar (consulta barata, cabe no plano grátis).
//
//  Como adicionar um módulo novo
//  ─────────────────────────────
//  1. Banco: crie migrations/000N_nome.sql (nunca altere migrações já aplicadas).
//  2. Backend: api('modulo.acao', { perm: 'permissao' }, async ({ env, ctx, p }) => { … });
//     Se gravar algo, inclua bump(env) para os outros aparelhos atualizarem.
//  3. Permissão nova? Adicione em PERMISSIONS (o admin liga nos cargos).
//  4. Interface (public/app.js): registerModule({ id, title, icon, section, visible, render, refresh }).
// ════════════════════════════════════════════════════════════════════════════

const APP_NAME = 'Baja de Galpão Tasks';
const APP_VERSION = '2.0.0';
// Iterações do PBKDF2. O plano grátis limita a CPU por requisição (10 ms), então o valor é
// menor que o ideal; o limite de tentativas de login compensa. O número fica gravado em cada
// hash, então dá para aumentar no futuro sem quebrar as senhas existentes.
const PBKDF2_ITER = 20000;
const SESSION_DAYS = 30;
const MAX_FAILS_USER = 5;
const MAX_FAILS_IP = 30;
const LOCK_MINUTES = 15;

const STATUSES = [
  { id: 'todo', label: 'A fazer', color: '#64748b' },
  { id: 'doing', label: 'Em andamento', color: '#3b82f6' },
  { id: 'review', label: 'Em revisão', color: '#a855f7' },
  { id: 'blocked', label: 'Bloqueada', color: '#ef4444' },
  { id: 'done', label: 'Concluída', color: '#22c55e' },
];
const PRIORITIES = [
  { id: 1, label: 'Baixa', color: '#10b981' },
  { id: 2, label: 'Média', color: '#eab308' },
  { id: 3, label: 'Alta', color: '#f97316' },
  { id: 4, label: 'Urgente', color: '#ef4444' },
];
const PERMISSIONS = [
  { id: 'tasks.view_all', label: 'Ver tarefas de toda a equipe' },
  { id: 'tasks.create', label: 'Criar tarefas' },
  { id: 'tasks.assign', label: 'Atribuir tarefas a outros integrantes' },
  { id: 'tasks.edit_all', label: 'Editar qualquer tarefa' },
  { id: 'tasks.delete', label: 'Excluir qualquer tarefa' },
  { id: 'items.manage', label: 'Gerenciar itens / subsistemas' },
  { id: 'users.manage', label: 'Gerenciar integrantes (abaixo do seu nível)' },
  { id: 'roles.manage', label: 'Gerenciar cargos e hierarquia' },
  { id: 'system.admin', label: 'Administração do sistema (backups)' },
];
const STATUS_LABEL = Object.fromEntries(STATUSES.map(x => [x.id, x.label]));
const PRIO_LABEL = Object.fromEntries(PRIORITIES.map(x => [x.id, x.label]));
const PERM_IDS = PERMISSIONS.map(x => x.id);
const CONST = { app: APP_NAME, version: APP_VERSION, statuses: STATUSES, priorities: PRIORITIES, permissions: PERMISSIONS };

// ── utilitários ─────────────────────────────────────────────────────────────
class ApiError extends Error {
  constructor(msg, code = 'error', data = null) { super(msg); this.code = code; this.data = data; }
}
const forbidden = msg => new ApiError(msg || 'Você não tem permissão para isso.', 'forbidden');
const nowIso = () => new Date().toISOString();
const newId = () => crypto.randomUUID().replaceAll('-', '');
const s = (v, max = 500) => (v == null ? '' : String(v).trim()).slice(0, max);
const enc = new TextEncoder();
const toHex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const fromHex = h => new Uint8Array((h.match(/../g) || []).map(x => parseInt(x, 16)));
const randHex = n => toHex(crypto.getRandomValues(new Uint8Array(n)));
const sha256hex = async str => toHex(await crypto.subtle.digest('SHA-256', enc.encode(str)));
const norm = v => (v === null || v === undefined || v === '') ? '' : String(v);
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;
const USERNAME_MSG = 'O usuário deve ter de 3 a 32 caracteres: letras minúsculas sem acento, números, ponto, hífen ou _.';

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
async function hashPw(pw, saltHex = randHex(16), iter = PBKDF2_ITER) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(saltHex), iterations: iter }, key, 256);
  return `pbkdf2$${iter}$${saltHex}$${toHex(bits)}`;
}
async function verifyPw(pw, stored) {
  const p = String(stored || '').split('$');
  if (p.length !== 4 || p[0] !== 'pbkdf2') return false;
  return safeEqual(await hashPw(pw, p[2], +p[1]), stored);
}
function optDate(v) {
  if (!v) return null;
  const d = String(v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || isNaN(Date.parse(d + 'T00:00:00Z'))) throw new ApiError('Data inválida.');
  return d;
}
const brDate = iso => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };

// ── banco ───────────────────────────────────────────────────────────────────
const q = (env, sql, ...args) => env.DB.prepare(sql).bind(...args);
const all = async (env, sql, ...args) => (await q(env, sql, ...args).all()).results;
const first = (env, sql, ...args) => q(env, sql, ...args).first();
const bump = env => env.DB.prepare("UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'data_version'");
async function optRef(env, table, v) {
  if (!v) return null;
  if (!(await first(env, `SELECT 1 AS x FROM ${table} WHERE id = ? AND deleted = 0`, v)))
    throw new ApiError('Referência inválida (registro não encontrado ou excluído).');
  return v;
}

// ── sessão e permissões ─────────────────────────────────────────────────────
class Ctx {
  constructor(row, sid) {
    this.user = row; this.id = row.id; this.sid = sid;
    this.level = row.r_level || 0;
    this.perms = new Set(row.r_perms ? JSON.parse(row.r_perms) : []);
  }
  can(p) { return this.perms.has(p); }
  require(p) { if (!this.can(p)) throw forbidden(); }
  get admin() { return this.can('system.admin'); }
}
function getCookie(req, name) {
  for (const part of (req.headers.get('Cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}
const cookie = (val, maxAge) => `bt_session=${val}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
async function loadSession(env, req) {
  const tok = getCookie(req, 'bt_session');
  if (!tok || !/^[0-9a-f]{64}$/.test(tok)) return null;
  const sid = await sha256hex(tok);
  const row = await first(env, `SELECT s.expires_at, u.*, r.level AS r_level, r.permissions AS r_perms
      FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN roles r ON r.id = u.role_id AND r.deleted = 0
      WHERE s.id = ?`, sid);
  if (!row || row.expires_at < nowIso() || !row.active || row.deleted) return null;
  return new Ctx(row, sid);
}
async function createSession(env, res, userId) {
  const token = randHex(32);
  const now = nowIso();
  await env.DB.batch([
    q(env, 'DELETE FROM sessions WHERE expires_at < ?', now),
    q(env, 'INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
      await sha256hex(token), userId, now, new Date(Date.now() + SESSION_DAYS * 864e5).toISOString()),
  ]);
  res.headers.append('Set-Cookie', cookie(token, SESSION_DAYS * 86400));
}
const canManageLevel = (ctx, level) => ctx.admin || (level || 0) < ctx.level;
const canViewTask = (ctx, t) => ctx.can('tasks.view_all') || [t.assignee_id, t.created_by, t.item_leader].includes(ctx.id);
const canEditTask = (ctx, t) => ctx.can('tasks.edit_all') || [t.assignee_id, t.created_by, t.item_leader].includes(ctx.id);
const canDeleteTask = (ctx, t) => ctx.can('tasks.delete') || t.created_by === ctx.id;

// Quantos administradores ativos sobram, ignorando um usuário e/ou um cargo.
async function activeAdmins(env, { exceptUser = null, exceptRole = null } = {}) {
  const rows = await all(env, `SELECT u.id, r.id AS rid, r.permissions FROM users u JOIN roles r ON r.id = u.role_id
                               WHERE u.deleted = 0 AND u.active = 1 AND r.deleted = 0`);
  return rows.filter(x => x.id !== exceptUser && x.rid !== exceptRole && JSON.parse(x.permissions).includes('system.admin')).length;
}

// ── roteador ────────────────────────────────────────────────────────────────
const API = {};
function api(name, opts, fn) { API[name] = { auth: true, perm: null, ...opts, fn }; }

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
function json(body, status = 200, extra) {
  const h = new Headers(JSON_HEADERS);
  if (extra) for (const [k, v] of extra) h.append(k, v);
  return new Response(JSON.stringify(body), { status, headers: h });
}

async function handleApi(req, env, name) {
  if (req.method !== 'POST') return json({ ok: false, error: 'Método não permitido.' }, 405);
  if (req.headers.get('X-Requested-With') !== 'bt' || req.headers.get('Sec-Fetch-Site') === 'cross-site')
    return json({ ok: false, error: 'Requisição recusada.' }, 403);
  const ep = API[name];
  if (!ep) return json({ ok: false, error: 'Ação desconhecida.' }, 404);
  let p = {};
  try { p = (await req.json()) || {}; } catch { p = {}; }
  const res = { headers: new Headers() };
  try {
    let ctx = null;
    if (ep.auth) {
      ctx = await loadSession(env, req);
      if (!ctx) throw new ApiError('Sua sessão terminou. Entre novamente.', 'auth');
      if (ep.perm) ctx.require(ep.perm);
    }
    const data = await ep.fn({ env, ctx, p, req, res });
    return json({ ok: true, data }, 200, res.headers);
  } catch (e) {
    if (e instanceof ApiError) return json({ ok: false, error: e.message, code: e.code, data: e.data }, 200, res.headers);
    console.error('api', name, e && e.stack || e);
    const busy = /busy|locked|overloaded/i.test(String(e && e.message));
    return json({ ok: false, code: 'internal',
      error: busy ? 'O servidor está ocupado. Tente de novo em alguns segundos.' : 'Erro inesperado no servidor. Tente novamente.' });
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) return handleApi(req, env, url.pathname.slice(5));
    return env.ASSETS.fetch(req);
  },
};

// ════════════════════════════════════════════════════════════════════════════
//  SISTEMA / LOGIN
// ════════════════════════════════════════════════════════════════════════════
api('sys.info', { auth: false }, async ({ env, req }) => {
  const n = await first(env, 'SELECT COUNT(*) AS n FROM users WHERE deleted = 0');
  const ctx = n.n ? await loadSession(env, req) : null;
  return { needs_setup: n.n === 0, logged: !!ctx, version: APP_VERSION, const: CONST };
});

api('sys.poll', {}, async ({ env }) => {
  const r = await first(env, "SELECT value FROM meta WHERE key = 'data_version'");
  return { v: r ? r.value : '0' };
});

api('sys.setup', { auth: false }, async ({ env, p, res }) => {
  const full_name = s(p.full_name, 120), username = s(p.username, 32).toLowerCase(), pw = String(p.password || '');
  if (!full_name) throw new ApiError('Informe seu nome.');
  if (!USERNAME_RE.test(username)) throw new ApiError(USERNAME_MSG);
  if (pw.length < 6) throw new ApiError('A senha precisa ter pelo menos 6 caracteres.');
  const role = await first(env, 'SELECT id, permissions FROM roles WHERE deleted = 0 ORDER BY level DESC LIMIT 1');
  if (!role || !JSON.parse(role.permissions).includes('system.admin')) throw new ApiError('Nenhum cargo de administrador encontrado.');
  const uid = newId(), now = nowIso();
  const r = await q(env, `INSERT INTO users (id, username, full_name, pw_hash, role_id, active, must_change_pw, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?, 1, 0, ?, ? WHERE NOT EXISTS (SELECT 1 FROM users WHERE deleted = 0)`,
    uid, username, full_name, await hashPw(pw), role.id, now, now).run();
  if (!r.meta.changes) throw new ApiError('O sistema já foi configurado.');
  await bump(env).run();
  await createSession(env, res, uid);
  return true;
});

async function checkLock(env, keys) {
  for (const k of keys) {
    const r = await first(env, 'SELECT fails, first_at FROM login_attempts WHERE key = ?', k.key);
    if (r && r.fails >= k.max && Date.now() - Date.parse(r.first_at) < LOCK_MINUTES * 60e3)
      throw new ApiError(`Muitas tentativas de login. Aguarde ${LOCK_MINUTES} minutos e tente de novo.`, 'locked');
  }
}
async function registerFail(env, keys) {
  const now = nowIso(), cutoff = new Date(Date.now() - LOCK_MINUTES * 60e3).toISOString();
  await env.DB.batch(keys.map(k => q(env, `INSERT INTO login_attempts (key, fails, first_at) VALUES (?, 1, ?)
      ON CONFLICT(key) DO UPDATE SET
        fails = CASE WHEN login_attempts.first_at < ? THEN 1 ELSE login_attempts.fails + 1 END,
        first_at = CASE WHEN login_attempts.first_at < ? THEN excluded.first_at ELSE login_attempts.first_at END`,
    k.key, now, cutoff, cutoff)));
}

api('auth.login', { auth: false }, async ({ env, p, req, res }) => {
  const username = s(p.username, 64).toLowerCase(), pw = String(p.password || '');
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  const keys = [{ key: 'u:' + username, max: MAX_FAILS_USER }, { key: 'ip:' + ip, max: MAX_FAILS_IP }];
  await checkLock(env, keys);
  const u = await first(env, 'SELECT * FROM users WHERE lower(username) = ? AND deleted = 0', username);
  let ok = false;
  if (u) ok = await verifyPw(pw, u.pw_hash);
  else await hashPw(pw); // mesmo custo, para não revelar se o usuário existe
  if (!ok) { await registerFail(env, keys); throw new ApiError('Usuário ou senha incorretos.'); }
  if (!u.active) throw new ApiError('Seu acesso está desativado. Fale com um gerente.');
  await q(env, 'DELETE FROM login_attempts WHERE key = ?', keys[0].key).run();
  await createSession(env, res, u.id);
  return true;
});

api('auth.logout', { auth: false }, async ({ env, req, res }) => {
  const tok = getCookie(req, 'bt_session');
  if (tok) await q(env, 'DELETE FROM sessions WHERE id = ?', await sha256hex(tok)).run();
  res.headers.append('Set-Cookie', cookie('', 0));
  return true;
});

api('auth.change_password', {}, async ({ env, ctx, p }) => {
  const nw = String(p.new || '');
  if (nw.length < 6) throw new ApiError('A nova senha precisa ter pelo menos 6 caracteres.');
  if (!ctx.user.must_change_pw && !(await verifyPw(String(p.old || ''), ctx.user.pw_hash)))
    throw new ApiError('A senha atual está incorreta.');
  await env.DB.batch([
    q(env, 'UPDATE users SET pw_hash = ?, must_change_pw = 0, updated_at = ? WHERE id = ?', await hashPw(nw), nowIso(), ctx.id),
    q(env, 'DELETE FROM sessions WHERE user_id = ? AND id <> ?', ctx.id, ctx.sid), // desconecta outros aparelhos
  ]);
  return true;
});

api('auth.update_profile', {}, async ({ env, ctx, p }) => {
  const full_name = s(p.full_name, 120);
  if (!full_name) throw new ApiError('Informe seu nome.');
  await env.DB.batch([
    q(env, 'UPDATE users SET full_name = ?, email = ?, updated_at = ? WHERE id = ?', full_name, s(p.email, 200), nowIso(), ctx.id),
    bump(env),
  ]);
  return true;
});

// ════════════════════════════════════════════════════════════════════════════
//  DADOS GERAIS (uma chamada carrega tudo o que a interface precisa)
// ════════════════════════════════════════════════════════════════════════════
const TASK_SELECT = `
SELECT t.*, i.name AS item_name, i.color AS item_color, i.leader_id AS item_leader,
       a.full_name AS assignee_name, c.full_name AS creator_name, ub.full_name AS updater_name
FROM tasks t
LEFT JOIN items i ON i.id = t.item_id
LEFT JOIN users a ON a.id = t.assignee_id
LEFT JOIN users c ON c.id = t.created_by
LEFT JOIN users ub ON ub.id = t.updated_by`;
const USER_SELECT = `SELECT u.id, u.username, u.full_name, u.email, u.role_id, u.manager_id, u.item_id, u.active, u.must_change_pw,
       u.created_at, u.updated_at, r.name AS role_name, r.level AS role_level, r.color AS role_color
FROM users u LEFT JOIN roles r ON r.id = u.role_id`;
const taskOut = (ctx, t) => ({ ...t, can_edit: canEditTask(ctx, t), can_delete: canDeleteTask(ctx, t) });
const getTaskRow = (env, id) => first(env, TASK_SELECT + ' WHERE t.id = ? AND t.deleted = 0', id || '');

api('app.data', {}, async ({ env, ctx }) => {
  const taskStmt = ctx.can('tasks.view_all')
    ? q(env, TASK_SELECT + ' WHERE t.deleted = 0')
    : q(env, TASK_SELECT + ' WHERE t.deleted = 0 AND (t.assignee_id = ? OR t.created_by = ? OR i.leader_id = ?)', ctx.id, ctx.id, ctx.id);
  const [roles, users, items, tasks, ver] = (await env.DB.batch([
    q(env, `SELECT r.*, (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id AND u.deleted = 0 AND u.active = 1) AS user_count
            FROM roles r WHERE r.deleted = 0 ORDER BY r.level DESC, r.name`),
    q(env, USER_SELECT + ' WHERE u.deleted = 0 ORDER BY u.full_name COLLATE NOCASE'),
    q(env, 'SELECT * FROM items WHERE deleted = 0 ORDER BY sort, name COLLATE NOCASE'),
    taskStmt,
    q(env, "SELECT value FROM meta WHERE key = 'data_version'"),
  ])).map(r => r.results);
  for (const r of roles) r.permissions = JSON.parse(r.permissions);
  return {
    me: users.find(u => u.id === ctx.id), perms: [...ctx.perms].sort(), level: ctx.level,
    users, items, roles, tasks: tasks.map(t => taskOut(ctx, t)), v: ver[0] ? ver[0].value : '0',
  };
});

// ════════════════════════════════════════════════════════════════════════════
//  TAREFAS
// ════════════════════════════════════════════════════════════════════════════
const TASK_FIELDS = ['title', 'description', 'item_id', 'assignee_id', 'priority', 'status', 'start_date', 'due_date', 'progress'];
const FIELD_LABELS = { title: 'Título', description: 'Descrição', item_id: 'Item', assignee_id: 'Responsável', priority: 'Prioridade',
  status: 'Status', start_date: 'Início', due_date: 'Prazo', progress: 'Progresso' };

async function cleanTask(env, t) {
  const title = s(t.title, 200);
  if (!title) throw new ApiError('Dê um título para a tarefa.');
  const pr = Math.min(4, Math.max(1, parseInt(t.priority, 10) || 2));
  const st = t.status || 'todo';
  if (!STATUS_LABEL[st]) throw new ApiError('Status inválido.');
  const d = {
    title, description: s(t.description, 20000),
    item_id: await optRef(env, 'items', t.item_id), assignee_id: await optRef(env, 'users', t.assignee_id),
    priority: pr, status: st, start_date: optDate(t.start_date), due_date: optDate(t.due_date),
    progress: Math.min(100, Math.max(0, parseInt(t.progress, 10) || 0)),
  };
  if (d.start_date && d.due_date && d.start_date > d.due_date) throw new ApiError('A data de início não pode ser depois do prazo.');
  if (st === 'done') d.progress = 100;
  return d;
}

async function describeChange(env, f, oldV, newV) {
  const fmt = async v => {
    if (v === null || v === undefined || v === '') return '—';
    if (f === 'status') return STATUS_LABEL[v] || v;
    if (f === 'priority') return PRIO_LABEL[+v] || String(v);
    if (f === 'item_id') { const r = await first(env, 'SELECT name FROM items WHERE id = ?', v); return r ? r.name : '—'; }
    if (f === 'assignee_id') { const r = await first(env, 'SELECT full_name FROM users WHERE id = ?', v); return r ? r.full_name : '—'; }
    if (f === 'start_date' || f === 'due_date') return brDate(v);
    if (f === 'progress') return `${v}%`;
    return String(v);
  };
  if (f === 'description') return 'Descrição atualizada';
  if (f === 'title') return `Título alterado para “${newV}”`;
  return `${FIELD_LABELS[f]}: ${await fmt(oldV)} → ${await fmt(newV)}`;
}
const activityStmt = (env, taskId, userId, action, detail, now) =>
  q(env, 'INSERT INTO activity (id, task_id, user_id, action, detail, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    newId(), taskId, userId, action, detail, now, now);

async function saveTask(env, ctx, t, expected = null, force = false) {
  const d = await cleanTask(env, t);
  const now = nowIso();
  let tid = t.id;
  if (tid) {
    const old = await getTaskRow(env, tid);
    if (!old) throw new ApiError('Esta tarefa não existe mais (pode ter sido excluída).', 'notfound');
    if (!canEditTask(ctx, old)) throw forbidden('Você não pode editar esta tarefa.');
    if (expected && expected !== old.updated_at && !force)
      throw new ApiError(`${old.updater_name || 'Outra pessoa'} alterou esta tarefa enquanto você editava.`, 'conflict');
    if (d.assignee_id !== old.assignee_id && d.assignee_id && d.assignee_id !== ctx.id && !ctx.can('tasks.assign'))
      throw forbidden('Você não tem permissão para atribuir tarefas a outros integrantes.');
    const changes = TASK_FIELDS.filter(f => norm(d[f]) !== norm(old[f]));
    if (!changes.length) return taskOut(ctx, old);
    let completed = old.completed_at;
    if (d.status === 'done' && old.status !== 'done') completed = now;
    else if (d.status !== 'done') completed = null;
    // A condição updated_at = ? impede que duas gravações simultâneas se sobrescrevam.
    const r = await q(env, `UPDATE tasks SET ${TASK_FIELDS.map(f => `${f} = ?`).join(', ')}, completed_at = ?, updated_at = ?, updated_by = ?
        WHERE id = ? AND updated_at = ?`, ...TASK_FIELDS.map(f => d[f]), completed, now, ctx.id, tid, old.updated_at).run();
    if (!r.meta.changes) throw new ApiError('Esta tarefa acabou de ser alterada por outra pessoa. Abra de novo e tente outra vez.', 'conflict');
    const stmts = [];
    for (const f of changes) stmts.push(activityStmt(env, tid, ctx.id, 'update', await describeChange(env, f, old[f], d[f]), now));
    stmts.push(bump(env));
    await env.DB.batch(stmts);
  } else {
    ctx.require('tasks.create');
    if (d.assignee_id && d.assignee_id !== ctx.id && !ctx.can('tasks.assign')) throw forbidden('Você só pode criar tarefas para você mesmo.');
    tid = newId();
    const cols = [...TASK_FIELDS, 'id', 'created_by', 'completed_at', 'created_at', 'updated_at', 'updated_by'];
    const vals = [...TASK_FIELDS.map(f => d[f]), tid, ctx.id, d.status === 'done' ? now : null, now, now, ctx.id];
    await env.DB.batch([
      q(env, `INSERT INTO tasks (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, ...vals),
      activityStmt(env, tid, ctx.id, 'create', 'Tarefa criada', now),
      bump(env),
    ]);
  }
  return taskOut(ctx, await getTaskRow(env, tid));
}

api('tasks.get', {}, async ({ env, ctx, p }) => {
  const t = await getTaskRow(env, p.id);
  if (!t) throw new ApiError('Esta tarefa não existe mais.', 'notfound');
  if (!canViewTask(ctx, t)) throw forbidden('Você não tem acesso a esta tarefa.');
  const [comments, activity] = (await env.DB.batch([
    q(env, `SELECT c.*, u.full_name AS user_name FROM comments c LEFT JOIN users u ON u.id = c.user_id
            WHERE c.task_id = ? AND c.deleted = 0 ORDER BY c.created_at`, t.id),
    q(env, `SELECT a.*, u.full_name AS user_name FROM activity a LEFT JOIN users u ON u.id = a.user_id
            WHERE a.task_id = ? AND a.deleted = 0 ORDER BY a.created_at DESC LIMIT 100`, t.id),
  ])).map(r => r.results);
  return { task: taskOut(ctx, t), comments, activity };
});

api('tasks.save', {}, ({ env, ctx, p }) => saveTask(env, ctx, p.task || {}, p.expected_updated_at, !!p.force));

api('tasks.quick', {}, async ({ env, ctx, p }) => {
  const old = await first(env, 'SELECT * FROM tasks WHERE id = ? AND deleted = 0', p.id || '');
  if (!old) throw new ApiError('Esta tarefa não existe mais.', 'notfound');
  const t = { id: old.id };
  for (const f of TASK_FIELDS) t[f] = old[f];
  for (const [k, v] of Object.entries(p.changes || {})) if (TASK_FIELDS.includes(k)) t[k] = v;
  return saveTask(env, ctx, t);
});

api('tasks.delete', {}, async ({ env, ctx, p }) => {
  const t = await getTaskRow(env, p.id);
  if (!t) throw new ApiError('Esta tarefa não existe mais.', 'notfound');
  if (!canDeleteTask(ctx, t)) throw forbidden('Você não pode excluir esta tarefa.');
  const now = nowIso();
  await env.DB.batch([
    q(env, 'UPDATE tasks SET deleted = 1, updated_at = ?, updated_by = ? WHERE id = ?', now, ctx.id, t.id),
    activityStmt(env, t.id, ctx.id, 'delete', 'Tarefa excluída', now),
    bump(env),
  ]);
  return true;
});

api('comments.add', {}, async ({ env, ctx, p }) => {
  const t = await getTaskRow(env, p.task_id);
  if (!t) throw new ApiError('Esta tarefa não existe mais.', 'notfound');
  if (!canViewTask(ctx, t)) throw forbidden('Você não tem acesso a esta tarefa.');
  const body = s(p.body, 5000);
  if (!body) throw new ApiError('Escreva um comentário.');
  const now = nowIso(), id = newId();
  await q(env, 'INSERT INTO comments (id, task_id, user_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    id, t.id, ctx.id, body, now, now).run();
  return { id, task_id: t.id, user_id: ctx.id, user_name: ctx.user.full_name, body, created_at: now };
});

// ════════════════════════════════════════════════════════════════════════════
//  ITENS / SUBSISTEMAS
// ════════════════════════════════════════════════════════════════════════════
api('items.save', { perm: 'items.manage' }, async ({ env, p }) => {
  const it = p.item || {};
  const name = s(it.name, 80);
  if (!name) throw new ApiError('Dê um nome ao item.');
  const color = COLOR_RE.test(it.color || '') ? it.color : '#64748b';
  const leader = await optRef(env, 'users', it.leader_id);
  const sort = parseInt(it.sort, 10) || 0, desc = s(it.description, 2000), now = nowIso();
  let id = it.id;
  if (id) {
    const r = await q(env, 'UPDATE items SET name = ?, description = ?, color = ?, leader_id = ?, sort = ?, updated_at = ? WHERE id = ? AND deleted = 0',
      name, desc, color, leader, sort, now, id).run();
    if (!r.meta.changes) throw new ApiError('Item não encontrado.', 'notfound');
  } else {
    id = newId();
    await q(env, 'INSERT INTO items (id, name, description, color, leader_id, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      id, name, desc, color, leader, sort, now, now).run();
  }
  await bump(env).run();
  return { id };
});

api('items.delete', { perm: 'items.manage' }, async ({ env, p }) => {
  const n = await first(env, 'SELECT COUNT(*) AS n FROM tasks WHERE item_id = ? AND deleted = 0', p.id || '');
  if (n.n) throw new ApiError(`Este item ainda tem ${n.n} tarefa(s). Mova ou exclua as tarefas antes.`);
  await env.DB.batch([q(env, 'UPDATE items SET deleted = 1, updated_at = ? WHERE id = ?', nowIso(), p.id || ''), bump(env)]);
  return true;
});

// ════════════════════════════════════════════════════════════════════════════
//  INTEGRANTES
// ════════════════════════════════════════════════════════════════════════════
async function checkCycle(env, uid, managerId) {
  const seen = new Set();
  let cur = managerId;
  while (cur) {
    if (cur === uid) throw new ApiError('Hierarquia circular: essa pessoa não pode ter como superior alguém que está abaixo dela.');
    if (seen.has(cur)) break;
    seen.add(cur);
    const r = await first(env, 'SELECT manager_id FROM users WHERE id = ?', cur);
    cur = r ? r.manager_id : null;
  }
}

api('users.save', { perm: 'users.manage' }, async ({ env, ctx, p }) => {
  const u = p.user || {};
  const uid = u.id || null;
  const full_name = s(u.full_name, 120), username = s(u.username, 32).toLowerCase();
  if (!full_name) throw new ApiError('Informe o nome completo.');
  if (!USERNAME_RE.test(username)) throw new ApiError(USERNAME_MSG);
  const role = await first(env, 'SELECT * FROM roles WHERE id = ? AND deleted = 0', u.role_id || '');
  if (!role) throw new ApiError('Escolha um cargo.');
  const managerId = await optRef(env, 'users', u.manager_id);
  const itemId = await optRef(env, 'items', u.item_id);
  const active = u.active === false || u.active === 0 ? 0 : 1;
  const password = String(u.password || ''), email = s(u.email, 200);
  if (await first(env, 'SELECT 1 AS x FROM users WHERE lower(username) = ? AND id <> ?', username, uid || ''))
    throw new ApiError('Esse nome de usuário já está em uso.');
  if (password && password.length < 6) throw new ApiError('A senha precisa ter pelo menos 6 caracteres.');
  const willBeAdmin = active && JSON.parse(role.permissions).includes('system.admin');
  const now = nowIso();
  if (uid) {
    const old = await first(env, `SELECT u.*, r.level AS role_level FROM users u LEFT JOIN roles r ON r.id = u.role_id
                                  WHERE u.id = ? AND u.deleted = 0`, uid);
    if (!old) throw new ApiError('Integrante não encontrado.', 'notfound');
    if (uid === ctx.id && !ctx.admin) throw forbidden('Para editar seus próprios dados, use “Meu perfil”.');
    if (uid !== ctx.id && !canManageLevel(ctx, old.role_level)) throw forbidden('Você não pode editar alguém do mesmo nível hierárquico ou acima de você.');
    if (role.id !== old.role_id && !canManageLevel(ctx, role.level)) throw forbidden('Você só pode atribuir cargos abaixo do seu nível hierárquico.');
    if (uid === ctx.id && !active) throw new ApiError('Você não pode desativar a si mesmo.');
    await checkCycle(env, uid, managerId);
    if (!willBeAdmin && (await activeAdmins(env, { exceptUser: uid })) === 0)
      throw new ApiError('O sistema precisa ter pelo menos um administrador ativo.');
    const stmts = [q(env, `UPDATE users SET username = ?, full_name = ?, email = ?, role_id = ?, manager_id = ?, item_id = ?, active = ?, updated_at = ?
                           WHERE id = ?`, username, full_name, email, role.id, managerId, itemId, active, now, uid)];
    if (password) {
      stmts.push(q(env, 'UPDATE users SET pw_hash = ?, must_change_pw = 1 WHERE id = ?', await hashPw(password), uid));
      stmts.push(q(env, 'DELETE FROM sessions WHERE user_id = ?', uid));
    }
    if (!active) stmts.push(q(env, 'DELETE FROM sessions WHERE user_id = ?', uid));
    stmts.push(bump(env));
    await env.DB.batch(stmts);
    return { id: uid };
  }
  if (!canManageLevel(ctx, role.level)) throw forbidden('Você só pode atribuir cargos abaixo do seu nível hierárquico.');
  if (password.length < 6) throw new ApiError('Defina uma senha inicial com pelo menos 6 caracteres.');
  const id = newId();
  try {
    await env.DB.batch([
      q(env, `INSERT INTO users (id, username, full_name, email, pw_hash, role_id, manager_id, item_id, active, must_change_pw, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`, id, username, full_name, email, await hashPw(password), role.id, managerId, itemId, active, now, now),
      bump(env),
    ]);
  } catch (e) {
    if (/UNIQUE/i.test(String(e.message))) throw new ApiError('Esse nome de usuário já está em uso.');
    throw e;
  }
  return { id };
});

// ════════════════════════════════════════════════════════════════════════════
//  CARGOS
// ════════════════════════════════════════════════════════════════════════════
api('roles.save', { perm: 'roles.manage' }, async ({ env, ctx, p }) => {
  const r = p.role || {};
  const name = s(r.name, 60);
  if (!name) throw new ApiError('Dê um nome ao cargo.');
  const level = parseInt(r.level, 10);
  if (!Number.isFinite(level)) throw new ApiError('Informe o nível hierárquico (número).');
  if (level < 1 || level > 999) throw new ApiError('O nível deve ficar entre 1 e 999.');
  const perms = (Array.isArray(r.permissions) ? r.permissions : []).filter(x => PERM_IDS.includes(x));
  const color = COLOR_RE.test(r.color || '') ? r.color : '#64748b';
  if (!ctx.admin) {
    if (level >= ctx.level) throw forbidden(`O nível do cargo precisa ser menor que o seu (${ctx.level}).`);
    if (perms.some(x => !ctx.can(x))) throw forbidden('Você não pode conceder permissões que você mesmo não tem.');
  }
  const now = nowIso();
  let id = r.id;
  if (id) {
    const old = await first(env, 'SELECT * FROM roles WHERE id = ? AND deleted = 0', id);
    if (!old) throw new ApiError('Cargo não encontrado.', 'notfound');
    if (!ctx.admin && old.level >= ctx.level) throw forbidden('Você não pode editar um cargo do seu nível ou acima.');
    if (!perms.includes('system.admin') && (await activeAdmins(env, { exceptRole: id })) === 0)
      throw new ApiError('O sistema precisa ter pelo menos um administrador ativo.');
    await env.DB.batch([
      q(env, 'UPDATE roles SET name = ?, level = ?, permissions = ?, color = ?, updated_at = ? WHERE id = ?', name, level, JSON.stringify(perms), color, now, id),
      bump(env),
    ]);
  } else {
    id = newId();
    await env.DB.batch([
      q(env, 'INSERT INTO roles (id, name, level, permissions, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id, name, level, JSON.stringify(perms), color, now, now),
      bump(env),
    ]);
  }
  return { id };
});

api('roles.delete', { perm: 'roles.manage' }, async ({ env, ctx, p }) => {
  const old = await first(env, 'SELECT * FROM roles WHERE id = ? AND deleted = 0', p.id || '');
  if (!old) throw new ApiError('Cargo não encontrado.', 'notfound');
  if (!ctx.admin && old.level >= ctx.level) throw forbidden('Você não pode excluir um cargo do seu nível ou acima.');
  const n = await first(env, 'SELECT COUNT(*) AS n FROM users WHERE role_id = ? AND deleted = 0', old.id);
  if (n.n) throw new ApiError(`Há ${n.n} integrante(s) com este cargo. Troque o cargo deles antes de excluir.`);
  await env.DB.batch([q(env, 'UPDATE roles SET deleted = 1, updated_at = ? WHERE id = ?', nowIso(), old.id), bump(env)]);
  return true;
});

// ════════════════════════════════════════════════════════════════════════════
//  ADMINISTRAÇÃO
// ════════════════════════════════════════════════════════════════════════════
const BACKUP_TABLES = ['meta', 'roles', 'users', 'items', 'tasks', 'comments', 'activity'];

api('system.status', { perm: 'system.admin' }, async ({ env }) => {
  const [t, u, i, c, sess, ver] = (await env.DB.batch([
    q(env, 'SELECT COUNT(*) AS n FROM tasks WHERE deleted = 0'),
    q(env, 'SELECT COUNT(*) AS n FROM users WHERE deleted = 0'),
    q(env, 'SELECT COUNT(*) AS n FROM items WHERE deleted = 0'),
    q(env, 'SELECT COUNT(*) AS n FROM comments WHERE deleted = 0'),
    q(env, 'SELECT COUNT(*) AS n FROM sessions WHERE expires_at > ?', nowIso()),
    q(env, "SELECT value FROM meta WHERE key = 'data_version'"),
  ])).map(r => r.results[0]);
  return { version: APP_VERSION, counts: { tasks: t.n, users: u.n, items: i.n, comments: c.n, sessions: sess.n }, data_version: ver.value };
});

// Backup completo em SQL. Restaurar (substitui todos os dados):
//   npx wrangler d1 execute bajadegalpao-tasks --remote --file=ARQUIVO.sql
api('system.backup', { perm: 'system.admin' }, async ({ env }) => {
  const lit = v => v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replaceAll("'", "''")}'`;
  const results = await env.DB.batch(BACKUP_TABLES.map(t => q(env, `SELECT * FROM ${t}`)));
  const out = [`-- Backup ${APP_NAME} v${APP_VERSION} — ${nowIso()}`,
    '-- ATENÇÃO: contém os hashes das senhas. Guarde em local seguro.',
    '-- Restaurar: npx wrangler d1 execute bajadegalpao-tasks --remote --file=ESTE_ARQUIVO.sql',
    'DELETE FROM sessions;', ...BACKUP_TABLES.map(t => `DELETE FROM ${t};`)];
  results.forEach((r, i) => {
    for (const row of r.results) {
      const cols = Object.keys(row);
      out.push(`INSERT INTO ${BACKUP_TABLES[i]} (${cols.join(', ')}) VALUES (${cols.map(c => lit(row[c])).join(', ')});`);
    }
  });
  const stamp = nowIso().slice(0, 16).replace('T', '_').replace(':', '');
  return { filename: `backup_galpao_tasks_${stamp}.sql`, content: out.join('\n') + '\n' };
});
