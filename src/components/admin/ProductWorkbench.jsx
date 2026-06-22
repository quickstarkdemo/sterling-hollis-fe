import { Badge, Box, Button, Drawer, HStack, IconButton, Input, Link, Portal, Text, Textarea, VStack } from "@chakra-ui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FiImage, FiRefreshCw, FiSend, FiThumbsUp, FiX } from "react-icons/fi";
import { Link as RouterLink } from "react-router-dom";

import { useDeveloperLens } from "../DeveloperLensContext";
import { useCatalogStudioAccess } from "../CatalogStudioAccessContext";
import { useApiTrace } from "../ApiTraceContext";
import {
  approveCatalogImageJob,
  createIdempotencyKey,
  getAdminCatalogProduct,
  getCatalogImageJob,
  getCatalogWorkflow,
  startAdminCatalogProductRevision,
  startCatalogWorkflow,
  submitCatalogDraftCommand,
  submitCatalogImageCommand,
} from "../../utils/apiClient";
import { trackCatalogStudioMilestone } from "../../utils/datadog";
import CatalogGlobalAssistant from "./CatalogGlobalAssistant";
import ProductEditor from "./ProductEditor";
import ProductReviewPanel from "./ProductReviewPanel";
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

function WorkbenchTabPanel({ id, tabId, activeTab, children }) {
  const active = activeTab === tabId;
  return (
    <Box
      id={id}
      role="tabpanel"
      aria-labelledby={`workbench-tab-${tabId}`}
      className="product-workbench-panel"
      hidden={!active}
    >
      {children}
    </Box>
  );
}

export default function ProductWorkbench({
  activeProductId = "",
  onDirtyChange,
  onCatalogChanged,
  authoringSchemaVersion = 3,
  references,
  referencesStatus,
  onRetryReferences,
  onBrandAdded,
  assistantOpen = false,
  onAssistantOpenChange,
  inspectorOpen = true,
  onInspectorOpenChange,
}) {
  const initial = useMemo(() => activeProductId ? {} : restoredState(), [activeProductId]);
  const { enabled: developerLensEnabled } = useDeveloperLens();
  const { session: catalogStudioSession } = useCatalogStudioAccess();
  const { startAction } = useApiTrace();
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
  const [activeWorkbenchTab, setActiveWorkbenchTab] = useState(activeProductId ? "product" : "chat");
  const [activeDetail, setActiveDetail] = useState(null);
  const [productDetailStatus, setProductDetailStatus] = useState(activeProductId ? "loading" : "idle");
  const [suggestionRefreshKey, setSuggestionRefreshKey] = useState(0);
  const commandInFlight = useRef(false);
  const workflowStartPromise = useRef(null);
  const imageInFlight = useRef(false);
  const mutationKeys = useRef({});
  const pollAttempt = useRef(0);
  const lastImagePayload = useRef(null);
  const workflowRequestId = useRef(0);
  const imageRequestId = useRef(0);
  const productDetailRequestId = useRef(0);
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
    setProductDetailStatus(activeProductId ? "loading" : "idle");
    setEditorDirty(false);
    setVoiceResetKey((current) => current + 1);
    setActiveWorkbenchTab(activeProductId ? "product" : "chat");
  }, [activeProductId]);

  useEffect(() => {
    if (!activeProductId) return undefined;
    const currentRequestId = productDetailRequestId.current + 1;
    productDetailRequestId.current = currentRequestId;
    setProductDetailStatus("loading");

    Promise.resolve(getAdminCatalogProduct(activeProductId))
      .then((nextDetail) => {
        if (productDetailRequestId.current !== currentRequestId) return;
        setActiveDetail(nextDetail || null);
        setProductDetailStatus("ready");
      })
      .catch(() => {
        if (productDetailRequestId.current !== currentRequestId) return;
        setProductDetailStatus("error");
      });

    return () => {
      productDetailRequestId.current += 1;
    };
  }, [activeProductId, editorRefreshKey]);

  const ensureWorkflow = async (options = {}) => {
    if (workflowId) return workflowId;
    if (workflowStartPromise.current) return workflowStartPromise.current;
    const workflowDetail = options?.detail || activeDetail;
    const activeDraft = options?.draft || workflowDetail?.current_draft;
    const assistantOnly = options?.purpose === "assistant";
    const workflowPayload = activeProductId && activeDraft ? {
      title: `Product Catalog workbench for ${workflowDetail?.title || activeProductId}`,
      business_summary: "Contextual product, inventory, catalog, and readiness assistance.",
      draft_id: activeDraft.revision.id,
    } : assistantOnly ? {
      title: "Product Catalog assistant",
      business_summary: "Read-only catalog and inventory assistant workflow.",
    } : {
      title: "Product Catalog product creation",
      business_summary: "Text-guided product creation workflow.",
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

  const ensureActiveProductDraft = async () => {
    if (!activeProductId) return { detail: activeDetail, draft: null };
    let detail = activeDetail;
    if (!detail) {
      setProductDetailStatus("loading");
      detail = await getAdminCatalogProduct(activeProductId);
      setActiveDetail(detail || null);
      setProductDetailStatus(detail ? "ready" : "error");
    }
    if (!detail) throw new Error("Product details are unavailable.");
    if (detail.current_draft) return { detail, draft: detail.current_draft };

    const revisionPayload = { expected_version: detail.version };
    const nextDraft = await startAdminCatalogProductRevision(
      activeProductId,
      revisionPayload,
      mutationKey("start-product-revision", revisionPayload),
    );
    delete mutationKeys.current["start-product-revision"];
    const nextDetail = { ...detail, current_draft: nextDraft };
    setActiveDetail(nextDetail);
    setEditorRefreshKey((current) => current + 1);
    return { detail: nextDetail, draft: nextDraft };
  };

  const submitInstruction = async (overrideInstruction) => {
    const nextInstruction = String(overrideInstruction ?? instruction).trim();
    if (!nextInstruction || commandInFlight.current) return;
    commandInFlight.current = true;
    setSubmitting(true);
    setActionError(null);
    setMessage("");
    let traceAction = null;

    try {
      const ensured = activeProductId ? await ensureActiveProductDraft() : { detail: activeDetail, draft: null };
      const productDraft = ensured.draft;
      const commandDraft = activeProductId && productDraft ? {
        id: productDraft.revision.id,
        product_id: ensured.detail?.product_id || activeProductId,
        draft_version: productDraft.draft_version,
      } : draft;
      traceAction = startAction(commandDraft ? "Refine catalog product draft" : "Create catalog product draft", {
        surface: "catalog-studio",
        attributes: {
          action: commandDraft ? "draft_refine" : "draft_create",
          draft_id: commandDraft?.id || "",
          product_id: commandDraft?.product_id || activeProductId || "",
          workflow_id: workflowId,
        },
      });
      const activeWorkflowId = await ensureWorkflow({ detail: ensured.detail, draft: productDraft });

      const commandPayload = {
        instruction: nextInstruction,
        current_draft_id: commandDraft?.id || null,
        expected_draft_version: commandDraft?.draft_version || 0,
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
        if (!activeProductId) {
          setDraft(result.draft);
          persist(activeWorkflowId, result.draft);
          setActiveWorkbenchTab("product");
        } else {
          setSuggestionRefreshKey((current) => current + 1);
        }
        setEditorRefreshKey((current) => current + 1);
        onCatalogChanged?.();
      }
      setWorkflow(result.workflow);
      trackCatalogStudioMilestone("draft_command_finished", {
        product_id: result.draft?.product_id || commandDraft?.product_id || activeProductId || "",
        source: "text",
        status: result.status,
        workflow_id: activeWorkflowId,
      });
      await refreshWorkflow(activeWorkflowId);
      traceAction.end(result.status === "succeeded" ? "completed" : "failed", {
        draft_id: result.draft?.id || commandDraft?.id || "",
        product_id: result.draft?.product_id || commandDraft?.product_id || activeProductId || "",
        workflow_id: activeWorkflowId,
      });
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
      traceAction?.end("failed", {
        error_code: error?.response?.status || error?.code || error?.name || "draft_command_error",
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
    const traceAction = startAction(action === "refine" ? "Refine catalog image" : "Generate catalog image", {
      surface: "catalog-studio",
      attributes: {
        action: `image_${action}`,
        draft_id: draft.id,
        product_id: draft.product_id || activeProductId || "",
        workflow_id: workflowId,
      },
    });
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
      traceAction.end("completed", {
        draft_id: draft.id,
        job_id: nextJob.id,
        product_id: draft.product_id || activeProductId || "",
        workflow_id: workflowId,
      });
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
      traceAction.end("failed", {
        error_code: error?.response?.status || error?.code || error?.name || "image_command_error",
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
    const traceAction = startAction("Approve catalog image", {
      surface: "catalog-studio",
      attributes: {
        action: "image_approve",
        draft_id: draft.id,
        job_id: imageJob.id,
        product_id: draft.product_id || activeProductId || "",
        workflow_id: workflowId,
      },
    });
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
      traceAction.end("completed", {
        draft_id: recoveryDraft?.id || draft.id,
        job_id: imageJob.id,
        product_id: recoveryDraft?.product_id || draft.product_id || activeProductId || "",
        workflow_id: workflowId,
      });
    } catch (error) {
      setActionError({
        kind: "image-approval",
        retryable: retryableError(error),
        message: safeErrorMessage(error, "The image could not be approved. The previous draft state is preserved."),
      });
      traceAction.end("failed", {
        error_code: error?.response?.status || error?.code || error?.name || "image_approval_error",
        workflow_id: workflowId,
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
      setActiveWorkbenchTab("product");
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
      setActiveWorkbenchTab("chat");
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
    mode: "workbench",
    product_id: activeDetail.product_id,
    draft_id: contextualDraft.revision.id,
    expected_draft_version: contextualDraft.draft_version,
    query_scopes: ["product", "catalog", "inventory", "readiness"],
  } : null;
  const voiceContextKey = voiceContext
    ? `${voiceContext.product_id}:${voiceContext.draft_id}:${voiceContext.expected_draft_version}:workbench`
    : "new-product";
  const previousVoiceContextKey = useRef(voiceContextKey);
  useEffect(() => {
    if (previousVoiceContextKey.current === voiceContextKey) return;
    previousVoiceContextKey.current = voiceContextKey;
    setVoiceResetKey((current) => current + 1);
  }, [voiceContextKey]);

  const authoringDraftChanged = () => {
    setEditorRefreshKey((current) => current + 1);
    setSuggestionRefreshKey((current) => current + 1);
    onCatalogChanged?.();
  };

  const availableTabs = useMemo(() => [
    ...(editorProductId && !publishedProductId ? [{ id: "product", label: "Product details" }] : []),
    ...(editorProductId ? [{ id: "reviews", label: "Reviews" }] : []),
    ...(usesStructuredSuggestions && editorProductId && contextualDraft ? [
      { id: "sources", label: "Supplier import" },
      { id: "suggestions", label: "Suggestions" },
    ] : []),
    { id: "chat", label: editorProductId ? "Product chat" : "Draft assistant" },
    ...(!usesCanonicalEditor && draft ? [{ id: "legacyImages", label: "Legacy images" }] : []),
  ], [contextualDraft, draft, editorProductId, publishedProductId, usesCanonicalEditor, usesStructuredSuggestions]);
  const activeTabIsAvailable = availableTabs.some((tab) => tab.id === activeWorkbenchTab);
  const chatDraftVersion = activeProductId ? contextualDraft?.draft_version : draft?.draft_version;
  const chatReady = !activeProductId || productDetailStatus === "ready" || Boolean(activeDetail);
  const chatPlaceholder = activeProductId
    ? "Ask for reviewable product changes across copy, SEO, images, inventory, or publish readiness..."
    : draft ? "Refine the current draft..." : "Create a tailored rose silk occasion dress for the Dallas assortment...";
  const chatStatusText = activeProductId
    ? chatDraftVersion
      ? `Draft version ${chatDraftVersion}`
      : productDetailStatus === "loading"
        ? "Loading product details..."
        : productDetailStatus === "error"
          ? "Product details unavailable"
          : "Draft will start on first refinement"
    : chatDraftVersion ? `Draft version ${chatDraftVersion}` : "No draft yet";
  const chatActionLabel = activeProductId || draft ? "Refine draft" : "Create draft";

  useEffect(() => {
    if (activeTabIsAvailable) return;
    setActiveWorkbenchTab(availableTabs[0]?.id || "chat");
  }, [activeTabIsAvailable, availableTabs]);
  const inspectorTitle = activeProductId ? "Edit product" : "Create product";

  return (
    <>
    <CatalogGlobalAssistant
      workflowId={workflowId}
      ensureWorkflow={() => ensureWorkflow({ purpose: "assistant" })}
      open={assistantOpen}
      onOpenChange={onAssistantOpenChange}
      realtimeCapability={catalogStudioSession?.capabilities?.realtime}
      resetSignal={voiceResetKey}
      onWorkflowEvent={(activeWorkflowId) => { void refreshWorkflow(activeWorkflowId); }}
    />

    <Drawer.Root
      open={inspectorOpen}
      onOpenChange={(details) => onInspectorOpenChange?.(details.open)}
      placement="end"
      size="full"
      modal={false}
      trapFocus={false}
      preventScroll={false}
      restoreFocus={false}
    >
      <Portal>
        <Drawer.Positioner pointerEvents="none">
          <Drawer.Content className="product-inspector-drawer-content" pointerEvents="auto">
            <Drawer.Header className="product-inspector-drawer-header">
              <Box minW={0}>
                <Drawer.Title asChild>
                  <Text className="assistant-title">Product inspector</Text>
                </Drawer.Title>
                <Drawer.Description className="muted-mini">{inspectorTitle}</Drawer.Description>
              </Box>
              <IconButton type="button" size="sm" variant="ghost" className="icon-button" aria-label="Close product inspector" onClick={() => onInspectorOpenChange?.(false)}>
                <FiX />
              </IconButton>
            </Drawer.Header>
            <Drawer.Body className="product-inspector-drawer-body">
              <VStack align="stretch" gap={7} className="product-workbench">
                <HStack justify="space-between" gap={4} align="start" flexWrap="wrap" className="product-workbench-header">
                  <Box>
                    <Text className="section-kicker">Product workspace</Text>
                    <Text as="h2" className="studio-column-title">{activeProductId ? "Edit product" : "Create product"}</Text>
                    <Text className="muted-text" mt={2}>Edit product facts, images, pricing, and store inventory first. Assistant tools stay available when you need proposals.</Text>
                  </Box>
                  {!activeProductId && workflowId ? <Button type="button" className="secondary-button" disabled={submitting || imageBusy} onClick={resetWorkflow}>Start new product</Button> : null}
                </HStack>

      <HStack role="tablist" aria-label="Product workbench" className="product-workbench-tabs" gap={1} flexWrap="wrap">
        {availableTabs.map((tab) => (
          <Button
            key={tab.id}
            id={`workbench-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={activeWorkbenchTab === tab.id}
            aria-controls={`workbench-${tab.id}`}
            size="sm"
            className={`product-workbench-tab ${activeWorkbenchTab === tab.id ? "active" : ""}`}
            onClick={() => setActiveWorkbenchTab(tab.id)}
          >
            {tab.label}
          </Button>
        ))}
      </HStack>

      <WorkbenchTabPanel id="workbench-product" tabId="product" activeTab={activeWorkbenchTab}>
        {editorProductId && !publishedProductId ? (
          <HStack justify="space-between" gap={3} mb={4} flexWrap="wrap">
            <Box><Text className="section-kicker">Product details</Text><Text className="panel-title">Edit and publish the product draft</Text></Box>
          </HStack>
        ) : null}
        {editorProductId && !publishedProductId ? (
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
          />
        ) : null}
      </WorkbenchTabPanel>

      <WorkbenchTabPanel id="workbench-reviews" tabId="reviews" activeTab={activeWorkbenchTab}>
      {editorProductId ? (
        <ProductReviewPanel
          productId={editorProductId}
          manualEditsPending={editorDirty}
        />
      ) : null}
      </WorkbenchTabPanel>

      <WorkbenchTabPanel id="workbench-chat" tabId="chat" activeTab={activeWorkbenchTab}>
      <Box className="workflow-prompt-panel">
        <Text className="section-kicker">{editorProductId ? "Product chat" : "Draft assistant"}</Text>
        <Text className="panel-title">{editorProductId ? "Ask for product-wide changes" : "Describe the product outcome"}</Text>
        <Textarea
          aria-label="Catalog product instruction"
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          placeholder={chatPlaceholder}
          rows={4}
          maxLength={4000}
          disabled={Boolean(publishedProductId) || !chatReady}
        />
        <HStack justify="space-between" gap={3} mt={3} flexWrap="wrap">
          <Text className="muted-text">{chatStatusText}</Text>
          <Button type="button" className="primary-button" disabled={Boolean(publishedProductId) || !chatReady || !instruction.trim() || submitting} onClick={() => submitInstruction()}>
            <FiSend /> {submitting ? "Working..." : chatActionLabel}
          </Button>
        </HStack>
        <VoiceControls
          workflowId={workflowId}
          ensureWorkflow={ensureWorkflow}
          disabled={Boolean(publishedProductId) || submitting || imageBusy || Boolean(activeProductId && !voiceContext)}
          realtimeCapability={catalogStudioSession?.capabilities?.realtime}
          resetSignal={voiceResetKey}
          sessionContext={voiceContext}
          contextLabel={activeDetail?.title || activeProductId || ""}
          onToolResult={voiceToolResult}
          onWorkflowEvent={(activeWorkflowId) => { void refreshWorkflow(activeWorkflowId); }}
        />
      </Box>
      </WorkbenchTabPanel>

      <WorkbenchTabPanel id="workbench-sources" tabId="sources" activeTab={activeWorkbenchTab}>
        {usesStructuredSuggestions && editorProductId && contextualDraft ? (
          <ProductSourceTray
            productId={editorProductId}
            draft={contextualDraft}
            ensureWorkflow={ensureWorkflow}
            onDraftChanged={authoringDraftChanged}
            onSuggestionsChanged={() => setSuggestionRefreshKey((current) => current + 1)}
          />
        ) : null}
      </WorkbenchTabPanel>

      <WorkbenchTabPanel id="workbench-suggestions" tabId="suggestions" activeTab={activeWorkbenchTab}>
        {usesStructuredSuggestions && editorProductId && contextualDraft ? (
          <SuggestionReviewPanel
            productId={editorProductId}
            draft={contextualDraft}
            refreshSignal={suggestionRefreshKey}
            onDraftChanged={authoringDraftChanged}
            manualEditsPending={editorDirty}
          />
        ) : null}
      </WorkbenchTabPanel>

      {message ? <Box className="workflow-message product-workbench-status"><Text>{message}</Text></Box> : null}
      {publishedProductId ? (
        <Box className="workflow-message product-workbench-status">
          <Text>This workflow is complete and read-only.</Text>
          <Link as={RouterLink} to={`/product/${publishedProductId}`} target="_blank" rel="noreferrer">View published product</Link>
        </Box>
      ) : null}
      {actionError ? (
        <Box className="catalog-conflict-alert product-workbench-status" role="alert">
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

      <WorkbenchTabPanel id="workbench-legacy-images" tabId="legacyImages" activeTab={activeWorkbenchTab}>
      {!usesCanonicalEditor && draft ? (
        <Box className="workflow-image-panel">
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
        </Box>
      ) : null}
      </WorkbenchTabPanel>

              </VStack>
            </Drawer.Body>
          </Drawer.Content>
        </Drawer.Positioner>
      </Portal>
    </Drawer.Root>
    </>
  );
}
