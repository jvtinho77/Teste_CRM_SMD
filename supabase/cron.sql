-- Rode este arquivo no SQL Editor do Supabase depois de publicar a Edge Function.
-- Troque os dois valores abaixo:
-- 1) PROJECT_REF: fica na URL do projeto, ex: https://PROJECT_REF.supabase.co
-- 2) SUPABASE_ANON_KEY: Project Settings > API > anon public key

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select cron.unschedule('publish-due-instagram-content')
where exists (
  select 1
  from cron.job
  where jobname = 'publish-due-instagram-content'
);

select cron.schedule(
  'publish-due-instagram-content',
  '*/5 * * * *',
  $$
  select
    net.http_post(
      url := 'https://PROJECT_REF.supabase.co/functions/v1/publish-due-content',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer SUPABASE_ANON_KEY'
      ),
      body := '{}'::jsonb
    );
  $$
);
