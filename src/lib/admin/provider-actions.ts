"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { authorizeAdminAction } from "@/lib/auth/dal";
import { toWorkflowError } from "@/lib/state-machine/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { providerModeSchema } from "@/lib/validation/domain";

import type { ActionResult } from "./action-result";
import { isImplementedMode } from "./provider-modes";

const providerSettingSchema = z
  .object({
    stage: z.enum(["research", "draft", "images", "audit"]),
    mode: providerModeSchema,
  })
  .refine(({ stage, mode }) => isImplementedMode(stage, mode), {
    message: "That mode has no worker adapter yet.",
    path: ["mode"],
  });

export async function updateProviderSettingAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await authorizeAdminAction("write");
    const parsed = providerSettingSchema.safeParse({
      stage: formData.get("stage"),
      mode: formData.get("mode"),
    });
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid provider setting." };
    }

    const client = await createSupabaseServerClient();
    const { error } = await client.rpc("admin_update_provider_setting", {
      p_stage: parsed.data.stage,
      p_mode: parsed.data.mode,
    });
    if (error) throw toWorkflowError(error);

    revalidatePath("/admin/providers");
    revalidatePath("/admin/articles/new");
    return { ok: true, message: "Provider default updated for new jobs." };
  } catch (error) {
    return { ok: false, error: toWorkflowError(error).message };
  }
}
