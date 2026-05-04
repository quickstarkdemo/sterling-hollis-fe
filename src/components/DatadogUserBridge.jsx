import { useAuth, useUser } from "@clerk/clerk-react";
import { useEffect } from "react";

import {
  clearDatadogAuthContext,
  clearDatadogUser,
  setDatadogAuthContext,
  setDatadogUser,
} from "../utils/datadog";
import { CLERK_ENABLED } from "../utils/clerkConfig";

function getClerkUserName(user) {
  return user.fullName || [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username || undefined;
}

function getClerkUserEmail(user) {
  return user.primaryEmailAddress?.emailAddress || user.emailAddresses?.[0]?.emailAddress;
}

function getDatadogUserName(user, userId) {
  const email = user ? getClerkUserEmail(user) : "";
  return (user && getClerkUserName(user)) || email || userId;
}

function ClerkDatadogUserBridge() {
  const { isLoaded: authLoaded, sessionId, userId } = useAuth();
  const { isLoaded: userLoaded, user } = useUser();

  useEffect(() => {
    if (!authLoaded) return;

    if (!userId) {
      clearDatadogUser();
      clearDatadogAuthContext();
      return;
    }

    const email = userLoaded && user ? getClerkUserEmail(user) : undefined;

    setDatadogUser({
      id: userId,
      name: userLoaded && user ? getDatadogUserName(user, userId) : userId,
      email,
      username: userLoaded && user ? user.username || undefined : undefined,
      auth_provider: "clerk",
      auth_status: "authenticated",
      is_authenticated: true,
      clerk_user_id: userId,
      clerk_session_id: sessionId || undefined,
    });

    setDatadogAuthContext({
      provider: "clerk",
      status: "authenticated",
      isAuthenticated: true,
      clerkUserId: userId,
      clerkSessionId: sessionId || undefined,
    });
  }, [authLoaded, sessionId, user, userId, userLoaded]);

  return null;
}

export default function DatadogUserBridge() {
  if (!CLERK_ENABLED) return null;
  return <ClerkDatadogUserBridge />;
}
