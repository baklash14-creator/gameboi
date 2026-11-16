-- GAME BOI v5: photo uploads for marketplace listings.
-- Run once in Supabase -> SQL Editor (after v1 to v4). Safe to re-run.
-- This creates the public bucket "listing-images" and lets each signed-in user
-- upload and delete photos only inside their own folder (named with their user id).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('listing-images', 'listing-images', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = true, file_size_limit = 2097152, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "listing images read" on storage.objects;
create policy "listing images read" on storage.objects for select
  using (bucket_id = 'listing-images');

drop policy if exists "listing images upload own folder" on storage.objects;
create policy "listing images upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'listing-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "listing images delete own" on storage.objects;
create policy "listing images delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'listing-images' and (storage.foldername(name))[1] = auth.uid()::text);
