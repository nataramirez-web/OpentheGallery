const socket = io();
window.socket = socket;

let allPresets = [];
const otherPlayers = {};

// UI setup for Presets List
const presetsMenuHtml = `
<div id="presets-menu" class="hidden" style="position:absolute; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); display:flex; justify-content:center; align-items:center; z-index:9999;">
    <div class="pause-content" style="background: #111; border: 1px solid #333; padding: 20px; text-align: center; width: 400px;">
        <h2>SAVED PRESETS</h2>
        <div id="presets-list" style="max-height:300px; overflow-y:auto; margin-bottom:20px; text-align:left; border: 1px solid #222; padding: 10px;"></div>
        <button id="btn-close-presets" style="width: 100%; padding: 10px; background: #fff; color: #000; border: none; cursor: pointer; font-weight: bold;">BACK</button>
    </div>
</div>
`;
document.body.insertAdjacentHTML('beforeend', presetsMenuHtml);

const presetsMenu = document.getElementById('presets-menu');
const presetsList = document.getElementById('presets-list');

// Hijack the LOAD button
const btnLoad = document.getElementById('btn-load');
if (btnLoad) {
    btnLoad.innerText = "VIEW PRESETS";
    // We clone it to remove previous event listeners from main.js
    const newBtnLoad = btnLoad.cloneNode(true);
    btnLoad.parentNode.replaceChild(newBtnLoad, btnLoad);
    
    newBtnLoad.addEventListener('click', (e) => {
        e.stopPropagation();
        document.getElementById('pause-menu').classList.add('hidden'); // Hide pause menu
        presetsMenu.classList.remove('hidden');
    });
}

document.getElementById('btn-close-presets').addEventListener('click', () => {
    presetsMenu.classList.add('hidden');
    document.getElementById('pause-menu').classList.remove('hidden'); // Show pause menu again
});

function createPresetItem(preset, index) {
    const div = document.createElement('div');
    div.style.padding = '10px';
    div.style.borderBottom = '1px solid #333';
    div.style.display = 'flex';
    div.style.justifyContent = 'space-between';
    div.style.alignItems = 'center';
    
    const text = document.createElement('span');
    text.innerText = `Preset ${index + 1} (${preset.length} objects)`;
    text.style.color = '#fff';
    
    const btn = document.createElement('button');
    btn.innerText = 'LOAD';
    btn.style.padding = '5px 10px';
    btn.style.fontSize = '12px';
    btn.style.background = '#333';
    btn.style.color = '#fff';
    btn.style.border = '1px solid #555';
    btn.style.cursor = 'pointer';
    
    btn.addEventListener('click', () => {
        loadPresetToScene(preset);
        presetsMenu.classList.add('hidden');
        if (typeof controls !== 'undefined') controls.lock();
    });
    
    div.appendChild(text);
    div.appendChild(btn);
    return div;
}

function updatePresetsList(presets) {
    presetsList.innerHTML = '';
    if (presets.length === 0) {
        presetsList.innerHTML = '<div style="color:#777; text-align:center;">No presets saved yet.</div>';
    } else {
        presets.forEach((p, i) => {
            presetsList.appendChild(createPresetItem(p, i));
        });
    }
}

function loadPresetToScene(presetData) {
    presetData.forEach(obj => {
        const basePos = new THREE.Vector3(obj.px, obj.py, obj.pz);
        const normal = new THREE.Vector3(obj.nx, obj.ny, obj.nz);
        const rot = new THREE.Euler(obj.rx, obj.ry, obj.rz);
        const posOffset = new THREE.Vector3(obj.ox, obj.oy, obj.oz);
        
        if (typeof placeShape === 'function') {
            placeShape(basePos, normal, obj.type, obj.color, obj.scale, rot, posOffset, obj.op);
        }
    });
}

// Socket events
socket.on('init_data', (data) => {
    allPresets = data.presets || [];
    updatePresetsList(allPresets);
    
    // Automatically load all presets upon page reload
    allPresets.forEach(preset => {
        loadPresetToScene(preset);
    });

    for (let id in data.players) {
        if (id !== socket.id) {
            addPlayerAvatar(id, data.players[id]);
        }
    }
});

socket.on('player_joined', (data) => {
    addPlayerAvatar(data.id, data.state);
});

socket.on('player_moved', (data) => {
    if (otherPlayers[data.id]) {
        // Smoothly interpolate or just set position directly
        otherPlayers[data.id].position.set(data.state.x, data.state.y, data.state.z);
        otherPlayers[data.id].rotation.set(data.state.rx, data.state.ry, data.state.rz);
    }
});

socket.on('preset_saved', (presetData) => {
    allPresets.push(presetData);
    updatePresetsList(allPresets);
});

socket.on('player_left', (id) => {
    if (otherPlayers[id]) {
        if (typeof scene !== 'undefined') {
            scene.remove(otherPlayers[id]);
        }
        delete otherPlayers[id];
    }
});

function addPlayerAvatar(id, state) {
    if (typeof THREE === 'undefined' || typeof scene === 'undefined') return;
    
    const geometry = new THREE.CapsuleGeometry(0.3, 1.0, 4, 16);
    const material = new THREE.MeshStandardMaterial({ 
        color: new THREE.Color().setHSL(Math.random(), 0.7, 0.5),
        roughness: 0.4
    });
    const avatar = new THREE.Mesh(geometry, material);
    avatar.position.set(state.x, state.y, state.z);
    
    // Add a simple "eyes" indicator to show direction
    const eyeGeo = new THREE.BoxGeometry(0.4, 0.1, 0.1);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const eyes = new THREE.Mesh(eyeGeo, eyeMat);
    eyes.position.set(0, 0.4, -0.28);
    avatar.add(eyes);
    
    scene.add(avatar);
    otherPlayers[id] = avatar;
}

// Broadcast player movement periodically
setInterval(() => {
    if (typeof camera !== 'undefined' && typeof controls !== 'undefined') {
        const pos = controls.getObject().position;
        // The camera rotation represents the head, but we also want the body orientation
        const rot = camera.rotation;
        
        socket.emit('player_move', {
            x: pos.x, y: pos.y, z: pos.z,
            rx: rot.x, ry: rot.y, rz: rot.z
        });
    }
}, 50); // 20 updates per second
