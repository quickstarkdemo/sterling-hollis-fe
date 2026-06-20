import { Badge, Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FiCheck, FiRefreshCw, FiX } from "react-icons/fi";

import {
  createIdempotencyKey,
  decideCatalogSuggestionSet,
  getCatalogSuggestionSets,
} from "../../utils/apiClient";
import { useApiTrace } from "../ApiTraceContext";

function displayValue(value) {
  if (value === null || value === undefined || value === "") return "Not provided";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function fieldLabel(path) {
  return String(path || "")
    .replace(/^\//, "")
    .split("/")
    .map((part) => part.replaceAll("_", " "))
    .join(" › ") || "Product field";
}

function decisionError(error) {
  if (error?.response?.status === 409) return "This suggestion is stale because the product draft changed. Refresh suggestions; your manual edits were preserved.";
  if (error?.response?.status === 422) return "This proposal no longer produces a valid product draft. Review the current product values before trying again.";
  return "The suggestion decision could not be saved. The product draft is unchanged.";
}

export default function SuggestionReviewPanel({ productId, draft, refreshSignal = 0, onDraftChanged, manualEditsPending = false }) {
  const [sets, setSets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const [notice, setNotice] = useState("");
  const keys = useRef({});
  const loadRequestId = useRef(0);
  const decisionInFlight = useRef(false);
  const { startAction } = useApiTrace();

  const load = useCallback(async () => {
    if (!productId) return;
    const requestId = loadRequestId.current + 1;
    loadRequestId.current = requestId;
    setLoading(true);
    setError("");
    try {
      const payload = await getCatalogSuggestionSets(productId);
      if (loadRequestId.current === requestId) setSets(payload.items || []);
    } catch {
      if (loadRequestId.current === requestId) setError("Product suggestions could not be loaded.");
    } finally {
      if (loadRequestId.current === requestId) setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    void load();
    return () => { loadRequestId.current += 1; };
  }, [load, refreshSignal]);

  const pendingCount = useMemo(
    () => sets.reduce((total, set) => total + set.suggestions.filter((item) => item.status === "pending").length, 0),
    [sets],
  );

  const decide = async (set, action, scope, { suggestionId, section } = {}) => {
    if (decisionInFlight.current) return;
    decisionInFlight.current = true;
    loadRequestId.current += 1;
    setLoading(false);
    const key = `${set.id}:${action}:${scope}:${suggestionId || section || "remaining"}:${set.current_draft_version}`;
    setBusyKey(key);
    setError("");
    setNotice("");
    const traceAction = startAction(`${action === "accept" ? "Accept" : "Reject"} catalog suggestion`, {
      surface: "catalog-studio",
      attributes: {
        action: `suggestion_${action}`,
        draft_id: draft?.revision?.id || "",
        product_id: productId,
      },
    });
    try {
      const result = await decideCatalogSuggestionSet(productId, set.id, {
        action,
        scope,
        ...(suggestionId ? { suggestion_id: suggestionId } : {}),
        ...(section ? { section } : {}),
        expected_draft_version: set.current_draft_version,
      }, keys.current[key] || (keys.current[key] = createIdempotencyKey("suggestion-decision")));
      delete keys.current[key];
      setSets((current) => current.map((item) => item.id === set.id ? result.suggestion_set : item));
      setNotice(action === "accept" ? "Suggestion accepted into a new private draft version." : "Suggestion rejected. The product draft was not changed.");
      if (result.draft) onDraftChanged?.(result);
      traceAction.end("completed", {
        draft_id: result.draft?.revision?.id || draft?.revision?.id || "",
        product_id: productId,
      });
    } catch (nextError) {
      setError(decisionError(nextError));
      traceAction.end("failed", {
        error_code: nextError?.response?.status || nextError?.code || nextError?.name || "suggestion_decision_error",
        draft_id: draft?.revision?.id || "",
        product_id: productId,
      });
    } finally {
      decisionInFlight.current = false;
      setBusyKey("");
    }
  };

  return (
    <Box id="workbench-suggestions" className="editor-section suggestion-review-panel">
      <HStack justify="space-between" gap={3} align="start" flexWrap="wrap">
        <Box>
          <Text className="section-kicker">AI suggestion review</Text>
          <Text className="panel-title">Compare before applying</Text>
          <Text className="muted-text">Supplier analysis, typed actions, and voice proposals all use the same explicit review and version checks.</Text>
        </Box>
        <HStack gap={2}><Badge className="soft-badge">{pendingCount} pending</Badge><Button type="button" size="sm" className="secondary-button" aria-label="Refresh product suggestions" onClick={load} disabled={loading}><FiRefreshCw /> Refresh</Button></HStack>
      </HStack>

      {loading ? <Text className="muted-text" mt={4}>Loading reviewable suggestions…</Text> : null}
      {!loading && !sets.length ? <Text className="muted-text" mt={4}>No suggestions yet. Analyze supplier images or use an inline AI action to create a reviewable proposal.</Text> : null}
      {manualEditsPending ? <Text className="catalog-action-hint" mt={4}>Save or discard manual edits before accepting a proposal. Rejecting a proposal remains available.</Text> : null}

      <VStack align="stretch" gap={5} mt={5}>
        {sets.map((set) => {
          const pending = set.suggestions.filter((item) => item.status === "pending");
          const sections = [...new Set(pending.map((item) => item.section))];
          const stale = Boolean(draft && set.current_draft_version !== draft.draft_version);
          return (
            <Box key={set.id} className={`suggestion-set ${stale ? "stale" : ""}`}>
              <HStack justify="space-between" gap={3} flexWrap="wrap">
                <HStack gap={2}><Badge className={`workflow-status ${set.status}`}>{set.status}</Badge><Text className="muted-text">Draft v{set.current_draft_version}</Text>{stale ? <Badge className="workflow-status failed">stale</Badge> : null}</HStack>
                {pending.length ? <Button type="button" size="sm" className="secondary-button" disabled={Boolean(busyKey) || stale} onClick={() => decide(set, "reject", "remaining")}><FiX /> Reject remaining</Button> : null}
              </HStack>

              <VStack align="stretch" gap={3} mt={4}>
                {set.suggestions.map((suggestion) => {
                  const suggestionBusy = busyKey.includes(suggestion.id);
                  return (
                    <Box key={suggestion.id} className={`suggestion-card ${suggestion.status}`}>
                      <HStack justify="space-between" gap={3} align="start" flexWrap="wrap">
                        <Box><Text className="panel-title">{fieldLabel(suggestion.target_path)}</Text><HStack gap={2} mt={1} flexWrap="wrap"><Badge className="soft-badge">{suggestion.certainty_class}</Badge><Badge className="soft-badge">{suggestion.input_origin.replaceAll("_", " ")}</Badge><Badge className={`workflow-status ${suggestion.status}`}>{suggestion.status}</Badge>{suggestion.evidence_asset_ids.length ? <Text className="muted-text">{suggestion.evidence_asset_ids.length} source {suggestion.evidence_asset_ids.length === 1 ? "image" : "images"}</Text> : null}</HStack></Box>
                      </HStack>
                      <Box className="suggestion-diff" mt={3}>
                        <Box><Text className="filter-label">Current</Text><Text whiteSpace="pre-wrap">{displayValue(suggestion.baseline_value)}</Text></Box>
                        <Box><Text className="filter-label">Proposed</Text><Text whiteSpace="pre-wrap">{displayValue(suggestion.proposed_value)}</Text></Box>
                      </Box>
                      {suggestion.status === "pending" ? (
                        <HStack justify="end" mt={3} gap={2}>
                          <Button type="button" size="sm" variant="ghost" className="danger-button" disabled={Boolean(busyKey) || stale} onClick={() => decide(set, "reject", "suggestion", { suggestionId: suggestion.id })}><FiX /> Reject {fieldLabel(suggestion.target_path)}</Button>
                          <Button type="button" size="sm" className="primary-button" disabled={Boolean(busyKey) || stale || manualEditsPending} onClick={() => decide(set, "accept", "suggestion", { suggestionId: suggestion.id })}><FiCheck /> {suggestionBusy ? "Applying…" : `Accept ${fieldLabel(suggestion.target_path)}`}</Button>
                        </HStack>
                      ) : suggestion.review_reason ? <Text className="muted-text" mt={3}>{suggestion.review_reason}</Text> : null}
                    </Box>
                  );
                })}
              </VStack>

              {sections.length ? <HStack mt={4} gap={2} flexWrap="wrap">{sections.map((section) => <Button key={section} type="button" size="sm" className="secondary-button" disabled={Boolean(busyKey) || stale || manualEditsPending} onClick={() => decide(set, "accept", "section", { section })}><FiCheck /> Accept {section} section</Button>)}</HStack> : null}
            </Box>
          );
        })}
      </VStack>

      {notice ? <Text className="notice-text" mt={4}>{notice}</Text> : null}
      {error ? <Text className="error-copy" role="alert" mt={4}>{error}</Text> : null}
    </Box>
  );
}
