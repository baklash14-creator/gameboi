-- GAME BOI v7: fixes + player rating (ELO), clans, daily check-in streaks and badges.
-- Run once in Supabase > SQL Editor, after v1 to v6. Safe to re-run.

-- ============ 1. FIXES ============
-- A league can now be finished (it had no way to reach "finished" before), and the final knockout winner earns a badge.
-- An admin can no longer resolve a knockout dispute as a draw (the winner would be picked wrongly).
create or replace function admin_resolve(p_m uuid,p_s1 int,p_s2 int) returns void language plpgsql security definer set search_path=public as $$
declare m matches; tr tournaments;
begin
 if not is_admin() then raise exception 'Admins only'; end if;
 select * into m from matches where id=p_m for update;
 if not found or m.status<>'disputed' then raise exception 'Only disputed matches can be resolved'; end if;
 select * into tr from tournaments where id=m.tournament_id;
 if p_s1<0 or p_s2<0 then raise exception 'Invalid score'; end if;
 if tr.format<>'league' and p_s1=p_s2 then raise exception 'Knockout matches cannot be drawn'; end if;
 update matches set score1=p_s1,score2=p_s2,status='verified' where id=p_m;
 insert into audit_logs(actor,action,detail) values(auth.uid(),'resolve_dispute',jsonb_build_object('match',p_m,'s1',p_s1,'s2',p_s2));
end $$;

-- ============ 2. BADGES + RATING COLUMNS ============
alter table profiles add column if not exists elo int not null default 1000;
alter table profiles add column if not exists streak int not null default 0;
alter table profiles add column if not exists best_streak int not null default 0;
alter table profiles add column if not exists last_checkin date;
alter table matches  add column if not exists elo_done boolean not null default false;
alter table matches  add column if not exists elo1 int;   -- rating change for player 1
alter table matches  add column if not exists elo2 int;

create table if not exists badges(
 user_id uuid not null references profiles on delete cascade,
 code text not null check(code in('first_win','ten_matches','champion','streak_3','streak_7','streak_30','clan_founder','clan_member')),
 earned_at timestamptz not null default now(),
 primary key(user_id,code));
alter table badges enable row level security;
drop policy if exists "badges read" on badges;
create policy "badges read" on badges for select using(true);   -- no insert/update policy: only the functions below award badges

create or replace function award_badge(p_u uuid,p_code text) returns void language plpgsql security definer set search_path=public as $$
begin
 insert into badges(user_id,code) values(p_u,p_code) on conflict do nothing;
 if found then insert into notifications(user_id,body) values(p_u,'New badge earned: '||replace(p_code,'_',' ')); end if;
end $$;
revoke all on function award_badge(uuid,text) from public,anon,authenticated;

-- Players can edit their own profile row, but never their rating or streak (only the functions below change these).
create or replace function lock_profile_stats() returns trigger language plpgsql as $$
begin
 if current_user in('authenticated','anon') then
  new.elo:=old.elo; new.streak:=old.streak; new.best_streak:=old.best_streak; new.last_checkin:=old.last_checkin;
 end if;
 return new;
end $$;
drop trigger if exists trg_lock_profile_stats on profiles;
create trigger trg_lock_profile_stats before update on profiles for each row execute function lock_profile_stats();

-- ============ 3. ELO ON VERIFIED MATCHES ============
create or replace function apply_elo() returns trigger language plpgsql security definer set search_path=public as $$
declare ra int; rb int; ea numeric; sa numeric; d1 int; d2 int; wins int; played int; w uuid;
begin
 if new.p2 is null or new.p1 is null or new.score1 is null or new.score2 is null or new.elo_done then return null; end if;
 select elo into ra from profiles where id=new.p1 for update;
 select elo into rb from profiles where id=new.p2 for update;
 ea:=1/(1+power(10,(rb-ra)/400.0));
 sa:=case when new.score1>new.score2 then 1 when new.score1=new.score2 then 0.5 else 0 end;
 d1:=round(32*(sa-ea)); d2:=-d1;
 update profiles set elo=greatest(100,elo+d1) where id=new.p1;
 update profiles set elo=greatest(100,elo+d2) where id=new.p2;
 update matches set elo_done=true,elo1=d1,elo2=d2 where id=new.id;
 if new.score1<>new.score2 then
  w:=case when new.score1>new.score2 then new.p1 else new.p2 end;
  perform award_badge(w,'first_win');
 end if;
 for w in select unnest(array[new.p1,new.p2]) loop
  select count(*) into played from matches where status='verified' and p2 is not null and w in(p1,p2);
  if played>=10 then perform award_badge(w,'ten_matches'); end if;
 end loop;
 return null;
end $$;
drop trigger if exists trg_apply_elo on matches;
create trigger trg_apply_elo after update of status on matches
 for each row when (new.status='verified' and old.status is distinct from 'verified') execute function apply_elo();

-- rating board (players with at least one rated match)
create or replace view elo_board as
 select p.id,p.username,p.avatar_url,p.elo,
  (select count(*) from matches m where m.elo_done and p.id in(m.p1,m.p2))::int as rated
 from profiles p where p.suspended=false and exists(select 1 from matches m where m.elo_done and p.id in(m.p1,m.p2))
 order by p.elo desc limit 100;

-- ============ 4. LEAGUE FINISH + CHAMPION BADGE ============
create or replace function generate_next_round(p_t uuid) returns void language plpgsql security definer set search_path=public as $$
declare tr tournaments; r int; w uuid[]; i int; champ uuid;
begin
 select * into tr from tournaments where id=p_t for update;
 if not found or tr.host_id<>auth.uid() then raise exception 'Not allowed'; end if;
 if tr.format='league' then
  if not exists(select 1 from matches where tournament_id=p_t) then raise exception 'Generate fixtures first'; end if;
  if exists(select 1 from matches where tournament_id=p_t and status<>'verified') then raise exception 'Finish and confirm all matches first'; end if;
  update tournaments set status='finished' where id=p_t;
  select p.id into champ from tournament_standings(p_t) s join profiles p on p.username=s.username order by s.pts desc limit 1;
  if champ is not null then perform award_badge(champ,'champion'); end if;
  return;
 end if;
 select max(round) into r from matches where tournament_id=p_t;
 if r is null then raise exception 'Generate fixtures first'; end if;
 if exists(select 1 from matches where tournament_id=p_t and round=r and status<>'verified') then raise exception 'Finish and confirm all matches first'; end if;
 select array_agg(case when p2 is null or score1>score2 then p1 else p2 end order by seq) into w from matches where tournament_id=p_t and round=r;
 if array_length(w,1)=1 then
  update tournaments set status='finished' where id=p_t;
  perform award_badge(w[1],'champion');
  return;
 end if;
 for i in 1..array_length(w,1)/2 loop insert into matches(tournament_id,round,p1,p2) values(p_t,r+1,w[2*i-1],w[2*i]); end loop;
end $$;

-- ============ 5. DAILY CHECK-IN ============
create or replace function daily_checkin() returns jsonb language plpgsql security definer set search_path=public as $$
declare p profiles; ns int;
begin
 if auth.uid() is null then raise exception 'Login required'; end if;
 select * into p from profiles where id=auth.uid() for update;
 if p.last_checkin=current_date then return jsonb_build_object('streak',p.streak,'best',p.best_streak,'already',true); end if;
 ns:=case when p.last_checkin=current_date-1 then p.streak+1 else 1 end;
 update profiles set streak=ns,best_streak=greatest(best_streak,ns),last_checkin=current_date where id=p.id;
 if ns>=3 then perform award_badge(p.id,'streak_3'); end if;
 if ns>=7 then perform award_badge(p.id,'streak_7'); end if;
 if ns>=30 then perform award_badge(p.id,'streak_30'); end if;
 return jsonb_build_object('streak',ns,'best',greatest(p.best_streak,ns),'already',false);
end $$;
grant execute on function daily_checkin() to authenticated;

-- ============ 6. CLANS ============
create table if not exists clans(
 id uuid primary key default gen_random_uuid(),
 name text not null check(char_length(name) between 3 and 30),
 tag text not null check(tag ~ '^[A-Za-z0-9]{2,5}$'),
 description text check(char_length(description)<=200),
 owner_id uuid not null references profiles on delete cascade,
 created_at timestamptz not null default now());
create unique index if not exists clans_name_ci on clans(lower(name));
create unique index if not exists clans_tag_ci on clans(lower(tag));
create table if not exists clan_members(
 clan_id uuid not null references clans on delete cascade,
 user_id uuid not null references profiles on delete cascade,
 joined_at timestamptz not null default now(),
 primary key(clan_id,user_id));
create unique index if not exists clan_one_per_user on clan_members(user_id);
alter table clans enable row level security; alter table clan_members enable row level security;
drop policy if exists "clans read" on clans; create policy "clans read" on clans for select using(true);
drop policy if exists "clan members read" on clan_members; create policy "clan members read" on clan_members for select using(true);
-- no write policies: everything goes through the functions below

create or replace function create_clan(p_name text,p_tag text,p_desc text default null) returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
 if auth.uid() is null then raise exception 'Login required'; end if;
 if exists(select 1 from profiles where id=auth.uid() and suspended) then raise exception 'Account suspended'; end if;
 if exists(select 1 from clan_members where user_id=auth.uid()) then raise exception 'Leave your current clan first'; end if;
 insert into clans(name,tag,description,owner_id) values(btrim(p_name),btrim(p_tag),nullif(btrim(coalesce(p_desc,'')),''),auth.uid()) returning clans.id into v_id;
 insert into clan_members(clan_id,user_id) values(v_id,auth.uid());
 perform award_badge(auth.uid(),'clan_founder');
 return v_id;
exception when unique_violation then raise exception 'That clan name or tag is already taken';
end $$;

create or replace function join_clan(p_clan uuid) returns void language plpgsql security definer set search_path=public as $$
declare n int;
begin
 if auth.uid() is null then raise exception 'Login required'; end if;
 if exists(select 1 from profiles where id=auth.uid() and suspended) then raise exception 'Account suspended'; end if;
 if not exists(select 1 from clans where id=p_clan) then raise exception 'Clan not found'; end if;
 select count(*) into n from clan_members where clan_id=p_clan;
 if n>=30 then raise exception 'This clan is full (30 members)'; end if;
 insert into clan_members(clan_id,user_id) values(p_clan,auth.uid());
 perform award_badge(auth.uid(),'clan_member');
exception when unique_violation then raise exception 'Leave your current clan first';
end $$;

create or replace function leave_clan() returns void language plpgsql security definer set search_path=public as $$
declare c clans; nxt uuid;
begin
 select cl.* into c from clans cl join clan_members m on m.clan_id=cl.id where m.user_id=auth.uid();
 if not found then raise exception 'You are not in a clan'; end if;
 delete from clan_members where user_id=auth.uid();
 if c.owner_id=auth.uid() then
  select user_id into nxt from clan_members where clan_id=c.id order by joined_at limit 1;
  if nxt is null then delete from clans where id=c.id; else update clans set owner_id=nxt where id=c.id; end if;
 end if;
end $$;

create or replace function remove_clan_member(p_user uuid) returns void language plpgsql security definer set search_path=public as $$
declare c clans;
begin
 select * into c from clans where owner_id=auth.uid();
 if not found then raise exception 'Only a clan owner can remove members'; end if;
 if p_user=auth.uid() then raise exception 'Use Leave clan instead'; end if;
 delete from clan_members where clan_id=c.id and user_id=p_user;
 insert into notifications(user_id,body) values(p_user,'You were removed from clan '||c.name);
end $$;

create or replace view clan_board as
 select c.id,c.name,c.tag,c.description,c.owner_id,
  count(m.user_id)::int as members,
  coalesce(round(avg(p.elo)),1000)::int as avg_elo,
  coalesce(sum(p.elo-1000),0)::int as score
 from clans c left join clan_members m on m.clan_id=c.id left join profiles p on p.id=m.user_id
 group by c.id order by avg_elo desc, members desc limit 100;

grant execute on function create_clan(text,text,text), join_clan(uuid), leave_clan(), remove_clan_member(uuid) to authenticated;
