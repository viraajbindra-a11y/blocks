// All GLSL (ES 3.0) shader sources.
//
// Chunk vertex layout (floats): pos(3) uv(2) layer(1) sky(1) blk(1) ao(1) flags(1)
// flags: bit0 = wind sway, bit1 = water wave, bits 2-4 = face direction 0..5

export const CHUNK_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec2 aUV;
layout(location=2) in float aLayer;
layout(location=3) in float aSky;
layout(location=4) in float aBlk;
layout(location=5) in float aAO;
layout(location=6) in float aFlags;

uniform mat4 uProjView;
uniform vec3 uOrigin;
uniform vec3 uEye;
uniform float uTime;

out vec2 vUV;
flat out float vLayer;
out float vAO;
out vec2 vLight;
out float vDist;
flat out float vShade;

const float SHADES[6] = float[6](0.80, 0.80, 1.00, 0.55, 0.68, 0.68);

void main() {
  vec3 pos = aPos + uOrigin;
  int flags = int(aFlags + 0.5);
  if ((flags & 1) != 0) {
    float s = sin(uTime * 1.6 + pos.x * 0.9 + pos.z * 1.15 + pos.y * 0.4) * 0.05;
    pos.x += s; pos.z += s * 0.7;
  }
  if ((flags & 2) != 0) {
    pos.y += sin(uTime * 1.8 + pos.x * 0.8 + pos.z * 0.6) * 0.045 - 0.03;
  }
  int dir = (flags >> 2) & 7;
  vShade = SHADES[dir < 6 ? dir : 0];
  vUV = aUV;
  vLayer = aLayer;
  vAO = aAO / 3.0;
  vLight = vec2(aSky, aBlk) / 15.0;
  vDist = length(pos - uEye);
  gl_Position = uProjView * vec4(pos, 1.0);
}`;

export const CHUNK_FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;

uniform sampler2DArray uAtlas;
uniform float uSunLevel;
uniform vec3 uSkyTint;
uniform vec3 uFogColor;
uniform float uFogStart;
uniform float uFogEnd;
uniform float uAlphaCut;
uniform float uAlphaMul;
uniform float uLightMul;

in vec2 vUV;
flat in float vLayer;
in float vAO;
in vec2 vLight;
in float vDist;
flat in float vShade;

out vec4 fragColor;

void main() {
  vec4 tex = texture(uAtlas, vec3(vUV, vLayer));
  if (tex.a < uAlphaCut) discard;
  float sky = vLight.x * vLight.x * uSunLevel;
  float blk = vLight.y * vLight.y;
  vec3 warm = vec3(1.0, 0.78, 0.52);
  vec3 light = (uSkyTint * sky + warm * blk * 1.15) * uLightMul;
  light = max(light, vec3(0.05, 0.05, 0.07));
  float ao = mix(0.52, 1.0, vAO);
  vec3 col = tex.rgb * light * ao * vShade;
  float fog = smoothstep(uFogStart, uFogEnd, vDist);
  col = mix(col, uFogColor, fog);
  fragColor = vec4(col, tex.a * uAlphaMul);
}`;

// ── Sky: fullscreen gradient + sun + moon + stars ─────────────────
export const SKY_VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
out vec2 vNdc;
void main() { vNdc = aPos; gl_Position = vec4(aPos, 0.9999, 1.0); }`;

export const SKY_FS = `#version 300 es
precision highp float;
uniform vec3 uCamRight, uCamUp, uCamFwd;
uniform float uTanHalfFov, uAspect;
uniform vec3 uSunDir;
uniform vec3 uZenith, uHorizon;
uniform float uNight;      // 0 day .. 1 night
uniform float uSunVis;     // 0 = realm without sun/moon
uniform float uStarVis;    // 0 = realm without stars
uniform float uTime;
in vec2 vNdc;
out vec4 fragColor;

float hash(vec3 p) {
  p = fract(p * vec3(443.897, 441.423, 437.195));
  p += dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z);
}

void main() {
  vec3 ray = normalize(uCamFwd
    + uCamRight * vNdc.x * uTanHalfFov * uAspect
    + uCamUp * vNdc.y * uTanHalfFov);

  float up = ray.y;
  vec3 sky = mix(uHorizon, uZenith, pow(clamp(up, 0.0, 1.0), 0.55));
  if (up < 0.0) sky = mix(uHorizon, uHorizon * 0.35, clamp(-up * 2.5, 0.0, 1.0));

  // Sun disc + glow
  float sd = dot(ray, uSunDir);
  float disc = smoothstep(0.9993, 0.9997, sd);
  float glow = pow(clamp(sd, 0.0, 1.0), 90.0) * 0.5;
  vec3 sunCol = mix(vec3(1.0, 0.92, 0.75), vec3(1.0, 0.55, 0.25), uNight * 2.0);
  sky += sunCol * (disc * (1.0 - uNight) + glow * (1.0 - uNight)) * uSunVis;

  // Moon (opposite the sun)
  float md = dot(ray, -uSunDir);
  float moon = smoothstep(0.9995, 0.9998, md);
  sky += vec3(0.82, 0.87, 0.95) * moon * uNight * uSunVis;

  // Stars
  if (uNight > 0.05 && up > -0.1 && uStarVis > 0.5) {
    vec3 cell = floor(ray * 220.0);
    float h = hash(cell);
    if (h > 0.9965) {
      float tw = 0.6 + 0.4 * sin(uTime * 2.0 + h * 40.0);
      sky += vec3(0.9) * tw * uNight * smoothstep(0.9965, 0.999, h);
    }
  }
  fragColor = vec4(sky, 1.0);
}`;

// ── Clouds: scrolling procedural layer on a big quad ──────────────
export const CLOUD_VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
uniform mat4 uProjView;
uniform vec3 uCenter;
uniform float uSize;
out vec2 vXZ;
void main() {
  vec3 p = vec3(uCenter.x + aPos.x * uSize, uCenter.y, uCenter.z + aPos.y * uSize);
  vXZ = p.xz;
  gl_Position = uProjView * vec4(p, 1.0);
}`;

export const CLOUD_FS = `#version 300 es
precision highp float;
uniform float uTime;
uniform float uSunLevel;
uniform float uCover;      // 0.3 clear .. 0.65 storm
uniform vec3 uFogColor;
in vec2 vXZ;
out vec4 fragColor;

float hash2(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1, 0)), f.x),
             mix(hash2(i + vec2(0, 1)), hash2(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  vec2 p = vXZ * 0.011 + vec2(uTime * 0.008, uTime * 0.003);
  float n = vnoise(p) * 0.55 + vnoise(p * 2.7 + 13.7) * 0.3 + vnoise(p * 6.1 + 47.0) * 0.15;
  float a = smoothstep(1.0 - uCover, 1.0 - uCover + 0.22, n);
  if (a < 0.01) discard;
  vec3 col = mix(vec3(0.16, 0.17, 0.22), vec3(0.98, 0.98, 1.0), uSunLevel);
  fragColor = vec4(col, a * 0.72);
}`;

// ── Solid color (block outline, debug) ────────────────────────────
export const LINE_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
uniform mat4 uProjView;
uniform vec3 uOrigin;
void main() { gl_Position = uProjView * vec4(aPos + uOrigin, 1.0); }`;

export const LINE_FS = `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 fragColor;
void main() { fragColor = uColor; }`;

// ── Crack decal cube ──────────────────────────────────────────────
export const CRACK_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec2 aUV;
uniform mat4 uProjView;
uniform vec3 uOrigin;
out vec2 vUV;
void main() {
  vUV = aUV;
  gl_Position = uProjView * vec4(aPos * 1.002 - 0.001 + uOrigin, 1.0);
}`;

export const CRACK_FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uAtlas;
uniform float uLayer;
in vec2 vUV;
out vec4 fragColor;
void main() {
  vec4 t = texture(uAtlas, vec3(vUV, uLayer));
  if (t.a < 0.3) discard;
  fragColor = vec4(t.rgb, t.a * 0.85);
}`;

// ── Particles: camera-facing textured quads ───────────────────────
export const PARTICLE_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec2 aUV;
layout(location=2) in float aLayer;
layout(location=3) in float aBright;
layout(location=4) in float aAlpha;
uniform mat4 uProjView;
out vec2 vUV;
flat out float vLayer;
out float vBright;
out float vAlpha;
void main() {
  vUV = aUV; vLayer = aLayer; vBright = aBright; vAlpha = aAlpha;
  gl_Position = uProjView * vec4(aPos, 1.0);
}`;

export const PARTICLE_FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uAtlas;
in vec2 vUV;
flat in float vLayer;
in float vBright;
in float vAlpha;
out vec4 fragColor;
void main() {
  vec4 t = texture(uAtlas, vec3(vUV, vLayer));
  if (t.a < 0.4) discard;
  fragColor = vec4(t.rgb * vBright, vAlpha);
}`;

// ── Entities: solid-color box parts with baked face shading ───────
export const ENTITY_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in float aShade;
uniform mat4 uProjView;
uniform mat4 uModel;
uniform vec3 uEye;
out float vShade;
out float vDist;
void main() {
  vec4 wp = uModel * vec4(aPos, 1.0);
  vShade = aShade;
  vDist = length(wp.xyz - uEye);
  gl_Position = uProjView * wp;
}`;

export const ENTITY_FS = `#version 300 es
precision highp float;
uniform vec3 uColor;
uniform float uLight;
uniform vec3 uFogColor;
uniform float uFogStart, uFogEnd;
uniform float uFlash;      // hurt flash
in float vShade;
in float vDist;
out vec4 fragColor;
void main() {
  vec3 col = uColor * vShade * uLight;
  col = mix(col, vec3(0.9, 0.15, 0.1), uFlash);
  float fog = smoothstep(uFogStart, uFogEnd, vDist);
  fragColor = vec4(mix(col, uFogColor, fog), 1.0);
}`;
