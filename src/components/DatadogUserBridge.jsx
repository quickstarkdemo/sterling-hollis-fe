import { useAuth, useUser } from "@clerk/clerk-react";
import { useEffect } from "react";

import { clearDatadogUser, setDatadogUser } from "../utils/datadog";
import { CLERK_ENABLED } from "../utils/clerkConfig";

function getClerkUserName(user) {
  return user.fullName || [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username || undefined;
}

function getClerkUserEmail(user) {
  return user.primaryEmailAddress?.emailAddress || user.emailAddresses?.[0]?.emailAddress;
}

function ClerkDatadogUserBridge() {
  const { isLoaded: authLoaded, sessionId, userId } = useAuth();
  const { isLoaded: userLoaded, user } = useUser();

  useEffect(() => {
    if (!authLoaded) return;

    if (!userId) {
      clearDatadogUser();
      return;
    }

    setDatadogUser({
      id: userId,
      name: userLoaded && user ? getClerkUserName(user) : undefined,
      email: userLoaded && user ? getClerkUserEmail(user) : undefined,
      username: userLoaded && user ? user.username || undefined : undefined,
      clerk_user_id: userId,
      clerk_session_id: sessionId || undefined,
    });
  }, [authLoaded, sessionId, user, userId, userLoaded]);

  return null;
}

export default function DatadogUserBridge() {
  if (!CLERK_ENABLED) return null;
  return <ClerkDatadogUserBridge />;
}
