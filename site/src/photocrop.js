// Фото товара со снимка экрана заказа PDD: квадратная картинка слева от названия
// (на экране заказа примерно от 2,7% до 21,4% ширины, справа от неё с 23% ширины начинается название).
//
// Фон строки берём с левого края экрана (первые ~2% ширины): так поиск не зависит от затемнения
// под всплывающим окном и от тёмной темы. «Чернила» — пиксель, заметно отличный от фона своей строки.
// Две попытки:
//  1) плотная картинка: полоса строк, где почти вся левая колонка — «чернила», и она примерно квадратная;
//  2) товар на белом фоне (сливается с карточкой): в левой колонке что-то нарисовано, в узком зазоре
//     перед названием пусто, справа рядом идёт текст названия, и есть кусок выше строки текста.
//     Тогда вырезаем квадрат обычного размера вокруг найденного.
// Лента рекомендаций (картинки от самого края экрана) отсекается: у её строк край экрана не однотонный.

// data — RGBA (Uint8ClampedArray), w×h. Возвращает { x, y, w, h } или null.
export function findThumbBox(data, w, h) {
  const m1 = Math.max(2, Math.round(w * 0.018));
  const bg = new Array(h).fill(null);
  for (let y = 0; y < h; y++) {
    const lo = [255, 255, 255];
    const hi = [0, 0, 0];
    for (let x = 0; x < m1; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        lo[c] = Math.min(lo[c], data[i + c]);
        hi[c] = Math.max(hi[c], data[i + c]);
      }
    }
    if (hi[0] - lo[0] < 16 && hi[1] - lo[1] < 16 && hi[2] - lo[2] < 16) bg[y] = [0, 1, 2].map((c) => (lo[c] + hi[c]) / 2);
  }
  const ink = (x, y) => {
    const b = bg[y];
    if (!b) return 1;
    const i = (y * w + x) * 4;
    return Math.max(Math.abs(data[i] - b[0]), Math.abs(data[i + 1] - b[1]), Math.abs(data[i + 2] - b[2])) > 22 ? 1 : 0;
  };
  const frac = (y, a, b) => {
    let n = 0;
    for (let x = a; x < b; x++) n += ink(x, y);
    return n / Math.max(1, b - a);
  };
  return denseThumb(w, h, bg, ink, frac) || sparseThumb(w, h, bg, ink, frac);
}

function denseThumb(w, h, bg, ink, frac) {
  const x0 = Math.round(w * 0.035);
  const x1 = Math.round(w * 0.2);
  const rows = [];
  for (let y = 0; y < h; y++) rows.push(!!bg[y] && frac(y, x0, x1) > 0.6);
  const minH = w * 0.11;
  const maxH = w * 0.27;
  for (let y = Math.round(h * 0.06); y < h; y++) {
    if (!rows[y]) continue;
    let end = y;
    let gap = 0;
    while (end + 1 < h && (rows[end + 1] || (gap < 2 && rows[Math.min(h - 1, end + 2)]))) {
      gap = rows[end + 1] ? 0 : gap + 1;
      end += 1;
    }
    const height = end - y + 1;
    if (height >= minH && height <= maxH) {
      const colFrac = (x) => {
        let n = 0;
        for (let yy = y; yy <= end; yy++) n += ink(x, yy);
        return n / height;
      };
      let left = x0;
      while (left > 0 && colFrac(left - 1) > 0.5) left -= 1;
      let right = x0;
      while (right + 1 < w && colFrac(right + 1) > 0.5) right += 1;
      const width = right - left + 1;
      const ratio = width / height;
      if (ratio > 0.75 && ratio < 1.33 && besideTitle(w, y, end, right, frac)) {
        // часть фото спряталась под шапкой экрана — берём квадрат из середины видимой части
        const side = Math.min(width, height);
        return { x: left + Math.floor((width - side) / 2), y: y + Math.floor((height - side) / 2), w: side, h: side };
      }
    }
    y = end;
  }
  return null;
}

// Справа от фото товара — узкий пустой зазор, а за ним текст названия (у картинок ленты рекомендаций этого нет).
function besideTitle(w, top, bottom, right, frac) {
  const g0 = right + 3;
  const g1 = g0 + Math.max(3, Math.round(w * 0.008));
  const t0 = right + Math.round(w * 0.02);
  const t1 = right + Math.round(w * 0.19);
  let clean = 0;
  let text = 0;
  for (let y = top; y <= bottom; y++) {
    if (frac(y, g0, g1) < 0.1) clean += 1;
    if (frac(y, t0, t1) > 0.03) text += 1;
  }
  const n = bottom - top + 1;
  return clean >= n * 0.7 && text >= n * 0.2;
}

function sparseThumb(w, h, bg, ink, frac) {
  const L0 = Math.round(w * 0.025);
  const L1 = Math.round(w * 0.212);
  const G0 = Math.round(w * 0.216);
  const G1 = Math.round(w * 0.226);
  const T0 = Math.round(w * 0.235);
  const T1 = Math.round(w * 0.4);
  const side = Math.round(w * 0.187);
  // строки, где слева что-то нарисовано, а в зазоре перед названием пусто
  const cand = [];
  for (let y = 0; y < h; y++) cand.push(!!bg[y] && frac(y, L0, L1) > 0.02 && frac(y, G0, G1) < 0.1);
  const segs = [];
  for (let y = Math.round(h * 0.06); y < h; y++) {
    if (!cand[y]) continue;
    let end = y;
    while (end + 1 < h && (cand[end + 1] || (end + 3 < h && (cand[end + 2] || cand[end + 3])))) end += 1;
    segs.push([y, end]);
    y = end;
  }
  for (let i = 0; i < segs.length; i++) {
    let j = i;
    while (j + 1 < segs.length && segs[j + 1][0] - segs[j][1] <= w * 0.06 && segs[j + 1][1] - segs[i][0] <= w * 0.215) j += 1;
    const top = segs[i][0];
    const bottom = segs[j][1];
    const span = bottom - top + 1;
    const tallest = Math.max(...segs.slice(i, j + 1).map(([a, b]) => b - a + 1));
    if (span < w * 0.06 || tallest < w * 0.055) continue;
    // справа рядом должен быть текст названия
    // окно размером с фото: больше всего нарисованного и целиком самый большой кусок (а не значок магазина над ним)
    const big = segs.slice(i, j + 1).reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a));
    // крошки высотой в пару строк (край строки магазина над фото) не считаем
    const solid = segs.slice(i, j + 1).filter(([a, b]) => b - a + 1 >= w * 0.015);
    const rowInk = (y) => (cand[y] && solid.some(([a, b]) => y >= a && y <= b) ? frac(y, L0, L1) : 0);
    const lo = Math.max(0, big[1] - side + 1);
    const hi = Math.max(lo, Math.min(big[0], h - side));
    // внутри фото не бывает строк, где текст заходит в зазор перед названием (строка магазина, адрес)
    const blocked = (y) => !bg[y] || frac(y, G0, G1) >= 0.1;
    const fits = (y0) => {
      for (let y = y0; y < y0 + side; y++) if (blocked(y)) return false;
      return true;
    };
    const anyFits = (() => { for (let y0 = lo; y0 <= hi; y0++) if (fits(y0)) return true; return false; })();
    const score = [];
    for (let y0 = lo; y0 <= hi; y0++) {
      let n = 0;
      for (let y = y0; y < y0 + side; y++) n += rowInk(y);
      score.push(anyFits && !fits(y0) ? -1 : n);
    }
    const best = Math.max(...score);
    const ties = score.map((v, k) => (v >= best * 0.98 ? lo + k : -1)).filter((k) => k >= 0);
    const cy = ties[Math.floor(ties.length / 2)] + Math.round(side / 2);
    const wy0 = Math.max(0, cy - Math.round(side / 2));
    const wy1 = Math.min(h - 1, wy0 + side);
    let textRows = 0;
    for (let y = wy0; y <= wy1; y++) if (bg[y] && frac(y, T0, T1) > 0.03) textRows += 1;
    if (textRows < (wy1 - wy0 + 1) * 0.2) continue;
    // где по горизонтали нарисовано
    let left = L1;
    let right = L0;
    for (let y = Math.max(0, cy - Math.round(side / 2)); y < Math.min(h, cy + Math.round(side / 2)); y++) {
      if (!cand[y]) continue;
      for (let x = L0; x < L1; x++) if (ink(x, y)) { left = Math.min(left, x); right = Math.max(right, x); }
    }
    const s = Math.max(side, right - left + 1);
    const x = Math.max(0, Math.min(Math.round(w * 0.027), left, w - s));
    const y = Math.max(0, Math.min(h - s, cy - Math.round(s / 2)));
    return { x, y, w: s, h: s };
  }
  return null;
}

// Снимок из «Команды» (Base64) как адрес картинки для <img>.
export function snapshotUrl(b64) {
  const clean = String(b64 || '').replace(/[^A-Za-z0-9+/=]/g, '');
  if (clean.length < 100) return '';
  return `data:${clean.startsWith('iVBOR') ? 'image/png' : 'image/jpeg'};base64,${clean}`;
}

async function snapshotCanvas(b64) {
  const src = snapshotUrl(b64);
  if (!src) return null;
  const img = new Image();
  const loaded = await new Promise((res) => {
    img.onload = () => res(true);
    img.onerror = () => res(false);
    img.src = src;
  });
  if (!loaded || !img.naturalWidth) return null;
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0);
  return c;
}

function cropBox(c, box) {
  const out = document.createElement('canvas');
  const side = Math.min(400, Math.max(box.w, box.h));
  out.width = side;
  out.height = side;
  out.getContext('2d').drawImage(c, box.x, box.y, box.w, box.h, 0, 0, side, side);
  return new Promise((res) => out.toBlob(res, 'image/jpeg', 0.85));
}

// В браузере: снимок (Base64 JPEG/PNG) → вырезанное фото товара (JPEG Blob) или null.
export async function cropThumbFromBase64(b64) {
  const c = await snapshotCanvas(b64);
  if (!c) return null;
  const box = findThumbBox(c.getContext('2d').getImageData(0, 0, c.width, c.height).data, c.width, c.height);
  return box ? cropBox(c, box) : null;
}

// Квадрат вокруг точки, куда нажали на снимке (fx, fy — доли ширины и высоты).
// Размер — как фото товара на экране заказа PDD (около 19% ширины экрана).
export function squareAt(w, h, fx, fy, frac = 0.19) {
  const side = Math.max(8, Math.min(w, h, Math.round(w * frac)));
  const clamp = (v, max) => Math.max(0, Math.min(max - side, v));
  return { x: clamp(Math.round(fx * w - side / 2), w), y: clamp(Math.round(fy * h - side / 2), h), w: side, h: side };
}

export async function cropAtFromBase64(b64, fx, fy) {
  const c = await snapshotCanvas(b64);
  return c ? cropBox(c, squareAt(c.width, c.height, fx, fy)) : null;
}
