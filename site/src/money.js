// Деньги без ошибок округления: юани хранятся в фэнях (1/100 ¥), рубли в копейках,
// курс — в миллионных долях BYN за 1 ¥. Вся арифметика целочисленная (BigInt там, где умножение).

export const RATE_SCALE = 1_000_000n;

export const ROUNDING_STEPS = [
  { kop: 1, label: 'до копейки (0,01)' },
  { kop: 5, label: 'до 5 копеек (0,05)' },
  { kop: 10, label: 'до 10 копеек (0,10)' },
  { kop: 100, label: 'до рубля (1,00)' },
];
export const ROUNDING_MODES = [
  { id: 'math', label: 'по правилам (≥ половины вверх)' },
  { id: 'up', label: 'всегда вверх' },
  { id: 'down', label: 'всегда вниз' },
];
export const DEFAULT_ROUNDING = { stepKop: 1, mode: 'math' };

// Строку вида «12,5», «12.50», «1 234,5» превращает в целое число сотых (фэни или копейки).
// Пустая строка → null. Неверный ввод → NaN.
export function parseCents(input) {
  const s = String(input ?? '').trim().replace(/\s| /g, '').replace(',', '.');
  if (s === '') return null;
  const m = /^(\d+)(?:\.(\d{0,2}))?$/.exec(s);
  if (!m) return NaN;
  return Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0'));
}

// Курс «0,4512» → 451200 (миллионные доли). До 6 знаков после запятой.
export function parseRate(input) {
  const s = String(input ?? '').trim().replace(/\s| /g, '').replace(',', '.');
  if (s === '') return null;
  const m = /^(\d+)(?:\.(\d{0,6}))?$/.exec(s);
  if (!m) return NaN;
  const v = Number(m[1]) * 1_000_000 + Number((m[2] || '').padEnd(6, '0'));
  return v > 0 ? v : NaN;
}

export function formatRate(rateMicro) {
  if (rateMicro == null) return '';
  const int = Math.floor(rateMicro / 1_000_000);
  const frac = String(rateMicro % 1_000_000).padStart(6, '0').replace(/0+$/, '');
  return frac ? `${int},${frac.padEnd(2, '0')}` : `${int},00`;
}

// 123456 → «1 234,56»
export function formatCents(cents) {
  if (cents == null || Number.isNaN(cents)) return '—';
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const int = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const frac = String(abs % 100).padStart(2, '0');
  return `${neg ? '−' : ''}${int},${frac}`;
}
export const fmtCny = (fen) => (fen == null ? '—' : `${formatCents(fen)} ¥`);
export const fmtByn = (kop) => (kop == null ? '—' : `${formatCents(kop)} BYN`);

// Для поля ввода: 1250 → «12,50»; null → ''.
export function centsToInput(cents) {
  return cents == null ? '' : formatCents(cents).replace(/ /g, '');
}

// Деление num/den целых (BigInt) с округлением до целого по режиму.
function divRound(num, den, mode) {
  const q = num / den;
  const r = num % den;
  if (r === 0n) return q;
  if (mode === 'up') return q + 1n;
  if (mode === 'down') return q;
  return r * 2n >= den ? q + 1n : q; // math: половина вверх (числа неотрицательные)
}

// Фэни × курс → копейки с шагом и режимом округления закупки.
export function cnyToByn(fen, rateMicro, rounding = DEFAULT_ROUNDING) {
  if (fen == null || rateMicro == null) return null;
  const step = BigInt(rounding?.stepKop || 1);
  const mode = rounding?.mode || 'math';
  // копейки = фэни × курс / 1e6; сразу округляем до шага: делим на (1e6 × шаг).
  const units = divRound(BigInt(fen) * BigInt(rateMicro), RATE_SCALE * step, mode);
  return Number(units * step);
}

// Расчёт по одному товару. Округляется СУММА строки (юани × количество × курс) по правилам закупки,
// цена за единицу в BYN = сумма / количество до копейки. Так 100 шт. по 1 ¥ при округлении «до рубля»
// дают 45 BYN, а не 0 (если бы округлялась цена за штуку).
export function itemMoney(item, purchase) {
  const qty = item.qty > 0 ? item.qty : 1;
  // Если известна оплаченная сумма (实付 из PDD), она главнее цены за штуку: скидки уже учтены.
  const totalFen = item.paidFen != null ? item.paidFen : item.unitFen == null ? null : item.unitFen * qty;
  const unitFen = item.paidFen != null ? Math.round(item.paidFen / qty) : (item.unitFen ?? null);
  const totalKop = cnyToByn(totalFen, purchase?.rateMicro ?? null, purchase?.rounding);
  const unitKop = averageKop(totalKop, qty);
  const zero = totalKop === 0 && totalFen > 0; // округлилось до нуля — надо предупредить
  return { qty, unitFen, totalFen, unitKop, totalKop, zero };
}

// Средняя цена = сумма / количество, до копейки по правилам математики.
export function averageKop(totalKop, qty) {
  if (totalKop == null || !qty) return null;
  return Number(divRound(BigInt(totalKop), BigInt(qty), 'math'));
}

// Проверка цены: вернёт текст предупреждения или ''.
export function priceWarning(unitFen) {
  if (unitFen == null) return '';
  if (Number.isNaN(unitFen)) return 'Цена записана неверно: только цифры и запятая, до 2 знаков.';
  if (unitFen === 0) return 'Цена 0 ¥ — проверьте.';
  if (unitFen > 1_000_000) return 'Цена больше 10 000 ¥ за штуку — проверьте.';
  return '';
}
