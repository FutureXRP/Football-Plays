-- Play Designer Pro — initial schema
-- Run with: supabase db push   (or paste into the SQL editor in the dashboard)

-- ── Profiles: one row per auth user, holds the Pro entitlement ──────────
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  is_pro boolean not null default false,
  stripe_customer_id text,
  stripe_session_id text,
  purchased_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Users can read their own profile. is_pro can only be changed by the
-- service role (the Stripe webhook) — there is no update policy on purpose.
create policy "read own profile"
  on public.profiles for select
  using (auth.uid() = id);

-- Auto-create a profile row when a user signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Cloud playbook: saved plays (Pro feature) ────────────────────────────
create table if not exists public.plays (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

alter table public.plays enable row level security;

-- Everyone can read/delete their own plays (so access survives if Pro
-- status were ever revoked), but only Pro users can create or modify them.
create policy "read own plays"
  on public.plays for select
  using (auth.uid() = user_id);

create policy "delete own plays"
  on public.plays for delete
  using (auth.uid() = user_id);

create policy "pro users insert own plays"
  on public.plays for insert
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.profiles
                where id = auth.uid() and is_pro)
  );

create policy "pro users update own plays"
  on public.plays for update
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.profiles
                where id = auth.uid() and is_pro)
  );
