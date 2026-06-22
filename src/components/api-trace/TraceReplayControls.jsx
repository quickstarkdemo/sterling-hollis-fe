import { Badge, Box, Button, HStack, Text } from "@chakra-ui/react";
import { FiPause, FiPlay, FiRotateCcw, FiX } from "react-icons/fi";

import { formatTraceDuration } from "../../utils/apiTraceProjection";

const SPEEDS = [0.25, 0.5, 1];

export default function TraceReplayControls({ replay, disabled = false }) {
  if (!replay.active) {
    return (
      <Box className="trace-replay-bar idle">
        <HStack justify="space-between" gap={3}>
          <Box>
            <Text className="filter-label">Deterministic replay</Text>
            <Text className="trace-replay-copy">Replay this recorded snapshot slowly enough to follow span, event, and artifact changes.</Text>
          </Box>
          <Button type="button" size="xs" className="secondary-button" onClick={replay.start} disabled={disabled}>
            <FiPlay /> Replay trace
          </Button>
        </HStack>
      </Box>
    );
  }

  const status = replay.completed ? "complete" : replay.playing ? "replaying" : "paused";
  return (
    <Box className="trace-replay-bar active" aria-label="Trace replay controls">
      <HStack justify="space-between" gap={3} className="trace-replay-primary">
        <HStack gap={2}>
          <Badge className={`api-trace-state ${status}`}>{status}</Badge>
          <Text className="trace-replay-time">{formatTraceDuration(replay.cursorMs)} / {formatTraceDuration(replay.durationMs)}</Text>
        </HStack>
        <HStack gap={1}>
          <Button type="button" size="xs" variant="ghost" className="trace-icon-button" onClick={replay.restart} aria-label="Restart replay"><FiRotateCcw /></Button>
          <Button type="button" size="xs" className="secondary-button" onClick={replay.playing ? replay.pause : replay.resume}>
            {replay.playing ? <FiPause /> : <FiPlay />} {replay.playing ? "Pause" : replay.completed ? "Replay" : "Resume"}
          </Button>
          <Button type="button" size="xs" variant="ghost" className="trace-icon-button" onClick={replay.stop} aria-label="Return to live trace"><FiX /></Button>
        </HStack>
      </HStack>
      <Box className="trace-replay-step" aria-live="polite">
        <Text className="filter-label">Now showing</Text>
        <Text>{replay.activeItem?.label || "Trace start"}</Text>
        <Text className="trace-replay-copy">{replay.activeItem ? `${replay.activeItem.kind} - ${replay.activeItem.status || "recorded"}` : "Replay will reveal the recorded operation sequence."}</Text>
      </Box>
      <HStack gap={3} className="trace-replay-scrubber">
        <input
          type="range"
          min="0"
          max={replay.durationMs}
          step={Math.max(1, Math.round(replay.durationMs / 1000))}
          value={replay.cursorMs}
          aria-label="Replay position"
          onChange={(event) => replay.seek(event.target.value)}
        />
        <HStack gap={1} role="group" aria-label="Replay speed">
          {SPEEDS.map((speed) => (
            <button type="button" key={speed} className={replay.speed === speed ? "trace-speed active" : "trace-speed"} aria-pressed={replay.speed === speed} onClick={() => replay.setSpeed(speed)}>{speed}x</button>
          ))}
        </HStack>
      </HStack>
    </Box>
  );
}
