-- Phase 6: prompt version authoring and activation.
--
-- Prompt bodies are immutable. Editing creates a new version, while activation (including rollback)
-- is the only permitted update. Both operations authorize the caller again inside the database.

create function public.admin_create_prompt_version(
  p_key text,
  p_content text,
  p_notes text default null,
  p_variables_schema jsonb default '{}'::jsonb,
  p_activate boolean default true
)
returns table (template_id uuid, version integer, is_active boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.admin_users := private.require_editor();
  v_key text := btrim(coalesce(p_key, ''));
  v_content text := btrim(coalesce(p_content, ''));
  v_version integer;
  v_row public.prompt_templates;
begin
  if v_key !~ '^[a-z][a-z0-9-]{1,63}$' then
    raise exception 'prompt key is invalid' using errcode = '22023';
  end if;
  if char_length(v_content) = 0 or char_length(v_content) > 100000 then
    raise exception 'prompt content must contain between 1 and 100000 characters' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_variables_schema, '{}'::jsonb)) <> 'object' then
    raise exception 'prompt variables schema must be an object' using errcode = '22023';
  end if;

  -- Serialize version allocation for one site/key even when two editors save simultaneously.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_member.site_id::text || ':' || v_key, 0)
  );
  select coalesce(max(t.version), 0) + 1 into v_version
  from public.prompt_templates t
  where t.site_id = v_member.site_id and t.key = v_key;

  if coalesce(p_activate, true) then
    update public.prompt_templates t
    set is_active = false
    where t.site_id = v_member.site_id and t.key = v_key and t.is_active;
  end if;

  insert into public.prompt_templates
    (site_id, key, version, content, variables_schema, notes, is_active, created_by)
  values
    (v_member.site_id, v_key, v_version, v_content, coalesce(p_variables_schema, '{}'::jsonb),
     nullif(btrim(coalesce(p_notes, '')), ''), coalesce(p_activate, true), v_member.user_id)
  returning * into v_row;

  if v_key = 'editorial-style' and v_row.is_active then
    update public.site_settings
    set style_guide_template_id = v_row.id, updated_by = v_member.user_id
    where site_id = v_member.site_id;
  end if;

  return query select v_row.id, v_row.version, v_row.is_active;
end;
$$;

create function public.admin_activate_prompt_template(p_template_id uuid)
returns table (template_id uuid, key text, version integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.admin_users := private.require_editor();
  v_target public.prompt_templates;
begin
  select * into v_target
  from public.prompt_templates
  where id = p_template_id and site_id = v_member.site_id
  for update;

  if v_target.id is null then
    raise exception 'prompt template % not found', p_template_id using errcode = 'P0002';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_member.site_id::text || ':' || v_target.key, 0)
  );
  update public.prompt_templates t
  set is_active = false
  where t.site_id = v_member.site_id and t.key = v_target.key and t.is_active and t.id <> v_target.id;
  update public.prompt_templates t set is_active = true where t.id = v_target.id;

  if v_target.key = 'editorial-style' then
    update public.site_settings
    set style_guide_template_id = v_target.id, updated_by = v_member.user_id
    where site_id = v_member.site_id;
  end if;

  return query select v_target.id, v_target.key, v_target.version;
end;
$$;

grant execute on function
  public.admin_create_prompt_version(text, text, text, jsonb, boolean),
  public.admin_activate_prompt_template(uuid)
to authenticated, service_role;
