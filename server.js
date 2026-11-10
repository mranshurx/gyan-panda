'use strict';

const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;

const MAX_HISTORY = 100;          // messages kept in memory
const MAX_MESSAGE_LEN = 500;      // characters per message
const MAX_NAME_LEN = 20;
const RATE_WINDOW_MS = 10000;     // rate limit window
const RATE_MAX = 15;              // messages per window
const MAX_USERS = 300;            // hard cap on concurrent chatters

const app = express();
app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 1e5,
  pingTimeout: 20000,
  cors: { origin: '*' }
});

/** @type {Map<string, {id:string,name:string,color:string,joinedAt:number}>} */
const users = new Map();
/** @type {Array<object>} */
const history = [];

const COLORS = [
  '#e23b3b', '#f59e0b', '#10b981', '#3b82f6',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'
];

const clean = (s, max) =>
  String(s == null ? '' : s)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

const publicUser = (u) => ({ id: u.id, name: u.name, color: u.color });

function broadcastPresence() {
  io.emit('presence', [...users.values()].map(publicUser));
}

function trimHistory() {
  while (history.length > MAX_HISTORY) history.shift();
}

function pushMessage(msg) {
  history.push(msg);
  trimHistory();
  io.emit('message', msg);
}

function systemMessage(text) {
  pushMessage({
    id: crypto.randomUUID(),
    type: 'system',
    text,
    ts: Date.now()
  });
}

function rateOk(socket) {
  const now = Date.now();
  const s = socket.data;
  if (!s.windowStart || now - s.windowStart > RATE_WINDOW_MS) {
    s.windowStart = now;
    s.windowCount = 0;
  }
  s.windowCount = (s.windowCount || 0) + 1;
  return s.windowCount <= RATE_MAX;
}

io.on('connection', (socket) => {
  socket.data.windowStart = 0;
  socket.data.windowCount = 0;

  socket.emit('welcome', { history });

  socket.on('join', (rawName) => {
    if (users.has(socket.id)) return;
    if (users.size >= MAX_USERS) {
      socket.emit('full');
      return;
    }

    const name = clean(rawName, MAX_NAME_LEN) || 'Student';
    const user = {
      id: socket.id,
      name,
      color: COLORS[users.size % COLORS.length],
      joinedAt: Date.now()
    };

    users.set(socket.id, user);
    socket.emit('joined', { me: publicUser(user) });
    broadcastPresence();
    systemMessage(`${name} joined the chat`);
  });

  socket.on('message', (raw) => {
    const user = users.get(socket.id);
    if (!user) return;
    if (!rateOk(socket)) {
      socket.emit('rate-limited');
      return;
    }

    const text = clean(raw, MAX_MESSAGE_LEN);
    if (!text) return;

    pushMessage({
      id: crypto.randomUUID(),
      type: 'chat',
      userId: user.id,
      name: user.name,
      color: user.color,
      text,
      ts: Date.now()
    });
  });

  socket.on('typing', (isTyping) => {
    const user = users.get(socket.id);
    if (!user) return;
    socket.broadcast.emit('typing', { id: user.id, name: user.name, typing: !!isTyping });
  });

  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (!user) return;
    users.delete(socket.id);
    broadcastPresence();
    systemMessage(`${user.name} left the chat`);
  });
});

server.listen(PORT, () => {
  console.log(`Gyan Panda clone running on http://localhost:${PORT}`);
});
