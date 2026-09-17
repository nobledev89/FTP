-- Storage buckets and policies (plan section 7.4).
--   article-work    private working assets: manual uploads and generated images before approval
--   article-public  public-read copies made by the publishing service at publication time

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('article-work', 'article-work', false, 10485760, array['image/png', 'image/jpeg', 'image/webp', 'image/avif']),
  ('article-public', 'article-public', true, 10485760, array['image/png', 'image/jpeg', 'image/webp', 'image/avif'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Working objects live under jobs/<job uuid>/...; the job must exist.
create function private.is_work_object_path(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_name ~ '^jobs/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9._/-]+$'
    and position('..' in p_name) = 0
    and exists (select 1 from public.article_jobs j where j.id = split_part(p_name, '/', 2)::uuid);
$$;

revoke execute on function private.is_work_object_path(text) from public, anon, service_role;
grant execute on function private.is_work_object_path(text) to authenticated;

create policy "Admins read working assets"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'article-work' and (select private.is_admin()));

-- Uploads are immutable: no update or delete policies exist for browser roles.
create policy "Editors upload working assets"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'article-work'
    and (select private.can_edit())
    and private.is_work_object_path(name)
  );

-- article-public is readable through public object URLs. No policy grants listing or writes to
-- browser roles; only the service role (publishing service) copies approved assets into it.
