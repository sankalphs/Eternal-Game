// WebGL post-processing: takes the 2D game canvas as a texture and applies
// bloom (bright areas glow), chromatic aberration (RGB channel split on impact),
// and vignette via a fragment shader. Rendered on a separate overlay canvas.

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const FRAG = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform float uBloom;     // 0..1 bloom intensity
uniform float uChromAb;   // 0..1 chromatic aberration amount
uniform float uVignette;  // 0..1 vignette darkness
uniform vec2  uTexel;     // 1/textureSize

// simple 3x3 gaussian blur for bloom
vec3 blur(vec2 uv, vec2 dir) {
  vec3 c = vec3(0.0);
  c += texture2D(uTex, uv + dir * 1.0).rgb * 0.25;
  c += texture2D(uTex, uv + dir * 2.0).rgb * 0.20;
  c += texture2D(uTex, uv + dir * 3.0).rgb * 0.15;
  c += texture2D(uTex, uv + dir * 4.0).rgb * 0.10;
  c += texture2D(uTex, uv - dir * 1.0).rgb * 0.25;
  c += texture2D(uTex, uv - dir * 2.0).rgb * 0.20;
  c += texture2D(uTex, uv - dir * 3.0).rgb * 0.15;
  c += texture2D(uTex, uv - dir * 4.0).rgb * 0.10;
  return c;
}

void main() {
  vec2 uv = vUv;
  // chromatic aberration: offset RGB channels
  float ca = uChromAb * 0.004;
  float r = texture2D(uTex, uv + vec2(ca, 0.0)).r;
  float g = texture2D(uTex, uv).g;
  float b = texture2D(uTex, uv - vec2(ca, 0.0)).b;
  vec3 color = vec3(r, g, b);

  // bloom: sample bright areas, blur them, add back
  if (uBloom > 0.0) {
    vec3 bright = max(color - 0.6, 0.0);
    vec3 bloomH = blur(uv, vec2(uTexel.x, 0.0));
    vec3 bloomV = blur(uv, vec2(0.0, uTexel.y));
    vec3 glow = (bloomH + bloomV) * 0.5;
    color += glow * uBloom * 0.8;
  }

  // vignette: darken edges
  vec2 d = uv - 0.5;
  float vig = 1.0 - dot(d, d) * uVignette * 1.2;
  color *= vig;

  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

export class PostFX {
  private gl: WebGLRenderingContext | null = null;
  private canvas: HTMLCanvasElement;
  private program: WebGLProgram | null = null;
  private texture: WebGLTexture | null = null;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private enabled = true;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl", {
      premultipliedAlpha: false,
      alpha: false,
    });
    if (!gl) {
      this.enabled = false;
      return;
    }
    this.gl = gl;

    // compile shaders
    const vs = this.compile(gl.VERTEX_SHADER, VERT);
    const fs = this.compile(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) {
      this.enabled = false;
      return;
    }
    const prog = gl.createProgram();
    if (!prog) {
      this.enabled = false;
      return;
    }
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      this.enabled = false;
      return;
    }
    this.program = prog;

    // full-screen quad
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const loc = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    // texture
    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    // uniform locations
    gl.useProgram(prog);
    this.uniforms.uTex = gl.getUniformLocation(prog, "uTex");
    this.uniforms.uBloom = gl.getUniformLocation(prog, "uBloom");
    this.uniforms.uChromAb = gl.getUniformLocation(prog, "uChromAb");
    this.uniforms.uVignette = gl.getUniformLocation(prog, "uVignette");
    this.uniforms.uTexel = gl.getUniformLocation(prog, "uTexel");
    gl.uniform1i(this.uniforms.uTex, 0);
  }

  private compile(type: number, src: string): WebGLShader | null {
    const gl = this.gl;
    if (!gl) return null;
    const s = gl.createShader(type);
    if (!s) return null;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) return null;
    return s;
  }

  get isAvailable(): boolean {
    return this.enabled;
  }

  /** Render the source canvas through the shader onto this canvas. */
  render(
    source: HTMLCanvasElement,
    bloom: number,
    chromAb: number,
    vignette: number,
  ) {
    const gl = this.gl;
    if (!gl || !this.enabled || !this.program || !this.texture) return;

    // resize canvas to match source
    const w = source.width;
    const h = source.height;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    gl.viewport(0, 0, w, h);

    // upload source canvas as texture (flip Y so it's not upside-down)
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);

    // set uniforms
    gl.uniform1f(this.uniforms.uBloom, bloom);
    gl.uniform1f(this.uniforms.uChromAb, chromAb);
    gl.uniform1f(this.uniforms.uVignette, vignette);
    gl.uniform2f(this.uniforms.uTexel, 1 / w, 1 / h);

    // draw
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
