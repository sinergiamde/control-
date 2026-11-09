import { supabase } from "@/integrations/supabase/client";

/** Emails a secure link that lands on /reset-password, where the person must choose a new password.
 * Resolves with an error message, or null on success (the same answer whether or not the email has
 * an account, so this can't be used to discover who is registered). */
export const sendPasswordRecovery = async (email: string): Promise<string | null> => {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: `${window.location.origin}/reset-password`,
  });
  return error ? error.message : null;
};
