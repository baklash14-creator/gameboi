-- GAME BOI v6: match chat + disputes, prize payouts, seller ratings, player stats, stream links, auto alerts.
-- Run once in Supabase -> SQL Editor (after v1 to v5). Safe to re-run.

-- 9. streaming link on tournaments
alter table tournaments add column if not exists stream_url text;
create or replace function set_stream(p_t uuid, p_url text) returns void language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from tournaments where id=p_t and (host_id=auth.uid() or is_admin())) then raise exception 'Only the host can do this'; end if;
 if coalesce(p_url,'')<>'' and p_url !~* '^https://[^ ]{4,300}$' then raise exception 'Link must start with https://'; end if;
 update tournaments set stream_url=nullif(p_url,'') where id=p_t;
end $$;

-- 3. match chat
create table if not exists match_messages(
 id uuid primary key default gen_random_uuid(),
 match_id uuid not null references matches on delete cascade,
 user_id uuid not null references profiles on delete cascade,
 body text not null check(char_length(body) between 1 and 500),
 kind text not null default 'chat' check(kind in('chat','dispute')),
 created_at timestamptz not null default now());
create index if not exists match_messages_m on match_messages(match_id,created_at);
alter table match_messages enable row level security;
create or replace function can_see_match(p_m uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from matches m join tournaments t on t.id=m.tournament_id
  where m.id=p_m and (auth.uid() in(m.p1,m.p2) or t.host_id=auth.uid())) or is_admin() $$;
drop policy if exists "mm read" on match_messages;
create policy "mm read" on match_messages for select using(can_see_match(match_id));
drop policy if exists "mm send" on match_messages;
create policy "mm send" on match_messages for insert with check(user_id=auth.uid() and kind='chat' and can_see_match(match_id));

create or replace function notify_match_message() returns trigger language plpgsql security definer set search_path=public as $$
declare m matches; t tournaments;
begin
 select * into m from matches where id=new.match_id; select * into t from tournaments where id=m.tournament_id;
 insert into notifications(user_id,body)
  select u,'New message in your '||t.name||' match' from unnest(array[m.p1,m.p2,t.host_id]) u where u is not null and u<>new.user_id;
 return new;
end $$;
drop trigger if exists trg_mm_notify on match_messages;
create trigger trg_mm_notify after insert on match_messages for each row execute function notify_match_message();

-- dispute with a reason (replaces the plain button)
create or replace function dispute_match(p_m uuid, p_reason text) returns void language plpgsql security definer set search_path=public as $$
declare m matches; t tournaments;
begin
 select * into m from matches where id=p_m for update;
 if not found or m.status<>'reported' or auth.uid() not in(m.p1,m.p2) then raise exception 'Not allowed'; end if;
 if char_length(coalesce(trim(p_reason),''))<3 then raise exception 'Please say what is wrong'; end if;
 select * into t from tournaments where id=m.tournament_id;
 update matches set status='disputed' where id=p_m;
 insert into match_messages(match_id,user_id,body,kind) values(p_m,auth.uid(),left(trim(p_reason),500),'dispute');
 insert into notifications(user_id,body) select user_id,'A match score was disputed in '||t.name from user_roles where role='admin';
 insert into notifications(user_id,body) values(t.host_id,'A score was disputed in '||t.name);
end $$;

-- 2/7. alerts when fixtures appear and when tournament status changes
create or replace function notify_new_match() returns trigger language plpgsql security definer set search_path=public as $$
declare t tournaments;
begin
 if new.p2 is null then return new; end if;
 select * into t from tournaments where id=new.tournament_id;
 insert into notifications(user_id,body) values(new.p1,'Your match in '||t.name||' is ready (round '||new.round||')'),(new.p2,'Your match in '||t.name||' is ready (round '||new.round||')');
 return new;
end $$;
drop trigger if exists trg_match_notify on matches;
create trigger trg_match_notify after insert on matches for each row execute function notify_new_match();

create or replace function notify_tournament_status() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.status is distinct from old.status and new.status in('live','finished','cancelled') then
  insert into notifications(user_id,body) select user_id,new.name||' is now '||new.status from participants where tournament_id=new.id and status='registered';
 end if; return new;
end $$;
drop trigger if exists trg_tour_notify on tournaments;
create trigger trg_tour_notify after update on tournaments for each row execute function notify_tournament_status();

-- 5. prize payouts (tracking only: the host records who was paid; no money moves here)
create table if not exists payouts(
 id uuid primary key default gen_random_uuid(),
 tournament_id uuid not null references tournaments on delete cascade,
 user_id uuid not null references profiles on delete cascade,
 place int not null check(place between 1 and 10),
 amount numeric(12,2) not null check(amount>=0),
 status text not null default 'pending' check(status in('pending','paid')),
 note text, paid_at timestamptz, created_at timestamptz not null default now(),
 unique(tournament_id,place));
alter table payouts enable row level security;
drop policy if exists "payouts read" on payouts;
create policy "payouts read" on payouts for select using(true);
create or replace function set_payout(p_t uuid,p_place int,p_user uuid,p_amount numeric) returns void language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from tournaments where id=p_t and (host_id=auth.uid() or is_admin())) then raise exception 'Only the host can do this'; end if;
 if not exists(select 1 from participants where tournament_id=p_t and user_id=p_user) then raise exception 'That player is not in this tournament'; end if;
 insert into payouts(tournament_id,user_id,place,amount) values(p_t,p_user,p_place,p_amount)
  on conflict(tournament_id,place) do update set user_id=excluded.user_id, amount=excluded.amount where payouts.status='pending';
end $$;
create or replace function mark_payout_paid(p_id uuid,p_note text default null) returns void language plpgsql security definer set search_path=public as $$
declare p payouts; t tournaments;
begin
 select * into p from payouts where id=p_id for update; select * into t from tournaments where id=p.tournament_id;
 if not found or (t.host_id<>auth.uid() and not is_admin()) then raise exception 'Only the host can do this'; end if;
 update payouts set status='paid',paid_at=now(),note=left(p_note,200) where id=p_id;
 insert into notifications(user_id,body) values(p.user_id,'Your prize for '||t.name||' was marked as paid. Tell the host if you did not receive it.');
end $$;

-- 8. seller ratings
create table if not exists seller_ratings(
 id uuid primary key default gen_random_uuid(),
 listing_id uuid not null references listings on delete cascade,
 seller_id uuid not null references profiles on delete cascade,
 rater_id uuid not null references profiles on delete cascade,
 stars int not null check(stars between 1 and 5),
 comment text check(char_length(comment)<=300),
 created_at timestamptz not null default now(),
 unique(rater_id,listing_id), check(rater_id<>seller_id));
alter table seller_ratings enable row level security;
drop policy if exists "ratings read" on seller_ratings;
create policy "ratings read" on seller_ratings for select using(true);
drop policy if exists "ratings insert" on seller_ratings;
create policy "ratings insert" on seller_ratings for insert with check(
 rater_id=auth.uid() and exists(select 1 from listings l where l.id=listing_id and l.seller_id=seller_ratings.seller_id));
drop policy if exists "ratings delete own" on seller_ratings;
create policy "ratings delete own" on seller_ratings for delete using(rater_id=auth.uid() or is_admin());
create or replace view seller_stats as
 select seller_id, round(avg(stars),1) avg_stars, count(*)::int n from seller_ratings group by seller_id;

-- 4. player profile stats
create or replace function player_stats(p uuid) returns table(played int,wins int,losses int,draws int,tournaments int,prizes int) language sql stable security definer set search_path=public as $$
 select
  (select count(*) from matches where status='verified' and p2 is not null and p in(p1,p2))::int,
  (select count(*) from matches where status='verified' and p2 is not null and ((p1=p and score1>score2) or (p2=p and score2>score1)))::int,
  (select count(*) from matches where status='verified' and p2 is not null and ((p1=p and score1<score2) or (p2=p and score2<score1)))::int,
  (select count(*) from matches where status='verified' and p2 is not null and score1=score2 and p in(p1,p2))::int,
  (select count(*) from participants where user_id=p and status='registered')::int,
  (select count(*) from payouts where user_id=p and place=1)::int $$;
