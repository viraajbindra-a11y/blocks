// Emberglass — example BLOCKS mod: a glowing translucent building block.
// Demonstrates: registerBlock with a declarative texture spec + a shaped
// recipe. Mods are dependency-free; everything comes through `api`.

export default {
  id: 'emberglass',
  name: 'Emberglass',
  version: '1.0',

  init(api) {
    api.registerBlock('emberglass', 'Emberglass', {
      solid: true,
      opaque: false,
      translucent: true,
      light: 11,
      hardness: 0.6,
      sound: 'glass',
      drops: 'self',
      texture: {
        base: '#c97a2e',
        alpha: 165,
        speckle: ['#ffd27a', '#e8a13c'],
        speckleDensity: 0.1,
        rim: '#ffe9c0',
        glow: true,
      },
    });

    api.registerRecipe({
      out: 'emberglass', count: 4,
      pattern: ['GG', 'GS'],
      keys: { G: 'glass', S: 'sunstone' },
      station: 'worktable',
    });

    api.log('warm light, cold nights');
  },
};
