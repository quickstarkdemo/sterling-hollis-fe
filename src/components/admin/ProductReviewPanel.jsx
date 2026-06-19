import { Badge, Box, Button, HStack, Input, Text, Textarea, VStack } from "@chakra-ui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FiCheck, FiFlag, FiRefreshCw, FiSend, FiX, FiZap } from "react-icons/fi";

import {
  assistCatalogProductReview,
  createIdempotencyKey,
  decideCatalogProductReview,
  getAdminCatalogProductReviews,
} from "../../utils/apiClient";

const dateFormatter = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatDate(value) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not recorded" : dateFormatter.format(date);
}

function statusClass(state) {
  if (state === "approved") return "succeeded";
  if (state === "flagged" || state === "rejected") return "failed";
  return "pending";
}

function actionError(error, operation) {
  const status = error?.response?.status;
  if (status === 409) {
    return {
      message: "This review changed on the server. Refresh reviews before making another decision.",
      retryable: false,
    };
  }
  if ([401, 403].includes(status)) {
    return {
      message: "The administrator session expired or no longer permits review moderation. Sign in again; product edits are preserved.",
      retryable: false,
    };
  }
  if (status === 404) {
    return {
      message: "This review is no longer available for the active product. Refresh reviews to continue.",
      retryable: false,
    };
  }
  if (status === 422) {
    return {
      message: operation === "assist"
        ? "AI assistance was blocked or could not safely classify this review. The review is unchanged."
        : "This review action is not valid in its current state. The prior decision is unchanged.",
      retryable: false,
    };
  }
  if ([502, 503, 504].includes(status)) {
    return {
      message: "Review assistance is temporarily unavailable. Product edits and the current review decision are preserved.",
      retryable: true,
    };
  }
  return {
    message: "The review action could not be completed. Product edits and the current review decision are preserved.",
    retryable: true,
  };
}

function initialForm(review, current = {}) {
  return {
    reason: current.reason || "",
    responseText: current.responseDirty
      ? current.responseText
      : review.moderation.response_draft || "",
    responseDirty: Boolean(current.responseDirty),
  };
}

export default function ProductReviewPanel({ productId, refreshSignal = 0, manualEditsPending = false }) {
  const [reviews, setReviews] = useState([]);
  const [forms, setForms] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionState, setActionState] = useState(null);
  const [notice, setNotice] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const loadRequestId = useRef(0);
  const actionRequestId = useRef(0);
  const actionInFlight = useRef(false);
  const mutationKeys = useRef({});
  const lastAction = useRef(null);

  useEffect(() => {
    loadRequestId.current += 1;
    actionRequestId.current += 1;
    actionInFlight.current = false;
    mutationKeys.current = {};
    lastAction.current = null;
    setReviews([]);
    setForms({});
    setLoading(true);
    setLoadError("");
    setActionState(null);
    setNotice("");
    setBusyKey("");
    return () => {
      actionRequestId.current += 1;
      actionInFlight.current = false;
    };
  }, [productId]);

  const load = useCallback(async () => {
    if (!productId || actionInFlight.current) return;
    const requestId = loadRequestId.current + 1;
    loadRequestId.current = requestId;
    setLoading(true);
    setLoadError("");
    setActionState(null);
    try {
      const result = await getAdminCatalogProductReviews(productId);
      if (loadRequestId.current !== requestId) return;
      const nextReviews = result.items || [];
      setReviews(nextReviews);
      setForms((current) => Object.fromEntries(
        nextReviews.map((review) => [review.id, initialForm(review, current[review.id])]),
      ));
    } catch {
      if (loadRequestId.current === requestId) {
        setLoadError("Customer reviews could not be loaded. Product editing remains available.");
      }
    } finally {
      if (loadRequestId.current === requestId) setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    void load();
    return () => { loadRequestId.current += 1; };
  }, [load, refreshSignal]);

  const pendingCount = useMemo(
    () => reviews.filter((review) => review.moderation.state === "pending").length,
    [reviews],
  );

  const updateForm = (reviewId, changes) => {
    setForms((current) => ({
      ...current,
      [reviewId]: { ...current[reviewId], ...changes },
    }));
  };

  const replaceReview = (nextReview, operation) => {
    setReviews((current) => current.map((review) => review.id === nextReview.id ? nextReview : review));
    setForms((current) => {
      const previous = current[nextReview.id] || {};
      const responseSubmitted = ["save_response", "publish_response"].includes(operation);
      const preserveLocalResponse = previous.responseDirty && !responseSubmitted;
      return {
        ...current,
        [nextReview.id]: {
          reason: operation === "assist" ? previous.reason || "" : "",
          responseText: preserveLocalResponse
            ? previous.responseText
            : nextReview.moderation.response_draft || "",
          responseDirty: preserveLocalResponse,
        },
      };
    });
  };

  const runAction = async ({ reviewId, operation, version, payload }) => {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    const requestId = actionRequestId.current + 1;
    actionRequestId.current = requestId;
    loadRequestId.current += 1;
    setLoading(false);
    const signature = JSON.stringify({ reviewId, operation, version, payload });
    const key = mutationKeys.current[signature]
      || (mutationKeys.current[signature] = createIdempotencyKey(`review-${operation}`));
    lastAction.current = { reviewId, operation, version, payload };
    setBusyKey(`${reviewId}:${operation}`);
    setActionState(null);
    setNotice("");
    try {
      const request = { expected_version: version, ...payload };
      const nextReview = operation === "assist"
        ? await assistCatalogProductReview(productId, reviewId, request, key)
        : await decideCatalogProductReview(productId, reviewId, request, key);
      if (actionRequestId.current !== requestId) return;
      delete mutationKeys.current[signature];
      lastAction.current = null;
      replaceReview(nextReview, operation);
      setNotice(operation === "assist"
        ? "AI analysis is ready for merchant review. No moderation decision was published."
        : "The merchant review action was recorded.");
    } catch (error) {
      if (actionRequestId.current === requestId) setActionState(actionError(error, operation));
    } finally {
      if (actionRequestId.current === requestId) {
        actionInFlight.current = false;
        setBusyKey("");
      }
    }
  };

  const decide = (review, action) => {
    const form = forms[review.id] || initialForm(review);
    const payload = {
      action,
      reason: form.reason.trim(),
      ...(["save_response", "publish_response"].includes(action)
        ? { response_text: form.responseText.trim() }
        : {}),
    };
    void runAction({
      reviewId: review.id,
      operation: action,
      version: review.moderation.version,
      payload,
    });
  };

  const retryLastAction = () => {
    if (lastAction.current) void runAction(lastAction.current);
  };

  return (
    <Box id="workbench-reviews" className="editor-section product-review-panel">
      <HStack justify="space-between" gap={3} align="start" flexWrap="wrap">
        <Box>
          <Text className="section-kicker">Customer reviews</Text>
          <Text className="panel-title">Moderate without changing customer words</Text>
          <Text className="muted-text">AI can summarize and draft a response. Only a merchant can approve, flag, reject, or publish a response.</Text>
        </Box>
        <HStack gap={2} flexWrap="wrap">
          <Badge className="soft-badge">{pendingCount} pending</Badge>
          <Button type="button" size="sm" className="secondary-button" aria-label="Refresh customer reviews" onClick={load} disabled={loading || Boolean(busyKey)}>
            <FiRefreshCw /> Refresh
          </Button>
        </HStack>
      </HStack>

      {manualEditsPending ? <Text className="catalog-editor-guidance" mt={4}>Unsaved product edits remain separate from review decisions and will not be discarded.</Text> : null}
      {loading ? <Text className="muted-text" mt={4}>Loading customer reviews…</Text> : null}
      {!loading && !reviews.length && !loadError ? <Text className="muted-text" mt={4}>No customer reviews are available for this product.</Text> : null}
      {loadError ? <Text className="error-copy" role="alert">{loadError}</Text> : null}

      <VStack align="stretch" gap={5} mt={5}>
        {reviews.map((review) => {
          const moderation = review.moderation;
          const form = forms[review.id] || initialForm(review);
          const reasonMissing = !form.reason.trim();
          const responseMissing = !form.responseText.trim();
          return (
            <Box as="article" key={review.id} className="product-review-card">
              <HStack justify="space-between" gap={3} align="start" flexWrap="wrap">
                <Box>
                  <Text className="panel-title">{review.author_display_name}</Text>
                  <Text className="muted-text">Submitted {formatDate(review.submitted_at)}</Text>
                </Box>
                <Badge className={`workflow-status ${statusClass(moderation.state)}`}>{moderation.state}</Badge>
              </HStack>

              <Text className="product-review-rating" aria-label={`${review.rating} out of 5 stars`} mt={3}>
                {"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}
              </Text>
              <Box as="blockquote" className="product-review-quote" mt={3}>
                <Text whiteSpace="pre-wrap">{review.body}</Text>
              </Box>

              <Box className="review-assistance" mt={4}>
                <HStack justify="space-between" gap={3} align="start" flexWrap="wrap">
                  <Box>
                    <Text className="filter-label">AI assistance</Text>
                    {moderation.ai_theme_summary
                      ? <Text mt={1}>{moderation.ai_theme_summary}</Text>
                      : <Text className="muted-text" mt={1}>No AI analysis has been requested.</Text>}
                  </Box>
                  <Button
                    type="button"
                    size="sm"
                    className="secondary-button"
                    disabled={Boolean(busyKey)}
                    onClick={() => runAction({ reviewId: review.id, operation: "assist", version: moderation.version, payload: {} })}
                  >
                    <FiZap /> {busyKey === `${review.id}:assist` ? "Analyzing…" : moderation.ai_theme_summary ? "Refresh analysis" : "Analyze review"}
                  </Button>
                </HStack>
                {moderation.ai_categories?.length ? (
                  <HStack gap={2} mt={3} flexWrap="wrap">
                    {moderation.ai_categories.map((category) => <Badge key={category} className="soft-badge">{category.replaceAll("_", " ")}</Badge>)}
                    {moderation.ai_suggested_action ? <Badge className="workflow-status pending">Suggested: {moderation.ai_suggested_action}</Badge> : null}
                  </HStack>
                ) : null}
              </Box>

              <VStack align="stretch" gap={3} mt={4}>
                <Input
                  aria-label={`Decision reason for ${review.author_display_name}`}
                  value={form.reason}
                  onChange={(event) => updateForm(review.id, { reason: event.target.value })}
                  placeholder="Reason for the merchant action"
                  maxLength={1000}
                />
                <HStack gap={2} flexWrap="wrap">
                  <Button type="button" size="sm" className="primary-button" disabled={Boolean(busyKey) || reasonMissing} onClick={() => decide(review, "approve")}><FiCheck /> Approve</Button>
                  <Button type="button" size="sm" className="secondary-button" disabled={Boolean(busyKey) || reasonMissing} onClick={() => decide(review, "flag")}><FiFlag /> Flag</Button>
                  <Button type="button" size="sm" variant="ghost" className="danger-button" disabled={Boolean(busyKey) || reasonMissing} onClick={() => decide(review, "reject")}><FiX /> Reject</Button>
                </HStack>
              </VStack>

              <Box className="merchant-response-editor" mt={4}>
                <Text className="filter-label">Merchant response</Text>
                <Textarea
                  aria-label={`Merchant response for ${review.author_display_name}`}
                  value={form.responseText}
                  onChange={(event) => updateForm(review.id, { responseText: event.target.value, responseDirty: true })}
                  placeholder="Draft a response without changing the customer review…"
                  rows={3}
                  maxLength={2000}
                  mt={2}
                />
                <HStack justify="end" gap={2} mt={3} flexWrap="wrap">
                  <Button type="button" size="sm" className="secondary-button" disabled={Boolean(busyKey) || reasonMissing || responseMissing} onClick={() => decide(review, "save_response")}>Save response draft</Button>
                  <Button type="button" size="sm" className="primary-button" disabled={Boolean(busyKey) || reasonMissing || responseMissing || moderation.state !== "approved"} onClick={() => decide(review, "publish_response")}><FiSend /> Publish response</Button>
                </HStack>
                {moderation.state !== "approved" ? <Text className="muted-text" mt={2}>Approve the customer review before publishing a merchant response.</Text> : null}
              </Box>

              {review.actions?.length ? (
                <Box as="details" className="review-audit-history" mt={4}>
                  <Text as="summary">Audit history ({review.actions.length})</Text>
                  <VStack align="stretch" gap={2} mt={3}>
                    {review.actions.map((action) => (
                      <Box key={action.id} className="review-audit-entry">
                        <HStack justify="space-between" gap={3} flexWrap="wrap">
                          <Text fontWeight="700">{action.action.replaceAll("_", " ")}</Text>
                          <Text className="muted-text">{formatDate(action.created_at)}</Text>
                        </HStack>
                        {action.reason ? <Text className="muted-text" mt={1}>{action.reason}</Text> : null}
                      </Box>
                    ))}
                  </VStack>
                </Box>
              ) : null}
            </Box>
          );
        })}
      </VStack>

      {notice ? <Text className="notice-text" mt={4}>{notice}</Text> : null}
      {actionState ? (
        <HStack className="catalog-conflict-alert" mt={4} justify="space-between" gap={3} align="start" flexWrap="wrap" role="alert">
          <Text>{actionState.message}</Text>
          <HStack gap={2}>
            {actionState.retryable ? <Button type="button" size="sm" className="secondary-button" onClick={retryLastAction}><FiRefreshCw /> Retry action</Button> : null}
            <Button type="button" size="sm" className="secondary-button" onClick={load}><FiRefreshCw /> Refresh reviews</Button>
          </HStack>
        </HStack>
      ) : null}
    </Box>
  );
}
