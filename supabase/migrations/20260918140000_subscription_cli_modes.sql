-- Phase 9: subscription CLI providers.
--
-- The worker now has adapters for Codex (research and audit) and Claude Code (writing and
-- revision), so editors may select them as publication defaults. The function is otherwise
-- unchanged from 20260918130000_manual_workflows.sql: draft and revision still share the job's
-- single writing-mode snapshot, and API modes stay unavailable until Phase 10 adds their adapters
-- and confirmation flow. `create or replace` keeps the existing grants.

create or replace function public.admin_update_provider_setting(
  p_stage public.pipeline_stage,
  p_mode public.provider_mode
)
returns table (updated_stage public.pipeline_stage, updated_mode public.provider_mode)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.admin_users := private.require_editor();
begin
  if not (
    (p_stage in ('research', 'audit') and p_mode in ('mock', 'manual_chatgpt', 'codex_cli'))
    or (p_stage = 'draft' and p_mode in ('mock', 'manual_claude', 'claude_code'))
    or (p_stage = 'images' and p_mode in ('mock', 'manual_gemini'))
  ) then
    raise exception 'mode % is not implemented for stage %', p_mode, p_stage using errcode = '22023';
  end if;

  insert into public.provider_settings as ps (site_id, stage, mode, updated_by)
  values (v_member.site_id, p_stage, p_mode, v_member.user_id)
  on conflict (site_id, stage) do update set mode = excluded.mode, updated_by = excluded.updated_by,
    api_mode_confirmed_at = null, api_mode_confirmed_by = null;

  if p_stage = 'draft' then
    insert into public.provider_settings as ps (site_id, stage, mode, updated_by)
    values (v_member.site_id, 'revision', p_mode, v_member.user_id)
    on conflict (site_id, stage) do update set mode = excluded.mode, updated_by = excluded.updated_by,
      api_mode_confirmed_at = null, api_mode_confirmed_by = null;
  end if;

  return query
    select ps.stage, ps.mode from public.provider_settings ps
    where ps.site_id = v_member.site_id
      and ps.stage = any (case when p_stage = 'draft'
        then array['draft', 'revision']::public.pipeline_stage[]
        else array[p_stage]::public.pipeline_stage[] end)
    order by ps.stage;
end;
$$;
