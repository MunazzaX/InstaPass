/* ═══════════════════════════════════════════════
   INSTAPASS – main.js  v2.0
   Firebase Auth · Razorpay · Light Theme
   Time Security · Watermark · Advanced Editor
═══════════════════════════════════════════════ */
'use strict';

/* ─────────────────────────────────────────────
   CONFIG
───────────────────────────────────────────── */
const CONFIG = {
  PLANS: {
    free:       { requests: 3,   days: 0,   price: 0   },
    lite_1m:    { requests: 20,  days: 30,  price: 59  },
    lite_3m:    { requests: 60,  days: 90,  price: 169 },
    lite_6m:    { requests: 120, days: 180, price: 349 },
    lite_12m:   { requests: 240, days: 365, price: 699 },
    pro:        { requests: 40,  days: 30,  price: 119 },
    superpro:   { requests: 50,  days: 30,  price: 189 }
  },
  RAZORPAY_KEY: 'rzp_live_T177UduR2hzsZz',
  TIME_THRESHOLD_MINUTES: 5
};

/* ─────────────────────────────────────────────
   STATE
───────────────────────────────────────────── */
let appState = {
  originalImageData: null,
  bgRemovedData:     null,
  activeBackground:  null,
  history:           [],
  uploadCount:       0,
  subscription:      { plan: 'free', expiry: null, remainingRequests: 3 },
  audioCtx:          null,
  isOnline:          navigator.onLine,
  firebaseUser:      null,
  userDbData:        null,
  activeFilter:      null,
  selectedLitePlan:  'lite_1m',
  timeChecked:       false
};

/* ─────────────────────────────────────────────
   FIREBASE AUTH BRIDGE
───────────────────────────────────────────── */
window.onFirebaseAuthReady = async function(user) {
  if (user) {
    appState.firebaseUser = user;
    // Reload user doc
    if (window._fbGetDoc) {
      try {
        const snap = await window._fbGetDoc(user.uid);
        if (snap.exists()) {
          appState.userDbData = snap.data();
          syncUserDataFromFirebase();
        }
      } catch(e) { console.warn('Firestore read error:', e); }
    }
    hideLauncherIfReady();
  } else {
    hideLauncherIfReady();
  }
};

let loaderDone = false;

function hideLauncherIfReady() {
  if (!loaderDone) return;
  const user = appState.firebaseUser;
  document.getElementById('loader').style.display = 'none';
  if (user) {
    showApp();
  } else {
    document.getElementById('authScreen').classList.remove('hidden');
  }
}

function syncUserDataFromFirebase() {
  const d = appState.userDbData;
  if (!d) return;
  const planKey = d.plan || 'free';
  appState.subscription = {
    plan: planKey,
    expiry: d.expiryDate || null,
    remainingRequests: d.remainingRequests != null ? d.remainingRequests : CONFIG.PLANS[planKey]?.requests || 3
  };
}

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
    click:    { freq: 440, type: 'sine',     dur: 0.08, vol: 0.08 },
    open:     { freq: 520, type: 'triangle', dur: 0.15, vol: 0.07 },
    close:    { freq: 380, type: 'triangle', dur: 0.12, vol: 0.06 },
    success:  { freq: 660, type: 'sine',     dur: 0.22, vol: 0.1  },
    error:    { freq: 200, type: 'sawtooth', dur: 0.3,  vol: 0.12 },
    upload:   { freq: 580, type: 'sine',     dur: 0.18, vol: 0.08 },
    loader:   { freq: 340, type: 'sine',     dur: 0.4,  vol: 0.05 },
    download: { freq: 720, type: 'sine',     dur: 0.2,  vol: 0.09 }
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
  const size  = Math.max(rect.width, rect.height);
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
   ONLINE / OFFLINE
───────────────────────────────────────────── */
function checkOnline() {
  const banner = document.getElementById('offlineBanner');
  const online = navigator.onLine;
  if (!online) { banner.classList.remove('hidden'); playSound('error'); }
  else         { banner.classList.add('hidden'); }
  appState.isOnline = online;
}
window.addEventListener('online',  checkOnline);
window.addEventListener('offline', checkOnline);
checkOnline();

/* ─────────────────────────────────────────────
   TIME SECURITY — Firebase Server Time
   No third-party API. Uses Firebase Cloud Function.
───────────────────────────────────────────── */
async function checkInternetTime() {
  const banner = document.getElementById('timeWarningBanner');
  try {
    // Call Firebase Cloud Function for trusted server time
    const res  = await fetch('https://us-central1-instapass-web-fe974.cloudfunctions.net/getServerTime');
    if (!res.ok) throw new Error('Server time fetch failed');
    const data = await res.json();
    const serverTime = data.serverTime; // Date.now() from server
    const deviceTime = Date.now();
    const diffMins   = Math.abs(serverTime - deviceTime) / 60000;
    if (diffMins > CONFIG.TIME_THRESHOLD_MINUTES) {
      banner.classList.add('hidden');
      appState.timeBlocked = true;
    } else {
      banner.classList.add('hidden');
      appState.timeBlocked = false;
    }
    appState.serverTime = serverTime;
  } catch(e) {
    // If Firebase server time is unavailable: show warning, allow app to continue
    console.warn('Server time check unavailable:', e);
    banner.classList.add('hidden');
    appState.serverTime  = Date.now();
    appState.timeBlocked = false; // Do NOT block login if server time cannot be fetched
  }
  appState.timeChecked = true;
}

/* ─────────────────────────────────────────────
   LOADER
───────────────────────────────────────────── */
window.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => playSound('loader'), 400);
  const bar = document.getElementById('loaderBar');
  let pct   = 0;
  const interval = setInterval(() => {
    pct += Math.random() * 15 + 4;
    if (pct >= 100) { pct = 100; clearInterval(interval); }
    bar.style.width = pct + '%';
  }, 100);

  // Run time check in background
  checkInternetTime();

  setTimeout(() => {
    loaderDone = true;
    hideLauncherIfReady();
  }, 2600);

  // Setup Lite plan option selectors
  setTimeout(setupLitePlanSelectors, 100);
  // Setup paste upload
  setupPasteUpload();
});

/* ─────────────────────────────────────────────
   AUTH TABS
───────────────────────────────────────────── */
function switchAuthTab(tab) {
  document.getElementById('loginForm').classList.remove('active');
  document.getElementById('registerForm').classList.remove('active');
  document.getElementById('tabLogin').classList.remove('active');
  document.getElementById('tabRegister').classList.remove('active');
  if (tab === 'login') {
    document.getElementById('loginForm').classList.add('active');
    document.getElementById('tabLogin').classList.add('active');
  } else {
    document.getElementById('registerForm').classList.add('active');
    document.getElementById('tabRegister').classList.add('active');
  }
}

function togglePw(inputId, btn) {
  const inp = document.getElementById(inputId);
  inp.type  = inp.type === 'password' ? 'text' : 'password';
}

/* ─────────────────────────────────────────────
   AUTH – LOGIN
───────────────────────────────────────────── */
async function handleLogin() {
  const email = document.getElementById('loginEmail').value.trim().toLowerCase();
  const pw    = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginError');
  const btn   = document.getElementById('loginBtn');
  errEl.textContent = '';
  if (!email || !pw) { errEl.textContent = 'Email and password are required.'; playSound('error'); return; }
  btn.textContent = 'Signing in…';
  btn.disabled    = true;
  try {
    if (!window._fbSignIn) throw new Error('Firebase not ready. Please refresh.');
    await window._fbSignIn(email, pw);
    playSound('success');
    showToast('Welcome back!', 'success');
  } catch(e) {
    errEl.textContent = getFriendlyError(e.code || e.message);
    playSound('error');
  }
  btn.textContent = 'Sign In';
  btn.disabled    = false;
}

/* ─────────────────────────────────────────────
   AUTH – REGISTER
───────────────────────────────────────────── */
async function handleRegister() {
  const name  = document.getElementById('regName').value.trim();
  const email = document.getElementById('regEmail').value.trim().toLowerCase();
  const pw    = document.getElementById('regPassword').value;
  const errEl = document.getElementById('regError');
  const btn   = document.getElementById('registerBtn');
  errEl.textContent = '';
  if (!name)  { errEl.textContent = 'Full name is required.'; playSound('error'); return; }
  if (!email) { errEl.textContent = 'Email is required.'; playSound('error'); return; }
  if (!/\S+@\S+\.\S+/.test(email)) { errEl.textContent = 'Invalid email address.'; playSound('error'); return; }
  if (pw.length < 6) { errEl.textContent = 'Password must be at least 6 characters.'; playSound('error'); return; }
  btn.textContent = 'Creating account…';
  btn.disabled    = true;
  try {
    if (!window._fbRegister) throw new Error('Firebase not ready. Please refresh.');
    const cred = await window._fbRegister(email, pw);
    // Write user doc to Firestore (onAuthStateChanged handles initial doc creation)
    playSound('success');
    showToast('Account created! Welcome to InstaPass', 'success');
  } catch(e) {
    errEl.textContent = getFriendlyError(e.code || e.message);
    playSound('error');
  }
  btn.textContent = 'Create Account';
  btn.disabled    = false;
}

/* ─────────────────────────────────────────────
   AUTH – GOOGLE
───────────────────────────────────────────── */
async function handleGoogleSignIn() {
  try {
    if (!window._fbGoogleSignIn) { showToast('Firebase not ready. Please refresh.', 'error'); return; }
    await window._fbGoogleSignIn();
    playSound('success');
    showToast('Signed in with Google!', 'success');
  } catch(e) {
    if (e.code !== 'auth/popup-closed-by-user') {
      showToast(getFriendlyError(e.code), 'error');
    }
    playSound('error');
  }
}

function getFriendlyError(code) {
  const map = {
    'auth/invalid-credential':         'Incorrect email or password.',
    'auth/user-not-found':             'No account found with this email.',
    'auth/wrong-password':             'Incorrect password.',
    'auth/email-already-in-use':       'An account with this email already exists.',
    'auth/weak-password':              'Password must be at least 6 characters.',
    'auth/invalid-email':              'Invalid email address.',
    'auth/too-many-requests':          'Too many attempts. Please try again later.',
    'auth/network-request-failed':     'Network error. Check your internet connection.',
    'auth/popup-blocked':              'Popup blocked. Please allow popups and try again.'
  };
  return map[code] || 'Something went wrong. Please try again.';
}

/* ─────────────────────────────────────────────
   LOGOUT
───────────────────────────────────────────── */
async function handleLogout() {
  try {
    if (window._fbSignOut) await window._fbSignOut();
  } catch(e) {}
  appState.firebaseUser = null;
  appState.userDbData   = null;
  appState.originalImageData = null;
  appState.bgRemovedData     = null;
  appState.activeBackground  = null;
  document.getElementById('appScreen').classList.add('hidden');
  document.getElementById('authScreen').classList.remove('hidden');
  document.getElementById('loginEmail').value    = '';
  document.getElementById('loginPassword').value = '';
  document.getElementById('regName').value       = '';
  document.getElementById('regEmail').value      = '';
  document.getElementById('regPassword').value   = '';
  switchAuthTab('login');
  goBackToUpload();
  playSound('click');
}

/* ─────────────────────────────────────────────
   SHOW APP
───────────────────────────────────────────── */
function showApp() {
  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('appScreen').classList.remove('hidden');
  updateNavUser();
  updateUploadBadge();
  updatePlanStatus();
  renderHistory();
  buildColorGrid();
  buildFilterGrid();
}

function updateNavUser() {
  const el   = document.getElementById('navUser');
  const user = appState.firebaseUser;
  if (!el) return;
  if (user) {
    const name = user.displayName || user.email || '';
    el.textContent = name.split(/[@\s]/)[0];
  }
}

function updateUploadBadge() {
  const el  = document.getElementById('uploadLimitBadge');
  if (!el) return;
  const sub = appState.subscription;
  if (sub.plan === 'free') {
    el.textContent = `${sub.remainingRequests} of ${CONFIG.PLANS.free.requests} free requests remaining`;
  } else {
    const planCfg = CONFIG.PLANS[sub.plan] || {};
    el.textContent = `${sub.plan.toUpperCase()} — ${sub.remainingRequests} requests left`;
  }
}

function updatePlanStatus() {
  const el  = document.getElementById('planStatus');
  if (!el) return;
  const sub = appState.subscription;
  if (sub.plan === 'free') {
    el.innerHTML = `<strong>Current Plan:</strong> Free &mdash; ${sub.remainingRequests} of ${CONFIG.PLANS.free.requests} requests remaining`;
  } else {
    const planCfg = CONFIG.PLANS[sub.plan] || {};
    const days    = sub.expiry ? Math.max(0, Math.ceil((new Date(sub.expiry) - Date.now()) / 86400000)) : 0;
    el.innerHTML  = `<strong>Current Plan:</strong> ${sub.plan.toUpperCase()} &mdash; ${sub.remainingRequests} requests left &mdash; ${days} days remaining`;
  }
}

/* ─────────────────────────────────────────────
   LITE PLAN SELECTOR
───────────────────────────────────────────── */
function setupLitePlanSelectors() {
  const opts = document.querySelectorAll('.plan-price-option');
  opts.forEach(opt => {
    opt.addEventListener('click', () => {
      opts.forEach(o => o.classList.remove('active-option'));
      opt.classList.add('active-option');
      appState.selectedLitePlan = opt.dataset.plan;
      const btn = document.getElementById('litePurchaseBtn');
      if (btn) btn.textContent = `Purchase Lite – ₹${opt.dataset.price}`;
    });
  });
}

/* ─────────────────────────────────────────────
   RAZORPAY PAYMENT
───────────────────────────────────────────── */
// Plan display name helper
function getPlanDisplayName(planKey) {
  const names = {
    free:      'Free',
    lite_1m:   'Lite (1 Month)',
    lite_3m:   'Lite (3 Months)',
    lite_6m:   'Lite (6 Months)',
    lite_12m:  'Lite (12 Months)',
    pro:       'Pro',
    superpro:  'Super Pro'
  };
  return names[planKey] || planKey.toUpperCase();
}

function openRazorpay(planType) {
  if (!appState.firebaseUser) { showToast('Please sign in first.', 'error'); return; }

  // ── Active subscription guard ────────────────────────────────────────────────
  const currentPlan   = appState.subscription?.plan || 'free';
  const expiryDate    = appState.subscription?.expiry;
  const isActivePaid  = currentPlan !== 'free' &&
                        expiryDate &&
                        new Date(expiryDate) > new Date();

  if (isActivePaid) {
    const planName    = getPlanDisplayName(currentPlan);
    const expiryStr   = new Date(expiryDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    showToast(
      `⚠️ "${planName}" is already active until ${expiryStr}. You can't purchase a new plan while your current subscription is active.`,
      'error',
      5000
    );
    playSound('error');
    return;
  }
  // ─────────────────────────────────────────────────────────────────────────────

  let planKey, price, planName, requests;
  if (planType === 'lite') {
    planKey  = appState.selectedLitePlan || 'lite_1m';
    const opt = document.querySelector('.plan-price-option.active-option');
    price    = opt ? parseInt(opt.dataset.price) : 59;
    requests = opt ? parseInt(opt.dataset.requests) : 20;
    planName = `InstaPass Lite — ${opt ? opt.dataset.label : '1 Month'}`;
  } else if (planType === 'pro') {
    planKey  = 'pro'; price = 119; requests = 40; planName = 'InstaPass Pro';
  } else {
    planKey  = 'superpro'; price = 189; requests = 50; planName = 'InstaPass Super Pro';
  }

  if (!window.Razorpay) {
    // Razorpay not loaded (test env) — show fallback
    showToast('Payment gateway loading… Please try again.', 'info');
    return;
  }

  const options = {
    key:         CONFIG.RAZORPAY_KEY,
    amount:      price * 100,
    currency:    'INR',
    name:        'InstaPass',
    description: planName,
    image:       'instapass.png',
    prefill: {
      email: appState.firebaseUser.email,
      name:  appState.firebaseUser.displayName || ''
    },
    theme: { color: '#2563eb' },
    handler: async function(response) {
      await handlePaymentSuccess(response, planKey, price, requests);
    },
    modal: {
      ondismiss: function() {
        showToast('Payment cancelled.', '');
      }
    }
  };

  const rzp = new window.Razorpay(options);
  rzp.open();
}

async function handlePaymentSuccess(response, planKey, price, requests) {
  // ─── TEST MODE ───────────────────────────────────────────────────────────────
  // Cloud Function (verifyPayment) abhi deploy nahi hai, isliye
  // testing ke liye directly Firestore update kar rahe hain.
  // ⚠️ Production mein jaane se pehle yahan Cloud Function wala code wapas laana.
  // ─────────────────────────────────────────────────────────────────────────────
  const uid = appState.firebaseUser?.uid;
  if (!uid) { showToast('Not logged in.', 'error'); return; }

  try {
    const planCfg    = CONFIG.PLANS[planKey];
    const now        = new Date();
    const expiryDate = planCfg.days > 0
      ? new Date(Date.now() + planCfg.days * 86400000).toISOString()
      : null;

    // Get current totalRequestsUsed to increment
    const currentUsed = appState.userDbData?.totalRequestsUsed || 0;

    // Firestore mein plan directly update karo (test mode)
    if (window._fbUpdateDoc) {
      await window._fbUpdateDoc(uid, {
        plan:               planKey,
        remainingRequests:  requests,
        expiryDate:         expiryDate,
        purchaseDate:       now.toISOString(),
        lastPaymentId:      response.razorpay_payment_id || 'test_' + Date.now(),
        lastPaymentDate:    now.toISOString(),
        subscriptionStatus: 'active',
        totalRequestsUsed:  currentUsed + 1
      });
    }

    // Local state update
    appState.subscription = {
      plan:              planKey,
      expiry:            expiryDate,
      remainingRequests: requests
    };
    if (appState.userDbData) {
      appState.userDbData.plan               = planKey;
      appState.userDbData.remainingRequests  = requests;
      appState.userDbData.expiryDate         = expiryDate;
      appState.userDbData.purchaseDate       = now.toISOString();
      appState.userDbData.totalRequestsUsed  = currentUsed + 1;
      appState.userDbData.subscriptionStatus = 'active';
    }

    updateUploadBadge();
    updatePlanStatus();
    togglePanel('subPanel');
    playSound('success');
    showToast(`${planKey.toUpperCase()} plan activated! Enjoy.`, 'success');
  } catch(e) {
    showToast('Plan activation failed: ' + e.message, 'error');
    console.error(e);
  }
}

/* ─────────────────────────────────────────────
   UPLOAD SYSTEM
   File · Drag/Drop · Paste · Editor Replace
───────────────────────────────────────────── */
function handleDragOver(e) {
  e.preventDefault();
  e.stopPropagation();
  document.getElementById('uploadZone').classList.add('drag-over');
}
function handleDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  document.getElementById('uploadZone').classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) processFile(file);
}
function handleFileSelect(e) {
  const file = e.target.files[0];
  if (file) processFile(file);
  e.target.value = '';
}
// Drag onto editor canvas — replace image
function handleEditorDragOver(e) {
  e.preventDefault();
  e.stopPropagation();
  document.getElementById('canvasWrap').style.borderColor = 'var(--accent2)';
}
function handleEditorDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  document.getElementById('canvasWrap').style.borderColor = '';
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) processFile(file);
}
// Ctrl+V Paste
function setupPasteUpload() {
  document.addEventListener('paste', (e) => {
    const items = (e.clipboardData || e.originalEvent?.clipboardData)?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) { processFile(file); break; }
      }
    }
  });
}

function canUpload() {
  const sub = appState.subscription;
  return sub.remainingRequests > 0;
}

function processFile(file) {
  if (appState.timeBlocked) {
    showToast('Please fix your device time before uploading.', 'error');
    playSound('error');
    return;
  }
  if (!canUpload()) {
    showToast('No requests remaining. Please upgrade your plan.', 'error');
    playSound('error');
    togglePanel('subPanel');
    return;
  }
  playSound('upload');
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img  = new Image();
    img.onload = () => {
      appState.originalImageData = ev.target.result;
      appState.bgRemovedData     = null;
      appState.activeBackground  = null;
      appState.activeFilter      = null;
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

  // Full natural resolution — koi downscale nahi, pixel drop nahi hoga
  canvas.width  = img.naturalWidth;
  canvas.height = img.naturalHeight;

  // Highest quality rendering
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  resetSliders();
  clearActiveFilters();
  showToast('Image loaded! Click "Remove Background" to start.', 'info');
}

function goBackToUpload() {
  document.getElementById('editorSection').classList.add('hidden');
  document.getElementById('heroSection').classList.remove('hidden');
  // ObjectURL cleanup to free memory
  if (appState.bgRemovedData && appState.bgRemovedData.startsWith('blob:')) {
    URL.revokeObjectURL(appState.bgRemovedData);
  }
  appState.originalImageData = null;
  appState.bgRemovedData     = null;
  appState.bgRemovedBlob     = null;
  appState.activeBackground  = null;
  const canvas = document.getElementById('mainCanvas');
  const ctx    = canvas.getContext('2d');
  if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  resetSliders();
}

/* ─────────────────────────────────────────────
   BACKGROUND REMOVAL (via remove.bg API)
───────────────────────────────────────────── */

// ⚠️ APNI remove.bg API KEY YAHAN DAALO
// Free API key: https://www.remove.bg/api (50 free credits/month)
const REMOVE_BG_API_KEY = 'wxPVvpn1UyowSszChEFX5uB4';

async function removeBg() {
  if (!appState.isOnline)           { showToast('No internet connection!', 'error'); playSound('error'); return; }
  if (appState.timeBlocked)         { showToast('Please fix your device time first.', 'error'); playSound('error'); return; }
  if (!appState.originalImageData)  { showToast('Upload an image first.', 'error'); return; }
  if (!canUpload())                 { showToast('No requests remaining. Please upgrade.', 'error'); playSound('error'); togglePanel('subPanel'); return; }

  if (!REMOVE_BG_API_KEY || REMOVE_BG_API_KEY === 'YOUR_REMOVE_BG_API_KEY_HERE') {
    showToast('Remove.bg API key not set. Please add your API key in main.js', 'error');
    playSound('error');
    return;
  }

  const loader = document.getElementById('canvasLoader');
  loader.classList.remove('hidden');
  const btn = document.getElementById('removeBgBtn');
  if (btn) { btn.disabled = true; btn.style.opacity = '0.7'; }
  playSound('open');

  try {
    const blob     = dataURLtoBlob(appState.originalImageData);
    const formData = new FormData();
    formData.append('image_file', blob, 'image.png');
    formData.append('size', 'auto');

    const res = await fetch('https://api.remove.bg/v1.0/removebg', {
      method:  'POST',
      headers: { 'X-Api-Key': REMOVE_BG_API_KEY },
      body:    formData
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error || errJson.errors?.[0]?.title || `Server Error ${res.status}`);
    }

    const resultBlob = await res.blob();

    // Original PNG blob ko ArrayBuffer mein store karo — quality ZERO loss
    const arrayBuffer = await resultBlob.arrayBuffer();
    const bgRemovedBlob = new Blob([arrayBuffer], { type: 'image/png' });

    const objectUrl  = URL.createObjectURL(bgRemovedBlob);
    const img        = new Image();
    img.onload = async () => {
      // bgRemovedData mein original lossless PNG blob store karo (canvas se nahi)
      appState.bgRemovedData     = objectUrl;
      appState.bgRemovedBlob     = bgRemovedBlob; // download ke liye direct blob

      const canvas = document.getElementById('mainCanvas');
      const ctx    = canvas.getContext('2d');
      canvas.width  = img.naturalWidth;
      canvas.height = img.naturalHeight;

      // Highest quality rendering — foreground pixels preserve honge
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (appState.activeBackground) applyBgToCanvas(ctx, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      // Deduct request
      appState.subscription.remainingRequests = Math.max(0, appState.subscription.remainingRequests - 1);
      await saveRequestCountToFirebase();
      updateUploadBadge();
      updatePlanStatus();

      // Apply watermark for free plan
      if (appState.subscription.plan === 'free') applyWatermark();

      playSound('success');
      showToast('Background removed successfully!', 'success');
      loader.classList.add('hidden');
      if (btn) { btn.disabled = false; btn.style.opacity = ''; }
    };
    img.onerror = () => {
      loader.classList.add('hidden');
      if (btn) { btn.disabled = false; btn.style.opacity = ''; }
      showToast('Failed to load result image.', 'error');
    };
    img.src = objectUrl;

  } catch(err) {
    loader.classList.add('hidden');
    if (btn) { btn.disabled = false; btn.style.opacity = ''; }
    playSound('error');
    showToast('BG removal failed: ' + err.message, 'error');
    console.error(err);
  }
}

async function saveRequestCountToFirebase() {
  const uid = appState.firebaseUser?.uid;
  if (!uid || !window._fbUpdateDoc) return;
  try {
    await window._fbUpdateDoc(uid, {
      remainingRequests: appState.subscription.remainingRequests,
      totalRequestsUsed: (appState.userDbData?.totalRequestsUsed || 0) + 1
    });
  } catch(e) { console.warn('Request count update failed:', e); }
}

/* ─────────────────────────────────────────────
   WATERMARK SYSTEM
───────────────────────────────────────────── */
function applyWatermark() {
  const canvas = document.getElementById('mainCanvas');
  const ctx    = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;

  const logoImg = new Image();
  logoImg.onload = () => {
    const size   = Math.min(w * 0.08, 56);
    const pad    = 16;
    const x      = w - size - pad;
    const y      = h - size - pad - 22;

    // Semi-transparent background pill
    ctx.save();
    ctx.globalAlpha = 0.72;
    ctx.fillStyle   = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    const pw = size + 60, ph = size + 22;
    const px = w - pw - pad + 4, py = h - ph - pad + 4;
    ctx.roundRect(px, py, pw, ph, 8);
    ctx.fill();

    // Logo
    ctx.globalAlpha = 1;
    ctx.drawImage(logoImg, x, y, size, size);

    // "InstaPass" text
    ctx.font = `bold ${Math.max(12, size * 0.32)}px 'Kenia', cursive`;
    ctx.fillStyle = '#1d4ed8';
    ctx.textAlign = 'right';
    ctx.globalAlpha = 0.9;
    ctx.fillText('InstaPass', w - pad, h - pad - 2);
    ctx.restore();
  };
  logoImg.src = 'instapass.png';
}

/* ─────────────────────────────────────────────
   BACKGROUND COLORS
───────────────────────────────────────────── */
const COLORS = [
  '#ffffff','#f8faff','#f0f4ff','#dbeafe','#000000','#0f172a',
  '#1d4ed8','#2563eb','#38bdf8','#0ea5e9','#6366f1','#8b5cf6',
  '#ec4899','#f43f5e','#ef4444','#f97316','#eab308','#22c55e',
  '#10b981','#14b8a6','#06b6d4','#3b82f6','#a855f7','#d946ef',
  '#64748b','#94a3b8','#e2e8f0','#fce7f3','#dcfce7','#dbeafe',
  '#fef3c7','#fed7aa','#ffe4e6','#f0fdf4','#f0f9ff','#faf5ff'
];

function buildColorGrid() {
  const grid = document.getElementById('colorGrid');
  if (!grid) return;
  grid.innerHTML = '';
  COLORS.forEach(c => {
    const sw       = document.createElement('div');
    sw.className   = 'color-swatch sound-btn';
    sw.style.background = c;
    sw.title       = c;
    sw.style.border = c === '#ffffff' || c === '#f8faff' || c === '#f0f4ff' ? '2px solid #e2e8f0' : '';
    sw.onclick     = () => {
      if (sw.classList.contains('active')) {
        // Same color pe dobara click = background remove (transparent)
        sw.classList.remove('active');
        appState.activeBackground = null;
        redrawCanvas();
        playSound('click');
      } else {
        setBackground({ type: 'color', value: c });
        setActiveClass(grid, sw);
      }
    };
    grid.appendChild(sw);
  });
}

/* ─────────────────────────────────────────────
   FILTERS
───────────────────────────────────────────── */
const FILTERS = [
  { name: 'Portrait',      css: 'contrast(1.1) saturate(1.2) brightness(1.05)' },
  { name: 'Soft Portrait', css: 'contrast(0.95) saturate(0.9) brightness(1.08) blur(0.3px)' },
  { name: 'Cinematic',     css: 'contrast(1.2) saturate(0.85) brightness(0.95) sepia(0.15)' },
  { name: 'Warm',          css: 'sepia(0.3) saturate(1.4) brightness(1.05) contrast(1.05)' },
  { name: 'Cool',          css: 'hue-rotate(20deg) saturate(1.2) brightness(1.02)' },
  { name: 'Vintage',       css: 'sepia(0.5) contrast(1.1) brightness(0.95) saturate(0.9)' },
  { name: 'B&W',           css: 'grayscale(1) contrast(1.1)' },
  { name: 'HDR',           css: 'contrast(1.3) saturate(1.4) brightness(0.95)' },
  { name: 'Vibe',          css: 'hue-rotate(340deg) saturate(1.6) contrast(1.1)' },
  { name: 'Fade',          css: 'contrast(0.85) saturate(0.8) brightness(1.1)' }
];

function buildFilterGrid() {
  const grid = document.getElementById('filterGrid');
  if (!grid) return;
  grid.innerHTML = '';
  FILTERS.forEach((f, i) => {
    const btn = document.createElement('button');
    btn.className   = 'filter-btn sound-btn';
    btn.textContent = f.name;
    btn.dataset.idx = i;
    btn.onclick     = () => {
      if (btn.classList.contains('active')) {
        btn.classList.remove('active');
        appState.activeFilter = null;
      } else {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        appState.activeFilter = f.css;
      }
      applyFilters();
    };
    grid.appendChild(btn);
  });
}

function clearActiveFilters() {
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  appState.activeFilter = null;
}

/* ─────────────────────────────────────────────
   COLOR PICKER
───────────────────────────────────────────── */
function openColorPicker() {
  document.getElementById('colorPickerDialog').classList.remove('hidden');
  syncColorPickerFromHex(document.getElementById('fullColorPicker').value);
}
function closeColorPicker() {
  document.getElementById('colorPickerDialog').classList.add('hidden');
}
function onColorPickerInput() {
  const hex = document.getElementById('fullColorPicker').value;
  syncColorPickerFromHex(hex);
}
function syncColorPickerFromHex(hex) {
  document.getElementById('hexInput').value = hex;
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  document.getElementById('rInput').value = r;
  document.getElementById('gInput').value = g;
  document.getElementById('bInput').value = b;
  document.getElementById('colorPreview').style.background = hex;
}
function onHexInput() {
  let hex = document.getElementById('hexInput').value;
  if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) return;
  document.getElementById('fullColorPicker').value = hex;
  syncColorPickerFromHex(hex);
}
function onRgbInput() {
  const r = Math.min(255, Math.max(0, parseInt(document.getElementById('rInput').value) || 0));
  const g = Math.min(255, Math.max(0, parseInt(document.getElementById('gInput').value) || 0));
  const b = Math.min(255, Math.max(0, parseInt(document.getElementById('bInput').value) || 0));
  const hex = '#' + [r,g,b].map(x => x.toString(16).padStart(2,'0')).join('');
  document.getElementById('fullColorPicker').value = hex;
  document.getElementById('hexInput').value = hex;
  document.getElementById('colorPreview').style.background = hex;
}
function applyPickedColor() {
  const hex = document.getElementById('fullColorPicker').value;
  setBackground({ type: 'color', value: hex });
  closeColorPicker();
  playSound('success');
}

/* ─────────────────────────────────────────────
   BACKGROUNDS
───────────────────────────────────────────── */
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
    if (bg._img && bg._img.complete) {
      ctx.drawImage(bg._img, 0, 0, w, h);
    } else if (!bg._loading) {
      bg._loading   = true;
      const img     = new Image();
      img.crossOrigin = 'anonymous';
      img.onload    = () => { bg._img = img; bg._loading = false; redrawCanvas(); };
      img.onerror   = () => { bg._loading = false; };
      img.src       = bg.value;
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
  // objectURL aur dataURL dono support karo
  img.src = src;
}

/* ─────────────────────────────────────────────
   IMAGE FILTERS / CONTROLS
───────────────────────────────────────────── */
function applyFilters() {
  const b  = document.getElementById('brightnessSlider').value;
  const c  = document.getElementById('contrastSlider').value;
  const s  = document.getElementById('saturationSlider').value;
  const sh = document.getElementById('sharpnessSlider').value;
  const bl = document.getElementById('blurSlider').value;
  const ex = document.getElementById('exposureSlider').value;
  const hl = document.getElementById('highlightsSlider').value;
  const sd = document.getElementById('shadowsSlider').value;

  document.getElementById('brightnessVal').textContent = b;
  document.getElementById('contrastVal').textContent   = c;
  document.getElementById('saturationVal').textContent = s;
  document.getElementById('sharpnessVal').textContent  = sh;
  document.getElementById('blurVal').textContent       = bl;
  document.getElementById('exposureVal').textContent   = ex;
  document.getElementById('highlightsVal').textContent = hl;
  document.getElementById('shadowsVal').textContent    = sd;

  // Compute brightness with exposure
  const brightCombined = Math.min(200, Math.max(0, parseInt(b) + parseInt(ex)));
  const contrastCombined = Math.min(200, Math.max(0, parseInt(c) + Math.round(parseInt(hl) * 0.3)));

  let filterStr = `brightness(${brightCombined}%) contrast(${contrastCombined}%) saturate(${s}%) blur(${bl}px)`;
  if (appState.activeFilter) filterStr += ' ' + appState.activeFilter;

  const canvas = document.getElementById('mainCanvas');
  canvas.style.filter = filterStr;
}

function resetFilters() {
  ['brightness','contrast','saturation'].forEach(n => {
    document.getElementById(n+'Slider').value     = 100;
    document.getElementById(n+'Val').textContent  = '100';
  });
  ['sharpness','blur','exposure','highlights','shadows'].forEach(n => {
    document.getElementById(n+'Slider').value     = n === 'sharpness' ? 0 : 0;
    document.getElementById(n+'Val').textContent  = '0';
  });
  document.getElementById('mainCanvas').style.filter = '';
  clearActiveFilters();
  playSound('click');
}
function resetSliders() { resetFilters(); }

/* ─────────────────────────────────────────────
   DOWNLOAD / SHARE / HISTORY
───────────────────────────────────────────── */
function downloadImage() {
  const canvas = document.getElementById('mainCanvas');
  if (!canvas.width) { showToast('No image to download.', 'error'); return; }

  const hasFilters  = canvas.style.filter && canvas.style.filter !== 'none' && canvas.style.filter !== '';
  const hasBg       = !!appState.activeBackground;

  // Agar koi filter/background nahi aur BG removed blob available hai — direct lossless download
  if (!hasFilters && !hasBg && appState.bgRemovedBlob) {
    const url  = URL.createObjectURL(appState.bgRemovedBlob);
    const link = document.createElement('a');
    link.download = `instapass_${Date.now()}.png`;
    link.href     = url;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    playSound('download');
    showToast('Downloaded in HD!', 'success');
    return;
  }

  // Filter ya background ke saath — canvas se render karke download karo
  const off   = document.createElement('canvas');
  off.width   = canvas.width;
  off.height  = canvas.height;
  const octx  = off.getContext('2d');

  // Highest quality rendering for download
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = 'high';

  // Pehle background draw karo
  if (hasBg) applyBgToCanvas(octx, off.width, off.height);

  // Phir foreground image draw karo (filters ke saath)
  octx.filter = hasFilters ? (canvas.style.filter || 'none') : 'none';

  const src = appState.bgRemovedData || appState.originalImageData;
  const img = new Image();
  img.onload = () => {
    octx.drawImage(img, 0, 0, off.width, off.height);
    const link       = document.createElement('a');
    link.download    = `instapass_${Date.now()}.png`;
    link.href        = off.toDataURL('image/png', 1.0);
    link.click();
    playSound('download');
    showToast('Downloaded in HD!', 'success');
  };
  img.src = src;
}

async function shareImage() {
  const canvas = document.getElementById('mainCanvas');
  if (!canvas.width) { showToast('No image to share.', 'error'); return; }
  try {
    const blob = await new Promise(res => canvas.toBlob(res, 'image/png', 1.0));
    const file = new File([blob], 'instapass.png', { type: 'image/png' });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ title: 'InstaPass Edit', files: [file] });
      playSound('success');
    } else { downloadImage(); }
  } catch(e) { showToast('Share cancelled.', ''); }
}

function saveToHistory() {
  const canvas = document.getElementById('mainCanvas');
  if (!canvas.width) { showToast('No image to save.', 'error'); return; }
  const thumb  = canvas.toDataURL('image/jpeg', 0.35);
  const full   = canvas.toDataURL('image/png', 1.0);
  const entry  = {
    id:    Date.now(),
    thumb, full,
    date:  new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
  };
  appState.history.unshift(entry);
  if (appState.history.length > 25) appState.history.pop();
  // Persist to localStorage (user-specific)
  const uid = appState.firebaseUser?.uid || 'guest';
  try { localStorage.setItem(`instapass_history_${uid}`, JSON.stringify(appState.history)); } catch(e) {}
  renderHistory();
  playSound('success');
  showToast('Saved to history!', 'success');
}

function loadHistory() {
  const uid = appState.firebaseUser?.uid || 'guest';
  try {
    const raw = localStorage.getItem(`instapass_history_${uid}`);
    if (raw) appState.history = JSON.parse(raw);
  } catch(e) { appState.history = []; }
}

function renderHistory() {
  loadHistory();
  const list = document.getElementById('historyList');
  if (!appState.history.length) {
    list.innerHTML = '<p class="empty-state">No saved edits yet. Save an edit to see it here.</p>';
    return;
  }
  list.innerHTML = appState.history.map(h => `
    <div class="history-item">
      <img class="history-thumb" src="${h.thumb}" alt="edit" />
      <div class="history-info">
        <h4>Edit #${String(h.id).slice(-6)}</h4>
        <p>${h.date}</p>
      </div>
      <button class="history-dl sound-btn" onclick="downloadFromHistory(${h.id})" title="Download">
        <svg width="14" height="14" fill="none" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><polyline points="7 10 12 15 17 10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="12" y1="15" x2="12" y2="3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </button>
    </div>
  `).join('');
}

function downloadFromHistory(id) {
  const item = appState.history.find(h => h.id == id);
  if (!item) return;
  const a    = document.createElement('a');
  a.href     = item.full;
  a.download = `instapass_${id}.png`;
  a.click();
  playSound('download');
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
  const overlay = document.getElementById('panelOverlay');
  if (overlay) overlay.classList.add('hidden');
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
