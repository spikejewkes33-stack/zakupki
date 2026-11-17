// Разбор снимков PDD из «Команды». Тексты — настоящие распознанные скриншоты пользователя (17.11),
// адреса, телефоны, имена и номера заменены на выдуманные (репозиторий публичный).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { splitBlocks, parseTime, classify, parseOrder, buildPlan, BLOCK_MARK } from '../site/src/pddimport.js';
import { itemMoney } from '../site/src/money.js';
import { buildOpis } from '../site/src/opis.js';

const fx = (n) => readFileSync(new URL(`./fixtures/${n}.txt`, import.meta.url), 'utf8');
const lines = (t) => t.split('\n').map((l) => l.trim()).filter(Boolean);
const block = (time, text) => `${BLOCK_MARK}\n${time}\n${text}\n`;

const ORDER = '261115-100000000000001';
const purchase = {
  id: 'p1', rateMicro: 451200, rounding: { stepKop: 1, mode: 'math' }, archived: false, clientIds: ['max', 'ayt'],
  sessions: [
    { id: 's1', clientId: 'max', startedAt: '2026-11-17T07:00:00.000Z', endedAt: '2026-11-17T07:30:00.000Z' },
    { id: 's2', clientId: 'ayt', startedAt: '2026-11-17T07:31:00.000Z', endedAt: null },
  ],
};
const ctx = (over = {}) => ({
  items: [], purchases: new Map([['p1', purchase]]), activePurchaseId: 'p1',
  importedIds: new Set(), pending: [], translations: {}, ...over,
});

test('файл «Команды»: блоки, время нажатия в двух форматах, пустые строки', () => {
  const file = `мусор до первого блока\n${block('2026-11-17T10:05:33+03:00', 'строка 1\n\nстрока 2')}${block('17.11.2026, 10:06:00', 'x')}${BLOCK_MARK}\n`;
  const b = splitBlocks(file);
  assert.equal(b.length, 2);
  assert.equal(b[0].time, '2026-11-17T07:05:33.000Z');
  assert.deepEqual(b[0].lines, ['строка 1', 'строка 2']);
  assert.ok(b[1].time);
  assert.equal(parseTime('не дата'), null);
  // одинаковый блок — одинаковый отпечаток, другой — другой
  assert.equal(splitBlocks(file)[0].id, b[0].id);
  assert.notEqual(b[0].id, b[1].id);
});

test('экран заказа 订单详情: название, вариант, 实付 вместо цены до скидки, ×1, номер заказа', () => {
  const r = classify(lines(fx('zakaz-detali')));
  assert.equal(r.kind, 'order');
  assert.equal(r.orderNo, ORDER);
  assert.equal(r.paidFen, 1590); // 实付 ¥15.9, а не ¥28.9 и не ¥8.9 из рекомендаций
  assert.equal(r.qty, 1);
  assert.equal(r.shop, '小熊饼干童装店');
  assert.equal(r.nameCn, '儿童秋衣秋裤套装德绒男童女童秋冬内衣家居服宝宝保暖打底睡衣');
  assert.equal(r.variant, '灰领小狗-德绒套装，140码建议身高120-130cm');
  assert.deepEqual(r.doubts, []);
});

test('экран заказа в другом порядке строк (Live Text может читать иначе) и количество 3', () => {
  const t = ['展开', '某某旗舰店', '儿童袜子纯棉中筒袜', '¥19.9', '×3', '白色5双装', '7天无理由退货', '实付：¥45.6', '订单号：261116-300000000000003|复制'];
  const r = parseOrder(t);
  assert.equal(r.nameCn, '儿童袜子纯棉中筒袜');
  assert.equal(r.shop, '某某旗舰店');
  assert.equal(r.qty, 3);
  assert.equal(r.paidFen, 4560);
  assert.equal(r.variant, '白色5双装');
  // деньги: сумма из 实付, за штуку 15,20 ¥, BYN от суммы
  const m = itemMoney({ qty: 3, paidFen: 4560 }, purchase);
  assert.equal(m.totalFen, 4560);
  assert.equal(m.unitFen, 1520);
  assert.equal(m.totalKop, 2057); // 45,60 ¥ × 0,4512 = 20,57472 → 20,57 BYN
});

test('экраны логистики: трек только после «перевозчик：», не телефон курьера; статус по словам', () => {
  const j = classify(lines(fx('logistika-jitu')));
  assert.equal(j.kind, 'logistics');
  assert.equal(j.track, 'JT1000000000001');
  assert.equal(j.carrier, '极兔速递 (J&T)');
  assert.equal(j.orderNo, ORDER);
  assert.equal(j.status, 6); // 已签收 на складе карго
  const z = classify(lines(fx('logistika-pod-zatemneniem')));
  assert.equal(z.track, '70000000000002');
  assert.equal(z.carrier, '中通快递 (ZTO)');
  assert.equal(z.orderNo, '261113-200000000000002');
  assert.equal(z.status, 5); // 运输中
  const s = classify(lines(fx('logistika-share-stranica')));
  assert.equal(s.track, '70000000000002');
  assert.equal(s.orderNo, '');
  const y = classify(['韵达快递：465800000000001', '复制', '订单编号：261115-500000000000005']);
  assert.equal(y.carrier, '韵达快递 (Yunda)');
  assert.equal(y.track, '465800000000001');
});

test('два нажатия на заказ: карточка с клиентом по времени и сразу с треком', () => {
  const file = block('2026-11-17T10:05:00+03:00', fx('zakaz-detali')) + block('2026-11-17T10:40:00+03:00', fx('logistika-jitu'));
  const plan = buildPlan(splitBlocks(file), ctx());
  assert.equal(plan.newItems.length, 1);
  const n = plan.newItems[0];
  assert.equal(n.clientId, 'max'); // нажатие в 10:05 — между «Начать» и «Завершить» Максима
  assert.equal(n.clientBy, 'time');
  assert.equal(n.purchaseId, 'p1');
  assert.equal(n.track, 'JT1000000000001');
  assert.equal(n.status, 6);
  assert.equal(n.pddOrderNo, ORDER);
  assert.equal(plan.pending.length, 0);
  assert.equal(plan.unknown.length, 0);
  assert.equal(n.extraBlocks.length, 1); // снимок логистики тоже запомнится как забранный
});

test('время вне границ клиентов — клиента нет, решает пользователь', () => {
  const plan = buildPlan(splitBlocks(block('2026-11-17T09:00:00+03:00', fx('zakaz-detali'))), ctx());
  assert.equal(plan.newItems[0].clientId, null);
  assert.equal(plan.newItems[0].purchaseId, 'p1');
});

test('повторный «Забрать» того же файла ничего не удваивает', () => {
  const blocks = splitBlocks(block('2026-11-17T10:05:00+03:00', fx('zakaz-detali')) + block('2026-11-17T10:40:00+03:00', fx('logistika-jitu')));
  const plan = buildPlan(blocks, ctx({ importedIds: new Set(blocks.map((b) => b.id)) }));
  assert.equal(plan.newItems.length, 0);
  assert.equal(plan.tracks.length, 0);
  assert.equal(plan.skipped, 2);
  // и в одном файле двойное нажатие на тот же экран — одна карточка
  const twice = splitBlocks(block('2026-11-17T10:05:00+03:00', fx('zakaz-detali')) + block('2026-11-17T10:05:09+03:00', fx('zakaz-detali')));
  assert.equal(buildPlan(twice, ctx()).newItems.length, 1);
});

test('карточка с этим номером заказа уже есть — не дубль: трек к ней, пустые поля дополняются', () => {
  const items = [{ id: 'i1', purchaseId: 'p1', clientId: 'ayt', name: 'Пижама детская', pddOrderNo: ORDER, qty: 1, unitFen: null, status: 1, track: '' }];
  const plan = buildPlan(splitBlocks(block('2026-11-17T10:05:00+03:00', fx('zakaz-detali')) + block('2026-11-17T10:40:00+03:00', fx('logistika-jitu'))), ctx({ items }));
  assert.equal(plan.newItems.length, 0);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].patch.paidFen, 1590);
  assert.equal(plan.updates[0].patch.nameCn.slice(0, 4), '儿童秋衣');
  assert.equal(plan.tracks.length, 1);
  assert.deepEqual(plan.tracks[0].patch, { track: 'JT1000000000001', carrier: '极兔速递 (J&T)', status: 6 });
});

test('логистика раньше экрана заказа: трек ждёт и привязывается при следующем «Забрать»', () => {
  const lb = splitBlocks(block('2026-11-17T10:40:00+03:00', fx('logistika-jitu')));
  const p1 = buildPlan(lb, ctx());
  assert.equal(p1.pending.length, 1);
  const p2 = buildPlan(splitBlocks(block('2026-11-17T10:05:00+03:00', fx('zakaz-detali'))), ctx({ pending: p1.pending, importedIds: new Set(lb.map((b) => b.id)) }));
  assert.equal(p2.newItems[0].track, 'JT1000000000001');
  assert.equal(p2.pendingResolved.length, 1);
});

test('страница «поделиться» без номера заказа привязывается по треку, если он уже есть в карточке', () => {
  const items = [{ id: 'i2', purchaseId: 'p1', clientId: 'max', name: 'Кофта', pddOrderNo: '261113-200000000000002', track: '70000000000002', carrier: '', status: 4, qty: 1 }];
  const plan = buildPlan(splitBlocks(block('2026-11-17T11:00:00+03:00', fx('logistika-share-stranica'))), ctx({ items }));
  assert.equal(plan.tracks.length, 1);
  assert.equal(plan.tracks[0].itemId, 'i2');
  assert.equal(plan.tracks[0].patch.status, 5);
});

test('чужой экран не выдумывается, а показывается как «не понял»', () => {
  const plan = buildPlan(splitBlocks(block('2026-11-17T11:00:00+03:00', '首页\n推荐\n￥121\n全店回购6186件')), ctx());
  assert.equal(plan.newItems.length, 0);
  assert.equal(plan.unknown.length, 1);
});

test('запомненный перевод подставляется; без русского названия опись группирует по китайскому и предупреждает', () => {
  const nameCn = '儿童秋衣秋裤套装德绒男童女童秋冬内衣家居服宝宝保暖打底睡衣';
  const plan = buildPlan(splitBlocks(block('2026-11-17T10:05:00+03:00', fx('zakaz-detali'))), ctx({ translations: { [nameCn]: 'Пижама детская' } }));
  assert.equal(plan.newItems[0].name, 'Пижама детская');
  const o = buildOpis([
    { id: 'a', name: '', nameCn, qty: 1, paidFen: 1590 },
    { id: 'b', name: '', nameCn, qty: 2, paidFen: 3000 },
    { id: 'c', name: '', nameCn: '袜子', qty: 1, paidFen: 500 },
  ], purchase);
  assert.equal(o.rows.length, 2); // одинаковые китайские — вместе, разные не склеиваются
  assert.equal(o.noRu, 2);
  assert.equal(o.suggestions.length, 0);
});

test('настоящий вывод Live Text с iPhone (логистика 韵达): трек, перевозчик, заказ, статус; телефон курьера не путается', () => {
  const r = classify(lines(fx('logistika-yunda-livetext')));
  assert.equal(r.kind, 'logistics');
  assert.equal(r.carrier, '韵达快递 (Yunda)');
  assert.equal(r.track, '465800000000009');
  assert.equal(r.orderNo, '261115-900000000000009');
  assert.equal(r.status, 6); // 已签收
});

test('забытое «Завершить» в старой закупке: главнее активная закупка, и время помечается как спорное', () => {
  const old = { id: 'old', archived: false, clientIds: ['x'], sessions: [{ id: 'o1', clientId: 'x', startedAt: '2026-11-10T07:00:00.000Z', endedAt: null }] };
  const purchases = new Map([['old', old], ['p1', purchase]]);
  const plan = buildPlan(splitBlocks(block('2026-11-17T10:05:00+03:00', fx('zakaz-detali'))), ctx({ purchases }));
  assert.equal(plan.newItems[0].purchaseId, 'p1');
  assert.equal(plan.newItems[0].clientId, 'max');
  assert.ok(plan.newItems[0].doubts.some((d) => d.includes('нескольким закупкам')));
});

test('номер заказа с пробелом или длинным тире распознаётся; необычная длина помечается', () => {
  const base = ['展开', '某某店', '袜子', '¥10', '×1', '实付：¥10'];
  assert.equal(parseOrder([...base, '订单号：261116 — 3000 0000 0000 003']).orderNo, '261116-300000000000003');
  assert.equal(parseOrder([...base, '订单号：261116- 300000000000003']).orderNo, '261116-300000000000003');
  const short = parseOrder([...base, '订单号：261116-3000000000']);
  assert.ok(short.doubts.some((d) => d.includes('необычной длины')));
  const none = parseOrder(base);
  assert.ok(none.doubts.some((d) => d.includes('прокрутите')));
});

test('блоки без перевода строки перед меткой не слипаются', () => {
  const file = `===PDD===\n2026-11-17T10:05:00+03:00\n${fx('zakaz-detali')}确认收货===PDD===\n2026-11-17T10:40:00+03:00\n${fx('logistika-jitu')}`;
  const b = splitBlocks(file);
  assert.equal(b.length, 2);
  const plan = buildPlan(b, ctx());
  assert.equal(plan.newItems.length, 1);
  assert.equal(plan.newItems[0].track, 'JT1000000000001');
});

test('без номера заказа двойное нажатие на тот же экран — одна карточка', () => {
  const t = ['展开', '某某店', '儿童袜子', '¥10', '×1', '实付：¥10'].join('\n');
  const plan = buildPlan(splitBlocks(block('2026-11-17T10:05:00+03:00', t) + block('2026-11-17T10:05:20+03:00', `${t}\n更多`)), ctx());
  assert.equal(plan.newItems.length, 1);
  assert.equal(plan.newItems[0].extraBlocks.length, 1);
});

test('цена: пробел после точки, тысячи с запятой, сумма до подписи, сверка с ценой × количество', () => {
  const head = ['展开', '某某店', '袜子', '¥30', '×2'];
  assert.equal(parseOrder([...head, '实付：￥45. 6', '订单号：261116-300000000000003']).paidFen, 4560);
  assert.equal(parseOrder(['展开', '某某店', '大衣', '¥1,399.00', '×1', '实付：￥1,299.00', '订单号：261116-300000000000003']).paidFen, 129900);
  assert.equal(parseOrder([...head, '￥45.6', '实付：', '订单号：261116-300000000000003']).paidFen, 4560);
  const odd = parseOrder([...head, '实付：￥456', '订单号：261116-300000000000003']); // 456 > 30 × 2
  assert.ok(odd.doubts.some((d) => d.includes('проверьте сумму')));
});

test('цена и количество в одной строке, «×l» вместо ×1, два товара в заказе — с пометкой', () => {
  const one = parseOrder(['展开', '某某旗舰店', '儿童袜子纯棉中筒袜', '￥19.9 ×3', '白色5双装', '7天无理由退货', '实付：¥45.6', '订单号：261116-300000000000003']);
  assert.equal(one.qty, 3);
  assert.equal(one.nameCn, '儿童袜子纯棉中筒袜');
  assert.equal(one.variant, '白色5双装');
  assert.equal(parseOrder(['展开', '某某店', '袜子', '¥10', '×l', '实付：¥10', '订单号：261116-300000000000003']).qty, 1);
  const two = parseOrder(['展开', '某某店', '袜子A', '¥10', '×1', '红色', '袜子B', '¥5', '×2', '实付：¥20', '订单号：261116-300000000000003']);
  assert.ok(two.doubts.some((d) => d.includes('несколько товаров')));
});

test('трек с пробелами и EMS латиницей; «联系快递：телефон» — не трек', () => {
  assert.equal(classify(['中通快递：7000 0000 0000 02', '订单编号：261113-200000000000002']).track, '70000000000002');
  assert.equal(classify(['EMS：1100000000001', '订单编号：261113-200000000000002']).track, '1100000000001');
  const r = classify(['联系快递：13800000000', '韵达快递：465800000000009', '订单编号：261115-900000000000009']);
  assert.equal(r.track, '465800000000009');
});

test('экран заказа со строкой перевозчика — всё равно экран заказа', () => {
  assert.equal(classify(['中通快递：70000000000002', ...lines(fx('zakaz-detali'))]).kind, 'order');
});

test('второй трек того же заказа: прежний не теряется, уходит в заметку', () => {
  const items = [{ id: 'i1', purchaseId: 'p1', clientId: 'max', name: 'Шарф', pddOrderNo: ORDER, track: 'YT0000000000001', carrier: '圆通快递 (YTO)', status: 4, qty: 2, note: '' }];
  const plan = buildPlan(splitBlocks(block('2026-11-17T11:00:00+03:00', fx('logistika-jitu'))), ctx({ items }));
  assert.equal(plan.tracks[0].replaces, 'YT0000000000001');
  assert.ok(plan.tracks[0].patch.note.includes('Прежний трек: YT0000000000001'));
});

test('два товара одной посылкой: общий трек не дубль, страница без номера заказа обновляет оба', () => {
  const items = [
    { id: 'i1', purchaseId: 'p1', clientId: 'max', name: 'Шапка', pddOrderNo: '261113-200000000000002', track: '70000000000002', status: 4, qty: 1 },
    { id: 'i2', purchaseId: 'p1', clientId: 'ayt', name: 'Шарф', pddOrderNo: '261113-200000000000003', track: '70000000000002', status: 4, qty: 1 },
  ];
  const plan = buildPlan(splitBlocks(block('2026-11-17T11:00:00+03:00', fx('logistika-share-stranica'))), ctx({ items }));
  assert.deepEqual(plan.tracks.map((t) => t.itemId).sort(), ['i1', 'i2']);
  assert.ok(plan.tracks.every((t) => t.patch.status === 5));
  // логистика с номером заказа второго товара — трек тот же, ничего не заменяется
  const p2 = buildPlan(splitBlocks(block('2026-11-17T11:05:00+03:00', ['中通快递：70000000000002', '订单编号：261113-200000000000003', '运输中'].join('\n'))), ctx({ items }));
  assert.equal(p2.tracks.length, 1);
  assert.equal(p2.tracks[0].itemId, 'i2');
  assert.equal(p2.tracks[0].replaces, '');
});

test('понятные сообщения: пустой файл, текст пробной «Команды» без метки, чужой текст', async () => {
  const { diagnoseText, asSingleBlock } = await import('../site/src/pddimport.js');
  assert.equal(diagnoseText(''), 'empty');
  assert.equal(diagnoseText(`${BLOCK_MARK}\n\n`), 'empty');
  assert.equal(diagnoseText(block('2026-11-17T10:05:00+03:00', fx('zakaz-detali'))), 'blocks');
  assert.equal(diagnoseText(fx('logistika-yunda-livetext')), 'nomarker');
  assert.equal(diagnoseText('Список покупок: молоко, хлеб'), 'foreign');
  // текст без метки разбирается как один снимок: трек есть, клиента выберет пользователь
  const plan = buildPlan(splitBlocks(asSingleBlock(fx('zakaz-detali'))), ctx());
  assert.equal(plan.newItems.length, 1);
  assert.equal(plan.newItems[0].clientId, null);
  assert.equal(plan.newItems[0].paidFen, 1590);
});

test('файл без строки ===PDD===: снимки делятся по времени нажатия, даже если время прилипло к тексту', () => {
  // так пишет «Команда», если в «Добавить в текстовый файл» вставили только дату и текст
  const file = `2026-11-17T10:05:00+03:00${fx('zakaz-detali')}\n2026-11-17T10:40:00+03:00\n${fx('logistika-jitu')}\n`;
  const b = splitBlocks(file);
  assert.equal(b.length, 2);
  assert.equal(b[0].time, '2026-11-17T07:05:00.000Z');
  const plan = buildPlan(b, ctx());
  assert.equal(plan.newItems.length, 1);
  assert.equal(plan.newItems[0].clientId, 'max');
  assert.equal(plan.newItems[0].track, 'JT1000000000001');
});

test('настоящий файл PDD.txt с iPhone пользователя (17.11): без ===PDD===, время прилипло к часам статус-строки', () => {
  const b = splitBlocks(fx('pdd-txt-iphone-bez-metki'));
  assert.equal(b.length, 1);
  assert.equal(b[0].time, '2026-11-17T12:44:34.000Z');
  const r = classify(b[0].lines);
  assert.equal(r.kind, 'logistics');
  assert.equal(r.track, '70000000000002');
  assert.equal(r.carrier, '中通快递 (ZTO)');
  assert.equal(r.orderNo, '261113-200000000000002');
  assert.equal(r.status, 6);
});

test('экран заказа после отправки: одно нажатие — русское название, цена, трек, перевозчик, статус', async () => {
  const { ruName } = await import('../site/src/names.js');
  const b = splitBlocks(fx('zakaz-otpravlen'));
  assert.equal(b.length, 1);
  const r = classify(b[0].lines);
  assert.equal(r.kind, 'order');
  assert.equal(r.orderNo, '261111-800000000000008');
  assert.equal(r.nameCn, '工程车贴纸儿童贴画小汽车交通工具警车消防车泡泡贴画恐龙');
  assert.equal(r.variant, '96.8%选择（交通工具泡泡贴）24张重复');
  assert.equal(r.qty, 1);
  assert.equal(r.paidFen, 380);
  assert.equal(r.track, '777400000000008');
  assert.equal(r.carrier, '申通快递 (STO)');
  assert.equal(r.status, 6);
  assert.equal(ruName(r.nameCn, r.variant), 'Наклейки детские');
  const plan = buildPlan(b, ctx({ purchases: new Map([['p1', { ...purchase, sessions: [{ id: 's', clientId: 'ayt', startedAt: '2026-11-17T12:00:00.000Z', endedAt: null }] }]]) }));
  const n = plan.newItems[0];
  assert.equal(n.name, 'Наклейки детские');
  assert.equal(n.clientId, 'ayt');
  assert.equal(n.track, '777400000000008');
});

test('склеенная строка «展开（汐暮 潜力好店…» и адрес перед ней не попадают в название', () => {
  const r = parseOrder(['李 138****0000', '某某路某某工业区…', '展开（汐暮 潜力好店工程车贴纸儿童贴画小汽车交通工具警车消防', '车泡泡贴画恐龙…96.8%选择（交通工具泡泡贴）24张重复*8.8', '×1', '实付：¥3.8', '订单号：261111-800000000000008']);
  assert.equal(r.nameCn, '工程车贴纸儿童贴画小汽车交通工具警车消防车泡泡贴画恐龙');
  assert.equal(r.shop, '');
});

test('уже есть карточка с этим номером заказа (неудачная из прошлого раза) — дополняется: русское название, трек, фото', () => {
  const items = [{ id: 'bad', purchaseId: 'p1', clientId: 'ayt', name: '', nameCn: '展开（汐暮…', pddOrderNo: '261111-800000000000008', track: '', status: 1, qty: 1, photoId: null }];
  const file = fx('zakaz-otpravlen').replace('确认收货', '确认收货\nIMG:aGVsbG8=');
  const plan = buildPlan(splitBlocks(file), ctx({ items }));
  assert.equal(plan.newItems.length, 0);
  const u = plan.updates[0];
  assert.equal(u.patch.name, 'Наклейки детские');
  assert.equal(u.patch.track, '777400000000008');
  assert.equal(u.patch.status, 6);
  assert.equal(u.image, 'aGVsbG8=');
});

test('словарь: короткие русские названия', async () => {
  const { ruName } = await import('../site/src/names.js');
  assert.equal(ruName('儿童秋衣秋裤套装德绒男童女童秋冬内衣家居服宝宝保暖打底睡衣'), 'Термобельё детское');
  assert.equal(ruName('小众慵懒风圆领套头毛衣女秋冬'), 'Свитер женский');
  assert.equal(ruName('儿童一脚蹬棉鞋'), 'Слипоны детские');
  assert.equal(ruName('苹果15手机壳透明'), 'Чехол для телефона');
  assert.equal(ruName('某某新品'), '');
});

test('таблица экрана заказа прочитана столбцами: подпись «该规格拼单价» не становится вариантом', () => {
  const r = parseOrder(['展开', '汐暮', '潜力好店', '工程车贴纸儿童贴画', '¥8.8', '×1', '7天无理由退货', '实付：¥3.8', '已购规格', '该规格拼单价', '已购数量', '合计拼单价',
    '96.8%选择（交通工具泡泡贴）24张重复', '¥8.8', '1', '¥8.8', '订单号：261111-800000000000008', '物流公司：申通快递', '快递单号：777400000000008']);
  assert.notEqual(r.variant, '该规格拼单价');
  assert.equal(r.track, '777400000000008');
  assert.equal(r.qty, 1);
});

test('второй снимок пользователя (17.11): сантиметровая лента и «展升» вместо «展开»', async () => {
  const { ruName } = await import('../site/src/names.js');
  const title = '展升〈"RETANE聘珍官方旗舰店官方旗舰11.11秒杀2米迷你简约携便小卷尺量衣1皮尺量腰围臂围可爱卡通测三围尺软尺绿＋粉（2个）便携尺，2米（厘米英寸两面）便携尺';
  const r = parseOrder(['展开', title, '¥9.9', '×1', '实付：¥4.64', '订单号：261111-800000000000009']);
  assert.ok(!r.nameCn.startsWith('展'), r.nameCn);
  assert.ok(!r.nameCn.includes('旗舰店'), r.nameCn);
  assert.equal(ruName(r.nameCn), 'Сантиметровая лента');
});

test('перевод экрана (RU:) от «Перевести текст»: короткое название, когда словаря не хватает', async () => {
  const { nameFromTranslation } = await import('../site/src/names.js');
  const cn = ['展开', '某某店', '可爱卡通测量小工具', '¥9.9', '×1', '实付：¥4.64', '订单号：261111-800000000000009'];
  const ru = ['Развернуть', 'Магазин', 'Милая мультяшная маленькая рулетка для измерения', '¥9.9', '×1', 'Фактически оплачено: ¥4.64', 'Номер заказа: 261111-800000000000009'];
  const file = `===PDD===\n2026-11-17T10:05:00+03:00\n${cn.join('\n')}\nRU:${ru.join('\n')}\nIMG:aGVsbG8=\n`;
  const b = splitBlocks(file);
  assert.equal(b[0].lines.length, cn.length); // перевод не попал в китайский текст
  assert.equal(b[0].ru.length, ru.length);
  assert.equal(b[0].image, 'aGVsbG8=');
  const plan = buildPlan(b, ctx());
  assert.equal(plan.newItems[0].name, 'Рулетка');
  assert.equal(plan.newItems[0].nameFrom, 'mt');
  assert.equal(plan.newItems[0].qty, 1);
  assert.deepEqual(plan.newItems[0].doubts, []);
  // число строк перевода не совпало — берём строки примерно на тех же местах
  assert.equal(nameFromTranslation(['a', 'Милая рулетка'], 4, [2]), 'Рулетка');
  // знакомого слова нет — первые слова перевода
  assert.equal(nameFromTranslation(['x', 'y', 'Официальный магазин Чудесный прибор складной'], 3, [2]), 'Чудесный прибор складной');
});

test('фото вручную: квадрат вокруг нажатия не выходит за снимок', async () => {
  const { squareAt } = await import('../site/src/photocrop.js');
  assert.deepEqual(squareAt(640, 1386, 0.12, 0.3), { x: 16, y: 355, w: 122, h: 122 });
  assert.deepEqual(squareAt(640, 1386, 0, 0), { x: 0, y: 0, w: 122, h: 122 });
  assert.deepEqual(squareAt(640, 1386, 1, 1), { x: 518, y: 1264, w: 122, h: 122 });
});
