/**
 * Login cookies last 400 days (the maximum browsers allow) and are renewed on every visit,
 * so people stay signed in on their phone, including the home-screen app, until they sign out.
 */
export const AUTH_COOKIE_OPTIONS = {
  maxAge: 60 * 60 * 24 * 400,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};
