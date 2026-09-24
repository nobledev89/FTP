/** Form state shared by the contact Server Action and the form (kept out of the "use server" file). */
export type ContactFormState = Readonly<{
  status: "idle" | "sent" | "error";
  message: string;
}>;

export const idleContactFormState: ContactFormState = { status: "idle", message: "" };
