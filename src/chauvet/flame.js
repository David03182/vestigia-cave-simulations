import { LatheGeometry, Mesh, ShaderMaterial, Vector2 } from 'three';

export function createFlame(sample, brightness) {
  const geometry = new LatheGeometry([
    [0, 0], [0.003, 0.002], [0.007, 0.006], [0.009, 0.012], [0.008, 0.020],
    [0.006, 0.028], [0.003, 0.037], [0.001, 0.044], [0, 0.049]
  ].map(([radius, height]) => new Vector2(radius, height)), 16);
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const height = positions.getY(i) / 0.049;
    positions.setX(i, positions.getX(i) + 0.012 * height * height);
  }
  geometry.computeVertexNormals();
  const material = new ShaderMaterial({
    uniforms: { lampSample: sample, lampBrightness: brightness },
    transparent: true,
    depthWrite: false,
    vertexShader: `
      varying vec3 flameNormal;
      varying vec3 toCamera;
      varying float height;
      void main() {
        vec4 view = modelViewMatrix * vec4(position, 1.0);
        height = position.y / 0.049;
        flameNormal = normalMatrix * normal;
        toCamera = -view.xyz;
        gl_Position = projectionMatrix * view;
      }`,
    fragmentShader: `
      uniform float lampSample;
      uniform float lampBrightness;
      varying vec3 flameNormal;
      varying vec3 toCamera;
      varying float height;
      void main() {
        float facing = max(0.0, dot(normalize(flameNormal), normalize(toCamera)));
        float core = smoothstep(0.18, 0.90, facing) * (1.0 - smoothstep(0.45, 0.95, height));
        vec3 orange = vec3(1.0, 0.14, 0.018);
        vec3 yellow = vec3(1.0, 0.84, 0.34);
        float alpha = smoothstep(0.02, 0.65, facing) * (0.80 + 0.16 * lampSample);
        gl_FragColor = vec4(mix(orange, yellow, core), min(1.0, alpha * lampBrightness));
        #include <colorspace_fragment>
      }`
  });
  return new Mesh(geometry, material);
}
