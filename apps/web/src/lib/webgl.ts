// Можно ли показывать 3D: есть ли WebGL и есть ли аппаратное ускорение.
// ok — всё есть; slow — только программная отрисовка (3D будет тормозить); none — WebGL нет.
export type WebglSupport = 'ok' | 'slow' | 'none';

let cached: WebglSupport | null = null;

function probe(attrs?: WebGLContextAttributes): boolean {
  const canvas = document.createElement('canvas');
  const gl = (canvas.getContext('webgl2', attrs) ?? canvas.getContext('webgl', attrs)) as WebGLRenderingContext | null;
  if (!gl) return false;
  // пробный контекст сразу освобождаем: браузер держит лишь несколько живых контекстов
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return true;
}

export function webglSupport(): WebglSupport {
  if (cached) return cached;
  try {
    cached = probe({ failIfMajorPerformanceCaveat: true }) ? 'ok' : probe() ? 'slow' : 'none';
  } catch {
    cached = 'none';
  }
  return cached;
}
