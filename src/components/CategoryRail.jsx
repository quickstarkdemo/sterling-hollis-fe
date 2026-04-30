import { Box, SimpleGrid, Text } from "@chakra-ui/react";
import { Link as RouterLink } from "react-router-dom";
import { FiArrowRight } from "react-icons/fi";

export default function CategoryRail({ categories = [] }) {
  if (!categories.length) return null;

  return (
    <SimpleGrid className="category-rail" columns={{ base: 1, sm: 2, lg: 4 }} gap={3}>
      {categories.map((category) => (
        <RouterLink key={category.id} to={`/category/${category.id}`} className="category-pill">
          <Box>
            <Text className="category-label">{category.label}</Text>
            <Text className="category-meta">
              {category.product_count} items
              {category.available_units ? ` · ${category.available_units} units` : ""}
            </Text>
          </Box>
          <FiArrowRight />
        </RouterLink>
      ))}
    </SimpleGrid>
  );
}
