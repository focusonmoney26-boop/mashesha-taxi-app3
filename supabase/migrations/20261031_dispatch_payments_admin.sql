-- Mashesha dispatch, payment and cash control migration. Apply after supabase/schema.sql.
create extension if not exists pgcrypto;
alter type public.booking_status add value if not exists 'no_driver';
alter table public.bookings add column if not exists payment_method text not null default 'cash' check (payment_method in ('cash','online'));
alter table public.bookings add column if not exists payment_status text not null default 'unpaid' check (payment_status in ('unpaid','pending','paid','failed','refunded'));
alter table public.bookings add column if not exists accepted_at timestamptz;
alter table public.bookings add column if not exists completed_at timestamptz;
create table if not exists public.booking_offers (id uuid primary key default gen_random_uuid(), booking_id uuid not null references public.bookings(id) on delete cascade, driver_id uuid not null references public.profiles(id) on delete cascade, status text not null default 'offered' check(status in ('offered','accepted','declined','expired','withdrawn')), offered_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '45 seconds', responded_at timestamptz, unique(booking_id,driver_id));
create index if not exists booking_offers_driver_open on public.booking_offers(driver_id,status,expires_at);
create index if not exists bookings_dispatch on public.bookings(status,created_at);
create table if not exists public.payments (id uuid primary key default gen_random_uuid(), booking_id uuid not null unique references public.bookings(id), passenger_id uuid not null references public.profiles(id), amount_zar integer not null check(amount_zar>=0), method text not null check(method in ('cash','online')), status text not null default 'pending' check(status in ('pending','paid','failed','refunded')), provider text, provider_reference text unique, paid_at timestamptz, created_at timestamptz not null default now());
create table if not exists public.cash_sessions (id uuid primary key default gen_random_uuid(), driver_id uuid not null references public.profiles(id), opened_at timestamptz not null default now(), closed_at timestamptz, opening_float_zar integer not null default 0 check(opening_float_zar>=0), declared_cash_zar integer check(declared_cash_zar>=0), expected_cash_zar integer, variance_zar integer, status text not null default 'open' check(status in ('open','submitted','approved','flagged')), reviewed_by uuid references public.profiles(id), reviewed_at timestamptz, notes text);
create unique index if not exists one_open_cash_session_per_driver on public.cash_sessions(driver_id) where status='open';
create table if not exists public.cash_entries (id uuid primary key default gen_random_uuid(), session_id uuid not null references public.cash_sessions(id) on delete cascade, booking_id uuid references public.bookings(id), driver_id uuid not null references public.profiles(id), entry_type text not null check(entry_type in ('fare_collected','refund','float_in','cash_adjustment')), amount_zar integer not null, recorded_at timestamptz not null default now(), unique(booking_id,entry_type));
create table if not exists public.admin_audit_log (id bigint generated always as identity primary key, actor_id uuid references public.profiles(id), action text not null, target_table text not null, target_id text, details jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
alter table public.booking_offers enable row level security; alter table public.payments enable row level security; alter table public.cash_sessions enable row level security; alter table public.cash_entries enable row level security; alter table public.admin_audit_log enable row level security;
create or replace function public.is_mashesha_admin() returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin' and p.approved=true); $$;
create policy "offer_driver_or_admin_read" on public.booking_offers for select to authenticated using(driver_id=auth.uid() or public.is_mashesha_admin());
create policy "payment_participant_or_admin_read" on public.payments for select to authenticated using(passenger_id=auth.uid() or public.is_mashesha_admin() or exists(select 1 from public.bookings b where b.id=booking_id and b.driver_id=auth.uid()));
create policy "cash_session_owner_or_admin_read" on public.cash_sessions for select to authenticated using(driver_id=auth.uid() or public.is_mashesha_admin());
create policy "cash_entry_owner_or_admin_read" on public.cash_entries for select to authenticated using(driver_id=auth.uid() or public.is_mashesha_admin());
create policy "admin_audit_admin_read" on public.admin_audit_log for select to authenticated using(public.is_mashesha_admin());
revoke insert,update,delete on public.booking_offers,public.payments,public.cash_sessions,public.cash_entries,public.admin_audit_log from anon,authenticated;
grant select on public.booking_offers,public.payments,public.cash_sessions,public.cash_entries,public.admin_audit_log to authenticated;
create or replace function public.accept_booking_offer(p_offer_id uuid) returns boolean language plpgsql security definer set search_path=public as $$
declare v_booking uuid; v_driver uuid; v_status text;
begin
 select o.booking_id,o.driver_id,o.status into v_booking,v_driver,v_status from public.booking_offers o where o.id=p_offer_id and o.driver_id=auth.uid() and o.expires_at>now() for update;
 if v_booking is null or v_status<>'offered' then return false; end if;
 update public.bookings set driver_id=v_driver,status='accepted',accepted_at=now() where id=v_booking and status='requested' and driver_id is null;
 if not found then update public.booking_offers set status='withdrawn',responded_at=now() where id=p_offer_id; return false; end if;
 update public.booking_offers set status=case when id=p_offer_id then 'accepted' else 'withdrawn' end,responded_at=now() where booking_id=v_booking and status='offered'; return true;
end; $$;
revoke all on function public.accept_booking_offer(uuid) from public; grant execute on function public.accept_booking_offer(uuid) to authenticated;
create or replace view public.admin_booking_overview with (security_invoker=true) as select b.id,b.origin,b.destination,b.ride_type,b.total_fare_zar,b.status,b.payment_method,b.payment_status,b.created_at,b.pickup_at,b.passenger_id,b.driver_id from public.bookings b;
do $$ begin alter publication supabase_realtime add table public.booking_offers; exception when duplicate_object then null; when undefined_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.bookings; exception when duplicate_object then null; when undefined_object then null; end $$;
-- Admin dashboard read access, gated by an approved admin profile.
create policy "admin_read_profiles" on public.profiles for select to authenticated using(public.is_mashesha_admin());
create policy "admin_read_vehicles" on public.vehicles for select to authenticated using(public.is_mashesha_admin());
create policy "admin_read_bookings" on public.bookings for select to authenticated using(public.is_mashesha_admin());
-- Drivers may read the booking details attached to their own live offer before assignment.
create policy "driver_read_offered_booking" on public.bookings for select to authenticated
 using(exists(select 1 from public.booking_offers o where o.booking_id=bookings.id and o.driver_id=auth.uid() and o.status='offered' and o.expires_at>now()));

create or replace function public.open_cash_session(p_opening_float integer default 0) returns uuid
language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and role='driver' and approved=true) then raise exception 'Approved driver required'; end if;
 insert into public.cash_sessions(driver_id,opening_float_zar) values(auth.uid(),greatest(0,p_opening_float)) returning id into v_id;
 return v_id;
end; $$;

create or replace function public.close_cash_session(p_session_id uuid,p_declared_cash integer,p_notes text default null) returns integer
language plpgsql security definer set search_path=public as $$
declare v_expected integer; v_driver uuid;
begin
 select driver_id into v_driver from public.cash_sessions where id=p_session_id and status='open' for update;
 if v_driver is null or v_driver<>auth.uid() then raise exception 'Open cash session not found'; end if;
 select opening_float_zar + coalesce(sum(amount_zar),0) into v_expected from public.cash_sessions s left join public.cash_entries e on e.session_id=s.id where s.id=p_session_id group by s.opening_float_zar;
 update public.cash_sessions set closed_at=now(),declared_cash_zar=greatest(0,p_declared_cash),expected_cash_zar=v_expected,variance_zar=p_declared_cash-v_expected,status='submitted',notes=p_notes where id=p_session_id;
 return v_expected;
end; $$;

create or replace function public.review_cash_session(p_session_id uuid,p_approve boolean,p_notes text default null) returns void
language plpgsql security definer set search_path=public as $$
begin
 if not public.is_mashesha_admin() then raise exception 'Admin access required'; end if;
 update public.cash_sessions set status=case when p_approve and variance_zar=0 then 'approved' else 'flagged' end,reviewed_by=auth.uid(),reviewed_at=now(),notes=coalesce(p_notes,notes) where id=p_session_id and status='submitted';
 if not found then raise exception 'Submitted cash session not found'; end if;
 insert into public.admin_audit_log(actor_id,action,target_table,target_id,details) values(auth.uid(),case when p_approve then 'cash_session_approved' else 'cash_session_flagged' end,'cash_sessions',p_session_id::text,jsonb_build_object('notes',p_notes));
end; $$;
revoke all on function public.open_cash_session(integer),public.close_cash_session(uuid,integer,text),public.review_cash_session(uuid,boolean,text) from public;
grant execute on function public.open_cash_session(integer),public.close_cash_session(uuid,integer,text),public.review_cash_session(uuid,boolean,text) to authenticated;

create or replace function public.record_cash_fare_on_completion() returns trigger language plpgsql security definer set search_path=public as $$
declare v_session uuid;
begin
 if new.status='completed' and old.status is distinct from 'completed' and new.payment_method='cash' and new.driver_id is not null then
  select id into v_session from public.cash_sessions where driver_id=new.driver_id and status='open' order by opened_at desc limit 1;
  if v_session is not null then
   insert into public.cash_entries(session_id,booking_id,driver_id,entry_type,amount_zar) values(v_session,new.id,new.driver_id,'fare_collected',new.total_fare_zar) on conflict(booking_id,entry_type) do nothing;
  end if;
 end if;
 return new;
end; $$;
drop trigger if exists booking_cash_fare_on_completion on public.bookings;
create trigger booking_cash_fare_on_completion after update of status on public.bookings for each row execute function public.record_cash_fare_on_completion();

-- CASH-FIRST COLLECTION: driver records cash only after physically receiving it.
-- This function completes the ride and records the payment/ledger entry atomically.
create or replace function public.collect_cash_fare(p_booking_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_booking public.bookings%rowtype; v_session uuid;
begin
 select * into v_booking from public.bookings where id=p_booking_id for update;
 if not found or v_booking.driver_id <> auth.uid() then raise exception 'Booking is not assigned to this driver'; end if;
 if v_booking.status not in ('accepted','driver_arriving','in_progress') then raise exception 'Booking is not ready for cash collection'; end if;
 if v_booking.payment_method <> 'cash' then raise exception 'This booking is not a cash booking'; end if;
 if v_booking.payment_status = 'paid' then raise exception 'Cash fare already recorded'; end if;
 select id into v_session from public.cash_sessions where driver_id=auth.uid() and status='open' order by opened_at desc limit 1 for update;
 if v_session is null then raise exception 'Open a cash shift before collecting fares'; end if;
 insert into public.payments(booking_id,passenger_id,amount_zar,method,status,paid_at)
 values(v_booking.id,v_booking.passenger_id,v_booking.total_fare_zar,'cash','paid',now())
 on conflict(booking_id) do update set status='paid',paid_at=now(),method='cash';
 insert into public.cash_entries(session_id,booking_id,driver_id,entry_type,amount_zar)
 values(v_session,v_booking.id,auth.uid(),'fare_collected',v_booking.total_fare_zar)
 on conflict(booking_id,entry_type) do nothing;
 update public.bookings set payment_status='paid',status='completed',completed_at=now() where id=v_booking.id;
end; $$;
revoke all on function public.collect_cash_fare(uuid) from public;
grant execute on function public.collect_cash_fare(uuid) to authenticated;

-- A cash shift cannot be closed while assigned cash rides remain unpaid.
create or replace function public.close_cash_session(p_session_id uuid,p_declared_cash integer,p_notes text default null)
returns integer language plpgsql security definer set search_path=public as $$
declare v_expected integer; v_driver uuid; v_unpaid integer;
begin
 select driver_id into v_driver from public.cash_sessions where id=p_session_id and status='open' for update;
 if v_driver is null or v_driver<>auth.uid() then raise exception 'Open cash session not found'; end if;
 select count(*) into v_unpaid from public.bookings where driver_id=auth.uid() and payment_method='cash' and status='completed' and payment_status<>'paid';
 if v_unpaid>0 then raise exception 'There are completed cash rides not reconciled'; end if;
 select s.opening_float_zar + coalesce(sum(e.amount_zar),0) into v_expected from public.cash_sessions s left join public.cash_entries e on e.session_id=s.id where s.id=p_session_id group by s.opening_float_zar;
 update public.cash_sessions set closed_at=now(),declared_cash_zar=greatest(0,p_declared_cash),expected_cash_zar=v_expected,variance_zar=p_declared_cash-v_expected,status='submitted',notes=p_notes where id=p_session_id;
 return v_expected;
end; $$;
revoke all on function public.close_cash_session(uuid,integer,text) from public;
grant execute on function public.close_cash_session(uuid,integer,text) to authenticated;
