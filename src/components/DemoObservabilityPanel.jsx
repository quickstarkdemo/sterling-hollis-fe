import { Box, Button, HStack, Input, SimpleGrid, Text, VStack } from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { FiRefreshCw, FiZap } from "react-icons/fi";

import {
  DEFAULT_STORE_ID,
  getDemoObservabilityState,
  resetDemoObservabilityState,
  updateDemoObservabilityState,
} from "../utils/apiClient";
import { trackAction } from "../utils/datadog";

const DEFAULT_TARGET_STORE_ID = DEFAULT_STORE_ID || "1001";

const modeOptions = [
  { value: "off", label: "Off" },
  { value: "latency", label: "Latency" },
  { value: "error", label: "Error" },
  { value: "latency_and_error", label: "Latency + Error" },
  { value: "network_outage", label: "Network Outage" },
];

function formatPanelError(err) {
  const detail = err?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (detail?.msg) return detail.msg;
  return "Demo controls are unavailable right now.";
}

function stateToForm(state) {
  return {
    mode: state?.mode || "off",
    latencySeconds: String(state?.latency_seconds ?? 8),
    targetStoreId: state?.target_store_id || DEFAULT_TARGET_STORE_ID,
  };
}

export default function DemoObservabilityPanel() {
  const [currentState, setCurrentState] = useState(null);
  const [form, setForm] = useState(() => stateToForm(null));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadState = async () => {
    setLoading(true);
    setError("");
    try {
      const state = await getDemoObservabilityState();
      setCurrentState(state);
      setForm(stateToForm(state));
    } catch (err) {
      setError(formatPanelError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadState();
  }, []);

  const applyState = async () => {
    const latencySeconds = Math.min(60, Math.max(0, Number(form.latencySeconds) || 0));
    const mode = form.mode;
    const payload =
      mode === "off"
        ? { enabled: false, mode: "off" }
        : {
            enabled: true,
            mode,
            latency_seconds: latencySeconds,
            target_store_id: form.targetStoreId.trim() || DEFAULT_TARGET_STORE_ID,
          };

    setSaving(true);
    setError("");
    setNotice("");
    try {
      const state = await updateDemoObservabilityState(payload);
      setCurrentState(state);
      setForm(stateToForm(state));
      setNotice(`Demo harness set to ${state.mode}.`);
      trackAction("demo_observability_apply", {
        mode: state.mode,
        latency_seconds: state.latency_seconds,
        target_store_id: state.target_store_id,
        incident_id: state.incident_id,
        correlation_key: state.correlation_key,
        network_device: state.network_device,
        network_site: state.network_site,
        outage_scope: state.outage_scope,
      });
    } catch (err) {
      setError(formatPanelError(err));
    } finally {
      setSaving(false);
    }
  };

  const resetState = async () => {
    setResetting(true);
    setError("");
    setNotice("");
    try {
      const state = await resetDemoObservabilityState();
      setCurrentState(state);
      setForm(stateToForm(state));
      setNotice("Demo harness reset.");
      trackAction("demo_observability_reset", {
        mode: state.mode,
        latency_seconds: state.latency_seconds,
        target_store_id: state.target_store_id,
        incident_id: state.incident_id,
        correlation_key: state.correlation_key,
      });
    } catch (err) {
      setError(formatPanelError(err));
    } finally {
      setResetting(false);
    }
  };

  const updateForm = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  return (
    <VStack align="stretch" gap={5} className="demo-observability-panel">
      <Box>
        <Text className="section-kicker">Operator demo</Text>
        <Text as="h2" className="demo-panel-title">
          Backend fault controls
        </Text>
        <Text className="muted-text">
          Toggle the chat-path Datadog harness for latency, backend errors, and network outage demos.
        </Text>
      </Box>

      <SimpleGrid columns={{ base: 1, md: 2 }} gap={3} className="demo-state-grid">
        <Box className="demo-state-tile">
          <Text className="muted-mini">Current mode</Text>
          <Text className={`demo-state-value ${currentState?.enabled ? "active" : ""}`}>
            {loading ? "Loading" : currentState?.mode || "off"}
          </Text>
        </Box>
        <Box className="demo-state-tile">
          <Text className="muted-mini">Incident</Text>
          <Text className="demo-state-value">{currentState?.incident_id || "Not loaded"}</Text>
        </Box>
      </SimpleGrid>

      <Box>
        <Text className="demo-field-label">Mode</Text>
        <HStack gap={2} flexWrap="wrap" className="demo-mode-group">
          {modeOptions.map((option) => (
            <Button
              key={option.value}
              type="button"
              size="sm"
              className={form.mode === option.value ? "demo-mode-option selected" : "demo-mode-option"}
              aria-pressed={form.mode === option.value}
              onClick={() => updateForm("mode", option.value)}
              disabled={loading || saving || resetting}
            >
              {option.label}
            </Button>
          ))}
        </HStack>
      </Box>

      <SimpleGrid columns={{ base: 1, md: 2 }} gap={3}>
        <Box>
          <Text className="demo-field-label">Latency seconds</Text>
          <Input
            type="number"
            min={0}
            max={60}
            step={0.25}
            value={form.latencySeconds}
            onChange={(event) => updateForm("latencySeconds", event.target.value)}
            disabled={loading || saving || resetting || form.mode === "off" || form.mode === "error" || form.mode === "network_outage"}
          />
        </Box>
        <Box>
          <Text className="demo-field-label">Target store id</Text>
          <Input
            value={form.targetStoreId}
            onChange={(event) => updateForm("targetStoreId", event.target.value)}
            placeholder={DEFAULT_TARGET_STORE_ID}
            disabled={loading || saving || resetting || form.mode === "off"}
          />
        </Box>
      </SimpleGrid>

      <Box className="demo-readout">
        <Text className="muted-mini">Correlation key</Text>
        <Text>{currentState?.correlation_key || "Not loaded"}</Text>
      </Box>

      {error ? <Text className="error-copy">{error}</Text> : null}
      {notice ? <Text className="success-copy">{notice}</Text> : null}

      <HStack gap={2} flexWrap="wrap">
        <Button className="primary-button" onClick={applyState} loading={saving} disabled={loading || resetting}>
          <FiZap />
          Apply
        </Button>
        <Button className="secondary-button" onClick={resetState} loading={resetting} disabled={loading || saving}>
          <FiRefreshCw />
          Reset
        </Button>
      </HStack>
    </VStack>
  );
}
