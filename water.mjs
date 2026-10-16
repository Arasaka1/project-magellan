import * as THREE from 'three';
import { waterWave } from './lakes.mjs?v=physics-3';

export function createWater(scene, fog = { uFogNear: { value: 350 }, uFogFar: { value: 1450 } }, streamCenter = { value: new THREE.Vector2() }) {
  const patches = new Map();
  let wanted = new Map();
  const time = { value: 0 };
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.FrontSide,
    uniforms: { uTime: time, uStreamCenter: streamCenter, uFogNear: fog.uFogNear, uFogFar: fog.uFogFar, uShallow: { value: new THREE.Color('#559e9b') }, uDeep: { value: new THREE.Color('#214f64') }, uSky: { value: new THREE.Color('#b9cdd0') } },
    vertexShader: `attribute float bedDepth; attribute vec2 lakeUV;
      uniform float uTime; varying vec3 vWorld; varying float vDepth; varying vec2 vLake;
      attribute vec2 groundY; uniform vec2 uStreamCenter;
      void main(){
        vec3 p=position;
        float wave=sin(p.x*.11+p.z*.07+uTime*1.6)*.045+sin(p.x*-.06+p.z*.14-uTime*1.2)*.025;
        p.y+=wave*smoothstep(0.,1.,bedDepth);
        // Coarse terrain tiers barely dip into a small pond's basin. Ride just
        // above whichever tier is drawn here, so distant water is never buried
        // and never fills in suddenly as the finer terrain arrives.
        float d=distance(p.xz,uStreamCenter);
        p.y=mix(mix(p.y,max(p.y,groundY.x+.3),smoothstep(220.,360.,d)),max(p.y,groundY.y+.3),smoothstep(1150.,1450.,d));
        vWorld=p;vDepth=bedDepth;vLake=lakeUV;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);
      }`,
    fragmentShader: `uniform float uTime; uniform float uFogNear,uFogFar; uniform vec3 uShallow,uDeep,uSky;
      varying vec3 vWorld; varying float vDepth; varying vec2 vLake;
      void main(){
        if(vDepth<.015||length(vLake)>1.02)discard;
        vec2 p=vWorld.xz;
        // Three crossing wave trains break up regular stripes; they calm with
        // distance so wide water reads as open sea from altitude, not corduroy.
        float far=distance(cameraPosition,vWorld), calm=1.-smoothstep(90.,650.,far)*.8;
        float a=p.x*.11+p.y*.07+uTime*1.6,b=p.x*-.06+p.y*.14-uTime*1.2,c=p.x*.23-p.y*.17+uTime*2.1,e=p.x*.031+p.y*.047-uTime*.6;
        vec2 slope=vec2(-.045*cos(a)+.028*cos(b)-.018*cos(c)-.03*cos(e),-.03*cos(a)-.06*cos(b)+.014*cos(c)-.045*cos(e))*calm;
        vec3 n=normalize(vec3(slope.x,1.,slope.y));
        vec3 view=normalize(cameraPosition-vWorld),light=normalize(vec3(-.55,.85,.35));
        float fresnel=pow(1.-max(dot(n,view),0.),3.);
        float glint=pow(max(dot(n,normalize(view+light)),0.),150.);
        float ripple=sin(p.x*2.1+p.y*.7+uTime*1.7)*sin(p.y*1.6-uTime)*.013*calm;
        vec3 color=mix(uShallow,uDeep,smoothstep(.3,7.,vDepth));
        color=mix(color,uSky,fresnel*.58)+ripple+vec3(.8,.84,.7)*glint*.55;
        float edge=(1.-smoothstep(.15,.9,vDepth))*(.45+.3*sin(p.x*.7+p.y*.6-uTime*2.));
        color=mix(color,vec3(.7,.83,.76),edge*.65);
        color=mix(color,uSky,smoothstep(uFogNear,uFogFar,distance(cameraPosition,vWorld)));
        // Close up, shallows show the bed. Further away the terrain beneath is
        // a coarse tier just under the surface (sand-coloured near shores), so
        // the water turns opaque instead of revealing it.
        gl_FragColor=vec4(color,mix(mix(.75,.97,smoothstep(0.,1.8,vDepth)),1.,smoothstep(200.,400.,far)));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  });
  function install(lake, data) {
    // The stream coordinator also rejects previous-world generations. This
    // guards late results for lakes left behind, and duplicate results.
    if (wanted.get(lake.id)?.level !== lake.level || patches.has(lake.id)) return false;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(data.position, 3));
    geometry.setAttribute('bedDepth', new THREE.BufferAttribute(data.bedDepth, 1));
    geometry.setAttribute('lakeUV', new THREE.BufferAttribute(data.lakeUV, 2));
    geometry.setAttribute('groundY', new THREE.BufferAttribute(data.groundY, 2));
    geometry.setIndex(new THREE.BufferAttribute(data.index, 1)); geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material); mesh.name = lake.name; mesh.renderOrder = 1;
    scene.add(mesh); patches.set(lake.id, mesh); refreshDistant();
    return true;
  }
  function sync(world, x, z) {
    const lakes = world.lakesNear(x, z, 1000);
    wanted = new Map(lakes.map(l => [l.id, l]));
    let removed = false;
    for (const [id, mesh] of patches) if (!wanted.has(id)) { scene.remove(mesh); mesh.geometry.dispose(); patches.delete(id); removed = true; }
    if (removed) refreshDistant();
    return lakes.filter(lake => !patches.has(lake.id));
  }
  // Beyond the detailed patches, every lake and sea out to the far horizon is
  // one worker-built mesh. Each lake's part is dropped from the index while
  // its detailed patch is installed, so the two never overlap or leave a gap.
  const distant = new THREE.Mesh(new THREE.BufferGeometry(), material);
  distant.renderOrder = 1; distant.frustumCulled = false; distant.name = 'Distant water'; scene.add(distant);
  let distantRanges = [], distantIndex = null, distantCount = 0;
  function refreshDistant() {
    if (!distantIndex) return;
    const visible = distantRanges.filter(range => !patches.has(range.id));
    const index = new Uint32Array(visible.reduce((n, range) => n + range.count, 0));
    let at = 0;
    for (const range of visible) { index.set(distantIndex.subarray(range.start, range.start + range.count), at); at += range.count; }
    distant.geometry.setIndex(new THREE.BufferAttribute(index, 1));
    distantCount = visible.length;
  }
  function installDistant(data, ranges) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(data.position, 3));
    geometry.setAttribute('bedDepth', new THREE.BufferAttribute(data.bedDepth, 1));
    geometry.setAttribute('lakeUV', new THREE.BufferAttribute(data.lakeUV, 2));
    geometry.setAttribute('groundY', new THREE.BufferAttribute(data.groundY, 2));
    distant.geometry.dispose(); distant.geometry = geometry;
    distantRanges = ranges; distantIndex = data.index;
    refreshDistant();
  }
  const capacity = 80, ripples = [], dummy = new THREE.Object3D();
  const wakeGeometry = new THREE.RingGeometry(.85, 1, 28).rotateX(-Math.PI / 2);
  const opacity = new Float32Array(capacity);
  wakeGeometry.setAttribute('wakeOpacity', new THREE.InstancedBufferAttribute(opacity, 1).setUsage(THREE.DynamicDrawUsage));
  const wakeMaterial = new THREE.ShaderMaterial({ transparent: true, depthWrite: false,
    vertexShader: `attribute float wakeOpacity; varying float alpha;
      void main(){alpha=wakeOpacity;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}`,
    fragmentShader: `varying float alpha; void main(){gl_FragColor=vec4(.81,.91,.84,alpha);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`
  });
  const wakes = new THREE.InstancedMesh(wakeGeometry, wakeMaterial, capacity); wakes.frustumCulled = false; wakes.count = 0; wakes.name = 'Wakes'; wakes.renderOrder = 2; scene.add(wakes);
  wakes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  let emission = 0;
  function update(world, pose, dt) {
    time.value = pose.time; emission += dt;
    const water = world.waterAt(pose.x, pose.z);
    if (water && pose.y < water.level + .2 && emission >= (Math.abs(pose.speed) > 1 ? .085 : .6)) {
      emission = 0;
      const s = Math.sin(pose.heading), c = Math.cos(pose.heading);
      for (const side of [-1, 1]) {
        if (ripples.length >= capacity) ripples.shift();
        ripples.push({ x: pose.x - s * 2.25 + c * side * (1 + pose.transform * .5), z: pose.z - c * 2.25 - s * side * (1 + pose.transform * .5), level: water.level, age: 0, heading: pose.heading, power: Math.min(1, .18 + Math.abs(pose.speed) / 15) });
      }
    }
    for (let i = ripples.length - 1; i >= 0; i--) { ripples[i].age += dt; if (ripples[i].age > 2.8) ripples.splice(i, 1); }
    ripples.forEach((r, i) => {
      dummy.position.set(r.x, r.level + .055 + waterWave(r.x, r.z, pose.time), r.z);
      dummy.rotation.set(0, r.heading, 0); dummy.scale.set(.22 + r.age * .7, 1, .38 + r.age * 1.2); dummy.updateMatrix();
      wakes.setMatrixAt(i, dummy.matrix); opacity[i] = r.power * (1 - r.age / 2.8) * .46;
    });
    wakes.count = ripples.length;
    if (ripples.length) { wakes.instanceMatrix.needsUpdate = true; wakeGeometry.attributes.wakeOpacity.needsUpdate = true; }
  }
  function clear() {
    for (const mesh of patches.values()) { scene.remove(mesh); mesh.geometry.dispose(); }
    patches.clear(); wanted.clear(); ripples.length = 0; wakes.count = 0; emission = 0;
    distant.geometry.dispose(); distant.geometry = new THREE.BufferGeometry(); distantRanges = []; distantIndex = null; distantCount = 0;
  }
  return { sync, install, update, clear, installDistant, get distantCount() { return distantCount; }, wants: id => wanted.has(id), get ready() { return patches.size === wanted.size; },
    get count() { return patches.size; }, get wakeCount() { return ripples.length; } };
}
