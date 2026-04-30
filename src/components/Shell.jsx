import { Box, Button, Container, Flex, HStack, Text } from "@chakra-ui/react";
import { NavLink, Link as RouterLink } from "react-router-dom";
import { FiCamera, FiSearch, FiShoppingBag } from "react-icons/fi";

import AuthControls from "./AuthControls";

const navItems = [
  { to: "/", label: "Shop" },
  { to: "/style-finder", label: "Style Finder" },
];

export default function Shell({ children }) {
  return (
    <Box minH="100vh" className="app-shell">
      <Box as="header" className="topbar">
        <Container maxW="1280px">
          <Flex minH="72px" align="center" justify="space-between" gap={6}>
            <RouterLink to="/" className="brand-lockup">
              <Box className="brand-mark">
                <FiShoppingBag />
              </Box>
              <Box>
                <Text className="brand-name">Sterling Hollis</Text>
                <Text className="brand-subtitle">AI retail atelier</Text>
              </Box>
            </RouterLink>

            <HStack gap={2} className="desktop-nav">
              {navItems.map((item) => (
                <NavLink key={item.to} to={item.to} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
                  {item.label}
                </NavLink>
              ))}
            </HStack>

            <HStack gap={2}>
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
    </Box>
  );
}
