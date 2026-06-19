import { Button, HStack } from "@chakra-ui/react";
import { FiMic, FiZap } from "react-icons/fi";

export default function FieldVoiceControl({
  label,
  targetPath,
  active = false,
  disabled = false,
  aiBusy = false,
  onVoiceRequest,
  onAiRequest,
  showVoice = true,
  showAi = true,
}) {
  return (
    <HStack gap={1} flexWrap="wrap" className="field-ai-actions">
      {showVoice ? <Button
        type="button"
        size="xs"
        variant="ghost"
        aria-label={`Use voice for ${label}`}
        aria-pressed={active}
        disabled={disabled}
        onClick={() => onVoiceRequest?.({ targetPath, label })}
      >
        <FiMic /> {active ? "Voice selected" : "Voice"}
      </Button> : null}
      {showAi ? <Button
        type="button"
        size="xs"
        variant="ghost"
        aria-label={`Improve ${label} with AI`}
        disabled={disabled || aiBusy}
        onClick={() => onAiRequest?.({
          targetPath,
          label,
          instruction: `Improve the ${label.toLowerCase()} for shoppers while preserving verified product facts.`,
        })}
      >
        <FiZap /> {aiBusy ? "Proposing…" : "Improve"}
      </Button> : null}
    </HStack>
  );
}
