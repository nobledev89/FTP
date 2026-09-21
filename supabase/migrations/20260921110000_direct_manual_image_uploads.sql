-- Browser image bytes go straight to private Storage so Vercel's function request limit does not
-- cap the documented 10 MiB file size. The upload path itself is now authorized against the live
-- manual-image run; the Server Action still downloads and inspects the stored bytes before import.

create function private.is_manual_image_upload_path(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_match text[];
  v_job_id uuid;
  v_run_id uuid;
  v_slot integer;
begin
  if p_name is null or position('..' in p_name) > 0 then
    return false;
  end if;

  v_match := pg_catalog.regexp_match(
    p_name,
    '^jobs/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/manual/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/slot-([0-9]+)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp|avif)$'
  );
  if v_match is null then
    return false;
  end if;

  v_job_id := v_match[1]::uuid;
  v_run_id := v_match[2]::uuid;
  v_slot := v_match[3]::integer;

  return exists (
    select 1
    from public.article_jobs j
    join public.provider_runs r on r.id = v_run_id and r.job_id = j.id
    where j.id = v_job_id
      and j.status = 'IMAGES_PROCESSING'
      and j.action_required_kind = 'manual_input'
      and j.action_required_run_id = r.id
      and v_slot >= 0 and v_slot < j.image_count
      and r.stage = 'images'
      and r.mode = 'manual_gemini'
      and r.status = 'action_required'
  );
end;
$$;

revoke execute on function private.is_manual_image_upload_path(text) from public, anon, service_role;
grant execute on function private.is_manual_image_upload_path(text) to authenticated;
revoke execute on function private.is_work_object_path(text) from authenticated;

drop policy "Editors upload working assets" on storage.objects;
create policy "Editors upload current manual images"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'article-work'
    and (select private.can_edit())
    and private.is_manual_image_upload_path(name)
  );
