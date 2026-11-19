// Перенесено из «Посылок» (parcel-scanner b86f1a2) без изменений, кроме путей и ключей настроек.
// Камера и распознавание штрихкодов (zxing-wasm, файл библиотеки лежит рядом, работает без интернета).
/* global ZXingWASM */

const READER_OPTIONS = {
  formats: ['Code128', 'Code39', 'Code93', 'EANUPC', 'ITF', 'Codabar', 'QRCode', 'DataMatrix'],
  tryHarder: true,
  tryRotate: true, // вертикальный штрихкод сбоку наклейки
  tryInvert: false,
  maxNumberOfSymbols: 8,
};

let prepared = false;
function prepare() {
  if (prepared) return;
  prepared = true;
  const wasmUrl = new URL('../../vendor/zxing_reader.wasm', import.meta.url).href;
  ZXingWASM.prepareZXingModule({
    overrides: { locateFile: (path, prefix) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) },
    fireImmediately: true,
  });
}

async function decode(input) {
  prepare();
  const results = await ZXingWASM.readBarcodes(input, READER_OPTIONS);
  return results.filter((r) => r.isValid && r.text).map((r) => r.text);
}

/** Распознаёт коды на фото (запасной путь, если камера капризничает). */
export function decodeImage(file) {
  return decode(file);
}

const CAMERA_KEY = 'pdd-zakupki:camera';

/** Список задних камер (на iPhone Pro их несколько: обычная, широкая, «тройная» для близких предметов). */
export async function listCameras() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === 'videoinput');
}

export async function openCamera(video, deviceId) {
  const saved = deviceId ?? localStorage.getItem(CAMERA_KEY);
  const video_ = {
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    ...(saved ? { deviceId: { exact: saved } } : { facingMode: { ideal: 'environment' } }),
  };
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: video_ });
  } catch (err) {
    if (!saved) throw err;
    localStorage.removeItem(CAMERA_KEY); // сохранённая камера пропала: берём обычную заднюю
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' } } });
  }
  if (deviceId) localStorage.setItem(CAMERA_KEY, deviceId);
  video.setAttribute('playsinline', '');
  video.muted = true;
  video.srcObject = stream;
  await video.play();
  return stream;
}

export function closeCamera(stream) {
  stream?.getTracks().forEach((t) => t.stop());
}

/** Фонарик, если камера его поддерживает. Возвращает функцию включения или null. */
export function torchControl(stream) {
  const track = stream?.getVideoTracks()[0];
  const caps = track?.getCapabilities?.();
  if (!caps?.torch) return null;
  return (on) => track.applyConstraints({ advanced: [{ torch: on }] });
}

/**
 * Приближение камеры, если оно есть: мелкий штрихкод можно читать издалека, где камера в фокусе.
 * Возвращает { levels, set(level) } или null.
 */
export function zoomControl(stream) {
  const track = stream?.getVideoTracks()[0];
  const caps = track?.getCapabilities?.();
  if (!caps?.zoom || caps.zoom.max <= caps.zoom.min) return null;
  const levels = [1, 2, 3].filter((z) => z >= caps.zoom.min && z <= caps.zoom.max);
  if (levels.length < 2) return null;
  return { levels, set: (z) => track.applyConstraints({ advanced: [{ zoom: z }] }) };
}

/**
 * Цикл распознавания: кадр → коды → onCodes(codes, now). Следующий кадр берётся, когда прошлый разобран.
 */
export function createScanLoop(video, onCodes) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let running = false;

  async function tick() {
    if (!running) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (w && h && video.readyState >= 2) {
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.drawImage(video, 0, 0, w, h);
      try {
        const codes = await decode(ctx.getImageData(0, 0, w, h));
        if (running) onCodes(codes, performance.now());
      } catch (err) {
        console.error('Ошибка распознавания', err);
      }
    }
    if (running) requestAnimationFrame(tick);
  }

  return {
    start() {
      if (running) return;
      running = true;
      requestAnimationFrame(tick);
    },
    stop() {
      running = false;
    },
  };
}
