import * as THREE from 'three';

// Rain and snow around the camera: one draw call each, all motion in the
// vertex shader (no per-frame buffer updates). Particles live in a box that
// wraps around the camera, so the fall never runs out and nothing is
// allocated while driving or flying. Fewer are drawn on lower graphics.
const RAIN = 4200, SNOW = 3800;
const RAIN_BOX = new THREE.Vector3(44, 30, 44), SNOW_BOX = new THREE.Vector3(46, 28, 46);

function seeded(count, stride, fill) {
  let seed = 4242;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const data = new Float32Array(count * stride);
  for (let i = 0; i < count; i++) fill(data, i, random);
  return data;
}

export function createWeatherEffects(scene) {
  // uOffset is the fall so far, integrated each frame from the velocity
  // relative to the camera (and wrapped to the box), so a change of speed
  // bends the fall instead of making the particles jump.
  const light = { value: new THREE.Color(1, 1, 1) }; // the scene's light on the drops: dim at night
  const time = { value: 0 }, wind = { value: new THREE.Vector3() }, rainOffset = { value: new THREE.Vector3() }, snowOffset = { value: new THREE.Vector3() };

  // Rain: short streaks along the fall direction relative to the camera, so
  // they slant as you drive or fly through them.
  const rainGeometry = new THREE.BufferGeometry();
  const rainSeed = seeded(RAIN, 4, (d, i, r) => d.set([r(), r(), r(), r()], i * 4));
  const rainSeeds = new Float32Array(RAIN * 2 * 4), rainEnds = new Float32Array(RAIN * 2);
  for (let i = 0; i < RAIN; i++) for (let e = 0; e < 2; e++) { rainSeeds.set(rainSeed.subarray(i * 4, i * 4 + 4), (i * 2 + e) * 4); rainEnds[i * 2 + e] = e; }
  rainGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(RAIN * 2 * 3), 3));
  rainGeometry.setAttribute('seed', new THREE.BufferAttribute(rainSeeds, 4));
  rainGeometry.setAttribute('end', new THREE.BufferAttribute(rainEnds, 1));
  const rainMaterial = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTime: time, uFall: wind, uOffset: rainOffset, uBox: { value: RAIN_BOX }, uStrength: { value: 0 }, uLight: light },
    vertexShader: `attribute vec4 seed; attribute float end;
      uniform float uTime; uniform vec3 uFall, uOffset, uBox; varying float vAlpha;
      void main(){
        // uFall is the rain's velocity relative to the camera; drops differ a
        // little in speed.
        vec3 p = seed.xyz * uBox + uOffset + vec3(0.0, -uTime * seed.w * 2.5, 0.0);
        p = mod(p - cameraPosition, uBox) - uBox * .5;
        // Streaks stretch with speed through the rain, as motion blur would:
        // about a metre falling past a parked car, several metres from a plane.
        float rush = length(uFall);
        vec3 streak = uFall / rush * clamp(rush * .075, 1.0, 7.0) * (.75 + .5 * seed.w);
        p -= streak * end;
        float d = length(p);
        vAlpha = (1.0 - smoothstep(uBox.x * .3, uBox.x * .5, d)) * smoothstep(.6, 2.5, d) * (.5 + .5 * end) * (1.0 + smoothstep(15.0, 60.0, rush) * .6);
        gl_Position = projectionMatrix * viewMatrix * vec4(p + cameraPosition, 1.0);
      }`,
    fragmentShader: `uniform float uStrength; uniform vec3 uLight; varying float vAlpha;
      void main(){
        gl_FragColor = vec4(vec3(.82, .86, .9) * uLight, vAlpha * .55 * uStrength);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const rain = new THREE.LineSegments(rainGeometry, rainMaterial);
  rain.frustumCulled = false; rain.renderOrder = 4; rain.name = 'Rain'; rain.visible = false; scene.add(rain);

  // Snow: soft round flakes drifting down with a gentle sway.
  const snowGeometry = new THREE.BufferGeometry();
  snowGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SNOW * 3), 3));
  snowGeometry.setAttribute('seed', new THREE.BufferAttribute(seeded(SNOW, 4, (d, i, r) => d.set([r(), r(), r(), r()], i * 4)), 4));
  const snowMaterial = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTime: time, uOffset: snowOffset, uBox: { value: SNOW_BOX }, uStrength: { value: 0 }, uScale: { value: 600 }, uLight: light },
    vertexShader: `attribute vec4 seed;
      uniform float uTime, uScale; uniform vec3 uOffset, uBox; varying float vAlpha;
      void main(){
        float t = uTime * (.75 + .5 * seed.w);
        vec3 p = seed.xyz * uBox + uOffset + vec3(sin(t * .9 + seed.w * 40.0) * .7, -uTime * seed.w * .5, cos(t * .7 + seed.x * 30.0) * .7);
        p = mod(p - cameraPosition, uBox) - uBox * .5;
        float d = length(p);
        vAlpha = (1.0 - smoothstep(uBox.x * .3, uBox.x * .5, d)) * smoothstep(.4, 1.6, d);
        vec4 view = viewMatrix * vec4(p + cameraPosition, 1.0);
        gl_PointSize = clamp((.11 + .09 * seed.w) * uScale / -view.z, 1.5, 22.0);
        gl_Position = projectionMatrix * view;
      }`,
    fragmentShader: `uniform float uStrength; uniform vec3 uLight; varying float vAlpha;
      void main(){
        float r = length(gl_PointCoord - .5);
        float a = (1.0 - smoothstep(.15, .5, r)) * vAlpha * .95 * uStrength;
        if (a < .01) discard;
        gl_FragColor = vec4(vec3(.96, .97, 1.0) * uLight, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const snow = new THREE.Points(snowGeometry, snowMaterial);
  snow.frustumCulled = false; snow.renderOrder = 4; snow.name = 'Snow'; snow.visible = false; scene.add(snow);

  let density = 1;
  const relative = new THREE.Vector3(), snowFall = new THREE.Vector3();
  const advance = (offset, velocity, box, dt) => {
    offset.addScaledVector(velocity, dt);
    offset.set(offset.x % box.x, offset.y % box.y, offset.z % box.z);
  };
  return {
    // kind: 'rain' | 'snow'; amount 0–1 each (they cross-fade); cameraVelocity
    // in m/s; pixels: drawing-buffer height, so flakes keep their size.
    update({ rainAmount, snowAmount, cameraVelocity, gust, pixels, fov }, dt) {
      time.value += dt;
      // Fall velocity relative to the camera: rain ~9 m/s, snow ~1.3 m/s,
      // pushed sideways by the wind.
      relative.set(gust.x, 0, gust.z).sub(cameraVelocity); // includes the camera's own climb or fall
      rainMaterial.uniforms.uStrength.value = rainAmount; snowMaterial.uniforms.uStrength.value = snowAmount;
      rain.visible = rainAmount > .01; snow.visible = snowAmount > .01;
      if (rain.visible) {
        wind.value.set(relative.x, -9 + relative.y, relative.z);
        advance(rainOffset.value, wind.value, RAIN_BOX, dt);
        rainGeometry.setDrawRange(0, Math.round(RAIN * density * Math.min(1, .25 + rainAmount)) * 2);
      }
      if (snow.visible) {
        snowFall.set(relative.x, -1.3 + relative.y, relative.z);
        advance(snowOffset.value, snowFall, SNOW_BOX, dt);
        snowGeometry.setDrawRange(0, Math.round(SNOW * density * Math.min(1, .25 + snowAmount)));
        snowMaterial.uniforms.uScale.value = pixels / (2 * Math.tan(fov * Math.PI / 360));
      }
    },
    setDensity(value) { density = value; },
    setLight(color) { light.value.copy(color); },
    get counts() { return { rain: rain.visible ? rainGeometry.drawRange.count / 2 : 0, snow: snow.visible ? snowGeometry.drawRange.count : 0 }; },
  };
}

// Fog is applied after tone mapping, the sky before it, so the fog must be the
// sky's horizon colour after ACES at the renderer's exposure (three.js r160's
// ACESFilmicToneMapping), or fogged terrain leaves a band on the skyline.
const ACES_IN = [[.59719, .35458, .04823], [.07600, .90834, .01566], [.02840, .13383, .83777]];
const ACES_OUT = [[1.60475, -.53108, -.07367], [-.10208, 1.10813, -.00605], [-.00327, -.07276, 1.07602]];
const encode = c => c <= .0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - .055;
export function toneMappedHorizon(color, exposure, target = new THREE.Color()) {
  const v = [color.r, color.g, color.b].map(c => c * exposure / .6);
  const fit = x => (x * (x + .0245786) - .000090537) / (x * (.983729 * x + .4329510) + .238081);
  const mid = ACES_IN.map(row => fit(row[0] * v[0] + row[1] * v[1] + row[2] * v[2]));
  const [r, g, b] = ACES_OUT.map(row => encode(Math.min(1, Math.max(0, row[0] * mid[0] + row[1] * mid[1] + row[2] * mid[2]))));
  return target.setRGB(r, g, b, THREE.SRGBColorSpace);
}
