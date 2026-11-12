export type CaptureRegion = { x: number; y: number; width: number; height: number };
export type DetectedGuild = { id: string; name: string; reviewed: boolean };
export const guildKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

/** Match OCR headings to existing names without renaming the stored guild. */
export function matchKnownGuild(text: string, names: readonly string[]): string | null {
  const compact = (name: string) => name.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const headings = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 2)
    .filter((line) => !/^(?:escondite|hideout|nivel|level|puntos|points|estado|status|protecci[oó]n|protection)(?:\s|:)/i.test(line));
  const matches = new Map<string, string>();
  for (const name of names) {
    const key = compact(name);
    if (!key) continue;
    if (headings.some((line) => {
      const heading = compact(line.replace(/^\[[^\]]{1,20}\]\s*/, '').replace(label, ''));
      return heading === key || key.length >= 4 && heading.endsWith(key) && heading.length - key.length <= 12;
    })) matches.set(guildKey(name), name);
  }
  return matches.size === 1 ? [...matches.values()][0] : null;
}

const label = /^(?:gremio|guild(?:\s+name)?|propietario|owner|owned\s+by|pertenece\s+a)(?=\s|[:：\-–]|$)\s*[:：\-–]?\s*/i;
const ignored = /^(?:alianza|alliance|escondite|hideout|nivel|level|propietario|owner|gremio|guild|territorio|territory|durabilidad|durability|comida|food|poder|power|protecci[oó]n|protection|atacar|attack|entrar|enter|acceso|access|construcci[oó]n|construction|mapa|map)(?:\s*[:：]|\s*$)/i;

function cleanName(value: string): string | null {
  const name = value.replace(/\s+/g, ' ').trim().replace(/^[:：|]+\s*/, '').trim();
  if (name.length < 2 || name.length > 64 || !/\p{L}/u.test(name) || ignored.test(name)) return null;
  // Preserve spelling, case, accents, and visually similar letters for review.
  return name;
}

export function extractGuildName(text: string, nameOnly = false): string | null {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const candidates = new Set<string>();
  for (let index = 0; index < lines.length; index++) {
    if (!label.test(lines[index])) continue;
    const remainder = lines[index].replace(label, '');
    const candidate = cleanName(remainder || lines[index + 1] || '');
    if (candidate) candidates.add(candidate);
  }
  // Multiple different owners in the same frame are ambiguous.
  if (candidates.size) return candidates.size === 1 ? [...candidates][0] : null;
  return nameOnly && lines.length === 1 ? cleanName(lines[0].replace(/^\[[^\]]{1,20}\]\s*/, '')) : null;
}

export function addDetection(list: DetectedGuild[], name: string): DetectedGuild[] {
  if (list.some((guild) => guildKey(guild.name) === guildKey(name))) return list;
  return [...list, { id: crypto.randomUUID(), name, reviewed: false }];
}

const DRAFT_KEY = 'guildtrace-screen-reader-draft-v1';
export function readCaptureDraft(): { map: string; guilds: DetectedGuild[] } {
  try {
    const draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? 'null');
    if (typeof draft?.map === 'string' && Array.isArray(draft.guilds)) {
      return {
        map: draft.map.slice(0, 150),
        guilds: draft.guilds.filter((guild: DetectedGuild) => typeof guild?.id === 'string' && typeof guild.name === 'string' && typeof guild.reviewed === 'boolean').slice(0, 200),
      };
    }
  } catch { /* Storage may be disabled. Reading can still work. */ }
  return { map: '', guilds: [] };
}

export function writeCaptureDraft(map: string, guilds: DetectedGuild[]) {
  try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ map, guilds })); } catch { /* Keep the in-memory draft. */ }
}
