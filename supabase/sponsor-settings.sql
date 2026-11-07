alter table public.event_settings add column if not exists sponsor jsonb not null default '{}'::jsonb check (jsonb_typeof(sponsor) = 'object');
