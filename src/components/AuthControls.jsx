import { SignInButton, SignedIn, SignedOut, UserButton } from "@clerk/clerk-react";
import { Button, HStack } from "@chakra-ui/react";
import { FiGrid, FiLogIn, FiSliders } from "react-icons/fi";

import DemoObservabilityPanel from "./DemoObservabilityPanel";
import { CLERK_ENABLED, isDemoObservabilityUiEnabled } from "../utils/clerkConfig";
import { useCatalogStudioAccess } from "./CatalogStudioAccessContext";

function StorefrontUserButton({ showCatalogStudio }) {
  const showDemoControls = isDemoObservabilityUiEnabled();
  if (!showCatalogStudio && !showDemoControls) return <UserButton />;

  return (
    <UserButton>
      <UserButton.MenuItems>
        {showCatalogStudio ? (
          <UserButton.Link label="Catalog Studio" labelIcon={<FiGrid />} href="/catalog-studio" />
        ) : null}
        {showDemoControls ? (
          <UserButton.Action label="Demo controls" labelIcon={<FiSliders />} open="demo-controls" />
        ) : null}
      </UserButton.MenuItems>
      {showDemoControls ? (
        <UserButton.UserProfilePage label="Demo controls" url="/demo-controls" labelIcon={<FiSliders />}>
          <DemoObservabilityPanel />
        </UserButton.UserProfilePage>
      ) : null}
    </UserButton>
  );
}

function ClerkControls() {
  const { status: catalogStudioStatus } = useCatalogStudioAccess();

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
        <StorefrontUserButton showCatalogStudio={catalogStudioStatus === "authorized"} />
      </SignedIn>
    </HStack>
  );
}

export default function AuthControls() {
  if (!CLERK_ENABLED) return null;
  return <ClerkControls />;
}
