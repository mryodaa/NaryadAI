// Управление сценой «как в картах»: что считать кликом, а что перемещением камеры, и команды камеры
// для клавиатуры, двойного клика и подсказки. Камера (CameraRig) регистрирует команды при старте сцены.

/** Клик — если указатель сместился меньше чем на 5 px и кнопку отпустили быстрее 300 мс */
const CLICK_PX = 5;
const CLICK_MS = 300;

const down = { x: 0, y: 0, t: 0, button: -1 };

/** Нажатие на сцене (слушатель на захвате, до камеры и до объектов сцены) */
export function notePointerDown(e: { clientX: number; clientY: number; button: number }) {
  down.x = e.clientX;
  down.y = e.clientY;
  down.t = performance.now();
  down.button = e.button;
}

/** Это был клик, а не перемещение камеры: выбор объекта срабатывает только тогда */
export function isClick(e: { clientX: number; clientY: number }): boolean {
  return down.button === 0 && Math.hypot(e.clientX - down.x, e.clientY - down.y) < CLICK_PX && performance.now() - down.t < CLICK_MS;
}

/** Луч задел машину: она важнее оборудования вокруг (стойки конвейера, стенки камер и печей) */
export function hitsCar(e: { intersections: { object: { userData: Record<string, unknown> } }[] }): boolean {
  return e.intersections.some((i) => i.object.userData.cars === true);
}

export interface CameraCommands {
  /** Плавно приблизиться к точке на полу и сделать её центром */
  flyTo: (x: number, y: number, z: number) => void;
  /** Сдвиг по полу в долях видимого кадра: вправо и вперёд (от зрителя) */
  pan: (right: number, forward: number) => void;
  /** Поворот вокруг центра кадра, радианы */
  rotate: (azimuth: number) => void;
  /** Шаг масштаба: >0 — ближе, <0 — дальше */
  zoom: (steps: number) => void;
  /** Показать выбранное (участок, оборудование) или весь цех */
  focus: () => void;
  /** Весь цех */
  home: () => void;
  /** Заново показать выбранный участок (или весь цех), даже если камеру увели */
  frame: () => void;
}

let commands: CameraCommands | null = null;

export function setCameraCommands(c: CameraCommands | null) {
  commands = c;
}

export function cameraCommands(): CameraCommands | null {
  return commands;
}

/** Подсказка по управлению показана хотя бы раз (память браузера может быть недоступна) */
const HINT_KEY = 'scene-hint-seen';

export function hintSeen(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === '1';
  } catch {
    return false;
  }
}

export function markHintSeen() {
  try {
    localStorage.setItem(HINT_KEY, '1');
  } catch {
    // без памяти браузера подсказка покажется при следующем открытии ещё раз
  }
}
