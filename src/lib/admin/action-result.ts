/**
 * Result shape shared by the admin Server Actions and the forms that call them.
 *
 * It lives outside the `"use server"` modules on purpose: those may export async functions only,
 * so a constant or a type declared there would fail the build.
 */
export type ActionResult =
  Readonly<{ ok: true; message: string }> | Readonly<{ ok: false; error: string }>;

/** Starting value for `useActionState`: nothing has been submitted, so nothing is reported. */
export const idleActionResult: ActionResult = { ok: true, message: "" };
