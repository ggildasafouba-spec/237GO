/**
 * Horaires d'ouverture des boutiques / restaurants (heure du Cameroun, Africa/Douala).
 *
 * Format enregistré (saisi dans l'onglet « Horaires » de l'app marchand) :
 *   { monday: { open: '08:00', close: '20:00', closed: false }, ..., sunday: {...} }
 *
 * Règles :
 *  - aucun horaire enregistré → pas de restriction (seul l'interrupteur Ouvert/Fermé compte) ;
 *  - close <= open → ouverture de nuit qui déborde sur le lendemain (ex. 18:00 → 02:00) ;
 *  - open == close → ouvert 24 h/24 ce jour-là.
 */

export const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
export type Day = (typeof DAYS)[number];
export interface DayHours { open: string; close: string; closed: boolean }
export type OpeningHours = Record<Day, DayHours>;

const DAY_LABELS: Record<Day, string> = {
  monday: 'lundi', tuesday: 'mardi', wednesday: 'mercredi', thursday: 'jeudi',
  friday: 'vendredi', saturday: 'samedi', sunday: 'dimanche',
};
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const TZ = 'Africa/Douala';

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** Valide et normalise les horaires envoyés par l'app. Lève une Error lisible si invalides. */
export function validateOpeningHours(input: unknown): OpeningHours {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Horaires invalides');
  }
  const src = input as Record<string, any>;
  const out = {} as OpeningHours;
  for (const day of DAYS) {
    const d = src[day];
    if (!d || typeof d !== 'object') throw new Error(`Horaires manquants pour ${DAY_LABELS[day]}`);
    const closed = d.closed === true;
    const open = String(d.open ?? '').trim();
    const close = String(d.close ?? '').trim();
    if (!closed && (!TIME_RE.test(open) || !TIME_RE.test(close))) {
      throw new Error(`Heure invalide pour ${DAY_LABELS[day]} (format HH:MM, ex. 08:00)`);
    }
    out[day] = {
      open: TIME_RE.test(open) ? open : '08:00',
      close: TIME_RE.test(close) ? close : '20:00',
      closed,
    };
  }
  return out;
}

/** Lecture tolérante de ce qui est en base (null si absent ou illisible). */
function readHours(raw: unknown): OpeningHours | null {
  try {
    return raw ? validateOpeningHours(raw) : null;
  } catch {
    return null;
  }
}

/** Jour (index 0 = lundi) et minute de la journée à Douala. */
function doualaNow(now: Date): { dayIndex: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, weekday: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
  const dayIndex = DAYS.indexOf(get('weekday').toLowerCase() as Day);
  return { dayIndex: dayIndex < 0 ? 0 : dayIndex, minute: Number(get('hour')) * 60 + Number(get('minute')) };
}

export interface OpenState {
  /** Vrai si on peut commander maintenant (interrupteur ET horaires). */
  openNow: boolean;
  /** Fermé uniquement à cause des horaires (l'interrupteur est sur Ouvert). */
  closedByHours: boolean;
  /** Prochaine ouverture lisible, ex. « à 08:00 », « demain à 08:00 », « lundi à 09:00 ». */
  nextOpening: string | null;
}

/** Ouvert selon les horaires seuls ? */
function withinHours(hours: OpeningHours, dayIndex: number, minute: number): boolean {
  const today = hours[DAYS[dayIndex]];
  if (!today.closed) {
    const o = toMinutes(today.open);
    const c = toMinutes(today.close);
    if (o === c) return true; // 24 h/24
    if (c > o ? minute >= o && minute < c : minute >= o) return true;
  }
  // Débordement de la veille (ex. veille 18:00 → 02:00, il est 01:00)
  const yesterday = hours[DAYS[(dayIndex + 6) % 7]];
  if (!yesterday.closed) {
    const o = toMinutes(yesterday.open);
    const c = toMinutes(yesterday.close);
    if (c < o && minute < c) return true;
  }
  return false;
}

function nextOpeningLabel(hours: OpeningHours, dayIndex: number, minute: number): string | null {
  for (let offset = 0; offset < 7; offset++) {
    const idx = (dayIndex + offset) % 7;
    const d = hours[DAYS[idx]];
    if (d.closed) continue;
    if (offset === 0 && toMinutes(d.open) <= minute) continue;
    if (offset === 0) return `à ${d.open}`;
    if (offset === 1) return `demain à ${d.open}`;
    return `${DAY_LABELS[DAYS[idx]]} à ${d.open}`;
  }
  return null; // fermé tous les jours
}

/** État d'ouverture d'une boutique à l'instant `now`. */
export function shopOpenState(
  shop: { isOpen: boolean; openingHours?: unknown },
  now: Date = new Date()
): OpenState {
  const hours = readHours(shop.openingHours);
  if (!shop.isOpen) return { openNow: false, closedByHours: false, nextOpening: null };
  if (!hours) return { openNow: true, closedByHours: false, nextOpening: null };
  const { dayIndex, minute } = doualaNow(now);
  if (withinHours(hours, dayIndex, minute)) return { openNow: true, closedByHours: false, nextOpening: null };
  return { openNow: false, closedByHours: true, nextOpening: nextOpeningLabel(hours, dayIndex, minute) };
}

/** Ajoute openNow / closedByHours / nextOpening à un objet boutique. */
export function withOpenState<T extends { isOpen: boolean; openingHours?: unknown }>(shop: T, now?: Date): T & OpenState {
  return { ...shop, ...shopOpenState(shop, now) };
}
