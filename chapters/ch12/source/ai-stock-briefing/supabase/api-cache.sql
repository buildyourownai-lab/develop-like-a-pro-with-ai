create table if not exists public.api_cache (
  cache_key text primary key,
  payload jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists api_cache_expires_at_idx on public.api_cache(expires_at);
alter table public.api_cache enable row level security;
-- Only the server secret/service-role key may access this cache. Never expose it to the browser.
