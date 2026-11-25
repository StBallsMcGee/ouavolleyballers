/** Emails as typed on phones: keyboards add capitals and trailing spaces. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Supabase's sign-in errors, in plain words with what to do next. */
export function friendlyAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) return "That email and password don't match. Check for typos, or use \"Forgot your password?\" to get a code by email.";
  if (m.includes("email not confirmed")) return "This account hasn't been confirmed yet. Use \"Email me a code\" to sign in, or ask the league admin.";
  if (m.includes("rate limit") || m.includes("too many") || m.includes("security purposes")) return "Too many emails or attempts in a short time. Wait a few minutes, or sign in with your password. The league admin can also set a temporary password for you.";
  if (m.includes("signups not allowed") || m.includes("user not found")) return "There's no account with that email. Check the spelling, or join with the league's invite link.";
  if (m.includes("expired") || (m.includes("invalid") && m.includes("token")) || m.includes("otp")) return "That code has expired or isn't right. Request a new one and use the newest email.";
  if (m.includes("same password") || m.includes("should be different")) return "Choose a password different from your old one.";
  if (m.includes("password") && m.includes("characters")) return "Use at least 8 characters.";
  if (m.includes("fetch") || m.includes("network")) return "Couldn't reach the sign-in service. Check your connection and try again.";
  return message || "Sign-in failed. Please try again.";
}
