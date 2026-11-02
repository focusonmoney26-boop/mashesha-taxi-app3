-- Mashesha production starter schema (Supabase/Postgres)
create extension if not exists pgcrypto;

create type public.app_role as enum ('passenger','driver','admin');
create type public.ride_type as enum ('share','solo','kombi');
create type public.booking_status as enum ('requested','accepted','driver_arriving','in_progress','completed','cancelled');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  phone text unique not null,
  role public.app_role not null default 'passenger',
  created_at timestamptz not null default now()
);

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.profiles(id),
  registration text unique not null,
  make_model text not null,
  seats integer not null check (seats between 1 and 14),
  verified boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.routes (
  id uuid primary key default gen_random_uuid(),
  origin text not null,
  destination text not null,
  active boolean not null default true,
  unique(origin,destination)
);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  passenger_id uuid not null references public.profiles(id),
  driver_id uuid references public.profiles(id),
  vehicle_id uuid references public.vehicles(id),
  origin text not null,
  destination text not null,
  ride_type public.ride_type not null,
  pickup_at timestamptz not null,
  base_fare_zar integer not null check (base_fare_zar >= 0),
  night_surcharge_zar integer not null default 0 check (night_surcharge_zar in (0,20)),
  total_fare_zar integer generated always as (base_fare_zar + night_surcharge_zar) stored,
  status public.booking_status not null default 'requested',
  created_at timestamptz not null default now(),
  check (origin <> destination)
);

-- Pricing policy: surcharge is based on local South African pickup time (Africa/Johannesburg).
create or replace function public.mashesha_night_surcharge(pickup_at timestamptz)
returns integer language sql immutable as $$
  select case when extract(hour from pickup_at at time zone 'Africa/Johannesburg') >= 20 then 20 else 0 end;
$$;

create or replace function public.set_booking_night_surcharge()
returns trigger language plpgsql as $$
begin
  new.night_surcharge_zar := public.mashesha_night_surcharge(new.pickup_at);
  return new;
end;
$$;
create trigger booking_night_surcharge
before insert or update of pickup_at on public.bookings
for each row execute function public.set_booking_night_surcharge();

alter table public.profiles enable row level security;
alter table public.vehicles enable row level security;
alter table public.routes enable row level security;
alter table public.bookings enable row level security;

-- Production deployment: add reviewed RLS policies before exposing any table to clients.
-- Keep service-role keys on the server only. Do not put secrets in the Android app.


-- Account linking and role safety for passenger/driver registration.
alter table public.profiles add column if not exists approved boolean not null default false;

-- A newly authenticated user can create and read only their own profile.
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id and role in ('passenger','driver'));

-- Restrict profile updates to non-role fields. Run as schema owner.
revoke update on public.profiles from authenticated;
grant update (full_name, phone) on public.profiles to authenticated;

create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Drivers can see their own vehicles; passengers can see verified vehicles.
create policy "vehicles_select_verified_or_own" on public.vehicles
  for select using (verified = true or driver_id = auth.uid());

create policy "vehicles_insert_own_driver" on public.vehicles
  for insert with check (driver_id = auth.uid());

create policy "routes_read_active" on public.routes
  for select using (active = true);

-- Booking rows are visible to their passenger and assigned driver.
create policy "bookings_select_participants" on public.bookings
  for select using (passenger_id = auth.uid() or driver_id = auth.uid());

create policy "passenger_create_booking" on public.bookings
  for insert with check (passenger_id = auth.uid());

-- NOTE: Dispatch/assignment/status changes must be performed by trusted server
-- functions (Edge Functions/service role), not by arbitrary mobile clients.
