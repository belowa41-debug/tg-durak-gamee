const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

let rooms = {};

const suits = [
    { symbol: '♥', color: 'red' }, { symbol: '♦', color: 'red' },
    { symbol: '♣', color: 'black' }, { symbol: '♠', color: 'black' }
];
const values = [
    { name: '6', power: 6 }, { name: '7', power: 7 }, { name: '8', power: 8 },
    { name: '9', power: 9 }, { name: '10', power: 10 }, { name: 'J', power: 11 },
    { name: 'Q', power: 12 }, { name: 'K', power: 13 }, { name: 'A', power: 14 }
];

io.on('connection', (socket) => {
    let currentRoom = null;

    socket.on('joinRoom', (roomId) => {
        if (!rooms[roomId]) {
            rooms[roomId] = {
                players: [], deck: [], table: [], trump: null,
                attackerIdx: 0, gameState: "WAITING", timer: null, timeLeft: 30
            };
        }

        const room = rooms[roomId];
        if (room.players.length >= 2) {
            socket.emit('status', 'Комната уже заполнена!');
            return;
        }

        currentRoom = roomId;
        socket.join(roomId);
        room.players.push({ id: socket.id, hand: [] });

        if (room.players.length === 1) {
            socket.emit('status', 'Ожидаем второго игрока...');
        }

        if (room.players.length === 2 && room.gameState === "WAITING") {
            room.gameState = "PLAYING";
            initDeck(room);
            resetRoomTimer(roomId);
            updateRoom(roomId);
        }
    });

    socket.on('playCard', (cardIndex) => {
        const room = rooms[currentRoom];
        if (!room || room.gameState !== "PLAYING") return;

        const playerIdx = room.players.findIndex(p => p.id === socket.id);
        if (playerIdx !== room.attackerIdx) return; 

        const card = room.players[playerIdx].hand.splice(cardIndex, 1)[0];
        room.table.push(card);
        
        room.attackerIdx = room.attackerIdx === 0 ? 1 : 0;
        
        resetRoomTimer(currentRoom);
        updateRoom(currentRoom);
        checkWin(currentRoom);
    });

    socket.on('actionButton', () => {
        const room = rooms[currentRoom];
        if (!room || room.gameState !== "PLAYING") return;

        const playerIdx = room.players.findIndex(p => p.id === socket.id);
        
        if (playerIdx === room.attackerIdx) {
            room.table = [];
            giveCards(room);
            room.attackerIdx = room.attackerIdx === 0 ? 1 : 0;
        } else {
            room.players[playerIdx].hand.push(...room.table);
            room.table = [];
            giveCards(room);
        }

        resetRoomTimer(currentRoom);
        updateRoom(currentRoom);
        checkWin(currentRoom);
    });

    socket.on('disconnect', () => {
        if (currentRoom && rooms[currentRoom]) {
            clearInterval(rooms[currentRoom].timer);
            io.to(currentRoom).emit('status', 'Соперник вышел из игры.');
            delete rooms[currentRoom];
        }
    });
});

function initDeck(room) {
    room.deck = [];
    for (let s of suits) {
        for (let v of values) {
            room.deck.push({ suit: s, value: v });
        }
    }
    room.deck.sort(() => Math.random() - 0.5);
    room.trump = room.deck[room.deck.length - 1];
    giveCards(room);
}

function giveCards(room) {
    room.players.forEach(p => {
        while (p.hand.length < 6 && room.deck.length > 0) {
            p.hand.push(room.deck.shift());
        }
    });
}

function resetRoomTimer(roomId) {
    const room = rooms[roomId];
    if (!room) return;
    clearInterval(room.timer);
    room.timeLeft = 30;

    room.timer = setInterval(() => {
        room.timeLeft--;
        io.to(roomId).emit('timerUpdate', room.timeLeft);
        if (room.timeLeft <= 0) {
            clearInterval(room.timer);
            const winner = room.players[room.attackerIdx === 0 ? 1 : 0];
            room.gameState = "FINISHED";
            io.to(roomId).emit('gameOver', { winner: winner.id });
        }
    }, 1000);
}

function checkWin(roomId) {
    const room = rooms[roomId];
    if (room.deck.length === 0) {
        const p1Cards = room.players[0].hand.length;
        const p2Cards = room.players[1].hand.length;

        if (p1Cards === 0 && p2Cards > 0) {
            room.gameState = "FINISHED";
            clearInterval(room.timer);
            io.to(roomId).emit('gameOver', { winner: room.players[0].id });
        } else if (p2Cards === 0 && p1Cards > 0) {
            room.gameState = "FINISHED";
            clearInterval(room.timer);
            io.to(roomId).emit('gameOver', { winner: room.players[1].id });
        }
    }
}

function updateRoom(roomId) {
    const room = rooms[roomId];
    if (!room) return;
    room.players.forEach((player, idx) => {
        const enemyIdx = idx === 0 ? 1 : 0;
        io.to(player.id).emit('gameState', {
            myHand: player.hand,
            enemyCardCount: room.players[enemyIdx].hand.length,
            table: room.table,
            deckCount: room.deck.length,
            trump: room.trump,
            isMyTurn: room.attackerIdx === idx,
            gameState: room.gameState
        });
    });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Сервер запущен`));