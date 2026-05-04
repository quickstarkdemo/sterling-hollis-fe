import { ClerkProvider } from "@clerk/clerk-react";
import { useNavigate } from "react-router-dom";

import App from "../App";
import AuthTokenBridge from "./AuthTokenBridge";
import DatadogUserBridge from "./DatadogUserBridge";
import { CLERK_ENABLED, CLERK_PUBLISHABLE_KEY } from "../utils/clerkConfig";

export default function ClerkBoundary() {
  const navigate = useNavigate();
  const app = (
    <>
      <AuthTokenBridge />
      <DatadogUserBridge />
      <App />
    </>
  );

  if (!CLERK_ENABLED) return app;

  return (
    <ClerkProvider
      publishableKey={CLERK_PUBLISHABLE_KEY}
      routerPush={(to) => navigate(to)}
      routerReplace={(to) => navigate(to, { replace: true })}
      signInUrl="/sign-in"
      signInFallbackRedirectUrl="/"
      signUpFallbackRedirectUrl="/"
      afterSignOutUrl="/"
    >
      {app}
    </ClerkProvider>
  );
}
