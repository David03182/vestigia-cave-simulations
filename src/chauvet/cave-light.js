import { createCaveLightController } from '../cave-light-controller.js';
import { createLascauxLamp } from './lamp-model.js';
import { createFlame } from './flame.js';
import { LAMP_RADIUS } from './collision.js';

export function createCaveLight(options) {
  return createCaveLightController({
    ...options, createLamp: createLascauxLamp, createFlame, lampRadius: LAMP_RADIUS, positionSuffix: ''
  });
}
