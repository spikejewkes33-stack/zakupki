// Фото товара со снимка экрана заказа PDD: маленькая квадратная картинка слева от названия.
// Ищем её по пикселям: в левой части экрана полоса строк, где почти всё «не фон», слева от неё — белое поле,
// высота примерно равна ширине (квадрат). Лента рекомендаций (картинки от самого края) и карта не подходят.

const isBg = (r, g, b) => Math.min(r, g, b) > 228 && Math.max(r, g, b) - Math.min(r, g, b) < 14;

// data — RGBA (Uint8ClampedArray), w×h. Возвращает { x, y, w, h } или null.
export function findThumbBox(data, w, h) {
  const px = (x, y) => {
    const i = (y * w + x) * 4;
    return isBg(data[i], data[i + 1], data[i + 2]) ? 0 : 1;
  };
  const x0 = Math.round(w * 0.035);
  const x1 = Math.round(w * 0.2);
  const m1 = Math.max(1, Math.round(w * 0.018));
  const frac = (y, a, b) => {
    let n = 0;
    for (let x = a; x < b; x++) n += px(x, y);
    return n / Math.max(1, b - a);
  };
  const rows = [];
  for (let y = 0; y < h; y++) rows.push(frac(y, x0, x1) > 0.6 && frac(y, 0, m1) < 0.3);

  const minH = w * 0.11;
  const maxH = w * 0.27;
  for (let y = Math.round(h * 0.08); y < h; y++) {
    if (!rows[y]) continue;
    let end = y;
    let gap = 0;
    while (end + 1 < h && (rows[end + 1] || (gap < 2 && rows[Math.min(h - 1, end + 2)]))) {
      gap = rows[end + 1] ? 0 : gap + 1;
      end += 1;
    }
    const height = end - y + 1;
    if (height >= minH && height <= maxH) {
      // ширина: колонки, где в этой полосе больше половины «не фон», начиная от левого края картинки
      const colFrac = (x) => {
        let n = 0;
        for (let yy = y; yy <= end; yy++) n += px(x, yy);
        return n / height;
      };
      let left = x0;
      while (left > 0 && colFrac(left - 1) > 0.5) left -= 1;
      let right = x0;
      while (right + 1 < w && colFrac(right + 1) > 0.5) right += 1;
      const width = right - left + 1;
      const ratio = width / height;
      if (ratio > 0.75 && ratio < 1.33) return { x: left, y, w: width, h: height };
    }
    y = end;
  }
  return null;
}

// В браузере: снимок (Base64 JPEG/PNG) → вырезанное фото товара (JPEG Blob) или null.
export async function cropThumbFromBase64(b64) {
  const clean = String(b64 || '').replace(/[^A-Za-z0-9+/=]/g, '');
  if (clean.length < 100) return null;
  const type = clean.startsWith('iVBOR') ? 'image/png' : 'image/jpeg';
  const img = new Image();
  const loaded = await new Promise((res) => {
    img.onload = () => res(true);
    img.onerror = () => res(false);
    img.src = `data:${type};base64,${clean}`;
  });
  if (!loaded || !img.naturalWidth) return null;
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const box = findThumbBox(g.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
  if (!box) return null;
  const out = document.createElement('canvas');
  const side = Math.min(400, Math.max(box.w, box.h));
  out.width = side;
  out.height = side;
  out.getContext('2d').drawImage(c, box.x, box.y, box.w, box.h, 0, 0, side, side);
  return new Promise((res) => out.toBlob(res, 'image/jpeg', 0.85));
}
