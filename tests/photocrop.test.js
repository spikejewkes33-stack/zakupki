// Поиск фото товара на снимке экрана заказа PDD (на нарисованных снимках 640×1391, как от «Команды»).
import test from 'node:test';
import assert from 'node:assert/strict';
import { findThumbBox } from '../site/src/photocrop.js';

const W = 640;
const H = 1391;

function screen({ page = [255, 255, 255] } = {}) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) data.set([...page, 255], i * 4);
  const rect = (x, y, w, h, c) => {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) data.set([...c, 255], (yy * W + xx) * 4);
  };
  // как на экране заказа: строка магазина (значок + плашка, заходит в зазор перед названием)
  rect(17, 352, 32, 30, [200, 210, 240]);
  rect(105, 356, 80, 21, [250, 200, 120]);
  // название справа от фото: две строки, вариант, зелёная плашка
  for (const y of [400, 430, 462]) for (let x = 150; x < 540; x += 22) rect(x, y, 16, 18, [40, 40, 40]);
  rect(146, 496, 120, 22, [40, 170, 60]);
  // подписи таблицы ниже: слева коротко, значение справа
  for (const y of [640, 670, 700]) { rect(17, y, 70, 16, [150, 150, 150]); rect(560, y, 60, 16, [60, 60, 60]); }
  return { data, rect };
}
const near = (a, b, tol = 12) => Math.abs(a - b) <= tol;

test('фото на цветном фоне: квадрат слева от названия', () => {
  const s = screen();
  s.rect(17, 394, 120, 120, [180, 90, 60]);
  const b = findThumbBox(s.data, W, H);
  assert.ok(b && near(b.x, 17, 2) && near(b.y, 394, 2) && near(b.w, 120, 2), JSON.stringify(b));
});

test('товар на белом фоне (сливается с карточкой): квадрат вокруг товара, без строки магазина', () => {
  const s = screen();
  s.rect(40, 405, 70, 40, [30, 160, 90]);
  s.rect(40, 470, 70, 35, [30, 160, 90]);
  const b = findThumbBox(s.data, W, H);
  assert.ok(b, 'не нашёл');
  assert.ok(near(b.y, 394), JSON.stringify(b));
  assert.ok(b.y > 382, 'захватил строку магазина');
  assert.equal(b.w, b.h);
});

test('экран затемнён всплывающим окном: фото всё равно находится', () => {
  const s = screen();
  s.rect(17, 394, 120, 120, [180, 90, 60]);
  for (let i = 0; i < s.data.length; i += 4) for (let c = 0; c < 3; c++) s.data[i + c] = Math.round(s.data[i + c] * 0.5);
  const b = findThumbBox(s.data, W, H);
  assert.ok(b && near(b.y, 394, 2), JSON.stringify(b));
});

test('нет фото и лента рекомендаций от края экрана — ничего не вырезаем', () => {
  const s = screen();
  s.rect(0, 1000, 310, 310, [90, 60, 40]);
  s.rect(330, 1000, 310, 310, [160, 120, 80]);
  assert.equal(findThumbBox(s.data, W, H), null);
});
