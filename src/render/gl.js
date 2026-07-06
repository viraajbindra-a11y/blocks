// Thin WebGL2 helpers: program compilation, VAO setup, texture arrays.

export function createGL(canvas) {
  // MSAA off: nearest-filtered voxel art gains little from it, and it
  // roughly doubles GPU bandwidth at high DPR.
  const gl = canvas.getContext('webgl2', {
    antialias: false,
    alpha: false,
    depth: true,
    stencil: false,
    powerPreference: 'high-performance',
  });
  if (!gl) throw new Error('WebGL2 is not supported by this browser.');
  return gl;
}

export function compileProgram(gl, vsSrc, fsSrc, name = 'shader') {
  const make = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error(`${name} ${type === gl.VERTEX_SHADER ? 'VS' : 'FS'}: ${gl.getShaderInfoLog(s)}`);
    }
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, make(gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(p, make(gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(`${name} link: ${gl.getProgramInfoLog(p)}`);
  }
  // Uniform location cache
  const uniforms = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    uniforms[info.name.replace('[0]', '')] = gl.getUniformLocation(p, info.name);
  }
  return { program: p, u: uniforms };
}

/**
 * Interleaved-float VAO. attribs: [[location, size], ...]
 * Data layout must match order & total stride.
 */
export function createMeshVAO(gl, attribs, vertexData, indexData, dynamic = false) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, vertexData, dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
  const stride = attribs.reduce((s, a) => s + a[1], 0) * 4;
  let offset = 0;
  for (const [loc, size] of attribs) {
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset);
    offset += size * 4;
  }
  let ibo = null, count = vertexData.length / (stride / 4);
  if (indexData) {
    ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indexData, dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
    count = indexData.length;
  }
  gl.bindVertexArray(null);
  return { vao, vbo, ibo, count };
}

export function disposeMesh(gl, mesh) {
  if (!mesh) return;
  if (mesh.vbo) gl.deleteBuffer(mesh.vbo);
  if (mesh.ibo) gl.deleteBuffer(mesh.ibo);
  if (mesh.vao) gl.deleteVertexArray(mesh.vao);
}

/**
 * Build a 2D texture array from atlas pixel data.
 * layers: array of ImageData-like {data: Uint8ClampedArray, width, height}
 */
export function createTextureArray(gl, layers, size = 16) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
  const count = layers.length;
  const levels = 1 + Math.floor(Math.log2(size));
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, levels, gl.RGBA8, size, size, count);
  for (let i = 0; i < count; i++) {
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, size, size, 1,
      gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(layers[i].data.buffer));
  }
  gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
  return tex;
}
