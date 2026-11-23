export type AppView = 'hub' | 'matrix' | 'map' | 'game' | 'calibration';

export const APP_VIEW_LABELS: Record<AppView, string> = {
  hub: 'Conversational Hub',
  matrix: 'Threat Matrix',
  map: 'Tactical Map',
  game: 'Neural Defense',
  calibration: 'Calibration',
};

const NAV_INTENT_PATTERN =
  /^(?:hey\s+ultron|ok(?:ay)?\s+ultron|ultron)?\s*(?:please\s+)?(?:switch(?:\s+(?:the\s+)?(?:tab|view|screen|page|mode))?\s+to|navigate\s+to|go\s+to|open(?:\s+up)?|show(?:\s+me)?|take\s+me\s+to|move\s+to|change(?:\s+(?:the\s+)?(?:tab|view|screen))?\s+to|return\s+to|back\s+to)\s+(?:the\s+)?(.+)$/i;

const DIRECT_TAB_SUFFIX_PATTERN =
  /^(?:hey\s+ultron|ok(?:ay)?\s+ultron|ultron)?\s*(?:the\s+)?(.+?)\s+(?:tab|view|screen|page)$/i;

function matchTargetView(targetPhrase: string): AppView | null {
  const clean = targetPhrase.trim().toLowerCase();
  if (!clean) return null;

  if (
    /\b(?:tactical\s+map|maps?|geospatial|reconnaissance|recon)\b/i.test(clean)
  ) {
    return 'map';
  }
  if (
    /\b(?:threat\s+matrix|matrix|threat\s+analysis|threats?)\b/i.test(clean)
  ) {
    return 'matrix';
  }
  if (
    /\b(?:neural\s+defense|defense\s+game|defense|game|arcade)\b/i.test(clean)
  ) {
    return 'game';
  }
  if (
    /\b(?:calibration|calibrate|settings|preferences|profile|config(?:uration)?)\b/i.test(
      clean,
    )
  ) {
    return 'calibration';
  }
  if (
    /\b(?:conversational\s+hub|command\s+hub|hub|home|main\s+(?:hub|screen|view)|core\s+hub|chat)\b/i.test(
      clean,
    )
  ) {
    return 'hub';
  }

  return null;
}

/**
 * Parses spoken navigation directives such as:
 * - "Switch to Tactical Map"
 * - "Navigate to Threat Matrix"
 * - "Go to Calibration"
 * - "Open Neural Defense"
 * - "Switch to Conversational Hub"
 */
export function parseVoiceNavigationCommand(
  rawTranscript: string,
): AppView | null {
  const normalized = rawTranscript
    .toLowerCase()
    .replace(/[.,!?'"-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return null;

  const intentMatch = NAV_INTENT_PATTERN.exec(normalized);
  if (intentMatch?.[1]) {
    const matched = matchTargetView(intentMatch[1]);
    if (matched) return matched;
  }

  const suffixMatch = DIRECT_TAB_SUFFIX_PATTERN.exec(normalized);
  if (suffixMatch?.[1]) {
    const matched = matchTargetView(suffixMatch[1]);
    if (matched) return matched;
  }

  return null;
}
