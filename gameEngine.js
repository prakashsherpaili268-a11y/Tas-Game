const { buildDeck, shuffle } = require('./deck');
const { compareHands } = require('./handEval');

/**
 * TEEN PATTI TABLE — betting rules implemented per Prakash's description:
 *
 * - Every player posts `boot` at the start of a round; that goes into the pot.
 * - Turn starts from the player after the dealer/booter and moves clockwise.
 * - A player who hasn't looked at their cards is "blind":
 *     - blind chaal (play) costs `currentStake`
 *     - blind players may also PACK (fold)
 * - A player who has looked at their cards is "seen":
 *     - seen chaal normally costs 2x currentStake
 *     - the FIRST seen chaal right after an "ulta blind" costs 3x the
 *       stake that was active before the ulta blind (a local house-rule
 *       discount) — flagged clearly below since this is a less standard
 *       variant, worth confirming with real play.
 * - ULTA BLIND: only the player sitting immediately after the last
 *   raiser may, while still blind, raise blind stake to 2x currentStake.
 *   This becomes the new currentStake for everyone after them.
 * - SIDE SHOW: a player may ask ONLY the seen player immediately before
 *   them (in turn order) to privately compare hands. Only the requester
 *   pays (seen cost or ulta-blind seen cost, whichever applies). The
 *   smaller hand packs. Not allowed if either party is blind.
 * - SHOW: once only 2 players remain, or if all remaining players are
 *   seen, any player may call show at their normal chaal cost (cannot
 *   decrease stake, can only increase). Higher hand wins the pot.
 */

const STATUS = {
  BLIND: 'blind',
  SEEN: 'seen',
  PACKED: 'packed',
};

class TeenPattiTable {
  constructor(tableId, boot = 5) {
    this.tableId = tableId;
    this.boot = boot;
    this.players = []; // { id, name, chips, hand, status, connected }
    this.deck = [];
    this.pot = 0;
    this.currentStake = boot; // current blind-equivalent stake
    this.turnIndex = -1;
    this.dealerIndex = -1;
    this.lastRaiserIndex = -1; // index of player who last set currentStake
    this.ultraBlindActive = false;
    this.ultraBlindBaseStake = null; // stake before the ultra blind, for the 3x seen rule
    this.ultraBlindEligibleIndex = -1; // only this seat may play ulta blind next
    this.roundActive = false;
    this.log = [];
  }

  addPlayer(id, name, chips = 500, isBot = false) {
    if (this.players.find((p) => p.id === id)) return;
    this.players.push({ id, name, chips, hand: [], status: STATUS.BLIND, connected: true, isBot });
  }

  removePlayer(id) {
    this.players = this.players.filter((p) => p.id !== id);
  }

  activePlayers() {
    return this.players.filter((p) => p.status !== STATUS.PACKED);
  }

  playerIndex(id) {
    return this.players.findIndex((p) => p.id === id);
  }

  currentPlayer() {
    return this.players[this.turnIndex];
  }

  _log(msg) {
    this.log.push(msg);
    if (this.log.length > 200) this.log.shift();
  }

  startRound() {
    if (this.players.length < 2) throw new Error('Need at least 2 players');

    this.deck = shuffle(buildDeck());
    this.pot = 0;
    this.currentStake = this.boot;
    this.ultraBlindActive = false;
    this.ultraBlindBaseStake = null;
    this.ultraBlindEligibleIndex = -1;
    this.roundActive = true;

    this.dealerIndex = (this.dealerIndex + 1) % this.players.length;

    for (const p of this.players) {
      if (!p.connected) continue;
      p.hand = [this.deck.pop(), this.deck.pop(), this.deck.pop()];
      p.status = STATUS.BLIND;
      p.roundChips = 0; // chips this player has put in THIS round
      p.chips -= this.boot;
      p.roundChips += this.boot;
      this.pot += this.boot;
    }

    this.turnIndex = this._nextActiveIndex(this.dealerIndex);
    this.lastRaiserIndex = this.dealerIndex; // stake was "set" by the boot
    this.ultraBlindEligibleIndex = this._nextActiveIndex(this.dealerIndex);

    this._log(`Round started. Boot ${this.boot}, pot ${this.pot}.`);
    return this.getPublicState();
  }

  _nextActiveIndex(fromIndex) {
    const n = this.players.length;
    let i = fromIndex;
    for (let step = 0; step < n; step++) {
      i = (i + 1) % n;
      if (this.players[i].status !== STATUS.PACKED && this.players[i].connected) return i;
    }
    return -1;
  }

  _advanceTurn() {
    if (this.activePlayers().length <= 1) {
      return this._endRoundBySoleSurvivor();
    }
    this.turnIndex = this._nextActiveIndex(this.turnIndex);
    return null;
  }

  _requireTurn(playerId) {
    const p = this.currentPlayer();
    if (!p || p.id !== playerId) throw new Error('Not your turn');
    return p;
  }

  _deduct(player, amount) {
    if (amount > player.chips) throw new Error('Not enough chips');
    player.chips -= amount;
    player.roundChips += amount;
    this.pot += amount;
  }

  // Blind player matches current stake and stays blind
  playBlind(playerId) {
    const p = this._requireTurn(playerId);
    if (p.status !== STATUS.BLIND) throw new Error('Already seen — use playSeen');
    this._deduct(p, this.currentStake);
    this._log(`${p.name} played blind for ${this.currentStake}`);
    const settled = this._advanceTurn();
    return settled || this.getPublicState();
  }

  // Only the seat right after the last raiser may do this, while still blind
  playUltraBlind(playerId) {
    const p = this._requireTurn(playerId);
    if (p.status !== STATUS.BLIND) throw new Error('Only a blind player can play ulta blind');
    const idx = this.playerIndex(playerId);
    if (idx !== this.ultraBlindEligibleIndex) {
      throw new Error('Only the player right after the last raise can play ulta blind');
    }
    const raiseAmount = this.currentStake * 2;
    this._deduct(p, raiseAmount);
    this.ultraBlindActive = true;
    this.ultraBlindBaseStake = this.currentStake;
    this.currentStake = raiseAmount;
    this.lastRaiserIndex = idx;
    this.ultraBlindEligibleIndex = this._nextActiveIndex(idx);
    this._log(`${p.name} played ULTA BLIND for ${raiseAmount}. Stake is now ${this.currentStake}.`);
    const settled = this._advanceTurn();
    return settled || this.getPublicState();
  }

  // Player looks at their cards. If it's their turn, this doubles as their chaal for this turn.
  seeCards(playerId) {
    const p = this.players[this.playerIndex(playerId)];
    if (!p) throw new Error('Player not found');
    if (p.status === STATUS.SEEN) return this.getPublicState();
    p.status = STATUS.SEEN;
    return this.getPublicState(playerId); // private view includes own cards once seen
  }

  // Seen player chaal (must have called seeCards first, or this auto-sees + chaals)
  playSeen(playerId) {
    const p = this._requireTurn(playerId);
    const wasBlind = p.status === STATUS.BLIND;
    if (wasBlind) p.status = STATUS.SEEN;

    let cost;
    const justAfterUltraBlind = this.ultraBlindActive && this.lastRaiserIndex === this.playerIndex(playerId) - 1;
    if (wasBlind && this.ultraBlindActive && this.ultraBlindBaseStake !== null) {
      // first seen chaal right after an ulta blind: 3x the pre-ultra-blind stake
      cost = this.ultraBlindBaseStake * 3;
    } else {
      cost = this.currentStake * 2;
    }

    this._deduct(p, cost);
    this._log(`${p.name} played seen for ${cost}`);
    const settled = this._advanceTurn();
    return settled || this.getPublicState();
  }

  // Seen player raises the stake
  raiseSeen(playerId, newStake) {
    const p = this._requireTurn(playerId);
    if (p.status !== STATUS.SEEN) throw new Error('Only seen players can raise');
    if (newStake <= this.currentStake) throw new Error('Raise must increase the stake');
    const cost = newStake * 2;
    this._deduct(p, cost);
    this.currentStake = newStake;
    this.lastRaiserIndex = this.playerIndex(playerId);
    this.ultraBlindActive = false;
    this._log(`${p.name} raised stake to ${newStake}`);
    const settled = this._advanceTurn();
    return settled || this.getPublicState();
  }

  pack(playerId) {
    const p = this._requireTurn(playerId);
    p.status = STATUS.PACKED;
    this._log(`${p.name} packed`);
    const settled = this._advanceTurn();
    return settled || this.getPublicState();
  }

  // Requester must be seen; target must be the seen player immediately before requester in turn order
  sideShow(requesterId, response) {
    const reqIdx = this.playerIndex(requesterId);
    const req = this.players[reqIdx];
    if (req.status !== STATUS.SEEN) throw new Error('Must be seen to request side show');

    const prevIdx = this._prevActiveIndex(reqIdx);
    const target = this.players[prevIdx];
    if (!target || target.status !== STATUS.SEEN) {
      throw new Error('Side show only allowed with the seen player right before you');
    }

    const cost = this.ultraBlindActive ? this.ultraBlindBaseStake * 3 : this.currentStake * 2;
    this._deduct(req, cost);

    if (response === 'reject') {
      this._log(`${target.name} rejected side show from ${req.name}`);
      const settled1 = this._advanceTurn();
      return settled1 || this.getPublicState();
    }

    const result = compareHands(req.hand, target.hand);
    const loserIdx = result >= 0 ? prevIdx : reqIdx; // req wins ties by rule-of-thumb; adjust as needed
    this.players[loserIdx].status = STATUS.PACKED;
    this._log(`Side show: ${req.name} vs ${target.name} — ${this.players[loserIdx].name} packs`);
    const settled2 = this._advanceTurn();
    return settled2 || this.getPublicState();
  }

  _prevActiveIndex(fromIndex) {
    const n = this.players.length;
    let i = fromIndex;
    for (let step = 0; step < n; step++) {
      i = (i - 1 + n) % n;
      if (this.players[i].status !== STATUS.PACKED && this.players[i].connected) return i;
    }
    return -1;
  }

  canShow() {
    const active = this.activePlayers();
    if (active.length === 2) return true;
    if (active.length > 2 && active.every((p) => p.status === STATUS.SEEN)) return true;
    return false;
  }

  show(playerId) {
    if (!this.canShow()) throw new Error('Show not allowed yet');
    const p = this._requireTurn(playerId);
    const cost = p.status === STATUS.SEEN ? this.currentStake * 2 : this.currentStake;
    this._deduct(p, cost);

    const active = this.activePlayers();
    let winner = active[0];
    for (const pl of active.slice(1)) {
      if (compareHands(pl.hand, winner.hand) > 0) winner = pl;
    }
    return this._settle(winner);
  }

  _endRoundBySoleSurvivor() {
    const winner = this.activePlayers()[0];
    return this._settle(winner);
  }

  _settle(winner) {
    winner.chips += this.pot;
    this._log(`${winner.name} wins pot of ${this.pot}`);
    const result = { winnerId: winner.id, winnerName: winner.name, pot: this.pot, hands: this.players.map(p => ({ id: p.id, name: p.name, hand: p.hand, status: p.status })) };
    this.roundActive = false;
    this.pot = 0;
    return result;
  }

  // playerId: if provided, includes that player's own cards (if seen) in the payload
  getPublicState(viewerId = null) {
    return {
      tableId: this.tableId,
      boot: this.boot,
      pot: this.pot,
      currentStake: this.currentStake,
      ultraBlindActive: this.ultraBlindActive,
      roundActive: this.roundActive,
      turnPlayerId: this.turnIndex >= 0 ? this.players[this.turnIndex]?.id : null,
      ultraBlindEligiblePlayerId: this.ultraBlindEligibleIndex >= 0 ? this.players[this.ultraBlindEligibleIndex]?.id : null,
      canShow: this.canShow(),
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        chips: p.chips,
        status: p.status,
        connected: p.connected,
        isBot: !!p.isBot,
        cardCount: p.hand.length,
        hand: p.id === viewerId && p.status === STATUS.SEEN ? p.hand : undefined,
      })),
      log: this.log.slice(-20),
    };
  }
}

module.exports = { TeenPattiTable, STATUS };
