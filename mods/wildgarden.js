// Wild Garden — example BLOCKS mod: a faintly glowing night flower that
// generates in meadows and forests.
// Demonstrates: a cross-plant block, worldgen surface decoration,
// a shapeless recipe, and event hooks.

export default {
  id: 'wildgarden',
  name: 'Wild Garden',
  version: '1.0',

  init(api) {
    api.registerBlock('moonbell', 'Moonbell', {
      solid: false,
      opaque: false,
      cross: true,
      sway: true,
      light: 3,
      hardness: 0.05,
      sound: 'plant',
      drops: 'self',
      placeOnKeys: ['grass', 'soil'],
      texture: {
        plant: { stem: '#4a7a3c', bloom: '#cdd6ff', center: '#fff6cf' },
      },
    });

    // Two moonbells distill into glimmer dust (lantern ingredient).
    api.registerRecipe({
      out: 'glimmer_dust', count: 1,
      ingredients: ['moonbell', 'moonbell'],
    });

    // Scatter through meadows and alderwood on grass.
    api.addSurfaceDecoration({
      biomes: ['plains', 'forest'],
      block: 'moonbell',
      chance: 0.012,
      placeOn: ['grass'],
    });

    let picked = 0;
    api.on('blockBroken', (e) => {
      if (e.key === 'moonbell') {
        picked++;
        if (picked === 1) api.log('first moonbell picked — they glow at night');
      }
    });
  },
};
