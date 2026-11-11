# Baja de Galpão Tasks — guia para o Claude

App de tarefas da equipe Baja SAE "Baja de Galpão". Roda de graça na Cloudflare: Worker (`src/worker.js`) + banco D1/SQLite + arquivos estáticos (`public/`). Usuários são estudantes, muitos no celular, na oficina. Toda a interface e as mensagens de erro são em **português do Brasil**, com tom amigável.

- Produção: https://bajadegalpao-tasks.bajadegalpao-tasks.workers.dev (Worker e banco D1 `bajadegalpao-tasks`)
- GitHub: `sShauni/bajatasks` (privado), branch `main`
- A pasta `../` (Tarefas) tem a versão antiga em Python/Drive (`baja_tarefas.py`, `BajaTarefas.exe`). Ela é legado e não faz parte deste repositório; não mexa nela.

## Comandos (rodar dentro desta pasta)
Node via winget; o wrangler roda por `npx`, fixado em `wrangler@4.153.0` (não há `node_modules`).
```bash
npm run db:local     # aplica migrações no banco local (.wrangler/state)
npm run dev          # servidor local em http://127.0.0.1:8787
npm run db:remote    # aplica migrações no banco REAL
npm run deploy       # publica na Cloudflare
```
- Publicar sempre nesta ordem: `db:remote` e depois `deploy`. Ambos afetam a equipe: só com o pedido explícito do usuário.
- Para zerar o banco local: parar o servidor, apagar `.wrangler/state` e rodar `npm run db:local`.
- Gatilho diário (repetições) no PC: `npx -y wrangler@4.153.0 dev --test-scheduled` e abrir `/__scheduled?cron=0+9+*+*+*`.
- O cookie de sessão é `Secure`: só funciona em `127.0.0.1` ou HTTPS (não pelo IP do PC no Wi-Fi).

## Arquitetura
- **API:** tudo é `POST /api/<nome>` com JSON e o cabeçalho `X-Requested-With: bt` (proteção CSRF). A resposta é `{ok, data}` ou `{ok:false, error, code}`. O registro de rotas é `api('modulo.acao', { perm, auth }, async ({ env, ctx, p, req, res }) => …)`. Erros para o usuário vão como `throw new ApiError('mensagem em pt-BR', 'code')`; `forbidden()` dá erro de permissão.
- **Sincronização:** toda gravação inclui `bump(env)`, que incrementa `meta.data_version`. O app consulta `sys.poll` a cada 15 s (só com a aba visível) e recarrega `app.data` quando a versão muda.
- **Concorrência:** a gravação de tarefas usa `UPDATE … WHERE id = ? AND updated_at = ?` e devolve `code: 'conflict'`. O D1 não tem transações interativas: use `env.DB.batch([...])`.
- **Permissões:** a lista fica em `PERMISSIONS` (worker). Os cargos têm `level`; quem gerencia só mexe em níveis abaixo do seu (`canManageLevel`). O sistema precisa ter sempre ao menos um admin ativo (`activeAdmins`).
- **Tarefas:** responsável principal (`assignee_id`) + apoio (`task_members`) + etapas (`subtasks`; o progresso vira a % de etapas concluídas, via `autoProgress`/`recalcStmt`). As repetições (`recurrences`) geram tarefas normais com `recur_id`, sempre `RECUR_HORIZON_DAYS` (56) à frente: ao salvar a série e no cron diário (`scheduled` → `generateAllSeries`). Ao editar a série, só as ocorrências futuras "intocadas" (`updated_at = created_at`) são apagadas e regeradas.
- **Interface:** `public/app.js` é um arquivo único, em JS puro, sem build. Módulos do menu são criados com `registerModule({ id, title, icon, section, visible, badge, render, refresh })`. Utilitários: `call()`, `openModal()`, `confirmDlg()`, `toast()`, `esc()`. **Sempre `esc()`** em texto vindo do banco.
- **Estilo:** `public/style.css`, com temas claro/escuro via `[data-theme]` e o layout de celular em `@media (max-width:760px)`. O celular é prioridade: barra de navegação embaixo, janelas como folha que sobe da base e cartões no lugar de tabelas.
- **CSP** (`public/_headers`): `script-src 'self'`. Não use `<script>` inline nem `onclick=""` no HTML; ligue os eventos no JS.

## Regras e limites (plano grátis da Cloudflare)
- **10 ms de CPU por requisição.** O PBKDF2 está com 20 mil iterações por isso. O número fica gravado em cada hash, então dá para mudar sem quebrar senhas.
- **50 consultas ao banco por requisição.** Gravações em lote devem ser uma instrução só, com a lista passada como JSON (`json_each(?)`); veja `membersInsert`, `subtasksInsert` e `generateSeries`. Não faça um `INSERT` por linha em laço.
- **100 mil requisições/dia; 5 milhões de linhas lidas e 100 mil gravadas por dia.** Não aumente a frequência do poll nem faça consultas pesadas em `app.data`.
- **Migrações:** crie `migrations/000N_nome.sql`. Nunca altere uma migração já aplicada. Só **acrescente** tabelas e colunas, para a versão anterior do código continuar funcionando durante a publicação.
- Tabela nova com dados? Inclua em `BACKUP_TABLES` (o backup em `.sql` fica em Sistema).
- Versão: `APP_VERSION` no worker + `version` no `package.json`.
- "Hoje" no servidor é o horário de Brasília (`todayBR()`, UTC−3).

## Testes
Não há suíte no repositório. Testes de API em Python (só a biblioteca padrão) rodam contra `npm run dev` com banco zerado: criam usuários fictícios via `sys.setup`/`users.save` e verificam permissões, conflitos, etapas, mural, repetições, backup. Depois de mexer em regras, teste a API e confira a tela no navegador também em largura de celular (375 px).

## Segurança
- Nunca coloque senhas, tokens ou e-mails no código ou em commits. O `.gitignore` bloqueia `.wrangler/`, `*.sql` fora de `migrations/` (backups contêm hashes de senha) e `.dev.vars`.
- O `database_id` no `wrangler.jsonc` não é segredo.
