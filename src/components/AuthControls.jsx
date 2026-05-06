import { SignInButton, SignedIn, SignedOut, UserButton } from "@clerk/clerk-react";
import { Button, HStack } from "@chakra-ui/react";
import { FiLogIn, FiSliders } from "react-icons/fi";

import DemoObservabilityPanel from "./DemoObservabilityPanel";
import { CLERK_ENABLED, isDemoObservabilityUiEnabled } from "../utils/clerkConfig";

function StorefrontUserButton() {
  if (!isDemoObservabilityUiEnabled()) return <UserButton />;

  return (
    <UserButton>
      <UserButton.MenuItems>
        <UserButton.Action label="Demo controls" labelIcon={<FiSliders />} open="demo-controls" />
      </UserButton.MenuItems>
      <UserButton.UserProfilePage label="Demo controls" url="/demo-controls" labelIcon={<FiSliders />}>
        <DemoObservabilityPanel />
      </UserButton.UserProfilePage>
    </UserButton>
  );
}

function ClerkControls() {
  return (
    <HStack gap={2} className="auth-controls">
      <SignedOut>
        <SignInButton mode="modal">
          <Button size="sm" className="secondary-button">
            <FiLogIn />
            Sign in
          </Button>
        </SignInButton>
      </SignedOut>
      <SignedIn>
        <StorefrontUserButton />
      </SignedIn>
    </HStack>
  );
}

export default function AuthControls() {
  if (!CLERK_ENABLED) return null;
  return <ClerkControls />;
}
