import { Badge, Box, Button, HStack, Input, Link, SimpleGrid, Text, Textarea, VStack } from "@chakra-ui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FiImage, FiRefreshCw, FiSend, FiThumbsUp } from "react-icons/fi";
import { Link as RouterLink } from "react-router-dom";

import { useDeveloperLens } from "../DeveloperLensContext";
import { useCatalogStudioAccess } from "../CatalogStudioAccessContext";
import {
  approveCatalogImageJob,
  createIdempotencyKey,
  generateCatalogSuggestionSet,
  getAdminCatalogProduct,
  getCatalogImageJob,
  getCatalogWorkflow,
  startCatalogWorkflow,
  submitCatalogDraftCommand,
  submitCatalogImageCommand,
} from "../../utils/apiClient";
import { trackCatalogStudioMilestone } from "../../utils/datadog";
import ApiStageTimeline from "./ApiStageTimeline";
import DeveloperLens from "./DeveloperLens";
import ProductEditor from "./ProductEditor";
import ProductSourceTray from "./ProductSourceTray";
import SuggestionReviewPanel from "./SuggestionReviewPanel";
import VoiceControls from "./VoiceControls";

const STORAGE_KEY = "sterling-hollis:catalog-studio:active-workflow";
const MAX_POLL_ATTEMPTS = 12;

function restoredState() {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null") || {};
  } catch {
    return {};
  }
}

function retryableError(error) {
  return Boolean(error?.response?.data?.retryable) || [502, 503, 504].includes(error?.response?.status);
}

function safeErrorMessage(error, fallback) {
  const status = error?.response?.status;
  if (status === 409) return "The draft changed on the server. Refresh the workflow before trying again.";
  if (status === 422) return "The request needs different product or image details before it can continue.";
  if ([502, 503, 504].includes(status)) return "The OpenAI capability is temporarily unavailable. Your current draft is preserved.";
  return fallback;
}

export default function ProductWorkbench({
  activeProductId = "",
  onDirtyChange,
  onCatalogChanged,
  authoringSchemaVersion = 1,
  references,
  referencesStatus,
  onRetryReferences,
  onBrandAdded,
}) {
  const initial = useMemo(() => activeProductId ? {} : restoredState(), [activeProductId]);
  const { enabled: developerLensEnabled } = useDeveloperLens();
  const { session: catalogStudioSession } = useCatalogStudioAccess();
  const [instruction, setInstruction] = useState("");
  const [workflow, setWorkflow] = useState(null);
  const [workflowId, setWorkflowId] = useState(initial.workflowId || "");
  const [draft, setDraft] = useState(initial.draft || null);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [message, setMessage] = useState("");
  const [imageJob, setImageJob] = useState(null);
  const [imageApproved, setImageApproved] = useState(false);
  const [imageRefinement, setImageRefinement] = useState("");
  const [imageBusy, setImageBusy] = useState(false);
  const [pollExpired, setPollExpired] = useState(false);
  const [editorRefreshKey, setEditorRefreshKey] = useState(0);
  const [editorDirty, setEditorDirty] = useState(false);
  const [voiceResetKey, setVoiceResetKey] = useState(0);
  const [fieldVoiceStartKey, setFieldVoiceStartKey] = useState(0);
  const [activeDetail, setActiveDetail] = useState(null);
  const [suggestionRefreshKey, setSuggestionRefreshKey] = useState(0);
  const [fieldVoiceTarget, setFieldVoiceTarget] = useState(null);
  const [fieldAiBusyTarget, setFieldAiBusyTarget] = useState("");
  const commandInFlight = useRef(false);
  const workflowStartPromise = useRef(null);
  const imageInFlight = useRef(false);
  const mutationKeys = useRef({});
  const pollAttempt = useRef(0);
  const lastImagePayload = useRef(null);
  const workflowRequestId = useRef(0);
  const imageRequestId = useRef(0);
  const approvedImageJobId = useRef(initial.approvedImageJobId || "");
  const ignoredImageJobId = useRef(initial.ignoredImageJobId || "");

  const mutationKey = (scope, payload) => {
    const signature = JSON.stringify(payload);
    const current = mutationKeys.current[scope];
    if (current?.signature === signature) return current.key;
    const key = createIdempotencyKey(scope);
    mutationKeys.current[scope] = { signature, key };
    return key;
  };

  const persist = useCallback((nextWorkflowId, nextDraft) => {
    try {
      const recoveryDraft = nextDraft ? {
        id: nextDraft.id,
        product_id: nextDraft.product_id,
        draft_version: nextDraft.draft_version,
      } : null;
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
        workflowId: nextWorkflowId,
        draft: recoveryDraft,
        approvedImageJobId: approvedImageJobId.current || null,
        ignoredImageJobId: ignoredImageJobId.current || null,
      }));
    } catch {
      // Session persistence is a recovery aid, not a prerequisite for authoring.
    }
  }, []);

  const refreshWorkflow = useCallback(async (id = workflowId) => {
    if (!id) return null;
    const currentRequestId = workflowRequestId.current + 1;
    workflowRequestId.current = currentRequestId;
    try {
      const nextWorkflow = await getCatalogWorkflow(id, { developer: developerLensEnabled });
      if (workflowRequestId.current === currentRequestId) setWorkflow(nextWorkflow);
      return nextWorkflow;
    } catch (error) {
      if (workflowRequestId.current !== currentRequestId) return null;
      if (error?.response?.status === 404 && !activeProductId) {
        try {
          sessionStorage.removeItem(STORAGE_KEY);
        } catch {
          // The expired workflow can still be cleared from in-memory state.
        }
        setWorkflowId("");
        setDraft(null);
      }
      setActionError({
        kind: "workflow",
        retryable: retryableError(error),
        message: safeErrorMessage(error, "The workflow could not be refreshed."),
      });
      return null;
    }
  }, [activeProductId, developerLensEnabled, workflowId]);

  useEffect(() => {
    if (workflowId) refreshWorkflow(workflowId);
  }, [developerLensEnabled, refreshWorkflow, workflowId]);

  useEffect(() => {
    onDirtyChange?.(Boolean(!activeProductId && instruction.trim()) || editorDirty);
  }, [activeProductId, editorDirty, instruction, onDirtyChange]);

  useEffect(() => {
    setActiveDetail(null);
    setEditorDirty(false);
    setFieldVoiceTarget(null);
    setVoiceResetKey((current) => current + 1);
  }, [activeProductId]);

  const ensureWorkflow = async () => {
    if (workflowId) return workflowId;
    if (workflowStartPromise.current) return workflowStartPromise.current;
    const activeDraft = activeDetail?.current_draft;
    const workflowPayload = activeProductId && activeDraft ? {
      title: `Catalog Studio workbench for ${activeDetail.title || activeProductId}`,
      business_summary: "Contextual product, inventory, catalog, and readiness assistance.",
      draft_id: activeDraft.revision.id,
    } : {
      title: "Catalog Studio product creation",
      business_summary: "Text-guided catalog product creation workflow.",
    };
    const startPromise = startCatalogWorkflow(
      workflowPayload,
      mutationKey("start-workflow", workflowPayload),
    ).then((started) => {
      setWorkflowId(started.id);
      setWorkflow(started);
      if (!activeProductId) persist(started.id, null);
      delete mutationKeys.current["start-workflow"];
      trackCatalogStudioMilestone("workflow_started", { workflow_id: started.id });
      return started.id;
    }).finally(() => {
      workflowStartPromise.current = null;
    });
    workflowStartPromise.current = startPromise;
    return startPromise;
  };

  const submitInstruction = async (overrideInstruction) => {
    const nextInstruction = String(overrideInstruction ?? instruction).trim();
    if (!nextInstruction || commandInFlight.current) return;
    commandInFlight.current = true;
    setSubmitting(true);
    setActionError(null);
    setMessage("");

    try {
      const activeWorkflowId = await ensureWorkflow();

      const commandPayload = {
        instruction: nextInstruction,
        current_draft_id: draft?.id || null,
        expected_draft_version: draft?.draft_version || 0,
      };
      const result = await submitCatalogDraftCommand(
        activeWorkflowId,
        commandPayload,
        mutationKey("draft-command", commandPayload),
      );
      delete mutationKeys.current["draft-command"];
      setMessage(result.message);
      setInstruction("");
      if (result.status === "succeeded" && result.draft) {
        setDraft(result.draft);
        persist(activeWorkflowId, result.draft);
        setEditorRefreshKey((current) => current + 1);
        onCatalogChanged?.();
      }
      setWorkflow(result.workflow);
      trackCatalogStudioMilestone("draft_command_finished", {
        product_id: result.draft?.product_id,
        source: "text",
        status: result.status,
        workflow_id: activeWorkflowId,
      });
      await refreshWorkflow(activeWorkflowId);
    } catch (error) {
      const retryable = retryableError(error);
      setActionError({
        kind: "draft",
        retryable,
        instruction: nextInstruction,
        message: safeErrorMessage(error, "The instruction could not be applied. Your current draft is preserved."),
      });
      trackCatalogStudioMilestone("recovery_presented", {
        capability: "responses",
        retryable,
        status: error?.response?.status || "error",
        workflow_id: workflowId,
      });
    } finally {
      commandInFlight.current = false;
      setSubmitting(false);
    }
  };

  const runImageCommand = async (action = "generate", overridePayload = null) => {
    if (!workflowId || !draft || imageInFlight.current) return;
    imageInFlight.current = true;
    setImageBusy(true);
    setActionError(null);
    setPollExpired(false);
    try {
      const payload = overridePayload || {
          action,
          draft_id: draft.id,
          expected_draft_version: draft.draft_version,
          variant_index: 0,
          ...(action === "refine" ? { refinement_prompt: imageRefinement.trim() } : {}),
        };
      lastImagePayload.current = payload;
      const nextJob = await submitCatalogImageCommand(
        workflowId,
        payload,
        mutationKey(`image-${action}`, payload),
      );
      delete mutationKeys.current[`image-${action}`];
      pollAttempt.current = 0;
      approvedImageJobId.current = "";
      ignoredImageJobId.current = "";
      setImageJob(nextJob);
      setImageApproved(false);
      persist(workflowId, draft);
      setImageRefinement("");
      trackCatalogStudioMilestone("image_job_started", {
        action,
        product_id: draft.product_id,
        status: nextJob.status,
        workflow_id: workflowId,
      });
      await refreshWorkflow();
    } catch (error) {
      const retryable = retryableError(error);
      setActionError({
        kind: "image",
        retryable,
        imageAction: action,
        imagePayload: lastImagePayload.current,
        message: safeErrorMessage(error, "Image generation could not start. The product draft is unchanged."),
      });
      trackCatalogStudioMilestone("recovery_presented", {
        capability: "image_generation",
        retryable,
        status: error?.response?.status || "error",
        workflow_id: workflowId,
      });
    } finally {
      imageInFlight.current = false;
      setImageBusy(false);
    }
  };

  const refreshImageStatus = useCallback(async (jobId = imageJob?.id || workflow?.image_job_id) => {
    if (!workflowId || !jobId) return null;
    const currentRequestId = imageRequestId.current + 1;
    imageRequestId.current = currentRequestId;
    setPollExpired(false);
    try {
      const nextJob = await getCatalogImageJob(workflowId, jobId);
      if (imageRequestId.current !== currentRequestId) return null;
      setImageJob(nextJob);
      setImageApproved(approvedImageJobId.current === nextJob.id);
      setActionError((current) => current?.kind === "image-poll" ? null : current);
      const finished = !["queued", "running"].includes(nextJob.status);
      if (finished) {
        trackCatalogStudioMilestone("image_job_finished", {
          product_id: draft?.product_id,
          status: nextJob.status,
          workflow_id: workflowId,
        });
      }
      if (finished) await refreshWorkflow();
      return nextJob;
    } catch (error) {
      if (imageRequestId.current !== currentRequestId) return null;
      setActionError({
        kind: "image-poll",
        retryable: true,
        message: safeErrorMessage(error, "Image status could not be refreshed. The job may still be running."),
      });
      return null;
    }
  }, [draft?.product_id, imageJob?.id, refreshWorkflow, workflow?.image_job_id, workflowId]);

  useEffect(() => {
    const linkedJobId = workflow?.image_job_id;
    if (!linkedJobId || linkedJobId === imageJob?.id || linkedJobId === ignoredImageJobId.current) return;
    pollAttempt.current = 0;
    refreshImageStatus(linkedJobId);
  }, [imageJob?.id, refreshImageStatus, workflow?.image_job_id]);

  const resumeImagePolling = () => {
    pollAttempt.current = 0;
    refreshImageStatus();
  };

  useEffect(() => {
    if (!workflowId || !imageJob || !["queued", "running"].includes(imageJob.status)) return undefined;
    if (pollAttempt.current >= MAX_POLL_ATTEMPTS) {
      setPollExpired(true);
      return undefined;
    }
    const delay = Math.min(750 * (2 ** pollAttempt.current), 5000);
    const timer = window.setTimeout(async () => {
      pollAttempt.current += 1;
      await refreshImageStatus(imageJob.id);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [imageJob, refreshImageStatus, workflowId]);

  const approveImage = async () => {
    if (!workflowId || !draft || !imageJob || imageInFlight.current) return;
    imageInFlight.current = true;
    setImageBusy(true);
    setActionError(null);
    try {
      const payload = { draft_id: draft.id, expected_draft_version: draft.draft_version };
      await approveCatalogImageJob(
        workflowId,
        imageJob.id,
        payload,
        mutationKey("approve-image", payload),
      );
      delete mutationKeys.current["approve-image"];
      setImageApproved(true);
      approvedImageJobId.current = imageJob.id;
      let recoveryDraft = draft;
      if (draft.product_id) {
        const detail = await getAdminCatalogProduct(draft.product_id);
        const nextDraft = detail.current_draft;
        if (nextDraft) {
          const refreshedDraft = { ...draft, id: nextDraft.revision.id, draft_version: nextDraft.draft_version };
          recoveryDraft = refreshedDraft;
          setDraft(refreshedDraft);
        }
      }
      persist(workflowId, recoveryDraft);
      setEditorRefreshKey((current) => current + 1);
      trackCatalogStudioMilestone("image_approved", {
        product_id: draft.product_id,
        workflow_id: workflowId,
      });
      await refreshWorkflow();
    } catch (error) {
      setActionError({
        kind: "image-approval",
        retryable: retryableError(error),
        message: safeErrorMessage(error, "The image could not be approved. The previous draft state is preserved."),
      });
    } finally {
      imageInFlight.current = false;
      setImageBusy(false);
    }
  };

  const latestImageEvent = [...(workflow?.events || [])].reverse().find((event) => event.capability === "image_generation");
  const latestModerationEvent = [...(workflow?.events || [])].reverse().find((event) => event.capability === "moderation");
  const canRetryImageCommand = actionError?.kind === "image" && actionError.retryable;
  const canRetryImagePoll = actionError?.kind === "image-poll" && actionError.retryable;
  const canRetryImageApproval = actionError?.kind === "image-approval" && actionError.retryable;
  const canRetryFailedImage = imageJob?.status === "failed"
    && latestImageEvent?.retryable
    && (imageJob.action === "generate" || Boolean(lastImagePayload.current?.refinement_prompt));
  const blocked = latestModerationEvent?.status === "blocked";
  const publishedProductId = workflow?.published_product_id || "";
  const usesCanonicalEditor = Number(authoringSchemaVersion) >= 2;
  const usesStructuredSuggestions = Number(authoringSchemaVersion) >= 3;

  const resetWorkflow = () => {
    if (commandInFlight.current || imageInFlight.current) return;
    if (draft && !window.confirm("Start a new workflow? The existing private draft will remain in Catalog Studio.")) return;
    workflowRequestId.current += 1;
    imageRequestId.current += 1;
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // In-memory reset remains available when browser storage is blocked.
    }
    setWorkflow(null);
    setWorkflowId("");
    setDraft(null);
    setImageJob(null);
    setImageApproved(false);
    approvedImageJobId.current = "";
    ignoredImageJobId.current = "";
    setActionError(null);
    setMessage("");
    setEditorDirty(false);
    setVoiceResetKey((current) => current + 1);
  };

  const voiceToolResult = (result, activeWorkflowId) => {
    setMessage(result.message || "The voice command finished.");
    setActionError(null);
    if (result.status === "succeeded" && result.draft) {
      setDraft(result.draft);
      persist(activeWorkflowId, result.draft);
      setEditorRefreshKey((current) => current + 1);
      onCatalogChanged?.();
    }
    if (result.status === "succeeded" && result.suggestion_set) {
      setSuggestionRefreshKey((current) => current + 1);
    }
    if (result.workflow) setWorkflow(result.workflow);
    trackCatalogStudioMilestone("voice_command_finished", {
      product_id: result.draft?.product_id,
      source: "voice",
      status: result.status,
      workflow_id: activeWorkflowId,
    });
  };

  const lifecycleChanged = async (action, detail) => {
    setActiveDetail(detail || null);
    if (detail?.current_draft) {
      if (!activeProductId) {
        const nextDraft = { ...draft, id: detail.current_draft.revision.id, draft_version: detail.current_draft.draft_version };
        setDraft(nextDraft);
        persist(workflowId, nextDraft);
      }
    }
    await refreshWorkflow();
    onCatalogChanged?.();
    if (action === "published") {
      setEditorDirty(false);
      setMessage("The approved product is published. The workflow remains available as a read-only summary.");
      trackCatalogStudioMilestone("product_published", {
        product_id: detail?.product_id || draft?.product_id,
        workflow_id: workflowId,
      });
    }
  };

  const editorChanged = (detail) => {
    setActiveDetail(detail || null);
    if (activeProductId) {
      onCatalogChanged?.();
      return;
    }
    if (detail?.current_draft) {
      const nextDraft = {
        ...draft,
        id: detail.current_draft.revision.id,
        product_id: detail.product_id,
        draft_version: detail.current_draft.draft_version,
      };
      setDraft(nextDraft);
      if (imageJob && !imageApproved) {
        ignoredImageJobId.current = imageJob.id;
        setImageJob(null);
        setActionError(null);
        setPollExpired(false);
        pollAttempt.current = 0;
      }
      persist(workflowId, nextDraft);
    }
    onCatalogChanged?.();
  };

  const editorProductId = activeProductId || draft?.product_id || "";
  const contextualDraft = activeDetail?.current_draft;
  const voiceContext = contextualDraft ? {
    mode: fieldVoiceTarget ? "field" : "workbench",
    product_id: activeDetail.product_id,
    draft_id: contextualDraft.revision.id,
    expected_draft_version: contextualDraft.draft_version,
    ...(fieldVoiceTarget
      ? { target_path: fieldVoiceTarget.targetPath }
      : { query_scopes: ["product", "catalog", "inventory", "readiness"] }),
  } : null;
  const voiceContextKey = voiceContext
    ? `${voiceContext.product_id}:${voiceContext.draft_id}:${voiceContext.expected_draft_version}:${voiceContext.target_path || "workbench"}`
    : "new-product";
  const previousVoiceContextKey = useRef(voiceContextKey);
  useEffect(() => {
    if (previousVoiceContextKey.current === voiceContextKey) return;
    previousVoiceContextKey.current = voiceContextKey;
    setVoiceResetKey((current) => current + 1);
    if (fieldVoiceTarget) setFieldVoiceStartKey((current) => current + 1);
  }, [fieldVoiceTarget, voiceContextKey]);

  useEffect(() => {
    setFieldVoiceTarget(null);
    setFieldAiBusyTarget("");
  }, [editorProductId, contextualDraft?.revision?.id]);

  useEffect(() => {
    if (!editorDirty || !fieldVoiceTarget) return;
    setFieldVoiceTarget(null);
    setMessage("Field voice was reset because the draft has unsaved manual edits. Your edits are preserved.");
  }, [editorDirty, fieldVoiceTarget]);

  const requestFieldVoice = (target) => {
    if (editorDirty) {
      setMessage("Save or discard manual edits before starting field voice so the proposal compares against the current draft.");
      return;
    }
    setFieldVoiceTarget(target);
    setMessage(`Starting voice for ${target.label}. Dictation or refinement will remain a proposal until accepted.`);
  };

  const requestFieldAi = async (target) => {
    if (!editorProductId || !contextualDraft || fieldAiBusyTarget) return;
    if (editorDirty) {
      setMessage("Save or discard manual edits before generating a field proposal so the comparison uses the current draft.");
      return;
    }
    setFieldAiBusyTarget(target.targetPath);
    setActionError(null);
    try {
      const activeWorkflowId = await ensureWorkflow();
      const payload = {
        draft_id: contextualDraft.revision.id,
        expected_draft_version: contextualDraft.draft_version,
        workflow_id: activeWorkflowId,
        instruction: target.instruction,
        input_origin: "typed_action",
        source_asset_ids: [],
        target_paths: [target.targetPath],
      };
      const result = await generateCatalogSuggestionSet(
        editorProductId,
        payload,
        mutationKey("typed-field", payload),
      );
      delete mutationKeys.current["typed-field"];
      setMessage(result.message || `${target.label} proposal is ready for review.`);
      if (result.suggestion_set) setSuggestionRefreshKey((current) => current + 1);
    } catch (error) {
      setActionError({
        kind: "field-ai",
        retryable: retryableError(error),
        message: safeErrorMessage(error, "The field proposal could not be generated. The current draft is unchanged."),
      });
    } finally {
      setFieldAiBusyTarget("");
    }
  };

  const authoringDraftChanged = () => {
    setEditorRefreshKey((current) => current + 1);
    setSuggestionRefreshKey((current) => current + 1);
    onCatalogChanged?.();
  };

  return (
    <VStack align="stretch" gap={7} className="product-workbench">
      <HStack justify="space-between" gap={4} align="start" flexWrap="wrap">
        <Box>
          <Text className="section-kicker">Product workbench</Text>
          <Text as="h2" className="studio-column-title">{activeProductId ? "Edit product" : "Create product"}</Text>
          <Text className="muted-text" mt={2}>Product details, media, inventory, readiness, and AI assistance stay in one workspace.</Text>
        </Box>
        {!activeProductId && workflowId ? <Button type="button" className="secondary-button" disabled={submitting || imageBusy} onClick={resetWorkflow}>Start new product</Button> : null}
      </HStack>

      <HStack as="nav" aria-label="Product sections" className="product-workbench-sections" gap={2} flexWrap="wrap">
        <Button as="a" href="#workbench-product" size="sm" className="secondary-button">Product details</Button>
        {usesStructuredSuggestions ? <Button as="a" href="#workbench-sources" size="sm" className="secondary-button">Supplier sources</Button> : null}
        {usesStructuredSuggestions ? <Button as="a" href="#workbench-suggestions" size="sm" className="secondary-button">AI suggestions</Button> : null}
        <Button as="a" href="#workbench-media" size="sm" className="secondary-button">Media</Button>
        <Button as="a" href="#workbench-inventory" size="sm" className="secondary-button">Inventory</Button>
        <Button as="a" href="#workbench-readiness" size="sm" className="secondary-button">Preview & readiness</Button>
      </HStack>

      <Box className="workflow-prompt-panel">
        <Text className="section-kicker">AI assistant</Text>
        <Text className="panel-title">{activeProductId ? "Ask about this product" : "Describe the product outcome"}</Text>
        {!activeProductId ? <>
        <Textarea
          aria-label="Catalog product instruction"
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          placeholder={draft ? "Refine the current draft…" : "Create a tailored rose silk occasion dress for the Dallas assortment…"}
          rows={4}
          maxLength={4000}
          disabled={Boolean(publishedProductId)}
        />
        <HStack justify="space-between" gap={3} mt={3} flexWrap="wrap">
          <Text className="muted-text">{draft ? `Draft version ${draft.draft_version}` : "No draft yet"}</Text>
          <Button type="button" className="primary-button" disabled={Boolean(publishedProductId) || !instruction.trim() || submitting} onClick={() => submitInstruction()}>
            <FiSend /> {submitting ? "Working…" : draft ? "Refine draft" : "Create draft"}
          </Button>
        </HStack>
        </> : <Text className="muted-text" mt={2}>Use voice to ask about the active product, inventory, catalog context, or publish readiness. Manual editing remains available at all times.</Text>}
        <VoiceControls
          workflowId={workflowId}
          ensureWorkflow={ensureWorkflow}
          disabled={Boolean(publishedProductId) || submitting || imageBusy || Boolean(activeProductId && !voiceContext)}
          realtimeCapability={catalogStudioSession?.capabilities?.realtime}
          resetSignal={voiceResetKey}
          startSignal={fieldVoiceStartKey}
          sessionContext={voiceContext}
          contextLabel={fieldVoiceTarget?.label || ""}
          onToolResult={voiceToolResult}
          onWorkflowEvent={(activeWorkflowId) => { void refreshWorkflow(activeWorkflowId); }}
        />
        {fieldVoiceTarget ? (
          <HStack mt={3} justify="space-between" gap={3} flexWrap="wrap" className="catalog-editor-guidance">
            <Text>Field voice target: <strong>{fieldVoiceTarget.label}</strong>. The backend pins this field outside model-generated arguments.</Text>
            <Button type="button" size="sm" className="secondary-button" onClick={() => setFieldVoiceTarget(null)}>Return to product questions</Button>
          </HStack>
        ) : null}
      </Box>

      {message ? <Box className="workflow-message"><Text>{message}</Text></Box> : null}
      {publishedProductId ? (
        <Box className="workflow-message">
          <Text>This workflow is complete and read-only.</Text>
          <Link as={RouterLink} to={`/product/${publishedProductId}`} target="_blank" rel="noreferrer">View published product</Link>
        </Box>
      ) : null}
      {actionError ? (
        <Box className="catalog-conflict-alert" role="alert">
          <Text>{actionError.message}</Text>
          {actionError.kind === "draft" && actionError.retryable ? (
            <Button type="button" className="secondary-button" mt={3} onClick={() => submitInstruction(actionError.instruction)}><FiRefreshCw /> Retry instruction</Button>
          ) : null}
          {actionError.kind === "workflow" && actionError.retryable ? <Button type="button" className="secondary-button" mt={3} onClick={() => refreshWorkflow()}><FiRefreshCw /> Retry workflow refresh</Button> : null}
          {canRetryImageCommand ? (
            <Button type="button" className="secondary-button" mt={3} onClick={() => runImageCommand(actionError.imageAction || "generate", actionError.imagePayload)}><FiRefreshCw /> Retry image action</Button>
          ) : null}
          {canRetryImagePoll ? <Button type="button" className="secondary-button" mt={3} onClick={resumeImagePolling}><FiRefreshCw /> Retry image status</Button> : null}
          {canRetryImageApproval ? <Button type="button" className="secondary-button" mt={3} onClick={approveImage}><FiRefreshCw /> Retry image approval</Button> : null}
        </Box>
      ) : null}

      <SimpleGrid columns={{ base: 1, xl: usesCanonicalEditor ? 1 : 2 }} gap={6} alignItems="start">
        <Box id="workbench-api-stages" className="workflow-stage-panel">
          <Text className="section-kicker">API stages</Text>
          <Text className="panel-title" mb={4}>Business timeline</Text>
          <ApiStageTimeline events={workflow?.events || []} />
        </Box>

        {!usesCanonicalEditor ? <Box className="workflow-image-panel">
          <HStack justify="space-between" gap={3} mb={4}>
            <Box><Text className="section-kicker">Image review</Text><Text className="panel-title">Version-bound imagery</Text></Box>
            {imageJob ? <Badge className={`workflow-status ${imageJob.status}`}>{imageJob.status}</Badge> : null}
          </HStack>
          {!draft ? <Text className="muted-text">Create an approved product draft before generating imagery.</Text> : null}
          {blocked ? <Text className="catalog-action-hint">Moderation blocked this request. Image controls remain unavailable.</Text> : null}
          {draft && !blocked && !publishedProductId ? (
            <VStack align="stretch" gap={3}>
              {!imageJob ? <Button type="button" className="secondary-button" disabled={imageBusy} onClick={() => runImageCommand("generate")}><FiImage /> Generate primary image</Button> : null}
              {imageJob?.status === "succeeded" && !imageApproved ? <Button type="button" className="primary-button" disabled={imageBusy} onClick={approveImage}><FiThumbsUp /> Approve image</Button> : null}
              {imageApproved ? (
                <>
                  <Text className="notice-text">Image approved for this draft.</Text>
                  <Input aria-label="Image refinement instruction" value={imageRefinement} onChange={(event) => setImageRefinement(event.target.value)} placeholder="Adjust lighting or composition…" />
                  <Button type="button" className="secondary-button" disabled={imageBusy || !imageRefinement.trim()} onClick={() => runImageCommand("refine")}><FiImage /> Refine approved image</Button>
                </>
              ) : null}
              {canRetryFailedImage ? <Button type="button" className="secondary-button" onClick={() => runImageCommand(imageJob.action, lastImagePayload.current)}><FiRefreshCw /> Retry failed image</Button> : null}
              {pollExpired ? <Button type="button" className="secondary-button" onClick={resumeImagePolling}><FiRefreshCw /> Refresh image status</Button> : null}
            </VStack>
          ) : null}
        </Box> : null}
      </SimpleGrid>

      <DeveloperLens events={workflow?.events || []} />

      {usesStructuredSuggestions && editorProductId && contextualDraft ? (
        <>
          <ProductSourceTray
            productId={editorProductId}
            draft={contextualDraft}
            ensureWorkflow={ensureWorkflow}
            onDraftChanged={authoringDraftChanged}
            onSuggestionsChanged={() => setSuggestionRefreshKey((current) => current + 1)}
          />
          <SuggestionReviewPanel
            productId={editorProductId}
            draft={contextualDraft}
            refreshSignal={suggestionRefreshKey}
            onDraftChanged={authoringDraftChanged}
            manualEditsPending={editorDirty}
          />
        </>
      ) : null}

      {editorProductId && !publishedProductId ? (
        <Box id="workbench-product">
          <HStack justify="space-between" gap={3} mb={4} flexWrap="wrap">
            <Box><Text className="section-kicker">Product details</Text><Text className="panel-title">Edit and publish the product draft</Text></Box>
          </HStack>
          <ProductEditor
            productId={editorProductId}
            refreshKey={editorRefreshKey}
            onDirtyChange={setEditorDirty}
            onCatalogChanged={editorChanged}
            onLifecycleChanged={lifecycleChanged}
            authoringSchemaVersion={authoringSchemaVersion}
            references={references}
            referencesStatus={referencesStatus}
            onRetryReferences={onRetryReferences}
            onBrandAdded={onBrandAdded}
            onDetailChange={setActiveDetail}
            activeVoiceTarget={fieldVoiceTarget?.targetPath || ""}
            aiBusyTarget={fieldAiBusyTarget}
            onFieldVoiceRequest={requestFieldVoice}
            onFieldAiRequest={requestFieldAi}
            fieldActionsDisabled={editorDirty}
          />
        </Box>
      ) : null}
    </VStack>
  );
}
