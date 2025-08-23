const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static('public'));

let gameState = createInitialGameState();

function createInitialGameState() {
    return {
        room: "Desiree",
        players: {},
        gameStarted: false,
        currentRound: 0,
        tableOrder: [],
        dealerIndex: -1,
        roundData: {}
    };
}

function resetRoundData() {
    gameState.roundData = {
        deck: [], trumpCard: null, declarations: {}, turn: null,
        currentTrick: [], tricksWon: {}, trickLeadSuit: null, turnOrder: []
    };
}

function createDeck() {
    const suits = ['CUORI', 'FIORI', 'QUADRI', 'PICCHE'];
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
    Object.values(gameState.players).forEach(p => p.status = 'active'); // Imposta tutti come attivi
    for (let i = gameState.tableOrder.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [gameState.tableOrder[i], gameState.tableOrder[j]] = [gameState.tableOrder[j], gameState.tableOrder[i]];
    }
    gameState.dealerIndex = -1;
    startNewRound();
}

async function startNewRound() {
    gameState.currentRound++;

    const activePlayersIds = gameState.tableOrder.filter(id => gameState.players[id] && gameState.players[id].status === 'active');
    const numActivePlayers = activePlayersIds.length;

    if ((gameState.currentRound * numActivePlayers) > 52 && numActivePlayers > 4) {
        const activePlayers = activePlayersIds.map(id => gameState.players[id]);
        activePlayers.sort((a, b) => a.score - b.score);
        const playerToEliminate = activePlayers[0];

        if (playerToEliminate) {
            gameState.players[playerToEliminate.id].status = 'eliminated';
            io.to(gameState.room).emit('playerEliminated', playerToEliminate.name);
            io.to(playerToEliminate.id).emit('youAreEliminated');
            await new Promise(resolve => setTimeout(resolve, 4000));
        }
    }

    resetRoundData();
    const currentActivePlayers = gameState.tableOrder.filter(id => gameState.players[id] && gameState.players[id].status === 'active');

    if (currentActivePlayers.length < 4) {
        io.to(gameState.room).emit('gameOver', { scores: gameState.players });
        gameState.gameStarted = false;
        return;
    }

    gameState.dealerIndex = (gameState.dealerIndex + 1) % currentActivePlayers.length;
    const dealerId = currentActivePlayers[gameState.dealerIndex];
    const firstToDeclareIndex = (gameState.dealerIndex + 1) % currentActivePlayers.length;

    gameState.roundData.turnOrder = [
        ...currentActivePlayers.slice(firstToDeclareIndex),
        ...currentActivePlayers.slice(0, firstToDeclareIndex)
    ];

    gameState.roundData.deck = createDeck();
    const suitOrder = ['CUORI', 'FIORI', 'QUADRI', 'PICCHE'];
    const valueOrder = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

    gameState.roundData.turnOrder.forEach(id => {
        if (gameState.players[id]) {
            let tempHand = [];
            for (let i = 0; i < gameState.currentRound; i++) {
                if (gameState.roundData.deck.length > 0) tempHand.push(gameState.roundData.deck.pop());
            }
            tempHand.sort((a, b) => {
                const suitComparison = suitOrder.indexOf(a.suit) - suitOrder.indexOf(b.suit);
                if (suitComparison !== 0) return suitComparison;
                return valueOrder.indexOf(a.value) - valueOrder.indexOf(b.value);
            });
            gameState.players[id].hand = tempHand;
            gameState.roundData.tricksWon[id] = 0;
        }
    });

    gameState.roundData.trumpCard = (gameState.currentRound < 13 && gameState.roundData.deck.length > 0)
        ? gameState.roundData.deck.pop() : { suit: 'NO_TRUMP', value: '' };

    gameState.roundData.turn = gameState.roundData.turnOrder[0];
    io.to(gameState.room).emit('newRound', {
        round: gameState.currentRound, players: gameState.players, trumpCard: gameState.roundData.trumpCard,
        dealerId: dealerId, turnOrder: gameState.roundData.turnOrder
    });

    const firstPlayerName = gameState.players[gameState.roundData.turn].name;
    io.to(gameState.room).emit('updateStatus', `In attesa che ${firstPlayerName} dichiari...`);
    io.to(gameState.roundData.turn).emit('yourTurnToDeclare', {});
}

io.on('connection', (socket) => {
    console.log('Un giocatore si è connesso:', socket.id);
    socket.on('joinGame', ({ name }) => {
        if (gameState.gameStarted || Object.keys(gameState.players).length >= 10) {
            socket.emit('gameError', 'Partita piena o già iniziata.'); return;
        }
        socket.join(gameState.room);
        gameState.players[socket.id] = { id: socket.id, name, score: 0, hand: [], status: 'active' };
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
            if (declaration === (gameState.currentRound - sumOfPrevious)) {
                socket.emit('invalidDeclaration', `Non puoi dichiarare ${declaration}.`); return;
            }
        }
        gameState.roundData.declarations[socket.id] = declaration;
        io.to(gameState.room).emit('playerDeclared', { playerId: socket.id, declaration });
        const currentIndex = turnOrder.indexOf(socket.id);
        const nextPlayerId = turnOrder[(currentIndex + 1) % turnOrder.length];
        if (Object.keys(gameState.roundData.declarations).length === turnOrder.length) {
            gameState.roundData.turn = turnOrder[0];
            const firstPlayerName = gameState.players[gameState.roundData.turn].name;
            io.to(gameState.room).emit('updateStatus', `In attesa che ${firstPlayerName} giochi...`);
            io.to(gameState.room).emit('allDeclared');
            io.to(gameState.roundData.turn).emit('yourTurnToPlay', { leadSuit: null });
        } else {
            gameState.roundData.turn = nextPlayerId;
            const nextPlayerName = gameState.players[nextPlayerId].name;
            io.to(gameState.room).emit('updateStatus', `In attesa che ${nextPlayerName} dichiari...`);
            let dataForNext = {};
            if (Object.keys(gameState.roundData.declarations).length === turnOrder.length - 1) {
                dataForNext.forbiddenNumber = gameState.currentRound - Object.values(gameState.roundData.declarations).reduce((a, b) => a + b, 0);
            }
            io.to(nextPlayerId).emit('yourTurnToDeclare', dataForNext);
        }
    });
    socket.on('playCard', (card) => {
        if (socket.id !== gameState.roundData.turn) return;
        const player = gameState.players[socket.id];
        const leadSuit = gameState.roundData.trickLeadSuit;
        if (leadSuit && player.hand.some(c => c.suit === leadSuit) && card.suit !== leadSuit) {
            socket.emit('invalidMove', 'Devi rispondere con lo stesso seme!'); return;
        }
        player.hand = player.hand.filter(c => !(c.suit === card.suit && c.value === card.value));
        if (!gameState.roundData.trickLeadSuit) gameState.roundData.trickLeadSuit = card.suit;
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
                        if (gameState.players[id].status === 'active') {
                            const declared = parseInt(gameState.roundData.declarations[id], 10);
                            const won = gameState.roundData.tricksWon[id];
                            if (declared === won) gameState.players[id].score += gameState.currentRound + declared;
                        }
                    });
                    io.to(gameState.room).emit('roundOver', { scores: gameState.players });
                    setTimeout(startNewRound, 5000);
                }, 3000);
            } else {
                const winnerName = gameState.players[winnerId].name;
                io.to(gameState.room).emit('updateStatus', `In attesa che ${winnerName} giochi...`);
                io.to(winnerId).emit('yourTurnToPlay', { leadSuit: null });
            }
        } else {
            const currentIdx = turnOrder.indexOf(socket.id);
            const nextPlayerId = turnOrder[(currentIdx + 1) % turnOrder.length];
            gameState.roundData.turn = nextPlayerId;
            const nextPlayerName = gameState.players[nextPlayerId].name;
            io.to(gameState.room).emit('updateStatus', `In attesa che ${nextPlayerName} giochi...`);
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
            gameState = createInitialGameState();
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server in ascolto sulla porta ${PORT}`));
