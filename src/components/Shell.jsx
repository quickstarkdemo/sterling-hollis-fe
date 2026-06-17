import { Box, Button, Container, Flex, HStack } from "@chakra-ui/react";
import { NavLink, Link as RouterLink } from "react-router-dom";
import { FiCamera, FiSearch } from "react-icons/fi";

import brandLogo from "../assets/sterling-hollis-logo.svg";
import AuthControls from "./AuthControls";
import ChatWidget from "./ChatWidget";
import { useCatalogStudioAccess } from "./CatalogStudioAccessContext";

const navItems = [
  { to: "/", label: "Shop" },
  { to: "/style-finder", label: "Style Finder" },
];

export default function Shell({ children }) {
  const { status: catalogStudioStatus } = useCatalogStudioAccess();
  const visibleNavItems =
    catalogStudioStatus === "authorized"
      ? [...navItems, { to: "/catalog-studio", label: "Catalog Studio" }]
      : navItems;

  return (
    <Box minH="100vh" className="app-shell">
      <Box as="header" className="topbar">
        <Container maxW="1280px">
          <Flex minH="72px" align="center" justify="space-between" gap={6}>
            <RouterLink to="/" className="brand-lockup">
              <Box as="img" src={brandLogo} alt="Sterling Hollis" className="brand-logo" />
            </RouterLink>

            <HStack gap={2} className="desktop-nav">
              {visibleNavItems.map((item) => (
                <NavLink key={item.to} to={item.to} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
                  {item.label}
                </NavLink>
              ))}
            </HStack>

            <HStack gap={2} className="header-actions">
              <Button as={RouterLink} to="/" variant="ghost" size="sm" className="icon-button">
                <FiSearch />
              </Button>
              <Button as={RouterLink} to="/style-finder" size="sm" className="primary-button">
                <FiCamera />
                Find Similar
              </Button>
              <AuthControls />
            </HStack>
          </Flex>
        </Container>
      </Box>

      <Box as="main">{children}</Box>
      <ChatWidget />
    </Box>
  );
}
