import { SignInButton, SignedIn, SignedOut, UserButton } from "@clerk/clerk-react";
import { Button, HStack } from "@chakra-ui/react";
import { FiLogIn } from "react-icons/fi";

import { CLERK_ENABLED } from "../utils/clerkConfig";

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
        <UserButton afterSignOutUrl="/" />
      </SignedIn>
    </HStack>
  );
}

export default function AuthControls() {
  if (!CLERK_ENABLED) return null;
  return <ClerkControls />;
}
