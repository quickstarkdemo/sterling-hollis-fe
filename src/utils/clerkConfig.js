export const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || "";
export const CLERK_ENABLED = Boolean(CLERK_PUBLISHABLE_KEY);
