// Minimal column-major 4x4 matrix + vec3 helpers for the renderer.

export function identity(out = new Float32Array(16)) {
  out.fill(0);
  out[0] = out[5] = out[10] = out[15] = 1;
  return out;
}

export function perspective(out, fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

export function multiply(out, a, b) {
  const r = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let ro = 0; ro < 4; ro++) {
      r[c * 4 + ro] =
        a[ro] * b[c * 4] + a[4 + ro] * b[c * 4 + 1] +
        a[8 + ro] * b[c * 4 + 2] + a[12 + ro] * b[c * 4 + 3];
    }
  }
  out.set(r);
  return out;
}

export function translate(out, m, x, y, z) {
  const t = identity();
  t[12] = x; t[13] = y; t[14] = z;
  return multiply(out, m, t);
}

export function rotateX(out, m, rad) {
  const r = identity(), c = Math.cos(rad), s = Math.sin(rad);
  r[5] = c; r[6] = s; r[9] = -s; r[10] = c;
  return multiply(out, m, r);
}

export function rotateY(out, m, rad) {
  const r = identity(), c = Math.cos(rad), s = Math.sin(rad);
  r[0] = c; r[2] = -s; r[8] = s; r[10] = c;
  return multiply(out, m, r);
}

export function scale(out, m, x, y, z) {
  const r = identity();
  r[0] = x; r[5] = y; r[10] = z;
  return multiply(out, m, r);
}

// First-person view matrix from eye position + yaw/pitch (radians).
export function viewFromCamera(out, eye, yaw, pitch) {
  identity(out);
  rotateX(out, out, -pitch);
  rotateY(out, out, -yaw);
  return translate(out, out, -eye[0], -eye[1], -eye[2]);
}

// Orthonormal camera basis from yaw/pitch. yaw 0 looks down -z.
export function cameraBasis(yaw, pitch) {
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const fwd = [-sy * cp, sp, -cy * cp];
  const right = [cy, 0, -sy];
  const up = [
    right[1] * fwd[2] - right[2] * fwd[1],
    right[2] * fwd[0] - right[0] * fwd[2],
    right[0] * fwd[1] - right[1] * fwd[0],
  ];
  return { fwd, right, up };
}

// Extract 6 frustum planes [a,b,c,d] from a projection*view matrix.
export function frustumPlanes(m, out = []) {
  const rows = [
    [m[3]+m[0], m[7]+m[4], m[11]+m[8],  m[15]+m[12]],  // left
    [m[3]-m[0], m[7]-m[4], m[11]-m[8],  m[15]-m[12]],  // right
    [m[3]+m[1], m[7]+m[5], m[11]+m[9],  m[15]+m[13]],  // bottom
    [m[3]-m[1], m[7]-m[5], m[11]-m[9],  m[15]-m[13]],  // top
    [m[3]+m[2], m[7]+m[6], m[11]+m[10], m[15]+m[14]],  // near
    [m[3]-m[2], m[7]-m[6], m[11]-m[10], m[15]-m[14]],  // far
  ];
  for (let i = 0; i < 6; i++) {
    const [a, b, c, d] = rows[i];
    const len = Math.hypot(a, b, c) || 1;
    out[i] = [a / len, b / len, c / len, d / len];
  }
  return out;
}

// AABB vs frustum: true if the box may be visible.
export function aabbInFrustum(planes, minX, minY, minZ, maxX, maxY, maxZ) {
  for (let i = 0; i < 6; i++) {
    const p = planes[i];
    const x = p[0] > 0 ? maxX : minX;
    const y = p[1] > 0 ? maxY : minY;
    const z = p[2] > 0 ? maxZ : minZ;
    if (p[0] * x + p[1] * y + p[2] * z + p[3] < 0) return false;
  }
  return true;
}
