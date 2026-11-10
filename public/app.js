'use strict';

/* =========================================================
   0. small helpers
   ========================================================= */
const $ = (sel) => document.querySelector(sel);
const show = (el) => el.removeAttribute('hidden');
const hide = (el) => el.setAttribute('hidden', '');

let toastTimer;
function toast(text, ms = 2200) {
  const el = $('#toast');
  el.textContent = text;
  show(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => hide(el), ms);
}

const initials = (name) =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '?';

const time = (ts) =>
  new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

$('#year').textContent = new Date().getFullYear();

/* =========================================================
   1. CALCULATOR  (secret code: 150824 then "=")
   ========================================================= */
const SECRET = '150824';

const calcPanel = $('#calcPanel');
const calcDisplay = $('#calcDisplay');
const calcToggle = $('#calcToggle');

let expr = '';

function renderCalc() {
  calcDisplay.textContent = expr === '' ? '0' : expr;
}

function toggleCalc(force) {
  const open = force ?? calcPanel.hasAttribute('hidden');
  if (open) { show(calcPanel); calcToggle.setAttribute('aria-expanded', 'true'); }
  else { hide(calcPanel); calcToggle.setAttribute('aria-expanded', 'false'); }
}

calcToggle.addEventListener('click', (e) => { e.stopPropagation(); toggleCalc(); });
$('#calcClose').addEventListener('click', () => toggleCalc(false));

document.addEventListener('click', (e) => {
  if (!calcPanel.hasAttribute('hidden') &&
      !calcPanel.contains(e.target) &&
      !calcToggle.contains(e.target)) {
    toggleCalc(false);
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') toggleCalc(false);
});

function safeEval(raw) {
  if (!/^[0-9+\-*/().\s]+$/.test(raw)) return null;
  try {
    const value = Function(`"use strict";return (${raw})`)();
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function pressKey(key) {
  if (key === 'C') { expr = ''; renderCalc(); return; }
  if (key === 'back') { expr = expr.slice(0, -1); renderCalc(); return; }

  if (key === '=') {
    const typed = expr.replace(/\s+/g, '');
    const result = safeEval(expr);

    if (result !== null) {
      expr = String(result);
      renderCalc();
    } else if (expr !== '') {
      toast('Invalid expression');
    }

    if (typed === SECRET) {
      calcDisplay.classList.add('flash');
      setTimeout(() => calcDisplay.classList.remove('flash'), 500);
      expr = '';
      renderCalc();
      setTimeout(() => { toggleCalc(false); openChat(); }, 260);
    }
    return;
  }

  if (expr.length < 32) {
    expr += key;
    renderCalc();
  }
}

$('#calcKeys').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-k]');
  if (btn) pressKey(btn.dataset.k);
});

// physical keyboard support while the panel is open
document.addEventListener('keydown', (e) => {
  if (calcPanel.hasAttribute('hidden')) return;
  if (e.key === 'Enter') { e.preventDefault(); pressKey('='); return; }
  if (e.key === 'Backspace') { e.preventDefault(); pressKey('back'); return; }
  if (/^[0-9+\-*/().]$/.test(e.key)) pressKey(e.key);
});

/* =========================================================
   2. CHAT
   ========================================================= */
const socket = io({ autoConnect: true });

const overlay = $('#chatOverlay');
const joinScreen = $('#joinScreen');
const chatBody = $('#chatBody');
const joinForm = $('#joinForm');
const nameInput = $('#nameInput');
const messagesEl = $('#messages');
const composer = $('#composer');
const messageInput = $('#messageInput');
const onlineList = $('#onlineList');
const onlineCount = $('#onlineCount');
const onlinePanel = $('#onlinePanel');
const typingLine = $('#typingLine');
const emojiPicker = $('#emojiPicker');
const launcher = $('#chatLauncher');
const badge = $('#chatBadge');
const chatStatus = $('#chatStatus');

let me = null;
let online = [];
let unread = 0;
let typingTimer = null;
let lastTypingSent = 0;

const EMOJIS = [
  '😀','😄','😁','😆','🥹','😂','🤣','😊','😇','🙂','😉','😍','🥰','😘','😎','🤓',
  '🤔','😐','😴','😮','😢','😭','😤','😡','🥳','🤯','😱','🙌','👏','👍','👎','🙏',
  '💪','✌️','🤝','👋','🔥','⭐','✨','💯','🎉','🎓','📚','📝','✏️','🧮','🏆','📱',
  '❤️','🧡','💛','💚','💙','💜','🐼','☕','🍎','🌈','🚀','⏰','✅','❌','❓','💬'
];

/* ---------- name persistence ---------- */
const savedName = localStorage.getItem('gp_chat_name') || '';
nameInput.value = savedName;

/* ---------- open / close ---------- */
function openChat() {
  show(overlay);
  if (me) {
    hide(joinScreen);
    show(chatBody);
    setTimeout(() => messageInput.focus(), 120);
  } else {
    show(joinScreen);
    hide(chatBody);
    setTimeout(() => nameInput.focus(), 120);
  }
  clearUnread();
  hide(launcher);
}

function closeChat() {
  hide(overlay);
  hide(emojiPicker);
  if (me) show(launcher);
}

function clearUnread() {
  unread = 0;
  hide(badge);
}

$('#chatClose').addEventListener('click', closeChat);
overlay.addEventListener('click', (e) => { if (e.target === overlay) closeChat(); });
launcher.addEventListener('click', openChat);
$('#onlineToggle').addEventListener('click', () => onlinePanel.classList.toggle('open'));

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !overlay.hasAttribute('hidden')) closeChat();
});

/* ---------- join ---------- */
joinForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = nameInput.value.trim().slice(0, 20);
  if (!name) return;
  localStorage.setItem('gp_chat_name', name);
  socket.emit('join', name);
});

socket.on('joined', ({ me: self }) => {
  me = self;
  hide(joinScreen);
  show(chatBody);
  hide(launcher);
  chatStatus.textContent = 'Live · everyone online can see this';
  setTimeout(() => messageInput.focus(), 120);
});

socket.on('full', () => toast('Chat is full right now — try again in a moment.'));
socket.on('rate-limited', () => toast('Slow down a little 🙂'));

/* ---------- incoming ---------- */
socket.on('welcome', ({ history }) => {
  messagesEl.innerHTML = '';
  (history || []).forEach(addMessage);
});

socket.on('message', (msg) => {
  addMessage(msg);
  if (overlay.hasAttribute('hidden') || !me) {
    if (!msg.type || msg.type === 'chat') {
      unread += 1;
      badge.textContent = unread > 99 ? '99+' : String(unread);
      show(badge);
    }
  }
});

socket.on('presence', (list) => {
  online = list;
  renderOnline();
});

socket.on('typing', ({ id, name, typing }) => {
  if (typing) {
    typingLine.textContent = `${name} is typing…`;
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => (typingLine.textContent = ''), 2500);
  } else if (typingLine.textContent === `${name} is typing…`) {
    typingLine.textContent = '';
  }
  void id;
});

/* ---------- render ---------- */
function addMessage(msg) {
  const nearBottom =
    messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 120;

  if (msg.type === 'system') {
    const sys = document.createElement('div');
    sys.className = 'sys';
    sys.textContent = msg.text;
    messagesEl.appendChild(sys);
  } else {
    const mine = me && msg.userId === me.id;
    const wrap = document.createElement('div');
    wrap.className = 'msg' + (mine ? ' mine' : '');

    const av = document.createElement('span');
    av.className = 'avatar';
    av.style.background = msg.color || '#5b6472';
    av.textContent = initials(msg.name);

    const body = document.createElement('div');
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `${mine ? 'You' : msg.name} · ${time(msg.ts)}`;

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = msg.text;   // textContent = XSS-safe

    body.append(meta, bubble);
    wrap.append(av, body);
    messagesEl.appendChild(wrap);
  }

  if (nearBottom) messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderOnline() {
  onlineCount.textContent = String(online.length);
  onlineList.innerHTML = '';

  online.forEach((u) => {
    const li = document.createElement('li');
    if (me && u.id === me.id) li.classList.add('self');

    const av = document.createElement('span');
    av.className = 'avatar';
    av.style.background = u.color;
    av.textContent = initials(u.name);

    const name = document.createElement('span');
    name.textContent = me && u.id === me.id ? `${u.name} (you)` : u.name;

    const dot = document.createElement('span');
    dot.className = 'dot';

    li.append(av, name, dot);
    onlineList.appendChild(li);
  });
}

/* ---------- sending ---------- */
composer.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (!text || !me) return;
  socket.emit('message', text);
  messageInput.value = '';
  socket.emit('typing', false);
  lastTypingSent = 0;
  messageInput.focus();
});

messageInput.addEventListener('input', () => {
  if (!me) return;
  const now = Date.now();
  if (messageInput.value && now - lastTypingSent > 1200) {
    lastTypingSent = now;
    socket.emit('typing', true);
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => socket.emit('typing', false), 2600);
  }
  if (!messageInput.value) socket.emit('typing', false);
});

/* ---------- emoji picker ---------- */
EMOJIS.forEach((emoji) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = emoji;
  b.addEventListener('click', () => {
    const start = messageInput.selectionStart ?? messageInput.value.length;
    const end = messageInput.selectionEnd ?? messageInput.value.length;
    messageInput.value =
      messageInput.value.slice(0, start) + emoji + messageInput.value.slice(end);
    messageInput.selectionStart = messageInput.selectionEnd = start + emoji.length;
    messageInput.focus();
  });
  emojiPicker.appendChild(b);
});

$('#emojiBtn').addEventListener('click', () => {
  emojiPicker.hasAttribute('hidden') ? show(emojiPicker) : hide(emojiPicker);
});

/* ---------- connection state ---------- */
socket.on('connect', () => {
  chatStatus.textContent = me ? 'Reconnected' : 'Connected';
});
socket.on('disconnect', () => {
  chatStatus.textContent = 'Reconnecting…';
});
