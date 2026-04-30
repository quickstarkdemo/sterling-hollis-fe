import { useAuth } from "@clerk/clerk-react";
import { useEffect } from "react";

import { setAuthTokenGetter } from "../utils/apiClient";
import { CLERK_ENABLED } from "../utils/clerkConfig";

function ClerkAuthTokenBridge() {
  const { getToken, isSignedIn } = useAuth();

  useEffect(() => {
    setAuthTokenGetter(async () => {
      if (!isSignedIn) return null;
      return getToken();
    });
    return () => setAuthTokenGetter(null);
  }, [getToken, isSignedIn]);

  return null;
}

export default function AuthTokenBridge() {
  if (!CLERK_ENABLED) return null;
  return <ClerkAuthTokenBridge />;
}
