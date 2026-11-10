-- 0002 — subtarefas (etapas), apoio em tarefas, mural, tarefas recorrentes,
--        itens secundário/terciário e capitão/vice da equipe.
-- Só acrescenta tabelas e colunas: a versão anterior do código continua funcionando.

-- Integrantes: até três itens e destaque de capitão ('captain') ou vice ('vice')
ALTER TABLE users ADD COLUMN item2_id TEXT;
ALTER TABLE users ADD COLUMN item3_id TEXT;
ALTER TABLE users ADD COLUMN badge TEXT;

-- Tarefas: horário opcional (ex.: reunião às 19:00) e ligação com a série recorrente
ALTER TABLE tasks ADD COLUMN due_time TEXT;
ALTER TABLE tasks ADD COLUMN recur_id TEXT;
CREATE INDEX ix_tasks_recur ON tasks (recur_id, due_date);

-- Integrantes de apoio (o responsável principal continua em tasks.assignee_id)
CREATE TABLE task_members (task_id TEXT NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY (task_id, user_id));
CREATE INDEX ix_task_members_user ON task_members (user_id);

-- Etapas (checklist) de cada tarefa; o progresso da tarefa vira a % de etapas concluídas
CREATE TABLE subtasks (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL, title TEXT NOT NULL, assignee_id TEXT,
  done INTEGER NOT NULL DEFAULT 0, done_at TEXT, done_by TEXT, sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT, updated_at TEXT, deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX ix_subtasks_task ON subtasks (task_id);

-- Mural de recados
CREATE TABLE posts (
  id TEXT PRIMARY KEY, user_id TEXT, title TEXT DEFAULT '', body TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT, updated_at TEXT, deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX ix_posts_created ON posts (created_at);

-- Séries recorrentes (ex.: reunião ordinária toda quarta). As ocorrências são tarefas normais.
CREATE TABLE recurrences (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT DEFAULT '', item_id TEXT, assignee_id TEXT,
  members TEXT NOT NULL DEFAULT '[]', subtasks TEXT NOT NULL DEFAULT '[]', priority INTEGER NOT NULL DEFAULT 2,
  freq TEXT NOT NULL, every INTEGER NOT NULL DEFAULT 1, weekdays TEXT NOT NULL DEFAULT '[]',
  start_date TEXT NOT NULL, end_date TEXT, due_time TEXT,
  created_by TEXT, created_at TEXT, updated_at TEXT, deleted INTEGER NOT NULL DEFAULT 0
);

-- Novas permissões para quem já gerencia integrantes (Administrador e Gerente, por padrão)
UPDATE roles SET permissions = replace(permissions, '"users.manage"', '"users.manage","mural.manage","team.captain"')
  WHERE permissions LIKE '%"users.manage"%';

UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'data_version';
