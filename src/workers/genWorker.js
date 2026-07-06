// Chunk generation worker. Receives {type:'init', seed, dimension} once,
// then {type:'gen', cx, cz} requests; replies with transferable buffers.

import { makeGenerator } from '../world/gen/terrain.js';
import { makeSmolderGenerator } from '../world/gen/smolder.js';
import { makeHollowGenerator } from '../world/gen/hollow.js';

let gen = null;

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') {
    const dim = m.dimension || 'overworld';
    gen = dim === 'smolder' ? makeSmolderGenerator(m.seed)
      : dim === 'hollow' ? makeHollowGenerator(m.seed)
      : makeGenerator(m.seed, m.decorations || []);
    return;
  }
  if (m.type === 'gen' && gen) {
    const { blocks, hmap, biomes } = gen.generateChunk(m.cx, m.cz);
    self.postMessage(
      { type: 'chunk', cx: m.cx, cz: m.cz, blocks, hmap, biomes },
      [blocks.buffer, hmap.buffer, biomes.buffer],
    );
  }
};
