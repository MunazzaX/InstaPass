/* ═══════════════════════════════════════════════
   INATAPASS – main.js  (v2.0 – fully updated)
   Fixes: email-dup check, BG removal, themes, payment flow
═══════════════════════════════════════════════ */

'use strict';

/* ─────────────────────────────────────────────
   CONFIG
───────────────────────────────────────────── */
const CONFIG = {
  REMOVE_BG_API: 'WDMAgmPpH5xpGnPy4DKbmSZe',
  ACTIVATION_CODE: '@Munazza#',
  DEV_EMAIL: 'munazzashaikh531@gmail.com',
  PLANS: {
    free:    { uploads: 5,       days: 0,  price: 0   },
    monthly: { uploads: Infinity, days: 31, price: 199 },
    premium: { uploads: Infinity, days: 95, price: 550 }
  },
  EMAILJS_SERVICE_ID: 'service_inatapass',
  EMAILJS_PUBLIC_KEY: 'YOUR_EMAILJS_PUBLIC_KEY',
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbxZv0ngksoijxhtKANnoRV9AhbK0J-nrQO3YTMR3621Vlhw5P9SfUEVRtuzoQbGFfpb-Q/exec'
};

/* ─────────────────────────────────────────────
   STATE
───────────────────────────────────────────── */
let appState = {
  currentUser:       null,
  originalImageData: null,
  bgRemovedData:     null,
  activeBackground:  null,
  canvasCtx:         null,
  history:           [],
  uploadCount:       0,
  subscription:      { plan: 'free', expiry: null },
  audioCtx:          null,
  isOnline:          navigator.onLine,
  pendingPlan:       null   // holds plan user tapped Purchase on
};

/* ─────────────────────────────────────────────
   AUDIO ENGINE
───────────────────────────────────────────── */
function getAudioCtx() {
  if (!appState.audioCtx) {
    try { appState.audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch(e) { return null; }
  }
  return appState.audioCtx;
}

function playSound(type) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  const sounds = {
    click:    { freq: 440, type: 'sine',     dur: 0.08, vol: 0.15 },
    open:     { freq: 520, type: 'triangle', dur: 0.18, vol: 0.12 },
    close:    { freq: 380, type: 'triangle', dur: 0.14, vol: 0.10 },
    success:  { freq: 660, type: 'sine',     dur: 0.25, vol: 0.18 },
    error:    { freq: 180, type: 'sawtooth', dur: 0.35, vol: 0.20 },
    upload:   { freq: 580, type: 'sine',     dur: 0.20, vol: 0.15 },
    loader:   { freq: 320, type: 'sine',     dur: 0.50, vol: 0.08 },
    download: { freq: 740, type: 'sine',     dur: 0.22, vol: 0.16 }
  };
  const s = sounds[type] || sounds.click;
  osc.type = s.type;
  osc.frequency.setValueAtTime(s.freq, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(s.freq * 0.7, ctx.currentTime + s.dur);
  gain.gain.setValueAtTime(s.vol, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + s.dur);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + s.dur);
}

document.addEventListener('click', function(e) {
  const btn = e.target.closest('.sound-btn');
  if (btn) { playSound('click'); addRipple(btn, e); }
});

function addRipple(el, e) {
  const rect = el.getBoundingClientRect();
  const r    = document.createElement('span');
  r.className = 'ripple';
  const size = Math.max(rect.width, rect.height);
  r.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX-rect.left-size/2}px;top:${e.clientY-rect.top-size/2}px`;
  el.appendChild(r);
  setTimeout(() => r.remove(), 500);
}

/* ─────────────────────────────────────────────
   TOAST
───────────────────────────────────────────── */
function showToast(msg, type = '', duration = 3500) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className   = `toast show ${type}`;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.className = 'toast hidden', duration);
}

/* ─────────────────────────────────────────────
   INTERNET CHECK
───────────────────────────────────────────── */
function checkOnline() {
  const banner = document.getElementById('offlineBanner');
  if (!navigator.onLine) { banner.classList.remove('hidden'); playSound('error'); }
  else                   { banner.classList.add('hidden'); }
  appState.isOnline = navigator.onLine;
}
window.addEventListener('online',  checkOnline);
window.addEventListener('offline', checkOnline);
checkOnline();

/* ─────────────────────────────────────────────
   LOADER
───────────────────────────────────────────── */
window.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => playSound('loader'), 300);
  const bar = document.getElementById('loaderBar');
  let pct   = 0;
  const interval = setInterval(() => {
    pct += Math.random() * 18 + 5;
    if (pct >= 100) { pct = 100; clearInterval(interval); }
    bar.style.width = pct + '%';
  }, 100);
  setTimeout(() => {
    document.getElementById('loader').classList.add('fade-out');
    setTimeout(() => {
      document.getElementById('loader').style.display = 'none';
      initApp();
    }, 500);
  }, 2800);
});

/* ─────────────────────────────────────────────
   APP INIT
───────────────────────────────────────────── */
function initApp() {
  // Check localStorage for existing logged-in user
  const saved = localStorage.getItem('inatapass_user');
  if (saved) {
    try {
      const user = JSON.parse(saved);
      if (user && user.email && user.name) {
        // User found — auto-login, skip auth screen
        appState.currentUser = { name: user.name, email: user.email };
        loadUserState();
        // Fetch current time from internet (validate subscription expiry)
        fetchServerTime().finally(() => showApp());
        return;
      }
    } catch(e) {
      // Corrupted data — clear and show auth
      localStorage.removeItem('inatapass_user');
    }
  }
  // No saved user — show create account screen
  document.getElementById('authScreen').classList.remove('hidden');
}

async function fetchServerTime() {
  try {
    const res  = await fetch('https://worldtimeapi.org/api/timezone/Asia/Kolkata');
    const data = await res.json();
    appState.serverTime = new Date(data.datetime).getTime();
  } catch(e) {
    appState.serverTime = Date.now();
  }
}

function loadUserState() {
  const key  = `inatapass_state_${appState.currentUser.email}`;
  const data = localStorage.getItem(key);
  if (data) {
    const parsed         = JSON.parse(data);
    appState.uploadCount = parsed.uploadCount || 0;
    appState.subscription = parsed.subscription || { plan: 'free', expiry: null };
    appState.history     = parsed.history || [];
  }
  checkSubscriptionExpiry();
}

function saveUserState() {
  if (!appState.currentUser) return;
  const key = `inatapass_state_${appState.currentUser.email}`;
  localStorage.setItem(key, JSON.stringify({
    uploadCount:  appState.uploadCount,
    subscription: appState.subscription,
    history:      appState.history
  }));
}

function showApp() {
  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('accessCodeScreen').classList.add('hidden');
  document.getElementById('appScreen').classList.remove('hidden');
  updateNavUser();
  updateUploadBadge();
  updatePlanStatus();
  renderHistory();
  buildColorGrid();
  buildThemeGrid();
}

/* ─────────────────────────────────────────────
   AUTH  —  Register (with sheet email check)
───────────────────────────────────────────── */
async function handleRegister() {
  const name  = document.getElementById('regName').value.trim();
  const email = document.getElementById('regEmail').value.trim().toLowerCase();
  const errEl = document.getElementById('regError');
  const btn   = document.getElementById('registerBtn');
  errEl.textContent = '';

  if (!name || !email) { errEl.textContent = 'Name and email are required.'; playSound('error'); return; }
  if (!/\S+@\S+\.\S+/.test(email)) { errEl.textContent = 'Invalid email address.'; playSound('error'); return; }

  // 1️⃣  Check localStorage (instant)
  const users = JSON.parse(localStorage.getItem('inatapass_users') || '[]');
  if (users.find(u => u.email === email)) {
    errEl.textContent = '⚠️ Account already exists with this email.';
    playSound('error');
    return;
  }

  // 2️⃣  Check Google Sheet (server-side — must wait for response)
  btn.textContent = 'Checking availability…';
  btn.disabled    = true;
  errEl.textContent = '';

  let sheetCheckPassed = false;
  try {
    const checkRes = await callSheetCheck(email);
    if (checkRes && checkRes.exists) {
      errEl.textContent = '⚠️ This email is already registered. Please contact support.';
      playSound('error');
      btn.textContent = 'Create Account →';
      btn.disabled    = false;
      return;
    }
    sheetCheckPassed = true; // confirmed: email not in sheet
  } catch(e) {
    // Sheet unreachable — log it but proceed (local check already passed)
    console.warn('Sheet check failed, proceeding with local data:', e.message);
    sheetCheckPassed = true;
  }

  if (!sheetCheckPassed) return; // safety guard

  btn.textContent = 'Creating account…';

  // 3️⃣  Save to localStorage
  const user = { name, email, createdAt: new Date().toISOString() };
  users.push(user);
  localStorage.setItem('inatapass_users', JSON.stringify(users));
  localStorage.setItem('inatapass_user',  JSON.stringify({ name, email }));
  appState.currentUser = { name, email };
  loadUserState();

  // 4️⃣  Push to Sheet (blocking — wait so duplicate can't race through)
  try {
    btn.textContent = 'Saving to server…';
    await pushToGoogleSheets(user);
  } catch(e) { /* non-critical */ }

  // 5️⃣  Send emails (non-blocking)
  sendWelcomeEmails(name, email).catch(() => {});

  playSound('success');
  showToast('Account created! Welcome to InataPass', 'success');
  btn.textContent = 'Create Account →';
  btn.disabled    = false;
  showApp();
}

function handleLogout() {
  saveUserState();
  localStorage.removeItem('inatapass_user');
  appState.currentUser      = null;
  appState.originalImageData = null;
  appState.bgRemovedData    = null;
  document.getElementById('appScreen').classList.add('hidden');
  document.getElementById('authScreen').classList.remove('hidden');
  document.getElementById('regName').value     = '';
  document.getElementById('regEmail').value    = '';
  document.getElementById('regError').textContent = '';
  goBackToUpload();
  playSound('click');
}

/* ─────────────────────────────────────────────
   SHEET  helpers
───────────────────────────────────────────── */
// ── Sheet helpers ──
// Google Apps Script blocks CORS on POST with JSON headers.
// Workaround: send data as URL-encoded form POST (no preflight).
// For checkUser (needs a real response) we use GET with query params.

async function callSheetCheck(email) {
  // GET request — Apps Script doGet() handles this, no CORS issue
  const url = CONFIG.APPS_SCRIPT_URL + '?action=checkUser&email=' + encodeURIComponent(email);
  const res = await fetch(url);
  return res.json();
}

async function pushToGoogleSheets(user) {
  if (!CONFIG.APPS_SCRIPT_URL || CONFIG.APPS_SCRIPT_URL.includes('YOUR_SCRIPT_ID')) return;
  try {
    // Use no-cors form POST — browser allows this, Apps Script receives it fine
    const formData = new FormData();
    formData.append('payload', JSON.stringify({
      action:    'addUser',
      email:     user.email,
      name:      user.name,
      createdAt: user.createdAt
    }));
    await fetch(CONFIG.APPS_SCRIPT_URL, {
      method: 'POST',
      mode:   'no-cors',
      body:   formData
    });
  } catch(e) { console.warn('Sheets push failed:', e); }
}

/* ─────────────────────────────────────────────
   EMAIL SYSTEM (EmailJS)
───────────────────────────────────────────── */
async function sendWelcomeEmails(name, email) {
  try {
    if (!window.emailjs) await loadEmailJS();
    const timestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    if (window.emailjs && CONFIG.EMAILJS_PUBLIC_KEY !== 'YOUR_EMAILJS_PUBLIC_KEY') {
      emailjs.init(CONFIG.EMAILJS_PUBLIC_KEY);
      await emailjs.send(CONFIG.EMAILJS_SERVICE_ID, 'template_user_welcome', {
        to_email: email, to_name: name, subject: 'Welcome to InataPass 🎉'
      });
      await emailjs.send(CONFIG.EMAILJS_SERVICE_ID, 'template_admin_notify', {
        to_email:  CONFIG.DEV_EMAIL,
        user_email: email,
        user_name:  name,
        reg_time:   timestamp
      });
    }
  } catch(err) { console.warn('Email send failed:', err.message); }
}

function loadEmailJS() {
  return new Promise((res, rej) => {
    if (window.emailjs) { res(); return; }
    const s  = document.createElement('script');
    s.src    = 'https://cdn.jsdelivr.net/npm/@emailjs/browser@3/dist/email.min.js';
    s.onload = res;
    s.onerror = rej;
    document.head.appendChild(s);
  });
}

/* ─────────────────────────────────────────────
   UPLOAD  (no size limit)
───────────────────────────────────────────── */
function handleDragOver(e) {
  e.preventDefault();
  document.getElementById('uploadZone').style.borderColor = 'var(--accent)';
}
function handleDrop(e) {
  e.preventDefault();
  document.getElementById('uploadZone').style.borderColor = '';
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) processFile(file);
}
function handleFileSelect(e) {
  const file = e.target.files[0];
  if (file) processFile(file);
  e.target.value = '';
}

function canUpload() {
  const sub = appState.subscription;
  if (sub.plan !== 'free') return true;
  return appState.uploadCount < CONFIG.PLANS.free.uploads;
}

function processFile(file) {
  if (!canUpload()) {
    showToast('Upload limit reached. Please upgrade your plan! 💎', 'error');
    playSound('error');
    togglePanel('subPanel');
    return;
  }
  // ✅ No size limit check — any size accepted
  playSound('upload');
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img    = new Image();
    img.onload   = () => {
      appState.originalImageData = ev.target.result;
      appState.bgRemovedData     = null;
      appState.activeBackground  = null;
      appState.uploadCount++;
      saveUserState();
      updateUploadBadge();
      openEditor(img);
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

function openEditor(img) {
  document.getElementById('heroSection').classList.add('hidden');
  document.getElementById('editorSection').classList.remove('hidden');
  const canvas = document.getElementById('mainCanvas');
  const ctx    = canvas.getContext('2d');
  appState.canvasCtx = ctx;
  const maxW   = Math.min(img.naturalWidth, 1200);
  const ratio  = maxW / img.naturalWidth;
  canvas.width  = maxW;
  canvas.height = img.naturalHeight * ratio;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  resetSliders();
  showToast('Image loaded! Click "Remove Background" to start. ✦', 'info');
}

function goBackToUpload() {
  document.getElementById('editorSection').classList.add('hidden');
  document.getElementById('heroSection').classList.remove('hidden');
  appState.originalImageData = null;
  appState.bgRemovedData     = null;
  appState.activeBackground  = null;
  const canvas = document.getElementById('mainCanvas');
  const ctx    = canvas.getContext('2d');
  if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  resetSliders();
}

/* ─────────────────────────────────────────────
   BACKGROUND REMOVAL  (fixed btoa for large images)
───────────────────────────────────────────── */
async function removeBg() {
  if (!appState.isOnline) { showToast('No internet connection!', 'error'); playSound('error'); return; }
  if (!appState.originalImageData) { showToast('Upload an image first.', 'error'); return; }

  const loader = document.getElementById('canvasLoader');
  loader.classList.remove('hidden');
  playSound('open');

  try {
    const blob     = dataURLtoBlob(appState.originalImageData);
    const formData = new FormData();
    formData.append('image_file', blob, 'image.png');
    formData.append('size', 'auto');

    const res = await fetch('https://api.remove.bg/v1.0/removebg', {
      method:  'POST',
      headers: { 'X-Api-Key': CONFIG.REMOVE_BG_API },
      body:    formData
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.errors?.[0]?.title || `API Error ${res.status}`);
    }

    // ✅ Fixed: use Blob URL instead of btoa (avoids call stack overflow on large images)
    const resultBlob = await res.blob();
    const objectUrl  = URL.createObjectURL(resultBlob);

    const img     = new Image();
    img.onload    = () => {
      const canvas = document.getElementById('mainCanvas');
      const ctx    = canvas.getContext('2d');
      canvas.width  = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (appState.activeBackground) applyBgToCanvas(ctx, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);

      // Also store as data URL for saving/history
      appState.bgRemovedData = canvas.toDataURL('image/png');
      URL.revokeObjectURL(objectUrl);

      playSound('success');
      showToast('Background removed successfully! ✦', 'success');
      loader.classList.add('hidden');
    };
    img.onerror   = () => {
      loader.classList.add('hidden');
      showToast('Failed to load result image.', 'error');
      URL.revokeObjectURL(objectUrl);
    };
    img.src = objectUrl;

  } catch(err) {
    loader.classList.add('hidden');
    playSound('error');
    showToast('BG removal failed: ' + err.message, 'error');
    console.error(err);
  }
}

/* ─────────────────────────────────────────────
   BACKGROUNDS  —  Colors
───────────────────────────────────────────── */
const COLORS = [
  '#ffffff','#f0f0f0','#000000','#1a1a2e','#16213e','#0f3460',
  '#e94560','#ff6b6b','#ffa07a','#ffd700','#adff2f','#00fa9a',
  '#00bfff','#1e90ff','#9370db','#da70d6','#ff69b4','#dc143c',
  '#ff8c00','#32cd32','#00ced1','#4169e1','#8b008b','#a0522d',
  '#808080','#c0c0c0','#b8860b','#006400','#00008b','#8b0000',
  '#2e4057','#048a81','#54c6eb','#ef946c','#c4a35a','#3d5a80'
];

/* ─────────────────────────────────────────────
   BACKGROUND SCENES  —  Real photo URLs (Unsplash)
───────────────────────────────────────────── */
const SCENES = [
  { name: 'Beach',      url: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800&q=80' },
  { name: 'Office',     url: 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=800&q=80' },
  { name: 'School',     url: 'https://images.unsplash.com/photo-1580582932707-520aed937b7b?w=800&q=80' },
  { name: 'Mountain',   url: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&q=80' },
  { name: 'Forest',     url: 'https://images.unsplash.com/photo-1448375240586-882707db888b?w=800&q=80' },
  { name: 'City Night', url: 'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=800&q=80' },
  { name: 'Studio',     url: 'https://images.unsplash.com/photo-1519924028-a79ca29b8445?w=800&q=80' },
  { name: 'Library',    url: 'https://images.unsplash.com/photo-1507842217343-583bb7270b66?w=800&q=80' },
  { name: 'Cafe',       url: 'https://images.unsplash.com/photo-1442512595331-e89e73853f31?w=800&q=80' },
  { name: 'Desert',     url: 'https://images.unsplash.com/photo-1509316785289-025f5b846b35?w=800&q=80' },
  { name: 'Snowfield',  url: 'https://images.unsplash.com/photo-1478719059408-592965723cbc?w=800&q=80' },
  { name: 'Garden',     url: 'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=800&q=80' },
  { name: 'Gym',        url: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=800&q=80' },
  { name: 'Kitchen',    url: 'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=800&q=80' },
  { name: 'Sunset Sky', url: 'https://images.unsplash.com/photo-1495616811223-4d98c6e9c869?w=800&q=80' },
  { name: 'Stage',      url: 'https://images.unsplash.com/photo-1501281668745-f7f57925c3b4?w=800&q=80' },
  { name: 'Space',      url: 'https://images.unsplash.com/photo-1419242902214-272b3f66ee7a?w=800&q=80' },
  { name: 'Waterfall',  url: 'https://images.unsplash.com/photo-1434394354979-a235cd36269d?w=800&q=80' }
];

function buildColorGrid() {
  const grid = document.getElementById('colorGrid');
  grid.innerHTML = '';
  COLORS.forEach(c => {
    const sw       = document.createElement('div');
    sw.className   = 'color-swatch sound-btn';
    sw.style.background = c;
    sw.title       = c;
    sw.onclick     = () => { setBackground({ type: 'color', value: c }); setActiveClass(grid, sw); };
    grid.appendChild(sw);
  });
}

function buildThemeGrid() {
  const grid = document.getElementById('themeGrid');
  grid.innerHTML = '';
  SCENES.forEach(scene => {
    const sw     = document.createElement('div');
    sw.className = 'theme-swatch sound-btn';
    sw.style.backgroundImage = `url('${scene.url}')`;
    sw.style.backgroundSize  = 'cover';
    sw.style.backgroundPosition = 'center';
    sw.innerHTML = `<div class="theme-label">${scene.name}</div>`;
    sw.onclick   = () => {
      setBackground({ type: 'image', value: scene.url });
      setActiveClass(grid, sw);
    };
    grid.appendChild(sw);
  });
}

function setActiveClass(parent, el) {
  parent.querySelectorAll('.active').forEach(x => x.classList.remove('active'));
  el.classList.add('active');
}

function setBackground(bg) {
  appState.activeBackground = bg;
  redrawCanvas();
  playSound('click');
}

function applyBgToCanvas(ctx, w, h) {
  const bg = appState.activeBackground;
  if (!bg) return;

  if (bg.type === 'color') {
    ctx.fillStyle = bg.value;
    ctx.fillRect(0, 0, w, h);

  } else if (bg.type === 'image') {
    // Draw cached image if available; load otherwise
    if (bg._img && bg._img.complete) {
      ctx.drawImage(bg._img, 0, 0, w, h);
    } else if (!bg._loading) {
      bg._loading  = true;
      const img    = new Image();
      img.crossOrigin = 'anonymous';
      img.onload   = () => { bg._img = img; bg._loading = false; redrawCanvas(); };
      img.onerror  = () => { bg._loading = false; };
      img.src      = bg.value;
    }
  }
}

function redrawCanvas() {
  if (!appState.bgRemovedData && !appState.originalImageData) return;
  const canvas = document.getElementById('mainCanvas');
  const ctx    = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (appState.activeBackground) applyBgToCanvas(ctx, canvas.width, canvas.height);

  const src = appState.bgRemovedData || appState.originalImageData;
  const img = new Image();
  img.onload = () => { ctx.drawImage(img, 0, 0, canvas.width, canvas.height); applyFilters(); };
  img.src    = src;
}

/* ─────────────────────────────────────────────
   IMAGE FILTERS
───────────────────────────────────────────── */
function applyFilters() {
  const b  = document.getElementById('brightnessSlider').value;
  const c  = document.getElementById('contrastSlider').value;
  const s  = document.getElementById('saturationSlider').value;
  const sh = document.getElementById('sharpnessSlider').value;
  const bl = document.getElementById('blurSlider').value;
  document.getElementById('brightnessVal').textContent = b;
  document.getElementById('contrastVal').textContent   = c;
  document.getElementById('saturationVal').textContent = s;
  document.getElementById('sharpnessVal').textContent  = sh;
  document.getElementById('blurVal').textContent       = bl;
  const canvas = document.getElementById('mainCanvas');
  canvas.style.filter = `brightness(${b}%) contrast(${c}%) saturate(${s}%) blur(${bl}px)`;
}

function resetFilters() {
  ['brightness','contrast','saturation'].forEach(n => {
    document.getElementById(n+'Slider').value      = 100;
    document.getElementById(n+'Val').textContent   = '100';
  });
  document.getElementById('sharpnessSlider').value  = 0;
  document.getElementById('sharpnessVal').textContent = '0';
  document.getElementById('blurSlider').value       = 0;
  document.getElementById('blurVal').textContent    = '0';
  document.getElementById('mainCanvas').style.filter = '';
  playSound('click');
}

function resetSliders() { resetFilters(); }

/* ─────────────────────────────────────────────
   DOWNLOAD / SHARE / HISTORY
───────────────────────────────────────────── */
function downloadImage() {
  const canvas = document.getElementById('mainCanvas');
  if (!canvas.width) { showToast('No image to download.', 'error'); return; }
  const off   = document.createElement('canvas');
  off.width   = canvas.width;
  off.height  = canvas.height;
  const octx  = off.getContext('2d');
  octx.filter = canvas.style.filter || 'none';
  octx.drawImage(canvas, 0, 0);
  const link       = document.createElement('a');
  link.download    = `inatapass_${Date.now()}.png`;
  link.href        = off.toDataURL('image/png', 1.0);
  link.click();
  playSound('download');
  showToast('Downloaded in full quality! ⬇', 'success');
}

async function shareImage() {
  const canvas = document.getElementById('mainCanvas');
  if (!canvas.width) { showToast('No image to share.', 'error'); return; }
  try {
    const blob = await new Promise(res => canvas.toBlob(res, 'image/png', 1.0));
    const file = new File([blob], 'inatapass.png', { type: 'image/png' });
    if (navigator.share && navigator.canShare({ files: [file] })) {
      await navigator.share({ title: 'InataPass Edit', files: [file] });
      playSound('success');
    } else { downloadImage(); }
  } catch(e) { showToast('Share cancelled.', ''); }
}

function saveToHistory() {
  const canvas = document.getElementById('mainCanvas');
  if (!canvas.width) { showToast('No image to save.', 'error'); return; }
  const thumb  = canvas.toDataURL('image/jpeg', 0.4);
  const full   = canvas.toDataURL('image/png', 1.0);
  const entry  = {
    id:    Date.now(),
    thumb, full,
    date:  new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
  };
  appState.history.unshift(entry);
  if (appState.history.length > 30) appState.history.pop();
  saveUserState();
  renderHistory();
  playSound('success');
  showToast('Saved to history! 💾', 'success');
}

function renderHistory() {
  const list = document.getElementById('historyList');
  if (!appState.history.length) {
    list.innerHTML = '<p class="empty-state">No saved edits yet. Save an edit to see it here.</p>';
    return;
  }
  list.innerHTML = appState.history.map(h => `
    <div class="history-item">
      <img class="history-thumb" src="${h.thumb}" alt="edit" />
      <div class="history-info">
        <h4>Edit #${h.id}</h4>
        <p>${h.date}</p>
      </div>
      <button class="history-dl sound-btn" onclick="downloadFromHistory(${h.id})">⬇</button>
    </div>
  `).join('');
}

function downloadFromHistory(id) {
  const item = appState.history.find(h => h.id == id);
  if (!item) return;
  const a    = document.createElement('a');
  a.href     = item.full;
  a.download = `inatapass_${id}.png`;
  a.click();
  playSound('download');
}

/* ─────────────────────────────────────────────
   SUBSCRIPTION
───────────────────────────────────────────── */
function checkSubscriptionExpiry() {
  const sub = appState.subscription;
  if (!sub.expiry || sub.plan === 'free') return;
  fetch('https://worldtimeapi.org/api/timezone/Asia/Kolkata')
    .then(r => r.json())
    .then(data => {
      const serverTime = new Date(data.datetime).getTime();
      if (serverTime > new Date(sub.expiry).getTime()) {
        appState.subscription = { plan: 'free', expiry: null };
        appState.uploadCount  = 0;
        saveUserState();
        updateUploadBadge();
        updatePlanStatus();
        showToast('Your subscription has expired. Please renew.', 'error');
        playSound('error');
      }
    })
    .catch(() => {
      if (Date.now() > new Date(sub.expiry).getTime()) {
        appState.subscription = { plan: 'free', expiry: null };
        saveUserState();
      }
    });
}

function updatePlanStatus() {
  const el  = document.getElementById('planStatus');
  if (!el) return;
  const sub = appState.subscription;
  if (sub.plan === 'free') {
    el.innerHTML = `<strong>Current Plan:</strong> Free · ${CONFIG.PLANS.free.uploads - appState.uploadCount} uploads remaining`;
  } else {
    const days = Math.max(0, Math.ceil((new Date(sub.expiry) - Date.now()) / 86400000));
    el.innerHTML = `<strong>Current Plan:</strong> ${sub.plan.charAt(0).toUpperCase()+sub.plan.slice(1)} · ${days} days remaining`;
  }
}

function updateNavUser() {
  const el = document.getElementById('navUser');
  if (el && appState.currentUser) el.textContent = appState.currentUser.name.split(' ')[0];
}

function updateUploadBadge() {
  const el  = document.getElementById('uploadLimitBadge');
  if (!el) return;
  const sub = appState.subscription;
  if (sub.plan === 'free') {
    el.textContent = `${appState.uploadCount}/${CONFIG.PLANS.free.uploads} free uploads used`;
  } else {
    el.textContent = `✦ ${sub.plan.charAt(0).toUpperCase()+sub.plan.slice(1)} – Unlimited uploads`;
  }
}

/* ─────────────────────────────────────────────
   PURCHASE FLOW
   1. Open device payment app with prefilled amount
   2. Show access code screen with plan details
───────────────────────────────────────────── */
function openPurchase(plan) {
  const prices = { monthly: 199, premium: 550 };
  const price  = prices[plan];

  // Store pending plan
  appState.pendingPlan = plan;

  // Open device payment app (UPI deep link — works on Android/iOS with UPI apps)
  const upiLink = `upi://pay?pa=munazzashaikh531@upi&pn=InataPass&am=${price}&cu=INR&tn=InataPass+${plan}+plan`;
  window.open(upiLink, '_blank');

  // After a short delay, show access code screen
  setTimeout(() => showAccessCodeScreen(plan), 800);
  playSound('click');
}

function showAccessCodeScreen(plan) {
  const prices    = { monthly: 199, premium: 550 };
  const durations = { monthly: '31 days', premium: '95 days' };
  const price     = prices[plan];
  const duration  = durations[plan];
  const planLabel = plan.charAt(0).toUpperCase() + plan.slice(1);

  // Fill plan info
  document.getElementById('accessPlanInfo').innerHTML = `
    <div class="access-plan-card">
      <div class="apc-name">${planLabel} Plan</div>
      <div class="apc-price">₹${price}</div>
      <div class="apc-dur">Valid for ${duration}</div>
      <ul class="apc-features">
        <li>✓ Unlimited uploads</li>
        <li>✓ All editing tools</li>
        <li>✓ All background scenes</li>
        <li>✓ Priority support</li>
      </ul>
    </div>
  `;

  // Clear previous input & note
  document.getElementById('accessCodeInput').value = '';
  document.getElementById('accessNote').textContent = '';

  // Hide app & sub panel, show access code screen
  document.getElementById('subPanel').classList.remove('open');
  document.getElementById('panelOverlay').classList.add('hidden');
  document.getElementById('accessCodeScreen').classList.remove('hidden');
  playSound('open');
}

function closeAccessCodeScreen() {
  document.getElementById('accessCodeScreen').classList.add('hidden');
  playSound('close');
}

function verifyAccessCode() {
  const code = document.getElementById('accessCodeInput').value.trim();
  const note = document.getElementById('accessNote');
  const plan = appState.pendingPlan || 'monthly';

  if (code !== CONFIG.ACTIVATION_CODE) {
    note.className   = 'access-note error';
    note.textContent = '✗ Invalid access code. Contact admin for your code.';
    playSound('error');
    return;
  }

  // Activate plan
  const days   = CONFIG.PLANS[plan].days;
  const expiry = new Date(Date.now() + days * 86400000).toISOString();
  appState.subscription = { plan, expiry };
  appState.uploadCount  = 0;
  saveUserState();
  updateUploadBadge();
  updatePlanStatus();

  note.className   = 'access-note success';
  note.textContent = `✓ ${plan.charAt(0).toUpperCase()+plan.slice(1)} plan activated! Valid for ${days} days.`;
  playSound('success');
  showToast('Plan activated! Enjoy unlimited access. 🎉', 'success');

  setTimeout(() => {
    closeAccessCodeScreen();
    appState.pendingPlan = null;
  }, 1800);
}

/* ─────────────────────────────────────────────
   PANELS
───────────────────────────────────────────── */
let activePanel = null;

function togglePanel(id) {
  const panel   = document.getElementById(id);
  const overlay = document.getElementById('panelOverlay');
  if (panel.classList.contains('open')) {
    panel.classList.remove('open');
    overlay.classList.add('hidden');
    playSound('close');
    activePanel = null;
  } else {
    if (activePanel) document.getElementById(activePanel).classList.remove('open');
    panel.classList.add('open');
    overlay.classList.remove('hidden');
    playSound('open');
    activePanel = id;
    if (id === 'subPanel')     updatePlanStatus();
    if (id === 'historyPanel') renderHistory();
  }
}

function closeAllPanels() {
  document.querySelectorAll('.slide-panel').forEach(p => p.classList.remove('open'));
  document.getElementById('panelOverlay').classList.add('hidden');
  if (activePanel) playSound('close');
  activePanel = null;
}

/* ─────────────────────────────────────────────
   UTILS
───────────────────────────────────────────── */
function dataURLtoBlob(dataURL) {
  const parts = dataURL.split(',');
  const mime  = parts[0].match(/:(.*?);/)[1];
  const raw   = atob(parts[1]);
  const arr   = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
