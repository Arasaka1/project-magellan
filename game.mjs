import { createTerrain } from './terrain.mjs?v=physics-11';
import { createWater } from './water.mjs?v=sound-1';
import { FAR_SIZE, FAR_VIEW, NEAR_VIEW, ULTRA_SIZE, ULTRA_VIEW, ULTRA_BLEND_START, ULTRA_BLEND_END, farIndices, farCoverage, ultraIndices, ultraCoverage } from './streaming-layout.mjs?v=physics-11';
import { loadVehicleModel } from './vehicle-model.mjs?v=flight-1';
import { createProfiler } from './profiling.mjs?v=timing-1';
import { createDebris } from './debris.mjs?v=physics-11';
import { createVehiclePresentation } from './vehicle-presentation.mjs?v=physics-11';
import { followTarget, followValue } from './camera-motion.mjs?v=grass-1';
import { createTreeBreakage } from './tree-breakage.mjs?v=nature-1';
import { loadNatureLibrary } from './nature-models.mjs?v=nature-1';
import { createBreakAudio } from './break-audio.mjs?v=sound-2';
import { createVehicleAudio } from './vehicle-audio.mjs?v=sound-2';
import { installSunShadowFade } from './shadow-fade.mjs?v=shadow-1';
import { createGrass } from './grass.mjs?v=physics-11';
import { QUALITY_PRESETS, qualityLevels, presetLevel, autoStartLevel, createAutoQuality } from './quality.mjs?v=shadow-1';
import { controlAxis, steerAxis } from './controls.mjs?v=slider-1';
import { toggleFlight, setAutopilot, AUTOPILOT_SPEED, TAKEOFF_SPEED, STALL_SPEED } from './flight-motion.mjs?v=physics-11';
import { createClouds } from './clouds.mjs?v=physics-11';
import * as THREE from 'three';
import { CHUNK, GRID, ROAD_SPACING, ROAD_HALF, FIXED_DT, featurePoint, clamp, mix, smoothstep, hash, createWorld, createVehicle, stepVehicle, recoverVehicle, groundAt } from './world.mjs?v=physics-11';
import { buildLandmark, cloneOwnedGeometry } from './scenery.mjs?v=physics-11';

const $ = id => document.getElementById(id);
const coarse = matchMedia('(pointer:coarse)').matches || navigator.maxTouchPoints > 0;
const reducedMotion = matchMedia('(prefers-reduced-motion:reduce)').matches;
const testMode = ['drive', 'ramp', 'twist', 'smash', 'tree-smash', 'browser', 'water', 'boat', 'fly', 'sea'].includes(new URLSearchParams(location.search).get('test'));
const profiler = createProfiler(testMode);
const bootStarted = performance.now();
if (coarse) document.body.classList.add('touch');
const seedFromUrl = Number(new URLSearchParams(location.search).get('seed'));
const freshSeed = () => crypto.getRandomValues(new Uint32Array(1))[0] % 900000 + 100000;
let seed = Number.isSafeInteger(seedFromUrl) && seedFromUrl > 0 ? seedFromUrl % 2147483647 || 1 : freshSeed();
let world = createWorld(seed), vehicle = createVehicle(world);
if (['water', 'boat'].includes(new URLSearchParams(location.search).get('test'))) {
  const lake = world.starterLake, afloat = new URLSearchParams(location.search).get('test') === 'boat';
  vehicle = createVehicle(world, lake.x, afloat ? lake.z : lake.z - lake.rz * 1.12, 0);
}
// Reproducible launch position used by the browser integration harness.
if (new URLSearchParams(location.search).get('test') === 'ramp') {
  const p = featurePoint(world.starterRamp, 0, -35);
  vehicle = createVehicle(world, p.x, p.z, world.starterRamp.heading);
}
if (new URLSearchParams(location.search).get('test') === 'twist') {
  const p = featurePoint(world.twistRamp, 0, -35);
  vehicle = createVehicle(world, p.x, p.z, world.twistRamp.heading);
}
if (new URLSearchParams(location.search).get('test') === 'smash') {
  const prop = world.props(0, 0).find(p => ['cactus', 'tree', 'boulder'].includes(p.type));
  if (prop) vehicle = createVehicle(world, prop.x, prop.z - 32, 0);
}
// Preview flight directly: already airborne above the spawn road.
if (new URLSearchParams(location.search).get('test') === 'fly') {
  Object.assign(vehicle, { flightMode: true, flight: 1, flying: true, airspeed: 50, climb: 0, grounded: false, vz: 50, speed: 50 });
  vehicle.y += 120;
}
// Preview the starter inland sea from the air, approaching its coast.
if (new URLSearchParams(location.search).get('test') === 'sea') {
  const sea = world.starterSea, heading = Math.atan2(sea.x, sea.z), back = Math.max(sea.rx, sea.rz) * 1.3 + 500;
  vehicle = createVehicle(world, sea.x - Math.sin(heading) * back, sea.z - Math.cos(heading) * back, heading);
  Object.assign(vehicle, { flightMode: true, flight: 1, flying: true, airspeed: 50, climb: 0, grounded: false, vx: Math.sin(heading) * 50, vz: Math.cos(heading) * 50, speed: 50 });
  vehicle.y += 140;
}
if (new URLSearchParams(location.search).get('test') === 'tree-smash') {
  const prop = world.props(-1, -1).find(p => p.type === 'tree');
  if (prop) vehicle = createVehicle(world, prop.x, prop.z - 32, 0);
}
let running = false, started = false, cameraMode = 0, muted = true, lightsOn = false, bestDistance = 0;
if (!testMode) try { muted = localStorage.getItem('endless-drive-muted') !== '0'; bestDistance = Number(JSON.parse(localStorage.getItem('endless-drive-records') || '{}').distance) || 0; } catch {}
const input = {}, keyStates = new Set(), touchStates = new Map();
// Graphics and touch preferences. Tests use fixed, device-appropriate settings
// unless ?quality= is given, so slow software rendering never changes a level.
const settings = { quality: 'auto', sensitivity: 1, autoLevel: null };
if (!testMode) try { Object.assign(settings, JSON.parse(localStorage.getItem('endless-drive-settings') || '{}')); } catch {}
const qualityParam = new URLSearchParams(location.search).get('quality');
if (QUALITY_PRESETS.includes(qualityParam)) settings.quality = qualityParam;
else if (testMode) settings.quality = coarse ? 'medium' : 'high';
if (!QUALITY_PRESETS.includes(settings.quality)) settings.quality = 'auto';
settings.sensitivity = clamp(Number(settings.sensitivity) || 1, .5, 1.5);
const saveSettings = () => { if (!testMode) try { localStorage.setItem('endless-drive-settings', JSON.stringify(settings)); } catch {} };
const levels = qualityLevels(coarse);
let auto = null, qualityLevel = 0;
function startQuality() {
  const saved = Number.isInteger(settings.autoLevel) && settings.autoLevel >= 0 && settings.autoLevel < levels.length ? settings.autoLevel : null;
  auto = settings.quality === 'auto' ? createAutoQuality({ start: saved ?? autoStartLevel(coarse), max: levels.length - 1 }) : null;
  return auto ? auto.level : presetLevel(settings.quality);
}
qualityLevel = startQuality();
const keyMap = { KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', Space: 'jump', ShiftLeft: 'brake', ShiftRight: 'brake', KeyQ: 'yawLeft', KeyE: 'yawRight' };
// In the air the same keys fly on three axes. W/S throttle; ↑/↓ pitch like a
// flight stick (↓ pulls the nose up), with Space/Shift as climb/dive; A/D or
// ←/→ roll; Q/E yaw. Touch: ↑↓ throttle, CLIMB/DIVE pitch, slider roll.
const flightKeys = {
  throttleUp: ['KeyW'], throttleDown: ['KeyS'], pitchUp: ['Space', 'ArrowDown'], pitchDown: ['ShiftLeft', 'ShiftRight', 'ArrowUp'],
  rollLeft: ['KeyA', 'ArrowLeft'], rollRight: ['KeyD', 'ArrowRight'], yawLeft: ['KeyQ'], yawRight: ['KeyE'],
};
const flightTouch = { throttleUp: 'up', throttleDown: 'down', pitchUp: 'jump', pitchDown: 'brake', rollLeft: 'left', rollRight: 'right' };

installSunShadowFade();
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, levels[qualityLevel].pixelRatio));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.domElement.tabIndex = 0;
renderer.domElement.setAttribute('aria-label', 'Driving world. WASD to drive, Space to jump, Shift to drift, R to recover, Escape to pause.');
$('game').append(renderer.domElement);
const scene = new THREE.Scene();
// Water fades with the same (altitude-dependent) fog distances as terrain.
const fogUniforms = { uFogNear: { value: 350 }, uFogFar: { value: 1450 } }, streamCenterUniform = { value: new THREE.Vector2() };
// The water reflects the same sky and sun the scene is lit by (see the sky
// dome and sun below; the sun keeps a fixed offset from the car).
const waterSystem = createWater(scene, fogUniforms, streamCenterUniform, { sunDirection: new THREE.Vector3(-65, 100, 45), sunColor: '#fff0d2', skyTop: '#729eaf', skyBottom: '#b9cdd0' });
waterSystem.setDetail(qualityLevel > 0);
const skyColor = new THREE.Color('#b9cdd0');
scene.background = skyColor;
// Fog is applied after tone mapping, the sky before it. This is the sky's
// horizon colour after ACES at the current exposure, so fully fogged terrain
// disappears into the sky instead of leaving a darker band on the skyline.
const FOG_COLOR = new THREE.Color('#c8d1d3');
scene.fog = new THREE.Fog(FOG_COLOR, 350, 1450);
const camera = new THREE.PerspectiveCamera(57, innerWidth / innerHeight, .1, 6400);
scene.add(new THREE.HemisphereLight('#e4efed', '#787257', 1.6));
const sun = new THREE.DirectionalLight('#fff0d2', 2.5);
sun.castShadow = true;
sun.shadow.mapSize.setScalar(levels[qualityLevel].shadow);
Object.assign(sun.shadow.camera, { left: -48, right: 48, top: 48, bottom: -48, near: 1, far: 230 });
sun.shadow.bias = -.00015; sun.shadow.normalBias = .04;
scene.add(sun, sun.target);
// A second, coarse shadow map for the same sun reaches about 150 m ahead, so
// trees and rocks cast shadows long before the sharp map around the car
// arrives. Its light adds nothing itself; the shader blends the two maps.
const FAR_SHADOW = 110, FAR_SHADOW_AHEAD = 70;
const farSun = new THREE.DirectionalLight('#fff0d2', 0);
Object.assign(farSun.shadow.camera, { left: -FAR_SHADOW, right: FAR_SHADOW, top: FAR_SHADOW, bottom: -FAR_SHADOW, near: 1, far: 700 });
farSun.shadow.bias = -.0004; farSun.shadow.normalBias = .15;
function setFarShadow(size) {
  farSun.castShadow = size > 0;
  if (size && farSun.shadow.mapSize.x !== size) { farSun.shadow.mapSize.setScalar(size); farSun.shadow.map?.dispose(); farSun.shadow.map = null; }
}
setFarShadow(levels[qualityLevel].farShadow);
scene.add(farSun, farSun.target); // after the sun: it must be the second directional shadow
const sunDirection = new THREE.Vector3(-65, 100, 45).normalize();
// A softly graded sky travels with the camera; the horizon never runs out.
const sky = new THREE.Mesh(new THREE.SphereGeometry(6000, 24, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false,
  uniforms: { top: { value: new THREE.Color('#729eaf') }, bottom: { value: skyColor } },
  vertexShader: 'varying vec3 vDir; void main(){ vDir=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `varying vec3 vDir; uniform vec3 top; uniform vec3 bottom;
    float hashSky(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float noiseSky(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hashSky(i),hashSky(i+vec2(1,0)),f.x),mix(hashSky(i+vec2(0,1)),hashSky(i+vec2(1,1)),f.x),f.y);}
    void main(){
      vec3 ray=normalize(vDir);float t=pow(max(ray.y,0.0),.65);
      vec2 p=ray.xz/max(ray.y,.05)*1.3;
      float n=noiseSky(p)*.5+noiseSky(p*2.1)*.25+noiseSky(p*4.2)*.125;
      float cloud=smoothstep(.48,.68,n)*smoothstep(.025,.14,ray.y)*(1.0-smoothstep(.7,.95,ray.y))*.62;
      gl_FragColor=vec4(mix(mix(bottom,top,t),vec3(.87,.90,.87),cloud),1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
}));
// Shader chunks must start on their own line.
sky.material.fragmentShader = sky.material.fragmentShader.replace(';#include', ';\n#include');
scene.add(sky);
// Cloud banks at flying height, seeded per world.
const clouds = createClouds(scene, seed);

// Paint roads directly onto the terrain surface. Geometry, collision height and
// asphalt now share one surface: no raised ribbons, cuttings, seams or walls.
const terrainMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
const streamUniforms = { uStreamCenter: streamCenterUniform };
const grass = createGrass(streamUniforms.uStreamCenter, levels[qualityLevel].grass);
const roadUniforms = { uRoadPhase: { value: world.phase } };
// Geometry is already coarse at the streaming boundary. Moving the boundary
// therefore changes tessellation only, never the silhouette or lighting.
const lodDeclaration = `uniform vec2 uStreamCenter;
attribute float coarseHeight;
attribute vec3 coarseNormal;
attribute vec3 coarseColor;
attribute float ultraHeight;
float terrainBlend(){return smoothstep(220.0,360.0,distance((modelMatrix*vec4(position,1.0)).xz,uStreamCenter));}
float ultraBlend(){return smoothstep(${ULTRA_BLEND_START.toFixed(1)},${ULTRA_BLEND_END.toFixed(1)},distance((modelMatrix*vec4(position,1.0)).xz,uStreamCenter));}
`;

terrainMaterial.onBeforeCompile = shader => {
  Object.assign(shader.uniforms, roadUniforms, streamUniforms, waterSystem.causticUniforms);
  shader.vertexShader = lodDeclaration + 'varying vec2 vGroundXZ; varying vec3 vGroundWorld;\n' + shader.vertexShader;
  shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nobjectNormal=mix(objectNormal,coarseNormal,terrainBlend());');
  shader.vertexShader = shader.vertexShader.replace('#include <color_vertex>', '#include <color_vertex>\nvColor=mix(vColor,coarseColor,terrainBlend());');
  shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.y=mix(mix(position.y,coarseHeight,terrainBlend()),ultraHeight,ultraBlend());\nvGroundXZ=(modelMatrix*vec4(position,1.0)).xz;vGroundWorld=(modelMatrix*vec4(transformed,1.0)).xyz;');
  shader.fragmentShader = `varying vec2 vGroundXZ; varying vec3 vGroundWorld;
    uniform float uRoadPhase, uTime; uniform vec4 uCausticLake;
    float centerAt(float s,float band,float axis){
      float p=uRoadPhase+axis*1.8; float a=p+band*1.71;float b=p*.7+band*2.13;
      return band*420.0+35.0*(sin(s*.0028+a)-sin(a))+12.0*(sin(s*.0065+b)-sin(b));
    }
    float grain(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
  ` + shader.fragmentShader;
  shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
    vec2 p=vGroundXZ; float dx=10000.0;float dz=10000.0;
    for(int k=-1;k<=1;k++){
      dx=min(dx,abs(p.x-centerAt(p.y,floor(p.x/420.0+.5)+float(k),0.0)));
      dz=min(dz,abs(p.y-centerAt(p.x,floor(p.y/420.0+.5)+float(k),1.0)));
    }
    float d=min(dx,dz);float aa=max(fwidth(d),.04);
    float shoulder=1.0-smoothstep(5.0,6.6,d);
    diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.34,.31,.235),shoulder*.68);
    float asphalt=1.0-smoothstep(4.65-aa,4.65+aa,d);
    float speckle=grain(floor(p*9.0));
    diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.105,.124,.12)+speckle*.018,asphalt);
    float edge=(1.0-smoothstep(.065,.065+aa,abs(d-4.13)))*step(5.0,max(dx,dz));
    float along=dx<dz?p.y:p.x;
    float dash=(1.0-smoothstep(.065,.065+aa,d))*step(7.0,mod(along,14.0))*smoothstep(6.0,8.0,max(dx,dz));
    diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.77,.72,.56),max(edge*.7,dash*.88));
    // Sunlight focused by the waves dances over the bed of the lake nearest
    // the camera (xy centre, z reach, w surface level; reach 0 turns it off).
    float underwater=uCausticLake.w-vGroundWorld.y;
    if(uCausticLake.z>0.0&&underwater>.02&&distance(p,uCausticLake.xy)<uCausticLake.z){
      float fade=(1.0-smoothstep(35.0,75.0,distance(cameraPosition,vGroundWorld)))*smoothstep(.02,.35,underwater)*exp(-underwater*.16);
      if(fade>.0){
        vec2 q=p*.62; float t=uTime*.9;
        vec2 a=q+vec2(sin(q.y*1.3+t),cos(q.x*1.1-t*.8))*.9, b=q*1.37+vec2(cos(q.y*.9-t*.7),sin(q.x*1.5+t*.6))*.8;
        float c=pow(1.0-abs(sin(a.x)*sin(a.y)),7.0)+pow(1.0-abs(sin(b.x+.7)*sin(b.y-.4)),7.0);
        diffuseColor.rgb*=1.0+c*.42*fade;
      }
    }
  `);
};
let terrain = createTerrain(world);
function geometryFromData(data) {
  const geometry = new THREE.BufferGeometry();
  for (const [name, array] of Object.entries(data)) {
    if (name === 'index') geometry.setIndex(new THREE.BufferAttribute(array, 1));
    else geometry.setAttribute(name, new THREE.BufferAttribute(array, name === 'coarseHeight' || name === 'ultraHeight' ? 1 : 3));
  }
  geometry.computeBoundingSphere();
  return geometry;
}
const material = (color, roughness = .85, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
const bushMaterial = material('#728450'), postMaterial = material('#ded7b4');
let nature = null, natureError = null;
loadNatureLibrary().then(library => {
  nature = library;
  treeBreakage = createTreeBreakage(scene, nature.treeSources);
}).catch(error => {
  natureError = error.message;
  $('loadError').hidden = false;
  $('startBtn').firstElementChild.textContent = 'Unable to load scenery';
  console.error('Blender scenery failed to load:', error);
});
const bushGeo = new THREE.IcosahedronGeometry(1, 0).scale(1.1, .7, .9).translate(0, .45, 0);
const postGeo = new THREE.BoxGeometry(.18, .95, .18).translate(0, .48, 0);
const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion(), upAxis = new THREE.Vector3(0, 1, 0), scaleVec = new THREE.Vector3(), pointVec = new THREE.Vector3();
const fadingMaterials = new WeakSet();
function softenScenery(mat) {
  if (fadingMaterials.has(mat)) return;
  fadingMaterials.add(mat);
  // Use stable multisample coverage instead of screen-space noise, which
  // sparkles during motion and on browsers with different pixel ratios.
  // Keep alpha in the output (transparent), but retain opaque depth and
  // blending when MSAA is available. Fall back to ordinary alpha blending.
  const multisampled = renderer.getContext().getContextAttributes().antialias;
  mat.transparent = true;
  mat.alphaToCoverage = multisampled;
  mat.blending = multisampled ? THREE.NoBlending : THREE.NormalBlending;
  mat.depthWrite = multisampled;
  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, streamUniforms);
    shader.vertexShader = 'attribute float groundDelta; uniform vec2 uStreamCenter; varying vec2 vSceneryXZ;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
      vec4 sceneryPosition=vec4(transformed,1.0);
      #ifdef USE_INSTANCING
        sceneryPosition=instanceMatrix*sceneryPosition;
      #endif
      vSceneryXZ=(modelMatrix*sceneryPosition).xz;
      float groundBlend=smoothstep(220.0,360.0,distance(vSceneryXZ,uStreamCenter));
      // Group transforms preserve the vertical axis and have unit scale.
      sceneryPosition.y+=groundDelta*groundBlend;
      vec4 mvPosition=modelViewMatrix*sceneryPosition;
      gl_Position=projectionMatrix*mvPosition;`);
    shader.fragmentShader = 'uniform vec2 uStreamCenter; varying vec2 vSceneryXZ;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>', `
      #include <alphatest_fragment>
      float coverage=1.0-smoothstep(220.0,350.0,distance(vSceneryXZ,uStreamCenter));
      if(coverage<=0.001) discard;
      diffuseColor.a*=coverage;`);
  };
  mat.customProgramCacheKey = () => 'scenery-distance-fade-v2';
  mat.needsUpdate = true;
}
const chunks = new Map();
const view = NEAR_VIEW, farTiles = new Map(), ultraTiles = new Map();
let lastCX = Infinity, lastCZ = Infinity;
let worker, generation = 0, jobId = 0, jobs = [], pending = new Map(), completed = [];
let loading = true, resumeAfterLoad = false, loadingStarted = bootStarted, streamError = null;
// Distant water is rebuilt in the worker after every 500 m of travel.
let distantAt = { x: Infinity, z: Infinity }, distantReady = false;
function buildChunk({ cx, cz, ground: groundData, props, features, roadside, grass: grassData }) {
  const buildStart = performance.now();
  const group = new THREE.Group(); group.position.set(cx * CHUNK, 0, cz * CHUNK);
  props = props.filter(p => !world.brokenProps.has(p.id));
  const propInstances = new Map();
  const ground = new THREE.Mesh(geometryFromData(groundData), terrainMaterial);
  ground.geometry.userData.owned = true;
  ground.receiveShadow = true; group.add(ground);
  function instances(type, geometry, mat, variant) {
    const list = (type === 'post' ? roadside : props).filter(p => p.type === type && (variant === undefined || nature.variantFor(p) === variant)); if (!list.length) return;
    const mesh = new THREE.InstancedMesh(geometry, mat, list.length);
    list.forEach((p, i) => {
      pointVec.set(p.x - cx * CHUNK, p.y - .08, p.z - cz * CHUNK); quaternion.setFromAxisAngle(upAxis, p.turn); scaleVec.setScalar(p.size); matrix.compose(pointVec, quaternion, scaleVec); mesh.setMatrixAt(i, matrix);
      if (p.id) { if (!propInstances.has(p.id)) propInstances.set(p.id, []); propInstances.get(p.id).push({ mesh, index: i }); }
    });
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.userData.natureKind = variant === undefined ? null : type; group.add(mesh);
  }
  for (const [kind, variants] of Object.entries(nature.variants)) {
    variants.forEach(({ geometry, material }, variant) => instances(kind, geometry, material, variant));
  }
  instances('bush', bushGeo, bushMaterial); instances('post', postGeo, postMaterial);
  for (const feature of features) {
    const landmark = buildLandmark(feature, world);
    landmark.position.x -= cx * CHUNK; landmark.position.z -= cz * CHUNK; group.add(landmark);
  }
  group.updateMatrixWorld(true);
  group.traverse(o => {
    if (!o.isMesh || o === ground) return;
    // Match the terrain's gradual height change so distant trees stay rooted.
    if (!o.geometry.userData.owned) o.geometry = cloneOwnedGeometry(o.geometry);
    const deltas = [], position = o.geometry.getAttribute('position');
    for (let i = 0; i < (o.isInstancedMesh ? o.count : position.count); i++) {
      if (o.isInstancedMesh) { o.getMatrixAt(i, matrix); pointVec.setFromMatrixPosition(matrix); }
      else pointVec.fromBufferAttribute(position, i);
      pointVec.applyMatrix4(o.matrixWorld);
      deltas.push(terrain.coarseSample(pointVec.x, pointVec.z).height - world.surface(pointVec.x, pointVec.z));
    }
    o.geometry.setAttribute('groundDelta', o.isInstancedMesh ? new THREE.InstancedBufferAttribute(new Float32Array(deltas), 1) : new THREE.Float32BufferAttribute(deltas, 1));
    softenScenery(o.material);
  });
  const grassMesh = grass.build(grassData);
  if (grassMesh) { grass.update(grassMesh, cx, cz, vehicle.x, vehicle.z); group.add(grassMesh); }
  profiler.record('chunkBuild', performance.now() - buildStart);
  scene.add(group); chunks.set(`${cx},${cz}`, { cx, cz, group, ground, grassMesh, props, features, propInstances });
}
function processBreakage() {
  for (const prop of world.drainBreakEvents()) {
    const chunk = chunks.get(`${Math.floor(prop.x / CHUNK)},${Math.floor(prop.z / CHUNK)}`);
    for (const { mesh, index } of chunk?.propInstances.get(prop.id) || []) {
      mesh.getMatrixAt(index, matrix); matrix.scale(scaleVec.set(0, 0, 0)); mesh.setMatrixAt(index, matrix); mesh.instanceMatrix.needsUpdate = true;
    }
    const impostors = farTiles.get(`${Math.floor(prop.x / FAR_SIZE)},${Math.floor(prop.z / FAR_SIZE)}`)?.userData.impostors, k = impostors?.ids.get(prop.id);
    if (k !== undefined) { impostors.mesh.getMatrixAt(k, matrix); matrix.scale(scaleVec.set(0, 0, 0)); impostors.mesh.setMatrixAt(k, matrix); impostors.mesh.instanceMatrix.needsUpdate = true; }
    debris.burst(prop);
    if (prop.type === 'tree') treeBreakage.burst({ ...prop, variant: nature.variantFor(prop) });
    if (!muted && audio) audio.breaks.play(prop.type, Math.hypot(prop.vx, prop.vz), panAt(prop.x, prop.z));
  }
}
function disposeChunk(chunk) {
  scene.remove(chunk.group);
  chunk.group.traverse(o => { if (o.geometry?.userData.owned) o.geometry.dispose(); if (o.isInstancedMesh) o.dispose(); });
}
// Distant forests: one instanced pine silhouette per far tile, placed at the
// same seeded positions as the real trees. They fade in exactly as the real
// trees fade out (220–350 m), so flying away never thins the forest.
const impostorGeometry = (() => {
  const lower = new THREE.ConeGeometry(1.75, 5, 6).translate(0, 3.2, 0), upper = new THREE.ConeGeometry(1.15, 3.6, 6).translate(0, 5.6, 0);
  const merged = new THREE.BufferGeometry(), parts = [lower.toNonIndexed(), upper.toNonIndexed()];
  for (const name of ['position', 'normal']) merged.setAttribute(name, new THREE.Float32BufferAttribute(parts.flatMap(g => [...g.getAttribute(name).array]), 3));
  return merged;
})();
const impostorMaterial = new THREE.MeshLambertMaterial({ color: '#ffffff' });
{
  const multisampled = renderer.getContext().getContextAttributes().antialias;
  Object.assign(impostorMaterial, { transparent: true, alphaToCoverage: multisampled, blending: multisampled ? THREE.NoBlending : THREE.NormalBlending, depthWrite: multisampled });
  impostorMaterial.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, streamUniforms);
    shader.vertexShader = 'attribute vec3 groundY; uniform vec2 uStreamCenter; varying float vFade;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
      vec4 world = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
      float d = distance((modelMatrix * instanceMatrix[3]).xz, uStreamCenter);
      // Follow the terrain tier actually drawn under the tree: fine, far, horizon.
      world.y += mix(mix(groundY.x, groundY.y, smoothstep(220.0, 360.0, d)), groundY.z, smoothstep(${ULTRA_BLEND_START.toFixed(1)}, ${ULTRA_BLEND_END.toFixed(1)}, d));
      vFade = smoothstep(220.0, 350.0, d);
      vec4 mvPosition = viewMatrix * world;
      gl_Position = projectionMatrix * mvPosition;`);
    shader.fragmentShader = 'varying float vFade;\n' + shader.fragmentShader.replace('#include <alphatest_fragment>', `
      #include <alphatest_fragment>
      if (vFade <= 0.001) discard;
      diffuseColor.a *= vFade;`);
  };
  impostorMaterial.customProgramCacheKey = () => 'tree-impostor-v1';
}
let impostorsEnabled = qualityLevel > 0;
function buildImpostors(tile, trees) {
  const keep = trees.id.map((id, i) => world.brokenProps.has(id) ? -1 : i).filter(i => i >= 0);
  if (!keep.length) return;
  const geometry = impostorGeometry.clone(), groundY = new Float32Array(keep.length * 3);
  const mesh = new THREE.InstancedMesh(geometry, impostorMaterial, keep.length), color = new THREE.Color(), ids = new Map();
  keep.forEach((i, k) => {
    pointVec.set(trees.x[i] - tile.position.x, 0, trees.z[i] - tile.position.z); quaternion.setFromAxisAngle(upAxis, trees.turn[i]);
    scaleVec.setScalar(trees.size[i]); matrix.compose(pointVec, quaternion, scaleVec); mesh.setMatrixAt(k, matrix);
    groundY.set([trees.fineY[i] - .1, trees.coarseY[i] - .1, trees.ultraY[i] - .1], k * 3);
    mesh.setColorAt(k, color.setHSL(.28 + (hash(i, k, seed) - .5) * .05, .2 + hash(k, i, seed) * .1, .27 + hash(i, i, seed) * .06));
    ids.set(trees.id[i], k);
  });
  geometry.setAttribute('groundY', new THREE.InstancedBufferAttribute(groundY, 3));
  mesh.visible = impostorsEnabled; mesh.frustumCulled = false; mesh.name = 'Tree impostors';
  tile.add(mesh); tile.userData.impostors = { mesh, ids };
}
function disposeTile(tile) {
  scene.remove(tile); tile.geometry.dispose();
  if (tile.userData.impostors) { tile.userData.impostors.mesh.geometry.dispose(); tile.userData.impostors.mesh.dispose(); }
}
function refreshUltraTile(tile) {
  const { cx: tx, cz: tz } = tile.userData, hasFar = (fx, fz) => farTiles.has(`${fx},${fz}`);
  const coverage = ultraCoverage(tx, tz, hasFar);
  if (tile.userData.coverage === coverage) return;
  tile.geometry.setIndex(ultraIndices(tx, tz, hasFar));
  tile.userData.coverage = coverage;
}
function refreshFarTile(tx, tz) {
  const tile = farTiles.get(`${tx},${tz}`);
  if (!tile) return;
  const hasFine = (cx, cz) => chunks.get(`${cx},${cz}`)?.group.visible;
  const coverage = farCoverage(tx, tz, hasFine);
  if (tile.userData.coverage === coverage) return;
  tile.geometry.setIndex(farIndices(tx, tz, hasFine));
  tile.userData.coverage = coverage;
}
function desired(job) {
  if (job.kind === 'water') return waterSystem.wants(job.lake.id);
  if (job.kind === 'distant-water') return true;
  const cx = Math.floor(vehicle.x / CHUNK), cz = Math.floor(vehicle.z / CHUNK);
  if (job.kind === 'ultra') return Math.max(Math.abs(job.cx - Math.floor(vehicle.x / ULTRA_SIZE)), Math.abs(job.cz - Math.floor(vehicle.z / ULTRA_SIZE))) <= ULTRA_VIEW;
  return job.kind === 'near' ? Math.max(Math.abs(job.cx - cx), Math.abs(job.cz - cz)) <= view + 1
    : Math.max(Math.abs(job.cx - Math.floor(vehicle.x / FAR_SIZE)), Math.abs(job.cz - Math.floor(vehicle.z / FAR_SIZE))) <= FAR_VIEW;
}
function streamWorld(force = false) {
  const cx = Math.floor(vehicle.x / CHUNK), cz = Math.floor(vehicle.z / CHUNK);
  if (!force && cx === lastCX && cz === lastCZ) return;
  const syncStarted = performance.now();
  lastCX = cx; lastCZ = cz;
  const waterJobs = profiler.measure('waterSync', () => waterSystem.sync(world, vehicle.x, vehicle.z));
  const fx = Math.floor(vehicle.x / FAR_SIZE), fz = Math.floor(vehicle.z / FAR_SIZE);
  for (const [key, chunk] of chunks) {
    const ring = Math.max(Math.abs(chunk.cx - cx), Math.abs(chunk.cz - cz));
    chunk.group.visible = ring <= view;
    if (ring > view + 1) { disposeChunk(chunk); chunks.delete(key); }
  }
  for (const [key, tile] of farTiles) {
    if (Math.max(Math.abs(tile.userData.cx - fx), Math.abs(tile.userData.cz - fz)) > FAR_VIEW) {
      disposeTile(tile); farTiles.delete(key);
    } else refreshFarTile(tile.userData.cx, tile.userData.cz);
  }
  const ux = Math.floor(vehicle.x / ULTRA_SIZE), uz = Math.floor(vehicle.z / ULTRA_SIZE);
  for (const [key, tile] of ultraTiles) {
    if (Math.max(Math.abs(tile.userData.cx - ux), Math.abs(tile.userData.cz - uz)) > ULTRA_VIEW) { disposeTile(tile); ultraTiles.delete(key); }
    else refreshUltraTile(tile);
  }
  const existing = new Set([...pending.values()].map(job => job.kind === 'water' ? `water:${job.lake.id}` : `${job.kind}:${job.cx},${job.cz}`));
  const queuedDistant = jobs.find(job => job.kind === 'distant-water');
  jobs = queuedDistant ? [queuedDistant] : [];
  function enqueue(kind, x, z, priority) {
    if ({ near: chunks, far: farTiles, ultra: ultraTiles }[kind].has(`${x},${z}`) || existing.has(`${kind}:${x},${z}`)) return;
    jobs.push({ kind, cx: x, cz: z, seed, generation, id: ++jobId, priority });
  }
  // Tiles ahead of a fast car or plane load first, in every tier.
  const speed = Math.hypot(vehicle.vx, vehicle.vz), ahead = (dx, dz) => speed > 1 && (dx || dz) ? (dx * vehicle.vx + dz * vehicle.vz) / (Math.hypot(dx, dz) * speed) * Math.min(speed / 40, 1) : 0;
  for (let dx = -view - 1; dx <= view + 1; dx++) for (let dz = -view - 1; dz <= view + 1; dz++) {
    const ring = Math.max(Math.abs(dx), Math.abs(dz));
    enqueue('near', cx + dx, cz + dz, (ring > view ? 100 : 0) + Math.hypot(dx, dz) - ahead(dx, dz) * 1.5);
  }
  // Far and horizon tiles interleave with near chunks instead of waiting for
  // all of them: at flying speed new near chunks never stop arriving.
  for (let dx = -FAR_VIEW; dx <= FAR_VIEW; dx++) for (let dz = -FAR_VIEW; dz <= FAR_VIEW; dz++) enqueue('far', fx + dx, fz + dz, 1 + Math.hypot(dx, dz) * 1.5 - ahead(dx, dz) * 1.5);
  for (let dx = -ULTRA_VIEW; dx <= ULTRA_VIEW; dx++) for (let dz = -ULTRA_VIEW; dz <= ULTRA_VIEW; dz++) enqueue('ultra', ux + dx, uz + dz, .5 + Math.hypot(dx, dz) - ahead(dx, dz));
  for (const lake of waterJobs) if (!existing.has(`water:${lake.id}`)) {
    jobs.push({ kind: 'water', lake, seed, generation, id: ++jobId,
      priority: 2 + Math.max(0, Math.hypot(lake.x - vehicle.x, lake.z - vehicle.z) - Math.max(lake.rx, lake.rz)) / CHUNK });
  }
  if (!queuedDistant && Math.hypot(vehicle.x - distantAt.x, vehicle.z - distantAt.z) > 500 && ![...pending.values()].some(job => job.kind === 'distant-water')) {
    distantAt = { x: vehicle.x, z: vehicle.z };
    jobs.push({ kind: 'distant-water', x: vehicle.x, z: vehicle.z, seed, generation, id: ++jobId, priority: 3 });
  }
  jobs.sort((a, b) => a.priority - b.priority);
  profiler.record('streamSync', performance.now() - syncStarted);
}
function worldReady() {
  for (let dx = -view; dx <= view; dx++) for (let dz = -view; dz <= view; dz++) if (!chunks.has(`${lastCX + dx},${lastCZ + dz}`)) return false;
  return farTiles.size === (FAR_VIEW * 2 + 1) ** 2 && ultraTiles.size === (ULTRA_VIEW * 2 + 1) ** 2 && waterSystem.ready && distantReady;
}
function drivable() {
  // Flight never touches chunk geometry: the surface is procedural. Pausing a
  // plane mid-air while scenery streams would only look like a hitch.
  if (vehicle.flying) return true;
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (!chunks.has(`${lastCX + dx},${lastCZ + dz}`)) return false;
  return true;
}
function processStreaming() {
  if (!worker || streamError || natureError) return;
  const budgetStart = performance.now();
  // Worker messages are installed within a frame budget, rather than all at
  // once. At most three jobs are in flight, keeping memory and upload work bounded.
  while (nature && completed.length && performance.now() - budgetStart < 4) {
    const job = completed.shift(); pending.delete(job.id);
    if (job.generation !== generation || !desired(job)) continue;
    if (job.kind === 'water') {
      profiler.measure('waterInstall', () => waterSystem.install(job.lake, job.water));
    } else if (job.kind === 'distant-water') {
      profiler.measure('distantWaterInstall', () => waterSystem.installDistant(job.water, job.ranges)); distantReady = true;
    } else if (job.kind === 'near') {
      buildChunk(job);
      chunks.get(`${job.cx},${job.cz}`).group.visible = Math.max(Math.abs(job.cx - lastCX), Math.abs(job.cz - lastCZ)) <= view;
      refreshFarTile(Math.floor(job.cx / 4), Math.floor(job.cz / 4));
    } else if (job.kind === 'ultra') {
      const tile = new THREE.Mesh(geometryFromData(job.ground), terrainMaterial);
      tile.position.set(job.cx * ULTRA_SIZE, 0, job.cz * ULTRA_SIZE);
      tile.userData = { cx: job.cx, cz: job.cz };
      ultraTiles.set(`${job.cx},${job.cz}`, tile); refreshUltraTile(tile); scene.add(tile);
    } else {
      const tile = new THREE.Mesh(geometryFromData(job.ground), terrainMaterial);
      tile.position.set(job.cx * FAR_SIZE, 0, job.cz * FAR_SIZE);
      tile.userData = { cx: job.cx, cz: job.cz }; tile.receiveShadow = true;
      farTiles.set(`${job.cx},${job.cz}`, tile); refreshFarTile(job.cx, job.cz); scene.add(tile);
      buildImpostors(tile, job.trees);
      const parent = ultraTiles.get(`${Math.floor(job.cx / 4)},${Math.floor(job.cz / 4)}`); if (parent) refreshUltraTile(parent);
    }
  }
  profiler.record('streamInstall', performance.now() - budgetStart);
  while (pending.size < 3 && jobs.length) {
    const job = jobs.shift(); if (!desired(job)) continue;
    pending.set(job.id, job); worker.postMessage(job);
  }
  if (loading) {
    const total = (view * 2 + 1) ** 2 + (FAR_VIEW * 2 + 1) ** 2 + (ULTRA_VIEW * 2 + 1) ** 2;
    const count = [...chunks.values()].filter(chunk => chunk.group.visible).length + farTiles.size + ultraTiles.size;
    $('startBtn').firstElementChild.textContent = carError ? 'Unable to load the car' : !nature ? 'Preparing scenery' : worldReady() && !carReady ? 'Preparing your car' : `Preparing the world · ${Math.min(99, Math.floor(count / total * 100))}%`;
    if (worldReady() && carReady) {
      loading = false; $('startBtn').disabled = false; $('startBtn').firstElementChild.textContent = started ? 'Keep exploring' : 'Start exploring';
      resetTiming(); resetCamera(); updateHUD(); drawMap();
      profiler.record('worldLoad', performance.now() - loadingStarted);
      document.dispatchEvent(new Event('worldready'));
      if (resumeAfterLoad) resume();
      resumeAfterLoad = false;
    }
  }
}
function beginWorldLoad(continueDriving = false) {
  if (running) pause();
  worker?.terminate(); generation++; pending.clear(); completed = []; jobs = [];
  loading = true; resumeAfterLoad = continueDriving; running = false; streamError = null; loadingStarted = performance.now();
  $('startBtn').disabled = true; resetTiming();
  for (const chunk of chunks.values()) disposeChunk(chunk); chunks.clear();
  for (const tile of farTiles.values()) disposeTile(tile); farTiles.clear();
  for (const tile of ultraTiles.values()) disposeTile(tile); ultraTiles.clear();
  terrain = createTerrain(world);
  waterSystem.clear(); distantAt = { x: Infinity, z: Infinity }; distantReady = false;
  worker = new Worker(new URL('./world-worker.mjs?v=physics-11', import.meta.url), { type: 'module' });
  const failed = message => { streamError = message; running = false; $('loadError').hidden = false; $('startBtn').firstElementChild.textContent = 'Unable to prepare the world'; };
  worker.onerror = error => failed(error.message);
  worker.onmessage = ({ data }) => {
    if (data.generation !== generation) return;
    if (data.error) { failed(data.error); return; }
    profiler.record(data.kind === 'water' ? 'workerWater' : 'workerBuild', data.workMs); completed.push(data);
  };
  lastCX = lastCZ = Infinity; streamWorld(true);
}
function nearbyObstacles() {
  const cx = Math.floor(vehicle.x / CHUNK), cz = Math.floor(vehicle.z / CHUNK), result = [];
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) result.push(...(chunks.get(`${cx + dx},${cz + dz}`)?.props || []));
  return result;
}

// The editable Blender model is exported as a locally bundled, animated glTF rig.
const car = new THREE.Group(); scene.add(car); car.rotation.order = 'YXZ';
let body = new THREE.Group(), wheelPivots = [], wheelSpinners = [];
let headMat = material('#f9efce'), brakeMat = material('#af3c25');
let carReady = false, carError = null, carTriangles = 0, carBatching = [];
let transformation = null, flightRig = null, propeller = null, propellerAngle = 0;
loadVehicleModel(renderer).then(asset => {
  car.add(asset.model);
  ({ body, wheelPivots, wheelSpinners, headMat, brakeMat, transformation, propeller } = asset); flightRig = asset.flight;
  carTriangles = asset.triangles; carBatching = asset.batching; carReady = true;
}).catch(error => {
  carError = error.message;
  $('loadError').hidden = false;
  $('startBtn').firstElementChild.textContent = 'Unable to load the car';
  console.error('Vehicle model failed to load:', error);
});
const headlight = new THREE.SpotLight('#ffe4b1', 0, 60, .5, .5, 1.2); headlight.position.set(0, 1.5, 2);
const lightTarget = new THREE.Object3D(); lightTarget.position.set(0, 0, 25); car.add(headlight, lightTarget); headlight.target = lightTarget;
// Soft contact shadow makes the height of jumps easy to judge.
const shadowCanvas = document.createElement('canvas'); shadowCanvas.width = shadowCanvas.height = 64;
const shadowContext = shadowCanvas.getContext('2d'), shadowGradient = shadowContext.createRadialGradient(32, 32, 2, 32, 32, 32);
shadowGradient.addColorStop(0, 'rgba(20,27,20,.36)'); shadowGradient.addColorStop(1, 'rgba(20,27,20,0)');
shadowContext.fillStyle = shadowGradient; shadowContext.fillRect(0, 0, 64, 64);
const contact = new THREE.Mesh(new THREE.PlaneGeometry(3.9, 6), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shadowCanvas), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
contact.rotation.x = -Math.PI / 2; scene.add(contact);

// Left/right placement of a world point as heard from the camera.
const cameraRight = new THREE.Vector3(), shadowAhead = new THREE.Vector3(), farAhead = new THREE.Vector3();
function panAt(x, z) {
  cameraRight.setFromMatrixColumn(camera.matrixWorld, 0);
  const dx = x - camera.position.x, dz = z - camera.position.z;
  return Math.max(-1, Math.min(1, (dx * cameraRight.x + dz * cameraRight.z) / Math.max(4, Math.hypot(dx, dz)))) * .8;
}
const heard = { impact: 0, wingStrikes: 0, wingCrashes: 0, surface: 'road', surfaceCheck: 0, flightThump: -1 };
function updateSound(throttle, splashes, dt) {
  const v = vehicle;
  if ((heard.surfaceCheck -= dt) <= 0) {
    heard.surfaceCheck = .25;
    heard.surface = v.onRoad ? 'road' : world.desertAt(v.x, v.z) || world.waterAt(v.x, v.z) || world.lakesNear(v.x, v.z, 0).length ? 'sand' : 'dirt';
  }
  const slip = Math.abs(v.vx * Math.cos(v.heading) - v.vz * Math.sin(v.heading));
  audio.vehicle.update({ speed: v.speed, throttle, grounded: v.grounded, floating: v.floating, flying: v.flying, airspeed: v.airspeed, transform: v.transform, flight: v.flight, slip, surface: heard.surface, waterDepth: v.waterDepth }, dt);
  // Events: a fresh rise in impact is a landing, bounce or knock; splashes come
  // from the water; the flight model counts wing strikes and scrapes.
  const decayed = heard.impact * Math.exp(-8 * dt);
  // Skimming the ground in flight hops many times a second; only a real bounce
  // (not every graze) thumps, and at most every 0.8 s.
  const t = audio.context.currentTime;
  if (v.impact > decayed + .03 && !v.floating && !splashes.length && (!v.flightMode || (v.impact > .1 && t - heard.flightThump > .8))) {
    audio.vehicle.thump(v.impact); if (v.flightMode) heard.flightThump = t;
  }
  heard.impact = v.impact;
  for (const splash of splashes) audio.vehicle.splash(splash.power, panAt(splash.x, splash.z));
  if ((v.wingStrikes || 0) > heard.wingStrikes && v.lastStrike) audio.vehicle.strike(v.lastStrike.heavy, panAt(v.lastStrike.x, v.lastStrike.z));
  if ((v.wingCrashes || 0) > heard.wingCrashes) audio.vehicle.scrape(.8);
  heard.wingStrikes = v.wingStrikes || 0; heard.wingCrashes = v.wingCrashes || 0;
}
let audio = null;
function initAudio() {
  if (audio) { audio.context.resume(); return; }
  try {
    const context = new AudioContext(), master = context.createGain(), limiter = context.createDynamicsCompressor();
    master.gain.value = muted ? 0 : 1;
    limiter.threshold.value = -10; limiter.knee.value = 12; limiter.ratio.value = 4;
    master.connect(limiter).connect(context.destination);
    const sounds = createVehicleAudio(context, master);
    audio = { context, master, vehicle: sounds, breaks: createBreakAudio(context, master, 8, sounds.echo) };
  } catch {}
}
function syncSound() {
  $('soundBtn').innerHTML = `<svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4V5Z"/>${muted ? '<path d="m16 9 5 6m0-6-5 6"/>' : '<path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>'}</svg>`;
  $('soundBtn').setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
}
function toggleSound() {
  muted = !muted; if (!muted) initAudio();
  if (audio) { audio.master.gain.cancelScheduledValues(audio.context.currentTime); audio.master.gain.setValueAtTime(muted ? 0 : 1, audio.context.currentTime); }
  try { localStorage.setItem('endless-drive-muted', muted ? '1' : '0'); } catch {} syncSound();
}
$('soundBtn').onclick = toggleSound;
function saveRecord() { bestDistance = Math.max(bestDistance, vehicle.distance); if (!testMode) try { localStorage.setItem('endless-drive-records', JSON.stringify({ distance: bestDistance })); } catch {} }
let toastTimer;
function toast(text) { $('toast').textContent = text; $('toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('show'), 2600); }
function clearInput() { releaseSlider(false); keyStates.clear(); touchStates.clear(); for (const k in input) input[k] = false; document.querySelectorAll('[data-control]').forEach(el => el.classList.remove('active')); }
function syncInput() {
  for (const k of ['up', 'down', 'left', 'right', 'jump', 'brake']) input[k] = [...keyStates].some(code => keyMap[code] === k) || [...touchStates.values()].includes(k);
  const touches = [...touchStates.values()];
  for (const [axis, codes] of Object.entries(flightKeys)) input[axis] = codes.some(code => keyStates.has(code)) || touches.includes(flightTouch[axis]);
  // Analog axes add to the digital keys; physics clamps the combined value.
  input.steer = slider.pointer === null ? undefined : steerAxis(slider.value, settings.sensitivity);
}
const throttleInput = () => controlAxis(input.throttle, input.up, input.down);
function resume() {
  if ($('startBtn').disabled) return;
  running = true; started = true; resetTiming(); auto?.reset(performance.now());
  $('menu').classList.add('closed'); $('menu').inert = true; $('menu').setAttribute('aria-hidden', 'true');
  $('pauseBtn').hidden = false; document.body.classList.add('driving'); renderer.domElement.focus({ preventScroll: true });
  if (!muted) initAudio();
}
function pause() {
  if (!running) return;
  running = false; clearInput(); saveRecord(); document.body.classList.remove('driving');
  if (audio) audio.context.suspend();
  $('menu').classList.remove('closed'); $('menu').inert = false; $('menu').removeAttribute('aria-hidden'); $('pauseBtn').hidden = true;
  $('menuTitle').innerHTML = 'Room to<br><em>breathe.</em>'; $('menuCopy').innerHTML = 'Your road will still be here.<br>Pick up where you left off.';
  $('startBtn').firstElementChild.textContent = 'Keep exploring'; $('menuStats').hidden = false;
  $('pauseTools').hidden = false;
  $('runDistance').textContent = (vehicle.distance / 1000).toFixed(2); $('bestDistance').textContent = (bestDistance / 1000).toFixed(2);
  $('startBtn').focus({ preventScroll: true });
}
function resetTiming() {
  accumulator = 0; previousTime = performance.now(); frame.lastNow = previousTime;
  uiTime = mapTime = 0;
  vehiclePresentation.reset(vehicle);
  updateDesiredCamera();
  previousDesiredCamera.copy(desiredCamera); previousLook.copy(look);
  previousTargetFov = camera.fov;
}
function resetCamera() {
  updateDesiredCamera();
  cameraPosition.copy(desiredCamera); cameraTarget.copy(look);
  previousDesiredCamera.copy(desiredCamera); previousLook.copy(look);
  cameraPosition.y = Math.max(cameraPosition.y, world.surface(cameraPosition.x, cameraPosition.z) + 1.8);
  camera.position.copy(cameraPosition); camera.lookAt(cameraTarget);
}
function newWorld() {
  const continueDriving = running || resumeAfterLoad && loading;
  saveRecord(); clearInput(); seed = freshSeed(); world = createWorld(seed); vehicle = createVehicle(world); roadUniforms.uRoadPhase.value = world.phase;
  debris.clear(); treeBreakage?.clear(); audio?.breaks.clear(); audio?.vehicle.clear();
  const url = new URL(location.href); url.searchParams.set('seed', seed); history.replaceState(null, '', url);
  beginWorldLoad(continueDriving); resetCamera(); syncSeed(); updateHUD(); drawMap();
  reportedLanding = 0; reportedBoat = false; reportedFlying = false; reportedAutopilot = false; clouds.reset(seed); $('runDistance').textContent = '0.00'; toast('A new road ahead. World ' + seed);
}
function syncSeed() { $('seedTxt').textContent = String(seed).padStart(6, '0'); }
$('startBtn').onclick = resume; $('pauseBtn').onclick = pause; $('newWorld').onclick = newWorld;
function recover() {
  if (profiler.measure('recovery', () => recoverVehicle(vehicle, world))) { reportedFlying = vehicle.flying; streamWorld(); resetTiming(); resetCamera(); updateHUD(); toast('Back on your wheels.'); }
}
function toggleFly() {
  const on = toggleFlight(vehicle);
  toast(on ? vehicle.grounded || vehicle.floating ? `Wings out — lift off at ${Math.round(TAKEOFF_SPEED * 3.6)} km/h` : 'Wings out — glide!'
    : vehicle.flying ? 'Folding wings — touch down anywhere' : 'Wings stowed');
  updateHUD();
}
$('flyBtn').addEventListener('pointerdown', e => { e.preventDefault(); if (running) toggleFly(); });
function toggleAutopilot() {
  if (!vehicle.flying) { toast(vehicle.flightMode ? `Autopilot engages once airborne — lift off at ${Math.round(TAKEOFF_SPEED * 3.6)} km/h` : 'Autopilot works in the air — press F to fly'); return; }
  const on = setAutopilot(vehicle, !vehicle.autopilot, world);
  reportedAutopilot = on;
  toast(on ? `Autopilot on · holding ${Math.round(vehicle.autopilotY - world.surface(vehicle.x, vehicle.z))} m at ${Math.round(AUTOPILOT_SPEED * 3.6)} km/h · any control takes over` : 'Autopilot off — you have control');
  updateHUD();
}
$('autoBtn').addEventListener('pointerdown', e => { e.preventDefault(); if (running) toggleAutopilot(); });
function cycleCamera() {
  cameraMode = (cameraMode + 1) % 3; resetCamera();
  $('cameraBtn').textContent = 'Camera: ' + ['Chase', 'Wide', 'Bonnet'][cameraMode];
  toast(['Chase camera', 'Wide camera', 'Bonnet camera'][cameraMode]);
}
$('recoverBtn').onclick = () => { recover(); resume(); };
$('cameraBtn').onclick = cycleCamera;
document.querySelector('.brand').onclick = e => { e.preventDefault(); if (running) pause(); };
$('copySeed').onclick = async () => {
  const url = new URL(location.href); url.searchParams.set('seed', seed);
  try { await navigator.clipboard.writeText(url.href); toast('World link copied. Bring a friend.'); } catch { history.replaceState(null, '', url); toast('Your world link is in the address bar.'); }
};
addEventListener('keydown', e => {
  if (e.code === 'Escape' || e.code === 'KeyP') { e.preventDefault(); if (!e.repeat && started) running ? pause() : resume(); return; }
  if (keyMap[e.code]) {
    if (running) {
      e.preventDefault();
      // Queue the edge at event time: a quick tap can begin AND end between
      // physics ticks, especially on a slower display or while streaming.
      if (e.code === 'Space' && !e.repeat) vehicle.jumpBuffer = .16;
      keyStates.add(e.code); syncInput();
    }
    return;
  }
  if (e.repeat) return;
  if (e.code === 'KeyM') toggleSound();
  if (!running) return;
  if (e.code === 'KeyC') cycleCamera();
  if (e.code === 'KeyR') recover();
  if (e.code === 'KeyF') toggleFly();
  if (e.code === 'KeyT') toggleAutopilot();
  if (e.code === 'KeyN') newWorld();
  if (e.code === 'KeyL') { lightsOn = !lightsOn; headlight.intensity = lightsOn ? 75 : 0; headMat.emissiveIntensity = lightsOn ? 2 : .45; toast(lightsOn ? 'Headlights on' : 'Headlights off'); }
});
addEventListener('keyup', e => { keyStates.delete(e.code); syncInput(); });
addEventListener('blur', () => { clearInput(); pause(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
addEventListener('beforeunload', saveRecord);
for (const el of document.querySelectorAll('[data-control]')) {
  el.addEventListener('pointerdown', e => { e.preventDefault(); if (!running) return; el.setPointerCapture(e.pointerId); if (el.dataset.control === 'jump') vehicle.jumpBuffer = .16; touchStates.set(e.pointerId, el.dataset.control); el.classList.add('active'); syncInput(); });
  const release = e => { touchStates.delete(e.pointerId); el.classList.remove('active'); syncInput(); };
  el.addEventListener('pointerup', release); el.addEventListener('pointercancel', release); el.addEventListener('lostpointercapture', release);
}
// Keep keyboard focus within the visible menu without trapping gameplay controls.
$('menu').addEventListener('keydown', e => {
  if (e.key !== 'Tab') return;
  const buttons = [...$('menu').querySelectorAll('button:not([disabled])')].filter(b => b.offsetParent !== null);
  const first = buttons[0], last = buttons.at(-1);
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

function applyQuality(index) {
  qualityLevel = index;
  const level = levels[index];
  renderer.setPixelRatio(Math.min(devicePixelRatio, level.pixelRatio));
  if (sun.shadow.mapSize.x !== level.shadow) {
    sun.shadow.mapSize.setScalar(level.shadow);
    // Three.js only allocates the shadow target once; release it to resize.
    sun.shadow.map?.dispose(); sun.shadow.map = null;
  }
  setFarShadow(level.farShadow);
  grass.setQuality(level.grass);
  // Distant tree stand-ins are skipped on Low.
  impostorsEnabled = index > 0;
  for (const tile of farTiles.values()) if (tile.userData.impostors) tile.userData.impostors.mesh.visible = impostorsEnabled;
  // Low draws one wave layer with no reflected clouds, sparkle or caustics.
  waterSystem.setDetail(index > 0);
  syncSettings();
}
const qualityNames = { auto: 'Auto', low: 'Low', medium: 'Medium', high: 'High' };
function syncSettings() {
  const level = levels[qualityLevel].name;
  $('qualityBtn').textContent = `Graphics: ${qualityNames[settings.quality]}${auto ? ` · ${level === 'medium+' ? 'Medium+' : qualityNames[level]}` : ''}`;
  $('sensitivity').value = Math.round(settings.sensitivity * 100);
  $('sensitivityValue').textContent = `${Math.round(settings.sensitivity * 100)}%`;
}
$('qualityBtn').onclick = () => {
  settings.quality = QUALITY_PRESETS[(QUALITY_PRESETS.indexOf(settings.quality) + 1) % QUALITY_PRESETS.length];
  applyQuality(startQuality()); saveSettings();
  toast(settings.quality === 'auto' ? 'Auto graphics adjust to your device' : `${qualityNames[settings.quality]} graphics`);
};
$('sensitivity').oninput = e => { settings.sensitivity = clamp(Number(e.target.value) / 100, .5, 1.5); saveSettings(); syncSettings(); };

// Steering slider in place of the ← → buttons. The track is fixed: the value
// is read from its center, and the knob stops at either end however far the
// finger travels.
const slider = { el: $('steerSlider'), pointer: null, value: 0 };
function releaseSlider(sync = true) {
  if (slider.pointer === null) return;
  slider.pointer = null; slider.value = 0;
  slider.el.classList.remove('active'); slider.el.querySelector('i').style.transform = ''; slider.el.setAttribute('aria-valuenow', '0');
  if (sync) syncInput();
}
function moveSlider(e) {
  const track = slider.el.getBoundingClientRect(), travel = (track.width - slider.el.querySelector('i').offsetWidth) / 2;
  slider.value = clamp((e.clientX - (track.left + track.width / 2)) / travel, -1, 1);
  slider.el.querySelector('i').style.transform = `translateX(${slider.value * travel}px)`;
  slider.el.setAttribute('aria-valuenow', String(Math.round(slider.value * 100)));
  syncInput();
}
slider.el.addEventListener('pointerdown', e => {
  e.preventDefault();
  if (!running || slider.pointer !== null) return;
  slider.el.setPointerCapture(e.pointerId); slider.pointer = e.pointerId;
  slider.el.classList.add('active'); moveSlider(e);
});
slider.el.addEventListener('pointermove', e => { if (e.pointerId === slider.pointer) moveSlider(e); });
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) slider.el.addEventListener(type, e => { if (e.pointerId === slider.pointer) releaseSlider(); });

const mapContext = $('minimap').getContext('2d');
function drawMap() {
  const mapStarted = performance.now();
  // The map zooms out as the plane climbs, so the view below stays useful.
  const altitude = Math.max(0, vehicle.y - world.surface(vehicle.x, vehicle.z));
  const ctx = mapContext, w = 288, h = 240, range = 155 * (1 + Math.min(1.6, altitude / 120)), scale = w / (2 * range), step = 12;
  ctx.fillStyle = '#32493b'; ctx.fillRect(0, 0, w, h);
  for (let iy = 0; iy < h; iy += step) for (let ix = 0; ix < w; ix += step) {
    const x = vehicle.x - (ix - w / 2) / scale, z = vehicle.z - (iy - h / 2) / scale, elev = world.height(x, z);
    const band = Math.floor(elev / 9), sand = world.desertAt(x, z, elev);
    ctx.fillStyle = world.waterAt(x, z) ? '#548c99' : `hsl(${mix(89 - band * 1.5, 40, sand)} ${mix(16, 38, sand)}% ${25 + band * 1.7 + sand * 13}%)`; ctx.fillRect(ix, iy, step + 1, step + 1);
  }
  ctx.strokeStyle = '#d6c99c'; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
  for (const dir of ['x', 'z']) for (let k = -1; k <= 1; k++) {
    const band = Math.round((dir === 'x' ? vehicle.z : vehicle.x) / ROAD_SPACING) + k;
    ctx.beginPath();
    for (let off = -180; off <= 180; off += 5) {
      const s = (dir === 'x' ? vehicle.x : vehicle.z) + off, c = world.roadCenter(s, band, dir);
      const x = dir === 'x' ? s : c, z = dir === 'x' ? c : s;
      const mx = w / 2 - (x - vehicle.x) * scale, my = h / 2 - (z - vehicle.z) * scale;
      if (off === -180) ctx.moveTo(mx, my); else ctx.lineTo(mx, my);
    }
    ctx.stroke();
  }
  ctx.strokeStyle = '#eee7cc18'; ctx.lineWidth = 1;
  for (let i = 24; i < w; i += 48) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, h); ctx.stroke(); }
  for (let i = 24; i < h; i += 48) { ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(w, i); ctx.stroke(); }
  for (const f of world.featuresNear(vehicle.x, vehicle.z, range * 1.4)) {
    const mx = w / 2 - (f.x - vehicle.x) * scale, my = h / 2 - (f.z - vehicle.z) * scale;
    ctx.save(); ctx.translate(mx, my); ctx.fillStyle = f.type === 'ramp' ? f.twist ? '#c69bf0' : '#ffb15e' : '#d8e4ce'; ctx.strokeStyle = '#24382e'; ctx.lineWidth = 2;
    if (f.type === 'ramp') { ctx.rotate(-f.heading); ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(7, 5); ctx.lineTo(-7, 5); ctx.closePath(); ctx.fill(); ctx.stroke(); }
    else { ctx.fillRect(-4, -4, 8, 8); ctx.strokeRect(-4, -4, 8, 8); }
    ctx.restore();
  }
  ctx.save(); ctx.translate(w / 2, h / 2); ctx.rotate(-vehicle.heading);
  ctx.fillStyle = '#f6e3b7'; ctx.shadowBlur = 10; ctx.shadowColor = '#eaca8688';
  ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(7, 9); ctx.lineTo(0, 5); ctx.lineTo(-7, 9); ctx.closePath(); ctx.fill(); ctx.restore();
  profiler.record('minimap', performance.now() - mapStarted);
}
function updateHUD() {
  const hudStarted = performance.now();
  const flying = vehicle.flying, planeMode = vehicle.flightMode || flying;
  const unfolding = vehicle.flight > 0 && vehicle.flight < 1, taxiing = vehicle.flightMode && vehicle.flight === 1 && !flying;
  const speed = Math.abs(flying ? vehicle.airspeed : vehicle.speed) * 3.6;
  $('speed').textContent = Math.round(speed); $('speedBar').style.width = clamp(speed / 340 * 100, 0, 100) + '%';
  $('gear').textContent = flying ? 'A' : vehicle.boatMode ? 'B' : speed < 1 ? 'N' : vehicle.speed < 0 ? 'R' : 'D';
  $('distance').textContent = (vehicle.distance / 1000).toFixed(2);
  const transforming = vehicle.transform > 0 && vehicle.transform < 1;
  $('modeKey').textContent = vehicle.floating && !planeMode ? 'W / S' : 'SPACE';
  $('modeAction').textContent = planeMode ? 'climb' : vehicle.floating ? 'throttle' : 'jump';
  $('brakeAction').textContent = planeMode ? 'dive' : vehicle.floating ? 'slow' : 'drift';
  $('flyAction').textContent = planeMode ? 'land' : 'fly';
  const touchJump = document.querySelector('[data-control="jump"]');
  touchJump.disabled = vehicle.floating && !planeMode;
  touchJump.textContent = planeMode ? 'CLIMB' : 'JUMP'; touchJump.setAttribute('aria-label', planeMode ? 'Climb' : 'Jump');
  const touchBrake = document.querySelector('[data-control="brake"]');
  touchBrake.textContent = planeMode ? 'DIVE' : vehicle.floating ? 'SLOW' : 'DRIFT';
  touchBrake.setAttribute('aria-label', planeMode ? 'Dive' : vehicle.floating ? 'Slow boat' : 'Drift');
  document.body.classList.toggle('plane-mode', planeMode);
  $('flyBtn').textContent = planeMode ? 'LAND' : 'FLY'; $('flyBtn').setAttribute('aria-label', planeMode ? 'Land' : 'Fly');
  $('autoBtn').classList.toggle('active', Boolean(vehicle.autopilot)); $('autoBtn').setAttribute('aria-pressed', String(Boolean(vehicle.autopilot)));
  $('autopilotAction').textContent = vehicle.autopilot ? 'auto off' : 'auto';
  const altitude = vehicle.y - world.surface(vehicle.x, vehicle.z);
  $('surfaceState').textContent = flying && vehicle.autopilot ? 'AUTOPILOT' : flying ? vehicle.alpha > .24 || vehicle.airspeed < STALL_SPEED ? 'STALL WARNING — LOWER THE NOSE' : vehicle.flightMode ? 'FLYING' : 'GLIDING IN TO LAND'
    : unfolding ? vehicle.flightMode ? 'WINGS UNFOLDING' : 'FOLDING WINGS' : taxiing ? 'TAXIING' : transforming ? vehicle.boatMode ? 'DEPLOYING BOAT HULL' : 'RETURNING TO WHEELS' : vehicle.boatMode ? 'BOAT MODE' : !vehicle.grounded ? 'A LITTLE AIR' : input.brake && speed > 10 ? 'TAKE IT SIDEWAYS' : vehicle.onRoad ? 'ON THE ROAD' : 'OFF THE BEATEN PATH';
  $('airtime').textContent = flying ? `ALT ${Math.round(altitude)} M · ${vehicle.vy >= 0 ? '+' : '−'}${Math.abs(vehicle.vy).toFixed(0)} M/S`
    : unfolding ? `WINGS · ${Math.round(vehicle.flight * 100)}%` : taxiing ? `LIFT-OFF AT ${Math.round(TAKEOFF_SPEED * 3.6)} KM/H` : transforming ? `TRANSFORMING · ${Math.round((vehicle.boatMode ? vehicle.transform : 1 - vehicle.transform) * 100)}%` : vehicle.floating ? `${vehicle.waterDepth.toFixed(1)} M WATER · W/S THROTTLE` : !vehicle.grounded ? `${Math.round(vehicle.airDistance)} M · ${vehicle.airtime.toFixed(1)} S AIR` : vehicle.bestJump > 5 ? 'BEST JUMP ' + Math.round(vehicle.bestJump) + ' M' : vehicle.bestAir > .4 ? 'BEST AIR ' + vehicle.bestAir.toFixed(1) + ' S' : 'READY TO ROAM';
  const lake = world.lakesNear(vehicle.x, vehicle.z, 700).sort((a, b) => Math.hypot(a.x - vehicle.x, a.z - vehicle.z) - Math.hypot(b.x - vehicle.x, b.z - vehicle.z))[0];
  if (lake) {
    const angle = Math.atan2(lake.x - vehicle.x, lake.z - vehicle.z) - vehicle.heading;
    const arrow = Math.cos(angle) < -.5 ? '↓' : Math.sin(angle) > .2 ? '↖' : Math.sin(angle) < -.2 ? '↗' : '↑';
    $('lakeHint').textContent = vehicle.floating ? 'RETURN TO SHORE TO DRIVE' : `${arrow} ${lake.sea ? 'SEA' : 'LAKE'} ${Math.round(Math.max(0, Math.hypot(lake.x - vehicle.x, lake.z - vehicle.z) - Math.min(lake.rx, lake.rz)))} M · AUTO BOAT`;
  } else $('lakeHint').textContent = 'DEEP WATER TRANSFORMS YOUR CAR';
  const ramps = world.featuresNear(vehicle.x, vehicle.z, 450).filter(f => f.type === 'ramp').sort((a, b) => Math.hypot(a.x - vehicle.x, a.z - vehicle.z) - Math.hypot(b.x - vehicle.x, b.z - vehicle.z));
  if (ramps.length) {
    const ramp = ramps[0], angle = Math.atan2(ramp.x - vehicle.x, ramp.z - vehicle.z) - vehicle.heading;
    $('rampHint').textContent = `${Math.sin(angle) > .2 ? '↖' : Math.sin(angle) < -.2 ? '↗' : Math.cos(angle) < 0 ? '↓' : '↑'} ${ramp.twist ? 'ROLL RAMP' : 'RAMP'} ${Math.round(Math.hypot(ramp.x - vehicle.x, ramp.z - vehicle.z))} M`;
  } else $('rampHint').textContent = 'EXPLORE FOR MORE RAMPS';
  const headings = ['N', 'NW', 'W', 'SW', 'S', 'SE', 'E', 'NE'];
  $('headingTxt').textContent = headings[((Math.round(vehicle.heading / (Math.PI / 4)) % 8) + 8) % 8];
  $('biomeTxt').textContent = vehicle.waterDepth > 0 ? world.waterAt(vehicle.x, vehicle.z)?.lake.name ?? 'THE LAKES' : world.desertAt(vehicle.x, vehicle.z) > .55 ? 'THE SANDLANDS' : world.mountainAt(vehicle.x, vehicle.z) > .62 ? 'THE HIGHLANDS' : world.woodlandAt(vehicle.x, vehicle.z) > .58 ? 'PINE COUNTRY' : 'OPEN MEADOW';
  $('coordinates').textContent = `${Math.round(Math.abs(vehicle.x))} ${vehicle.x < 0 ? 'E' : 'W'} · ${Math.round(Math.abs(vehicle.z))} ${vehicle.z >= 0 ? 'N' : 'S'}`;
  $('elevation').textContent = Math.round(flying ? vehicle.y : vehicle.floating ? vehicle.waterLevel : world.surface(vehicle.x, vehicle.z)) + ' M';
  profiler.record('hud', performance.now() - hudStarted);
}
const vehiclePosition = new THREE.Vector3(), cameraPosition = new THREE.Vector3(), cameraTarget = new THREE.Vector3(), desiredCamera = new THREE.Vector3(), forward = new THREE.Vector3(), look = new THREE.Vector3();
const previousDesiredCamera = new THREE.Vector3(), previousLook = new THREE.Vector3(), attitude = new THREE.Quaternion();
let previousTargetFov = camera.fov;
const debris = createDebris(scene), rollPivot = new THREE.Vector3();
let treeBreakage = null;
const vehiclePresentation = createVehiclePresentation(vehicle, (x, z, heading) => groundAt(world, x, z, heading).y);
let previousTime = performance.now(), accumulator = 0, uiTime = 0, mapTime = 0, idleRenderAt = 0, reportedLanding = 0;
let reportedBoat = vehicle.boatMode, reportedFlying = vehicle.flying, reportedAutopilot = false;
function updateDesiredCamera(pose = vehicle) {
  vehiclePosition.set(pose.x, pose.y, pose.z);
  // In flight the camera follows the nose in three dimensions, so it stays
  // behind the plane through climbs, dives and loops (and never rolls).
  if (pose.useAttitude ?? pose.flying) forward.set(0, 0, 1).applyQuaternion(attitude.set(pose.qx, pose.qy, pose.qz, pose.qw));
  else forward.set(Math.sin(pose.heading), 0, Math.cos(pose.heading));
  if (!started) {
    desiredCamera.set(pose.x - 8.5, pose.y + 4.6, pose.z - 11.8);
    look.set(pose.x + 2.7, pose.y + 1.2, pose.z + 3.5);
  } else if (cameraMode === 2 && running) {
    desiredCamera.copy(vehiclePosition).addScaledVector(forward, .7); desiredCamera.y += 1.91;
    look.copy(vehiclePosition).addScaledVector(forward, 25); look.y += 1.65;
  } else {
    const compact = camera.aspect < .85;
    // Wings out, the camera pulls back and up so the whole span stays in view.
    const wings = pose.flight ?? 0;
    const distance = ((cameraMode === 1 ? 18 : 10.6 + Math.abs(pose.speed) * .027) + wings * (cameraMode === 1 ? 8 : 7)) * (compact ? 1.4 : 1);
    desiredCamera.copy(vehiclePosition).addScaledVector(forward, -distance); desiredCamera.y += (cameraMode === 1 ? 10 : compact ? 5.8 : 4.7) + wings * 2.2;
    look.copy(vehiclePosition).addScaledVector(forward, (cameraMode === 1 ? 5 : 7) + wings * 8); look.y += 1.4;
  }
}
function render(dt) {
  const pose = vehiclePresentation.sample(running ? accumulator / FIXED_DT : 1);
  streamUniforms.uStreamCenter.value.set(pose.x, pose.z);
  for (const chunk of chunks.values()) grass.update(chunk.grassMesh, chunk.cx, chunk.cz, pose.x, pose.z);
  if (pose.useAttitude) car.quaternion.set(pose.qx, pose.qy, pose.qz, pose.qw);
  else car.rotation.set(pose.pitch, pose.heading, pose.roll, 'YXZ');
  rollPivot.set(0, 1, 0).applyQuaternion(car.quaternion);
  car.position.set(pose.x - rollPivot.x, pose.y + 1 - rollPivot.y, pose.z - rollPivot.z);
  if (transformation) profiler.measure('transformAnimation', () => { transformation.update(pose.transform); flightRig.update(pose.flight); });
  if (propeller) { propellerAngle += dt * pose.flight * (18 + Math.abs(pose.speed) * .45); propeller.rotation.z = propellerAngle; }
  body.position.y = -pose.impact * .3 * (1 - pose.transform);
  body.rotation.z = -pose.steer * Math.min(Math.abs(pose.speed) / 25, 1) * .055 * (1 - pose.transform) * (1 - pose.flight);
  const throttle = throttleInput();
  body.rotation.x = (throttle > 0 ? -.012 * throttle : -.024 * throttle) * (1 - pose.transform);
  wheelSpinners.forEach(w => w.rotation.x = pose.wheelAngle);
  wheelPivots.forEach(p => { if (p.name.startsWith('Wheel_F')) p.rotation.y = pose.steer * .4 * (1 - pose.transform); });
  brakeMat.emissiveIntensity = throttle < -.05 || input.brake ? 2 : .25;
  car.visible = cameraMode !== 2 || !running;
  contact.position.set(pose.x, world.surface(pose.x, pose.z) + .035, pose.z);
  contact.rotation.set(-Math.PI / 2 + pose.pitch, 0, -pose.heading, 'YXZ');
  // The contact shadow helps judge jumps; high above the ground it fades out.
  const height = pose.y - pose.groundY;
  contact.material.opacity = clamp(1 - height * .13, .25, 1) * (1 - smoothstep(8, 30, height));
  updateDesiredCamera(pose);
  followTarget(cameraPosition, previousDesiredCamera, desiredCamera, 5, !started || cameraMode === 2 && running ? 0 : dt);
  cameraPosition.y = Math.max(cameraPosition.y, world.surface(cameraPosition.x, cameraPosition.z) + 1.8);
  camera.position.copy(cameraPosition);
  followTarget(cameraTarget, previousLook, look, 8, !started ? 0 : dt);
  camera.lookAt(cameraTarget);
  const targetFov = cameraMode === 2 ? 67 : 57 + (reducedMotion ? 0 : Math.min(Math.abs(pose.speed) * .15, 10));
  const nextFov = followValue(camera.fov, previousTargetFov, targetFov, 2.45, dt);
  previousTargetFov = targetFov;
  if (Math.abs(camera.fov - nextFov) > 1e-6) { camera.fov = nextFov; camera.updateProjectionMatrix(); }
  sky.position.copy(camera.position);
  clouds.update(camera);
  // From the air, see further: fog recedes onto the horizon terrain tier as
  // the camera climbs, and the near plane moves out to keep depth precision.
  const aloft = smoothstep(40, 320, camera.position.y - world.surface(camera.position.x, camera.position.z));
  scene.fog.near = fogUniforms.uFogNear.value = 350 + aloft * 900;
  scene.fog.far = fogUniforms.uFogFar.value = 1450 + aloft * 2900;
  const near = cameraMode === 2 && running ? .1 : .1 + aloft * 1.4;
  if (Math.abs(camera.near - near) > .02) { camera.near = near; camera.updateProjectionMatrix(); }
  // The 96 m shadow map sits 18 m ahead of the car along the view, where the
  // ground is actually seen, so shadows fade in well ahead even at speed.
  camera.getWorldDirection(shadowAhead).setY(0);
  if (shadowAhead.lengthSq() < 1e-4) shadowAhead.set(Math.sin(pose.heading), 0, Math.cos(pose.heading));
  shadowAhead.normalize().multiplyScalar(18).add(car.position);
  sun.position.set(shadowAhead.x - 65, pose.y + 100, shadowAhead.z + 45); sun.target.position.copy(shadowAhead); sun.target.updateMatrixWorld();
  if (farSun.castShadow) {
    camera.getWorldDirection(farAhead).setY(0);
    if (farAhead.lengthSq() < 1e-4) farAhead.set(Math.sin(pose.heading), 0, Math.cos(pose.heading));
    farAhead.normalize().multiplyScalar(FAR_SHADOW_AHEAD).add(car.position);
    farSun.target.position.copy(farAhead); farSun.position.copy(farAhead).addScaledVector(sunDirection, 320); farSun.target.updateMatrixWorld();
  }
  profiler.measure('waterUpdate', () => waterSystem.update(world, pose, dt));
  const splashes = waterSystem.drainSplashes();
  if (audio && running && !muted) profiler.measure('audio', () => updateSound(throttle, splashes, dt));
  const renderStarted = performance.now();
  renderer.render(scene, camera);
  profiler.record('renderCPU', performance.now() - renderStarted, testMode ? { time: pose.time, transform: pose.transform, wakes: waterSystem.wakeCount } : undefined);
}
function frame(now) {
  requestAnimationFrame(frame);
  const frameStarted = performance.now();
  // Test mode catches up to real time even at software-rendering frame rates
  // (~4 fps); physics still advances in identical fixed steps.
  const dt = clamp((now - previousTime) / 1000, 0, testMode ? .5 : .1); previousTime = now;
  if (document.hidden) return;
  if (running) profiler.record('frame', (now - (frame.lastNow || now)));
  // Auto quality reacts to sustained frame intervals while actually driving.
  if (auto && running && !loading && drivable() && frame.lastNow) {
    const next = auto.sample(now - frame.lastNow, now);
    if (next !== null) { applyQuality(next); settings.autoLevel = next; saveSettings(); }
  }
  frame.lastNow = now;
  const wasLoading = loading;
  processStreaming();
  // Loading completion resets the clock; do not apply this frame’s old delta.
  if (wasLoading && !loading) { render(0); return; }
  if (!running) { if (now - idleRenderAt < (loading ? 100 : 200)) return; idleRenderAt = now; }
  if (running && drivable()) {
    const physicsStarted = performance.now();
    accumulator += dt;
    const obstacles = nearbyObstacles();
    while (accumulator >= FIXED_DT) {
      stepVehicle(vehicle, input, world, obstacles);
      vehiclePresentation.advance(vehicle, FIXED_DT); accumulator -= FIXED_DT;
    }
    profiler.record('physics', performance.now() - physicsStarted);
    processBreakage(); debris.update(dt, world); treeBreakage.update(dt, world);
    if (vehicle.boatMode !== reportedBoat) {
      reportedBoat = vehicle.boatMode;
      toast(reportedBoat ? 'Deep water — deploying boat hull' : 'Shore reached — returning to wheels');
    }
    if (vehicle.flying !== reportedFlying) {
      reportedFlying = vehicle.flying;
      toast(reportedFlying ? coarse ? 'Airborne · CLIMB and DIVE pitch · AUTO flies for you · LAND folds the wings' : 'Airborne · Space climbs · Shift dives · T autopilot · F lands'
        : vehicle.floating ? 'Splashdown — back to boat' : 'Touchdown');
    }
    if (vehicle.autopilot !== reportedAutopilot) {
      reportedAutopilot = vehicle.autopilot;
      if (!reportedAutopilot && vehicle.flying) toast('Autopilot off — you have control');
    }
    if (vehicle.landings > reportedLanding) {
      reportedLanding = vehicle.landings;
      if (vehicle.airDistance > 25) toast(`${vehicle.airRoll > Math.PI ? 'Barrel roll! · ' : ''}${Math.round(vehicle.airDistance)} m jump · ${vehicle.airtime.toFixed(1)} seconds of air`);
    }
    streamWorld(); uiTime += dt; mapTime += dt;
    if (uiTime > .12) { uiTime = 0; updateHUD(); }
    if (mapTime > (coarse ? .6 : .3)) { mapTime = 0; drawMap(); }
  }
  render(running ? dt : 0);
  if (running) profiler.record('frameCPU', performance.now() - frameStarted);
}
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight);
  // Moving between displays can change devicePixelRatio.
  renderer.setPixelRatio(Math.min(devicePixelRatio, levels[qualityLevel].pixelRatio));
});
renderer.domElement.addEventListener('webglcontextlost', e => { e.preventDefault(); pause(); toast('Graphics paused. Reload to restore the drive.'); });

syncSeed(); syncSound(); syncSettings(); beginWorldLoad(); resetCamera(); updateHUD(); drawMap(); render(0);
requestAnimationFrame(frame);

profiler.record('initialLoad', performance.now() - bootStarted);
if (testMode) window.__driveTest = { resetMetrics: () => profiler.reset(), snapshot: () => {
  const visibleGrass = [...chunks.values()].filter(c => c.group.visible && c.grassMesh?.visible);
  const grassStats = { range: grass.range, meshes: visibleGrass.length, tufts: visibleGrass.reduce((n, c) => n + c.grassMesh.geometry.instanceCount, 0) };
  let carMeshes = 0, carDraws = 0; car.traverse(o => { if (o.isMesh) carMeshes++; }); car.traverseVisible(o => { if (o.isMesh) carDraws++; });
  let hiddenProps = 0;
  for (const chunk of chunks.values()) for (const [id, refs] of chunk.propInstances) {
    if (!world.brokenProps.has(id)) continue;
    const hidden = refs.every(({ mesh, index }) => { mesh.getMatrixAt(index, matrix); return matrix.elements[0] === 0 && matrix.elements[5] === 0 && matrix.elements[10] === 0; });
    if (hidden) hiddenProps++;
  }
  const natureInstances = {};
  for (const chunk of chunks.values()) if (chunk.group.visible) chunk.group.traverse(o => { if (o.isInstancedMesh && o.userData.natureKind) natureInstances[o.userData.natureKind] = (natureInstances[o.userData.natureKind] || 0) + o.count; });
  const impostorCount = [...farTiles.values()].reduce((n, t) => n + (t.userData.impostors?.mesh.count ?? 0), 0);
  return { horizon: { ultraTiles: ultraTiles.size, impostors: impostorCount, impostorsVisible: impostorsEnabled, distantWater: waterSystem.distantCount, fogNear: scene.fog.near, fogFar: scene.fog.far, cameraNear: camera.near }, flight: { mode: vehicle.flightMode, progress: vehicle.flight, flying: vehicle.flying, autopilot: vehicle.autopilot, airspeed: vehicle.airspeed, altitude: vehicle.y - world.surface(vehicle.x, vehicle.z), propeller: propellerAngle, wingsVisible: car.getObjectByName('WingSeg1_L')?.visible ?? false, wingspan: car.getObjectByName('WingSeg3_L') ? car.getObjectByName('WingSeg3_L').getWorldPosition(new THREE.Vector3()).distanceTo(car.getObjectByName('WingSeg3_R').getWorldPosition(new THREE.Vector3())) : 0, clouds: clouds.count }, quality: { preset: settings.quality, level: levels[qualityLevel].name, pixelRatio: renderer.getPixelRatio(), shadow: sun.shadow.mapSize.x, farShadow: farSun.castShadow ? farSun.shadow.mapSize.x : 0, grassDensity: grass.density }, controls: { sensitivity: settings.sensitivity, steer: input.steer ?? null, throttle: throttleInput() }, water: { lakes: waterSystem.count, wakes: waterSystem.wakeCount }, natureAsset: { ready: Boolean(nature), error: natureError, assets: nature?.stats ?? [], instances: natureInstances }, grass: grassStats, metrics: profiler.snapshot(), draws: renderer.info.render.calls, triangles: renderer.info.render.triangles, carMeshes, carDraws, carAsset: { ready: carReady, error: carError, name: 'ATLAS Amphibious', animationDuration: transformation?.duration, hullSpan: car.getObjectByName('Hull_R')?.position.x - car.getObjectByName('Hull_L')?.position.x, triangles: carTriangles, wheelPivots: wheelPivots.map(p => p.parent.position.toArray()), wheelSteer: wheelPivots.map(p => p.rotation.y), wheelSpin: wheelSpinners.map(p => p.rotation.x), headlights: headMat.emissiveIntensity, brakes: brakeMat.emissiveIntensity }, chunks: chunks.size, farTiles: farTiles.size, loading, generation, streamError, pending: pending.size, queued: jobs.length, carBatching: carBatching.map(({ before, after }) => ({ before, after })), vehicle: { ...vehicle }, renderPose: { ...vehiclePresentation.pose }, debris: debris.count, fallingTrees: treeBreakage?.count ?? 0, sound: audio ? { muted, played: audio.breaks.played, active: audio.breaks.active, effects: audio.vehicle.played, gear: audio.vehicle.gear, masterGain: audio.master.gain.value } : null, brokenProps: world.brokenProps.size, hiddenProps, accumulator, cameraError: cameraPosition.distanceTo(desiredCamera) + cameraTarget.distanceTo(look), camera: cameraPosition.toArray(), target: cameraTarget.toArray() };
} };
