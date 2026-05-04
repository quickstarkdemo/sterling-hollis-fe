import { useUser } from "@clerk/clerk-react";
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
  const { isLoaded, user } = useUser();

  useEffect(() => {
    if (!isLoaded) return;

    if (!user) {
      clearDatadogUser();
      return;
    }

    setDatadogUser({
      id: user.id,
      name: getClerkUserName(user),
      email: getClerkUserEmail(user),
      username: user.username || undefined,
      clerk_user_id: user.id,
    });
  }, [isLoaded, user]);

  return null;
}

export default function DatadogUserBridge() {
  if (!CLERK_ENABLED) return null;
  return <ClerkDatadogUserBridge />;
}
