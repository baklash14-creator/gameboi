-- GAME BOI schema. Run in Supabase > SQL Editor.
create extension if not exists pgcrypto;

create table profiles(
  id uuid primary key references auth.users on delete cascade,
  username text not null check (username ~ '^[A-Za-z0-9_]{3,20}$'),
  avatar_url text, favourite_games text[] default '{}',
  suspended boolean not null default false,
  created_at timestamptz not null default now());
create unique index profiles_username_ci on profiles(lower(username));

create table user_roles(user_id uuid references auth.users on delete cascade, role text check(role in('admin')), primary key(user_id,role));
create function is_admin() returns boolean language sql stable security definer set search_path=public as
$$ select exists(select 1 from user_roles where user_id=auth.uid() and role='admin') $$;

create table games(id serial primary key, name text unique not null, slug text unique not null, active boolean not null default true);
insert into games(name,slug) values('eFootball','efootball'),('Call of Duty','call-of-duty'),('Fortnite','fortnite'),('EA SPORTS FC','ea-sports-fc');

create table tournaments(
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references profiles on delete cascade,
  game_id int not null references games,
  name text not null check(char_length(name) between 3 and 80),
  description text, rules text,
  format text not null check(format in('1v1','2v2','squad','league','knockout','other')),
  start_at timestamptz not null, register_by timestamptz not null, timezone text default 'UTC',
  max_participants int not null check(max_participants between 2 and 256),
  entry_fee numeric(12,2) not null default 0 check(entry_fee>=0),
  prize_pool numeric(12,2) not null default 0 check(prize_pool>=0),
  currency text not null default 'SLE',
  is_private boolean not null default false, invite_code text, contact text,
  status text not null default 'open' check(status in('open','closed','live','finished','cancelled')),
  created_at timestamptz not null default now(),
  check(register_by<=start_at));
create index on tournaments(game_id,status,start_at);

create table participants(
  tournament_id uuid references tournaments on delete cascade,
  user_id uuid references profiles on delete cascade,
  status text not null default 'registered' check(status in('registered','cancelled')),
  created_at timestamptz not null default now(),
  primary key(tournament_id,user_id));

create table matches(
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments on delete cascade,
  round int not null default 1,
  p1 uuid references profiles, p2 uuid references profiles,
  score1 int, score2 int,
  status text not null default 'scheduled' check(status in('scheduled','reported','confirmed','disputed','verified')),
  reported_by uuid references profiles, created_at timestamptz default now());

create table listings(
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references profiles on delete cascade,
  title text not null check(char_length(title) between 5 and 100),
  description text, price numeric(12,2) not null check(price>0), currency text not null default 'SLE',
  team_rating int check(team_rating between 0 and 5000), featured_players text,
  image_urls text[] default '{}', contact_method text, region text,
  status text not null default 'active' check(status in('active','paused','sold','removed')),
  created_at timestamptz not null default now());
create index on listings(status,price);

create table saved_listings(user_id uuid references profiles on delete cascade, listing_id uuid references listings on delete cascade, primary key(user_id,listing_id));
create table reports(id uuid primary key default gen_random_uuid(), reporter_id uuid references profiles, listing_id uuid references listings on delete cascade, reason text not null, status text default 'open', created_at timestamptz default now());
create table notifications(id uuid primary key default gen_random_uuid(), user_id uuid references profiles on delete cascade, body text not null, read boolean default false, created_at timestamptz default now());
create table audit_logs(id bigserial primary key, actor uuid, action text not null, detail jsonb, created_at timestamptz default now());

-- Leaderboard computed only from verified matches
create view leaderboard as
with r as(
 select p1 as uid, (score1>score2)::int w, (score1<score2)::int l, (score1=score2)::int d from matches where status='verified'
 union all
 select p2, (score2>score1)::int, (score2<score1)::int, (score1=score2)::int from matches where status='verified')
select p.id, p.username, p.avatar_url, sum(w) wins, sum(l) losses, sum(d) draws, sum(w)*3+sum(d) points
from r join profiles p on p.id=r.uid where p.suspended=false group by p.id order by points desc limit 100;

-- Auto-create profile on signup (username from signup metadata)
create function handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
begin insert into profiles(id,username) values(new.id,new.raw_user_meta_data->>'username'); return new; end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

-- Safe registration: locks tournament row, checks deadline/capacity
create function register_for_tournament(t uuid, code text default null) returns text language plpgsql security definer set search_path=public as $$
declare tr tournaments; n int;
begin
 if auth.uid() is null then raise exception 'Login required'; end if;
 select * into tr from tournaments where id=t for update;
 if not found or tr.status<>'open' or now()>tr.register_by then raise exception 'Registration closed'; end if;
 if tr.is_private and coalesce(tr.invite_code,'')<>coalesce(code,'') then raise exception 'Invalid invite code'; end if;
 select count(*) into n from participants where tournament_id=t and status='registered';
 if n>=tr.max_participants then raise exception 'Tournament is full'; end if;
 insert into participants(tournament_id,user_id) values(t,auth.uid())
  on conflict(tournament_id,user_id) do update set status='registered' where participants.status='cancelled';
 insert into notifications(user_id,body) values(auth.uid(),'Registered for '||tr.name);
 return 'ok';
exception when unique_violation then raise exception 'Already registered';
end $$;

-- RLS
alter table profiles enable row level security; alter table user_roles enable row level security;
alter table games enable row level security; alter table tournaments enable row level security;
alter table participants enable row level security; alter table matches enable row level security;
alter table listings enable row level security; alter table saved_listings enable row level security;
alter table reports enable row level security; alter table notifications enable row level security;
alter table audit_logs enable row level security;

create policy "profiles read" on profiles for select using(true);
create policy "profiles update own" on profiles for update using(id=auth.uid()) with check(id=auth.uid() and suspended=false);
create policy "games read" on games for select using(active or is_admin());
create policy "games admin" on games for all using(is_admin()) with check(is_admin());
create policy "tourn read" on tournaments for select using(not is_private or host_id=auth.uid() or is_admin());
create policy "tourn create" on tournaments for insert with check(host_id=auth.uid() and not exists(select 1 from profiles where id=auth.uid() and suspended));
create policy "tourn host edit" on tournaments for update using(host_id=auth.uid() and status in('open','closed') or is_admin());
create policy "part read" on participants for select using(true);
create policy "part cancel own" on participants for update using(user_id=auth.uid()) with check(user_id=auth.uid() and status='cancelled');
create policy "matches read" on matches for select using(true);
create policy "host manage matches" on matches for all using(exists(select 1 from tournaments t where t.id=tournament_id and t.host_id=auth.uid()) and status<>'verified' or is_admin())
 with check(exists(select 1 from tournaments t where t.id=tournament_id and t.host_id=auth.uid()) and status<>'verified' or is_admin());
create policy "listings read" on listings for select using(status in('active','sold') or seller_id=auth.uid() or is_admin());
create policy "listings insert" on listings for insert with check(seller_id=auth.uid());
create policy "listings update" on listings for update using(seller_id=auth.uid() or is_admin());
create policy "listings delete" on listings for delete using(seller_id=auth.uid() or is_admin());
create policy "saved own" on saved_listings for all using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy "report create" on reports for insert with check(reporter_id=auth.uid());
create policy "report admin read" on reports for select using(is_admin());
create policy "report admin update" on reports for update using(is_admin());
create policy "notif own" on notifications for select using(user_id=auth.uid());
create policy "notif mark read" on notifications for update using(user_id=auth.uid());
create policy "audit admin" on audit_logs for select using(is_admin());
create policy "roles own read" on user_roles for select using(user_id=auth.uid());
-- Make an admin manually (SQL editor only, never from the app):
-- insert into user_roles values('<USER_UUID>','admin');
-- Storage: create a public bucket "listing-images" (images only, 2MB limit) in Supabase Storage.
