import { SignIn, SignedIn, SignedOut } from "@clerk/clerk-react";
import { Box, Container, Text } from "@chakra-ui/react";
import { Navigate } from "react-router-dom";

import { EmptyState } from "../components/StatusState";
import { CLERK_ENABLED } from "../utils/clerkConfig";

export default function SignInPage() {
  if (!CLERK_ENABLED) {
    return (
      <Container maxW="760px" py={16}>
        <EmptyState title="Sign in is not configured" message="Set VITE_CLERK_PUBLISHABLE_KEY to enable storefront login." />
      </Container>
    );
  }

  return (
    <Container maxW="760px" py={{ base: 10, md: 16 }}>
      <Box className="auth-page">
        <Box textAlign="center">
          <Text className="section-kicker">Sterling Hollis account</Text>
          <Text as="h1" className="auth-page-title">
            Sign in
          </Text>
        </Box>
        <SignedOut>
          <SignIn path="/sign-in" routing="path" fallbackRedirectUrl="/" signUpFallbackRedirectUrl="/" />
        </SignedOut>
        <SignedIn>
          <Navigate to="/" replace />
        </SignedIn>
      </Box>
    </Container>
  );
}
