import { SimpleGrid } from "@chakra-ui/react";

import ProductCard from "./ProductCard";
import { EmptyState } from "./StatusState";

export default function ProductGrid({ products, emptyMessage }) {
  if (!products?.length) {
    return <EmptyState title="No products found" message={emptyMessage || "Try a different category or search."} />;
  }

  return (
    <SimpleGrid columns={{ base: 1, sm: 2, lg: 3, xl: 4 }} gap={5}>
      {products.map((product) => (
        <ProductCard key={product.id} product={product} />
      ))}
    </SimpleGrid>
  );
}
