import { Badge, Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { FiAlertCircle, FiCheckCircle, FiRefreshCw } from "react-icons/fi";

function IssueList({ title, issues, blocking = false }) {
  return (
    <Box className={blocking ? "catalog-conflict-alert" : "catalog-editor-guidance"}>
      <HStack gap={2}><Text className="panel-title">{title}</Text><Badge className={blocking ? "workflow-status failed" : "soft-badge"}>{issues.length}</Badge></HStack>
      {issues.length ? (
        <VStack align="stretch" gap={2} mt={3}>
          {issues.map((issue) => (
            <HStack key={`${issue.code}:${issue.field_path}`} align="start" gap={2}>
              {blocking ? <FiAlertCircle aria-hidden /> : <FiCheckCircle aria-hidden />}
              <Box><Text>{issue.message}</Text><Text className="muted-text">{issue.field_path}</Text></Box>
            </HStack>
          ))}
        </VStack>
      ) : <Text className="muted-text" mt={2}>{blocking ? "No publication blockers." : "No additional recommendations."}</Text>}
    </Box>
  );
}

export default function ProductReadinessPanel({ readiness, loading = false, error = "", dirty = false, onRetry }) {
  return (
    <Box id="workbench-readiness" className="editor-section product-readiness-panel">
      <HStack justify="space-between" gap={3} align="start" flexWrap="wrap">
        <Box>
          <Text className="section-kicker">Publish readiness</Text>
          <Text className="panel-title">Deterministic publication checks</Text>
          <Text className="muted-text">Blocking issues prevent publish. Recommendations improve quality without becoming gates.</Text>
        </Box>
        {readiness ? <Badge className={`workflow-status ${readiness.ready ? "succeeded" : "failed"}`}>{readiness.ready ? "Ready" : "Blocked"}</Badge> : null}
      </HStack>
      {loading ? <Text className="muted-text" mt={4}>Checking the saved draft…</Text> : null}
      {error ? <HStack mt={4} justify="space-between"><Text className="error-copy">{error}</Text><Button type="button" size="sm" className="secondary-button" onClick={onRetry}><FiRefreshCw /> Retry</Button></HStack> : null}
      {dirty ? <Text className="catalog-action-hint" mt={4}>Save the current edits to refresh readiness and preview.</Text> : null}
      {readiness && !loading ? (
        <VStack align="stretch" gap={4} mt={5}>
          <IssueList title="Blocking issues" issues={readiness.blocking_errors || []} blocking />
          <IssueList title="Recommendations" issues={readiness.recommendations || []} />
        </VStack>
      ) : null}
    </Box>
  );
}
