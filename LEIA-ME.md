# Baja de Galpão Tasks — versão na nuvem

App de tarefas da equipe rodando de graça na Cloudflare (Workers + banco D1/SQLite).
Funciona no navegador do PC e do celular, e pode ser instalado como app.

## Para a equipe
- **Endereço:** `https://bajadegalpao-tasks.<conta>.workers.dev` (o link exato aparece depois da publicação).
- **Instalar no Android (Chrome):** abra o link → menu ⋮ → **Instalar app** (ou "Adicionar à tela inicial").
- **Instalar no iPhone (Safari):** abra o link → botão Compartilhar → **Adicionar à Tela de Início**.
- **Instalar no PC (Edge/Chrome):** abra o link → ícone de instalar na barra de endereço (ou menu → Aplicativos → Instalar).
- O login fica salvo por 30 dias em cada aparelho. "Sair" encerra a sessão naquele aparelho.
- Esqueceu a senha? Um gerente ou admin redefine em **Equipe → editar integrante**.
- A tela se atualiza sozinha a cada ~15 segundos (e na hora em que você volta para o app).
- Atalhos no PC: `N` cria tarefa, `/` vai para a busca, `Ctrl+Enter` salva.

## Cargos e hierarquia
Iguais aos da versão anterior: Administrador (100), Gerente (80), Líder de subsistema (50), Integrante (20) e Trainee (10).
Quem gerencia só mexe em quem está **abaixo** do próprio nível e não pode dar permissões que não tem.
O líder de um item edita todas as tarefas daquele item. Tudo é editável em **Cargos**.

## Segurança
- Tudo trafega por HTTPS. O banco não pode ser baixado por quem usa o app.
- Senhas guardadas com PBKDF2 (com sal). Depois de 5 senhas erradas, aquele usuário fica bloqueado por 15 minutos.
- Trocar a senha desconecta os outros aparelhos; desativar um integrante derruba a sessão dele na hora.
- **A conta da Cloudflare é a chave de tudo.** Use o e-mail da equipe, senha forte e ative a verificação em duas etapas (Cloudflare → My Profile → Authentication).

## Backups
- A Cloudflare guarda o histórico dos **últimos 7 dias** automaticamente (Time Travel do D1).
- Para guardar por mais tempo: **Sistema → Baixar backup completo (.sql)**. Sugestão: toda semana, numa pasta do Drive só da diretoria (o arquivo contém os hashes das senhas).
- Restaurar um backup (substitui todos os dados atuais):
  ```bash
  npx -y wrangler@4.153.0 d1 execute bajadegalpao-tasks --remote --file=backup_galpao_tasks_AAAA-MM-DD_HHMM.sql
  ```
- Voltar o banco para um momento dos últimos 7 dias:
  ```bash
  npx -y wrangler@4.153.0 d1 time-travel restore bajadegalpao-tasks --timestamp=2026-11-10T15:00:00Z
  ```

## Limites do plano grátis (e por que o app foi feito assim)
| Limite | Folga para uma equipe baja |
|---|---|
| 100 mil requisições/dia | ~20 pessoas com o app aberto o dia todo usam ~40 mil (checagem a cada 15 s, só com o app visível) |
| 10 ms de CPU por requisição | O cálculo da senha foi ajustado para caber; o resto do app usa bem menos |
| 5 milhões de linhas lidas e 100 mil gravadas por dia | Uso típico: dezenas de milhares lidas, centenas gravadas |
| 5 GB de banco | Alguns MB por ano de uso |

Se um dia a equipe crescer muito, o plano pago custa US$ 5/mês e não exige mudar nada no código.

## Para quem vai programar (manutenção)
Requisitos: Node.js. O `wrangler` roda via `npx` (não precisa instalar nada na pasta).

| Arquivo | O que é |
|---|---|
| `src/worker.js` | Backend: login, permissões e toda a API (`api('nome', {perm}, fn)`) |
| `public/app.js` | Interface: módulos registrados com `registerModule({...})` |
| `public/style.css` | Visual (tema claro/escuro e layout de celular) |
| `migrations/*.sql` | Estrutura do banco. Nunca edite uma migração aplicada: crie `0002_...sql` |
| `wrangler.jsonc` | Configuração da Cloudflare |

Testar no próprio PC (banco local, separado do de verdade):
```bash
npm run db:local
npm run dev
```
Abra `http://127.0.0.1:8787`.

Publicar uma nova versão:
```bash
npm run db:remote
npm run deploy
```

Primeira publicação (já feita uma vez; fica aqui de referência):
1. `npm run login` — autoriza o wrangler na conta da Cloudflare.
2. `npx -y wrangler@4.153.0 d1 create bajadegalpao-tasks` — copie o `database_id` para o `wrangler.jsonc`.
3. `npm run db:remote` e `npm run deploy`.
4. Abra o link **na hora** e crie a conta de administrador (quem criar a primeira conta vira admin).
