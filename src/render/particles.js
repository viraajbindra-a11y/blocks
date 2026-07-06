// CPU particle system rendered as camera-facing quads in one draw call.
// Used for block break/place debris, splashes, rain, snow, and ambience.

export class Particles {
  constructor(max = 900) {
    this.max = max;
    this.list = [];
  }

  /**
   * @param {object} p {x,y,z, vx,vy,vz, gravity, life, size, layer,
   *                    u0,v0,uw,vh, bright, alpha, stretchY, collide}
   */
  spawn(p) {
    if (this.list.length >= this.max) this.list.shift();
    this.list.push(Object.assign({
      vx: 0, vy: 0, vz: 0, gravity: -14, life: 0.8, size: 0.1,
      u0: 0, v0: 0, uw: 1, vh: 1, bright: 1, alpha: 1,
      stretchY: 1, collide: true,
    }, p, { age: 0 }));
  }

  // Debris burst from a block face (break/place/land).
  burstBlock(x, y, z, layer, count, bright, rng = Math.random) {
    for (let i = 0; i < count; i++) {
      const u0 = rng() * 0.7, v0 = rng() * 0.7;
      this.spawn({
        x: x + 0.1 + rng() * 0.8, y: y + 0.1 + rng() * 0.8, z: z + 0.1 + rng() * 0.8,
        vx: (rng() - 0.5) * 3.4, vy: 1.2 + rng() * 3, vz: (rng() - 0.5) * 3.4,
        life: 0.45 + rng() * 0.45, size: 0.06 + rng() * 0.07,
        layer, u0, v0, uw: 0.25, vh: 0.25, bright,
      });
    }
  }

  update(dt, world) {
    const list = this.list;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.age += dt;
      if (p.age >= p.life) { list.splice(i, 1); continue; }
      p.vy += p.gravity * dt;
      const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt, nz = p.z + p.vz * dt;
      if (p.collide && world && world.isSolid(Math.floor(nx), Math.floor(ny), Math.floor(nz))) {
        if (p.dieOnHit) { list.splice(i, 1); continue; }
        p.vx *= 0.4; p.vz *= 0.4;
        if (p.vy < 0) p.vy = 0;
      } else {
        p.x = nx; p.y = ny; p.z = nz;
      }
    }
  }

  // Vertex layout: pos(3) uv(2) layer(1) bright(1) alpha(1) = 8 floats
  buildGeometry(rx, ry, rz, ux, uy, uz) {
    const n = this.list.length;
    if (n === 0) return null;
    const verts = new Float32Array(n * 4 * 8);
    const indices = new Uint32Array(n * 6);
    let vi = 0, ii = 0, vc = 0;
    for (const p of this.list) {
      const fade = 1 - Math.pow(p.age / p.life, 3);
      const a = p.alpha * fade;
      const s = p.size, sy = p.size * p.stretchY;
      const corners = [
        [p.x - rx * s - ux * sy, p.y - ry * s - uy * sy, p.z - rz * s - uz * sy, p.u0, p.v0 + p.vh],
        [p.x + rx * s - ux * sy, p.y + ry * s - uy * sy, p.z + rz * s - uz * sy, p.u0 + p.uw, p.v0 + p.vh],
        [p.x + rx * s + ux * sy, p.y + ry * s + uy * sy, p.z + rz * s + uz * sy, p.u0 + p.uw, p.v0],
        [p.x - rx * s + ux * sy, p.y - ry * s + uy * sy, p.z - rz * s + uz * sy, p.u0, p.v0],
      ];
      for (const c of corners) {
        verts[vi++] = c[0]; verts[vi++] = c[1]; verts[vi++] = c[2];
        verts[vi++] = c[3]; verts[vi++] = c[4];
        verts[vi++] = p.layer; verts[vi++] = p.bright; verts[vi++] = a;
      }
      indices[ii++] = vc; indices[ii++] = vc + 1; indices[ii++] = vc + 2;
      indices[ii++] = vc; indices[ii++] = vc + 2; indices[ii++] = vc + 3;
      vc += 4;
    }
    return { vertices: verts, indices };
  }
}
