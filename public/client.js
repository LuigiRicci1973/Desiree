document.addEventListener('DOMContentLoaded', () => {

    const socket = io();

    // Elementi DOM
    const loginScreen = document.getElementById('login-screen');
    const gameScreen = document.getElementById('game-screen');
    const nameInput = document.getElementById('name-input');
    const joinButton = document.getElementById('join-button');
    const chatInput = document.getElementById('chat-input');
    const playerList = document.getElementById('player-list');
    const playerHandDiv = document.getElementById('player-hand');
    const table = document.getElementById('table');
    const topPlayersArea = document.getElementById('top-players-area');
    const trickArea = document.getElementById('trick-area');
    const chatMessages = document.getElementById('chat-messages');
    const actionArea = document.getElementById('action-area');
    const startGameButton = document.getElementById('start-game-button');
    const roundNumberSpan = document.getElementById('round-number');
    const trumpCardSpan = document.getElementById('trump-card');
    const declarationsTotalSpan = document.getElementById('declarations-total');

    // Stato del client
    let myId = null;
    let myHand = [];
    let currentRound = 0;
    let isMyTurnToPlay = false;
    let totalDeclarations = 0;

    // Gestione Login e Chat
    joinButton.addEventListener('click', () => {
        const name = nameInput.value.trim();
        if (name) {
            socket.emit('joinGame', { name });
            loginScreen.classList.add('hidden');
            gameScreen.classList.remove('hidden');
        }
    });

    startGameButton.addEventListener('click', () => {
        socket.emit('startGame');
        startGameButton.classList.add('hidden');
    });

    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && chatInput.value) {
            socket.emit('sendMessage', chatInput.value);
            chatInput.value = '';
        }
    });

    // FUNZIONI DI RENDER
    function renderPlayersOnTable(players, turnOrder, dealerId) {
        topPlayersArea.innerHTML = '';
        if(!turnOrder) return;
        turnOrder.forEach(playerId => {
            const player = players[playerId];
            if (!player) return;
            const slot = document.createElement('div');
            slot.className = 'player-slot';
            slot.id = `player-slot-${player.id}`;
            if (player.id === myId) {
                slot.classList.add('my-player-highlight');
            }
            const isDealer = player.id === dealerId;
            const dealerTag = isDealer ? ' (M)' : '';
            const myTag = player.id === myId ? ' (Tu)' : '';
            slot.innerHTML = `
                <div class="player-name">${player.name}${myTag}${dealerTag}</div>
                <div class="player-info">
                    <div id="declaration-${player.id}">Dichiara: ?</div>
                    <div id="tricks-${player.id}">Prese: 0</div>
                </div>`;
            if (isDealer) slot.style.borderColor = 'cyan';
            topPlayersArea.appendChild(slot);
        });
    }

    function renderPlayerList(players) {
        playerList.innerHTML = '';
        Object.values(players).forEach(p => { playerList.innerHTML += `<li>${p.name} (Punti: ${p.score})</li>`; });
    }

    function renderHand(hand, leadSuit = null) {
        myHand = hand;
        playerHandDiv.innerHTML = '';
        const canFollowSuit = leadSuit ? hand.some(c => c.suit === leadSuit) : false;
        hand.forEach(card => {
            const cardDiv = createCardDiv(card);
            if (isMyTurnToPlay) {
                let isCardPlayable = (leadSuit) ? (canFollowSuit ? card.suit === leadSuit : true) : true;
                if (isCardPlayable) {
                    cardDiv.classList.add('playable');
                    cardDiv.addEventListener('click', () => socket.emit('playCard', card));
                }
            }
            playerHandDiv.appendChild(cardDiv);
        });
    }

    function createCardDiv(card) {
        const div = document.createElement('div');
        div.className = 'card';
        if (!card || !card.suit) return div;
        const color = (card.suit === 'CUORI' || card.suit === 'QUADRI') ? 'red' : 'black';
        div.classList.add(color);
        const suitSymbols = { 'CUORI': '♥', 'QUADRI': '♦', 'FIORI': '♣', 'PICCHE': '♠' };
        div.innerHTML = `<span>${card.value}</span><span>${suitSymbols[card.suit] || ''}</span>`;
        return div;
    }

    // GESTIONE EVENTI DAL SERVER
    socket.on('connect', () => { myId = socket.id; });
    socket.on('canStart', () => { startGameButton.classList.remove('hidden'); });
    socket.on('updatePlayers', (players) => {
        renderPlayerList(players);
        if (Object.keys(players).length > 0 && !gameScreen.classList.contains('hidden')) {
            renderPlayersOnTable(players, Object.keys(players), null);
        }
    });
    socket.on('newRound', ({ round, players, trumpCard, dealerId, turnOrder }) => {
        isMyTurnToPlay = false;
        currentRound = round;
        totalDeclarations = 0;
        roundNumberSpan.textContent = round;
        declarationsTotalSpan.textContent = 'MANI DICHIARATE: 0';
        trumpCardSpan.innerHTML = (trumpCard && trumpCard.suit !== 'NO_TRUMP') ? '' : '<span>Nessuna Briscola</span>';
        if (trumpCard && trumpCard.suit !== 'NO_TRUMP') trumpCardSpan.appendChild(createCardDiv(trumpCard));
        renderPlayerList(players);
        renderPlayersOnTable(players, turnOrder, dealerId);
        if (players[myId]) { myHand = players[myId].hand; renderHand(myHand); }
        actionArea.innerHTML = '<h2>Inizia la fase di dichiarazione...</h2>';
        trickArea.innerHTML = '';
    });
    socket.on('yourTurnToDeclare', ({ forbiddenNumber }) => {
        actionArea.innerHTML = `<h3>Quante mani pensi di prendere?</h3>`;
        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'declaration-button-container';
        for (let i = 0; i <= 13; i++) {
            const btn = document.createElement('button');
            btn.className = 'declaration-btn';
            btn.textContent = i;
            if (i > currentRound || (forbiddenNumber !== undefined && i === forbiddenNumber)) {
                btn.disabled = true;
            } else {
                btn.addEventListener('click', () => {
                    socket.emit('declare', i);
                    actionArea.innerHTML = '<h3>In attesa degli altri...</h3>';
                });
            }
            buttonContainer.appendChild(btn);
        }
        actionArea.appendChild(buttonContainer);
    });
    socket.on('playerDeclared', ({ playerId, declaration }) => {
        totalDeclarations += declaration;
        declarationsTotalSpan.textContent = `MANI DICHIARATE: ${totalDeclarations}`;
        const declarationDiv = document.getElementById(`declaration-${playerId}`);
        if (declarationDiv) declarationDiv.textContent = `Dichiara: ${declaration}`;
    });
    socket.on('allDeclared', () => { actionArea.innerHTML = ''; });
    socket.on('yourTurnToPlay', ({ leadSuit }) => {
        actionArea.innerHTML = '<h3>Tocca a te, gioca una carta!</h3>';
        isMyTurnToPlay = true;
        renderHand(myHand, leadSuit);
    });
    socket.on('cardPlayed', ({ playerId, name, card, hand }) => {
        const display = document.createElement('div');
        display.className = 'played-card-display';
        display.innerHTML = `<p>${name}</p>`;
        display.appendChild(createCardDiv(card));
        trickArea.appendChild(display);
        if (playerId === myId) {
            isMyTurnToPlay = false;
            myHand = hand;
            renderHand(myHand);
        }
    });
    socket.on('trickWon', ({ winnerName, tricksWon }) => {
        const winnerAnnouncement = document.createElement('div');
        winnerAnnouncement.className = 'trick-winner-announcement';
        winnerAnnouncement.textContent = `Prende la mano ${winnerName}!`;
        table.appendChild(winnerAnnouncement);
        for (const [playerId, count] of Object.entries(tricksWon)) {
            const tricksDiv = document.getElementById(`tricks-${playerId}`);
            if (tricksDiv) tricksDiv.textContent = `Prese: ${count}`;
        }
        setTimeout(() => {
            winnerAnnouncement.remove();
            trickArea.innerHTML = '';
            actionArea.innerHTML = '';
        }, 3000);
    });
    socket.on('roundOver', ({ scores }) => {
        actionArea.innerHTML = `<h3>Fine Round!</h3> ${Object.values(scores).map(p => `<p>${p.name}: ${p.score} pt.</p>`).join('')}`;
        renderPlayerList(scores);
    });
    socket.on('newMessage', ({ name, message }) => {
        const msgDiv = document.createElement('div');
        msgDiv.textContent = `${name}: ${message}`;
        chatMessages.appendChild(msgDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    });
    socket.on('invalidDeclaration', (message) => { alert(message); });
    socket.on('invalidMove', (message) => { alert(message); });
    socket.on('gameError', (message) => { alert(message); window.location.reload(); });
    socket.on('playerLeft', (message) => {
        alert(message);
        window.location.reload();
    });
});
