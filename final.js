import * as THREE from "https://esm.sh/three@0.160.0";

import { EffectComposer } from "https://esm.sh/three@0.160.0/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "https://esm.sh/three@0.160.0/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "https://esm.sh/three@0.160.0/examples/jsm/postprocessing/UnrealBloomPass.js";

let latestHand = null;
let lastGesture = "none";
let gestureCount = 0;
let currentStateIndex = 0;

const videoElement = document.getElementById("video");
const stateLabel = document.getElementById("stateLabel");
const instruction = document.getElementById("instruction");

let currentGesture = "none";
let confidence = 0;
const MAX_CONFIDENCE = 1;
const GROWTH = 0.05;
const DECAY = 0.03;

let phase = "gesture"; // "gesture" or "breathing"
let breathStartTime = 0;
const BREATH_DURATION = 8000; // 10 seconds (5 in, 5 out)
let bloomProgress = 0;
let targetBloom = 2.5;


const whiteFade = document.getElementById("whiteFade");
let fadeProgress = 0;
let fadeStarted = false;

const baseY = 0;
const breathAmplitude = 0.45; // how much it moves (tweak this)

const introScreen = document.getElementById("introScreen");
const beginButton = document.getElementById("beginButton");

// MEDIAPIPE SETUP
const hands = new Hands({
  locateFile: (file) =>
    `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
});

hands.setOptions({
  maxNumHands: 1,
  modelComplexity: 1,
 minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5
});

hands.onResults((results) => {
  latestHand = results.multiHandLandmarks?.[0] || null;
});


// CAMERA (MediaPipe way)
const camera = new Camera(videoElement, {
  onFrame: async () => {
    await hands.send({ image: videoElement });
  },
  width: 640,
  height: 480
});



// GESTURE DETECTION
function detectGesture() {
  if (!latestHand) return "none";

  const lm = latestHand;

  const dist = (a, b) => {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  };

 function isFingerExtended(tip, pip, mcp) {
  return tip.y < pip.y && pip.y < mcp.y;
}

  const index = isFingerExtended(lm[8], lm[6], lm[5]);
  const middle = lm[12].y < lm[10].y && lm[10].y < lm[9].y;
  const ring = isFingerExtended(lm[16], lm[14], lm[13]);
  const pinky = isFingerExtended(lm[20], lm[18], lm[17]);

  const thumb = lm[4].x < lm[3].x; // basic thumb check (needs refinement later)

  // ✊ fist
if (!index && !middle && !ring && !pinky) return "fist";

// ✌️ two (check BEFORE one/three edge cases)
if (index && middle && !ring && !pinky) return "two";

// ☝️ one
if (index && !middle && !ring && !pinky) return "one";

// 🤟 three
if (index && middle && ring && !pinky) return "three";

// ✋ four
if (index && middle && ring && pinky) return "four";

  return "none";

  console.log("index middle ring pinky:", index, middle, ring, pinky);
}



let gestureBuffer = [];

function getStableGesture() {
  const g = detectGesture();
  gestureBuffer.push(g);

  if (gestureBuffer.length > 5) gestureBuffer.shift();

  const counts = {};
  gestureBuffer.forEach(x => counts[x] = (counts[x] || 0) + 1);

  return Object.keys(counts).reduce((a, b) =>
    counts[a] > counts[b] ? a : b
  );
}

//const g = getStableGesture();



// THREE.JS SETUP (UNCHANGED)
const scene = new THREE.Scene();

const threeCamera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
threeCamera.position.set(0, 0, 2);
threeCamera.far = 100;
threeCamera.updateProjectionMatrix();

const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.8;

const composer = new EffectComposer(renderer);

const renderPass = new RenderPass(scene, threeCamera);
composer.addPass(renderPass);

const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0,     // 👈 start at ZERO
  0.4,
  0.85
);

composer.addPass(bloomPass);

// Room (sphere turned inside out)
const geometry = new THREE.SphereGeometry(5, 32, 32);
geometry.scale(-1, 1, 1);



const roomMaterial = new THREE.ShaderMaterial({
  uniforms: {
    brightness: { value: 0.2 }
  },
  vertexShader: `
    varying vec3 vWorldPosition;

    void main() {
      vec4 worldPosition = modelMatrix * vec4(position, 1.0);
      vWorldPosition = worldPosition.xyz;

      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    varying vec3 vWorldPosition;
  uniform float brightness;

  void main() {
    float y = normalize(vWorldPosition).y;

    // map -1 → 1 into 0 → 1
    float h = y * 0.5 + 0.5;

    vec3 bottom = vec3(0.0);
    vec3 top = vec3(brightness);

    vec3 color = mix(bottom, top, h);

    // floor darkening
    float floorFade = smoothstep(0.0, 0.25, h);
    color *= floorFade;

    // horizon glow
    float horizon = smoothstep(0.45, 0.5, h) - smoothstep(0.5, 0.55, h);
    color += horizon * 0.1 * brightness;

    // ceiling glow
    float ceilingGlow = smoothstep(0.7, 1.0, h);
    color += ceilingGlow * 0.2 * brightness;

    gl_FragColor = vec4(color, 1.0);
}
  `,
  side: THREE.BackSide
});



// const material = new THREE.ShaderMaterial({
//   uniforms: {
//   topColor: { value: new THREE.Color(0x444444) },
//   middleColor: { value: new THREE.Color(0x222222) },
//   bottomColor: { value: new THREE.Color(0x000000) }
//   },
//   vertexShader: `
//      varying vec3 vWorldPosition;

//   void main() {
//     vec4 worldPosition = modelMatrix * vec4(position, 1.0);
//     vWorldPosition = worldPosition.xyz;

//     gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
//   }
// `,
//   fragmentShader: `
//      varying vec3 vWorldPosition;

//   uniform vec3 topColor;
//   uniform vec3 middleColor;
//   uniform vec3 bottomColor;

//   void main() {
//     float t = normalize(vWorldPosition).y * 0.5 + 0.5;

//     vec3 color = mix(bottomColor, topColor, t);

//     gl_FragColor = vec4(color, 1.0);
//   }
// `,
//   side: THREE.BackSide
// });
const room = new THREE.Mesh(
  new THREE.SphereGeometry(5, 64, 64),
  roomMaterial
);
scene.add(room);

scene.fog = new THREE.FogExp2(0x000000, 0.15);
const centerLight = new THREE.PointLight(0xffffff, 0.5, 20);
centerLight.position.set(0, 0, 0);
scene.add(centerLight);

scene.background = new THREE.Color(0x222222);

const ambient = new THREE.AmbientLight(0xffffff, 0.05);
scene.add(ambient);



function setRoomBrightness(level) {
  const color = new THREE.Color(0x000000);

  // interpolate black → white
  color.lerp(new THREE.Color(0xffffff), level);

  material.color = new THREE.Color(0x00ff00);
}




// ANIMATION LOOP
function animate() {
  requestAnimationFrame(animate);

  updateExperience(); // logic first
  composer.render(); // render after
  
  //threeCamera.position.x = Math.sin(Date.now() * 0.0002) * 0.1;
  //threeCamera.position.y = Math.cos(Date.now() * 0.0002) * 0.1;
  threeCamera.lookAt(0, 0, 0); 

}


//PROGRESS BAR
const progressBar = document.getElementById("progressBar");

function updateProgressBar() {
  progressBar.style.width = `${confidence * 100}%`;
}


// STATES
const states = [
  {
    name: "guilt, shame, worry",
    uiColor: "red",
    brightness: 0.15,
    gesture: "fist",
    prompt: "Make a fist"
  },
  {
    name: "fear, desire, anger",
    uiColor: "orange",
    brightness: 0.3,
    gesture: "four",
    prompt: "Hold up an open hand"
  },
  {
    name: "neutrality, acceptance, willingness",
    uiColor: "yellowgreen",
    brightness: 0.5,
    gesture: "three",
    prompt: "Hold up three fingers"
  },
  {
    name: "love, joy, peace",
    uiColor: "blue",
    brightness: 0.7,
    gesture: "two",
    prompt: "Hold up two fingers"
  },
  {
    name: "enlightenment",
    uiColor: "purple",
    brightness: 1.0,
    gesture: "one",
    prompt: "Hold up one finger"
  }
];


function updateTextContrast() {
  instruction.style.color = "white";
}




// HELPERS
function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}


function updateEnvironment(stateIndex) {
  let t = states[stateIndex]?.brightness ?? 0;

  roomMaterial.uniforms.brightness.value = t;

  ambient.intensity = 0.2 + t * 0.8;
}






function setCompleteGlow() {
  let pulse = 0.5 + Math.sin(Date.now() * 0.0006) * 0.5;

  // 🌊 VERY slow convergence
  bloomProgress += (targetBloom - bloomProgress) * 0.004;

  bloomPass.strength = bloomProgress + pulse * 0.5;

  roomMaterial.uniforms.brightness.value = 0.8 + bloomProgress * 0.2;

  ambient.intensity = 0.5 + bloomProgress * 0.4;

  if (centerLight) {
    centerLight.intensity = 0.5 + bloomProgress * 1.0;
  }

  // fade starts only after long buildup
  if (bloomProgress > 1.8) {
    fadeStarted = true;
  }

  if (fadeStarted) {
    fadeProgress += 0.0025;
    whiteFade.style.opacity = fadeProgress;
  }
}



function updateGesture(expectedGesture) {
  const detected = getStableGesture();

  if (detected === expectedGesture) {
    confidence += GROWTH;
  } else {
    confidence -= DECAY;
  }

  confidence = Math.max(0, Math.min(MAX_CONFIDENCE, confidence));

  return confidence >= MAX_CONFIDENCE;
}



function updateExperience() {
  
  if (currentStateIndex >= states.length) {
  instruction.innerText = "Complete";
  bloomPass.strength = 0;
  setCompleteGlow();

  return;
}

  const state = states[currentStateIndex];

  setStateUI(state);
//   setEnvironment(currentStateIndex);
  updateEnvironment(currentStateIndex);
  updateTextContrast(currentStateIndex);
  

  if (phase === "gesture") {
    instruction.innerText = state.prompt;

    const complete = updateGesture(state.gesture);

    updateProgressBar(confidence); // still show gesture progress

    if (complete) {
      confidence = 0;
      phase = "breathing";
      breathStartTime = Date.now();
    }
  }

  else if (phase === "breathing") {
  const elapsed = Date.now() - breathStartTime;
  const progress = elapsed / BREATH_DURATION;

  updateProgressBar(progress);

  // breathing instruction
  if (progress < 0.5) {
    instruction.innerText = "Breathe in...";
  } else {
    instruction.innerText = "Breathe out...";
  }

  // 🌬️ CAMERA BREATHING MOTION
  const breathCycle = Math.sin(progress * Math.PI); 
  // 0 → 1 → 0 (perfect inhale/exhale curve)

  threeCamera.position.y = baseY + breathCycle * breathAmplitude;

  if (progress >= 1) {
    phase = "gesture";
    currentStateIndex++;
  }
}
}




// EXPERIENCE LOOP
const requiredGestures = ["fist", "four", "three", "two", "one"];


function setStateUI(state) {
  stateLabel.innerText = state.name;
  stateLabel.style.color = state.uiColor;
  stateLabel.style.textShadow = "0 0 10px rgba(0,0,0,0.5)";
  instruction.innerText = state.prompt;
}

beginButton.addEventListener("click", () => {
  // fade out intro
  introScreen.classList.add("fadeOut");

  // start experience AFTER fade
  setTimeout(() => {
    introScreen.style.display = "none";

    camera.start();
    animate();
  }, 1500);
});
