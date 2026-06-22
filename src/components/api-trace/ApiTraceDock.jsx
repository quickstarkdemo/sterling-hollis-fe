import { Badge, Box, Button, HStack, Text } from "@chakra-ui/react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FiActivity,
  FiCheck,
  FiChevronDown,
  FiChevronUp,
  FiCopy,
  FiDownload,
  FiRefreshCw,
  FiTrash2,
} from "react-icons/fi";

import { useApiTrace } from "../ApiTraceContext";
import { downloadAdminApiTrace } from "../../utils/apiClient";
import {
  formatTraceDuration,
  formatTraceTime,
  fullTraceValue,
  traceJson,
} from "../../utils/apiTraceProjection";
import TraceArtifactViewer from "./TraceArtifactViewer";
import TraceEventLog from "./TraceEventLog";
import TraceInspector from "./TraceInspector";
import TraceReplayControls from "./TraceReplayControls";
import TraceWaterfall from "./TraceWaterfall";
import useTraceReplay from "../../hooks/useTraceReplay";

const TraceGraph = lazy(() => import("./TraceGraph"));
const STORAGE_KEY = "sterling-hollis:api-trace-dock:v1";
const VIEWS = [
  { id: "graph", label: "Graph" },
  { id: "waterfall", label: "Waterfall" },
  { id: "events", label: "Events" },
  { id: "artifacts", label: "Artifacts" },
  { id: "inspector", label: "Inspector" },
];

function initialPreference() {
  try {
    const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "{}");
    return {
      expanded: stored.expanded === true,
      height: Math.max(300, Math.min(720, Number(stored.height) || 430)),
      view: VIEWS.some((view) => view.id === stored.view) ? stored.view : "graph",
    };
  } catch {
    return { expanded: false, height: 430, view: "graph" };
  }
}

function traceLifecycle(trace, traceStatus, connectionStatus) {
  if (traceStatus === "expired" || connectionStatus === "expired") return "expired";
  if (trace?.payload_expired) return "metadata-only";
  if (trace?.status && !["live", "running"].includes(trace.status)) return trace.status;
  if (connectionStatus === "reconnecting") return "reconnecting";
  if (connectionStatus === "partial") return "partial";
  return trace?.status || (traceStatus === "loading" ? "loading" : "live");
}

function persistPreference(preference) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(preference));
  } catch {
    // Session storage is optional; the dock remains fully functional without it.
  }
}

export default function ApiTraceDock() {
  const {
    authorized,
    available,
    enabled,
    recentTraces,
    recentStatus,
    selectedTraceId,
    selectedTrace,
    traceStatus,
    connectionStatus,
    traceError,
    selectTrace,
    deleteTraceIds,
    refreshTraces,
  } = useApiTrace();
  const [preference, setPreference] = useState(initialPreference);
  const [selection, setSelection] = useState({ kind: "trace", id: "" });
  const [copied, setCopied] = useState(false);
  const [exportStatus, setExportStatus] = useState("idle");
  const [deleteMode, setDeleteMode] = useState(false);
  const [deleteSelection, setDeleteSelection] = useState(() => new Set());
  const replay = useTraceReplay(selectedTrace);
  const visibleTrace = replay.projection;
  const copyTimer = useRef(null);
  const dockRef = useRef(null);
  const collapsedButtonRef = useRef(null);
  const previousExpanded = useRef(preference.expanded);
  const focusFrame = useRef(null);
  const resizeCleanup = useRef(null);

  useEffect(() => () => {
    window.clearTimeout(copyTimer.current);
    window.cancelAnimationFrame(focusFrame.current);
    resizeCleanup.current?.();
  }, []);
  useEffect(() => setSelection({ kind: "trace", id: selectedTraceId }), [selectedTraceId]);
  useEffect(() => {
    if (previousExpanded.current === preference.expanded) return;
    previousExpanded.current = preference.expanded;
    focusFrame.current = window.requestAnimationFrame(() => {
      if (preference.expanded) {
        dockRef.current?.querySelector('[role="tab"][aria-selected="true"]')?.focus();
      } else {
        collapsedButtonRef.current?.focus();
      }
    });
  }, [preference.expanded]);
  useEffect(() => {
    setDeleteSelection((current) => new Set([...current].filter((traceId) => recentTraces.some((trace) => trace.trace_id === traceId))));
  }, [recentTraces]);

  const updatePreference = useCallback((updates) => {
    setPreference((current) => {
      const next = { ...current, ...updates };
      persistPreference(next);
      return next;
    });
  }, []);

  const lifecycle = replay.active ? "replay" : traceLifecycle(selectedTrace, traceStatus, connectionStatus);
  const selectedSummary = useMemo(
    () => recentTraces.find((trace) => trace.trace_id === selectedTraceId),
    [recentTraces, selectedTraceId],
  );

  const onResizeStart = useCallback((event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = preference.height;
    const move = (moveEvent) => {
      const height = Math.max(300, Math.min(Math.min(720, window.innerHeight - 80), startHeight + startY - moveEvent.clientY));
      setPreference((current) => ({ ...current, height }));
    };
    const removeListeners = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      resizeCleanup.current = null;
    };
    const finish = () => {
      removeListeners();
      setPreference((current) => {
        persistPreference(current);
        return current;
      });
    };
    resizeCleanup.current?.();
    resizeCleanup.current = removeListeners;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
  }, [preference.height]);

  const copyTrace = async () => {
    if (!selectedTrace) return;
    try {
      await navigator.clipboard.writeText(traceJson(selectedTrace, { sanitize: false, maxChars: Infinity }).text);
      setCopied(true);
      window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const exportTrace = async () => {
    if (!selectedTraceId || !selectedTrace) return;
    setExportStatus("working");
    try {
      let source = selectedTrace;
      try {
        const response = await downloadAdminApiTrace(selectedTraceId);
        source = JSON.parse(await response.data.text());
      } catch {
        // The selected server projection is already loaded and is a safe fallback.
      }
      const blob = new Blob([JSON.stringify(fullTraceValue(source), null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `api-trace-${selectedTraceId.replace(/[^A-Za-z0-9_-]/g, "_")}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setExportStatus("done");
    } catch {
      setExportStatus("error");
    }
  };

  const navigateTraceList = (event, traceId) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const index = recentTraces.findIndex((trace) => trace.trace_id === traceId);
    const offset = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex = (index + offset + recentTraces.length) % recentTraces.length;
    const next = recentTraces[nextIndex];
    if (next) {
      selectTrace(next.trace_id);
      event.currentTarget.parentElement?.querySelectorAll('[role="option"]')[nextIndex]?.focus();
    }
  };

  const toggleDeleteSelection = (traceId) => {
    setDeleteSelection((current) => {
      const next = new Set(current);
      if (next.has(traceId)) next.delete(traceId);
      else next.add(traceId);
      return next;
    });
  };

  const deleteSelectedTraces = () => {
    const traceIds = deleteSelection.size ? [...deleteSelection] : [selectedTraceId].filter(Boolean);
    deleteTraceIds(traceIds);
    setDeleteSelection(new Set());
    setDeleteMode(false);
  };

  if (!authorized || !available || !enabled) return null;

  if (!preference.expanded) {
    return (
      <Box className="api-trace-dock collapsed" aria-label="API trace visualizer">
        <Button ref={collapsedButtonRef} type="button" className="api-trace-strip" onClick={() => updatePreference({ expanded: true })} aria-expanded="false">
          <FiChevronUp />
          <span>Dev Tools</span>
          <Badge className="api-trace-count">{recentTraces.length}</Badge>
          <span className="api-trace-strip-name">{selectedSummary?.name || "Waiting for an instrumented action"}</span>
        </Button>
      </Box>
    );
  }

  return (
    <Box
      ref={dockRef}
      className="api-trace-dock expanded"
      style={{ height: `${preference.height}px` }}
      aria-label="API trace visualizer"
      onKeyDown={(event) => {
        if (event.key === "Escape") updatePreference({ expanded: false });
      }}
    >
      <button
        type="button"
        className="api-trace-resize-handle"
        aria-label="Resize API trace dock"
        onPointerDown={onResizeStart}
        onKeyDown={(event) => {
          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
          event.preventDefault();
          const direction = event.key === "ArrowUp" ? 24 : -24;
          updatePreference({ height: Math.max(300, Math.min(720, preference.height + direction)) });
        }}
      />
      <Box className="api-trace-toolbar">
        <HStack gap={3} minW={0}>
          <Box className="api-trace-mark"><FiActivity /></Box>
          <Box minW={0}>
            <Text className="section-kicker">Developer tools</Text>
            <Text className="api-trace-title">Trace tray</Text>
          </Box>
          <Badge className={`api-trace-state ${lifecycle}`}>{lifecycle}</Badge>
          <Badge className={`api-trace-connection ${connectionStatus}`}>{connectionStatus}</Badge>
        </HStack>
        <HStack gap={1}>
          <Button type="button" size="xs" variant="ghost" className="trace-icon-button" onClick={refreshTraces} aria-label="Refresh traces">
            <FiRefreshCw />
          </Button>
          <Button type="button" size="xs" variant="ghost" className="trace-icon-button" onClick={() => deleteTraceIds([selectedTraceId])} disabled={!selectedTraceId} aria-label="Delete current trace">
            <FiTrash2 /> Delete
          </Button>
          <Button type="button" size="xs" variant="ghost" className="trace-icon-button" onClick={copyTrace} disabled={!selectedTrace}>
            {copied ? <FiCheck /> : <FiCopy />} {copied ? "Copied" : "Copy"}
          </Button>
          <Button type="button" size="xs" variant="ghost" className="trace-icon-button" onClick={exportTrace} disabled={!selectedTrace || exportStatus === "working"}>
            <FiDownload /> {exportStatus === "working" ? "Exporting" : "JSON"}
          </Button>
          <Button type="button" size="xs" variant="ghost" className="trace-icon-button" onClick={() => updatePreference({ expanded: false })} aria-expanded="true" aria-label="Collapse API trace dock">
            <FiChevronDown />
          </Button>
        </HStack>
      </Box>

      <Box className="api-trace-body">
        <Box as="nav" className="api-trace-recents" aria-label="Recent API traces">
          <Box className="api-trace-section-heading">
            <Text className="filter-label">Recent traces</Text>
            <HStack gap={2}>
              {deleteMode ? (
                <>
                  <Button type="button" size="xs" variant="ghost" className="trace-list-action" onClick={() => setDeleteSelection(new Set(recentTraces.map((trace) => trace.trace_id)))}>
                    All
                  </Button>
                  <Button type="button" size="xs" variant="ghost" className="trace-list-action danger" disabled={!deleteSelection.size} onClick={deleteSelectedTraces}>
                    Delete {deleteSelection.size || ""}
                  </Button>
                  <Button type="button" size="xs" variant="ghost" className="trace-list-action" onClick={() => { setDeleteMode(false); setDeleteSelection(new Set()); }}>
                    Done
                  </Button>
                </>
              ) : (
                <>
                  <Text>{recentTraces.length}</Text>
                  <Button type="button" size="xs" variant="ghost" className="trace-list-action" onClick={() => setDeleteMode(true)}>
                    Manage
                  </Button>
                </>
              )}
            </HStack>
          </Box>
          {recentStatus === "loading" ? <Text className="api-trace-empty">Loading recent traces…</Text> : null}
          {recentStatus === "error" ? <Text className="api-trace-error">{traceError}</Text> : null}
          {recentStatus !== "loading" && !recentTraces.length ? <Text className="api-trace-empty">Perform an instrumented action to begin.</Text> : null}
          <Box className="api-trace-list" role="listbox" aria-label="Recent API traces">
            {recentTraces.map((trace) => (
              <button
                type="button"
                role="option"
                aria-selected={trace.trace_id === selectedTraceId}
                key={trace.trace_id}
                className={`api-trace-list-item${trace.trace_id === selectedTraceId ? " selected" : ""}${deleteSelection.has(trace.trace_id) ? " marked" : ""}`}
                onClick={() => {
                  if (deleteMode) toggleDeleteSelection(trace.trace_id);
                  else selectTrace(trace.trace_id);
                }}
                onKeyDown={(event) => navigateTraceList(event, trace.trace_id)}
              >
                <span><strong>{trace.name}</strong><small>{trace.surface} · {formatTraceTime(trace.started_at)}</small></span>
                <span><Badge className={`api-trace-state ${trace.payload_expired ? "metadata-only" : trace.status}`}>{trace.payload_expired ? "metadata" : trace.status}</Badge><small>{formatTraceDuration(trace.duration_ms)}</small></span>
              </button>
            ))}
          </Box>
        </Box>

        <Box className="api-trace-workspace">
          <Box className="api-trace-view-tabs" role="tablist" aria-label="Trace views">
            {VIEWS.map((view) => (
              <button
                type="button"
                role="tab"
                aria-selected={preference.view === view.id}
                key={view.id}
                onClick={() => updatePreference({ view: view.id })}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
                  event.preventDefault();
                  const index = VIEWS.findIndex((item) => item.id === view.id);
                  const offset = event.key === "ArrowRight" ? 1 : -1;
                  const nextIndex = (index + offset + VIEWS.length) % VIEWS.length;
                  updatePreference({ view: VIEWS[nextIndex].id });
                  event.currentTarget.parentElement?.querySelectorAll('[role="tab"]')[nextIndex]?.focus();
                }}
              >{view.label}</button>
            ))}
          </Box>
          <TraceReplayControls replay={replay} disabled={!selectedTrace?.spans?.length} />
          <Box className="api-trace-view" role="tabpanel">
            {traceStatus === "loading" ? <Text className="api-trace-empty">Loading trace projection…</Text> : null}
            {traceStatus === "error" || traceStatus === "expired" ? <Box className={`api-trace-notice ${traceStatus}`}>{traceError || "This trace has expired."}</Box> : null}
            {preference.view === "graph" ? (
              <Suspense fallback={<Text className="api-trace-empty">Loading system graph…</Text>}>
                <TraceGraph trace={visibleTrace} selection={selection} onSelect={setSelection} />
              </Suspense>
            ) : null}
            {preference.view === "waterfall" ? <TraceWaterfall trace={visibleTrace} selection={selection} onSelect={setSelection} /> : null}
            {preference.view === "events" ? <TraceEventLog trace={visibleTrace} selection={selection} onSelect={setSelection} /> : null}
            {preference.view === "artifacts" ? <TraceArtifactViewer artifacts={visibleTrace?.artifacts} selection={selection} onSelect={setSelection} /> : null}
            {preference.view === "inspector" ? <TraceInspector trace={visibleTrace} selection={selection} /> : null}
          </Box>
        </Box>

        <Box className="api-trace-inspector-pane">
          <TraceInspector trace={visibleTrace} selection={selection} />
        </Box>
      </Box>
      {exportStatus === "error" ? <Text className="api-trace-export-error">The trace could not be exported.</Text> : null}
    </Box>
  );
}
