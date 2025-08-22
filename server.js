const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static('public'));

let gameState = {
    room: "Desiree",
    players: {},
    gameStarted: false,
    currentRound: 0,
    tableOrder: [],
    dealerIndex: -1,
    roundData: {}
};

function createInitialGameState() {
    return {
        room: "Desiree", players: {}, gameStarted: false, currentRound: 0,
        tableOrder: [], dealerIndex: -1, roundData: {}
    };
}

function resetRoundData() {
    gameState.roundData = {
        deck: [], trumpCard: null, declarations: {}, turn: null,
        currentTrick: [], tricksWon: {}, trickLeadSuit: null, turnOrder: []
    };
}

function createDeck() {
    const suits = ['CUORI', 'QUADRI', 'FIORI', 'PICCHE'];
    const values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    let deck = [];
    for (const suit of suits) { for (const value of values) { deck.push({ suit, value }); } }
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

function startGame() {
    gameState.gameStarted = true;
    gameState.tableOrder = Object.keys(gameState.players);
    for (let i = gameState.tableOrder.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [gameState.tableOrder[i], gameState.tableOrder[j]] = [gameState.tableOrder[j], gameState.tableOrder[i]];
    }
    gameState.dealerIndex = -1;
    startNewRound();
}

function startNewRound() {
    gameState.currentRound++;
    resetRoundData();

    gameState.dealerIndex = (gameState.dealerIndex + 1) % gameState.tableOrder.length;
    const dealerId = gameState.tableOrder[gameState.dealerIndex];
    const firstToDeclareIndex = (gameState.dealerIndex + 1) % gameState.tableOrder.length;
    
    gameState.roundData.turnOrder = [
        ...gameState.tableOrder.slice(firstToDeclareIndex),
        ...gameState.tableOrder.slice(0, firstToDeclareIndex)
    ];

    if (gameState.currentRound > 13 || gameState.roundData.turnOrder.length < 4) {
        io.to(gameState.room).emit('gameOver', { scores: gameState.players });
        gameState.gameStarted = false;
        return;
    }

    gameState.roundData.deck = createDeck();
    gameState.roundData.turnOrder.forEach(id => {
        if (gameState.players[id]) {
            gameState.players[id].hand = [];
            for (let i = 0; i < gameState.currentRound; i++) {
                if (gameState.roundData.deck.length > 0) gameState.players[id].hand.push(gameState.roundData.deck.pop());
            }
            gameState.roundData.tricksWon[id] = 0;
        }
    });

    gameState.roundData.trumpCard = (gameState.currentRound < 13 && gameState.roundData.deck.length > 0)
        ? gameState.roundData.deck.pop()
        : { suit: 'NO_TRUMP', value: '' };
    
    gameState.roundData.turn = gameState.roundData.turnOrder[0];

    io.to(gameState.room).emit('newRound', {
        round: gameState.currentRound, players: gameState.players, trumpCard: gameState.roundData.trumpCard,
        dealerId: dealerId, turnOrder: gameState.roundData.turnOrder
    });
    io.to(gameState.roundData.turn).emit('yourTurnToDeclare', {});
}

io.on('connection', (socket) => {
    console.log('Un giocatore si è connesso:', socket.id);

    socket.on('joinGame', ({ name }) => {
        if (gameState.gameStarted || Object.keys(gameState.players).length >= 10) {
            socket.emit('gameError', 'La partita è già iniziata o la stanza è piena.'); return;
        }
        socket.join(gameState.room);
        gameState.players[socket.id] = { id: socket.id, name, score: 0, hand: [] };
        io.to(gameState.room).emit('updatePlayers', gameState.players);
        if (Object.keys(gameState.players).length >= 4) {
            io.to(Object.keys(gameState.players)[0]).emit('canStart');
        }
    });

    socket.on('startGame', () => { if (!gameState.gameStarted) { startGame(); } });

    socket.on('declare', (declaration) => {
        if (socket.id !== gameState.roundData.turn) return;
        const turnOrder = gameState.roundData.turnOrder;
        const isLastToDeclare = Object.keys(gameState.roundData.declarations).length === turnOrder.length - 1;
        if (isLastToDeclare) {
            const sumOfPrevious = Object.values(gameState.roundData.declarations).reduce((a, b) => a + b, 0);
            const forbiddenNumber = gameState.currentRound - sumOfPrevious;
            if (declaration === forbiddenNumber) {
                socket.emit('invalidDeclaration', `Non puoi dichiarare ${declaration}.`); return;
            }
        }
        gameState.roundData.declarations[socket.id] = declaration;
        io.to(gameState.room).emit('playerDeclared', { playerId: socket.id, declaration });
        const currentIndex = turnOrder.indexOf(socket.id);
        const nextPlayerId = turnOrder[(currentIndex + 1) % turnOrder.length];
        if (Object.keys(gameState.roundData.declarations).length === turnOrder.length) {
            gameState.roundData.turn = turnOrder[0];
            io.to(gameState.room).emit('allDeclared');
            io.to(gameState.roundData.turn).emit('yourTurnToPlay', { leadSuit: null });
        } else {
            gameState.roundData.turn = nextPlayerId;
            let dataForNext = {};
            if (Object.keys(gameState.roundData.declarations).length === turnOrder.length - 1) {
                const sum = Object.values(gameState.roundData.declarations).reduce((a, b) => a + b, 0);
                dataForNext.forbiddenNumber = gameState.currentRound - sum;
            }
            io.to(nextPlayerId).emit('yourTurnToDeclare', dataForNext);
        }
    });

    socket.on('playCard', (card) => {
        if (socket.id !== gameState.roundData.turn) return;
        const player = gameState.players[socket.id];
        const leadSuit = gameState.roundData.trickLeadSuit;
        if (leadSuit && player.hand.some(c => c.suit === leadSuit) && card.suit !== leadSuit) {
            socket.emit('invalidMove', 'Devi rispondere con una carta dello stesso seme!'); return;
        }
        player.hand = player.hand.filter(c => !(c.suit === card.suit && c.value === card.value));
        if (gameState.roundData.currentTrick.length === 0) gameState.roundData.trickLeadSuit = card.suit;
        gameState.roundData.currentTrick.push({ playerId: socket.id, card });
        io.to(gameState.room).emit('cardPlayed', { playerId: socket.id, name: player.name, card, hand: player.hand });
        
        const turnOrder = gameState.roundData.turnOrder;
        if (gameState.roundData.currentTrick.length === turnOrder.length) {
            let winningCard = gameState.roundData.currentTrick[0].card;
            let winnerId = gameState.roundData.currentTrick[0].playerId;
            const trumpSuit = gameState.roundData.trumpCard.suit;
            const cardValues = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
            for (let i = 1; i < gameState.roundData.currentTrick.length; i++) {
                const played = gameState.roundData.currentTrick[i];
                if (trumpSuit !== 'NO_TRUMP' && played.card.suit === trumpSuit && winningCard.suit !== trumpSuit) {
                    [winningCard, winnerId] = [played.card, played.playerId];
                } else if (played.card.suit === winningCard.suit) {
                    if (cardValues.indexOf(played.card.value) > cardValues.indexOf(winningCard.value)) {
                        [winningCard, winnerId] = [played.card, played.playerId];
                    }
                }
            }
            gameState.roundData.tricksWon[winnerId]++;
            io.to(gameState.room).emit('trickWon', { winnerName: gameState.players[winnerId].name, tricksWon: gameState.roundData.tricksWon });
            
            gameState.roundData.currentTrick = [];
            gameState.roundData.trickLeadSuit = null;
            gameState.roundData.turn = winnerId;
            const winnerIdx = turnOrder.indexOf(winnerId);
            gameState.roundData.turnOrder = [...turnOrder.slice(winnerIdx), ...turnOrder.slice(0, winnerIdx)];
            
            if (player.hand.length === 0) {
                setTimeout(() => {
                    Object.keys(gameState.players).forEach(id => {
                        const declared = parseInt(gameState.roundData.declarations[id], 10);
                        const won = gameState.roundData.tricksWon[id];
                        if (declared === won) {
                            gameState.players[id].score += gameState.currentRound + declared;
                        }
                    });
                    io.to(gameState.room).emit('roundOver', { scores: gameState.players });
                    setTimeout(startNewRound, 5000);
                }, 3000);
            } else {
                io.to(winnerId).emit('yourTurnToPlay', { leadSuit: null });
            }
        } else {
            const currentIdx = turnOrder.indexOf(socket.id);
            const nextPlayerId = turnOrder[(currentIdx + 1) % turnOrder.length];
            gameState.roundData.turn = nextPlayerId;
            io.to(nextPlayerId).emit('yourTurnToPlay', { leadSuit: gameState.roundData.trickLeadSuit });
        }
    });

    socket.on('sendMessage', (message) => {
        const name = gameState.players[socket.id] ? gameState.players[socket.id].name : 'Spettatore';
        io.to(gameState.room).emit('newMessage', { name, message });
    });

    socket.on('disconnect', () => {
        if (gameState.players[socket.id]) {
            console.log(`Giocatore ${gameState.players[socket.id].name} disconnesso.`);
            io.to(gameState.room).emit('playerLeft', 'Un giocatore ha lasciato. La partita sarà resettata.');
            // Il reset completo è il modo più semplice per gestire l'abbandono di un giocatore
            gameState = createInitialGameState();
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server in ascolto sulla porta ${PORT}`));
