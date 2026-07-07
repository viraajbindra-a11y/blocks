// Renderer: owns the GL context, chunk section meshes, and all draw passes.
// Pass order: sky → opaque terrain (front-to-back, frustum culled) →
// entities → block outline/crack → clouds → translucent terrain
// (back-to-front) → particles → first-person view model.

import {
  CHUNK_X, CHUNK_Z, SECTION_Y, SECTIONS, CHUNK_Y, CLOUD_HEIGHT,
} from '../core/constants.js';
import {
  identity, perspective, multiply, viewFromCamera, frustumPlanes,
  aabbInFrustum, cameraBasis,
} from '../math/mat4.js';
import { createGL, compileProgram, createMeshVAO, disposeMesh, createTextureArray } from './gl.js';
import * as SH from './shaders.js';
import { meshSection, setTextureLayerLookup } from './mesher.js';
import { blockById, faceTexKey } from '../blocks.js';
import { clamp, lerp, smoothstep } from '../math/noise.js';

const CHUNK_ATTRS = [[0, 3], [1, 2], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1]];
const PARTICLE_ATTRS = [[0, 3], [1, 2], [2, 1], [3, 1], [4, 1]];

// ── Day/night environment ─────────────────────────────────────────
// dim: a DIMENSIONS entry; realms with a static env (Smolder, Hollow)
// bypass the day/night computation entirely.
export function computeEnv(timeOfDay, weather = null, dim = null) {
  if (dim && dim.env) {
    const e = dim.env;
    return {
      sunDir: e.sunDir, sunLevel: e.sunLevel, night: e.night, duskW: 0,
      zenith: e.zenith, horizon: e.horizon, skyTint: e.skyTint,
      fogColor: e.fogColor, skyMode: dim.skyMode,
    };
  }
  const ang = (timeOfDay - 0.25) * Math.PI * 2;
  const elev = Math.sin(ang);
  const sunDir = [Math.cos(ang), elev, 0.22];
  const len = Math.hypot(...sunDir);
  sunDir[0] /= len; sunDir[1] /= len; sunDir[2] /= len;

  let sunLevel = smoothstep(-0.1, 0.16, elev);
  const night = 1 - smoothstep(-0.16, 0.02, elev);
  const duskW = Math.max(0, 1 - Math.abs(elev) / 0.24);

  const overcast = weather ? weather.overcast : 0;   // 0..1
  sunLevel *= 1 - overcast * 0.55;

  const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  let zenith = mix3([0.015, 0.02, 0.06], [0.32, 0.55, 0.83], sunLevel);
  let horizon = mix3([0.04, 0.05, 0.1], [0.7, 0.8, 0.88], sunLevel);
  horizon = mix3(horizon, [0.93, 0.52, 0.28], duskW * 0.65 * (1 - night));
  zenith = mix3(zenith, [0.45, 0.35, 0.42], duskW * 0.3 * (1 - night));
  if (overcast > 0) {
    const gray = [0.55 * sunLevel + 0.06, 0.57 * sunLevel + 0.06, 0.6 * sunLevel + 0.08];
    zenith = mix3(zenith, gray, overcast * 0.85);
    horizon = mix3(horizon, gray, overcast * 0.85);
  }
  let skyTint = mix3([0.28, 0.34, 0.5], [1, 1, 1], sunLevel);
  skyTint = mix3(skyTint, [1, 0.78, 0.62], duskW * 0.35 * (1 - night));

  return { sunDir, sunLevel, night, duskW, zenith, horizon, skyTint, fogColor: horizon, skyMode: 0 };
}

export class Renderer {
  constructor(canvas, settings) {
    this.canvas = canvas;
    this.world = null;
    this.settings = settings;
    this.gl = createGL(canvas);

    this.sections = new Map();     // "cx,cz,sy" -> {cx,cz,sy,opaque,translucent}
    this.atlasTex = null;
    this.atlasLayers = null;
    this.layerOf = null;
    this.heldCache = new Map();
    this.particleMesh = null;
    this.contextLost = false;

    this.proj = identity();
    this.view = identity();
    this.projView = identity();
    this.planes = [];
    this.stats = { sections: 0, drawn: 0, tris: 0, meshMs: 0 };

    this._initGL();

    // GPU resets / driver hiccups: drop everything, rebuild on restore.
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
      console.warn('BLOCKS: WebGL context lost — waiting for restore');
    });
    canvas.addEventListener('webglcontextrestored', () => {
      console.warn('BLOCKS: WebGL context restored — rebuilding GPU resources');
      this._restoreContext();
    });
  }

  _initGL() {
    const gl = this.gl;
    this.chunkProg = compileProgram(gl, SH.CHUNK_VS, SH.CHUNK_FS, 'chunk');
    this.skyProg = compileProgram(gl, SH.SKY_VS, SH.SKY_FS, 'sky');
    this.cloudProg = compileProgram(gl, SH.CLOUD_VS, SH.CLOUD_FS, 'cloud');
    this.lineProg = compileProgram(gl, SH.LINE_VS, SH.LINE_FS, 'line');
    this.crackProg = compileProgram(gl, SH.CRACK_VS, SH.CRACK_FS, 'crack');
    this.particleProg = compileProgram(gl, SH.PARTICLE_VS, SH.PARTICLE_FS, 'particle');
    this.entityProg = compileProgram(gl, SH.ENTITY_VS, SH.ENTITY_FS, 'entity');
    this._initStaticGeometry();
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);
    gl.clearColor(0.05, 0.06, 0.1, 1);
  }

  _restoreContext() {
    this.contextLost = false;
    // Old GL objects died with the context; just forget the handles.
    this.sections.clear();
    this.heldCache.clear();
    this.particleMesh = null;
    this._initGL();
    if (this.atlasLayers) {
      this.atlasTex = createTextureArray(this.gl, this.atlasLayers, 16);
    }
    this.remeshAll();
  }

  // Queue every loaded chunk for re-meshing (context restore / renderer swap).
  remeshAll() {
    if (!this.world) return;
    for (const c of this.world.chunks.values()) {
      if (c.meshReady) {
        for (let sy = 0; sy < SECTIONS; sy++) {
          this.world.meshDirty.add(`${c.cx},${c.cz},${sy}`);
        }
      }
    }
  }

  // Swap worlds without recreating the GL context (contexts are scarce).
  attachWorld(world) {
    for (const rec of this.sections.values()) {
      disposeMesh(this.gl, rec.opaque);
      disposeMesh(this.gl, rec.translucent);
    }
    this.sections.clear();
    this.world = world;
    if (world) world.onChunkUnload = (chunk) => this.dropChunk(chunk.cx, chunk.cz);
  }

  setAtlas(layers, layerOf) {
    this.layerOf = layerOf;
    this.atlasLayers = layers;
    setTextureLayerLookup(layerOf);
    this.atlasTex = createTextureArray(this.gl, layers, 16);
  }

  _initStaticGeometry() {
    const gl = this.gl;
    // Fullscreen triangle for the sky
    this.skyGeo = createMeshVAO(gl, [[0, 2]],
      new Float32Array([-1, -1, 3, -1, -1, 3]), null);
    // Cloud quad
    this.cloudGeo = createMeshVAO(gl, [[0, 2]],
      new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]),
      new Uint32Array([0, 1, 2, 0, 2, 3]));
    // Outline cube (lines)
    const e = 0.002, lo = -e, hi = 1 + e;
    const C = [[lo,lo,lo],[hi,lo,lo],[hi,lo,hi],[lo,lo,hi],[lo,hi,lo],[hi,hi,lo],[hi,hi,hi],[lo,hi,hi]];
    const edges = [0,1,1,2,2,3,3,0,4,5,5,6,6,7,7,4,0,4,1,5,2,6,3,7];
    const lineVerts = new Float32Array(edges.length * 3);
    edges.forEach((ci, i) => lineVerts.set(C[ci], i * 3));
    this.outlineGeo = createMeshVAO(gl, [[0, 3]], lineVerts, null);
    // Crack cube: 6 faces with 0..1 UVs
    const cv = [], cidx = [];
    const faces = [
      [[1,0,0],[1,1,0],[1,1,1],[1,0,1]], [[0,0,1],[0,1,1],[0,1,0],[0,0,0]],
      [[0,1,0],[0,1,1],[1,1,1],[1,1,0]], [[0,0,0],[1,0,0],[1,0,1],[0,0,1]],
      [[0,0,1],[1,0,1],[1,1,1],[0,1,1]], [[1,0,0],[0,0,0],[0,1,0],[1,1,0]],
    ];
    const fuv = [[0, 1], [1, 1], [1, 0], [0, 0]];
    faces.forEach((f, fi) => {
      const b = fi * 4;
      f.forEach((p, i) => cv.push(...p, ...fuv[i]));
      cidx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    });
    this.crackGeo = createMeshVAO(gl, [[0, 3], [1, 2]],
      new Float32Array(cv), new Uint32Array(cidx));
    // Entity unit cube with per-face shade
    const shades = [0.78, 0.78, 1.0, 0.5, 0.66, 0.66];
    const ev = [], eidx = [];
    faces.forEach((f, fi) => {
      const b = fi * 4;
      f.forEach((p) => ev.push(p[0] - 0.5, p[1] - 0.5, p[2] - 0.5, shades[fi]));
      eidx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    });
    this.entityCube = createMeshVAO(gl, [[0, 3], [1, 1]],
      new Float32Array(ev), new Uint32Array(eidx));
    // Dynamic particle buffers created lazily
  }

  // ── Section mesh management ─────────────────────────────────────
  meshTick(camX, camZ, budgetMs = 5) {
    const world = this.world;
    if (!world || this.contextLost || world.meshDirty.size === 0) return;
    const t0 = performance.now();
    const pcx = Math.floor(camX / 16), pcz = Math.floor(camZ / 16);
    const entries = [...world.meshDirty].map((key) => {
      const [cx, cz, sy] = key.split(',').map(Number);
      const d = (cx - pcx) * (cx - pcx) + (cz - pcz) * (cz - pcz);
      return { key, cx, cz, sy, d };
    }).sort((a, b) => a.d - b.d);
    for (const ent of entries) {
      if (performance.now() - t0 > budgetMs) break;
      world.meshDirty.delete(ent.key);
      const chunk = world.chunkAt(ent.cx, ent.cz);
      if (!chunk || !chunk.meshReady) continue;
      this._buildSection(ent.cx, ent.sy, ent.cz, ent.key);
    }
    this.stats.meshMs = performance.now() - t0;
  }

  _buildSection(cx, sy, cz, key) {
    const gl = this.gl;
    const geo = meshSection(this.world, cx, sy, cz);
    let rec = this.sections.get(key);
    if (rec) {
      disposeMesh(gl, rec.opaque); disposeMesh(gl, rec.translucent);
      rec.opaque = rec.translucent = null;
    } else {
      rec = { cx, cz, sy, opaque: null, translucent: null };
      this.sections.set(key, rec);
    }
    if (geo.opaque) rec.opaque = createMeshVAO(gl, CHUNK_ATTRS, geo.opaque.vertices, geo.opaque.indices);
    if (geo.translucent) rec.translucent = createMeshVAO(gl, CHUNK_ATTRS, geo.translucent.vertices, geo.translucent.indices);
    if (!rec.opaque && !rec.translucent) this.sections.delete(key);
  }

  dropChunk(cx, cz) {
    for (let sy = 0; sy < SECTIONS; sy++) {
      const key = `${cx},${cz},${sy}`;
      const rec = this.sections.get(key);
      if (rec) {
        disposeMesh(this.gl, rec.opaque);
        disposeMesh(this.gl, rec.translucent);
        this.sections.delete(key);
      }
    }
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.floor(this.canvas.clientWidth * dpr);
    const h = Math.floor(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
    }
    this.gl.viewport(0, 0, w, h);
  }

  // ── Frame ───────────────────────────────────────────────────────
  /**
   * state: {camera:{x,y,z,yaw,pitch,fov}, timeOfDay, weather, underwater,
   *         target, breakProgress, entities, particles, held, swing,
   *         renderDistance, cloudCover}
   */
  render(state) {
    if (this.contextLost) return;
    const gl = this.gl;
    this.resize();
    const cam = state.camera;
    const env = computeEnv(state.timeOfDay, state.weather, state.dim);
    this.env = env;

    const rd = state.renderDistance * CHUNK_X;
    let fogStart = rd * 0.68, fogEnd = rd - 6;
    let fogColor = env.fogColor;
    if (state.underwater === 'water') {
      fogStart = 1; fogEnd = 26;
      fogColor = [0.03 + 0.1 * env.sunLevel, 0.1 + 0.16 * env.sunLevel, 0.2 + 0.22 * env.sunLevel];
    } else if (state.underwater === 'lava') {
      fogStart = 0; fogEnd = 2.4;
      fogColor = [0.55, 0.18, 0.03];
    }

    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    perspective(this.proj, cam.fov * Math.PI / 180, aspect, 0.06, rd + 96);
    viewFromCamera(this.view, [cam.x, cam.y, cam.z], cam.yaw, cam.pitch);
    multiply(this.projView, this.proj, this.view);
    frustumPlanes(this.projView, this.planes);

    gl.clearColor(fogColor[0], fogColor[1], fogColor[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    this._drawSky(cam, env, state);
    const visible = this._cullSections(cam, state.renderDistance);
    this._drawTerrain(visible, cam, env, state, fogStart, fogEnd, fogColor, false);
    if (state.entities && state.entities.length) {
      this._drawEntities(state.entities, cam, env, fogStart, fogEnd, fogColor);
    }
    if (state.target) this._drawTargetDecor(state);
    this._drawClouds(cam, env, state);
    this._drawTerrain(visible, cam, env, state, fogStart, fogEnd, fogColor, true);
    if (state.particles) this._drawParticles(state.particles, cam);
    if (state.held) this._drawViewModel(state, env);
  }

  _cullSections(cam, renderDistance) {
    const out = [];
    const pcx = Math.floor(cam.x / 16), pcz = Math.floor(cam.z / 16);
    for (const rec of this.sections.values()) {
      const dx = rec.cx - pcx, dz = rec.cz - pcz;
      if (dx * dx + dz * dz > renderDistance * renderDistance + 2) continue;
      const wx = rec.cx * 16, wy = rec.sy * 16, wz = rec.cz * 16;
      if (!aabbInFrustum(this.planes, wx, wy, wz, wx + 16, wy + 16, wz + 16)) continue;
      rec.dist = dx * dx + dz * dz + Math.pow((wy + 8 - cam.y) / 16, 2);
      out.push(rec);
    }
    out.sort((a, b) => a.dist - b.dist);
    this.stats.sections = this.sections.size;
    this.stats.drawn = out.length;
    return out;
  }

  _bindChunkProg(cam, env, state, fogStart, fogEnd, fogColor) {
    const gl = this.gl;
    const p = this.chunkProg;
    gl.useProgram(p.program);
    gl.uniformMatrix4fv(p.u.uProjView, false, this.projView);
    gl.uniform3f(p.u.uEye, cam.x, cam.y, cam.z);
    gl.uniform1f(p.u.uTime, state.time ?? 0);
    gl.uniform1f(p.u.uSunLevel, Math.max(env.sunLevel, 0.02));
    gl.uniform3fv(p.u.uSkyTint, env.skyTint);
    gl.uniform3fv(p.u.uFogColor, fogColor);
    gl.uniform1f(p.u.uFogStart, fogStart);
    gl.uniform1f(p.u.uFogEnd, fogEnd);
    gl.uniform1f(p.u.uLightMul, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.atlasTex);
    gl.uniform1i(p.u.uAtlas, 0);
    return p;
  }

  _drawTerrain(visible, cam, env, state, fogStart, fogEnd, fogColor, translucentPass) {
    const gl = this.gl;
    const p = this._bindChunkProg(cam, env, state, fogStart, fogEnd, fogColor);
    if (translucentPass) {
      gl.uniform1f(p.u.uAlphaCut, 0.02);
      gl.uniform1f(p.u.uAlphaMul, 1);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.disable(gl.CULL_FACE);
      for (let i = visible.length - 1; i >= 0; i--) {
        const rec = visible[i];
        if (!rec.translucent) continue;
        gl.uniform3f(p.u.uOrigin, rec.cx * 16, rec.sy * 16, rec.cz * 16);
        gl.bindVertexArray(rec.translucent.vao);
        gl.drawElements(gl.TRIANGLES, rec.translucent.count, gl.UNSIGNED_INT, 0);
      }
      gl.enable(gl.CULL_FACE);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    } else {
      gl.uniform1f(p.u.uAlphaCut, 0.5);
      gl.uniform1f(p.u.uAlphaMul, 1);
      let tris = 0;
      for (const rec of visible) {
        if (!rec.opaque) continue;
        gl.uniform3f(p.u.uOrigin, rec.cx * 16, rec.sy * 16, rec.cz * 16);
        gl.bindVertexArray(rec.opaque.vao);
        gl.drawElements(gl.TRIANGLES, rec.opaque.count, gl.UNSIGNED_INT, 0);
        tris += rec.opaque.count / 3;
      }
      this.stats.tris = tris;
    }
    gl.bindVertexArray(null);
  }

  _drawSky(cam, env, state) {
    const gl = this.gl;
    const p = this.skyProg;
    gl.useProgram(p.program);
    gl.depthMask(false);
    gl.disable(gl.DEPTH_TEST);
    const basis = cameraBasis(cam.yaw, cam.pitch);
    gl.uniform3fv(p.u.uCamRight, basis.right);
    gl.uniform3fv(p.u.uCamUp, basis.up);
    gl.uniform3fv(p.u.uCamFwd, basis.fwd);
    gl.uniform1f(p.u.uTanHalfFov, Math.tan(cam.fov * Math.PI / 360));
    gl.uniform1f(p.u.uAspect, this.canvas.width / Math.max(1, this.canvas.height));
    gl.uniform3fv(p.u.uSunDir, env.sunDir);
    gl.uniform3fv(p.u.uZenith, env.zenith);
    gl.uniform3fv(p.u.uHorizon, env.horizon);
    gl.uniform1f(p.u.uNight, env.night);
    gl.uniform1f(p.u.uSunVis, env.skyMode === 0 ? 1 : 0);
    gl.uniform1f(p.u.uStarVis, env.skyMode === 1 ? 0 : 1);
    gl.uniform1f(p.u.uTime, state.time ?? 0);
    gl.bindVertexArray(this.skyGeo.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
  }

  _drawClouds(cam, env, state) {
    if (this.settings.get('clouds') === false) return;
    const gl = this.gl;
    const p = this.cloudProg;
    gl.useProgram(p.program);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.uniformMatrix4fv(p.u.uProjView, false, this.projView);
    gl.uniform3f(p.u.uCenter, cam.x, CLOUD_HEIGHT, cam.z);
    gl.uniform1f(p.u.uSize, 640);
    gl.uniform1f(p.u.uTime, state.worldTime ?? state.time ?? 0);
    gl.uniform1f(p.u.uSunLevel, Math.max(env.sunLevel, 0.06));
    gl.uniform1f(p.u.uCover, state.cloudCover ?? 0.34);
    gl.uniform3fv(p.u.uFogColor, env.fogColor);
    gl.bindVertexArray(this.cloudGeo.vao);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
    gl.enable(gl.CULL_FACE);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  _drawTargetDecor(state) {
    const gl = this.gl;
    const t = state.target;
    // Outline
    const lp = this.lineProg;
    gl.useProgram(lp.program);
    gl.uniformMatrix4fv(lp.u.uProjView, false, this.projView);
    gl.uniform3f(lp.u.uOrigin, t.x, t.y, t.z);
    gl.uniform4f(lp.u.uColor, 0.05, 0.05, 0.05, 0.75);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.outlineGeo.vao);
    gl.drawArrays(gl.LINES, 0, this.outlineGeo.count);
    gl.bindVertexArray(null);
    // Crack decal
    if (state.breakProgress > 0) {
      const stage = Math.min(9, Math.floor(state.breakProgress * 10));
      const cp = this.crackProg;
      gl.useProgram(cp.program);
      gl.uniformMatrix4fv(cp.u.uProjView, false, this.projView);
      gl.uniform3f(cp.u.uOrigin, t.x, t.y, t.z);
      gl.uniform1f(cp.u.uLayer, this.layerOf(`crack${stage}`));
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.atlasTex);
      gl.uniform1i(cp.u.uAtlas, 0);
      gl.bindVertexArray(this.crackGeo.vao);
      gl.drawElements(gl.TRIANGLES, this.crackGeo.count, gl.UNSIGNED_INT, 0);
      gl.bindVertexArray(null);
    }
    gl.disable(gl.BLEND);
  }

  _drawParticles(particles, cam) {
    const gl = this.gl;
    const basis = cameraBasis(cam.yaw, cam.pitch);
    const geo = particles.buildGeometry(...basis.right, ...basis.up);
    if (!geo) return;
    if (!this.particleMesh) {
      this.particleMesh = createMeshVAO(gl, PARTICLE_ATTRS, geo.vertices, geo.indices, true);
    } else {
      const m = this.particleMesh;
      gl.bindVertexArray(m.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, m.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, geo.vertices, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geo.indices, gl.DYNAMIC_DRAW);
      m.count = geo.indices.length;
      gl.bindVertexArray(null);
    }
    const p = this.particleProg;
    gl.useProgram(p.program);
    gl.uniformMatrix4fv(p.u.uProjView, false, this.projView);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.atlasTex);
    gl.uniform1i(p.u.uAtlas, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(this.particleMesh.vao);
    gl.drawElements(gl.TRIANGLES, this.particleMesh.count, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
    gl.enable(gl.CULL_FACE);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  // entities: [{parts:[{matrix, color}], light, flash}]
  _drawEntities(entities, cam, env, fogStart, fogEnd, fogColor) {
    const gl = this.gl;
    const p = this.entityProg;
    gl.useProgram(p.program);
    gl.uniformMatrix4fv(p.u.uProjView, false, this.projView);
    gl.uniform3f(p.u.uEye, cam.x, cam.y, cam.z);
    gl.uniform3fv(p.u.uFogColor, fogColor);
    gl.uniform1f(p.u.uFogStart, fogStart);
    gl.uniform1f(p.u.uFogEnd, fogEnd);
    gl.bindVertexArray(this.entityCube.vao);
    for (const e of entities) {
      gl.uniform1f(p.u.uLight, e.light);
      gl.uniform1f(p.u.uFlash, e.flash ?? 0);
      for (const part of e.parts) {
        gl.uniformMatrix4fv(p.u.uModel, false, part.matrix);
        gl.uniform3fv(p.u.uColor, part.color);
        gl.drawElements(gl.TRIANGLES, this.entityCube.count, gl.UNSIGNED_INT, 0);
      }
    }
    gl.bindVertexArray(null);
  }

  // First-person held block/tool, drawn in camera space over a cleared depth.
  _drawViewModel(state, env) {
    const gl = this.gl;
    const held = state.held;   // {kind:'block', blockId} | {kind:'sprite', texKey}
    const geo = this._heldGeometry(held);
    if (!geo) return;
    gl.clear(gl.DEPTH_BUFFER_BIT);
    const p = this.chunkProg;
    gl.useProgram(p.program);
    gl.uniformMatrix4fv(p.u.uProjView, false, this.proj);
    gl.uniform3f(p.u.uEye, 0, 0, 0);
    gl.uniform1f(p.u.uTime, 0);
    gl.uniform1f(p.u.uSunLevel, Math.max(env.sunLevel, 0.02));
    gl.uniform3fv(p.u.uSkyTint, env.skyTint);
    gl.uniform3fv(p.u.uFogColor, env.fogColor);
    gl.uniform1f(p.u.uFogStart, 900);
    gl.uniform1f(p.u.uFogEnd, 1000);
    gl.uniform1f(p.u.uAlphaCut, 0.5);
    gl.uniform1f(p.u.uAlphaMul, 1);
    gl.uniform1f(p.u.uLightMul, Math.max(0.25, state.heldLight ?? 1));
    const sw = Math.sin(Math.min(1, state.swing ?? 0) * Math.PI);
    const bob = state.viewBob ?? 0;
    gl.uniform3f(p.u.uOrigin,
      0.34 - sw * 0.15,
      -0.35 - sw * 0.18 + bob * 0.5,
      -0.62 - sw * 0.08);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.atlasTex);
    gl.uniform1i(p.u.uAtlas, 0);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(geo.vao);
    gl.drawElements(gl.TRIANGLES, geo.count, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
    gl.enable(gl.CULL_FACE);
  }

  _heldGeometry(held) {
    const key = held.kind === 'block' ? `b${held.blockId}` : `s${held.texKey}`;
    let geo = this.heldCache.get(key);
    if (geo) return geo;
    const verts = [], idx = [];
    let vc = 0;
    const pushQuad = (corners, uvs, layer, flags = 8) => {
      for (let i = 0; i < 4; i++) {
        verts.push(...corners[i], ...uvs[i], layer, 15, 0, 3, flags);
      }
      idx.push(vc, vc + 1, vc + 2, vc, vc + 2, vc + 3);
      vc += 4;
    };
    if (held.kind === 'block') {
      const b = blockById(held.blockId);
      const s = 0.2;
      // Rotated mini cube. All SIX faces: swing/bob can expose any of them.
      const rot = (x, y, z) => {   // yaw ~35°, slight tilt
        const a = 0.62, c = Math.cos(a), s2 = Math.sin(a);
        const rx = x * c + z * s2, rz = -x * s2 + z * c;
        const b2 = 0.14, cb = Math.cos(b2), sb = Math.sin(b2);
        return [rx, y * cb - rz * sb, y * sb + rz * cb];
      };
      const faceDefs = [
        { dir: 2, c: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },   // +y
        { dir: 3, c: [[0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1]] },   // -y
        { dir: 5, c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },   // -z
        { dir: 4, c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },   // +z
        { dir: 0, c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },   // +x
        { dir: 1, c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },   // -x
      ];
      const uv = [[0, 1], [1, 1], [1, 0], [0, 0]];
      for (const f of faceDefs) {
        const layer = this.layerOf(faceTexKey(b, f.dir));
        const corners = f.c.map(pc => rot((pc[0] - 0.5) * s, (pc[1] - 0.5) * s, (pc[2] - 0.5) * s));
        pushQuad(corners, uv, layer, (f.dir << 2));
      }
    } else {
      // Sprite items (tools etc.): a stack of layered quads gives the flat
      // art real thickness, so it never vanishes edge-on. Gripped diagonal:
      // slight roll keeps the sprite's own diagonal upright in the fist,
      // and a yaw turn angles the head toward the viewer.
      const layer = this.layerOf(held.texKey);
      const s = 0.42, roll = 0.28, yawA = -0.55;
      const cr = Math.cos(roll), sr = Math.sin(roll);
      const cy = Math.cos(yawA), sy = Math.sin(yawA);
      const rot = (x, y, z) => {
        const rx1 = x * cr - y * sr, ry = x * sr + y * cr;   // roll in-plane
        return [rx1 * cy + z * sy, ry, -rx1 * sy + z * cy];  // then yaw
      };
      const uv = [[0, 1], [1, 1], [1, 0], [0, 0]];
      const LAYERS = 7, T = 0.016;                            // total depth
      for (let i = 0; i < LAYERS; i++) {
        const z = (i / (LAYERS - 1) - 0.5) * T;
        const corners = [
          rot(-s / 2, -s / 2, z), rot(s / 2, -s / 2, z),
          rot(s / 2, s / 2, z), rot(-s / 2, s / 2, z),
        ];
        pushQuad(corners, uv, layer, 8);
      }
    }
    geo = createMeshVAO(this.gl, CHUNK_ATTRS, new Float32Array(verts), new Uint32Array(idx));
    this.heldCache.set(key, geo);
    return geo;
  }
}
