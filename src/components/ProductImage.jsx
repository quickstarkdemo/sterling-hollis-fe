import { Box, Image } from "@chakra-ui/react";
import { FiImage } from "react-icons/fi";
import { useState } from "react";

export default function ProductImage({ src, alt, className = "", ratio = "4 / 5" }) {
  const [failed, setFailed] = useState(!src);

  return (
    <Box className={`product-image-wrap ${className}`} style={{ aspectRatio: ratio }}>
      {!failed ? (
        <Image src={src} alt={alt} className="product-image" onError={() => setFailed(true)} loading="lazy" />
      ) : (
        <Box className="image-fallback" aria-label={alt || "Product image unavailable"}>
          <FiImage />
        </Box>
      )}
    </Box>
  );
}
