-- Run AFTER supabase_schema.sql. Fixtures, score flow, standings, admin actions.
alter table matches add column if not exists seq bigserial;
drop policy if exists "host manage matches" on matches; -- all result writes now go through functions below

create function tournament_standings(p_t uuid) returns table(username text,played int,w int,d int,l int,pts int)
language sql stable security definer set search_path=public as $$
 with r as(select p1 u,(score1>score2)::int w,(score1=score2)::int d,(score1<score2)::int l from matches where tournament_id=p_t and status='verified' and p2 is not null
  union all select p2,(score2>score1)::int,(score1=score2)::int,(score2<score1)::int from matches where tournament_id=p_t and status='verified' and p2 is not null)
 select p.username,count(*)::int,sum(w)::int,sum(d)::int,sum(l)::int,(sum(w)*3+sum(d))::int from r join profiles p on p.id=r.u group by p.username order by 6 desc $$;

create function generate_fixtures(p_t uuid) returns void language plpgsql security definer set search_path=public as $$
declare tr tournaments; ids uuid[]; n int; sz int:=1; i int; j int;
begin
 select * into tr from tournaments where id=p_t for update;
 if not found or tr.host_id<>auth.uid() then raise exception 'Not allowed'; end if;
 if tr.status not in('open','closed') or exists(select 1 from matches where tournament_id=p_t) then raise exception 'Fixtures already generated'; end if;
 select array_agg(user_id order by random()) into ids from participants where tournament_id=p_t and status='registered';
 n:=coalesce(array_length(ids,1),0);
 if n<2 then raise exception 'Need at least 2 players'; end if;
 if tr.format='league' then
  for i in 1..n loop for j in i+1..n loop insert into matches(tournament_id,round,p1,p2) values(p_t,1,ids[i],ids[j]); end loop; end loop;
 else
  while sz<n loop sz:=sz*2; end loop;
  for i in 1..sz/2 loop
   insert into matches(tournament_id,round,p1,p2,status) values(p_t,1,ids[i],case when sz+1-i<=n then ids[sz+1-i] end,case when sz+1-i<=n then 'scheduled' else 'verified' end);
  end loop;
 end if;
 update tournaments set status='live' where id=p_t;
end $$;

create function generate_next_round(p_t uuid) returns void language plpgsql security definer set search_path=public as $$
declare tr tournaments; r int; w uuid[]; i int;
begin
 select * into tr from tournaments where id=p_t for update;
 if not found or tr.host_id<>auth.uid() then raise exception 'Not allowed'; end if;
 if tr.format='league' then raise exception 'Leagues have no rounds'; end if;
 select max(round) into r from matches where tournament_id=p_t;
 if r is null then raise exception 'Generate fixtures first'; end if;
 if exists(select 1 from matches where tournament_id=p_t and round=r and status<>'verified') then raise exception 'Finish and confirm all matches first'; end if;
 select array_agg(case when p2 is null or score1>score2 then p1 else p2 end order by seq) into w from matches where tournament_id=p_t and round=r;
 if array_length(w,1)=1 then update tournaments set status='finished' where id=p_t; return; end if;
 for i in 1..array_length(w,1)/2 loop insert into matches(tournament_id,round,p1,p2) values(p_t,r+1,w[2*i-1],w[2*i]); end loop;
end $$;

create function report_score(p_m uuid,p_s1 int,p_s2 int) returns void language plpgsql security definer set search_path=public as $$
declare m matches; tr tournaments;
begin
 select * into m from matches where id=p_m for update; select * into tr from tournaments where id=m.tournament_id;
 if not found or tr.host_id<>auth.uid() then raise exception 'Only the host can report scores'; end if;
 if m.status<>'scheduled' or m.p2 is null then raise exception 'Match cannot be reported'; end if;
 if p_s1<0 or p_s2<0 then raise exception 'Invalid score'; end if;
 if tr.format<>'league' and p_s1=p_s2 then raise exception 'Knockout matches cannot be drawn'; end if;
 update matches set score1=p_s1,score2=p_s2,status='reported',reported_by=auth.uid() where id=p_m;
 insert into notifications(user_id,body) values(m.p1,'Score reported in '||tr.name||'. Please confirm or dispute.'),(m.p2,'Score reported in '||tr.name||'. Please confirm or dispute.');
end $$;

create function confirm_score(p_m uuid) returns void language plpgsql security definer set search_path=public as $$
declare m matches;
begin select * into m from matches where id=p_m for update;
 if not found or m.status<>'reported' or auth.uid() not in(m.p1,m.p2) then raise exception 'Not allowed'; end if;
 update matches set status='verified' where id=p_m; end $$;

create function dispute_score(p_m uuid) returns void language plpgsql security definer set search_path=public as $$
declare m matches;
begin select * into m from matches where id=p_m for update;
 if not found or m.status<>'reported' or auth.uid() not in(m.p1,m.p2) then raise exception 'Not allowed'; end if;
 update matches set status='disputed' where id=p_m;
 insert into notifications(user_id,body) select user_id,'A match score was disputed.' from user_roles where role='admin'; end $$;

create function admin_resolve(p_m uuid,p_s1 int,p_s2 int) returns void language plpgsql security definer set search_path=public as $$
begin if not is_admin() then raise exception 'Admins only'; end if;
 update matches set score1=p_s1,score2=p_s2,status='verified' where id=p_m;
 insert into audit_logs(actor,action,detail) values(auth.uid(),'resolve_dispute',jsonb_build_object('match',p_m,'s1',p_s1,'s2',p_s2)); end $$;

create function admin_set_listing(p_l uuid,p_s text) returns void language plpgsql security definer set search_path=public as $$
begin if not is_admin() then raise exception 'Admins only'; end if;
 update listings set status=p_s where id=p_l;
 update reports set status='actioned' where listing_id=p_l and status='open';
 insert into audit_logs(actor,action,detail) values(auth.uid(),'set_listing',jsonb_build_object('listing',p_l,'status',p_s)); end $$;

create function admin_set_suspended(p_u uuid,p_b boolean) returns void language plpgsql security definer set search_path=public as $$
begin if not is_admin() then raise exception 'Admins only'; end if;
 update profiles set suspended=p_b where id=p_u;
 insert into audit_logs(actor,action,detail) values(auth.uid(),'suspend',jsonb_build_object('user',p_u,'suspended',p_b)); end $$;
