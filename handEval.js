// Teen Patti hand evaluation
// Categories (high to low): Trail(6) > Pure Sequence(5) > Sequence(4) > Color(3) > Pair(2) > High Card(1)

const CATEGORY = {
  TRAIL: 6,
  PURE_SEQUENCE: 5,
  SEQUENCE: 4,
  COLOR: 3,
  PAIR: 2,
  HIGH_CARD: 1,
};

const CATEGORY_NAME = {
  6: 'Trail (Tin Tara)',
  5: 'Pure Sequence',
  4: 'Sequence (Run)',
  3: 'Color (Flush)',
  2: 'Pair',
  1: 'High Card',
};

function evaluateHand(cards) {
  const ranks = cards.map((c) => c.rank).sort((a, b) => b - a); // descending
  const suits = cards.map((c) => c.suit);

  const isFlush = suits[0] === suits[1] && suits[1] === suits[2];
  const isTrail = ranks[0] === ranks[1] && ranks[1] === ranks[2];

  const isSpecialLowRun = ranks[0] === 14 && ranks[1] === 3 && ranks[2] === 2; // A-3-2 => A-2-3 run
  const isNormalRun = ranks[0] - ranks[1] === 1 && ranks[1] - ranks[2] === 1;
  const isSequence = isSpecialLowRun || isNormalRun;

  const seqValue = isSpecialLowRun ? 3 : ranks[0]; // A-2-3 sits just below 2-3-4 (value 4)
  const seqValueAdjusted = isSpecialLowRun ? 3.5 : ranks[0]; // keep strictly below 4 top (2,3,4) but above nothing; 3.5<4

  let category, tiebreak;

  if (isTrail) {
    category = CATEGORY.TRAIL;
    tiebreak = [ranks[0]];
  } else if (isSequence && isFlush) {
    category = CATEGORY.PURE_SEQUENCE;
    tiebreak = [isSpecialLowRun ? 3.5 : ranks[0]];
  } else if (isSequence) {
    category = CATEGORY.SEQUENCE;
    tiebreak = [isSpecialLowRun ? 3.5 : ranks[0]];
  } else if (isFlush) {
    category = CATEGORY.COLOR;
    tiebreak = [...ranks];
  } else if (ranks[0] === ranks[1] || ranks[1] === ranks[2]) {
    category = CATEGORY.PAIR;
    const pairRank = ranks[0] === ranks[1] ? ranks[0] : ranks[1];
    const kicker = ranks[0] === ranks[1] ? ranks[2] : ranks[0];
    tiebreak = [pairRank, kicker];
  } else {
    category = CATEGORY.HIGH_CARD;
    tiebreak = [...ranks];
  }

  return { category, categoryName: CATEGORY_NAME[category], tiebreak, cards };
}

// Returns 1 if handA wins, -1 if handB wins, 0 if exact tie
function compareHands(handA, handB) {
  const evalA = evaluateHand(handA);
  const evalB = evaluateHand(handB);

  if (evalA.category !== evalB.category) {
    return evalA.category > evalB.category ? 1 : -1;
  }

  for (let i = 0; i < Math.max(evalA.tiebreak.length, evalB.tiebreak.length); i++) {
    const a = evalA.tiebreak[i] ?? 0;
    const b = evalB.tiebreak[i] ?? 0;
    if (a !== b) return a > b ? 1 : -1;
  }

  return 0; // true tie (rare, e.g. identical rank runs of different suits already handled by color check)
}

module.exports = { evaluateHand, compareHands, CATEGORY, CATEGORY_NAME };
