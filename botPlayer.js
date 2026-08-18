const { evaluateHand } = require('./handEval');

/**
 * Very simple Teen Patti bot heuristic:
 * - While blind: sometimes stays blind (cheap), sometimes looks at cards.
 * - Once seen: strong hands (pair or better) keep playing; weak high-cards
 *   often pack, occasionally bluff-play.
 * This is intentionally simple and readable so it's easy to tune later.
 */
function decide(player) {
  const hand = evaluateHand(player.hand);
  const category = hand.category; // 1(high) .. 6(trail)
  const topRank = hand.tiebreak[0] || 0;

  if (player.status === 'blind') {
    // Stay blind ~45% of the time (cheap bets), otherwise peek and decide
    if (Math.random() < 0.45) return { type: 'playBlind' };
    return { type: 'see' };
  }

  // seen
  if (category >= 4) return { type: 'playSeen' }; // sequence or better — keep playing
  if (category === 3 || category === 2) {
    return Math.random() < 0.75 ? { type: 'playSeen' } : { type: 'pack' };
  }
  // high card only
  if (topRank >= 12) { // Q/K/A high
    return Math.random() < 0.5 ? { type: 'playSeen' } : { type: 'pack' };
  }
  return Math.random() < 0.15 ? { type: 'playSeen' } : { type: 'pack' }; // rare bluff
}

// Executes one bot's turn on the given TeenPattiTable instance.
// Returns the table method's return value (public state, or settle result on round end).
function runBotTurn(table, player) {
  const choice = decide(player);

  try {
    if (choice.type === 'playBlind') {
      return table.playBlind(player.id);
    }
    if (choice.type === 'see') {
      table.seeCards(player.id);
      // re-decide now that hand is "seen"
      const next = decide(player);
      if (next.type === 'pack') return table.pack(player.id);
      return table.playSeen(player.id);
    }
    if (choice.type === 'playSeen') {
      return table.playSeen(player.id);
    }
    return table.pack(player.id);
  } catch (e) {
    // Fallback: if the chosen action fails (e.g. not enough chips), pack safely.
    try {
      return table.pack(player.id);
    } catch (e2) {
      return null;
    }
  }
}

const BOT_NAMES = ['Ram 🤖', 'Sita 🤖', 'Hari 🤖', 'Gita 🤖', 'Shyam 🤖', 'Maya 🤖'];

module.exports = { runBotTurn, BOT_NAMES };
