const scene = new THREE.Scene();

// Camera with optimized near/far planes to prevent depth buffer dithering and z-fighting
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.4, 250);
camera.position.set(0, 1.7, 5);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85; // Lower exposure to prevent "burned" whites
renderer.physicallyCorrectLights = false;
document.body.insertBefore(renderer.domElement, document.body.firstChild);

// --- Procedural Micro-Texture Generators (Architectural Realism) ---
function createProceduralNoiseTexture(width = 512, height = 512, contrast = 30) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(width, height);
    for (let i = 0; i < imgData.data.length; i += 4) {
        const val = Math.floor(128 + (Math.random() - 0.5) * contrast);
        imgData.data[i] = val;
        imgData.data[i+1] = val;
        imgData.data[i+2] = val;
        imgData.data[i+3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(8, 8);
    return tex;
}

const wallNoiseTex = createProceduralNoiseTexture(512, 512, 40);
wallNoiseTex.repeat.set(12, 12);
const floorNoiseTex = createProceduralNoiseTexture(512, 512, 25);
floorNoiseTex.repeat.set(16, 16);

// --- Sky & Atmosphere (Smooth & Realistic) ---
function createSkyTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 2048; canvas.height = 1024;
    const ctx = canvas.getContext('2d');
    
    // Smooth atmospheric horizon gradient (Enhanced contrast)
    const gradient = ctx.createLinearGradient(0, 0, 0, 1024);
    gradient.addColorStop(0, '#1e3a8a');    // Deep Zenith blue for better sky contrast
    gradient.addColorStop(0.45, '#3b82f6'); // Vibrant Sky blue
    gradient.addColorStop(0.7, '#bae6fd');  // Crisp Horizon light
    gradient.addColorStop(1, '#ec4899');    // Richer Pink atmosphere tint
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 2048, 1024);
    
    // Ultra-soft volumetric clouds
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)'; // Slightly softer clouds
    ctx.filter = 'blur(30px)';
    for(let i = 0; i < 35; i++) {
        const cx = Math.random() * 2048;
        const cy = 150 + Math.random() * 350; 
        const rx = 120 + Math.random() * 180;
        const ry = 40 + Math.random() * 60;
        
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
    }
    
    const tex = new THREE.CanvasTexture(canvas);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.wrapS = THREE.RepeatWrapping;
    return tex;
}
const skyTex = createSkyTexture();
scene.background = skyTex;

// Sky bounce & soft atmosphere fog
scene.fog = new THREE.FogExp2(0xebdce5, 0.007); 

// --- High Contrast Cinematic Lighting ---
const ambientLight = new THREE.AmbientLight(0xffe3ec, 0.45); // Increased to soften shadows
scene.add(ambientLight);

// Hemisphere Light for natural sky-ground gradient fill
const hemiLight = new THREE.HemisphereLight(0x7dd3fc, 0x831843, 0.45); // Brightened for softer look
scene.add(hemiLight);

// Key Directional Light (Sunlight) with clean soft shadows
const dirLight = new THREE.DirectionalLight(0xfff7ed, 0.75); // Lowered sun intensity to reduce harshness
dirLight.position.set(40, 50, -30); // Higher angle for dramatic shadows
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
dirLight.shadow.camera.near = 10;
dirLight.shadow.camera.far = 120;
dirLight.shadow.camera.left = -60;
dirLight.shadow.camera.right = 60;
dirLight.shadow.camera.top = 60;
dirLight.shadow.camera.bottom = -60;
dirLight.shadow.bias = -0.0001;
dirLight.shadow.radius = 12.0;
scene.add(dirLight);

// Global State
let isEditMode = false;
let isDragging = false;
let currentShapeType = 'flower';
let currentColor = '#ff3366';
let hoveredObject = null;
let editingObject = null;
const placedObjects = [];
const collidableObjects = [];
const placeableSurfaces = [];

// --- High-Fidelity Post-Processing (Safe Initialization with Fallback) ---
let composer = null;
let fxaaPass = null;
function initPostProcessing() {
    try {
        const renderScene = new THREE.RenderPass(scene, camera);
        composer = new THREE.EffectComposer(renderer);
        composer.addPass(renderScene);

        // SSAO (Ambient Occlusion) safely tuned
        if (typeof THREE.SSAOPass !== 'undefined') {
            try {
                const ssaoPass = new THREE.SSAOPass(scene, camera, window.innerWidth, window.innerHeight);
                ssaoPass.kernelRadius = 16;
                ssaoPass.minDistance = 0.005;
                ssaoPass.maxDistance = 0.1;
                ssaoPass.output = THREE.SSAOPass.OUTPUT.Default;
                composer.addPass(ssaoPass);
            } catch (e) {
                console.warn("SSAO Pass failed to initialize, skipping:", e);
            }
        }

        // Bloom - Subtle highlight glow
        if (typeof THREE.UnrealBloomPass !== 'undefined') {
            try {
                const bloomPass = new THREE.UnrealBloomPass(
                    new THREE.Vector2(window.innerWidth, window.innerHeight),
                    0.22, // strength
                    0.5,  // radius
                    0.82  // threshold
                );
                composer.addPass(bloomPass);
            } catch (e) {
                console.warn("Bloom Pass failed to initialize, skipping:", e);
            }
        }

        // Anti-Aliasing (FXAA)
        if (typeof THREE.FXAAShader !== 'undefined') {
            try {
                fxaaPass = new THREE.ShaderPass(THREE.FXAAShader);
                fxaaPass.material.uniforms['resolution'].value.set(1 / window.innerWidth, 1 / window.innerHeight);
                composer.addPass(fxaaPass);
            } catch (e) {
                console.warn("FXAA Pass failed to initialize, skipping:", e);
            }
        }
    } catch (err) {
        console.error("Post-processing initialization error, falling back to direct WebGL renderer:", err);
        composer = null;
    }
}
initPostProcessing();

// --- Procedural Base Maps (Preserving original colors) ---
function createProceduralWallTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 512;
    const ctx = canvas.getContext('2d');
    
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 512, 512);
    
    // Stucco / Plaster variations
    ctx.fillStyle = 'rgba(0,0,0,0.02)';
    for(let i=0; i<300; i++) {
        ctx.beginPath();
        ctx.arc(Math.random()*512, Math.random()*512, Math.random()*50, 0, Math.PI*2);
        ctx.fill();
    }
    
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(10, 10);
    return tex;
}

function createProceduralFloorTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 512;
    const ctx = canvas.getContext('2d');
    
    ctx.fillStyle = '#f5f5f5';
    ctx.fillRect(0, 0, 512, 512);
    
    // Add subtle grain
    const imgData = ctx.getImageData(0, 0, 512, 512);
    for (let i = 0; i < imgData.data.length; i += 4) {
        const noise = (Math.random() - 0.5) * 8;
        imgData.data[i] = Math.min(255, Math.max(0, imgData.data[i] + noise));
        imgData.data[i+1] = Math.min(255, Math.max(0, imgData.data[i+1] + noise));
        imgData.data[i+2] = Math.min(255, Math.max(0, imgData.data[i+2] + noise));
    }
    ctx.putImageData(imgData, 0, 0);
    
    // Tiles / Grid
    ctx.strokeStyle = 'rgba(0,0,0,0.05)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, 2); ctx.lineTo(512, 2);
    ctx.moveTo(2, 0); ctx.lineTo(2, 512);
    ctx.stroke();
    
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(50, 50); // 100x100 floor
    return tex;
}

const wallMapTex = createProceduralWallTexture();
const floorMapTex = createProceduralFloorTexture();

// --- Architectural PBR Materials (Plaster & Polished Concrete) ---
const wallMat = new THREE.MeshStandardMaterial({ 
    color: 0xfafafa, // Blanco muy suave para que no queme la luz
    roughness: 0.9,  // Alto roughness para evitar brillos molestos
    metalness: 0.0
});
const floorMat = new THREE.MeshPhysicalMaterial({ 
    color: 0xffffff, // Let the floorMapTex control the f5f5f5 color
    map: floorMapTex,
    roughness: 0.22, 
    metalness: 0.08,
    bumpMap: floorNoiseTex,
    bumpScale: 0.002,
    clearcoat: 0.4,
    clearcoatRoughness: 0.25
});

function createSurface(x, y, z, w, h, d, mat, isFloor = false) {
    const geo = new THREE.BoxGeometry(w, h, d);
    geo.computeBoundingBox();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    scene.add(mesh);
    if(isFloor || h > 0.5) collidableObjects.push(mesh);
    placeableSurfaces.push(mesh);
}

createSurface(0, -0.5, 0, 100, 1, 100, floorMat, true);

createSurface(0, 10, -50, 100, 20, 2, wallMat);
createSurface(0, 10, 50, 100, 20, 2, wallMat);
createSurface(-50, 10, 0, 2, 20, 100, wallMat);
createSurface(50, 10, 0, 2, 20, 100, wallMat);

// Grid-aligned walls so they NEVER cross the room centers at (±7.5, ±22.5)
const mazeSpacing = 15;
for (let i = -30; i < 30; i += mazeSpacing) {
    for (let j = -30; j <= 30; j += mazeSpacing) {
        if (i >= -15 && i < 15 && j > -15 && j < 15) continue; 
        if (Math.random() > 0.5) createSurface(i + 7.5, 5, j, mazeSpacing, 10, 1.5, wallMat); 
    }
}
for (let i = -30; i <= 30; i += mazeSpacing) {
    for (let j = -30; j < 30; j += mazeSpacing) {
        if (i > -15 && i < 15 && j >= -15 && j < 15) continue; 
        if (Math.random() > 0.5) createSurface(i, 5, j + 7.5, 1.5, 10, mazeSpacing, wallMat); 
    }
}

// 1. A Square Pool
const poolMat = new THREE.MeshPhysicalMaterial({ color: 0x00aaff, roughness: 0.1, metalness: 0.8, clearcoat: 1.0, transparent: true, opacity: 0.8 });
const pool = new THREE.Mesh(new THREE.BoxGeometry(10, 0.1, 10), poolMat);
pool.position.set(22.5, 0.05, 22.5);
pool.receiveShadow = true;
scene.add(pool);

// Frames
const frameMat = new THREE.MeshPhysicalMaterial({ color: 0x111111, roughness: 0.6, metalness: 0.2, clearcoat: 0.1 });
const canvasMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0.0, clearcoat: 0.0 });

function createFrame(x, y, z, w, h, rotationY) {
    const frameMesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.1), frameMat);
    const canvasMesh = new THREE.Mesh(new THREE.BoxGeometry(w - 0.2, h - 0.2, 0.12), canvasMat);
    const group = new THREE.Group();
    group.add(frameMesh);
    group.add(canvasMesh);
    group.position.set(x, y, z);
    group.rotation.y = rotationY;
    scene.add(group);
    
    const placeableGeo = new THREE.BoxGeometry(w, h, 0.12);
    placeableGeo.computeBoundingBox();
    const hitBox = new THREE.Mesh(placeableGeo, new THREE.MeshBasicMaterial({visible: false}));
    hitBox.position.set(x, y, z);
    hitBox.rotation.y = rotationY;
    scene.add(hitBox);
    placeableSurfaces.push(hitBox);
}

for(let i = -30; i <= 30; i += 20) {
    createFrame(i, 3, -48.8, 5, 6, 0); 
    createFrame(i, 3, 48.8, 5, 6, Math.PI); 
    createFrame(-48.8, 3, i, 5, 6, Math.PI/2); 
    createFrame(48.8, 3, i, 5, 6, -Math.PI/2); 
}

// Particles
const particleCount = 1200;
const particleGeo = new THREE.BufferGeometry();
const particlePos = new Float32Array(particleCount * 3);
for(let i = 0; i < particleCount * 3; i++) {
    particlePos[i] = (Math.random() - 0.5) * 100;
    if (i % 3 === 1) particlePos[i] = Math.random() * 20; 
}
particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePos, 3));
const particleMat = new THREE.PointsMaterial({
    color: 0xffffff, size: 0.04, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending
});
const particles = new THREE.Points(particleGeo, particleMat);
scene.add(particles);

// Controls
const controls = new THREE.PointerLockControls(camera, document.body);
const pauseMenu = document.getElementById('pause-menu');

document.getElementById('btn-resume').addEventListener('click', () => controls.lock());
controls.addEventListener('lock', () => pauseMenu.classList.add('hidden'));
controls.addEventListener('unlock', () => { if (!isEditMode) pauseMenu.classList.remove('hidden'); });
pauseMenu.classList.add('hidden');
document.addEventListener('click', (e) => {
    if (!isEditMode && !controls.isLocked && (e.target.tagName === 'CANVAS' || e.target.id === 'gradient-overlay')) {
        controls.lock();
    }
});

// --- Highly Organic Shape Geometries ---
// 1. Flower
const flowerShape = new THREE.Shape();
for(let i=0; i<=64; i++) {
    const theta = (i/64) * Math.PI * 2;
    const r = 0.15 + 0.1 * Math.cos(4 * theta); 
    const x = Math.cos(theta) * r;
    const y = Math.sin(theta) * r;
    if(i===0) flowerShape.moveTo(x,y);
    else flowerShape.lineTo(x,y);
}
const flowerGeo = new THREE.ExtrudeGeometry(flowerShape, { depth: 0.1, bevelEnabled: true, bevelSegments: 16, steps: 2, bevelSize: 0.05, bevelThickness: 0.08 });
flowerGeo.center();
flowerGeo.computeBoundingBox();

// 2. Leaf
const leafGeo = new THREE.TorusKnotGeometry(0.2, 0.08, 128, 32, 2, 5);
leafGeo.computeBoundingBox();

// 3. Sphere
const sphereGeo = new THREE.SphereGeometry(0.3, 64, 64);
sphereGeo.computeBoundingBox();

// 4. Heart
const heartShape = new THREE.Shape();
heartShape.moveTo(0, 0.1);
heartShape.bezierCurveTo(0, 0.1, -0.05, 0, -0.15, 0);
heartShape.bezierCurveTo(-0.3, 0, -0.3, 0.2, -0.3, 0.2);
heartShape.bezierCurveTo(-0.3, 0.35, -0.15, 0.45, 0, 0.6);
heartShape.bezierCurveTo(0.15, 0.45, 0.3, 0.35, 0.3, 0.2);
heartShape.bezierCurveTo(0.3, 0.2, 0.3, 0, 0.15, 0);
heartShape.bezierCurveTo(0.05, 0, 0, 0.1, 0, 0.1);
const heartGeo = new THREE.ExtrudeGeometry(heartShape, { depth: 0.1, bevelEnabled: true, bevelSegments: 8, steps: 2, bevelSize: 0.05, bevelThickness: 0.05 });
heartGeo.center();
heartGeo.rotateZ(Math.PI);
heartGeo.computeBoundingBox();

// 5. Star
const starShape = new THREE.Shape();
const numPoints = 6;
const outerR = 0.3;
const innerR = 0.12;
for (let i = 0; i < numPoints; i++) {
    const theta = (i * 2 * Math.PI) / numPoints;
    const nextTheta = ((i + 1) * 2 * Math.PI) / numPoints;
    const midTheta = (theta + nextTheta) / 2;
    const p0x = Math.cos(theta) * outerR;
    const p0y = Math.sin(theta) * outerR;
    const p1x = Math.cos(nextTheta) * outerR;
    const p1y = Math.sin(nextTheta) * outerR;
    if (i === 0) starShape.moveTo(p0x, p0y);
    const cpX = Math.cos(midTheta) * (innerR * 0.5);
    const cpY = Math.sin(midTheta) * (innerR * 0.5);
    starShape.quadraticCurveTo(cpX, cpY, p1x, p1y);
}
const starGeo = new THREE.ExtrudeGeometry(starShape, { depth: 0.1, bevelEnabled: true, bevelSegments: 16, steps: 2, bevelSize: 0.04, bevelThickness: 0.08 });
starGeo.center();
starGeo.computeBoundingBox();

// 6. Stick
const stickGeo = new THREE.CylinderGeometry(0.05, 0.05, 1, 16);
stickGeo.rotateZ(Math.PI/2);
stickGeo.computeBoundingBox();

// 7. Spray Splat
const sprayGeo = new THREE.PlaneGeometry(1, 1);
sprayGeo.rotateX(-Math.PI / 2); // Orient to face +Y up, matching other shapes
sprayGeo.computeBoundingBox();

const geometries = {
    flower: flowerGeo,
    leaf: leafGeo,
    sphere: sphereGeo,
    heart: heartGeo,
    star: starGeo,
    stick: stickGeo,
    spray: sprayGeo
};

// --- Procedural Textures ---
function getGradientTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 256, 256);
    grad.addColorStop(0, '#ff3366');
    grad.addColorStop(1, '#ffaa00');
    ctx.fillStyle = grad;
    ctx.fillRect(0,0,256,256);
    return new THREE.CanvasTexture(canvas);
}
const gradientTexture = getGradientTexture();

function getBrushTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    
    // Black background (transparent in alphaMap)
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, 128, 128);
    
    // Soft radial gradient for spray effect
    const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'white');
    grad.addColorStop(0.3, 'rgba(255, 255, 255, 0.5)');
    grad.addColorStop(1, 'black');
    
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    
    return new THREE.CanvasTexture(canvas);
}
const brushTexture = getBrushTexture();

// --- Global Brush State ---
let brushSize = 1.0;
let brushOpacity = 1.0;
let isPainting = false;
let lastPaintPos = new THREE.Vector3();

// --- Materials for Shapes ---
function getArtMaterial(colorHex, isSpray = false, opacity = 1.0) {
    const isGradient = colorHex === 'gradient';
    
    if (isSpray) {
        return new THREE.MeshBasicMaterial({
            color: isGradient ? 0xffffff : colorHex,
            map: isGradient ? gradientTexture : null,
            alphaMap: brushTexture,
            transparent: true,
            opacity: opacity,
            depthWrite: false, // Prevent z-fighting between overlapping paint splats
            alphaTest: 0.01
        });
    }

    return new THREE.MeshStandardMaterial({ 
        color: isGradient ? 0xffffff : colorHex,
        map: isGradient ? gradientTexture : null,
        metalness: 0.1,    
        roughness: 0.6,    
        envMapIntensity: 0.5
    });
}

const previewMaterial = getArtMaterial(currentColor);
previewMaterial.transparent = true;
previewMaterial.opacity = 0.5;
const previewMesh = new THREE.Mesh(geometries[currentShapeType], previewMaterial);
scene.add(previewMesh);
previewMesh.visible = false;

// --- Interaction (Raycaster) ---
const raycaster = new THREE.Raycaster();
const center = new THREE.Vector2(0, 0);
const mouse = new THREE.Vector2();

function placeShape(point, normal, type = currentShapeType, color = currentColor, scale = 1, rotation = null, initialOffset = null, opacity = 1.0) {
    const geo = geometries[type];
    const isSpray = type === 'spray';
    const mat = getArtMaterial(color, isSpray, isSpray ? opacity : 1.0);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(point);
    
    if (initialOffset) mesh.position.add(initialOffset);
    
    const up = new THREE.Vector3(0, 1, 0);
    mesh.quaternion.setFromUnitVectors(up, normal);
    
    if (rotation) {
        mesh.rotation.copy(rotation);
    } else {
        mesh.rotateY(Math.random() * Math.PI * 2);
        if (!isSpray) mesh.rotateZ((Math.random() - 0.5) * 0.5); 
    }
    
    mesh.castShadow = !isSpray; // Don't cast solid square shadow for spray
    mesh.receiveShadow = !isSpray;
    mesh.scale.set(isSpray ? scale : 0.01, isSpray ? scale : 0.01, isSpray ? scale : 0.01);
    
    // Offset along the normal precisely by the bounding box to sit exactly flush
    const bb = geo.boundingBox;
    const offsetDist = -bb.min.y * scale; 
    mesh.position.addScaledVector(normal, offsetDist);
    
    mesh.userData = { 
        type: type, color: color, targetScale: scale,
        animOffset: Math.random() * Math.PI * 2,
        basePosition: mesh.position.clone(),
        baseRotation: mesh.rotation.clone(),
        normal: normal.clone(),
        posOffset: new THREE.Vector3(0,0,0),
        opacity: opacity
    };
    
    scene.add(mesh);
    placedObjects.push(mesh);
    updateObjectCount();
    return mesh;
}

function removeShape(mesh) {
    scene.remove(mesh);
    placedObjects.splice(placedObjects.indexOf(mesh), 1);
    updateObjectCount();
    if(hoveredObject === mesh) document.getElementById('center-crosshair').classList.remove('active');
}

function updateObjectCount() {
    document.getElementById('object-count').innerText = placedObjects.length.toString().padStart(3, '0');
}

document.addEventListener('mousemove', (e) => {
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    
    if (isEditMode && isDragging && editingObject) {
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(placeableSurfaces, false);
        if (intersects.length > 0) {
            const hit = intersects[0];
            const bb = editingObject.geometry.boundingBox;
            const offsetDist = -bb.min.y * editingObject.userData.targetScale;
            const newPos = hit.point.clone().addScaledVector(hit.face.normal, offsetDist);
            
            editingObject.userData.basePosition.copy(newPos);
            editingObject.userData.normal.copy(hit.face.normal);
            const up = new THREE.Vector3(0, 1, 0);
            editingObject.quaternion.setFromUnitVectors(up, hit.face.normal);
            // Re-apply saved rotation via Euler offset if needed, or just let it snap to surface normal.
        }
    }
});

document.addEventListener('mousedown', (e) => {
    if (isEditMode) {
        if (e.target.tagName === 'CANVAS' && editingObject) {
            raycaster.setFromCamera(mouse, camera);
            const intersects = raycaster.intersectObject(editingObject);
            if (intersects.length > 0) isDragging = true;
        }
        return;
    }
    
    if (!controls.isLocked) return;
    
    if (e.button === 0) {
        if (hoveredObject) {
            editingObject = hoveredObject;
            isEditMode = true;
            controls.unlock();
            previewMesh.visible = false;
            // document.getElementById('edit-panel').classList.remove('hidden'); // Always visible now
            
            document.getElementById('scale-slider').value = editingObject.userData.targetScale;
            document.getElementById('rot-x-slider').value = editingObject.rotation.x;
            document.getElementById('rot-y-slider').value = editingObject.rotation.y;
            document.getElementById('rot-z-slider').value = editingObject.rotation.z;
            
            document.getElementById('pos-x-slider').value = editingObject.userData.posOffset.x;
            document.getElementById('pos-y-slider').value = editingObject.userData.posOffset.y;
            document.getElementById('pos-z-slider').value = editingObject.userData.posOffset.z;
        } else if (previewMesh.visible) {
            if (currentShapeType === 'spray') {
                isPainting = true;
                placeShape(previewMesh.position, previewMesh.userData.normal, 'spray', currentColor, brushSize, null, null, brushOpacity);
                lastPaintPos.copy(previewMesh.position);
            } else {
                placeShape(previewMesh.position, previewMesh.userData.normal);
            }
        }
    } else if (e.button === 2) {
        if (hoveredObject) removeShape(hoveredObject);
    }
});

document.addEventListener('mouseup', () => { isDragging = false; isPainting = false; });

function setShapeByIndex(index) {
    const items = document.querySelectorAll('.hotbar-item');
    if (items[index]) {
        items.forEach(el => el.classList.remove('active'));
        items[index].classList.add('active');
        currentShapeType = items[index].getAttribute('data-shape');
        previewMesh.geometry = geometries[currentShapeType];
        
        // Update preview material depending on type
        const isSpray = currentShapeType === 'spray';
        const newMat = getArtMaterial(currentColor, isSpray, isSpray ? brushOpacity * 0.5 : 0.5);
        newMat.transparent = true;
        if (!isSpray) newMat.opacity = 0.5;
        previewMesh.material = newMat;
        
        if (isSpray) {
            document.getElementById('brush-hud').classList.remove('hidden');
        } else {
            document.getElementById('brush-hud').classList.add('hidden');
        }
    }
}

document.querySelectorAll('.hotbar-item').forEach((item, index) => {
    item.addEventListener('click', (e) => { e.stopPropagation(); setShapeByIndex(index); });
});

// --- Edit Panel Listeners ---
document.getElementById('btn-close-edit').addEventListener('click', (e) => {
    e.stopPropagation();
    editingObject = null;
    isEditMode = false;
    isDragging = false;
    // document.getElementById('edit-panel').classList.add('hidden'); // Always visible now
    controls.lock();
});

document.getElementById('btn-delete').addEventListener('click', (e) => {
    e.stopPropagation();
    if (editingObject) {
        removeShape(editingObject);
        document.getElementById('btn-close-edit').click();
    }
});

document.querySelectorAll('.color-swatch').forEach(swatch => {
    swatch.addEventListener('click', (e) => {
        e.stopPropagation();
        currentColor = e.target.getAttribute('data-color');
        
        const isGrad = currentColor === 'gradient';
        const colorVal = isGrad ? 0xffffff : parseInt(currentColor.replace('#', '0x'), 16);
        
        if (previewMesh.material) {
            previewMesh.material.color.setHex(colorVal);
            if (!previewMesh.material.isMeshBasicMaterial) {
                previewMesh.material.map = isGrad ? gradientTexture : null;
            } else if (previewMesh.material.isMeshBasicMaterial && currentShapeType === 'spray') {
                previewMesh.material.map = isGrad ? gradientTexture : null;
            }
            previewMesh.material.needsUpdate = true;
        }
        
        if (editingObject) {
            editingObject.material.color.setHex(colorVal);
            if (editingObject.userData.type === 'spray') {
                editingObject.material.map = isGrad ? gradientTexture : null;
            } else {
                editingObject.material.map = isGrad ? gradientTexture : null;
            }
            editingObject.material.needsUpdate = true;
            editingObject.userData.color = currentColor;
        }
    });
});

document.getElementById('scale-slider').addEventListener('input', (e) => {
    if (editingObject) editingObject.userData.targetScale = parseFloat(e.target.value);
});

['x', 'y', 'z'].forEach(axis => {
    document.getElementById(`rot-${axis}-slider`).addEventListener('input', (e) => {
        if (editingObject) {
            editingObject.rotation[axis] = parseFloat(e.target.value);
            editingObject.userData.baseRotation[axis] = parseFloat(e.target.value);
        }
    });
    document.getElementById(`pos-${axis}-slider`).addEventListener('input', (e) => {
        if (editingObject) {
            editingObject.userData.posOffset[axis] = parseFloat(e.target.value);
        }
    });
});

document.getElementById('btn-duplicate').addEventListener('click', (e) => {
    e.stopPropagation();
    if (editingObject) {
        const newObj = placeShape(
            editingObject.position, editingObject.userData.normal, 
            editingObject.userData.type, editingObject.userData.color, 
            editingObject.userData.targetScale, editingObject.rotation,
            new THREE.Vector3(0.5, 0, 0.5)
        );
        editingObject = newObj;
    }
});

// --- System Menu Buttons ---
const saveStatus = document.getElementById('save-status');
function showSaveStatus(msg) {
    saveStatus.innerText = msg;
    setTimeout(() => { saveStatus.innerText = ''; }, 2000);
}

document.getElementById('btn-save').addEventListener('click', () => {
    const data = placedObjects.map(obj => ({
        type: obj.userData.type, color: obj.userData.color, scale: obj.userData.targetScale,
        px: obj.userData.basePosition.x, py: obj.userData.basePosition.y, pz: obj.userData.basePosition.z, 
        rx: obj.rotation.x, ry: obj.rotation.y, rz: obj.rotation.z,
        nx: obj.userData.normal.x, ny: obj.userData.normal.y, nz: obj.userData.normal.z,
        ox: obj.userData.posOffset.x, oy: obj.userData.posOffset.y, oz: obj.userData.posOffset.z,
        op: obj.userData.opacity
    }));
    if (window.socket) window.socket.emit('save_preset', data);
    showSaveStatus("SAVING TO SERVER...");
});

document.getElementById('btn-load').addEventListener('click', () => {
    showSaveStatus("LOADED FROM SERVER (AUTO)");
    controls.lock();
});

document.getElementById('btn-reset').addEventListener('click', () => {
    [...placedObjects].forEach(removeShape);
    initPreplacedArt();
    showSaveStatus("SPACE CLEARED");
    controls.lock();
});

// --- Movement ---
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();
let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false, isSprinting = false;

document.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    if (key === 'w' || e.code === 'ArrowUp') moveForward = true;
    if (key === 'a' || e.code === 'ArrowLeft') moveLeft = true;
    if (key === 's' || e.code === 'ArrowDown') moveBackward = true;
    if (key === 'd' || e.code === 'ArrowRight') moveRight = true;
    if (e.key === 'Shift') isSprinting = true;
    
    if (e.key >= '1' && e.key <= '7') setShapeByIndex(parseInt(e.key) - 1);
});

document.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();
    if (key === 'w' || e.code === 'ArrowUp') moveForward = false;
    if (key === 'a' || e.code === 'ArrowLeft') moveLeft = false;
    if (key === 's' || e.code === 'ArrowDown') moveBackward = false;
    if (key === 'd' || e.code === 'ArrowRight') moveRight = false;
    if (e.key === 'Shift') isSprinting = false;
});

document.addEventListener('wheel', (e) => {
    if (currentShapeType === 'spray') {
        const delta = e.deltaY < 0 ? 1 : -1;
        if (e.shiftKey) {
            brushOpacity = Math.max(0.1, Math.min(1.0, brushOpacity + delta * 0.1));
            document.getElementById('brush-op-val').innerText = brushOpacity.toFixed(1);
        } else {
            brushSize = Math.max(0.1, Math.min(10.0, brushSize + delta * 0.2));
            document.getElementById('brush-size-val').innerText = brushSize.toFixed(1);
        }
    }
});

const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();
    const time = clock.getElapsedTime();

    const pos = particleGeo.attributes.position.array;
    for(let i = 1; i < particleCount * 3; i += 3) {
        pos[i] -= 0.15 * delta;
        pos[i-1] += Math.sin(time + i) * 0.03 * delta;
        if(pos[i] < 0) pos[i] = 20;
    }
    particleGeo.attributes.position.needsUpdate = true;

    if (controls.isLocked && !isEditMode) {
        raycaster.setFromCamera(center, camera);
        let intersects = raycaster.intersectObjects(placedObjects, false);
        const crosshairDOM = document.getElementById('center-crosshair');
        
        if (intersects.length > 0) {
            previewMesh.visible = false;
            if (hoveredObject !== intersects[0].object) {
                if (hoveredObject && hoveredObject.material.emissive) hoveredObject.material.emissive.setHex(0x000000);
                hoveredObject = intersects[0].object;
                if (hoveredObject.material.emissive) {
                    hoveredObject.material.emissive.setHex(0x222222);
                }
                crosshairDOM.classList.add('active');
            }
        } else {
            if (hoveredObject) {
                if (hoveredObject.material.emissive) hoveredObject.material.emissive.setHex(0x000000);
                hoveredObject = null;
                crosshairDOM.classList.remove('active');
            }
            intersects = raycaster.intersectObjects(placeableSurfaces, false);
            if (intersects.length > 0) {
                previewMesh.visible = true;
                previewMesh.position.copy(intersects[0].point);
                const up = new THREE.Vector3(0, 1, 0);
                previewMesh.quaternion.setFromUnitVectors(up, intersects[0].face.normal);
                previewMesh.userData.normal = intersects[0].face.normal.clone();
                
                if (currentShapeType === 'spray') {
                    previewMesh.scale.setScalar(brushSize);
                    // Continuous painting
                    if (isPainting) {
                        const dist = previewMesh.position.distanceTo(lastPaintPos);
                        const spacing = brushSize * 0.15; // Dense spacing for a continuous line
                        if (dist > spacing) {
                            const steps = Math.max(1, Math.floor(dist / spacing));
                            for (let i = 1; i <= steps; i++) {
                                const lerpPos = lastPaintPos.clone().lerp(previewMesh.position, i / steps);
                                placeShape(lerpPos, previewMesh.userData.normal, 'spray', currentColor, brushSize, null, null, brushOpacity);
                            }
                            lastPaintPos.copy(previewMesh.position);
                        }
                    }
                } else {
                    previewMesh.scale.setScalar(1);
                }
            } else {
                previewMesh.visible = false;
            }
        }
    }

    placedObjects.forEach(obj => {
        const target = obj.userData.targetScale;
        if (Math.abs(obj.scale.x - target) > 0.01) obj.scale.lerp(new THREE.Vector3(target, target, target), 0.1);
        
        const float = (['flower', 'leaf', 'star', 'heart'].includes(obj.userData.type)) 
            ? Math.sin(time * 2 + obj.userData.animOffset) * 0.05 * target 
            : 0;
            
        obj.position.x = obj.userData.basePosition.x + obj.userData.posOffset.x;
        obj.position.y = obj.userData.basePosition.y + obj.userData.posOffset.y + float;
        obj.position.z = obj.userData.basePosition.z + obj.userData.posOffset.z;
        
        if (['flower', 'leaf', 'star', 'heart'].includes(obj.userData.type)) {
            obj.rotation.y = obj.userData.baseRotation.y + Math.sin(time * 0.5 + obj.userData.animOffset) * 0.1;
        }
    });

    if (controls.isLocked && !isEditMode) {
        velocity.x -= velocity.x * 10.0 * delta;
        velocity.z -= velocity.z * 10.0 * delta;
        velocity.y -= 25.0 * delta;

        direction.z = Number(moveForward) - Number(moveBackward);
        direction.x = Number(moveRight) - Number(moveLeft);
        direction.normalize();

        const speed = isSprinting ? 120.0 : 60.0;
        if (moveForward || moveBackward) velocity.z -= direction.z * speed * delta;
        if (moveLeft || moveRight) velocity.x -= direction.x * speed * delta;

        const oldPos = controls.getObject().position.clone();

        controls.moveRight(-velocity.x * delta);
        controls.moveForward(-velocity.z * delta);
        controls.getObject().position.y += (velocity.y * delta);
        
        if (controls.getObject().position.y < 1.7) {
            velocity.y = 0;
            controls.getObject().position.y = 1.7;
        }

        const playerBox = new THREE.Box3().setFromCenterAndSize(controls.getObject().position, new THREE.Vector3(0.5, 1.7, 0.5));
        let collision = false;
        for (const wall of collidableObjects) {
            const wallBox = new THREE.Box3().setFromObject(wall);
            if (playerBox.intersectsBox(wallBox)) {
                collision = true;
                break;
            }
        }
        
        if (collision) {
            controls.getObject().position.copy(oldPos); 
            velocity.x = 0;
            velocity.z = 0;
        }
    }

    if(scene.background && scene.background.isTexture) {
        scene.background.offset.x += 0.0005; // Animate clouds
    }

    if (composer) {
        try {
            composer.render();
        } catch (e) {
            console.error("Composer render error, falling back to direct WebGL render:", e);
            composer = null;
            renderer.render(scene, camera);
        }
    } else {
        renderer.render(scene, camera);
    }
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (composer) {
        try {
            composer.setSize(window.innerWidth, window.innerHeight);
        } catch(e) {
            console.warn("Composer setSize error:", e);
        }
    }
    if (fxaaPass && fxaaPass.material && fxaaPass.material.uniforms['resolution']) {
        fxaaPass.material.uniforms['resolution'].value.set(1 / window.innerWidth, 1 / window.innerHeight);
    }
});

// 2. Pedestals
const pedestalMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.8 });
function createPedestal(x, z) {
    const geo = new THREE.BoxGeometry(2, 1, 2);
    const mesh = new THREE.Mesh(geo, pedestalMat);
    mesh.position.set(x, 0.5, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    collidableObjects.push(mesh);
    placeableSurfaces.push(mesh);
}

function initPreplacedArt() {
    const up = new THREE.Vector3(0,1,0);
    
    // Distribute 10 pedestals
    const positions = [
        [22.5, 22.5], [-22.5, -22.5], // Giants
        [7.5, 22.5], [-7.5, 22.5], // Animals
        [-22.5, 7.5], [-22.5, -7.5], [-7.5, -22.5], [7.5, -22.5], [22.5, -7.5], [22.5, 7.5] // Abstracts
    ];
    positions.forEach(p => createPedestal(p[0], p[1]));

    // 1. Giant 1 (Monumental Abstract) at 22.5, 22.5
    // SCALED DOWN to guarantee they never clip the 6.75 radius safe-zone of the room
    placeShape(new THREE.Vector3(22.5, 1.5, 22.5), up, 'sphere', '#111111', 4);
    placeShape(new THREE.Vector3(22.5, 4.0, 22.5), up, 'star', 'gradient', 5, new THREE.Euler(Math.PI/2, 0, 0));
    placeShape(new THREE.Vector3(22.5, 6.0, 22.5), up, 'stick', '#ffffff', 7);
    placeShape(new THREE.Vector3(22.5, 9.0, 22.5), up, 'flower', '#ff3366', 4, new THREE.Euler(Math.PI/4, 0, 0));

    // 2. Giant 2 (Monumental Organic) at -22.5, -22.5
    placeShape(new THREE.Vector3(-22.5, 2.0, -22.5), up, 'leaf', '#88aa55', 5, new THREE.Euler(Math.PI/4, 0, 0));
    placeShape(new THREE.Vector3(-22.5, 4.0, -22.5), up, 'leaf', '#88aa55', 5, new THREE.Euler(-Math.PI/4, 0, 0));
    placeShape(new THREE.Vector3(-22.5, 6.0, -22.5), up, 'sphere', '#cc0033', 3);
    placeShape(new THREE.Vector3(-22.5, 8.0, -22.5), up, 'star', '#ffffff', 4, new THREE.Euler(Math.PI/2, Math.PI/4, 0));

    // 3. Animal 1 (Dog) at 7.5, 22.5
    placeShape(new THREE.Vector3(7.5, 1.5, 22.5), up, 'sphere', 'gradient', 3);
    placeShape(new THREE.Vector3(7.5, 2.2, 23.2), up, 'heart', 'gradient', 1.5, new THREE.Euler(Math.PI/4, 0, 0));
    placeShape(new THREE.Vector3(7.0, 1.2, 23.0), up, 'stick', '#111111', 2.0, new THREE.Euler(0, 0, Math.PI/8));
    placeShape(new THREE.Vector3(8.0, 1.2, 23.0), up, 'stick', '#111111', 2.0, new THREE.Euler(0, 0, -Math.PI/8));
    placeShape(new THREE.Vector3(7.0, 1.2, 22.0), up, 'stick', '#111111', 2.0, new THREE.Euler(0, 0, Math.PI/8));
    placeShape(new THREE.Vector3(8.0, 1.2, 22.0), up, 'stick', '#111111', 2.0, new THREE.Euler(0, 0, -Math.PI/8));

    // 4. Animal 2 (Bird) at -7.5, 22.5
    placeShape(new THREE.Vector3(-7.5, 2.5, 22.5), up, 'sphere', '#ffffff', 2.5);
    placeShape(new THREE.Vector3(-6.5, 2.5, 22.5), up, 'leaf', '#88aa55', 2.5, new THREE.Euler(0, 0, -Math.PI/4));
    placeShape(new THREE.Vector3(-8.5, 2.5, 22.5), up, 'leaf', '#88aa55', 2.5, new THREE.Euler(0, 0, Math.PI/4));
    placeShape(new THREE.Vector3(-7.5, 3.2, 23.2), up, 'star', '#ff3366', 1.8, new THREE.Euler(Math.PI/4, 0, 0));
    placeShape(new THREE.Vector3(-7.5, 1.5, 22.5), up, 'stick', '#111111', 2.0);

    // 5. Abstract 1 (Wave) at -22.5, 7.5
    for(let i=0; i<6; i++) {
        placeShape(new THREE.Vector3(-22.5 + Math.sin(i)*1.0, 1.5 + i*0.5, 7.5 + Math.cos(i)*1.0), up, 'heart', i%2===0?'#ffffff':'#ff3366', 1.5, new THREE.Euler(0, i, 0));
    }

    // 6. Abstract 2 (Cage) at -22.5, -7.5
    placeShape(new THREE.Vector3(-22.5, 2.5, -7.5), up, 'sphere', 'gradient', 2);
    placeShape(new THREE.Vector3(-22.5, 2.5, -7.5), up, 'stick', '#111111', 4, new THREE.Euler(0, 0, Math.PI/4));
    placeShape(new THREE.Vector3(-22.5, 2.5, -7.5), up, 'stick', '#111111', 4, new THREE.Euler(0, 0, -Math.PI/4));
    placeShape(new THREE.Vector3(-22.5, 2.5, -7.5), up, 'stick', '#111111', 4, new THREE.Euler(Math.PI/4, 0, 0));
    placeShape(new THREE.Vector3(-22.5, 2.5, -7.5), up, 'stick', '#111111', 4, new THREE.Euler(-Math.PI/4, 0, 0));

    // 7. Abstract 3 (Tension) at -7.5, -22.5
    placeShape(new THREE.Vector3(-7.5, 1.2, -22.5), up, 'sphere', '#ffffff', 1.5);
    placeShape(new THREE.Vector3(-7.0, 4.5, -22.5), up, 'stick', '#111111', 8.0, new THREE.Euler(0, 0, Math.PI/6));
    placeShape(new THREE.Vector3(-6.0, 7.5, -22.5), up, 'flower', '#cc0033', 3.0, new THREE.Euler(0, 0, Math.PI/6));

    // 8. Abstract 4 (Void) at 7.5, -22.5
    placeShape(new THREE.Vector3(7.5, 3.0, -22.5), up, 'sphere', '#111111', 2.0);
    placeShape(new THREE.Vector3(6.5, 3.0, -22.5), up, 'star', '#ffffff', 3.0, new THREE.Euler(0, 0, Math.PI/2));
    placeShape(new THREE.Vector3(8.5, 3.0, -22.5), up, 'star', '#ffffff', 3.0, new THREE.Euler(0, 0, -Math.PI/2));
    placeShape(new THREE.Vector3(7.5, 4.5, -22.5), up, 'star', '#ffffff', 3.0, new THREE.Euler(Math.PI/2, 0, 0));

    // 9. Abstract 5 (Stack) at 22.5, -7.5
    placeShape(new THREE.Vector3(22.5, 1.5, -7.5), up, 'sphere', '#111111', 2.5);
    placeShape(new THREE.Vector3(22.6, 3.8, -7.4), up, 'star', '#ff3366', 3.0, new THREE.Euler(0.5, 1.0, 0));
    placeShape(new THREE.Vector3(22.1, 5.0, -7.5), up, 'sphere', '#ffffff', 1.2);
    placeShape(new THREE.Vector3(21.8, 6.0, -7.5), up, 'sphere', '#ffffff', 0.8);
    placeShape(new THREE.Vector3(21.6, 6.7, -7.5), up, 'sphere', '#ffffff', 0.5);

    // 10. Abstract 6 (Spike) at 22.5, 7.5
    placeShape(new THREE.Vector3(22.5, 2.0, 7.5), up, 'stick', '#cc0033', 5.0);
    placeShape(new THREE.Vector3(22.5, 5.0, 7.5), up, 'heart', 'gradient', 3.0, new THREE.Euler(Math.PI/2, 0, 0));
}

initPreplacedArt();
animate();
