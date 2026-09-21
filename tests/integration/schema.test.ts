import { afterAll, describe, expect, it } from "vitest";

import { JOB_TRANSITIONS } from "@/lib/state-machine/transitions";

import { closeDb, db, serviceClient } from "./helpers/clients";

afterAll(closeDb);

async function rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db().query(sql, params)).rows as T[];
}

describe("migrations", () => {
  it("enable row level security on every table in public", async () => {
    const tables = await rows<{ relname: string; relrowsecurity: boolean }>(`
      select c.relname, c.relrowsecurity
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')
      order by c.relname
    `);
    expect(tables.length).toBeGreaterThanOrEqual(20);
    expect(tables.filter((table) => !table.relrowsecurity).map((table) => table.relname)).toEqual(
      [],
    );
  });

  it("grants anon only SELECT on publication-safe tables", async () => {
    const grants = await rows<{ table_name: string; privilege_type: string }>(`
      select table_name, privilege_type from information_schema.role_table_grants
      where grantee = 'anon' and table_schema = 'public'
      order by table_name, privilege_type
    `);
    expect(grants).toEqual([
      { table_name: "article_slug_aliases", privilege_type: "SELECT" },
      { table_name: "articles", privilege_type: "SELECT" },
      { table_name: "sites", privilege_type: "SELECT" },
    ]);
  });

  it("grants authenticated no write privileges on any table", async () => {
    const writes = await rows<{ table_name: string; privilege_type: string }>(`
      select table_name, privilege_type from information_schema.role_table_grants
      where grantee = 'authenticated' and table_schema = 'public' and privilege_type <> 'SELECT'
    `);
    expect(writes).toEqual([]);
  });

  it("exposes no public functions to anon and only admin functions to authenticated", async () => {
    const executable = await rows<{ role: string; name: string }>(`
      select r.role, p.proname as name
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      cross join (values ('anon'), ('authenticated')) r(role)
      where n.nspname = 'public' and has_function_privilege(r.role, p.oid, 'execute')
      order by r.role, p.proname
    `);
    expect(executable).toEqual([
      { role: "authenticated", name: "admin_activate_prompt_template" },
      { role: "authenticated", name: "admin_attach_hero_replacement_image" },
      { role: "authenticated", name: "admin_cancel_hero_replacement" },
      { role: "authenticated", name: "admin_complete_manual_images" },
      { role: "authenticated", name: "admin_create_prompt_version" },
      { role: "authenticated", name: "admin_dashboard" },
      { role: "authenticated", name: "admin_discard_job" },
      { role: "authenticated", name: "admin_import_manual_image" },
      { role: "authenticated", name: "admin_import_manual_result" },
      { role: "authenticated", name: "admin_request_discovery_scan" },
      { role: "authenticated", name: "admin_request_hero_replacement" },
      { role: "authenticated", name: "admin_reschedule_job" },
      { role: "authenticated", name: "admin_review_hero_replacement" },
      { role: "authenticated", name: "admin_transition_job" },
      { role: "authenticated", name: "admin_update_discovery_settings" },
      { role: "authenticated", name: "admin_update_provider_setting" },
      { role: "authenticated", name: "admin_update_site_identity" },
      { role: "authenticated", name: "admin_update_site_settings" },
      { role: "authenticated", name: "admin_update_topic_category" },
      { role: "authenticated", name: "admin_withdraw_article" },
      { role: "authenticated", name: "create_article_job" },
    ]);
  });

  it("reserves worker functions for the service role", async () => {
    const workerFunctions = [
      "worker_begin_topic_discovery",
      "worker_create_discovered_job",
      "worker_finish_topic_discovery",
      "claim_next_job",
      "renew_lease",
      "complete_stage",
      "request_manual_action",
      "fail_stage",
      "publish_article",
      "record_verification",
      "recover_expired_leases",
      "heartbeat_worker",
      "worker_status",
    ];
    const allowed = await rows<{ name: string; service: boolean }>(
      `select p.proname as name, has_function_privilege('service_role', p.oid, 'execute') as service
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = any($1)`,
      [workerFunctions],
    );
    expect(allowed).toHaveLength(workerFunctions.length);
    expect(allowed.every((fn) => fn.service)).toBe(true);
  });

  it("grants API roles only the private helpers that policies and constraints need", async () => {
    const granted = await rows<{ role: string; name: string }>(`
      select r.role, p.proname as name
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      cross join (values ('anon'), ('authenticated'), ('service_role')) r(role)
      where n.nspname = 'private' and has_function_privilege(r.role, p.oid, 'execute')
      order by r.role, p.proname
    `);
    expect(granted).toEqual([
      { role: "authenticated", name: "admin_role" },
      { role: "authenticated", name: "can_edit" },
      { role: "authenticated", name: "is_admin" },
      { role: "authenticated", name: "is_hero_replacement_upload_path" },
      { role: "authenticated", name: "is_manual_image_upload_path" },
      { role: "service_role", name: "is_active_status" },
      { role: "service_role", name: "is_api_mode" },
      { role: "service_role", name: "is_pausable_status" },
      { role: "service_role", name: "provider_mode_allowed" },
      { role: "service_role", name: "provider_of_mode" },
    ]);
  });

  it("does not let any API role run the owner bootstrap", async () => {
    const result = await rows<{ role: string; allowed: boolean }>(`
      select r.role, has_function_privilege(r.role, 'private.bootstrap_first_owner(text, text)', 'execute') as allowed
      from (values ('anon'), ('authenticated'), ('service_role')) r(role)
    `);
    expect(result.every((row) => !row.allowed)).toBe(true);
  });

  it("bootstraps exactly one first owner from an existing auth user", async () => {
    const email = `owner-${crypto.randomUUID().slice(0, 8)}@example.test`;
    const { error } = await serviceClient().auth.admin.createUser({
      email,
      password: `Owner-${crypto.randomUUID()}`,
      email_confirm: true,
    });
    expect(error).toBeNull();

    const client = await db().connect();
    try {
      await client.query("begin");
      await client.query("delete from public.admin_users where role = 'owner'");
      await expect(
        client.query("select private.bootstrap_first_owner('missing@example.test')"),
      ).rejects.toThrow(/no auth user/);
      await client.query("rollback");

      await client.query("begin");
      await client.query("delete from public.admin_users where role = 'owner'");
      const { rows } = await client.query("select private.bootstrap_first_owner($1) as user_id", [
        email.toUpperCase(),
      ]);
      const membership = await client.query(
        "select role::text from public.admin_users where user_id = $1",
        [rows[0].user_id],
      );
      expect(membership.rows).toEqual([{ role: "owner" }]);
      await expect(
        client.query("select private.bootstrap_first_owner($1)", [email]),
      ).rejects.toThrow(/already exists/);
    } finally {
      await client.query("rollback");
      client.release();
    }
  });

  it("keeps the private schema out of the Data API", async () => {
    const [config] = await rows<{ setting: string | null }>(
      "select current_setting('pgrst.db_schemas', true) as setting",
    );
    expect(config?.setting ?? "public,graphql_public").not.toContain("private");
  });

  it("encodes the normal path and exceptional transitions from the plan", async () => {
    const transitions = await rows<{ from_status: string; to_status: string; path: string }>(
      "select from_status::text, to_status::text, path from private.job_transitions",
    );
    const has = (from: string, to: string) =>
      transitions.some((t) => t.from_status === from && t.to_status === to);

    expect(transitions.filter((t) => t.path === "normal")).toHaveLength(22);
    expect(has("PUBLISHING", "PUBLISHED")).toBe(true);
    expect(has("PUBLISHED", "VERIFIED")).toBe(true);
    expect(has("RESEARCHING", "PAUSED")).toBe(true);
    expect(has("PUBLISHING", "PAUSED")).toBe(false);
    expect(transitions.filter((t) => t.from_status === "VERIFIED")).toEqual([]);
    // Only resuming a paused idea returns a job to IDEA.
    expect(transitions.filter((t) => t.to_status === "IDEA")).toEqual([
      { from_status: "PAUSED", to_status: "IDEA", path: "resume" },
    ]);
    expect(has("APPROVED", "PUBLISHED")).toBe(false);
    expect(has("PUBLISHED", "FAILED")).toBe(false);
  });

  it("stays in exact parity with the pure TypeScript transition map", async () => {
    const databaseTransitions = await rows<{
      from_status: string;
      to_status: string;
      path: string;
    }>(`
      select from_status::text, to_status::text, path
      from private.job_transitions
      order by from_status::text, to_status::text
    `);
    const applicationTransitions = JOB_TRANSITIONS.map(({ from, to, path }) => ({
      from_status: from,
      to_status: to,
      path,
    })).sort((left, right) =>
      `${left.from_status}>${left.to_status}`.localeCompare(
        `${right.from_status}>${right.to_status}`,
      ),
    );

    expect(databaseTransitions).toEqual(applicationTransitions);
  });

  it("seeds the UK publication and non-billable provider defaults", async () => {
    const [site] = await rows<{
      canonical_origin: string;
      locale: string;
      timezone: string;
      currency: string;
    }>(
      "select canonical_origin, locale, timezone, currency from public.sites where slug = 'fintechpulse'",
    );
    expect(site).toEqual({
      canonical_origin: "https://fintechpulse.co.uk",
      locale: "en-GB",
      timezone: "Europe/London",
      currency: "GBP",
    });
    const modes = await rows<{ stage: string; mode: string }>(
      "select stage::text, mode::text from public.provider_settings order by stage",
    );
    expect(Object.fromEntries(modes.map((m) => [m.stage, m.mode]))).toEqual({
      research: "manual_chatgpt",
      draft: "claude_code",
      revision: "claude_code",
      images: "manual_gemini",
      audit: "manual_chatgpt",
      publish: "internal",
      verify: "internal",
    });
  });

  it("rejects secrets in provider settings and unconfirmed API modes", async () => {
    const [site] = await rows<{ id: string }>(
      "select id from public.sites where slug = 'fintechpulse'",
    );
    await expect(
      db().query(
        "update public.provider_settings set settings = '{\"api_key\": \"sk-test\"}' where site_id = $1 and stage = 'research'",
        [site!.id],
      ),
    ).rejects.toThrow(/check constraint/);
    await expect(
      db().query(
        "update public.provider_settings set mode = 'openai_api' where site_id = $1 and stage = 'research'",
        [site!.id],
      ),
    ).rejects.toThrow(/check constraint/);
  });
});
