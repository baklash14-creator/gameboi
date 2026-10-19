-- Run after v3. Lets a tournament host see payments made for their own tournaments (read only).
create policy "host sees tournament payments" on payments for select
  using(exists(select 1 from tournaments t where t.id=tournament_id and t.host_id=auth.uid()));
