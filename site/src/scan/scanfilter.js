// Перенесено из «Посылок» (parcel-scanner b86f1a2) без изменений, кроме путей и ключей настроек.
// Решает, когда считанный код превращается в событие для экрана.
// - Один и тот же код (или трек) не срабатывает повторно, пока он в кадре.
// - Красный экран только для похожих на трек кодов, которые продержались в кадре
//   unknownDelayMs и ни разу не попались в одном кадре с кодом из списка
//   (на одной наклейке бывает несколько кодов: трек, номер заказа и т. п.).
import { isTrackLikeCode } from './match.js';
import { normalizeTrack } from './track.js';

export class ScanFilter {
  constructor({ holdMs = 1500, unknownDelayMs = 700 } = {}) {
    this.holdMs = holdMs;
    this.unknownDelayMs = unknownDelayMs;
    this.seen = new Map(); // ключ → { first, last, fired }
  }

  /**
   * @param {string[]} codes тексты штрихкодов в кадре
   * @param {number} now время в мс
   * @param {(code: string) => string | null} lookup трек из списка для кода или null
   * @param {(code: string) => number} [score] насколько код похож на треки списка (из нескольких
   *   чужих кодов одной наклейки красным показывается самый похожий)
   * @returns {Array<{type: 'match', code: string, track: string} | {type: 'unknown', code: string}>}
   */
  feed(codes, now, lookup, score = () => 0) {
    for (const [key, entry] of this.seen) {
      if (now - entry.last > this.holdMs) this.seen.delete(key);
    }

    const frame = new Map(); // ключ → { code, track, entry }
    for (const raw of codes) {
      const code = normalizeTrack(raw);
      if (!code) continue;
      const track = lookup(code);
      const key = track ? `T:${track}` : `C:${code}`;
      if (frame.has(key)) continue;
      let entry = this.seen.get(key);
      if (!entry) {
        entry = { first: now, last: now, fired: false, red: false };
        this.seen.set(key, entry);
      }
      entry.last = now;
      frame.set(key, { code, track, entry });
    }
    const items = [...frame.values()];
    // В кадре код из списка или уже показанный красный: остальные коды — с той же наклейки.
    const sameLabel = items.some((f) => f.track || f.entry.red);

    const events = [];
    for (const f of items) {
      if (f.track && !f.entry.fired) {
        f.entry.fired = true;
        events.push({ type: 'match', code: f.code, track: f.track });
      }
    }

    const pending = items.filter((f) => !f.track && !f.entry.fired);
    for (const f of pending) {
      // Служебный код наклейки (QR с адресом и т. п.) или второй код той же наклейки: молчим.
      if (!isTrackLikeCode(f.code) || sameLabel) f.entry.fired = true;
    }
    const ready = pending.filter((f) => !f.entry.fired && now - f.entry.first >= this.unknownDelayMs);
    if (ready.length) {
      const best = ready.reduce((a, b) => (score(b.code) > score(a.code) ? b : a));
      for (const f of pending) f.entry.fired = true; // одна наклейка — один красный
      best.entry.red = true;
      events.push({ type: 'unknown', code: best.code });
    }
    return events;
  }
}
