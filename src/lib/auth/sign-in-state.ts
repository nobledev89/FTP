/**
 * State passed between the sign-in form and its Server Action. Declared outside the `"use server"`
 * module, which may export async functions only.
 */
export type SignInState = Readonly<{
  /** Message to show above the form; null on the first render. */
  error: string | null;
  /** Echoed back so a failed attempt does not clear the field. */
  email: string;
}>;

export const initialSignInState: SignInState = { error: null, email: "" };
