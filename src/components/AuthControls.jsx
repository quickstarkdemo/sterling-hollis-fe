import { SignInButton, SignedIn, SignedOut, UserButton } from "@clerk/clerk-react";
import { Button, HStack } from "@chakra-ui/react";
import { FiCode, FiGrid, FiLogIn, FiSliders } from "react-icons/fi";
import { Link as RouterLink } from "react-router-dom";

import DemoObservabilityPanel from "./DemoObservabilityPanel";
import { CLERK_ENABLED, isDemoObservabilityUiEnabled } from "../utils/clerkConfig";
import { useDeveloperLens } from "./DeveloperLensContext";
import { useCatalogStudioAccess } from "./CatalogStudioAccessContext";

function StorefrontUserButton({ showCatalogStudio, developerToolsEnabled, onToggleDeveloperTools }) {
  const showDemoControls = isDemoObservabilityUiEnabled();

  return (
    <UserButton>
      <UserButton.MenuItems>
        <UserButton.Action
          label={developerToolsEnabled ? "Hide Developer tools" : "Developer tools"}
          labelIcon={<FiCode />}
          onClick={onToggleDeveloperTools}
        />
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
  const { enabled: developerToolsEnabled, toggle: toggleDeveloperTools } = useDeveloperLens();

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
        <StorefrontUserButton
          showCatalogStudio={catalogStudioStatus === "authorized"}
          developerToolsEnabled={developerToolsEnabled}
          onToggleDeveloperTools={toggleDeveloperTools}
        />
      </SignedIn>
    </HStack>
  );
}

export default function AuthControls() {
  if (!CLERK_ENABLED) {
    return (
      <HStack gap={2} className="auth-controls">
        <Button as={RouterLink} to="/sign-in" size="sm" className="secondary-button">
          <FiLogIn />
          Sign in
        </Button>
      </HStack>
    );
  }
  return <ClerkControls />;
}
