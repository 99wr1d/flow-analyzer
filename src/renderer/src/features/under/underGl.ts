// WebGL2-слой «под игроками»: текущий кадр видео и растр рисунков → рисунки видны только там, где газон.
// Два прохода, всё на GPU:
//   1) по кадру видео (в его родном размере) считается «видимость» — то же, что делает ffmpeg-фильтр chromakey
//      (окно 3×3 по U и V, расстояние до цвета ключа, similarity и blend; формулы — shared/grassKey.ts);
//      результат — текстура R8: 1 — газон (рисунок виден), 0 — игрок, линия и т. д.;
//   2) растр рисунков (премультиплицированный) умножается на видимость и выводится на холст размером с картинку.
// Режим «маска»: вместо рисунков выводится сама видимость (белое — газон).
import { keyUV, lumaThreshold, LUMA_RAMP, type GrassKeyValues } from '../../../../shared/grassKey'

const VERTEX = `#version 300 es
out vec2 vUv;
void main() {
  float x = float(gl_VertexID & 1);
  float y = float(gl_VertexID >> 1);
  gl_Position = vec4(x * 2.0 - 1.0, y * 2.0 - 1.0, 0.0, 1.0);
  vUv = vec2(x, 1.0 - y);
}`

// Формулы U и V — целочисленные формулы libavutil в виде вещественных чисел (деление на 1024 точное, floor = сдвиг).
const KEY_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uVideo;
uniform ivec2 uSize;
uniform vec2 uKey;
uniform float uSimilarity;
uniform float uBlend;
uniform float uLumaThreshold;
uniform float uLumaRamp;
out vec4 outColor;

float distAt(ivec2 p) {
  if (p.x < 0 || p.y < 0 || p.x >= uSize.x || p.y >= uSize.y) return 0.0;
  vec3 c = floor(texelFetch(uVideo, p, 0).rgb * 255.0 + 0.5);
  float u = clamp(floor((-173.0 * c.r - 339.0 * c.g + 512.0 * c.b + 511.0) / 1024.0) + 128.0, 0.0, 255.0);
  float v = clamp(floor((512.0 * c.r - 429.0 * c.g - 83.0 * c.b + 511.0) / 1024.0) + 128.0, 0.0, 255.0);
  vec2 d = vec2(u, v) - uKey;
  return sqrt(dot(d, d) / (255.0 * 255.0 * 2.0));
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  float sum = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      sum += distAt(p + ivec2(i, j));
    }
  }
  float diff = sum / 9.0;
  float alpha = uBlend > 0.0001 ? clamp((diff - uSimilarity) / uBlend, 0.0, 1.0) : (diff > uSimilarity ? 1.0 : 0.0);
  // Яркость (lumaAlpha в shared/grassKey.ts): светлее газона на LUMA_GAP — не газон; берётся наибольшая прозрачность.
  vec3 c0 = floor(texelFetch(uVideo, p, 0).rgb * 255.0 + 0.5);
  float y = floor((306.0 * c0.r + 601.0 * c0.g + 117.0 * c0.b + 512.0) / 1024.0);
  alpha = max(alpha, clamp((y - uLumaThreshold) / uLumaRamp, 0.0, 1.0));
  outColor = vec4(1.0 - alpha);
}`

const DRAW_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uDrawing;
uniform sampler2D uVis;
uniform int uMask;
in vec2 vUv;
out vec4 outColor;
void main() {
  float vis = texture(uVis, vUv).r;
  if (uMask == 1) {
    outColor = vec4(vec3(vis), 1.0);
    return;
  }
  outColor = texture(uDrawing, vUv) * vis;
}`

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('shader')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? 'shader compile')
  }
  return shader
}

function program(gl: WebGL2RenderingContext, fragment: string): WebGLProgram {
  const p = gl.createProgram()
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERTEX))
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fragment))
  gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(p) ?? 'program link')
  }
  return p
}

function texture(gl: WebGL2RenderingContext, min: number): WebGLTexture {
  const t = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, t)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, min)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return t
}

/** Можно ли получить WebGL2 вообще (проверка один раз). */
let probed: boolean | null = null
export function webgl2Available(): boolean {
  if (probed === null) {
    try {
      probed = document.createElement('canvas').getContext('webgl2') !== null
    } catch {
      probed = false
    }
  }
  return probed
}

export class UnderRenderer {
  private readonly gl: WebGL2RenderingContext
  private readonly keyProgram: WebGLProgram
  private readonly drawProgram: WebGLProgram
  private readonly videoTex: WebGLTexture
  private readonly drawingTex: WebGLTexture
  private readonly visTex: WebGLTexture
  private readonly fbo: WebGLFramebuffer
  private videoW = 0
  private videoH = 0
  private visW = 0
  private visH = 0
  private hasDrawing = false
  lost = false

  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: true
    })
    if (!gl) throw new Error('webgl2')
    this.gl = gl
    this.keyProgram = program(gl, KEY_FRAGMENT)
    this.drawProgram = program(gl, DRAW_FRAGMENT)
    this.videoTex = texture(gl, gl.NEAREST)
    this.drawingTex = texture(gl, gl.LINEAR)
    this.visTex = texture(gl, gl.LINEAR_MIPMAP_LINEAR)
    const fbo = gl.createFramebuffer()
    if (!fbo) throw new Error('fbo')
    this.fbo = fbo
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    canvas.addEventListener('webglcontextlost', this.onLost)
  }

  private readonly onLost = (e: Event): void => {
    e.preventDefault()
    this.lost = true
  }

  /** Загружает кадр видео в текстуру. false — кадр ещё не готов. */
  uploadVideo(video: HTMLVideoElement): boolean {
    const { gl } = this
    if (video.readyState < 2 || !(video.videoWidth > 0 && video.videoHeight > 0)) return false
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.videoTex)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video)
    } catch {
      return false
    }
    this.videoW = video.videoWidth
    this.videoH = video.videoHeight
    return true
  }

  /** Растр рисунков (прозрачный, обычный непремультиплицированный); null — рисунков нет. */
  setDrawing(source: CanvasImageSource | null): void {
    const { gl } = this
    this.hasDrawing = source !== null
    if (!source) return
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.drawingTex)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source as TexImageSource)
  }

  /** Размер холста (в пикселях экрана). */
  resize(width: number, height: number): void {
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width
      this.canvas.height = height
    }
  }

  private ensureVis(): void {
    const { gl } = this
    if (this.visW === this.videoW && this.visH === this.videoH) return
    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D, this.visTex)
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R8,
      this.videoW,
      this.videoH,
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      null
    )
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.visTex, 0)
    this.visW = this.videoW
    this.visH = this.videoH
  }

  /** Рисует: рисунки × видимость газона или (mask) сама видимость. Нужен предварительный uploadVideo. */
  render(key: GrassKeyValues, mask: boolean): void {
    const { gl } = this
    if (this.lost || this.videoW === 0) return
    this.ensureVis()
    const uv = keyUV(key.color)
    // Проход 1: видимость по кадру (размер видео).
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo)
    gl.viewport(0, 0, this.videoW, this.videoH)
    gl.disable(gl.BLEND)
    gl.useProgram(this.keyProgram)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.videoTex)
    gl.uniform1i(gl.getUniformLocation(this.keyProgram, 'uVideo'), 0)
    gl.uniform2i(gl.getUniformLocation(this.keyProgram, 'uSize'), this.videoW, this.videoH)
    gl.uniform2f(gl.getUniformLocation(this.keyProgram, 'uKey'), uv.u, uv.v)
    gl.uniform1f(gl.getUniformLocation(this.keyProgram, 'uSimilarity'), key.similarity)
    gl.uniform1f(gl.getUniformLocation(this.keyProgram, 'uBlend'), key.blend)
    gl.uniform1f(gl.getUniformLocation(this.keyProgram, 'uLumaThreshold'), lumaThreshold(key.color))
    gl.uniform1f(gl.getUniformLocation(this.keyProgram, 'uLumaRamp'), LUMA_RAMP)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D, this.visTex)
    gl.generateMipmap(gl.TEXTURE_2D)
    // Проход 2: на холст.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    if (!mask && !this.hasDrawing) return
    gl.useProgram(this.drawProgram)
    gl.uniform1i(gl.getUniformLocation(this.drawProgram, 'uDrawing'), 1)
    gl.uniform1i(gl.getUniformLocation(this.drawProgram, 'uVis'), 2)
    gl.uniform1i(gl.getUniformLocation(this.drawProgram, 'uMask'), mask ? 1 : 0)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  clear(): void {
    const { gl } = this
    if (this.lost) return
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
  }

  dispose(): void {
    this.canvas.removeEventListener('webglcontextlost', this.onLost)
    this.gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
}
