# CRM de Conteúdo para Social Media

MVP em React + Tailwind para gerir clientes, notas, slots de conteúdo, aprovação e publicação via Instagram Graph API.

## Rodar localmente
1. `npm install`
2. copie `.env.example` para `.env.local`
3. preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`
4. `npm run dev`

Sem variáveis de ambiente, o app sobe em **modo demo** com dados locais.

## Supabase
- Execute `supabase/schema.sql` no SQL Editor.
- O schema separa tokens em `cliente_segredos` para que o frontend não os leia diretamente.
- Crie um bucket público no Supabase Storage para mídias finais.
- Publique a Edge Function:
  ```bash
  supabase functions deploy publish-due-content
  ```
- Configure os secrets da função:
  ```bash
  supabase secrets set SUPABASE_URL=https://PROJECT_REF.supabase.co
  supabase secrets set SUPABASE_SERVICE_ROLE_KEY=SEU_SERVICE_ROLE_KEY
  supabase secrets set META_GRAPH_VERSION=v23.0
  ```
- Agende a função com `supabase/cron.sql`, trocando `PROJECT_REF` e `SUPABASE_ANON_KEY`.
- Cadastre o token de cada cliente em `cliente_segredos`:
  ```sql
  insert into public.cliente_segredos (cliente_id, access_token)
  values ('CLIENTE_UUID', 'META_ACCESS_TOKEN')
  on conflict (cliente_id) do update set access_token = excluded.access_token;
  ```

## O que já está pronto
- board de clientes em dark mode
- criação de cliente e geração de slots dos próximos 30 dias
- notas por cliente
- kanban de conteúdo
- envio para aprovação e revisão
- indicador de publicação próxima
- função server-side para publicar itens aprovados vencidos
- polling de vídeo para Reels/Stories antes do `media_publish`
- logs de publicação em `logs_publicacao` e erro visível no card

## Próximos passos recomendados
- autenticação real e policies por usuário/equipe
- upload direto para Supabase Storage
- persistir todas as mutações no Supabase (o MVP já prepara a estrutura)
- drag and drop real entre colunas
- validação forte de mídia por tipo

