// Перенесено из «Посылок» (parcel-scanner b86f1a2) без изменений, кроме путей и ключей настроек.
// Звук и вибрация результата.
// Вибрация в Safari: щелчок по скрытому переключателю <input switch> даёт короткий отклик (iOS 17.4+).

let audio = null;
const SOUND_KEY = 'pdd-zakupki:sound';

export function soundOn() {
  return localStorage.getItem(SOUND_KEY) !== 'off';
}

export function setSound(on) {
  localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
}

/** Вызывать из нажатия кнопки: iPhone разрешает звук только после касания. */
export function unlockAudio() {
  try {
    if (navigator.audioSession) navigator.audioSession.type = 'playback'; // звучит и при беззвучном режиме
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
  } catch (err) {
    console.warn('Звук недоступен', err);
  }
}

function tone(freq, at, dur, type = 'sine', volume = 0.35) {
  const t0 = audio.currentTime + at;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(volume, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(gain).connect(audio.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

const SOUNDS = {
  found: () => {
    tone(1046, 0, 0.09);
    tone(1568, 0.1, 0.14);
  },
  repeat: () => {
    tone(660, 0, 0.12, 'triangle');
    tone(660, 0.18, 0.12, 'triangle');
  },
  unknown: () => tone(180, 0, 0.45, 'square', 0.25),
};

const HAPTICS = { found: 1, repeat: 2, unknown: 3 };

function haptic(times) {
  const label = document.getElementById('haptic');
  if (!label) return;
  for (let i = 0; i < times; i++) setTimeout(() => label.click(), i * 140);
}

export function signal(kind) {
  if (soundOn() && audio) {
    try {
      SOUNDS[kind]();
    } catch (err) {
      console.warn(err);
    }
  }
  haptic(HAPTICS[kind]);
}
