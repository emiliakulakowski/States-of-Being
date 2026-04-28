
document.body.style.overflow = "hidden";

import * as THREE from "https://esm.sh/three@0.160.0";

import { EffectComposer } from "https://esm.sh/three@0.160.0/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "https://esm.sh/three@0.160.0/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "https://esm.sh/three@0.160.0/examples/jsm/postprocessing/UnrealBloomPass.js";

// ================= FIREBASE SETUP =================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCw5i64R9yKJqDvWbT9_9sEuOZ1pB2w5P0",
  authDomain: "meditative-experience.firebaseapp.com",
  projectId: "meditative-experience",
  storageBucket: "meditative-experience.firebasestorage.app",
  messagingSenderId: "225595318315",
  appId: "1:225595318315:web:77d78df8c50fd8d09a8a6e"
};

// Initialize Firebase
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

// ================= AUDIO SETUP =================
let currentAudio = null;
let fadeOutTimeout = null;

const audioFiles = {
  intro: "396 hz.mp3",
  questions: "417 hz.mp3",
  meditation: "528 hz.mp3",
  ending: "852 hz.mp3",
  posts: "963 hz.mp3"
};

function playAudio(audioFileName) {
  // Stop current audio
  stopAudio();
  
  // Create new audio element
  currentAudio = new Audio(audioFileName);
  currentAudio.loop = false; // We'll handle looping manually with fade
  currentAudio.volume = 0.3; // 30% volume for background
  
  // Handle seamless loop with fade
  currentAudio.addEventListener("timeupdate", handleAudioLoop);
  
  currentAudio.play().catch(err => {
    console.log("Audio autoplay prevented. User interaction required:", err);
  });
}

function handleAudioLoop() {
  if (!currentAudio) return;
  
  const fadeStartTime = currentAudio.duration - 1.5; // Start fade 1.5 seconds before end
  
  if (currentAudio.currentTime >= fadeStartTime && currentAudio.currentTime < currentAudio.duration) {
    // Calculate fade progress (0 to 1)
    const timeUntilEnd = currentAudio.duration - currentAudio.currentTime;
    const fadeProgress = 1 - (timeUntilEnd / 1.5); // 1.5 second fade
    
    // Fade out the volume
    currentAudio.volume = 0.3 * (1 - fadeProgress);
  }
  
  // When audio ends, restart with fade in
  if (currentAudio.currentTime >= currentAudio.duration - 0.1) {
    currentAudio.currentTime = 0;
    currentAudio.volume = 0; // Start at 0
    currentAudio.play();
    
    // Fade in over 1.5 seconds
    const startTime = Date.now();
    const fadeDuration = 1500; // 1.5 seconds
    
    const fadeInInterval = setInterval(() => {
      if (!currentAudio) {
        clearInterval(fadeInInterval);
        return;
      }
      
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / fadeDuration, 1);
      currentAudio.volume = 0.3 * progress;
      
      if (progress >= 1) {
        clearInterval(fadeInInterval);
      }
    }, 50);
  }
}

function stopAudio() {
  if (currentAudio) {
    currentAudio.removeEventListener("timeupdate", handleAudioLoop);
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }
  
  if (fadeOutTimeout) {
    clearTimeout(fadeOutTimeout);
    fadeOutTimeout = null;
  }
}

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

const questionScreen = document.getElementById("questionScreen");
questionScreen.style.display = "none";
const questionText = document.getElementById("questionText");
const answerInput = document.getElementById("answerInput");
const nextButton = document.getElementById("nextButton");

// const questions = [
//   "What have you been stressed about?",
//   "What emotion are you hoping to let go of?",
//   "How do you want to feel right now?",
//   "What have you been hoping for in life?"
// ];

let questionStateIndex = 0;
let answers = [];
let currentQuestionIndex = 0;
let stateFade = 0;
let stateGlow = 0;


const introScreen = document.getElementById("introScreen");
const beginButton = document.getElementById("beginButton");

const endScreen = document.getElementById("endScreen");
const restartButton = document.getElementById("restartButton");
const seeAnswersButton = document.getElementById("seeAnswersButton");

const answersScreen = document.getElementById("answersScreen");
const answersContainer = document.getElementById("answersContainer");
const backButton = document.getElementById("backButton");

let endTriggered = false;



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

//BEGINNING QUESTIONS
function showQuestion() {
  const state = states[questionStateIndex];
  answerInput.value = "";
  questionText.innerText = state.question;
}

nextButton.addEventListener("click", () => {
  const answer = answerInput.value.trim();
  if (!answer) return;

  answers.push(answer);

  const state = states[questionStateIndex];

  // apply transformation directly INTO the state
  state.name = state.transform(answer);

  // Save to Firebase after 3rd answer (when questionStateIndex is 2, after incrementing it becomes 3)
  if (questionStateIndex === 2) {
    saveAnswersToFirebase(answers);
  }

  questionStateIndex++;

  if (questionStateIndex < states.length - 1) {
    showQuestion();
  } else {
    finishQuestions();
  }
});


function finishQuestions() {

  // switch UI into final mode instead of closing it
  answerInput.style.display = "none";
  nextButton.style.display = "none";

  questionText.style.opacity = 0;

setTimeout(() => {
  questionText.innerText = "When you are ready...";
  questionText.style.opacity = 1;
}, 300);
  // create begin meditation button
  const beginMeditationButton = document.createElement("button");
  beginMeditationButton.id = "beginMeditationButton";
  beginMeditationButton.innerText = "Begin Meditation";

  questionScreen.querySelector("#questionBox").appendChild(beginMeditationButton);

  beginMeditationButton.addEventListener("click", () => {
    startMeditation();
  });
}

function startMeditation() {
  // Switch to meditation audio
  playAudio(audioFiles.meditation);
  
  // fade white in
  whiteFade.style.opacity = 1;

  setTimeout(() => {

    // hide UI layer
    questionScreen.style.display = "none";

    // reset fade for later use if needed
    fadeProgress = 0;
    fadeStarted = false;
    whiteFade.style.opacity = 0;

    // start 3D experience
    camera.start();
    animate();

  }, 1500); // matches fade duration
}

// function showQuestion() {
//   const state = states[questionStateIndex];

//   questionText.innerText = state.question;
//   answerInput.value = "";
// }



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
    baseName: "guilt, shame, worry",
    uiColor: "red",
    brightness: 0.15,
    gesture: "fist",
    prompt: "Make a tight fist",

    question: "What have you been stressed about?",
    transform: (answer) => `letting go of ${answer}`
  },

  {
    baseName: "fear, desire, anger",
    uiColor: "orange",
    brightness: 0.3,
    gesture: "four",
    prompt: "Hold up an open hand",

    question: "What emotion are you hoping to release?",
    transform: (answer) => `releasing ${answer}`
  },

  {
    baseName: "neutrality, acceptance, willingness",
    uiColor: "green",
    brightness: 0.5,
    gesture: "three",
    prompt: "Hold up three fingers",

    question: "How do you want to feel right now?",
    transform: (answer) => `embodying ${answer}`
  },

  {
    baseName: "love, joy, peace",
    uiColor: "blue",
    brightness: 0.7,
    gesture: "two",
    prompt: "Hold up two fingers",

    question: "What have you been hoping for in life?",
    transform: (answer) => `channeling ${answer}`
  },

  {
    baseName: "be present in this moment",
    uiColor: "purple",
    brightness: 1.0,
    gesture: "one",
    prompt: "Hold up one finger",

    question: null,
    transform: "Complete"
  }
];


function updateTextContrast() {
  instruction.style.color = "white";
}

function brightenColor(hex, factor) {
  const color = new THREE.Color(hex);
  color.lerp(new THREE.Color(0xffffff), factor);
  return `#${color.getHexString()}`;
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

  // ✅ when fully white → show end screen
  if (fadeProgress >= 1 && !endTriggered) {
    endTriggered = true;

    setTimeout(() => {
      // Switch to ending audio
      playAudio(audioFiles.ending);
      
      endScreen.style.opacity = 1;
      endScreen.style.pointerEvents = "auto";
    }, 500);
  }
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
  
stateLabel.style.opacity = 1 - stateFade;

// disintegration feel
stateLabel.style.filter = `blur(${stateFade * 6}px)`;
stateLabel.style.letterSpacing = `${stateFade * 6}px`;
stateLabel.style.transform = `translateY(${stateFade * 20}px)`;



  // skip current state
  const isLastThree = currentStateIndex >= states.length - 3;

if (phase === "breathing") {

  const elapsed = Date.now() - breathStartTime;
const progress = elapsed / BREATH_DURATION;

// 0 → 1 inhale, 1 → 0 exhale split
const exhale = Math.max(0, (progress - 0.5) * 2);

// only glow grows on exhale
stateGlow = exhale;



  if (isLastThree) {

const state = states[currentStateIndex];

stateLabel.style.color = state.uiColor;

// REAL outer glow (animated)
const glowSize = stateGlow * 35; // grows on exhale
const glowOpacity = stateGlow;

stateLabel.style.textShadow = `
  0 0 ${glowSize}px rgba(255,255,255,${glowOpacity}),
  0 0 ${glowSize * 1.5}px ${state.uiColor}
`;

  } else {

    // always reset for first 2 states
    stateLabel.style.color = state.uiColor;
  }
}


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
     stateLabel.style.color = states[currentStateIndex].uiColor;
  } else {
    instruction.innerText = "Breathe out...";
  }

  const isFirstTwoStates = currentStateIndex < 2;

if (isFirstTwoStates && progress > 0.5) {
  // start fade-out during breathe out
  const fadeSpeed = 0.0008; // slower + smoother

if (isFirstTwoStates && progress > 0.5) {
  stateFade += fadeSpeed * (elapsed / 1000);
  stateFade = Math.min(stateFade, 1);
} else {
  stateFade *= 0.92; // smoother recovery instead of instant reset
}
} else {
  // reset for other states / inhale phase
  stateFade *= 0.9;
}

const exhale = Math.max(0, (progress - 0.5) * 2); 
const inhale = Math.max(0, (0.5 - progress) * 2);

// smooth transition state
const breathIntensity = exhale; // 0 → 1 only on exhale

stateGlow = exhale;

if (progress < 0.5 || phase === "gesture") {
  stateLabel.style.color = states[currentStateIndex].uiColor;
}

  // 🌬️ CAMERA BREATHING MOTION
  const breathCycle = Math.sin(progress * Math.PI); 
  // 0 → 1 → 0 (perfect inhale/exhale curve)

  threeCamera.position.y = baseY + breathCycle * breathAmplitude;

  if (progress >= 1) {
    phase = "gesture";
    currentStateIndex++;
    stateFade = 0;
  }
}

if (endTriggered) return;
}




// EXPERIENCE LOOP
const requiredGestures = ["fist", "four", "three", "two", "one"];


function setStateUI(state) {
  const display = state.name ?? state.baseName; 
  stateLabel.innerText = display;
  stateLabel.style.color = state.uiColor;
  instruction.innerText = state.prompt;
}

// ================= FIREBASE FUNCTIONS =================
// Save the first 3 answers to Firestore
async function saveAnswersToFirebase(firstThreeAnswers) {
  try {
    const timestamp = Date.now();
    const userId = Math.random().toString(36).substr(2, 9); // anonymous user ID
    
    await addDoc(collection(db, "responses"), {
      userId: userId,
      timestamp: timestamp,
      answers: {
        question1: firstThreeAnswers[0] || "",
        question2: firstThreeAnswers[1] || "",
        question3: firstThreeAnswers[2] || ""
      }
    });
    
    console.log("Answers saved successfully");
  } catch (error) {
    console.error("Error saving answers:", error);
  }
}

// Fetch all answers from Firestore
async function fetchAllAnswers() {
  try {
    const querySnapshot = await getDocs(collection(db, "responses"));
    const answersArray = [];
    
    querySnapshot.forEach((doc) => {
      answersArray.push(doc.data());
    });
    
    return answersArray;
  } catch (error) {
    console.error("Error fetching answers:", error);
    return [];
  }
}

// Display answers in the viewer screen
async function displayAnswers() {
  answersContainer.innerHTML = "";
  
  const allAnswers = await fetchAllAnswers();
  
  if (allAnswers.length === 0) {
    answersContainer.innerHTML = "<p style='color: black; grid-column: 1/-1; text-align: center; padding: 40px;'>No responses yet. Be the first to share!</p>";
    return;
  }
  
  const questionLabels = [
    "What have you been stressed about?",
    "What emotion are you hoping to release?",
    "How do you want to feel right now?"
  ];
  
  // Display one box per user with all 3 Q&A pairs
  allAnswers.forEach((responseData) => {
    const answers = responseData.answers;
    
    // Create a box for each user response
    const userBox = document.createElement("div");
    userBox.className = "userResponseBox";
    
    // Add all 3 Q&A pairs to the box
    for (let i = 0; i < 3; i++) {
      const answerText = answers[`question${i + 1}`];
      if (answerText) {
        const qaPair = document.createElement("div");
        qaPair.className = "qaPair";
        
        const questionLabel = document.createElement("div");
        questionLabel.className = "qaQuestion";
        questionLabel.textContent = questionLabels[i];
        
        const answerContent = document.createElement("div");
        answerContent.className = "qaAnswer";
        answerContent.textContent = answerText;
        
        qaPair.appendChild(questionLabel);
        qaPair.appendChild(answerContent);
        userBox.appendChild(qaPair);
      }
    }
    
    answersContainer.appendChild(userBox);
  });
}

// Show answers viewer screen
function showAnswersViewer() {
  // Switch to posts audio
  playAudio(audioFiles.posts);
  
  endScreen.style.opacity = 0;
  endScreen.style.pointerEvents = "none";
  
  answersScreen.classList.add("visible");
  displayAnswers();
}

// Hide answers viewer and go back to end screen
function hideAnswersViewer() {
  // Switch back to ending audio
  playAudio(audioFiles.ending);
  
  answersScreen.classList.remove("visible");
  
  endScreen.style.opacity = 1;
  endScreen.style.pointerEvents = "auto";
}


beginButton.addEventListener("click", () => {
  // Switch to questions audio
  playAudio(audioFiles.questions);
  
  introScreen.classList.add("fadeOut");

  setTimeout(() => {
    introScreen.style.display = "none";

    // 🔥 RESET WHITE FADE
    whiteFade.style.opacity = 0;
    fadeProgress = 0;
    fadeStarted = false;

    // SHOW QUESTION SCREEN
    questionScreen.style.display = "flex";

    showQuestion();
  }, 1500);
});

restartButton.addEventListener("click", () => {
  location.reload();
});

seeAnswersButton.addEventListener("click", () => {
  showAnswersViewer();
});

backButton.addEventListener("click", () => {
  hideAnswersViewer();
});

// ================= START INTRO AUDIO =================
// Play intro audio (396 Hz) when page loads
playAudio(audioFiles.intro);

console.log("question screen display:", questionScreen.style.display);
console.log("questionScreen:", questionScreen);
console.log("JS LOADED");