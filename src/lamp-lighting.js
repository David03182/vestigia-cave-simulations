import { ShaderChunk } from 'three';
import { MAX_LAMPS } from './lamp-playback.js';

const directCall = 'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';

// The controller matches samples to Three's shadow-first PointLight order.
// Disabled sources stay in the light list at zero intensity.
const pointLighting = ShaderChunk.lights_fragment_begin.replace(directCall, `
  {
  vec3 lampDirectBefore = reflectedLight.directDiffuse;
  ${directCall}
  #if UNROLLED_LOOP_INDEX < ${MAX_LAMPS}
    vec3 lampDirect = reflectedLight.directDiffuse - lampDirectBefore;
    lampModulatedDirect += lampDirect * max(lampSamples[ i ] * 0.38, -1.0);
  #endif
  }
`);

export function applyLampLighting(material, samples) {
  material.onBeforeCompile = shader => {
    shader.uniforms.lampSamples = samples;
    shader.fragmentShader = `uniform float lampSamples[${MAX_LAMPS}];\n` + shader.fragmentShader
      .replace('#include <lights_fragment_begin>', `vec3 lampModulatedDirect = vec3(0.0);\n${pointLighting}`)
      .replace('#include <opaque_fragment>', `
        float steadyPeak = max(max(outgoingLight.r, outgoingLight.g), outgoingLight.b);
        float displayScale = min(1.0, 0.98 / max(steadyPeak, 0.001));
        vec3 steadyColour = outgoingLight * displayScale;
        vec3 change = lampModulatedDirect * displayScale;
        // Apply the public preview bound once to the sum of independently
        // modulated sources. Ambient light remains outside the modulation.
        float changeLuminance = abs(dot(change, vec3(0.2126, 0.7152, 0.0722)));
        float luminanceBound = min(1.0, 0.040 / max(changeLuminance, 0.001));
        vec3 channelSpace = mix(steadyColour, vec3(1.0) - steadyColour, step(vec3(0.0), change));
        vec3 channelBounds = channelSpace / max(abs(change), vec3(0.001));
        float channelBound = min(1.0, min(channelBounds.r, min(channelBounds.g, channelBounds.b)));
        outgoingLight = steadyColour + change * min(luminanceBound, channelBound);
        #include <opaque_fragment>
      `);
  };
  material.customProgramCacheKey = () => 'independent-lamps-v1';
}
