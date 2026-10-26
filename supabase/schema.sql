-- Run once in the connected project's SQL editor. This adds a dedicated table.
-- Browser clients must never receive the server secret/service-role key.
begin;
create table if not exists public.delivery_records (
  kind text not null check (kind in ('users','vendors','orders')),
  id text not null,
  body jsonb not null check (jsonb_typeof(body) = 'object' and body->>'id' = id),
  revision bigint not null default 1 check (revision > 0),
  primary key (kind,id)
);
create unique index if not exists delivery_users_email on public.delivery_records (lower(body->>'email')) where kind='users';
create unique index if not exists delivery_vendor_code on public.delivery_records ((body->>'code')) where kind='vendors';
create unique index if not exists delivery_order_reference on public.delivery_records ((body->>'reference')) where kind='orders';
alter table public.delivery_records enable row level security;
revoke all on public.delivery_records from public, anon, authenticated;
grant select,insert,update,delete on public.delivery_records to service_role;
comment on table public.delivery_records is 'Relay server-only application records. No browser access policies.';
commit;
