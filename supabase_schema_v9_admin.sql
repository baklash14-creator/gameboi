-- GAME BOI v9: admin dashboard, refund workflow, broadcasts, tournament cancellation.
-- Run once in Supabase > SQL Editor, after v1 to v7 (v8 has no SQL). Safe to re-run.
-- No money moves automatically. A refund is approved here, the admin sends the money back
-- (Monime dashboard or mobile money), then records the reference with "Mark as refunded".

-- 1. Refund requests ---------------------------------------------------------------------
create table if not exists refund_requests(
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references payments on delete cascade,
  user_id uuid not null references profiles on delete cascade,
  amount numeric(12,2) not null check(amount>0),
  currency text not null default 'SLE',
  reason text not null check(char_length(reason) between 3 and 300),
  source text not null default 'player' check(source in('player','admin')),
  status text not null default 'requested' check(status in('requested','approved','rejected','refunded')),
  admin_note text,
  refund_reference text,
  decided_by uuid references profiles,
  decided_at timestamptz,
  created_at timestamptz not null default now());
-- only one open refund per payment
create unique index if not exists refund_one_open on refund_requests(payment_id) where status in('requested','approved');
create index if not exists refund_status on refund_requests(status,created_at desc);
create index if not exists refund_user on refund_requests(user_id);

alter table refund_requests enable row level security;
drop policy if exists "refund own or admin" on refund_requests;
create policy "refund own or admin" on refund_requests for select using(user_id=auth.uid() or is_admin());
-- no insert/update/delete policies: all writes go through the functions below

-- 2. Player asks for a refund ------------------------------------------------------------
create or replace function request_refund(p_payment uuid, p_reason text) returns void
language plpgsql security definer set search_path=public as $$
declare p payments; uname text; why text:=left(btrim(coalesce(p_reason,'')),300);
begin
 if auth.uid() is null then raise exception 'Login required'; end if;
 if char_length(why)<3 then raise exception 'Please give a short reason'; end if;
 select * into p from payments where id=p_payment for update;
 if not found or p.user_id<>auth.uid() then raise exception 'Payment not found'; end if;
 if p.status<>'successful' then raise exception 'Only paid payments can be refunded'; end if;
 if exists(select 1 from refund_requests where payment_id=p.id and status in('requested','approved')) then
  raise exception 'A refund is already in progress for this payment'; end if;
 insert into refund_requests(payment_id,user_id,amount,currency,reason) values(p.id,p.user_id,p.amount,p.currency,why);
 select username into uname from profiles where id=auth.uid();
 insert into notifications(user_id,body) select user_id,'New refund request from '||coalesce(uname,'a player')||'.' from user_roles where role='admin';
 insert into notifications(user_id,body) values(auth.uid(),'Your refund request was sent. We will review it soon.');
end $$;

-- 3. Admin starts a refund (for example a payment flagged "Tournament full") --------------
create or replace function admin_open_refund(p_payment uuid, p_reason text) returns void
language plpgsql security definer set search_path=public as $$
declare p payments; why text:=left(btrim(coalesce(p_reason,'')),300);
begin
 if not is_admin() then raise exception 'Admins only'; end if;
 if char_length(why)<3 then raise exception 'Please give a short reason'; end if;
 select * into p from payments where id=p_payment for update;
 if not found then raise exception 'Payment not found'; end if;
 if p.status<>'successful' then raise exception 'Only paid payments can be refunded'; end if;
 if exists(select 1 from refund_requests where payment_id=p.id and status in('requested','approved')) then
  raise exception 'A refund is already in progress for this payment'; end if;
 insert into refund_requests(payment_id,user_id,amount,currency,reason,source,status,decided_by,decided_at)
  values(p.id,p.user_id,p.amount,p.currency,why,'admin','approved',auth.uid(),now());
 insert into notifications(user_id,body) values(p.user_id,'A refund of '||p.amount||' '||p.currency||' was approved. We will send the money back and tell you when it is done.');
 insert into audit_logs(actor,action,detail) values(auth.uid(),'open_refund',jsonb_build_object('payment',p.id,'amount',p.amount,'reason',why));
end $$;

-- 4. Admin approves or declines a request ------------------------------------------------
create or replace function admin_decide_refund(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path=public as $$
declare r refund_requests; note text:=nullif(left(btrim(coalesce(p_note,'')),300),'');
begin
 if not is_admin() then raise exception 'Admins only'; end if;
 select * into r from refund_requests where id=p_id for update;
 if not found or r.status<>'requested' then raise exception 'This request was already handled'; end if;
 update refund_requests set status=case when p_approve then 'approved' else 'rejected' end,
  admin_note=note, decided_by=auth.uid(), decided_at=now() where id=p_id;
 insert into notifications(user_id,body) values(r.user_id,
  case when p_approve then 'Your refund of '||r.amount||' '||r.currency||' was approved. We will send the money back and tell you when it is done.'
       else 'Your refund request was declined.'||coalesce(' Reason: '||note,'') end);
 insert into audit_logs(actor,action,detail) values(auth.uid(),case when p_approve then 'approve_refund' else 'reject_refund' end,
  jsonb_build_object('refund',p_id,'payment',r.payment_id,'amount',r.amount,'note',note));
end $$;

-- 5. Admin records that the money was sent back --------------------------------------------
-- Marks the payment "refunded". The player's tournament place is cancelled only while the
-- tournament is open, closed or cancelled (never once fixtures exist, to keep brackets intact).
create or replace function admin_mark_refunded(p_id uuid, p_reference text) returns void
language plpgsql security definer set search_path=public as $$
declare r refund_requests; p payments; ref text:=left(btrim(coalesce(p_reference,'')),100);
begin
 if not is_admin() then raise exception 'Admins only'; end if;
 if char_length(ref)<3 then raise exception 'Enter the transaction reference of the refund'; end if;
 select * into r from refund_requests where id=p_id for update;
 if not found or r.status<>'approved' then raise exception 'Approve the request first'; end if;
 select * into p from payments where id=r.payment_id for update;
 if p.status<>'successful' then raise exception 'Payment is not in a refundable state'; end if;
 update refund_requests set status='refunded', refund_reference=ref, decided_at=coalesce(decided_at,now()) where id=p_id;
 update payments set status='refunded', note=left(coalesce(note||' · ','')||'Refunded: '||ref,300) where id=p.id;
 if p.purpose='tournament_entry' and p.tournament_id is not null then
  update participants set status='cancelled'
   where tournament_id=p.tournament_id and user_id=p.user_id and status='registered'
     and exists(select 1 from tournaments t where t.id=p.tournament_id and t.status in('open','closed','cancelled'));
 end if;
 insert into notifications(user_id,body) values(r.user_id,'Your refund of '||r.amount||' '||r.currency||' was sent. Reference: '||ref);
 insert into audit_logs(actor,action,detail) values(auth.uid(),'mark_refunded',jsonb_build_object('refund',p_id,'payment',p.id,'amount',r.amount,'reference',ref));
end $$;

-- 6. Cancel a tournament and queue refunds for everyone who paid --------------------------
create or replace function admin_cancel_tournament(p_t uuid, p_reason text) returns int
language plpgsql security definer set search_path=public as $$
declare tr tournaments; p payments; n int:=0; why text:=left(btrim(coalesce(p_reason,'')),250);
begin
 if not is_admin() then raise exception 'Admins only'; end if;
 if char_length(why)<3 then raise exception 'Please give a short reason'; end if;
 select * into tr from tournaments where id=p_t for update;
 if not found then raise exception 'Tournament not found'; end if;
 if tr.status in('finished','cancelled') then raise exception 'This tournament is already %', tr.status; end if;
 update tournaments set status='cancelled' where id=p_t; -- existing trigger tells registered players
 for p in select * from payments where tournament_id=p_t and purpose='tournament_entry' and status='successful' for update loop
  if not exists(select 1 from refund_requests where payment_id=p.id and status in('requested','approved')) then
   insert into refund_requests(payment_id,user_id,amount,currency,reason,source,status,decided_by,decided_at)
    values(p.id,p.user_id,p.amount,p.currency,'Tournament cancelled: '||why,'admin','approved',auth.uid(),now());
   insert into notifications(user_id,body) values(p.user_id,'Your entry fee for '||tr.name||' will be refunded. We will tell you when the money is sent.');
   n:=n+1;
  end if;
 end loop;
 insert into audit_logs(actor,action,detail) values(auth.uid(),'cancel_tournament',jsonb_build_object('tournament',p_t,'reason',why,'refunds_queued',n));
 return n;
end $$;

-- 7. Dashboard numbers -------------------------------------------------------------------
create or replace function admin_dashboard_stats() returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
 if not is_admin() then raise exception 'Admins only'; end if;
 return jsonb_build_object(
  'users',(select count(*) from profiles),
  'users_7d',(select count(*) from profiles where created_at>now()-interval '7 days'),
  'suspended',(select count(*) from profiles where suspended),
  'tournaments_open',(select count(*) from tournaments where status in('open','closed')),
  'tournaments_live',(select count(*) from tournaments where status='live'),
  'listings_active',(select count(*) from listings where status='active'),
  'revenue_total',(select coalesce(sum(amount),0) from payments where status='successful' and currency='SLE'),
  'revenue_30d',(select coalesce(sum(amount),0) from payments where status='successful' and currency='SLE' and paid_at>now()-interval '30 days'),
  'refunded_total',(select coalesce(sum(amount),0) from payments where status='refunded' and currency='SLE'),
  'payments_pending',(select count(*) from payments where status='pending' and created_at>now()-interval '3 days'),
  'refunds_requested',(select count(*) from refund_requests where status='requested'),
  'refunds_approved',(select count(*) from refund_requests where status='approved'),
  'needs_refund',(select count(*) from payments p where p.status='successful' and p.note like 'Tournament full%'
     and not exists(select 1 from refund_requests r where r.payment_id=p.id)),
  'reports_open',(select count(*) from reports where status='open'),
  'disputes_open',(select count(*) from matches where status='disputed'));
end $$;

create or replace function admin_revenue_by_day(p_days int default 14) returns table(day date, total numeric, n int)
language plpgsql stable security definer set search_path=public as $$
begin
 if not is_admin() then raise exception 'Admins only'; end if;
 p_days:=least(greatest(coalesce(p_days,14),1),90);
 return query
  select g::date, coalesce(sum(p.amount),0), count(p.id)::int
  from generate_series(current_date-(p_days-1),current_date,interval '1 day') g
  left join payments p on p.status='successful' and p.currency='SLE' and p.paid_at::date=g::date
  group by g order by g;
end $$;

-- 8. Messages to players -----------------------------------------------------------------
create or replace function admin_broadcast(p_body text) returns int
language plpgsql security definer set search_path=public as $$
declare b text:=left(btrim(coalesce(p_body,'')),300); n int;
begin
 if not is_admin() then raise exception 'Admins only'; end if;
 if char_length(b)<3 then raise exception 'Write a short message first'; end if;
 insert into notifications(user_id,body) select id,b from profiles where not suspended;
 get diagnostics n=row_count;
 insert into audit_logs(actor,action,detail) values(auth.uid(),'broadcast',jsonb_build_object('message',b,'sent_to',n));
 return n;
end $$;

create or replace function admin_notify_user(p_u uuid, p_body text) returns void
language plpgsql security definer set search_path=public as $$
declare b text:=left(btrim(coalesce(p_body,'')),300);
begin
 if not is_admin() then raise exception 'Admins only'; end if;
 if char_length(b)<3 then raise exception 'Write a short message first'; end if;
 if not exists(select 1 from profiles where id=p_u) then raise exception 'User not found'; end if;
 insert into notifications(user_id,body) values(p_u,b);
 insert into audit_logs(actor,action,detail) values(auth.uid(),'notify_user',jsonb_build_object('user',p_u,'message',b));
end $$;

-- 9. Only signed-in users can call these (each one also checks is_admin() or ownership) ---
revoke all on function request_refund(uuid,text) from public,anon;
revoke all on function admin_open_refund(uuid,text) from public,anon;
revoke all on function admin_decide_refund(uuid,boolean,text) from public,anon;
revoke all on function admin_mark_refunded(uuid,text) from public,anon;
revoke all on function admin_cancel_tournament(uuid,text) from public,anon;
revoke all on function admin_dashboard_stats() from public,anon;
revoke all on function admin_revenue_by_day(int) from public,anon;
revoke all on function admin_broadcast(text) from public,anon;
revoke all on function admin_notify_user(uuid,text) from public,anon;
grant execute on function request_refund(uuid,text) to authenticated;
grant execute on function admin_open_refund(uuid,text) to authenticated;
grant execute on function admin_decide_refund(uuid,boolean,text) to authenticated;
grant execute on function admin_mark_refunded(uuid,text) to authenticated;
grant execute on function admin_cancel_tournament(uuid,text) to authenticated;
grant execute on function admin_dashboard_stats() to authenticated;
grant execute on function admin_revenue_by_day(int) to authenticated;
grant execute on function admin_broadcast(text) to authenticated;
grant execute on function admin_notify_user(uuid,text) to authenticated;
