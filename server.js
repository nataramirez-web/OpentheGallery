const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const fs = require('fs');
const path = require('path');

const PORT = 3000;

app.use(express.json());
app.use(express.static('public'));

// Almacenamiento de presets en memoria (y en archivo)
const PRESETS_FILE = path.join(__dirname, 'presets.json');
let presets = [];
if (fs.existsSync(PRESETS_FILE)) {
    presets = JSON.parse(fs.readFileSync(PRESETS_FILE, 'utf-8'));
}

let players = {};

io.on('connection', (socket) => {
    console.log('Un usuario se ha conectado:', socket.id);
    players[socket.id] = { x: 0, y: 1.7, z: 5, rx: 0, ry: 0, rz: 0 };

    // Enviar estado actual al nuevo jugador
    socket.emit('init_data', { presets, players });
    
    // Avisar a todos que alguien entró
    socket.broadcast.emit('player_joined', { id: socket.id, state: players[socket.id] });

    socket.on('player_move', (state) => {
        players[socket.id] = state;
        socket.broadcast.emit('player_moved', { id: socket.id, state });
    });

    socket.on('save_preset', (presetData) => {
        presets.push(presetData);
        fs.writeFileSync(PRESETS_FILE, JSON.stringify(presets));
        io.emit('preset_saved', presetData); // Notificar a todos
    });

    socket.on('disconnect', () => {
        console.log('Usuario desconectado:', socket.id);
        delete players[socket.id];
        io.emit('player_left', socket.id);
    });
});

server.listen(PORT, () => {
    console.log(`=======================================`);
    console.log(`Servidor Multijugador iniciado`);
    console.log(`Puerto: ${PORT}`);
    console.log(`Abre en tu navegador: http://localhost:${PORT}`);
    console.log(`=======================================`);
});
