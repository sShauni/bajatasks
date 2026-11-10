-- Baja de Galpão Tasks — esquema inicial (Cloudflare D1 / SQLite)
-- Para evoluir o banco, crie 0002_xxx.sql, 0003_xxx.sql… Nunca altere uma migração já aplicada.

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
INSERT INTO meta (key, value) VALUES ('data_version', '1');

CREATE TABLE roles (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, level INTEGER NOT NULL DEFAULT 10,
  permissions TEXT NOT NULL DEFAULT '[]', color TEXT DEFAULT '#64748b',
  created_at TEXT, updated_at TEXT, deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE users (
  id TEXT PRIMARY KEY, username TEXT NOT NULL, full_name TEXT NOT NULL, email TEXT DEFAULT '',
  pw_hash TEXT, role_id TEXT, manager_id TEXT, item_id TEXT,
  active INTEGER NOT NULL DEFAULT 1, must_change_pw INTEGER NOT NULL DEFAULT 0,
  created_at TEXT, updated_at TEXT, deleted INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX ux_users_username ON users (lower(username));

CREATE TABLE items (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '', color TEXT DEFAULT '#64748b',
  leader_id TEXT, sort INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT, deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT DEFAULT '', item_id TEXT, assignee_id TEXT, created_by TEXT,
  priority INTEGER NOT NULL DEFAULT 2, status TEXT NOT NULL DEFAULT 'todo', start_date TEXT, due_date TEXT,
  progress INTEGER NOT NULL DEFAULT 0, completed_at TEXT, created_at TEXT, updated_at TEXT, updated_by TEXT,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX ix_tasks_assignee ON tasks (assignee_id);
CREATE INDEX ix_tasks_item ON tasks (item_id);
CREATE INDEX ix_tasks_deleted ON tasks (deleted);

CREATE TABLE comments (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL, user_id TEXT, body TEXT NOT NULL,
  created_at TEXT, updated_at TEXT, deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX ix_comments_task ON comments (task_id);

CREATE TABLE activity (
  id TEXT PRIMARY KEY, task_id TEXT, user_id TEXT, action TEXT, detail TEXT,
  created_at TEXT, updated_at TEXT, deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX ix_activity_task ON activity (task_id);

-- Sessões de login (guarda só o hash do código do cookie)
CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT, expires_at TEXT NOT NULL);
CREATE INDEX ix_sessions_user ON sessions (user_id);

-- Limite de tentativas de login (por usuário e por IP)
CREATE TABLE login_attempts (key TEXT PRIMARY KEY, fails INTEGER NOT NULL, first_at TEXT NOT NULL);

-- Cargos padrão
INSERT INTO roles (id, name, level, permissions, color, created_at, updated_at) VALUES
  (lower(hex(randomblob(16))), 'Administrador', 100, '["tasks.view_all","tasks.create","tasks.assign","tasks.edit_all","tasks.delete","items.manage","users.manage","roles.manage","system.admin"]', '#ef4444', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'Gerente', 80, '["tasks.view_all","tasks.create","tasks.assign","tasks.edit_all","tasks.delete","items.manage","users.manage","roles.manage"]', '#f97316', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'Líder de subsistema', 50, '["tasks.view_all","tasks.create","tasks.assign","tasks.edit_all","tasks.delete"]', '#8b5cf6', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'Integrante', 20, '["tasks.view_all","tasks.create"]', '#3b82f6', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'Trainee', 10, '["tasks.view_all"]', '#10b981', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));

-- Itens (subsistemas) padrão
INSERT INTO items (id, name, color, sort, created_at, updated_at) VALUES
  (lower(hex(randomblob(16))), 'Gestão', '#64748b', 0, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'Estrutura', '#0ea5e9', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'Suspensão', '#8b5cf6', 2, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'Direção', '#14b8a6', 3, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'Freios', '#ef4444', 4, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'Powertrain', '#f97316', 5, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'Eletrônica', '#eab308', 6, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'Marketing', '#ec4899', 7, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
