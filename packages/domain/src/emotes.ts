export type EmoteEntry = { label: string; token: string; safe: boolean };

// Tokens confirmed against real ADM logs (2026-07). `safe=false` = gameplay penalty
// or too common in natural play (false-match risk). ⚠️ labels pending calibration are
// omitted until their token is confirmed empirically.
export const EMOTE_DICTIONARY: EmoteEntry[] = [
  { label: "salute", token: "EmoteSalute", safe: true },
  { label: "surrender", token: "EmoteSurrender", safe: true },
  { label: "greeting", token: "EmoteGreeting", safe: true },
  { label: "clap", token: "EmoteClap", safe: true },
  { label: "heart", token: "EmoteHeart", safe: true },
  { label: "point", token: "EmotePoint", safe: true },
  { label: "point at self", token: "EmotePointSelf", safe: true },
  { label: "thumbs up", token: "EmoteThumb", safe: true },
  { label: "thumbs down", token: "EmoteThumbDown", safe: true },
  { label: "nod head", token: "EmoteNod", safe: true },
  { label: "shake head", token: "EmoteShake", safe: true },
  { label: "dance", token: "EmoteDance", safe: true },
  { label: "facepalm", token: "EmoteFacepalm", safe: true },
  { label: "shrug", token: "EmoteShrug", safe: true },
  { label: "timeout", token: "EmoteTimeout", safe: true },
  { label: "look at me", token: "EmoteLookAtMe", safe: true },
  { label: "listen", token: "EmoteListening", safe: true },
  { label: "come", token: "EmoteCome", safe: true },
  { label: "move", token: "EmoteMove", safe: true },
  { label: "silent", token: "EmoteSilent", safe: true },
  { label: "watching", token: "EmoteWatching", safe: true },
  { label: "cut throat", token: "EmoteThroat", safe: true },
  { label: "RPS", token: "EmoteRPSRandom", safe: true },
  { label: "taunt elbow", token: "EmoteTauntElbow", safe: true },
  // Unsafe / excluded:
  { label: "suicide", token: "EmoteSuicide", safe: false },
  { label: "vomit", token: "EmoteVomit", safe: false },
  { label: "sit", token: "EmoteSitA", safe: false },
];

const byLabel = new Map(EMOTE_DICTIONARY.map((e) => [e.label.toLowerCase(), e]));

export function emoteToken(label: string): string | undefined {
  return byLabel.get(label.toLowerCase())?.token;
}

export function safeVerificationEmotes(): EmoteEntry[] {
  return EMOTE_DICTIONARY.filter((e) => e.safe);
}

const byToken = new Map(EMOTE_DICTIONARY.map((e) => [e.token, e]));

export function tokenToLabel(token: string): string | undefined {
  return byToken.get(token)?.label;
}
