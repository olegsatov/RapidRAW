export type BrushMode = 'add' | 'erase';

interface Size {
  width: number;
  height: number;
}

const COMPOSITOR_VERTEX = `#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_uv = vec2(a_position.x * 0.5 + 0.5, -a_position.y * 0.5 + 0.5);
}
`;

const COMPOSITOR_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_base;
uniform sampler2D u_effect;
uniform sampler2D u_mask;
uniform float u_opacity;
uniform float u_overlay;
in vec2 v_uv;
out vec4 outColor;

void main() {
  vec3 base = texture(u_base, v_uv).rgb;
  vec3 effect = texture(u_effect, v_uv).rgb;
  // Mask is a render-to-texture target; its texel origin is the bottom-left,
  // so we flip v to keep it aligned with the loaded base/effect images.
  float mask = texture(u_mask, vec2(v_uv.x, 1.0 - v_uv.y)).r * u_opacity;
  vec3 result = mix(base, effect, mask);
  if (u_overlay > 0.5) {
    result = mix(result, vec3(1.0, 0.2, 0.2), mask * 0.35);
  }
  outColor = vec4(result, 1.0);
}
`;

const BRUSH_VERTEX = `#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_uv = vec2(a_position.x * 0.5 + 0.5, -a_position.y * 0.5 + 0.5);
}
`;

const BRUSH_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_sourceMask;
uniform vec2 u_centerPixel;
uniform float u_radiusPixel;
uniform vec2 u_imageSize;
uniform float u_flow;
uniform float u_feather;
uniform float u_mode;
in vec2 v_uv;
out vec4 outColor;

void main() {
  // Measure distance in image pixels so the brush stamp stays circular even
  // when the mask texture is non-square (e.g. landscape/portrait photos).
  vec2 pixel = v_uv * u_imageSize;
  float dist = distance(pixel, u_centerPixel);
  float innerRadius = u_radiusPixel * (1.0 - u_feather);
  float denom = max(u_radiusPixel - innerRadius, 0.0001);
  float d = clamp((dist - innerRadius) / denom, 0.0, 1.0);
  // Gaussian falloff: density stays solid near the center and asymptotically
  // collapses toward the brush edge, making the rim extremely soft.
  float alpha = exp(-4.0 * d * d);
  // The source mask is a rendered texture, stored with the origin at the
  // bottom-left; flip v so reads stay in the same screen space as writes.
  float current = texture(u_sourceMask, vec2(v_uv.x, 1.0 - v_uv.y)).r;
  // Exponential asymptotic buildup: each stamp closes a fraction of the
  // remaining distance to the limit. This makes 100% density unreachable
  // and keeps repeated brush edges feathering smoothly instead of clipping.
  float decay = exp(-u_flow * alpha);
  float next;
  if (u_mode > 0.0) {
    next = 1.0 - (1.0 - current) * decay;
  } else {
    next = current * decay;
  }
  outColor = vec4(next, 0.0, 0.0, 1.0);
}
`;

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error(`Failed to create shader of type ${type}`);
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader) || 'unknown error';
    gl.deleteShader(shader);
    throw new Error(`Shader compile error: ${info}`);
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string): WebGLProgram {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!program) {
    throw new Error('Failed to create WebGL program');
  }
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program) || 'unknown error';
    gl.deleteProgram(program);
    throw new Error(`Program link error: ${info}`);
  }
  return program;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}

export class DodgeBurnRenderer {
  private canvas: HTMLCanvasElement;
  private baseImageUrl: string;
  private effectImageUrl: string;
  private maskDataUrl: string | null | undefined;

  private gl: WebGL2RenderingContext | null = null;

  private compositorProgram: WebGLProgram | null = null;
  private brushProgram: WebGLProgram | null = null;

  private compositorUniforms: {
    base: WebGLUniformLocation | null;
    effect: WebGLUniformLocation | null;
    mask: WebGLUniformLocation | null;
    opacity: WebGLUniformLocation | null;
    overlay: WebGLUniformLocation | null;
  } = { base: null, effect: null, mask: null, opacity: null, overlay: null };

  private brushUniforms: {
    sourceMask: WebGLUniformLocation | null;
    centerPixel: WebGLUniformLocation | null;
    radiusPixel: WebGLUniformLocation | null;
    imageSize: WebGLUniformLocation | null;
    flow: WebGLUniformLocation | null;
    feather: WebGLUniformLocation | null;
    mode: WebGLUniformLocation | null;
  } = {
    sourceMask: null,
    centerPixel: null,
    radiusPixel: null,
    imageSize: null,
    flow: null,
    feather: null,
    mode: null,
  };

  private positionBuffer: WebGLBuffer | null = null;
  private vao: WebGLVertexArrayObject | null = null;

  private baseTexture: WebGLTexture | null = null;
  private effectTexture: WebGLTexture | null = null;
  private maskTextureA: WebGLTexture | null = null;
  private maskTextureB: WebGLTexture | null = null;
  private currentMaskTexture: WebGLTexture | null = null;

  private framebufferA: WebGLFramebuffer | null = null;
  private framebufferB: WebGLFramebuffer | null = null;

  private imageSize: Size = { width: 0, height: 0 };
  private overlayVisible = false;
  private opacity = 1;
  private canvasSize: Size = { width: 0, height: 0 };

  private lastBrushPosition: { x: number; y: number } | null = null;
  private destroyed = false;
  private contextLost = false;

  constructor(canvas: HTMLCanvasElement, baseImageUrl: string, effectImageUrl: string, maskDataUrl?: string | null) {
    this.canvas = canvas;
    this.baseImageUrl = baseImageUrl;
    this.effectImageUrl = effectImageUrl;
    this.maskDataUrl = maskDataUrl ?? null;
  }

  async updateBaseTexture(baseImageUrl: string): Promise<void> {
    const gl = this.gl;
    if (!gl || this.destroyed) return;
    const image = await loadImage(baseImageUrl);
    if (this.baseTexture) {
      gl.deleteTexture(this.baseTexture);
    }
    this.baseTexture = this.createColorTexture(gl, image);
    this.baseImageUrl = baseImageUrl;
  }

  async updateEffectTexture(effectImageUrl: string): Promise<void> {
    const gl = this.gl;
    if (!gl || this.destroyed) return;
    const image = await loadImage(effectImageUrl);
    if (this.effectTexture) {
      gl.deleteTexture(this.effectTexture);
    }
    this.effectTexture = this.createColorTexture(gl, image);
    this.effectImageUrl = effectImageUrl;
  }

  async init(): Promise<void> {
    if (this.destroyed) {
      throw new Error('Renderer has been destroyed');
    }

    const gl = this.canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
    });
    if (!gl) {
      throw new Error('WebGL2 not available');
    }
    this.gl = gl;

    this.canvas.addEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.addEventListener('webglcontextrestored', this.handleContextRestored);

    this.compositorProgram = createProgram(gl, COMPOSITOR_VERTEX, COMPOSITOR_FRAGMENT);
    this.brushProgram = createProgram(gl, BRUSH_VERTEX, BRUSH_FRAGMENT);

    this.compositorUniforms = {
      base: gl.getUniformLocation(this.compositorProgram, 'u_base'),
      effect: gl.getUniformLocation(this.compositorProgram, 'u_effect'),
      mask: gl.getUniformLocation(this.compositorProgram, 'u_mask'),
      opacity: gl.getUniformLocation(this.compositorProgram, 'u_opacity'),
      overlay: gl.getUniformLocation(this.compositorProgram, 'u_overlay'),
    };

    this.brushUniforms = {
      sourceMask: gl.getUniformLocation(this.brushProgram, 'u_sourceMask'),
      centerPixel: gl.getUniformLocation(this.brushProgram, 'u_centerPixel'),
      radiusPixel: gl.getUniformLocation(this.brushProgram, 'u_radiusPixel'),
      imageSize: gl.getUniformLocation(this.brushProgram, 'u_imageSize'),
      flow: gl.getUniformLocation(this.brushProgram, 'u_flow'),
      feather: gl.getUniformLocation(this.brushProgram, 'u_feather'),
      mode: gl.getUniformLocation(this.brushProgram, 'u_mode'),
    };

    this.positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    const [baseImage, effectImage] = await Promise.all([loadImage(this.baseImageUrl), loadImage(this.effectImageUrl)]);

    this.imageSize = { width: baseImage.width, height: baseImage.height };

    this.baseTexture = this.createColorTexture(gl, baseImage);
    this.effectTexture = this.createColorTexture(gl, effectImage);

    this.maskTextureA = this.createR8Texture(gl, baseImage.width, baseImage.height);
    this.maskTextureB = this.createR8Texture(gl, baseImage.width, baseImage.height);

    this.framebufferA = this.createFramebuffer(gl, this.maskTextureA);
    this.framebufferB = this.createFramebuffer(gl, this.maskTextureB);

    this.currentMaskTexture = this.maskTextureA;

    if (this.maskDataUrl) {
      await this.loadMaskTexture(this.maskDataUrl);
    } else {
      this.clearMaskTexture(this.currentMaskTexture);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private createColorTexture(gl: WebGL2RenderingContext, image: HTMLImageElement): WebGLTexture {
    const texture = gl.createTexture();
    if (!texture) {
      throw new Error('Failed to create texture');
    }
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return texture;
  }

  private createR8Texture(gl: WebGL2RenderingContext, width: number, height: number): WebGLTexture {
    const texture = gl.createTexture();
    if (!texture) {
      throw new Error('Failed to create mask texture');
    }
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return texture;
  }

  private createFramebuffer(gl: WebGL2RenderingContext, texture: WebGLTexture): WebGLFramebuffer {
    const framebuffer = gl.createFramebuffer();
    if (!framebuffer) {
      throw new Error('Failed to create framebuffer');
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`Framebuffer incomplete: 0x${status.toString(16)}`);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return framebuffer;
  }

  private clearMaskTexture(texture: WebGLTexture): void {
    const gl = this.gl;
    if (!gl) return;
    const framebuffer = gl.createFramebuffer();
    if (!framebuffer) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.deleteFramebuffer(framebuffer);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  async loadMaskTexture(maskDataUrl: string | null): Promise<void> {
    const gl = this.gl;
    if (!gl || !this.currentMaskTexture) return;

    if (!maskDataUrl) {
      this.clearMaskTexture(this.currentMaskTexture);
      return;
    }

    const image = await loadImage(maskDataUrl);
    const canvas = document.createElement('canvas');
    canvas.width = this.imageSize.width;
    canvas.height = this.imageSize.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to create 2D context for mask decode');
    }
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    // The saved mask is a conventional top-down image, but the live mask
    // texture is rendered bottom-up (standard OpenGL framebuffer layout).
    // The compositor/brush shaders compensate with 1.0 - v_uv.y, so we must
    // upload the loaded mask in the same bottom-up memory order.
    const srcData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const width = canvas.width;
    const height = canvas.height;
    const pixels = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      const srcRow = y * width * 4;
      const dstRow = (height - 1 - y) * width;
      for (let x = 0; x < width; x++) {
        pixels[dstRow + x] = srcData[srcRow + x * 4];
      }
    }

    gl.bindTexture(gl.TEXTURE_2D, this.currentMaskTexture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, pixels);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  resize(width: number, height: number): void {
    this.canvasSize = { width, height };
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.canvas.width = width;
    this.canvas.height = height;
    if (this.gl) {
      this.gl.viewport(0, 0, width, height);
    }
  }

  setOverlayVisible(visible: boolean): void {
    this.overlayVisible = visible;
  }

  setOpacity(opacity: number): void {
    this.opacity = Math.max(0, Math.min(1, opacity));
  }

  private getReadMask(): WebGLTexture {
    return this.currentMaskTexture!;
  }

  private getWriteFramebuffer(): WebGLFramebuffer {
    return this.currentMaskTexture === this.maskTextureA ? this.framebufferB! : this.framebufferA!;
  }

  private swapMask(): void {
    this.currentMaskTexture = this.currentMaskTexture === this.maskTextureA ? this.maskTextureB : this.maskTextureA;
  }

  private screenToUv(screenX: number, screenY: number): { u: number; v: number } | null {
    if (this.canvasSize.width <= 0 || this.canvasSize.height <= 0) {
      return null;
    }
    const u = screenX / this.canvasSize.width;
    const v = screenY / this.canvasSize.height;
    return { u, v };
  }

  resetBrushPosition(): void {
    this.lastBrushPosition = null;
  }

  paintBrush(screenX: number, screenY: number, size: number, feather: number, flow: number, mode: BrushMode): void {
    const gl = this.gl;
    if (!gl || !this.compositorProgram || !this.brushProgram || this.contextLost) return;

    if (this.lastBrushPosition && this.lastBrushPosition.x === screenX && this.lastBrushPosition.y === screenY) {
      return;
    }

    const points: Array<{ x: number; y: number }> = [];
    if (!this.lastBrushPosition) {
      points.push({ x: screenX, y: screenY });
      this.lastBrushPosition = { x: screenX, y: screenY };
    } else {
      const dx = screenX - this.lastBrushPosition.x;
      const dy = screenY - this.lastBrushPosition.y;
      const distance = Math.hypot(dx, dy);

      // Space stamps tightly (3% of brush size, min 2 px) so overlapping stamps
      // produce a smooth, flat wash instead of onion rings from sparse stamps.
      const spacing = Math.max(2, size * 0.03);
      if (distance < spacing) {
        return;
      }

      const dirX = dx / distance;
      const dirY = dy / distance;
      const steps = Math.max(1, Math.floor(distance / spacing));
      for (let i = 1; i <= steps; i++) {
        points.push({
          x: this.lastBrushPosition.x + dirX * spacing * i,
          y: this.lastBrushPosition.y + dirY * spacing * i,
        });
      }

      this.lastBrushPosition = {
        x: this.lastBrushPosition.x + dirX * spacing * steps,
        y: this.lastBrushPosition.y + dirY * spacing * steps,
      };
    }

    if (points.length === 0) return;

    if (this.canvasSize.width <= 0 || this.canvasSize.height <= 0) return;

    // The overlay canvas and the mask texture share the same aspect ratio but
    // may differ in resolution. Convert the screen-space brush size to image
    // pixels once; the shader then works in pixel space so stamps are circular.
    const imageScale = this.imageSize.width / this.canvasSize.width;
    const radiusPixel = (size / 2) * imageScale;

    if (radiusPixel <= 0) return;

    const softFeather = Math.max(0, Math.min(1, feather / 100));
    // Flow slider is 0.1-10. Tight stamp spacing (3% of brush size) means each
    // individual stamp contributes less; scale flow down so the overall buildup
    // rate stays comfortable and the mask remains asymptotic near 100%.
    const flowAlpha = Math.max(0, Math.min(1, flow / 200));
    const modeValue = mode === 'add' ? 1 : -1;

    for (const point of points) {
      const uv = this.screenToUv(point.x, point.y);
      if (!uv) continue;

      const readTexture = this.getReadMask();
      const writeFramebuffer = this.getWriteFramebuffer();

      gl.bindFramebuffer(gl.FRAMEBUFFER, writeFramebuffer);
      gl.viewport(0, 0, this.imageSize.width, this.imageSize.height);

      gl.useProgram(this.brushProgram);
      gl.bindVertexArray(this.vao);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, readTexture);
      gl.uniform1i(this.brushUniforms.sourceMask, 0);

      gl.uniform2f(this.brushUniforms.imageSize, this.imageSize.width, this.imageSize.height);
      gl.uniform2f(this.brushUniforms.centerPixel, uv.u * this.imageSize.width, uv.v * this.imageSize.height);
      gl.uniform1f(this.brushUniforms.radiusPixel, radiusPixel);
      gl.uniform1f(this.brushUniforms.flow, flowAlpha);
      gl.uniform1f(this.brushUniforms.feather, softFeather);
      gl.uniform1f(this.brushUniforms.mode, modeValue);

      gl.drawArrays(gl.TRIANGLES, 0, 3);

      this.swapMask();
    }

    this.render();
  }

  render(): void {
    const gl = this.gl;
    if (!gl || !this.compositorProgram || this.contextLost) return;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvasSize.width, this.canvasSize.height);

    gl.useProgram(this.compositorProgram);
    gl.bindVertexArray(this.vao);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.baseTexture);
    gl.uniform1i(this.compositorUniforms.base, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.effectTexture);
    gl.uniform1i(this.compositorUniforms.effect, 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.getReadMask());
    gl.uniform1i(this.compositorUniforms.mask, 2);

    gl.uniform1f(this.compositorUniforms.opacity, this.opacity);
    gl.uniform1f(this.compositorUniforms.overlay, this.overlayVisible ? 1 : 0);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  getMaskBlob(): Promise<Blob> {
    const gl = this.gl;
    if (!gl || !this.imageSize.width || !this.imageSize.height) {
      return Promise.reject(new Error('Renderer not initialized'));
    }

    const framebuffer = gl.createFramebuffer();
    if (!framebuffer) {
      return Promise.reject(new Error('Failed to create read framebuffer'));
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.getReadMask(), 0);

    const width = this.imageSize.width;
    const height = this.imageSize.height;
    const pixels = new Uint8Array(width * height);
    gl.readPixels(0, 0, width, height, gl.RED, gl.UNSIGNED_BYTE, pixels);

    gl.deleteFramebuffer(framebuffer);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return Promise.reject(new Error('Failed to create 2D context'));
    }

    const imageData = ctx.createImageData(width, height);
    for (let y = 0; y < height; y++) {
      const srcY = height - 1 - y;
      for (let x = 0; x < width; x++) {
        const srcIndex = srcY * width + x;
        const dstIndex = y * width + x;
        const value = pixels[srcIndex];
        imageData.data[dstIndex * 4] = value;
        imageData.data[dstIndex * 4 + 1] = value;
        imageData.data[dstIndex * 4 + 2] = value;
        imageData.data[dstIndex * 4 + 3] = 255;
      }
    }
    ctx.putImageData(imageData, 0, 0);

    return new Promise((resolve, reject) => {
      const tryToBlob = (type: string, quality?: number) => {
        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else if (type === 'image/webp') {
              tryToBlob('image/png');
            } else {
              reject(new Error('Failed to create mask blob'));
            }
          },
          type,
          quality,
        );
      };
      tryToBlob('image/webp', 0.7);
    });
  }

  destroy(): void {
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);

    const gl = this.gl;
    if (gl) {
      if (this.framebufferA) gl.deleteFramebuffer(this.framebufferA);
      if (this.framebufferB) gl.deleteFramebuffer(this.framebufferB);
      if (this.maskTextureA) gl.deleteTexture(this.maskTextureA);
      if (this.maskTextureB) gl.deleteTexture(this.maskTextureB);
      if (this.baseTexture) gl.deleteTexture(this.baseTexture);
      if (this.effectTexture) gl.deleteTexture(this.effectTexture);
      if (this.positionBuffer) gl.deleteBuffer(this.positionBuffer);
      if (this.vao) gl.deleteVertexArray(this.vao);
      if (this.compositorProgram) gl.deleteProgram(this.compositorProgram);
      if (this.brushProgram) gl.deleteProgram(this.brushProgram);
    }
    this.gl = null;
    this.framebufferA = null;
    this.framebufferB = null;
    this.maskTextureA = null;
    this.maskTextureB = null;
    this.baseTexture = null;
    this.effectTexture = null;
    this.positionBuffer = null;
    this.vao = null;
    this.compositorProgram = null;
    this.brushProgram = null;
    this.currentMaskTexture = null;
    this.destroyed = true;
  }

  private handleContextLost = (event: Event): void => {
    event.preventDefault();
    this.contextLost = true;
    console.error('[DodgeBurnRenderer] WebGL context lost. Drawing suspended.');
  };

  private handleContextRestored = async (): Promise<void> => {
    try {
      this.destroy();
      this.destroyed = false;
      this.contextLost = false;
      await this.init();
    } catch (error) {
      console.error('[DodgeBurnRenderer] Failed to rebuild after context restore:', error);
    }
  };
}
