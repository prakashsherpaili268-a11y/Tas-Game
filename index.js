const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const { nanoid } = require('nanoid');
const { TeenPattiTable } = require('./gameEngine');
const { CallBreakTable } = require('./callBreakEngine');

const path = require('path');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const tables = new Map(); // tableId -> TeenPattiTable
const cbTables = new Map(); // tableId -> CallBreakTable

app.get('/health', (req, res) => res.json({ ok: true, tables: tables.size }));

function broadcastState(tableId) {
  const table = tables.get(tableId);
  if (!table) return;
  for (const p of table.players) {
    io.to(p.id).emit('state', table.getPublicState(p.id));
  }
}

function broadcastCbState(tableId) {
  const table = cbTables.get(tableId);
  if (!table) return;
  for (const p of table.players) {
    io.to(p.id).emit('cbState', table.getPublicState(p.id));
  }
}

io.on('connection', (socket) => {
  let joinedTableId = null;
  let joinedCbTableId = null;

  socket.on('createTable', ({ name, boot = 5 }, cb) => {
    const tableId = nanoid(6).toUpperCase();
    const table = new TeenPattiTable(tableId, boot);
    table.addPlayer(socket.id, name);
    tables.set(tableId, table);
    joinedTableId = tableId;
    socket.join(tableId);
    cb?.({ ok: true, tableId, state: table.getPublicState(socket.id) });
  });

  socket.on('joinTable', ({ tableId, name }, cb) => {
    const table = tables.get(tableId);
    if (!table) return cb?.({ ok: false, error: 'Table not found' });
    table.addPlayer(socket.id, name);
    joinedTableId = tableId;
    socket.join(tableId);
    cb?.({ ok: true, state: table.getPublicState(socket.id) });
    broadcastState(tableId);
  });

  socket.on('startRound', (_, cb) => {
    try {
      const table = tables.get(joinedTableId);
      table.startRound();
      cb?.({ ok: true });
      broadcastState(joinedTableId);
    } catch (e) {
      cb?.({ ok: false, error: e.message });
    }
  });

  const actions = ['playBlind', 'playUltraBlind', 'seeCards', 'playSeen', 'pack', 'show'];
  for (const action of actions) {
    socket.on(action, (_, cb) => {
      try {
        const table = tables.get(joinedTableId);
        const result = table[action](socket.id);
        cb?.({ ok: true, result });
        broadcastState(joinedTableId);
        if (result && result.winnerId) {
          io.to(joinedTableId).emit('roundEnded', result);
        }
      } catch (e) {
        cb?.({ ok: false, error: e.message });
      }
    });
  }

  socket.on('raiseSeen', ({ newStake }, cb) => {
    try {
      const table = tables.get(joinedTableId);
      table.raiseSeen(socket.id, newStake);
      cb?.({ ok: true });
      broadcastState(joinedTableId);
    } catch (e) {
      cb?.({ ok: false, error: e.message });
    }
  });

  socket.on('sideShow', ({ response }, cb) => {
    try {
      const table = tables.get(joinedTableId);
      table.sideShow(socket.id, response);
      cb?.({ ok: true });
      broadcastState(joinedTableId);
    } catch (e) {
      cb?.({ ok: false, error: e.message });
    }
  });

  // ---- Call Break ----
  socket.on('cbCreateTable', ({ name, totalRounds = 5 }, cb) => {
    const tableId = nanoid(6).toUpperCase();
    const table = new CallBreakTable(tableId, totalRounds);
    table.addPlayer(socket.id, name);
    cbTables.set(tableId, table);
    joinedCbTableId = tableId;
    socket.join('cb:' + tableId);
    cb?.({ ok: true, tableId, state: table.getPublicState(socket.id) });
  });

  socket.on('cbJoinTable', ({ tableId, name }, cb) => {
    const table = cbTables.get(tableId);
    if (!table) return cb?.({ ok: false, error: 'Table not found' });
    try {
      table.addPlayer(socket.id, name);
    } catch (e) {
      return cb?.({ ok: false, error: e.message });
    }
    joinedCbTableId = tableId;
    socket.join('cb:' + tableId);
    cb?.({ ok: true, state: table.getPublicState(socket.id) });
    broadcastCbState(tableId);
  });

  socket.on('cbStartRound', (_, cb) => {
    try {
      const table = cbTables.get(joinedCbTableId);
      table.startRound();
      cb?.({ ok: true });
      broadcastCbState(joinedCbTableId);
    } catch (e) {
      cb?.({ ok: false, error: e.message });
    }
  });

  socket.on('cbBid', ({ amount }, cb) => {
    try {
      const table = cbTables.get(joinedCbTableId);
      table.placeBid(socket.id, amount);
      cb?.({ ok: true });
      broadcastCbState(joinedCbTableId);
    } catch (e) {
      cb?.({ ok: false, error: e.message });
    }
  });

  socket.on('cbPlayCard', ({ card }, cb) => {
    try {
      const table = cbTables.get(joinedCbTableId);
      table.playCard(socket.id, card);
      cb?.({ ok: true });
      broadcastCbState(joinedCbTableId);
    } catch (e) {
      cb?.({ ok: false, error: e.message });
    }
  });

  socket.on('disconnect', () => {
    const table = tables.get(joinedTableId);
    if (table) {
      const p = table.players.find((pl) => pl.id === socket.id);
      if (p) p.connected = false;
      broadcastState(joinedTableId);
    }
    const cbTable = cbTables.get(joinedCbTableId);
    if (cbTable) {
      const p = cbTable.players.find((pl) => pl.id === socket.id);
      if (p) p.connected = false;
      broadcastCbState(joinedCbTableId);
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Teen Patti server running on port ${PORT}`));
