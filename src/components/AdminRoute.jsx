import { useAuth } from "@clerk/clerk-react";
import { Box, Button, Container, Text, VStack } from "@chakra-ui/react";
import { useEffect, useMemo, useState } from "react";
import { FiLock } from "react-icons/fi";
import { Link as RouterLink } from "react-router-dom";

import { getCatalogStudioSession } from "../utils/apiClient";
import { CLERK_ENABLED } from "../utils/clerkConfig";
import { CatalogStudioAccessContext, useCatalogStudioAccess } from "./CatalogStudioAccessContext";
import { ErrorState, LoadingState } from "./StatusState";

function statusForError(error) {
  if (error?.response?.status === 401) return "anonymous";
  if (error?.response?.status === 403) return "forbidden";
  return "unavailable";
}

function ClerkCatalogStudioAccessProvider({ children }) {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const [state, setState] = useState({ status: "loading", session: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    if (!isLoaded) {
      setState({ status: "loading", session: null });
      return undefined;
    }
    if (!isSignedIn) {
      setState({ status: "anonymous", session: null });
      return undefined;
    }

    setState({ status: "loading", session: null });
    const resolveAccess = async () => {
      try {
        const token = await getToken();
        if (!token) throw Object.assign(new Error("Clerk session token is unavailable."), { response: { status: 401 } });
        const session = await getCatalogStudioSession(token);
        if (cancelled) return;
        setState(session?.authorized === true ? { status: "authorized", session } : { status: "forbidden", session: null });
      } catch (error) {
        if (!cancelled) setState({ status: statusForError(error), session: null });
      }
    };
    resolveAccess();

    return () => {
      cancelled = true;
    };
  }, [attempt, getToken, isLoaded, isSignedIn]);

  const value = useMemo(
    () => ({
      ...state,
      retry: () => setAttempt((current) => current + 1),
    }),
    [state],
  );

  return <CatalogStudioAccessContext.Provider value={value}>{children}</CatalogStudioAccessContext.Provider>;
}

export function CatalogStudioAccessProvider({ children }) {
  if (!CLERK_ENABLED) {
    return (
      <CatalogStudioAccessContext.Provider value={{ status: "anonymous", session: null, retry: () => {} }}>
        {children}
      </CatalogStudioAccessContext.Provider>
    );
  }
  return <ClerkCatalogStudioAccessProvider>{children}</ClerkCatalogStudioAccessProvider>;
}

function AccessMessage({ title, message, action }) {
  return (
    <VStack className="status-state catalog-access-state" gap={4}>
      <Box className="status-icon">
        <FiLock />
      </Box>
      <Box textAlign="center">
        <Text className="status-title">{title}</Text>
        <Text className="muted-text">{message}</Text>
      </Box>
      {action}
    </VStack>
  );
}

export default function AdminRoute({ children }) {
  const { status, retry } = useCatalogStudioAccess();

  if (status === "authorized") return children;

  return (
    <Container maxW="960px" py={{ base: 8, md: 14 }}>
      {status === "loading" ? <LoadingState label="Verifying Catalog Studio access" /> : null}
      {status === "anonymous" ? (
        <AccessMessage
          title="Sign in to Catalog Studio"
          message="This production workspace is available only to authorized Sterling Hollis administrators."
          action={
            CLERK_ENABLED ? (
              <Button as={RouterLink} to="/sign-in" className="primary-button">
                Sign in
              </Button>
            ) : null
          }
        />
      ) : null}
      {status === "forbidden" ? (
        <AccessMessage
          title="Administrator access required"
          message="Your Clerk session is valid, but this account is not authorized for Catalog Studio."
        />
      ) : null}
      {status === "unavailable" ? (
        <ErrorState
          title="Catalog Studio is unavailable"
          message="The storefront remains available while the administrator service reconnects."
          onRetry={retry}
        />
      ) : null}
    </Container>
  );
}
