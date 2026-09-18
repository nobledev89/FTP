-- Phase 10: optional metered API providers.
--
-- API modes use the same stage snapshots and database boundaries as free modes, but enabling one
-- is an explicit billed action. The confirmation is stored alongside the setting and cleared as
-- soon as the stage returns to a non-API mode. Draft and revision remain one writing selection.

drop function public.admin_update_provider_setting(public.pipeline_stage, public.provider_mode);

create function public.admin_update_provider_setting(
  p_stage public.pipeline_stage,
  p_mode public.provider_mode,
  p_confirm_api boolean
)
returns table (updated_stage public.pipeline_stage, updated_mode public.provider_mode)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.admin_users := private.require_editor();
  v_is_api boolean := private.is_api_mode(p_mode);
  v_confirmed_at timestamptz := case when private.is_api_mode(p_mode) then clock_timestamp() else null end;
  v_confirmed_by uuid := case when private.is_api_mode(p_mode) then v_member.user_id else null end;
begin
  if not (
    (p_stage in ('research', 'audit') and p_mode in ('mock', 'manual_chatgpt', 'codex_cli', 'openai_api'))
    or (p_stage = 'draft' and p_mode in ('mock', 'manual_claude', 'claude_code', 'anthropic_api'))
    or (p_stage = 'images' and p_mode in ('mock', 'manual_gemini', 'gemini_api'))
  ) then
    raise exception 'mode % is not implemented for stage %', p_mode, p_stage using errcode = '22023';
  end if;

  if v_is_api and p_confirm_api is not true then
    raise exception 'Confirm the metered API cost before enabling % for %', p_mode, p_stage
      using errcode = '22023';
  end if;

  insert into public.provider_settings as ps
    (site_id, stage, mode, updated_by, api_mode_confirmed_at, api_mode_confirmed_by)
  values
    (v_member.site_id, p_stage, p_mode, v_member.user_id, v_confirmed_at, v_confirmed_by)
  on conflict (site_id, stage) do update set
    mode = excluded.mode,
    updated_by = excluded.updated_by,
    api_mode_confirmed_at = excluded.api_mode_confirmed_at,
    api_mode_confirmed_by = excluded.api_mode_confirmed_by;

  if p_stage = 'draft' then
    insert into public.provider_settings as ps
      (site_id, stage, mode, updated_by, api_mode_confirmed_at, api_mode_confirmed_by)
    values
      (v_member.site_id, 'revision', p_mode, v_member.user_id, v_confirmed_at, v_confirmed_by)
    on conflict (site_id, stage) do update set
      mode = excluded.mode,
      updated_by = excluded.updated_by,
      api_mode_confirmed_at = excluded.api_mode_confirmed_at,
      api_mode_confirmed_by = excluded.api_mode_confirmed_by;
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

revoke all on function
  public.admin_update_provider_setting(public.pipeline_stage, public.provider_mode, boolean)
from public, anon;

grant execute on function
  public.admin_update_provider_setting(public.pipeline_stage, public.provider_mode, boolean)
to authenticated, service_role;
