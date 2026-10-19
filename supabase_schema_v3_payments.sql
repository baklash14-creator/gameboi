-- Run AFTER v1 and v2. Payments for tournament entry fees (Monime).
create table payments(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles,
  tournament_id uuid references tournaments,
  purpose text not null check(purpose in('tournament_entry','listing_fee')),
  amount numeric(12,2) not null check(amount>0),
  currency text not null default 'SLE',
  provider text not null default 'monime',
  provider_session_id text, provider_order text,
  status text not null default 'pending' check(status in('pending','successful','failed','refunded')),
  note text, created_at timestamptz not null default now(), paid_at timestamptz);
create unique index payments_session on payments(provider_session_id) where provider_session_id is not null;
create index on payments(user_id,status);
alter table payments enable row level security;
create policy "own payments" on payments for select using(user_id=auth.uid() or is_admin());
-- no insert/update policies: only server functions (service role) write payments

create function finalize_payment(p_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare p payments; tr tournaments; n int;
begin
 select * into p from payments where id=p_id for update;
 if not found or p.status<>'pending' then return; end if;  -- idempotent
 update payments set status='successful',paid_at=now() where id=p_id;
 if p.purpose='tournament_entry' then
  select * into tr from tournaments where id=p.tournament_id for update;
  select count(*) into n from participants where tournament_id=p.tournament_id and status='registered';
  if n>=tr.max_participants then
   update payments set note='Tournament full: refund needed' where id=p_id;
   insert into notifications(user_id,body) values(p.user_id,'Your payment was received but '||tr.name||' is full. A refund is needed; contact support.');
  else
   insert into participants(tournament_id,user_id) values(p.tournament_id,p.user_id)
    on conflict(tournament_id,user_id) do update set status='registered';
   insert into notifications(user_id,body) values(p.user_id,'Payment confirmed. You are registered for '||tr.name);
  end if;
 end if;
end $$;
revoke all on function finalize_payment(uuid) from public,anon,authenticated;
grant execute on function finalize_payment(uuid) to service_role;

-- Free registration must not bypass entry fees
create or replace function register_for_tournament(t uuid, code text default null) returns text language plpgsql security definer set search_path=public as $$
declare tr tournaments; n int;
begin
 if auth.uid() is null then raise exception 'Login required'; end if;
 select * into tr from tournaments where id=t for update;
 if not found or tr.status<>'open' or now()>tr.register_by then raise exception 'Registration closed'; end if;
 if tr.entry_fee>0 then raise exception 'This tournament requires payment'; end if;
 if tr.is_private and coalesce(tr.invite_code,'')<>coalesce(code,'') then raise exception 'Invalid invite code'; end if;
 select count(*) into n from participants where tournament_id=t and status='registered';
 if n>=tr.max_participants then raise exception 'Tournament is full'; end if;
 insert into participants(tournament_id,user_id) values(t,auth.uid())
  on conflict(tournament_id,user_id) do update set status='registered' where participants.status='cancelled';
 insert into notifications(user_id,body) values(auth.uid(),'Registered for '||tr.name);
 return 'ok';
end $$;
