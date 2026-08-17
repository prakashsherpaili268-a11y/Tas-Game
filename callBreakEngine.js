const { buildDeck, shuffle } = require('./deck');

/**
 * CALL BREAK — standard rules:
 * - Exactly 4 players, 52 cards, 13 each.
 * - Spades (S) are always trump.
 * - Bidding: each player calls how many tricks (1-13) they think they'll win.
 * - Play: must follow the led suit if possible; if not, may play anything
 *   (including a spade, which then wins unless beaten by a higher spade).
 *   Highest card of the led suit wins the trick unless trumped.
 * - Scoring per round: made bid exactly or more -> bid + 0.1 per extra trick.
 *   Failed to make bid -> -bid.
 * - Played over a fixed number of rounds (default 5), scores accumulate.
 */

const PHASE = { BIDDING: 'bidding', PLAYING: 'playing', ROUND_END: 'round_end', GAME_END: 'game_end' };
const TRUMP = 'S';

class CallBreakTable {
  constructor(tableId, totalRounds = 5) {
    this.tableId = tableId;
    this.totalRounds = totalRounds;
    this.players = []; // { id, name, hand, bid, tricksWon, totalScore, roundScores:[] }
    this.dealerIndex = -1;
    this.turnIndex = -1;
    this.phase = PHASE.BIDDING;
    this.roundNumber = 0;
    this.currentTrick = []; // [{ playerId, card }]
    this.ledSuit = null;
    this.log = [];
  }

  addPlayer(id, name) {
    if (this.players.find((p) => p.id === id)) return;
    if (this.players.length >= 4) throw new Error('Table full (4 players max)');
    this.players.push({ id, name, hand: [], bid: null, tricksWon: 0, totalScore: 0, roundScores: [], connected: true });
  }

  removePlayer(id) {
    this.players = this.players.filter((p) => p.id !== id);
  }

  _log(msg) {
    this.log.push(msg);
    if (this.log.length > 200) this.log.shift();
  }

  playerIndex(id) {
    return this.players.findIndex((p) => p.id === id);
  }

  currentPlayer() {
    return this.players[this.turnIndex];
  }

  _requireTurn(playerId) {
    const p = this.currentPlayer();
    if (!p || p.id !== playerId) throw new Error('Not your turn');
    return p;
  }

  startRound() {
    if (this.players.length !== 4) throw new Error('Need exactly 4 players');

    const deck = shuffle(buildDeck());
    for (const p of this.players) {
      p.hand = deck.splice(0, 13).sort((a, b) => (a.suit === b.suit ? a.rank - b.rank : a.suit.localeCompare(b.suit)));
      p.bid = null;
      p.tricksWon = 0;
    }

    this.roundNumber += 1;
    this.dealerIndex = (this.dealerIndex + 1) % 4;
    this.turnIndex = (this.dealerIndex + 1) % 4; // bidding starts left of dealer
    this.phase = PHASE.BIDDING;
    this.currentTrick = [];
    this.ledSuit = null;

    this._log(`Round ${this.roundNumber} started.`);
    return this.getPublicState();
  }

  placeBid(playerId, bidAmount) {
    const p = this._requireTurn(playerId);
    if (this.phase !== PHASE.BIDDING) throw new Error('Not bidding phase');
    if (!Number.isInteger(bidAmount) || bidAmount < 1 || bidAmount > 13) {
      throw new Error('Bid must be between 1 and 13');
    }
    p.bid = bidAmount;
    this._log(`${p.name} bids ${bidAmount}`);

    this.turnIndex = (this.turnIndex + 1) % 4;
    if (this.players.every((pl) => pl.bid !== null)) {
      this.phase = PHASE.PLAYING;
      this.turnIndex = (this.dealerIndex + 1) % 4; // player left of dealer leads first trick
    }
    return this.getPublicState();
  }

  _hasSuit(hand, suit) {
    return hand.some((c) => c.suit === suit);
  }

  playCard(playerId, card) {
    const p = this._requireTurn(playerId);
    if (this.phase !== PHASE.PLAYING) throw new Error('Not playing phase');

    const idxInHand = p.hand.findIndex((c) => c.rank === card.rank && c.suit === card.suit);
    if (idxInHand === -1) throw new Error('Card not in hand');

    if (this.currentTrick.length === 0) {
      this.ledSuit = card.suit;
    } else {
      const mustFollow = this._hasSuit(p.hand, this.ledSuit);
      if (mustFollow && card.suit !== this.ledSuit) {
        throw new Error(`Must follow suit: ${this.ledSuit}`);
      }
    }

    p.hand.splice(idxInHand, 1);
    this.currentTrick.push({ playerId, card });
    this._log(`${p.name} plays ${this._cardLabel(card)}`);

    if (this.currentTrick.length === 4) {
      return this._resolveTrick();
    }

    this.turnIndex = (this.turnIndex + 1) % 4;
    return this.getPublicState();
  }

  _cardLabel(c) {
    const r = c.rank === 14 ? 'A' : c.rank === 13 ? 'K' : c.rank === 12 ? 'Q' : c.rank === 11 ? 'J' : c.rank;
    return `${r}${c.suit}`;
  }

  _resolveTrick() {
    let winning = this.currentTrick[0];
    for (const entry of this.currentTrick.slice(1)) {
      const { card } = entry;
      const { card: wCard } = winning;
      const entryIsTrump = card.suit === TRUMP;
      const winningIsTrump = wCard.suit === TRUMP;
      if (entryIsTrump && !winningIsTrump) {
        winning = entry;
      } else if (entryIsTrump && winningIsTrump) {
        if (card.rank > wCard.rank) winning = entry;
      } else if (!entryIsTrump && !winningIsTrump && card.suit === this.ledSuit) {
        if (card.rank > wCard.rank) winning = entry;
      }
    }

    const winner = this.players[this.playerIndex(winning.playerId)];
    winner.tricksWon += 1;
    this._log(`${winner.name} wins the trick`);

    this.currentTrick = [];
    this.ledSuit = null;
    this.turnIndex = this.playerIndex(winner.id);

    if (winner.hand.length === 0 && this.players.every((p) => p.hand.length === 0)) {
      return this._endRound();
    }
    return this.getPublicState();
  }

  _endRound() {
    for (const p of this.players) {
      let score;
      if (p.tricksWon >= p.bid) {
        score = p.bid + (p.tricksWon - p.bid) * 0.1;
      } else {
        score = -p.bid;
      }
      p.totalScore = +(p.totalScore + score).toFixed(1);
      p.roundScores.push({ round: this.roundNumber, bid: p.bid, won: p.tricksWon, score: +score.toFixed(1) });
      this._log(`${p.name}: bid ${p.bid}, won ${p.tricksWon} -> ${score >= 0 ? '+' : ''}${score.toFixed(1)}`);
    }

    this.phase = this.roundNumber >= this.totalRounds ? PHASE.GAME_END : PHASE.ROUND_END;
    return this.getPublicState();
  }

  getPublicState(viewerId = null) {
    return {
      tableId: this.tableId,
      phase: this.phase,
      roundNumber: this.roundNumber,
      totalRounds: this.totalRounds,
      turnPlayerId: this.turnIndex >= 0 ? this.players[this.turnIndex]?.id : null,
      dealerId: this.dealerIndex >= 0 ? this.players[this.dealerIndex]?.id : null,
      ledSuit: this.ledSuit,
      currentTrick: this.currentTrick.map((t) => ({ playerId: t.playerId, card: t.card })),
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        connected: p.connected,
        bid: p.bid,
        tricksWon: p.tricksWon,
        totalScore: p.totalScore,
        roundScores: p.roundScores,
        cardCount: p.hand.length,
        hand: p.id === viewerId ? p.hand : undefined,
      })),
      log: this.log.slice(-20),
    };
  }
}

module.exports = { CallBreakTable, PHASE, TRUMP };
