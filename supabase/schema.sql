create extension if not exists pgcrypto;

create table if not exists public.clientes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  instagram_url text,
  instagram_user_id text,
  foto_perfil_url text,
  criado_em timestamptz default now()
);

create table if not exists public.cliente_segredos (
  cliente_id uuid primary key references public.clientes(id) on delete cascade,
  access_token text not null,
  criado_em timestamptz default now()
);

create table if not exists public.agendamentos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid references public.clientes(id) on delete cascade,
  tipo text,
  frequencia jsonb not null,
  criado_em timestamptz default now()
);

create table if not exists public.conteudos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid references public.clientes(id) on delete cascade,
  titulo text,
  referencia_url text,
  status text not null check (status in ('a_criar','em_producao','aguardando_aprovacao','aprovado','publicado')),
  tipo text not null check (tipo in ('feed_foto','feed_carrossel','reels','stories')),
  midia_urls text[] default '{}',
  legenda text,
  data_agendada timestamptz,
  data_publicado timestamptz,
  instagram_post_id text,
  erro_publicacao text,
  notas text,
  criado_em timestamptz default now(),
  atualizado_em timestamptz default now()
);

alter table public.conteudos add column if not exists erro_publicacao text;

alter table public.conteudos drop constraint if exists conteudos_status_check;
alter table public.conteudos add constraint conteudos_status_check
check (status in ('a_criar','em_producao','aguardando_aprovacao','aprovado','publicado','erro_publicacao'));

create table if not exists public.notas_cliente (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid references public.clientes(id) on delete cascade,
  texto text not null,
  criado_em timestamptz default now()
);

create table if not exists public.logs_publicacao (
  id uuid primary key default gen_random_uuid(),
  conteudo_id uuid references public.conteudos(id) on delete cascade,
  nivel text not null check (nivel in ('info','error')),
  mensagem text not null,
  meta jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.atualizado_em = now();
  return new;
end; $$;

drop trigger if exists conteudos_set_updated_at on public.conteudos;
create trigger conteudos_set_updated_at before update on public.conteudos
for each row execute function public.set_updated_at();

alter table public.clientes enable row level security;
alter table public.cliente_segredos enable row level security;
alter table public.agendamentos enable row level security;
alter table public.conteudos enable row level security;
alter table public.notas_cliente enable row level security;
alter table public.logs_publicacao enable row level security;

-- Segurança do CRM:
-- - O frontend precisa estar logado no Supabase Auth.
-- - Tokens da Meta ficam em cliente_segredos.
-- - O frontend pode inserir/atualizar tokens, mas NÃO pode ler tokens.
-- - A Edge Function usa service_role para ler tokens e publicar.
drop policy if exists "auth read clientes" on public.clientes;
drop policy if exists "auth all clientes" on public.clientes;
drop policy if exists "auth all agendamentos" on public.agendamentos;
drop policy if exists "auth all conteudos" on public.conteudos;
drop policy if exists "auth all notas" on public.notas_cliente;
drop policy if exists "auth insert cliente_segredos" on public.cliente_segredos;
drop policy if exists "auth update cliente_segredos" on public.cliente_segredos;
drop policy if exists "auth read logs_publicacao" on public.logs_publicacao;
drop policy if exists "all" on public.cliente_segredos;
drop policy if exists "anon all clientes" on public.clientes;
drop policy if exists "anon insert cliente_segredos" on public.cliente_segredos;
drop policy if exists "anon update cliente_segredos" on public.cliente_segredos;
drop policy if exists "anon all agendamentos" on public.agendamentos;
drop policy if exists "anon all conteudos" on public.conteudos;
drop policy if exists "anon all notas" on public.notas_cliente;
drop policy if exists "anon all notas_cliente" on public.notas_cliente;

create policy "auth all clientes" on public.clientes
for all to authenticated using (true) with check (true);

create policy "auth insert cliente_segredos" on public.cliente_segredos
for insert to authenticated with check (true);

create policy "auth update cliente_segredos" on public.cliente_segredos
for update to authenticated using (true) with check (true);

create policy "auth all agendamentos" on public.agendamentos
for all to authenticated using (true) with check (true);

create policy "auth all conteudos" on public.conteudos
for all to authenticated using (true) with check (true);

create policy "auth all notas" on public.notas_cliente
for all to authenticated using (true) with check (true);

create policy "auth read logs_publicacao" on public.logs_publicacao
for select to authenticated using (true);

-- Sem policy de SELECT em cliente_segredos:
-- apenas service_role/Edge Functions conseguem ler access_token.

