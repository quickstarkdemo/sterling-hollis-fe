import { Badge, Box, Button, HStack, Link, Text } from "@chakra-ui/react";
import { useRef, useState } from "react";
import { FiArchive, FiExternalLink, FiUploadCloud } from "react-icons/fi";
import { Link as RouterLink } from "react-router-dom";

import {
  archiveAdminCatalogProduct,
  archiveAdminCatalogProductCurrentV2,
  createIdempotencyKey,
  publishAdminCatalogProduct,
  publishAdminCatalogProductCompatibilityV2,
  publishAdminCatalogProductV3,
} from "../../utils/apiClient";
import { useApiTrace } from "../ApiTraceContext";

function errorMessage(error, fallback) {
  const detail = error?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  return fallback;
}

export default function ProductLifecycleActions({ product, dirty, onChanged, authoringSchemaVersion = 3, readiness }) {
  const [busyAction, setBusyAction] = useState("");
  const [error, setError] = useState("");
  const { startAction } = useApiTrace();
  const inFlight = useRef(false);
  const mutationKeys = useRef({});
  const draftId = product?.current_draft?.revision?.id;
  const draftApproved = product?.current_draft?.revision?.moderation_state === "approved";
  const readinessBlocked = authoringSchemaVersion >= 3 && readiness && readiness.ready !== true;
  const canPublish = Boolean(draftId) && draftApproved && !dirty && !readinessBlocked;
  const canArchive = product?.lifecycle_status === "published" && !dirty;

  const mutationKey = (scope, payload) => {
    const signature = JSON.stringify(payload);
    const current = mutationKeys.current[scope];
    if (current?.signature === signature) return current.key;
    const key = createIdempotencyKey(`${scope}-product`);
    mutationKeys.current[scope] = { signature, key };
    return key;
  };

  const publish = async () => {
    if (inFlight.current) return;
    if (!window.confirm("Publish this draft and replace the current public product?")) return;
    inFlight.current = true;
    setBusyAction("publish");
    setError("");
    const traceAction = startAction("Publish catalog product", {
      surface: "catalog-studio",
      attributes: {
        action: "product_publish",
        draft_id: draftId,
        product_id: product.product_id,
      },
    });
    try {
      const payload = { draft_id: draftId, expected_version: product.version };
      const publishProduct = authoringSchemaVersion >= 3
        ? publishAdminCatalogProductV3
        : authoringSchemaVersion >= 2
          ? publishAdminCatalogProductCompatibilityV2
          : publishAdminCatalogProduct;
      await publishProduct(
        product.product_id,
        payload,
        mutationKey("publish", payload),
      );
      delete mutationKeys.current.publish;
      await onChanged?.("published");
      traceAction.end("completed", {
        draft_id: draftId,
        product_id: product.product_id,
      });
    } catch (nextError) {
      setError(errorMessage(nextError, "The product could not be published."));
      traceAction.end("failed", {
        error_code: nextError?.response?.status || nextError?.code || nextError?.name || "publish_error",
        draft_id: draftId,
        product_id: product.product_id,
      });
    } finally {
      inFlight.current = false;
      setBusyAction("");
    }
  };

  const archive = async () => {
    if (inFlight.current) return;
    if (!window.confirm("Archive this product and remove it from public catalog results?")) return;
    inFlight.current = true;
    setBusyAction("archive");
    setError("");
    const traceAction = startAction("Archive catalog product", {
      surface: "catalog-studio",
      attributes: {
        action: "product_archive",
        product_id: product.product_id,
      },
    });
    try {
      const payload = { expected_version: product.version };
      const archiveProduct = authoringSchemaVersion >= 2
        ? archiveAdminCatalogProductCurrentV2
        : archiveAdminCatalogProduct;
      await archiveProduct(
        product.product_id,
        payload,
        mutationKey("archive", payload),
      );
      delete mutationKeys.current.archive;
      await onChanged?.("archived");
      traceAction.end("completed", {
        product_id: product.product_id,
      });
    } catch (nextError) {
      setError(errorMessage(nextError, "The product could not be archived."));
      traceAction.end("failed", {
        error_code: nextError?.response?.status || nextError?.code || nextError?.name || "archive_error",
        product_id: product.product_id,
      });
    } finally {
      inFlight.current = false;
      setBusyAction("");
    }
  };

  return (
    <Box className="product-lifecycle-actions">
      <Box mb={4}>
        <Text className="panel-title">Catalog availability</Text>
        <Text className="muted-text" mt={1}>Publish replaces the storefront version. Archive is the supported removal action; catalog records are retained instead of permanently deleted.</Text>
      </Box>
      <HStack justify="space-between" gap={4} flexWrap="wrap">
        <HStack gap={2}>
          <Badge className={`lifecycle-badge ${product.lifecycle_status}`}>{product.lifecycle_status}</Badge>
          <Text className="muted-text">Published version {product.version}</Text>
        </HStack>
        <HStack gap={2} flexWrap="wrap">
          {product.lifecycle_status === "published" ? (
            <Link as={RouterLink} to={`/product/${product.product_id}`} target="_blank" rel="noreferrer" className="catalog-public-link">
              View public product <FiExternalLink />
            </Link>
          ) : null}
          <Button type="button" className="primary-button" disabled={!canPublish || Boolean(busyAction)} onClick={publish}>
            <FiUploadCloud /> {busyAction === "publish" ? "Publishing…" : "Publish draft"}
          </Button>
          <Button type="button" className="secondary-button" disabled={!canArchive || Boolean(busyAction)} onClick={archive}>
            <FiArchive /> {busyAction === "archive" ? "Archiving…" : "Archive"}
          </Button>
        </HStack>
      </HStack>
      {dirty ? <Text className="catalog-action-hint">Save or discard local edits before changing lifecycle state.</Text> : null}
      {draftId && !draftApproved ? <Text className="catalog-action-hint">The draft must be moderation-approved before publication.</Text> : null}
      {readinessBlocked ? <Text className="catalog-action-hint">Resolve the blocking readiness issues before publication.</Text> : null}
      {error ? <Text className="error-copy">{error}</Text> : null}
    </Box>
  );
}
