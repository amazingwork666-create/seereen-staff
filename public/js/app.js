// State
let token = localStorage.getItem('seereen_token') || null;
let currentUser = null;
let socket = null;
let activeQuestion = null;
let muteCountdownTimer = null;
let questionCountdownTimer = null;
let currentAdminSubTab = 'pending';
let memberFilter = 'all';
let allMembersCache = [];

// Unread messages tracking
let unreadCount = 0;
let isUserScrolledUp = false;

// Voice recording state
let mediaRecorder = null;
let audioChunks = [];
let recordingInterval = null;
let recordingSeconds = 0;

// Image upload state
let pendingImageFile = null;

// Audio Synthesizer via Web Audio API
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playTone(freq, type = 'sine', duration = 0.15, startTime = 0) {
  try {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime + startTime);
    gain.gain.setValueAtTime(0.12, audioCtx.currentTime + startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + startTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(audioCtx.currentTime + startTime);
    osc.stop(audioCtx.currentTime + startTime + duration);
  } catch (e) {}
}

function playSound(type) {
  try {
    if (type === 'message') {
      playTone(587.33, 'sine', 0.1, 0);
      playTone(880, 'sine', 0.15, 0.08);
    } else if (type === 'question') {
      playTone(523.25, 'triangle', 0.15, 0);
      playTone(659.25, 'triangle', 0.15, 0.1);
      playTone(783.99, 'triangle', 0.25, 0.2);
      playTone(1046.50, 'triangle', 0.35, 0.3);
    } else if (type === 'star') {
      playTone(659.25, 'triangle', 0.12, 0);
      playTone(783.99, 'triangle', 0.12, 0.1);
      playTone(987.77, 'triangle', 0.15, 0.2);
      playTone(1318.51, 'triangle', 0.4, 0.3);
    } else if (type === 'mute') {
      playTone(300, 'sawtooth', 0.2, 0);
      playTone(200, 'sawtooth', 0.3, 0.15);
    }
  } catch (e) {}
}

// Celebration particle effects
function triggerStarCelebration(targetElem = null) {
  playSound('star');
  const count = 16;
  const container = document.body;
  const rect = targetElem ? targetElem.getBoundingClientRect() : {
    left: window.innerWidth / 2,
    top: window.innerHeight / 2,
    width: 0,
    height: 0
  };

  const startX = rect.left + rect.width / 2;
  const startY = rect.top + rect.height / 2;

  for (let i = 0; i < count; i++) {
    const star = document.createElement('div');
    star.className = 'floating-star text-2xl';
    star.innerText = ['⭐', '🌟', '✨', '🏆'][Math.floor(Math.random() * 4)];
    star.style.left = `${startX + (Math.random() * 80 - 40)}px`;
    star.style.top = `${startY + (Math.random() * 80 - 40)}px`;
    star.style.zIndex = '9999';
    star.style.transition = 'all 1.5s cubic-bezier(0.1, 0.8, 0.3, 1)';
    container.appendChild(star);

    const angle = Math.random() * Math.PI * 2;
    const distance = 80 + Math.random() * 120;
    const destX = startX + Math.cos(angle) * distance;
    const destY = startY + Math.sin(angle) * distance - 80;

    requestAnimationFrame(() => {
      star.style.transform = `translate(${destX - startX}px, ${destY - startY}px) scale(1.6)`;
      star.style.opacity = '0';
    });

    setTimeout(() => { star.remove(); }, 1600);
  }
}

// Helper: Calculate stars
function calculateStars(correctCount) {
  const count = Number(correctCount) || 0;
  if (count <= 0) {
    return {
      stars: 1,
      points: 0,
      total: 0,
      starIcons: '⭐',
      badgeText: '⭐ 0/10'
    };
  }
  const starLevel = Math.floor(count / 10) + 1;
  const currentPoints = count % 10;
  const starIcons = '⭐'.repeat(Math.min(starLevel, 5)) + (starLevel > 5 ? ` +${starLevel - 5}` : '');

  return {
    stars: starLevel,
    points: currentPoints,
    total: count,
    starIcons: starIcons,
    badgeText: `${starIcons} (${currentPoints}/10)`
  };
}

// Name color classification based on role and gender
function getUserNameClass(user) {
  if (!user) return 'user-name-boy';
  const name = (user.full_name || '').toLowerCase().trim();
  const uname = (user.username || '').toLowerCase().trim();
  const rawName = (user.full_name || '').trim();
  const isSuper = user.role === 'super_admin' || uname === 'admin' || uname === 'hemn' || name === 'hemn taha' || rawName === 'هێمن تەها' || rawName.includes('هێمن') || name.includes('hemn');
  if (isSuper) {
    return 'user-name-super-admin';
  }
  if (user.role === 'teacher') {
    return 'user-name-teacher';
  }
  if (user.role === 'admin') {
    return 'user-name-admin';
  }
  if (user.role === 'guest') {
    return 'user-name-guest';
  }
  if (user.gender === 'female') {
    return 'user-name-girl';
  }
  return 'user-name-boy';
}

function formatUserDisplayName(user) {
  if (!user) return '';
  let prefix = '';
  let suffix = '';
  const name = (user.full_name || '').toLowerCase().trim();
  const uname = (user.username || '').toLowerCase().trim();
  const rawName = (user.full_name || '').trim();
  const isSuper = user.role === 'super_admin' || uname === 'admin' || uname === 'hemn' || name === 'hemn taha' || rawName === 'هێمن تەها' || rawName.includes('هێمن') || name.includes('hemn');

  if (user.role === 'guest') {
    prefix = '👁️ ';
  } else if (user.role === 'new_student') {
    suffix = ' 🔰';
  } else if (user.role === 'teacher') {
    suffix = ' 👨‍🏫';
  } else if (isSuper) {
    suffix = ' 🛡️';
  }
  return `${prefix}${user.full_name}${suffix}`;
}

function renderRoleBadge(role) {
  if (role === 'super_admin') {
    return `<span class="badge-super-admin-shield inline-flex items-center text-xs select-none" title="ئەدمین">🛡️</span>`;
  } else if (role === 'teacher') {
    return `<span class="badge-teacher px-2 py-0.5 rounded-md text-[10px] font-black inline-flex items-center gap-1 shadow">👨‍🏫 مامۆستا</span>`;
  } else if (role === 'admin') {
    return `<span class="badge-admin px-2 py-0.5 rounded-md text-[10px] font-black inline-flex items-center gap-1 shadow"><i class="fa-solid fa-shield-halved text-[9px]"></i> ئەدمین</span>`;
  } else if (role === 'new_student') {
    return `<span class="badge-new-student px-2 py-0.5 rounded-md text-[10px] font-bold inline-flex items-center gap-1 shadow">🔰 قوتابی تازە</span>`;
  } else if (role === 'guest') {
    return `<span class="badge-guest px-2 py-0.5 rounded-md text-[10px] font-bold inline-flex items-center gap-1 shadow">👁️ میوان (چاودێر)</span>`;
  } else {
    return `<span class="badge-student px-2 py-0.5 rounded-md text-[10px] font-bold inline-flex items-center gap-1"><i class="fa-solid fa-graduation-cap text-[9px]"></i> قوتابی</span>`;
  }
}

function renderStarBadge(correctCount) {
  const info = calculateStars(correctCount);
  return `
    <span class="star-badge px-2 py-0.5 rounded-lg text-xs font-bold inline-flex items-center gap-1 border" title="کۆی گشتی: ${info.total} | پلەی ${info.stars} ئەستێرە">
      <span>${info.starIcons}</span>
      <span class="font-mono text-[11px] font-black">(${info.points}/10)</span>
    </span>
  `;
}

// Link detector
function containsLink(text) {
  if (!text) return false;
  const linkRegex = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|([a-zA-Z0-9-]+\.(com|net|org|edu|gov|io|me|app|co|info|xyz|online|site|tech|tv|cc|ly|gg|top|club|space|iq|ir|tr)(\/[^\s]*)?)/i;
  return linkRegex.test(text);
}

// --- INIT APP ---
window.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  fetchDreamAvailability();
  if (token) {
    await fetchCurrentUser();
  } else {
    showAuthScreen();
  }
});

function showAuthScreen() {
  document.getElementById('authScreen').classList.remove('hidden');
  document.getElementById('mainApp').classList.add('hidden');
}

function showMainApp() {
  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('mainApp').classList.remove('hidden');
  initSocket();
  loadMessages();
  loadActiveQuestion();
  loadPodiumWidget();
  loadAllMembers();
  checkMuteState();
  requestNotificationPermission();

  if (currentUser && currentUser.role === 'super_admin') {
    checkPendingCount();
    fetchDreamAvailability();
  }
}

function switchAuthTab(tab) {
  hideAuthAlert();
  const tabLogin = document.getElementById('tabLogin');
  const tabRegister = document.getElementById('tabRegister');
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const forgotForm = document.getElementById('forgotForm');

  if (tab === 'login') {
    if (tabLogin) tabLogin.className = 'flex-1 py-2 text-sm font-bold rounded-xl transition duration-200 bg-indigo-600 text-white shadow';
    if (tabRegister) tabRegister.className = 'flex-1 py-2 text-sm font-bold rounded-xl transition duration-200 text-slate-400 hover:text-white';
    if (loginForm) loginForm.classList.remove('hidden');
    if (registerForm) registerForm.classList.add('hidden');
    if (forgotForm) forgotForm.classList.add('hidden');
  } else if (tab === 'register') {
    if (tabRegister) tabRegister.className = 'flex-1 py-2 text-sm font-bold rounded-xl transition duration-200 bg-indigo-600 text-white shadow';
    if (tabLogin) tabLogin.className = 'flex-1 py-2 text-sm font-bold rounded-xl transition duration-200 text-slate-400 hover:text-white';
    if (registerForm) registerForm.classList.remove('hidden');
    if (loginForm) loginForm.classList.add('hidden');
    if (forgotForm) forgotForm.classList.add('hidden');
  } else if (tab === 'forgot') {
    if (tabLogin) tabLogin.className = 'flex-1 py-2 text-sm font-bold rounded-xl transition duration-200 text-slate-400 hover:text-white';
    if (tabRegister) tabRegister.className = 'flex-1 py-2 text-sm font-bold rounded-xl transition duration-200 text-slate-400 hover:text-white';
    if (forgotForm) forgotForm.classList.remove('hidden');
    if (loginForm) loginForm.classList.add('hidden');
    if (registerForm) registerForm.classList.add('hidden');
  }
}

function showAuthAlert(message, type = 'error') {
  const alertBox = document.getElementById('authAlert');
  const alertText = document.getElementById('authAlertText');
  const alertIcon = document.getElementById('authAlertIcon');

  alertBox.classList.remove('hidden', 'bg-red-500/10', 'border-red-500/30', 'text-red-300', 'bg-emerald-500/10', 'border-emerald-500/30', 'text-emerald-300', 'bg-amber-500/10', 'border-amber-500/30', 'text-amber-300');

  if (type === 'error') {
    alertBox.classList.add('bg-red-500/10', 'border', 'border-red-500/30', 'text-red-300');
    alertIcon.className = 'fa-solid fa-circle-exclamation mt-0.5 text-base text-red-400';
  } else if (type === 'success') {
    alertBox.classList.add('bg-emerald-500/10', 'border', 'border-emerald-500/30', 'text-emerald-300');
    alertIcon.className = 'fa-solid fa-circle-check mt-0.5 text-base text-emerald-400';
  } else if (type === 'warning') {
    alertBox.classList.add('bg-amber-500/10', 'border', 'border-amber-500/30', 'text-amber-300');
    alertIcon.className = 'fa-solid fa-clock mt-0.5 text-base text-amber-400';
  }

  alertText.innerHTML = message;
}

function hideAuthAlert() {
  document.getElementById('authAlert').classList.add('hidden');
}

// Handle Login
async function handleLogin(e) {
  e.preventDefault();
  hideAuthAlert();
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  const btn = document.getElementById('loginSubmitBtn');

  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> چاوەڕێبە...`;

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();

    if (!res.ok) {
      if (data.status === 'pending') {
        showAuthAlert(`<b>داواکارییەکەت لە چاوەڕوانی پەسەندکردنی سوپەر ئەدمیندایە!</b><br>تکایە چاوەڕوان بە تا بەڕێوەبەر پەسەندت دەکات.`, 'warning');
      } else {
        showAuthAlert(data.error || 'چوونەژوورەوە سەرکەوتوو نەبوو', 'error');
      }
      return;
    }

    token = data.token;
    localStorage.setItem('seereen_token', token);
    currentUser = data.user;
    updateUserUI();
    showMainApp();
  } catch (err) {
    showAuthAlert('پەیوەندی لەگەڵ سێرڤەر ناتەواوە', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<span>چوونەژوورەوە</span> <i class="fa-solid fa-arrow-left"></i>`;
  }
}

// Handle Register with Gender
async function handleRegister(e) {
  e.preventDefault();
  hideAuthAlert();

  const fullName = document.getElementById('regFullName').value.trim();
  const gender = document.querySelector('input[name="regGender"]:checked').value;
  const username = document.getElementById('regUsername').value.trim();
  const password = document.getElementById('regPassword').value;
  const btn = document.getElementById('regSubmitBtn');

  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> چاوەڕێبە...`;

  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name: fullName, gender, username, password })
    });
    const data = await res.json();

    if (!res.ok) {
      showAuthAlert(data.error || 'تۆمارکردن سەرکەوتوو نەبوو', 'error');
      return;
    }

    showAuthAlert(`<b>${data.message}</b>`, 'success');
    document.getElementById('registerForm').reset();
    setTimeout(() => { switchAuthTab('login'); }, 3000);
  } catch (err) {
    showAuthAlert('پەیوەندی لەگەڵ سێرڤەر ناتەواوە', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<span>ناردنی داواکاری خۆتۆمارکردن</span> <i class="fa-solid fa-paper-plane"></i>`;
  }
}

// Handle Forgot Password
async function handleForgotPassword(e) {
  e.preventDefault();
  hideAuthAlert();

  const username = document.getElementById('forgotUsername').value.trim();
  const newPassword = document.getElementById('forgotNewPassword').value;
  const confirmPassword = document.getElementById('forgotConfirmPassword').value;
  const btn = document.getElementById('forgotSubmitBtn');

  if (newPassword !== confirmPassword) {
    showAuthAlert('وشەی نهێنی نوێ و دووبارەکردنەوەکەی وەک یەک نین!', 'error');
    return;
  }

  if (newPassword.length < 4) {
    showAuthAlert('وشەی نهێنی نوێ دەبێت بە لایەنی کەم ٤ پیت بێت!', 'error');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> چاوەڕێبە...`;

  try {
    const res = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, new_password: newPassword })
    });
    const data = await res.json();

    if (!res.ok) {
      showAuthAlert(data.error || 'ناردنی داواکاری سەرکەوتوو نەبوو', 'error');
      return;
    }

    showAuthAlert(`<b>${data.message}</b>`, 'success');
    document.getElementById('forgotForm').reset();
    setTimeout(() => { switchAuthTab('login'); }, 4000);
  } catch (err) {
    showAuthAlert('پەیوەندی لەگەڵ سێرڤەر ناتەواوە', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<span>ناردنی داواکاری بۆ سوپەر ئەدمین</span> <i class="fa-solid fa-paper-plane"></i>`;
  }
}

// Fetch Current User
async function fetchCurrentUser() {
  try {
    const res = await fetch('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        handleLogout();
      }
      return;
    }
    const data = await res.json();
    currentUser = data.user;
    updateUserUI();
    showMainApp();
  } catch (err) {
    console.warn('Network issue fetching current user, retrying...', err);
    // Do NOT wipe token on network error; retry after 2 seconds
    setTimeout(async () => {
      try {
        const retryRes = await fetch('/api/auth/me', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (retryRes.ok) {
          const data = await retryRes.json();
          currentUser = data.user;
          updateUserUI();
          showMainApp();
        } else if (retryRes.status === 401 || retryRes.status === 403) {
          handleLogout();
        }
      } catch (e) {}
    }, 2000);
  }
}


// Update UI based on user role & name
function updateUserUI() {
  if (!currentUser) return;

  const headerNameElem = document.getElementById('headerFullName');
  headerNameElem.innerText = formatUserDisplayName(currentUser);
  headerNameElem.className = `text-xs font-black ${getUserNameClass(currentUser)}`;
  
  const roleBadgeElem = document.getElementById('headerRoleBadge');
  if (currentUser.role === 'super_admin') {
    roleBadgeElem.className = 'hidden';
    roleBadgeElem.innerText = '';
  } else if (currentUser.role === 'teacher') {
    roleBadgeElem.className = 'badge-teacher text-[9px] px-1.5 py-0.2 rounded font-black';
    roleBadgeElem.innerText = 'مامۆستا 👨‍🏫';
  } else if (currentUser.role === 'admin') {
    roleBadgeElem.className = 'badge-admin text-[9px] px-1.5 py-0.2 rounded font-black';
    roleBadgeElem.innerText = 'ئەدمین 🛡️';
  } else if (currentUser.role === 'new_student') {
    roleBadgeElem.className = 'badge-new-student text-[9px] px-1.5 py-0.2 rounded font-bold';
    roleBadgeElem.innerText = 'قوتابی تازە 🔰';
  } else if (currentUser.role === 'guest') {
    roleBadgeElem.className = 'badge-guest text-[9px] px-1.5 py-0.2 rounded font-bold';
    roleBadgeElem.innerText = 'میوان 👁️';
  } else {
    roleBadgeElem.className = 'badge-student text-[9px] px-1.5 py-0.2 rounded font-bold';
    roleBadgeElem.innerText = 'قوتابی 🎓';
  }

  const starInfo = calculateStars(currentUser.correct_answers_count);
  document.getElementById('headerStarBadge').innerHTML = `
    <span>${starInfo.starIcons}</span>
    <span class="font-mono font-black">${starInfo.points}/10</span>
  `;

  const isSuperAdmin = currentUser.role === 'super_admin';
  const isTeacher = currentUser.role === 'teacher';
  const isAdmin = currentUser.role === 'admin' || isSuperAdmin || isTeacher;

  const adminPanelBtn = document.getElementById('adminPanelNavBtn');
  const postQuestionNavBtn = document.getElementById('postQuestionNavBtn');
  const unansweredStatsNavBtn = document.getElementById('unansweredStatsNavBtn');
  const adminMediaTools = document.getElementById('adminMediaTools');
  const membersNavBtn = document.getElementById('membersNavBtn');
  const membersSidebar = document.getElementById('membersSidebar');
  const libraryNavBtn = document.getElementById('libraryNavBtn');
  const libraryUploadSection = document.getElementById('libraryUploadSection');
  const messageInput = document.getElementById('messageInput');
  const sendBtn = document.getElementById('sendBtn');

  if (isSuperAdmin) {
    adminPanelBtn.classList.remove('hidden');
  } else {
    adminPanelBtn.classList.add('hidden');
  }

  const mobilePostQuestionBtn = document.getElementById('mobilePostQuestionBtn');
  const mobileLibraryBtn = document.getElementById('mobileLibraryBtn');
  const mobileAdminPanelBtn = document.getElementById('mobileAdminPanelBtn');
  const mobileDreamAdminBtn = document.getElementById('mobileDreamAdminBtn');
  const mobileUnansweredBtn = document.getElementById('mobileUnansweredBtn');

  if (isSuperAdmin) {
    adminPanelBtn.classList.remove('hidden');
    if (mobileAdminPanelBtn) mobileAdminPanelBtn.classList.remove('hidden');
  } else {
    adminPanelBtn.classList.add('hidden');
    if (mobileAdminPanelBtn) mobileAdminPanelBtn.classList.add('hidden');
  }

  const dreamAdminNavBtn = document.getElementById('dreamAdminNavBtn');
  if (dreamAdminNavBtn) {
    if (isSuperAdmin || isTeacher) {
      dreamAdminNavBtn.classList.remove('hidden');
      if (mobileDreamAdminBtn) mobileDreamAdminBtn.classList.remove('hidden');
      loadDreamSessionsCount();
    } else {
      dreamAdminNavBtn.classList.add('hidden');
      if (mobileDreamAdminBtn) mobileDreamAdminBtn.classList.add('hidden');
    }
  }

  if (isAdmin) {
    postQuestionNavBtn.classList.remove('hidden');
    if (mobilePostQuestionBtn) mobilePostQuestionBtn.classList.remove('hidden');
    if (unansweredStatsNavBtn) unansweredStatsNavBtn.classList.remove('hidden');
    if (mobileUnansweredBtn) mobileUnansweredBtn.classList.remove('hidden');
    adminMediaTools.classList.remove('hidden');
    adminMediaTools.classList.add('flex');
    if (libraryUploadSection) libraryUploadSection.classList.remove('hidden');
  } else {
    postQuestionNavBtn.classList.add('hidden');
    if (mobilePostQuestionBtn) mobilePostQuestionBtn.classList.add('hidden');
    if (unansweredStatsNavBtn) unansweredStatsNavBtn.classList.add('hidden');
    if (mobileUnansweredBtn) mobileUnansweredBtn.classList.add('hidden');
    adminMediaTools.classList.add('hidden');
    adminMediaTools.classList.remove('flex');
    if (libraryUploadSection) libraryUploadSection.classList.add('hidden');
  }

  // Members sidebar & button: ONLY visible to Super Admin, Admin, and Teacher
  const mobileMembersBtn = document.getElementById('mobileMembersBtn');
  const membersBackdrop = document.getElementById('membersBackdrop');

  if (isAdmin) {
    if (membersNavBtn) membersNavBtn.classList.remove('hidden');
    if (mobileMembersBtn) mobileMembersBtn.classList.remove('hidden');
    if (membersSidebar) {
      if (window.innerWidth >= 768) {
        membersSidebar.classList.remove('hidden');
        membersSidebar.classList.add('flex');
      } else {
        membersSidebar.classList.add('translate-x-full');
        membersSidebar.classList.remove('translate-x-0');
      }
    }
    loadAllMembers();
  } else {
    // Hidden completely for students and guests
    if (membersNavBtn) membersNavBtn.classList.add('hidden');
    if (mobileMembersBtn) mobileMembersBtn.classList.add('hidden');
    if (membersSidebar) {
      membersSidebar.classList.add('hidden');
      membersSidebar.classList.remove('flex');
      membersSidebar.classList.add('translate-x-full');
    }
    if (membersBackdrop) membersBackdrop.classList.add('hidden');
  }

  // Library button visibility: hidden only for guests
  if (currentUser.role === 'guest') {
    if (libraryNavBtn) libraryNavBtn.classList.add('hidden');
    if (mobileLibraryBtn) mobileLibraryBtn.classList.add('hidden');
  } else {
    if (libraryNavBtn) libraryNavBtn.classList.remove('hidden');
    if (mobileLibraryBtn) mobileLibraryBtn.classList.remove('hidden');
  }

  // Handle guest / new_student / muted input restrictions
  if (currentUser.role === 'guest') {
    messageInput.disabled = true;
    messageInput.placeholder = "👁️ تۆ وەک میوان (چاودێر) داخڵبوویت و ناتوانیت لە چات قسە بکەیت";
    sendBtn.disabled = true;
  } else if (currentUser.role === 'new_student') {
    if (!currentUser.muted_until || currentUser.muted_until <= Date.now()) {
      messageInput.disabled = false;
      sendBtn.disabled = false;
      messageInput.placeholder = "پەیامەکەت بنووسە... (قوتابی تازە: لە ٢٤ کاتژمێردا تەنها یەک نامە)";
    }
  } else if (!currentUser.muted_until || currentUser.muted_until <= Date.now()) {
    messageInput.disabled = false;
    sendBtn.disabled = false;
    messageInput.placeholder = "پەیامەکەت بنووسە...";
  }
}

function handleLogout() {
  localStorage.removeItem('seereen_token');
  token = null;
  currentUser = null;
  if (socket) socket.disconnect();
  showAuthScreen();
}

// --- TOP 3 PODIUM WIDGET ---
async function loadPodiumWidget() {
  const container = document.getElementById('podiumItems');
  try {
    const res = await fetch('/api/chat/leaderboard', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    container.innerHTML = '';

    if (!data.leaderboard || data.leaderboard.length === 0) {
      container.innerHTML = '<span class="text-xs text-slate-500">هێشتا هیچ ئەستێرەیەک نەبەخشراوە</span>';
      return;
    }

    const top3 = data.leaderboard.slice(0, 3);
    top3.forEach((st, idx) => {
      const medals = ['🥇', '🥈', '🥉'];
      const borders = ['border-amber-500/50 bg-amber-500/10', 'border-slate-400/50 bg-slate-400/10', 'border-amber-700/50 bg-amber-700/10'];
      const stNameClass = getUserNameClass(st);

      const pill = document.createElement('div');
      pill.className = `flex items-center gap-1.5 px-2.5 py-1 rounded-xl border ${borders[idx]} cursor-pointer hover:scale-105 transition`;
      pill.onclick = () => openUserProfileModal(st.id);
      pill.innerHTML = `
        <span class="text-sm">${medals[idx]}</span>
        <span class="text-xs font-bold ${stNameClass}">${escapeHtml(st.full_name)}</span>
        <span class="text-[11px] text-amber-400 font-mono font-black">${st.starInfo.starIcons}</span>
      `;
      container.appendChild(pill);
    });
  } catch (err) {
    container.innerHTML = '<span class="text-xs text-slate-500">کێشە لە بارکردنی ڕیزبەندی</span>';
  }
}

// --- ANDROID PWA APP INSTALLATION ---
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  const installBox = document.getElementById('androidInstallBox');
  if (installBox) installBox.classList.remove('hidden');
});

async function installAndroidApp() {
  if (deferredInstallPrompt) {
    try {
      deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      if (choice && choice.outcome === 'accepted') {
        console.log('User installed the app');
      }
      deferredInstallPrompt = null;
    } catch (err) {
      console.warn('Install prompt error:', err);
      openInstallAppModal();
    }
  } else {
    openInstallAppModal();
  }
}

function openInstallAppModal() {
  const modal = document.getElementById('installAppModal');
  if (modal) modal.classList.remove('hidden');
}

function closeInstallAppModal() {
  const modal = document.getElementById('installAppModal');
  if (modal) modal.classList.add('hidden');
}

window.addEventListener('DOMContentLoaded', () => {
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  if (isStandalone) {
    const installBox = document.getElementById('androidInstallBox');
    if (installBox) {
      installBox.innerHTML = `
        <div class="w-full py-2 px-3 bg-emerald-950/60 border border-emerald-500/30 rounded-2xl text-center text-xs font-bold text-emerald-300 flex items-center justify-center gap-2">
          <i class="fa-solid fa-circle-check text-emerald-400"></i>
          <span>ئەپەکە لەسەر مۆبایلەکەت دامەزراوە</span>
        </div>
      `;
    }
  }
});

// --- BROWSER / ANDROID SYSTEM NOTIFICATIONS ---
function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().then(perm => {
      console.log('Notification permission:', perm);
    }).catch(() => {});
  }
}

function sendBrowserNotification(msg) {
  try {
    if (navigator.vibrate) {
      navigator.vibrate([150, 80, 150]);
    }

    if (!('Notification' in window) || Notification.permission !== 'granted') {
      return;
    }

    const senderName = msg.full_name || 'ستافی سیرین';
    let bodyText = msg.content || '';
    if (msg.attachment_type === 'image') {
      bodyText = '📷 وێنەیەکی نوێی نارد';
    } else if (msg.attachment_type === 'voice') {
      bodyText = '🎙️ نامەیەکی دەنگیی نارد';
    } else if (msg.attachment_type === 'video') {
      bodyText = '🎥 ڤیدیۆیەکی نوێی نارد';
    }
    if (!bodyText) bodyText = 'پەیامێکی نوێ لە گروپ چات';

    const options = {
      body: bodyText,
      icon: '/images/logo.jpg',
      badge: '/images/logo.jpg',
      tag: 'seereen-msg',
      renotify: true,
      vibrate: [200, 100, 200]
    };

    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.ready.then(reg => {
        reg.showNotification(`${senderName} 💬`, options);
      }).catch(() => {
        new Notification(`${senderName} 💬`, options);
      });
    } else {
      new Notification(`${senderName} 💬`, options);
    }
  } catch (err) {
    console.warn('Notification error:', err);
  }
}

function sendQuestionNotification(q) {
  try {
    if (navigator.vibrate) {
      navigator.vibrate([300, 100, 300]);
    }
    if (!('Notification' in window) || Notification.permission !== 'granted') {
      return;
    }
    const options = {
      body: q.question_text || 'پرسیارێکی نوێ لەناو چات دانرا!',
      icon: '/images/logo.jpg',
      badge: '/images/logo.jpg',
      tag: 'seereen-question',
      renotify: true,
      vibrate: [300, 100, 300]
    };
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.ready.then(reg => {
        reg.showNotification('❓ پرسیاری نوێ لە ستافی سیرین!', options);
      }).catch(() => {
        new Notification('❓ پرسیاری نوێ لە ستافی سیرین!', options);
      });
    } else {
      new Notification('❓ پرسیاری نوێ لە ستافی سیرین!', options);
    }
  } catch (e) {}
}

// --- SOCKET.IO REAL-TIME CONNECTION ---
function initSocket() {
  if (socket) socket.disconnect();

  socket = io({
    auth: { token }
  });

  socket.on('online_users', (usersList) => {
    document.getElementById('onlineCountText').innerText = `${usersList.length} لە هێڵە`;
    loadAllMembers();
  });

  socket.on('new_message', (msg) => {
    appendMessage(msg);
    if (msg.user_id !== (currentUser ? currentUser.id : null)) {
      playSound('message');
      sendBrowserNotification(msg);
      if (isUserScrolledUp) {
        unreadCount++;
        showUnreadJumpPill();
      }
    }
  });

  socket.on('new_question', (data) => {
    activeQuestion = data.question;
    renderActiveQuestionSticky(data.question);
    playSound('question');
    triggerStarCelebration();
    sendQuestionNotification(data.question);
  });

  // Secret submission count updated in real time
  socket.on('submission_count_updated', (data) => {
    if (activeQuestion && activeQuestion.id === data.question_id) {
      activeQuestion.submission_count = data.submission_count;
      document.getElementById('stickySubmissionCountBadge').innerText = `${data.submission_count} وەڵام تۆمارکراوە`;
    }
  });

  // Simultaneous reveal of all answers!
  socket.on('question_revealed', (data) => {
    if (activeQuestion && activeQuestion.id === data.question_id) {
      activeQuestion = null;
      stopQuestionCountdown();
      renderActiveQuestionSticky(null);
    }
    playSound('question');
    triggerStarCelebration();
  });

  socket.on('question_closed', (data) => {
    if (activeQuestion && activeQuestion.id === data.question_id) {
      activeQuestion = null;
      renderActiveQuestionSticky(null);
    }
  });

  socket.on('star_awarded', (data) => {
    if (currentUser && currentUser.id === data.user_id) {
      currentUser.correct_answers_count = data.new_count;
      updateUserUI();
      triggerStarCelebration();
    }

    // Update any button in revealed submissions cards to awarded badge
    document.querySelectorAll('.award-star-btn').forEach(btn => {
      const onclickAttr = btn.getAttribute('onclick') || '';
      if (onclickAttr.includes(String(data.question_id)) && onclickAttr.includes(String(data.user_id))) {
        btn.disabled = true;
        btn.className = 'px-3 py-1.5 bg-emerald-600/30 text-emerald-400 border border-emerald-500/40 font-black text-xs rounded-xl flex items-center gap-1 cursor-default';
        btn.innerHTML = '<i class="fa-solid fa-circle-check"></i> <span>پەسەندکرا ⭐</span>';
      }
    });

    if (activeQuestion && activeQuestion.id === data.question_id) {
      activeQuestion = null;
      renderActiveQuestionSticky(null);
    }
    loadPodiumWidget();
    loadLeaderboard();
    loadAllMembers();
  });

  socket.on('user_muted', (data) => {
    if (currentUser && currentUser.id === data.user_id) {
      currentUser.muted_until = data.muted_until;
      checkMuteState();
      playSound('mute');
      alert(`⚠️ تۆ لەلایەن ئەدمینەوە سڕکرایت بۆ ماوەی ٢٤ کاتژمێر`);
    }
    loadAllMembers();
    if (document.getElementById('adminModal') && !document.getElementById('adminModal').classList.contains('hidden')) {
      loadAllUsersList();
    }
  });

  socket.on('user_unmuted', (data) => {
    if (currentUser && currentUser.id === data.user_id) {
      currentUser.muted_until = 0;
      checkMuteState();
    }
    loadAllMembers();
    if (document.getElementById('adminModal') && !document.getElementById('adminModal').classList.contains('hidden')) {
      loadAllUsersList();
    }
  });

  socket.on('user_blocked', (data) => {
    if (currentUser && currentUser.id === data.user_id) {
      alert('🚫 هەژمارەکەت لەلایەن سوپەر ئەدمینەوە بلۆک کرا!');
      handleLogout();
    }
  });

  socket.on('new_pending_user', () => {
    if (currentUser && currentUser.role === 'super_admin') {
      checkPendingCount();
    }
  });

  socket.on('new_dream_session', () => {
    if (currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'teacher')) {
      loadDreamSessionsCount();
      playSound('message');
      if (typeof activeDreamAdminSessionId !== 'undefined' && activeDreamAdminSessionId) loadDreamAdminSessions();
    }
  });

  socket.on('dream_session_updated', () => {
    if (currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'teacher')) {
      loadDreamSessionsCount();
      if (typeof activeDreamAdminSessionId !== 'undefined' && activeDreamAdminSessionId) loadDreamAdminSessions();
    }
  });

  socket.on('dream_session_deleted', (data) => {
    if (currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'teacher')) {
      if (data && data.sessionId) {
        dreamAdminSessionsCache = dreamAdminSessionsCache.filter(x => x.id !== data.sessionId);
        if (activeDreamAdminSessionId === data.sessionId) {
          activeDreamAdminSessionId = null;
          const chatArea = document.getElementById('dreamAdminChatArea');
          const emptyPrompt = document.getElementById('dreamAdminEmptyPrompt');
          if (chatArea) chatArea.classList.add('hidden');
          if (emptyPrompt) emptyPrompt.classList.remove('hidden');
        }
        if (typeof renderDreamAdminSessionsCards === 'function') renderDreamAdminSessionsCards();
        loadDreamSessionsCount();
      }
    }
  });

  socket.on('dream_session_favorited', (data) => {
    if (currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'teacher')) {
      if (data && data.sessionId) {
        const s = dreamAdminSessionsCache.find(x => x.id === data.sessionId);
        if (s) s.is_favorite = data.is_favorite;
        if (typeof renderDreamAdminSessionsCards === 'function') renderDreamAdminSessionsCards();
        if (activeDreamAdminSessionId === data.sessionId) {
          const favIcon = document.getElementById('dreamAdminFavIcon');
          const favBtn = document.getElementById('dreamAdminFavBtn');
          if (favIcon && favBtn) {
            if (data.is_favorite) {
              favIcon.className = 'fa-solid fa-star text-amber-400 text-sm';
              favBtn.title = 'لابردن لە دڵخوازەکان ⭐';
            } else {
              favIcon.className = 'fa-regular fa-star text-slate-400 text-sm';
              favBtn.title = 'کردن بە دڵخواز ⭐';
            }
          }
        }
      }
    }
  });

  socket.on('dream_message_deleted', (data) => {
    if (data && data.messageId) {
      const adminEl = document.getElementById(`dream-admin-msg-${data.messageId}`);
      if (adminEl) adminEl.remove();
      const dreamerEl = document.getElementById(`dream-msg-${data.messageId}`);
      if (dreamerEl) dreamerEl.remove();
    }
  });

  socket.on('dream_incoming_call', (data) => {
    handleIncomingDreamCall(data, true);
  });

  socket.on('dream_call_accepted', (data) => {
    handleDreamCallAccepted(data);
  });

  socket.on('dream_call_rejected', (data) => {
    handleDreamCallRejected(data);
  });

  socket.on('dream_call_signal', (data) => {
    handleDreamCallSignal(data);
  });

  socket.on('dream_call_ended', () => {
    handleDreamCallEnded();
  });

  socket.on('dream_availability_updated', (data) => {
    updateDreamAvailabilityUI(data);
  });

  socket.on('dream_new_secret_recording', (data) => {
    if (typeof activeDreamAdminSessionId !== 'undefined' && activeDreamAdminSessionId === data.sessionId) {
      appendDreamAdminMessage(data.message);
    }
  });

  socket.on('role_changed', (data) => {
    if (currentUser && currentUser.id === data.user_id) {
      currentUser.role = data.new_role;
      updateUserUI();
    }
    loadAllMembers();
  });

  socket.on('user_deleted', (data) => {
    if (currentUser && currentUser.id === data.user_id) {
      alert('ئەکاونتەکەت لەلایەن سوپەر ئەدمینەوە سڕایەوە و دەرکرایت.');
      handleLogout();
    } else {
      loadAllMembers();
      if (typeof loadAllUsersList === 'function') loadAllUsersList();
    }
  });

  socket.on('new_password_reset_request', () => {
    if (currentUser && currentUser.role === 'super_admin') {
      checkPendingCount();
      playSound('question');
      if (typeof currentAdminSubTab !== 'undefined' && currentAdminSubTab === 'password_resets') {
        loadPasswordResetsList();
      }
    }
  });

  socket.on('message_deleted', (data) => {
    const el = document.getElementById(`msg-${data.id}`);
    if (el) el.remove();
  });

  socket.on('error_message', (err) => {
    alert(err);
  });
}

// --- MESSAGES LOGIC ---
async function loadMessages() {
  try {
    const res = await fetch('/api/chat/messages', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    const container = document.getElementById('messagesContainer');
    container.innerHTML = '';

    if (data.messages && data.messages.length > 0) {
      data.messages.forEach(msg => appendMessage(msg, false));
      scrollToBottom();
    } else {
      container.innerHTML = `
        <div class="text-center py-12 flex flex-col items-center justify-center empty-welcome-box">
          <div class="relative mb-3">
            <div class="absolute -inset-1.5 bg-gradient-to-r from-[#c78361] via-[#dfaa86] to-[#fae2cc] rounded-2xl blur-sm opacity-50"></div>
            <img src="/images/logo.jpg" alt="ستافی سیرین" class="relative w-20 h-20 rounded-2xl object-cover border border-[#fae2cc]/60 shadow-xl shadow-[#dfaa86]/20">
          </div>
          <h3 class="font-black text-base text-transparent bg-clip-text bg-gradient-to-r from-[#ffffff] via-[#fae2cc] to-[#dfaa86]">بەخێربێن بۆ ستافی سیرین</h3>
        </div>
      `;
    }
  } catch (err) {
    console.error('Error loading messages:', err);
  }
}

function appendMessage(msg, scroll = true) {
  const container = document.getElementById('messagesContainer');
  const emptyPlaceholder = container.querySelector('.empty-welcome-box, .text-slate-500');
  if (emptyPlaceholder) emptyPlaceholder.remove();

  const isMe = currentUser && msg.user_id === currentUser.id;
  const isAdmin = currentUser && (currentUser.role === 'admin' || currentUser.role === 'super_admin');
  const isSuperAdmin = currentUser && currentUser.role === 'super_admin';
  const dateStr = new Date(msg.created_at).toLocaleTimeString('ku-IQ', { hour: '2-digit', minute: '2-digit' });

  let msgElem = document.createElement('div');
  msgElem.id = `msg-${msg.id}`;
  msgElem.className = 'transition-all duration-200 chat-msg-item';

  // 1. SYSTEM MESSAGES (welcome messages disabled)
  if (msg.type === 'system') {
    if (msg.content && msg.content.includes('بەخێرهات')) {
      return;
    }
    msgElem.className = 'chat-msg-item flex justify-center my-2';
    msgElem.innerHTML = `
      <div class="px-4 py-2 rounded-2xl bg-slate-900 border border-slate-700/80 text-xs text-slate-200 font-medium text-right shadow-md max-w-xl leading-relaxed whitespace-pre-line">
        ${escapeHtml(msg.content)}
      </div>
    `;
    container.appendChild(msgElem);
    if (scroll && !isUserScrolledUp) scrollToBottom();
    return;
  }

  // 1b. REVEALED SUBMISSIONS MESSAGE (SIMULTANEOUS GROUP REVEAL WITH SUPER ADMIN STAR BUTTONS)
  if (msg.type === 'revealed_submissions') {
    let payload = null;
    try {
      payload = JSON.parse(msg.content);
    } catch (e) {
      payload = null;
    }

    if (payload && payload.submissions) {
      msgElem.className = 'chat-msg-item w-full my-3';
      msgElem.setAttribute('data-question-id', payload.question_id || '');
      msgElem.setAttribute('data-question-number', payload.question_number || '');
      const subs = payload.submissions || [];
      const nonResponding = payload.non_responding || [];

      let submissionsHtml = '';
      if (subs.length === 0) {
        submissionsHtml = `
          <div class="p-3 rounded-2xl bg-slate-950/60 border border-slate-800 text-xs text-slate-400 text-center">
            هیچ قوتابییەک لە کاتی دیاریکراودا وەڵامی نەدایەوە!
          </div>
        `;
      } else {
        submissionsHtml = subs.map((s, idx) => {
          const sNameClass = getUserNameClass(s);
          const timeFormatted = s.submitted_at ? new Date(s.submitted_at).toLocaleTimeString('ku-IQ', { hour: '2-digit', minute: '2-digit' }) : '';
          return `
            <div class="p-3 rounded-2xl bg-slate-800/80 border border-slate-700/70 flex items-start justify-between gap-3 hover:border-slate-600 transition">
              <div class="flex-1">
                <div class="flex items-center gap-2 mb-1.5 flex-wrap">
                  <span class="text-xs font-mono font-bold text-slate-400">${idx + 1}.</span>
                  <span class="text-xs font-black cursor-pointer hover:underline ${sNameClass}" onclick="openUserProfileModal(${s.user_id})">${escapeHtml(s.full_name)}</span>
                  <span class="text-[10px] text-slate-500 font-mono">${timeFormatted}</span>
                </div>
                <div class="text-xs md:text-sm text-slate-100 bg-slate-900/90 p-2.5 rounded-xl border border-slate-800 font-medium whitespace-pre-wrap leading-relaxed select-text">
                  "${escapeHtml(s.answer_text)}"
                </div>
              </div>
              ${isSuperAdmin ? `
                <div class="shrink-0 mt-1">
                  ${s.is_awarded ? `
                    <span class="px-3 py-1.5 bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 font-bold text-xs rounded-xl inline-flex items-center gap-1">
                      <i class="fa-solid fa-circle-check"></i>
                      <span>پەسەندکرا ⭐</span>
                    </span>
                  ` : `
                    <button 
                      onclick="awardStarFromReveal(${payload.question_id}, ${s.user_id}, '${escapeHtml(s.full_name)}', this)" 
                      class="award-star-btn px-3 py-1.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 text-slate-950 font-black text-xs rounded-xl shadow-md transition flex items-center gap-1 active:scale-95"
                      title="پەسەندکردنی ئەم وەڵامە و پێدانی ئەستێرە (تایبەت بە سوپەر ئەدمین)"
                    >
                      <i class="fa-solid fa-star"></i>
                      <span>وەڵامی دروستە ⭐</span>
                    </button>
                  `}
                </div>
              ` : (s.is_awarded ? `
                <div class="shrink-0 mt-1">
                  <span class="px-2.5 py-1 bg-amber-500/15 border border-amber-500/30 text-amber-300 font-bold text-xs rounded-xl inline-flex items-center gap-1">
                    <i class="fa-solid fa-star text-amber-400"></i>
                    <span>وەڵامی پەسەندکراو ⭐</span>
                  </span>
                </div>
              ` : '')}
            </div>
          `;
        }).join('');
      }

      // Official Answer by Admin (Prominent Emerald Green Box at the bottom)
      let modelAnswerHtml = '';
      if (payload.model_answer && payload.model_answer.trim()) {
        modelAnswerHtml = `
          <div class="mt-3.5 p-3.5 rounded-2xl bg-emerald-950/40 border-2 border-emerald-500/70 shadow-lg text-emerald-200">
            <div class="flex items-center justify-between mb-1.5">
              <span class="text-xs font-black text-emerald-400 flex items-center gap-1.5">
                <i class="fa-solid fa-circle-check text-base text-emerald-400"></i>
                <span>وەڵامی دروستی دیاریکراوی ئەدمین (کۆتا وەڵام):</span>
              </span>
              <span class="text-[10px] bg-emerald-500/20 text-emerald-300 font-bold px-2 py-0.5 rounded-md border border-emerald-500/30">
                ڕاستیی پرسیار ✨
              </span>
            </div>
            <div class="text-xs md:text-sm font-black text-white bg-slate-900/90 p-2.5 rounded-xl border border-emerald-500/30 whitespace-pre-wrap leading-relaxed select-text">
              ${escapeHtml(payload.model_answer)}
            </div>
          </div>
        `;
      }

      // Non-responding list: HIDDEN FROM REGULAR STUDENTS, VISIBLE ONLY TO ADMINS
      let nonRespondingHtml = '';
      if (isAdmin && nonResponding.length > 0) {
        nonRespondingHtml = `
          <div class="mt-3.5 pt-3 border-t border-slate-800">
            <div class="text-xs font-black text-rose-400 mb-2 flex items-center gap-1.5">
              <i class="fa-solid fa-user-xmark"></i>
              <span>ئەو قوتابیانەی وەڵامیان نەداوەتەوە (${nonResponding.length} قوتابی - تەنها لای ئەدمین دیارە):</span>
            </div>
            <div class="flex flex-wrap gap-1.5">
              ${nonResponding.map(u => `
                <span onclick="openUserProfileModal(${u.user_id || u.id})" class="cursor-pointer px-2.5 py-1 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs font-bold ${getUserNameClass(u)} hover:bg-rose-500/20 transition">
                  ${escapeHtml(u.full_name)}
                </span>
              `).join('')}
            </div>
          </div>
        `;
      }

      msgElem.innerHTML = `
        <div class="revealed-answers-card bg-slate-900 border-2 border-indigo-500/50 rounded-3xl p-4 md:p-5 shadow-2xl relative max-w-2xl mx-auto overflow-hidden">
          <div class="flex items-center justify-between pb-3 border-b border-indigo-500/30 mb-3.5">
            <div class="flex items-center gap-2.5">
              <div class="w-9 h-9 rounded-xl bg-indigo-600/30 text-indigo-400 flex items-center justify-center text-base font-black border border-indigo-500/40">
                <i class="fa-solid fa-bullhorn"></i>
              </div>
              <div>
                <h4 class="font-black text-sm md:text-base text-white">⏰ وەڵامەکانی پرسیاری ژمارە ${payload.question_number || ''}</h4>
                <p class="text-[11px] text-indigo-300">کاتی دیاریکراو بەسەرچوو (${subs.length} قوتابی وەڵامی داوەتەوە)</p>
              </div>
            </div>
            <span class="text-[11px] text-slate-400 font-mono">${dateStr}</span>
          </div>

          <div class="bg-slate-950/70 p-3 rounded-2xl border border-slate-800 mb-3.5">
            <div class="text-[11px] text-amber-400 font-black mb-1 flex items-center gap-1">
              <i class="fa-solid fa-circle-question"></i>
              <span>دەقی پرسیاری ژمارە ${payload.question_number || ''}:</span>
            </div>
            <p class="text-sm font-black text-white leading-relaxed">
              ${escapeHtml(payload.question_text)}
            </p>
          </div>

          <div class="mb-2">
            <div class="flex items-center justify-between mb-2">
              <span class="text-xs font-black text-slate-200 flex items-center gap-1.5">
                <i class="fa-solid fa-list-check text-emerald-400"></i>
                <span>وەڵامە وەرگیراوەکانی قوتابیان:</span>
              </span>
              ${isSuperAdmin ? '<span class="text-[11px] text-amber-400 font-bold bg-amber-500/10 px-2 py-0.5 rounded-lg border border-amber-500/20">تەنها سوپەر ئەدمین دەتوانێت وەڵامی دروست دیاری بکات و ئەستێرە ببەخشێت ⭐</span>' : ''}
            </div>
            <div class="space-y-2">
              ${submissionsHtml}
            </div>
          </div>

          ${modelAnswerHtml}

          ${nonRespondingHtml}
        </div>
      `;
      container.appendChild(msgElem);
      if (scroll && !isUserScrolledUp) scrollToBottom();
      return;
    }
  }

  // 2. QUESTION MESSAGES
  if (msg.type === 'question') {
    let qData = {};
    try {
      qData = JSON.parse(msg.content);
    } catch (e) {
      qData = { question_text: msg.content, admin_name: msg.full_name, duration_minutes: 5, question_number: 1 };
    }

    msgElem.className = 'chat-msg-item w-full my-3';
    msgElem.setAttribute('data-question-id', qData.question_id || msg.id);
    msgElem.setAttribute('data-question-number', qData.question_number || '1');
    msgElem.innerHTML = `
      <div class="question-glow bg-slate-900 border border-amber-500/40 rounded-3xl p-4 md:p-5 shadow-2xl relative overflow-hidden max-w-2xl mx-auto">
        <div class="flex items-center justify-between mb-2.5 border-b border-amber-500/20 pb-2">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="px-2.5 py-0.5 rounded-xl bg-amber-500 text-slate-950 font-black text-xs flex items-center gap-1 shadow">
              <i class="fa-solid fa-circle-question"></i> پرسیاری ژمارە ${qData.question_number || 1}
            </span>
            <span class="text-xs text-amber-200 font-bold">لەلایەن: ${escapeHtml(qData.admin_name || msg.full_name)}</span>
            <span class="text-[10px] text-indigo-400 font-mono bg-indigo-500/10 px-2 py-0.5 rounded-md">@هەمووان</span>
            <span class="text-[10px] text-rose-300 font-bold bg-rose-500/15 border border-rose-500/30 px-2 py-0.5 rounded-md">
              تەوقیت: ${qData.duration_minutes || 5} خولەک
            </span>
          </div>
          <span class="text-[11px] text-slate-400 font-mono">${dateStr}</span>
        </div>

        <div class="my-2.5">
          <p class="text-sm md:text-base font-black text-white leading-relaxed">
            ${escapeHtml(qData.question_text)}
          </p>
        </div>

        <div class="mt-3 pt-2.5 border-t border-slate-800 flex items-center justify-between flex-wrap gap-2 text-xs">
          <div class="text-amber-300 flex items-center gap-1.5 font-bold">
            <i class="fa-solid fa-lock text-amber-400"></i>
            <span>وەڵامەکان بە نهێنی دەمێننەوە تا کۆتایی تەوقیت و پاشان بەیەکەوە لە گروپ بڵاودەبنەوە!</span>
          </div>
        </div>
      </div>
    `;
    container.appendChild(msgElem);
    if (scroll && !isUserScrolledUp) scrollToBottom();
    return;
  }

  // 3. REGULAR MESSAGES (TEXT, VOICE, IMAGE)
  const isMsgSuperAdmin = msg.role === 'super_admin' || (msg.username && msg.username.toLowerCase() === 'hemntjabar') || (msg.full_name && (msg.full_name.toLowerCase().includes('hemn') || msg.full_name.includes('هێمن')));
  const roleBadge = isMsgSuperAdmin ? renderRoleBadge('super_admin') : renderRoleBadge(msg.role);
  const starBadge = (msg.role === 'student' || msg.role === 'new_student') ? renderStarBadge(msg.correct_answers_count || 0) : '';
  const nameColorClass = getUserNameClass(msg);

  let attachmentHtml = '';
  if (msg.attachment_type === 'image' && msg.attachment_url) {
    attachmentHtml = `
      <div class="mt-2 rounded-xl overflow-hidden border border-slate-700 max-w-sm cursor-pointer hover:opacity-95 transition" onclick="openImageZoom('${msg.attachment_url}')">
        <img src="${msg.attachment_url}" class="w-full h-auto max-h-72 object-cover" loading="lazy">
      </div>
    `;
  } else if (msg.attachment_type === 'video' && msg.attachment_url) {
    attachmentHtml = `
      <div class="mt-2 rounded-xl overflow-hidden border border-slate-700 max-w-md bg-black">
        <video src="${msg.attachment_url}" controls playsinline class="w-full max-h-80 rounded-xl" preload="metadata"></video>
      </div>
    `;
  } else if (msg.attachment_type === 'voice' && msg.attachment_url) {
    const downloadBtnHtml = (currentUser && currentUser.role === 'super_admin') ? `
      <a href="${msg.attachment_url}" download="voice_${msg.id || Date.now()}" class="px-2 py-1 bg-slate-800/90 hover:bg-slate-700 text-amber-300 text-[10px] font-bold rounded-lg border border-slate-700 flex items-center gap-1 shrink-0 shadow-sm transition" title="داگرتنی ئەم دەنگە">
        <i class="fa-solid fa-download"></i>
      </a>
    ` : '';
    attachmentHtml = `
      <div class="mt-2 voice-bubble flex items-center gap-2">
        <button onclick="toggleAudioPlay('${msg.attachment_url}', this)" class="w-9 h-9 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center text-xs shrink-0 shadow">
          <i class="fa-solid fa-play"></i>
        </button>
        <div class="flex-1">
          <div class="text-[11px] font-bold text-slate-200">دەنگی ئەدمین</div>
          <div class="w-full bg-slate-700 h-1 rounded-full mt-1 overflow-hidden">
            <div class="bg-indigo-500 h-full w-0 audio-progress"></div>
          </div>
        </div>
        ${downloadBtnHtml}
        <audio src="${msg.attachment_url}" preload="none" onended="onAudioEnded(this)"></audio>
      </div>
    `;
  }

  msgElem.className = `chat-msg-item flex flex-col ${isMe ? 'items-end' : 'items-start'} group`;

  let messageActionsHtml = '';
  if (isAdmin && !isMe) {
    messageActionsHtml = `
      <div class="opacity-90 md:opacity-0 md:group-hover:opacity-100 transition duration-150 flex items-center gap-1 mt-1 bg-slate-800/95 border border-slate-700/80 px-2 py-0.5 rounded-xl shadow-lg">
        ${isSuperAdmin && (msg.role === 'student' || msg.role === 'new_student') ? `
          <button onclick="quickAwardStar(${msg.user_id}, '${escapeHtml(msg.full_name)}')" class="text-amber-400 hover:text-amber-300 text-xs px-1.5 py-0.5 rounded hover:bg-slate-700" title="وەڵامی دروستە ⭐ (سوپەر ئەدمین)">
            <i class="fa-solid fa-star"></i> ئەستێرە
          </button>
        ` : ''}
        ${msg.role === 'student' || msg.role === 'new_student' ? `
          <button onclick="muteUser24h(${msg.user_id}, '${escapeHtml(msg.full_name)}')" class="text-rose-400 hover:text-rose-300 text-xs px-1.5 py-0.5 rounded hover:bg-slate-700" title="سڕکردن بۆ ٢٤ سەعات">
            <i class="fa-solid fa-microphone-slash"></i> سڕکردن (24h)
          </button>
          <button onclick="unmuteUser(${msg.user_id})" class="text-emerald-400 hover:text-emerald-300 text-xs px-1.5 py-0.5 rounded hover:bg-slate-700 font-bold" title="لابردنی سڕکردن">
            <i class="fa-solid fa-microphone"></i> لابردنی سڕکردن
          </button>
        ` : ''}
        ${isSuperAdmin && (msg.role === 'student' || msg.role === 'new_student') ? `
          <button onclick="changeRole(${msg.user_id}, 'admin')" class="text-sky-400 hover:text-sky-300 text-xs px-1.5 py-0.5 rounded hover:bg-slate-700" title="بەرزکردنەوە بۆ ئەدمین">
            <i class="fa-solid fa-arrow-up"></i> بەرزکردنەوە
          </button>
        ` : ''}
        <button onclick="deleteMessage(${msg.id})" class="text-rose-400 hover:text-rose-300 text-xs px-1.5 py-0.5 rounded hover:bg-rose-950/60 flex items-center gap-1 font-bold" title="سڕینەوەی پەیام">
          <i class="fa-solid fa-trash-can"></i>
          <span class="text-[10px]">سڕینەوە</span>
        </button>
      </div>
    `;
  } else if (isMe || isAdmin) {
    messageActionsHtml = `
      <div class="opacity-90 md:opacity-0 md:group-hover:opacity-100 transition duration-150 flex items-center gap-1 mt-1 bg-slate-800/95 border border-slate-700/80 px-2 py-0.5 rounded-xl shadow-lg">
        <button onclick="deleteMessage(${msg.id})" class="text-rose-400 hover:text-rose-300 text-xs px-1.5 py-0.5 rounded hover:bg-rose-950/60 flex items-center gap-1 font-bold" title="سڕینەوەی پەیام">
          <i class="fa-solid fa-trash-can"></i>
          <span class="text-[10px]">سڕینەوە</span>
        </button>
      </div>
    `;
  }

  let msgTextClass = 'msg-text-student';
  if (isMsgSuperAdmin) {
    msgTextClass = 'msg-text-super-admin';
  } else if (msg.role === 'teacher') {
    msgTextClass = 'msg-text-teacher';
  } else if (msg.role === 'admin') {
    msgTextClass = 'msg-text-admin';
  } else {
    msgTextClass = 'msg-text-student';
  }

  let bubbleBg = '';
  if (isMsgSuperAdmin) {
    bubbleBg = isMe 
      ? 'bg-slate-900/95 border border-[#dfaa86]/60 shadow-lg shadow-[#dfaa86]/15 rounded-tl-sm' 
      : 'bg-slate-900/95 border border-[#dfaa86]/60 shadow-lg shadow-[#dfaa86]/15 rounded-tr-sm';
  } else if (isMe) {
    bubbleBg = 'bg-gradient-to-r from-indigo-600 to-indigo-700 text-white rounded-tl-sm';
  } else {
    bubbleBg = 'bg-slate-800/90 text-slate-100 border border-slate-700/60 rounded-tr-sm';
  }

  msgElem.innerHTML = `
    <div class="flex items-center gap-2 mb-1 px-1">
      <span onclick="openUserProfileModal(${msg.user_id})" class="text-xs cursor-pointer hover:underline ${nameColorClass}">${escapeHtml(msg.full_name)}</span>
      ${roleBadge}
      ${starBadge}
      <span class="text-[10px] text-slate-500 font-mono">${dateStr}</span>
    </div>

    <div class="max-w-lg md:max-w-xl rounded-2xl px-3.5 py-2 text-xs md:text-sm leading-relaxed shadow break-words ${bubbleBg}">
      ${msg.content ? `<div class="${msgTextClass}">${escapeHtml(msg.content)}</div>` : ''}
      ${attachmentHtml}
    </div>

    ${messageActionsHtml}
  `;

  container.appendChild(msgElem);
  if (scroll && !isUserScrolledUp) scrollToBottom();
}

function scrollToBottom() {
  const container = document.getElementById('messagesContainer');
  container.scrollTop = container.scrollHeight;
}

// Scroll detection & Unread jump
function handleChatScroll() {
  const container = document.getElementById('messagesContainer');
  const scrollFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
  if (scrollFromBottom > 150) {
    isUserScrolledUp = true;
  } else {
    isUserScrolledUp = false;
    hideUnreadJumpPill();
  }
}

function showUnreadJumpPill() {
  const pill = document.getElementById('unreadJumpPill');
  const countText = document.getElementById('unreadCountText');
  countText.innerText = `${unreadCount} پەیامی نوێ`;
  pill.classList.remove('hidden');
}

function hideUnreadJumpPill() {
  const pill = document.getElementById('unreadJumpPill');
  pill.classList.add('hidden');
  unreadCount = 0;
}

function jumpToNewestMessages() {
  scrollToBottom();
  hideUnreadJumpPill();
}

// Send Message with Student Link Block & Guest check
function handleSendMessage(e) {
  e.preventDefault();
  const input = document.getElementById('messageInput');
  const content = input.value.trim();
  if (!content) return;

  const isPrivileged = currentUser && (currentUser.role === 'admin' || currentUser.role === 'super_admin' || currentUser.role === 'teacher');
  if (isNightCurfewActive() && !isPrivileged) {
    alert('🌙 چات داخراوە! لە کاتژمێر ١٢ی شەو تاوەکو ٨ی بەیانی تەنها ئەدمین، مامۆستا و سوپەر ئەدمین دەتوانن پەیام بنێرن.');
    return;
  }

  if (currentUser && currentUser.role === 'guest') {
    alert('تۆ وەک میوان (چاودێر) لە گروپیت و ناتوانیت پەیام بنێریت 👁️');
    return;
  }

  if (currentUser && (currentUser.role === 'student' || currentUser.role === 'new_student') && containsLink(content)) {
    alert('❌ خوێندکار ناتوانێت بەهیچ جۆرێک بەستەر (لینک) دابنێت! تەنها ئەدمینەکان ڕێگەیان پێدراوە.');
    return;
  }

  if (socket) {
    socket.emit('send_message', { content });
    input.value = '';
    scrollToBottom();
  }
}

// --- VOICE AUDIO PLAYER HELPER ---
function toggleAudioPlay(url, btn) {
  const bubble = btn.closest('.voice-bubble');
  const audio = bubble.querySelector('audio');
  const progress = bubble.querySelector('.audio-progress');

  if (audio.paused) {
    document.querySelectorAll('audio').forEach(a => {
      if (a !== audio) {
        a.pause();
        a.currentTime = 0;
        const otherBtn = a.closest('.voice-bubble')?.querySelector('button');
        if (otherBtn) otherBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
      }
    });

    audio.play();
    btn.innerHTML = '<i class="fa-solid fa-pause"></i>';
    audio.ontimeupdate = () => {
      if (audio.duration) {
        const pct = (audio.currentTime / audio.duration) * 100;
        progress.style.width = `${pct}%`;
      }
    };
  } else {
    audio.pause();
    btn.innerHTML = '<i class="fa-solid fa-play"></i>';
  }
}

function onAudioEnded(audio) {
  const bubble = audio.closest('.voice-bubble');
  if (!bubble) return;
  const btn = bubble.querySelector('button');
  const progress = bubble.querySelector('.audio-progress');
  if (btn) btn.innerHTML = '<i class="fa-solid fa-play"></i>';
  if (progress) progress.style.width = '0%';
}

// --- VOICE RECORDING (ADMIN ONLY) ---
async function startVoiceRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.start();
    recordingSeconds = 0;
    document.getElementById('recordingTimer').innerText = '00:00';
    document.getElementById('recordingBar').classList.remove('hidden');

    recordingInterval = setInterval(() => {
      recordingSeconds++;
      const mins = Math.floor(recordingSeconds / 60);
      const secs = recordingSeconds % 60;
      document.getElementById('recordingTimer').innerText = `${pad(mins)}:${pad(secs)}`;
    }, 1000);
  } catch (err) {
    alert('تکایە ڕێگە بدە مایکرۆفۆن بەکاربهێنرێت بۆ تۆمارکردنی دەنگ');
  }
}

function cancelVoiceRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
    mediaRecorder.stream.getTracks().forEach(t => t.stop());
  }
  clearInterval(recordingInterval);
  document.getElementById('recordingBar').classList.add('hidden');
}

function stopAndSendVoiceRecording() {
  if (!mediaRecorder) return;
  
  mediaRecorder.onstop = async () => {
    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
    const formData = new FormData();
    formData.append('voice', audioBlob, 'voice.webm');
    formData.append('duration', document.getElementById('recordingTimer').innerText);

    try {
      await fetch('/api/chat/upload-voice', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });
    } catch (e) {
      alert('هەڵە لە ناردنی دەنگ');
    }
  };

  mediaRecorder.stop();
  mediaRecorder.stream.getTracks().forEach(t => t.stop());
  clearInterval(recordingInterval);
  document.getElementById('recordingBar').classList.add('hidden');
}

// --- IMAGE UPLOAD (ADMIN ONLY) ---
function triggerImagePicker() {
  document.getElementById('imageFileInput').click();
}

function handleImagePicked(e) {
  const file = e.target.files[0];
  if (!file) return;
  pendingImageFile = file;

  const previewImg = document.getElementById('imagePreviewImg');
  const previewVid = document.getElementById('videoPreviewVid');

  const reader = new FileReader();
  reader.onload = (evt) => {
    if (file.type.startsWith('video/')) {
      if (previewImg) previewImg.classList.add('hidden');
      if (previewVid) {
        previewVid.src = evt.target.result;
        previewVid.classList.remove('hidden');
      }
    } else {
      if (previewVid) {
        previewVid.classList.add('hidden');
        previewVid.src = '';
      }
      if (previewImg) {
        previewImg.src = evt.target.result;
        previewImg.classList.remove('hidden');
      }
    }
    document.getElementById('imagePreviewBar').classList.remove('hidden');
  };
  reader.readAsDataURL(file);
}

function cancelImageUpload() {
  pendingImageFile = null;
  document.getElementById('imageFileInput').value = '';
  document.getElementById('imageCaptionInput').value = '';
  const previewVid = document.getElementById('videoPreviewVid');
  if (previewVid) {
    previewVid.src = '';
    previewVid.classList.add('hidden');
  }
  const previewImg = document.getElementById('imagePreviewImg');
  if (previewImg) previewImg.classList.remove('hidden');
  document.getElementById('imagePreviewBar').classList.add('hidden');
}

async function sendPendingImage() {
  if (!pendingImageFile) return;

  const caption = document.getElementById('imageCaptionInput').value.trim();
  const formData = new FormData();
  formData.append('image', pendingImageFile);
  formData.append('caption', caption);

  const isVideo = pendingImageFile.type.startsWith('video/');

  try {
    const res = await fetch('/api/chat/upload-image', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });
    if (res.ok) {
      cancelImageUpload();
    } else {
      const data = await res.json();
      alert(data.error || (isVideo ? 'هەڵە لە ناردنی ڤیدیۆ' : 'هەڵە لە ناردنی وێنە'));
    }
  } catch (e) {
    alert('هەڵە لە پەیوەندی');
  }
}

function openImageZoom(src) {
  document.getElementById('imageZoomSrc').src = src;
  document.getElementById('imageZoomModal').classList.remove('hidden');
}

function closeImageZoom() {
  document.getElementById('imageZoomModal').classList.add('hidden');
}

// --- ACTIVE TIMED QUESTION BANNER & SECRET SUBMISSION ---
async function loadActiveQuestion() {
  try {
    const res = await fetch('/api/chat/active-question', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    activeQuestion = data.question;
    renderActiveQuestionSticky(activeQuestion);
  } catch (err) {}
}

function formatRemainingTime(remainingMs) {
  if (remainingMs <= 0) return '00:00';
  const totalSec = Math.floor(remainingMs / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  if (days > 0) {
    return `${days} ڕۆژ و ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  } else if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  } else {
    return `${pad(minutes)}:${pad(seconds)}`;
  }
}

function renderActiveQuestionSticky(q) {
  stopQuestionCountdown();

  const sticky = document.getElementById('activeQuestionSticky');
  const stickyText = document.getElementById('stickyQuestionText');
  const stickyAdmin = document.getElementById('stickyQuestionAdmin');
  const adminActions = document.getElementById('stickyAdminActions');
  const studentInputArea = document.getElementById('stickyStudentInputArea');
  const submittedNotice = document.getElementById('stickySubmittedNotice');
  const submittedText = document.getElementById('stickySubmittedText');
  const subCountBadge = document.getElementById('stickySubmissionCountBadge');
  const countdownEl = document.getElementById('stickyCountdownTime');
  const timerBadge = document.getElementById('stickyTimerBadge');

  if (!q || q.is_revealed || (q.expires_at && q.expires_at <= Date.now())) {
    sticky.classList.add('hidden');
    return;
  }

  stickyText.innerText = q.question_text;
  stickyAdmin.innerText = `لەلایەن: ${q.admin_name}`;
  subCountBadge.innerText = `${q.submission_count || 0} وەڵام تۆمارکراوە`;
  sticky.classList.remove('hidden');

  const isAdmin = currentUser && (currentUser.role === 'admin' || currentUser.role === 'super_admin' || currentUser.role === 'teacher');
  const isGuest = currentUser && currentUser.role === 'guest';

  if (isAdmin) {
    adminActions.classList.remove('hidden');
    studentInputArea.classList.add('hidden');
    submittedNotice.classList.add('hidden');
  } else if (isGuest) {
    adminActions.classList.add('hidden');
    studentInputArea.classList.add('hidden');
    submittedNotice.classList.remove('hidden');
    submittedNotice.className = 'mt-2.5 p-3 rounded-2xl bg-slate-800/80 border border-slate-700 text-xs text-slate-400 flex items-center gap-2';
    submittedNotice.innerHTML = '<i class="fa-solid fa-eye text-slate-400 text-sm"></i> <span>تۆ وەک میوان (چاودێر) داخڵبوویت و مافی وەڵامدانەوەی پرسیارت نییە 👁️</span>';
  } else {
    adminActions.classList.add('hidden');
    // If student already submitted or cached
    const cachedAns = localStorage.getItem('cached_ans_' + q.id);
    const existingSubmission = q.my_submission || cachedAns;

    if (existingSubmission) {
      studentInputArea.classList.add('hidden');
      submittedNotice.className = 'mt-2.5 p-3 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-xs text-emerald-300 flex items-center justify-between gap-2 flex-wrap';
      submittedNotice.classList.remove('hidden');
      submittedText.innerText = `"${existingSubmission}"`;
    } else if (!q.is_revealed) {
      studentInputArea.classList.remove('hidden');
      submittedNotice.classList.add('hidden');
      document.getElementById('stickySecretAnswerInput').value = '';
      const cancelBtn = document.getElementById('cancelEditAnswerBtn');
      if (cancelBtn) cancelBtn.classList.add('hidden');
      const submitBtnText = document.getElementById('submitSecretAnswerBtnText');
      if (submitBtnText) submitBtnText.innerText = 'ناردنی وەڵامی نهێنی';
    } else {
      studentInputArea.classList.add('hidden');
      submittedNotice.classList.add('hidden');
    }
  }

  // Handle countdown timer supporting days, hours, mins, secs
  if (q.expires_at && !q.is_revealed) {
    function updateTimer() {
      const remainingMs = q.expires_at - Date.now();
      if (remainingMs <= 0) {
        stopQuestionCountdown();
        sticky.classList.add('hidden');
        return;
      }
      countdownEl.innerText = formatRemainingTime(remainingMs);
    }

    updateTimer();
    questionCountdownTimer = setInterval(updateTimer, 1000);
  } else {
    countdownEl.innerText = 'بەسەرچوو';
  }
}

function stopQuestionCountdown() {
  if (questionCountdownTimer) {
    clearInterval(questionCountdownTimer);
    questionCountdownTimer = null;
  }
}

// Enable Editing Secret Answer for Student before time expires
function enableEditSecretAnswer() {
  if (!activeQuestion) return;
  const cachedAns = localStorage.getItem('cached_ans_' + activeQuestion.id);
  const currentAnswer = activeQuestion.my_submission || cachedAns || '';
  const input = document.getElementById('stickySecretAnswerInput');
  input.value = currentAnswer;

  document.getElementById('stickySubmittedNotice').classList.add('hidden');
  document.getElementById('stickyStudentInputArea').classList.remove('hidden');
  const cancelBtn = document.getElementById('cancelEditAnswerBtn');
  if (cancelBtn) cancelBtn.classList.remove('hidden');
  const submitBtnText = document.getElementById('submitSecretAnswerBtnText');
  if (submitBtnText) submitBtnText.innerText = 'نوێکردنەوەی وەڵام ✏️';

  input.focus();
  input.select();
}

function cancelEditSecretAnswer() {
  document.getElementById('stickyStudentInputArea').classList.add('hidden');
  const cancelBtn = document.getElementById('cancelEditAnswerBtn');
  if (cancelBtn) cancelBtn.classList.add('hidden');
  document.getElementById('stickySubmittedNotice').classList.remove('hidden');
  const submitBtnText = document.getElementById('submitSecretAnswerBtnText');
  if (submitBtnText) submitBtnText.innerText = 'ناردنی وەڵامی نهێنی';
}

// Student Submits or Updates Secret Answer
async function submitSecretAnswer() {
  if (!activeQuestion) return;
  if (currentUser && currentUser.role === 'guest') {
    alert('تۆ وەک میوان (چاودێر) لە گروپیت و ناتوانیت وەڵامی پرسیار بنێریت 👁️');
    return;
  }

  const input = document.getElementById('stickySecretAnswerInput');
  const answer = input.value.trim();
  if (!answer) {
    alert('تکایە دەقی وەڵامەکەت بنووسە');
    return;
  }

  // Cache locally for offline safety
  localStorage.setItem('cached_ans_' + activeQuestion.id, answer);
  activeQuestion.my_submission = answer;

  try {
    const res = await fetch('/api/chat/question/submit-secret-answer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        question_id: activeQuestion.id,
        answer_text: answer
      })
    });
    const data = await res.json();
    if (res.ok) {
      document.getElementById('stickyStudentInputArea').classList.add('hidden');
      const cancelBtn = document.getElementById('cancelEditAnswerBtn');
      if (cancelBtn) cancelBtn.classList.add('hidden');
      document.getElementById('stickySubmittedNotice').classList.remove('hidden');
      document.getElementById('stickySubmittedText').innerText = `"${answer}"`;
      const submitBtnText = document.getElementById('submitSecretAnswerBtnText');
      if (submitBtnText) submitBtnText.innerText = 'ناردنی وەڵامی نهێنی';
      triggerStarCelebration();
    } else {
      alert(data.error || 'هەڵەیەک ڕوویدا لە ناردنی وەڵام');
    }
  } catch (err) {
    // Offline submission cached
    document.getElementById('stickyStudentInputArea').classList.add('hidden');
    const cancelBtn = document.getElementById('cancelEditAnswerBtn');
    if (cancelBtn) cancelBtn.classList.add('hidden');
    document.getElementById('stickySubmittedNotice').classList.remove('hidden');
    document.getElementById('stickySubmittedText').innerText = `"${answer}" (لە دۆخی ئۆفلاین پاشەکەوت کرا)`;
  }
}

// Admin manual award star from revealed submissions card in chat
async function awardStarFromReveal(questionId, userId, studentName, btn) {
  if (!confirm(`ئایا دڵنیایت کە وەڵامەکەی (${studentName}) دروستە و ئەستێرەی پێدەدەیت؟`)) return;
  try {
    const res = await fetch('/api/chat/award-star', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        question_id: questionId,
        user_id: userId
      })
    });
    const data = await res.json();
    if (res.ok) {
      if (btn) {
        btn.disabled = true;
        btn.className = 'px-3 py-1.5 bg-emerald-600/30 text-emerald-400 border border-emerald-500/40 font-black text-xs rounded-xl flex items-center gap-1 cursor-default';
        btn.innerHTML = '<i class="fa-solid fa-circle-check"></i> <span>پەسەندکرا ⭐</span>';
      }
      triggerStarCelebration(btn);
    } else {
      alert(data.error || 'هەڵەیەک ڕوویدا');
    }
  } catch (e) {
    alert('پەیوەندی ناتەواوە');
  }
}

// Admin force reveal answers now
async function revealActiveQuestionNow() {
  if (!activeQuestion) return;
  if (!confirm('ئایا دڵنیایت لە ئاشکراکردنی هەموو وەڵامەکان لەناو گروپ لەم دەقەیەدا؟')) return;

  try {
    const res = await fetch('/api/chat/question/reveal', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ question_id: activeQuestion.id })
    });
    if (res.ok) {
      activeQuestion.is_revealed = 1;
      stopQuestionCountdown();
    }
  } catch (e) {
    alert('هەڵەیەک ڕوویدا');
  }
}

// Show active non-responding students
async function showActiveNonResponding() {
  if (!activeQuestion) return;
  const modal = document.getElementById('activeNonRespondingModal');
  const list = document.getElementById('activeNonRespondingList');
  modal.classList.remove('hidden');
  list.innerHTML = '<div class="text-center py-4 text-slate-400">بارکردن...</div>';

  try {
    const res = await fetch(`/api/chat/question/${activeQuestion.id}/non-responding`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    list.innerHTML = '';

    if (!data.non_responding || data.non_responding.length === 0) {
      list.innerHTML = '<p class="text-xs text-emerald-400 font-bold text-center py-4">دەستخۆش! هەموو قوتابییەکان وەڵامیان داوەتەوە 🎉</p>';
      return;
    }

    data.non_responding.forEach(st => {
      const nameClass = getUserNameClass(st);
      const card = document.createElement('div');
      card.className = 'p-2 rounded-xl bg-slate-800/80 border border-slate-700 flex items-center justify-between text-xs';
      card.innerHTML = `
        <div class="flex items-center gap-2">
          <span>${st.gender === 'female' ? '👧' : '👦'}</span>
          <span class="font-bold ${nameClass}">${escapeHtml(st.full_name)}</span>
        </div>
        <span class="text-rose-400 font-bold text-[11px]">وەڵامی نەداوەتەوە ❌</span>
      `;
      list.appendChild(card);
    });
  } catch (e) {
    list.innerHTML = '<p class="text-xs text-red-400 text-center py-4">هەڵەیەک ڕوویدا</p>';
  }
}

function closeActiveNonRespondingModal() {
  document.getElementById('activeNonRespondingModal').classList.add('hidden');
}

// --- UNANSWERED QUESTIONS / INACTIVE STUDENTS GLOBAL MODAL ---
async function openUnansweredStatsModal() {
  const modal = document.getElementById('unansweredStatsModal');
  const list = document.getElementById('unansweredStatsList');
  modal.classList.remove('hidden');
  list.innerHTML = '<div class="text-center py-6 text-slate-400"><i class="fa-solid fa-circle-notch fa-spin text-xl"></i> بارکردن...</div>';

  try {
    const res = await fetch('/api/chat/unanswered-stats', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    list.innerHTML = '';

    if (!data.stats || data.stats.length === 0) {
      list.innerHTML = '<p class="text-xs text-slate-500 text-center py-6">هیچ قوتابییەک تۆمار نەکراوە</p>';
      return;
    }

    data.stats.forEach(st => {
      const nameClass = getUserNameClass(st);
      const card = document.createElement('div');
      card.className = 'p-3 rounded-2xl bg-slate-800/70 border border-slate-700/60 flex items-center justify-between gap-3 flex-wrap cursor-pointer hover:bg-slate-800 transition';
      card.onclick = () => { closeUnansweredStatsModal(); openUserProfileModal(st.id); };

      card.innerHTML = `
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-slate-700 flex items-center justify-center text-sm font-bold">
            ${st.gender === 'female' ? '👧' : '👦'}
          </div>
          <div>
            <h4 class="font-bold text-sm ${nameClass}">${escapeHtml(st.full_name)}</h4>
            <p class="text-[11px] text-slate-400 font-mono">@${escapeHtml(st.username)}</p>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <span class="px-3 py-1 rounded-xl bg-rose-500/20 text-rose-300 border border-rose-500/30 text-xs font-black" title="ژمارەی ئەو پرسیارانەی وەڵامی نەداوەتەوە">
            ❌ ${st.missed_questions_count} پرسیاری وەڵام نەداوەتەوە
          </span>
          <span class="px-2.5 py-1 rounded-xl bg-slate-700 text-slate-300 text-xs font-bold" title="وەڵامدراوەکان">
            ✔️ ${st.answered_questions_count} لە کۆی ${st.total_questions}
          </span>
        </div>
      `;
      list.appendChild(card);
    });
  } catch (e) {
    list.innerHTML = '<p class="text-xs text-red-400 text-center py-4">هەڵەیەک ڕوویدا لە بارکردنی ئامارەکان</p>';
  }
}

function closeUnansweredStatsModal() {
  document.getElementById('unansweredStatsModal').classList.add('hidden');
}

async function closeCurrentQuestion() {
  if (!activeQuestion) return;
  if (!confirm('ئایا دڵنیایت لە داخستنی ئەم پرسیارە؟')) return;

  try {
    const res = await fetch('/api/chat/close-question', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ question_id: activeQuestion.id })
    });
    if (res.ok) {
      activeQuestion = null;
      renderActiveQuestionSticky(null);
    }
  } catch (err) {}
}

// --- POST QUESTION MODAL (QUICK TIME & CUSTOM DATE/TIME) ---
let questionTimeMode = 'quick';

function openPostQuestionModal() {
  document.getElementById('questionModal').classList.remove('hidden');
  document.getElementById('questionTextInput').focus();
  switchTimeMode('quick');
}

function closePostQuestionModal() {
  document.getElementById('questionModal').classList.add('hidden');
  document.getElementById('questionTextInput').value = '';
  const dtInput = document.getElementById('questionCustomDateTime');
  if (dtInput) dtInput.value = '';
  const caInput = document.getElementById('questionCorrectAnswerInput');
  if (caInput) caInput.value = '';
}

function switchTimeMode(mode) {
  questionTimeMode = mode;
  const quickBtn = document.getElementById('timeModeQuickBtn');
  const customBtn = document.getElementById('timeModeCustomBtn');
  const quickSection = document.getElementById('quickTimeSection');
  const customSection = document.getElementById('customTimeSection');

  if (!quickBtn || !customBtn) return;

  if (mode === 'quick') {
    quickBtn.className = 'py-2 text-xs font-bold rounded-xl bg-amber-500 text-slate-950 shadow flex items-center justify-center gap-1.5 transition';
    customBtn.className = 'py-2 text-xs font-bold rounded-xl bg-slate-800 text-slate-400 hover:text-white border border-slate-700 flex items-center justify-center gap-1.5 transition';
    quickSection.classList.remove('hidden');
    customSection.classList.add('hidden');
  } else {
    customBtn.className = 'py-2 text-xs font-bold rounded-xl bg-amber-500 text-slate-950 shadow flex items-center justify-center gap-1.5 transition';
    quickBtn.className = 'py-2 text-xs font-bold rounded-xl bg-slate-800 text-slate-400 hover:text-white border border-slate-700 flex items-center justify-center gap-1.5 transition';
    customSection.classList.remove('hidden');
    quickSection.classList.add('hidden');

    const dtInput = document.getElementById('questionCustomDateTime');
    if (dtInput && !dtInput.value) {
      setQuickDateTimePreset('tomorrow_19');
    }
  }
}

function setQuickDateTimePreset(preset) {
  const dtInput = document.getElementById('questionCustomDateTime');
  if (!dtInput) return;

  if (preset === 'tomorrow_19') {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(19, 0, 0, 0);
    dtInput.value = formatDateTimeLocal(d);
  } else if (preset === 'today_20') {
    const d = new Date();
    if (d.getHours() >= 20) {
      d.setDate(d.getDate() + 1);
    }
    d.setHours(20, 0, 0, 0);
    dtInput.value = formatDateTimeLocal(d);
  } else if (preset === 'tomorrow_10') {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(10, 0, 0, 0);
    dtInput.value = formatDateTimeLocal(d);
  } else if (preset === 'plus_24h') {
    const d = new Date(Date.now() + (24 * 60 * 60 * 1000));
    dtInput.value = formatDateTimeLocal(d);
  }
}

function formatDateTimeLocal(date) {
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  return `${y}-${m}-${d}T${hh}:${mm}`;
}

async function handlePostQuestion(e) {
  e.preventDefault();
  const text = document.getElementById('questionTextInput').value.trim();
  if (!text) return;

  const payload = {
    question_text: text
  };

  const caInput = document.getElementById('questionCorrectAnswerInput');
  if (caInput && caInput.value.trim()) {
    payload.correct_answer = caInput.value.trim();
  }

  if (questionTimeMode === 'custom') {
    const dtVal = document.getElementById('questionCustomDateTime').value;
    if (!dtVal) {
      alert('تکایە بەروار و کاتی تەواوبوونی پرسیار دیاری بکە');
      return;
    }
    const chosenTime = new Date(dtVal).getTime();
    if (isNaN(chosenTime) || chosenTime <= Date.now()) {
      alert('تکایە بەروار و کاتێکی داهاتوو دیاری بکە کە لە کاتی ئێستا درەنگتر بێت');
      return;
    }
    payload.custom_expires_at = chosenTime;
  } else {
    payload.duration_minutes = document.getElementById('questionDurationSelect').value;
  }

  try {
    const res = await fetch('/api/chat/question', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      closePostQuestionModal();
    } else {
      const data = await res.json();
      alert(data.error || 'هەڵە لە دانانی پرسیار');
    }
  } catch (err) {
    alert('پەیوەندی لەگەڵ سێرڤەر ناتەواوە');
  }
}

// --- AWARD STAR & MUTE ACTIONS ---
async function quickAwardStar(userId, studentName) {
  if (!confirm(`ئایا دڵنیایت لە بەخشینی ئەستێرە بە (${studentName}) بۆ وەڵامەکەی؟`)) return;

  try {
    const res = await fetch('/api/chat/award-star', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        user_id: userId,
        question_id: activeQuestion ? activeQuestion.id : null
      })
    });
    const data = await res.json();
    if (res.ok) {
      triggerStarCelebration();
    } else {
      alert(data.error || 'هەڵە ڕوویدا');
    }
  } catch (err) {
    alert('پەیوەندی ناتەواوە');
  }
}

async function muteUser24h(userId, studentName) {
  if (!confirm(`ئایا دڵنیایت لە سڕکردنی خوێندکار (${studentName}) بۆ ماوەی ٢٤ کاتژمێر؟`)) return;

  try {
    const res = await fetch('/api/admin/mute', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ user_id: userId, hours: 24 })
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'هەڵەیەک ڕوویدا');
    } else {
      loadAllMembers();
      if (document.getElementById('adminModal') && !document.getElementById('adminModal').classList.contains('hidden')) {
        loadAllUsersList();
      }
    }
  } catch (err) {
    alert('پەیوەندی ناتەواوە');
  }
}

async function unmuteUser(userId) {
  if (!confirm('ئایا دڵنیایت لە لابردنی سڕکردنی ئەم خوێندکارە؟')) return;

  try {
    const res = await fetch('/api/admin/unmute', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ user_id: userId })
    });
    if (res.ok) {
      loadAllMembers();
      if (document.getElementById('adminModal') && !document.getElementById('adminModal').classList.contains('hidden')) {
        loadAllUsersList();
      }
    }
  } catch (err) {}
}

async function deleteMessage(msgId) {
  if (!confirm('ئایا دڵنیایت لە سڕینەوەی ئەم پەیامە؟')) return;
  try {
    await fetch(`/api/chat/messages/${msgId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
  } catch (err) {}
}

// --- NIGHT CURFEW LOGIC (12:00 AM - 08:00 AM IRAQ TIME) ---
function isNightCurfewActive() {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Baghdad',
      hour: 'numeric',
      hourCycle: 'h23'
    });
    const hour = parseInt(formatter.format(new Date()), 10);
    return hour >= 0 && hour < 8;
  } catch (e) {
    const utcHours = new Date().getUTCHours();
    const iraqHour = (utcHours + 3) % 24;
    return iraqHour >= 0 && iraqHour < 8;
  }
}

function checkNightCurfewState() {
  const curfewBanner = document.getElementById('nightCurfewBanner');
  const messageInput = document.getElementById('messageInput');
  const sendBtn = document.getElementById('sendBtn');
  if (!curfewBanner || !messageInput || !sendBtn) return;

  const isPrivileged = currentUser && (currentUser.role === 'admin' || currentUser.role === 'super_admin' || currentUser.role === 'teacher');
  const isNight = isNightCurfewActive();
  const isMuted = currentUser && currentUser.muted_until && currentUser.muted_until > Date.now();

  if (isNight && !isPrivileged) {
    curfewBanner.classList.remove('hidden');
    if (!isMuted) {
      messageInput.disabled = true;
      sendBtn.disabled = true;
      sendBtn.classList.add('opacity-50', 'cursor-not-allowed');
      messageInput.placeholder = "🌙 چات داخراوە (١٢ی شەو تا ٨ی بەیانی تەنها بۆ ئەدمین و مامۆستایان کراوەیە)";
    }
  } else {
    curfewBanner.classList.add('hidden');
    if (!isMuted && currentUser && currentUser.role !== 'guest') {
      messageInput.disabled = false;
      sendBtn.disabled = false;
      sendBtn.classList.remove('opacity-50', 'cursor-not-allowed');
      messageInput.placeholder = "پەیامەکەت بنووسە...";
    }
  }
}

setInterval(checkNightCurfewState, 30000);

// --- MUTE COUNTDOWN LOGIC ---
function checkMuteState() {
  if (muteCountdownTimer) {
    clearInterval(muteCountdownTimer);
    muteCountdownTimer = null;
  }

  const banner = document.getElementById('mutedBanner');
  const messageInput = document.getElementById('messageInput');
  const sendBtn = document.getElementById('sendBtn');
  const countdownEl = document.getElementById('muteTimerCountdown');

  if (!currentUser || !currentUser.muted_until || currentUser.muted_until <= Date.now()) {
    banner.classList.add('hidden');
    checkNightCurfewState();
    return;
  }

  banner.classList.remove('hidden');
  messageInput.disabled = true;
  sendBtn.disabled = true;
  messageInput.placeholder = "⚠️ تۆ سڕکراویت و ناتوانیت پەیام بنێریت تا کۆتایی ٢٤ کاتژمێر";

  function updateCountdown() {
    const remainingMs = currentUser.muted_until - Date.now();
    if (remainingMs <= 0) {
      clearInterval(muteCountdownTimer);
      currentUser.muted_until = 0;
      checkMuteState();
      return;
    }
    const totalSeconds = Math.floor(remainingMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    countdownEl.innerText = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }

  updateCountdown();
  muteCountdownTimer = setInterval(updateCountdown, 1000);
}

function pad(num) {
  return String(num).padStart(2, '0');
}

// --- IN-CHAT MEMBERS LIST & SIDEBAR ---
function toggleMembersSidebar() {
  const isPrivileged = currentUser && (currentUser.role === 'admin' || currentUser.role === 'super_admin' || currentUser.role === 'teacher');
  if (!isPrivileged) return;

  const sidebar = document.getElementById('membersSidebar');
  const backdrop = document.getElementById('membersBackdrop');
  if (!sidebar) return;

  if (window.innerWidth < 768) {
    const isClosed = sidebar.classList.contains('translate-x-full');
    if (isClosed) {
      sidebar.classList.remove('translate-x-full');
      sidebar.classList.add('translate-x-0');
      if (backdrop) backdrop.classList.remove('hidden');
    } else {
      closeMembersSidebar();
    }
  } else {
    sidebar.classList.toggle('hidden');
    sidebar.classList.toggle('flex');
  }
}

function closeMembersSidebar() {
  const sidebar = document.getElementById('membersSidebar');
  const backdrop = document.getElementById('membersBackdrop');
  if (sidebar && window.innerWidth < 768) {
    sidebar.classList.add('translate-x-full');
    sidebar.classList.remove('translate-x-0');
  }
  if (backdrop) backdrop.classList.add('hidden');
}

function filterMembersList(filter) {
  memberFilter = filter;
  document.getElementById('tabMemberAll').className = filter === 'all' ? 'flex-1 py-1 font-bold rounded-lg bg-indigo-600 text-white' : 'flex-1 py-1 font-bold rounded-lg text-slate-400 hover:text-white';
  document.getElementById('tabMemberStudents').className = filter === 'student' ? 'flex-1 py-1 font-bold rounded-lg bg-indigo-600 text-white' : 'flex-1 py-1 font-bold rounded-lg text-slate-400 hover:text-white';
  document.getElementById('tabMemberAdmins').className = filter === 'admin' ? 'flex-1 py-1 font-bold rounded-lg bg-indigo-600 text-white' : 'flex-1 py-1 font-bold rounded-lg text-slate-400 hover:text-white';
  renderMembersList();
}

async function loadAllMembers() {
  try {
    const res = await fetch('/api/admin/users', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return;
    const data = await res.json();
    allMembersCache = data.users || [];
    renderMembersList();
  } catch (err) {}
}

function renderMembersList() {
  const container = document.getElementById('membersListContainer');
  const countBadge = document.getElementById('membersSidebarCount');
  container.innerHTML = '';

  const isSuperAdmin = currentUser && currentUser.role === 'super_admin';
  const isPrivileged = currentUser && (currentUser.role === 'admin' || currentUser.role === 'super_admin' || currentUser.role === 'teacher');

  let filtered = allMembersCache.filter(u => u.status === 'approved');
  if (memberFilter === 'student') filtered = filtered.filter(u => u.role === 'student');
  if (memberFilter === 'admin') filtered = filtered.filter(u => u.role === 'admin' || u.role === 'super_admin' || u.role === 'teacher');

  countBadge.innerText = filtered.length;

  filtered.forEach(u => {
    const isMe = currentUser && u.id === currentUser.id;
    const nameClass = getUserNameClass(u);
    const starBadge = u.role === 'student' ? renderStarBadge(u.correct_answers_count) : '';
    const roleBadge = renderRoleBadge(u.role);
    const isMuted = u.muted_until && u.muted_until > Date.now();

    const card = document.createElement('div');
    card.className = `p-2 rounded-xl bg-slate-800/60 hover:bg-slate-800 border ${isMuted ? 'border-rose-500/40 bg-rose-950/20' : 'border-slate-700/50'} flex items-center justify-between gap-1.5 transition`;

    let actionBtn = '';
    if (isSuperAdmin && !isMe) {
      if (u.role === 'student') {
        actionBtn = `
          <button onclick="changeRole(${u.id}, 'admin')" class="px-2 py-1 bg-indigo-600/30 hover:bg-indigo-600 text-indigo-300 hover:text-white rounded-lg text-[10px] font-bold transition flex items-center gap-1 shrink-0" title="بەرزکردنەوە بۆ ئەدمین">
            <i class="fa-solid fa-arrow-up text-[9px]"></i> ئەدمین
          </button>
        `;
      } else if (u.role === 'admin') {
        actionBtn = `
          <button onclick="changeRole(${u.id}, 'student')" class="px-2 py-1 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg text-[10px] font-bold transition shrink-0" title="دابەزاندن بۆ قوتابی">
            <i class="fa-solid fa-arrow-down text-[9px]"></i> قوتابی
          </button>
        `;
      }
    }

    let muteBtn = '';
    if (isPrivileged && !isMe && (u.role === 'student' || u.role === 'new_student')) {
      if (isMuted) {
        muteBtn = `
          <button onclick="unmuteUser(${u.id})" class="px-2 py-1 bg-emerald-600/30 hover:bg-emerald-600 text-emerald-300 hover:text-white rounded-lg text-[10px] font-bold transition flex items-center gap-1 shrink-0" title="لابردنی سڕکردنی ئەم قوتابیە">
            <i class="fa-solid fa-microphone text-[9px]"></i> لابردنی سڕکردن
          </button>
        `;
      } else {
        muteBtn = `
          <button onclick="muteUser24h(${u.id}, '${escapeHtml(u.full_name)}')" class="px-2 py-1 bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white rounded-lg text-[10px] font-bold transition flex items-center gap-1 shrink-0" title="سڕکردن بۆ ٢٤ کاتژمێر">
            <i class="fa-solid fa-microphone-slash text-[9px]"></i> سڕکردن
          </button>
        `;
      }
    }

    card.innerHTML = `
      <div class="flex items-center gap-2 overflow-hidden flex-1 cursor-pointer" onclick="openUserProfileModal(${u.id})">
        <div class="w-8 h-8 rounded-lg bg-slate-700/80 flex items-center justify-center text-xs font-black text-slate-300 shrink-0">
          ${u.gender === 'female' ? '👧' : '👦'}
        </div>
        <div class="overflow-hidden">
          <div class="text-xs truncate flex items-center gap-1 font-bold">
            <span class="${nameClass}">${escapeHtml(u.full_name)}</span>
            ${isMe ? '<span class="text-[9px] text-indigo-400 font-normal">(تۆ)</span>' : ''}
            ${isMuted ? '<span class="text-[9px] bg-rose-500/20 text-rose-300 px-1 py-0.2 rounded border border-rose-500/30 font-bold shrink-0">🔇 سڕکراوە</span>' : ''}
          </div>
          <div class="flex items-center gap-1 mt-0.5">
            ${roleBadge}
          </div>
        </div>
      </div>

      <div class="flex items-center gap-1 shrink-0">
        ${starBadge}
        ${muteBtn}
        <button onclick="openUserProfileModal(${u.id})" class="p-1 text-slate-400 hover:text-indigo-400 text-xs" title="زانیاری دەربارەی کەسەکە">
          <i class="fa-solid fa-circle-info"></i>
        </button>
        ${actionBtn}
      </div>
    `;

    container.appendChild(card);
  });
}

// --- USER PROFILE & DETAILS MODAL ---
function openMyProfile() {
  if (currentUser) openUserProfileModal(currentUser.id);
}

async function openUserProfileModal(userId) {
  const modal = document.getElementById('userProfileModal');
  modal.classList.remove('hidden');

  const fullNameEl = document.getElementById('profFullName');
  const usernameEl = document.getElementById('profUsername');
  const genderEl = document.getElementById('profGenderBadge');
  const roleEl = document.getElementById('profRoleBadge');
  const starsEl = document.getElementById('profStars');
  const promoCountEl = document.getElementById('profPromotionsCount');
  const historyList = document.getElementById('profRoleHistoryList');
  const solvedList = document.getElementById('profSolvedQuestionsList');
  const superAdminActions = document.getElementById('profSuperAdminActions');
  const actionSlot = document.getElementById('profActionButtonsSlot');

  fullNameEl.innerText = 'چاوەڕێبە...';
  historyList.innerHTML = '<span class="text-slate-500">بارکردن...</span>';
  solvedList.innerHTML = '<span class="text-slate-500">بارکردن...</span>';

  try {
    const res = await fetch(`/api/users/${userId}/profile`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return;
    const data = await res.json();
    const prof = data.profile;

    fullNameEl.innerText = prof.full_name;
    fullNameEl.className = `font-black text-base ${getUserNameClass(prof)}`;
    usernameEl.innerText = `@${prof.username}`;
    genderEl.innerHTML = prof.gender === 'female' ? '<span class="text-pink-400 font-bold">👧 کچ</span>' : '<span class="text-sky-400 font-bold">👦 کوڕ</span>';
    roleEl.innerHTML = renderRoleBadge(prof.role);
    starsEl.innerHTML = `${prof.starInfo.starIcons} (${prof.starInfo.points}/10)`;
    promoCountEl.innerText = `${prof.promotionsCount} جار`;

    historyList.innerHTML = '';
    if (!prof.roleHistory || prof.roleHistory.length === 0) {
      historyList.innerHTML = '<p class="text-slate-500 italic">هێشتا هیچ پلەیەکی پێنەدراوە</p>';
    } else {
      prof.roleHistory.forEach((h, idx) => {
        const item = document.createElement('div');
        item.className = 'p-2.5 rounded-xl bg-slate-800/80 border border-slate-700/60 flex items-center justify-between';
        const d = new Date(h.created_at).toLocaleDateString('ku-IQ') + ' ' + new Date(h.created_at).toLocaleTimeString('ku-IQ', { hour: '2-digit', minute: '2-digit' });
        const oldR = h.old_role === 'student' ? 'قوتابی' : 'ئەدمین';
        const newR = h.new_role === 'admin' ? 'ئەدمین 🛡️' : 'قوتابی 🎓';

        item.innerHTML = `
          <div>
            <div class="font-bold text-white">پلەی گۆڕدرا بۆ: <span class="text-emerald-400">${newR}</span></div>
            <div class="text-[11px] text-slate-400">لەلایەن: <b>${escapeHtml(h.changed_by_name)}</b> (پێشتر: ${oldR})</div>
          </div>
          <span class="text-[10px] text-slate-500 font-mono">${d}</span>
        `;
        historyList.appendChild(item);
      });
    }

    solvedList.innerHTML = '';
    if (!prof.answeredQuestions || prof.answeredQuestions.length === 0) {
      solvedList.innerHTML = '<p class="text-slate-500 italic">هێشتا هیچ پرسیارێکی نەزانیوە</p>';
    } else {
      prof.answeredQuestions.forEach((q, idx) => {
        const item = document.createElement('div');
        item.className = 'p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between';
        const d = new Date(q.awarded_at).toLocaleDateString('ku-IQ') + ' ' + new Date(q.awarded_at).toLocaleTimeString('ku-IQ', { hour: '2-digit', minute: '2-digit' });

        item.innerHTML = `
          <div>
            <div class="font-bold text-amber-200">پرسیاری ژمارە #${q.question_id || (idx + 1)}</div>
            <div class="text-xs text-white line-clamp-1">${escapeHtml(q.question_text || 'پرسیاری دەستی')}</div>
          </div>
          <span class="text-[10px] text-amber-400 font-mono shrink-0 mr-2">${d} ⭐</span>
        `;
        solvedList.appendChild(item);
      });
    }

    const isSuperAdmin = currentUser && currentUser.role === 'super_admin';
    const isPrivileged = currentUser && (currentUser.role === 'admin' || currentUser.role === 'super_admin' || currentUser.role === 'teacher');
    const isMe = currentUser && currentUser.id === prof.id;
    const isMuted = prof.muted_until && prof.muted_until > Date.now();

    if (isPrivileged && !isMe) {
      superAdminActions.classList.remove('hidden');
      let roleChangeHtml = '';
      if (isSuperAdmin) {
        roleChangeHtml = `
          <div class="flex items-center gap-1.5">
            <span class="text-[11px] text-slate-400 font-bold">پلە:</span>
            <select onchange="changeRole(${prof.id}, this.value); closeUserProfileModal();" class="bg-slate-900 border border-slate-700 text-xs text-white rounded-xl px-2.5 py-1.5 focus:outline-none focus:border-indigo-500 font-bold">
              <option value="student" ${prof.role === 'student' ? 'selected' : ''}>🎓 قوتابی</option>
              <option value="teacher" ${prof.role === 'teacher' ? 'selected' : ''}>👨‍🏫 مامۆستا</option>
              <option value="new_student" ${prof.role === 'new_student' ? 'selected' : ''}>🔰 قوتابی تازە</option>
              <option value="guest" ${prof.role === 'guest' ? 'selected' : ''}>👁️ میوان (چاودێر)</option>
              <option value="admin" ${prof.role === 'admin' ? 'selected' : ''}>🛡️ ئەدمین</option>
            </select>
          </div>
        `;
      }

      let muteActionHtml = '';
      if (prof.role === 'student' || prof.role === 'new_student') {
        if (isMuted) {
          muteActionHtml = `
            <button onclick="unmuteUser(${prof.id}); closeUserProfileModal();" class="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition flex items-center gap-1 shadow">
              <i class="fa-solid fa-microphone"></i> لابردنی سڕکردن
            </button>
          `;
        } else {
          muteActionHtml = `
            <button onclick="muteUser24h(${prof.id}, '${escapeHtml(prof.full_name)}'); closeUserProfileModal();" class="px-2.5 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold transition flex items-center gap-1 shadow">
              <i class="fa-solid fa-microphone-slash"></i> سڕکردن (24h)
            </button>
          `;
        }
      }

      let deleteActionHtml = '';
      if (isSuperAdmin && prof.role !== 'super_admin') {
        deleteActionHtml = `
          <button onclick="deleteUserAccount(${prof.id}, '${escapeHtml(prof.full_name)}')" class="px-2.5 py-1.5 bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/40 rounded-xl text-xs font-bold transition flex items-center gap-1 shadow active:scale-95" title="سڕینەوەی بنبڕی ئەم ئەکاونتە لە سیستەم">
            <i class="fa-solid fa-trash-can"></i> سڕینەوەی ئەکاونت
          </button>
        `;
      }

      actionSlot.innerHTML = `${roleChangeHtml} ${muteActionHtml} ${deleteActionHtml}`;
    } else {
      superAdminActions.classList.add('hidden');
    }

  } catch (err) {
    fullNameEl.innerText = 'هەڵەیەک ڕوویدا';
  }
}

function closeUserProfileModal() {
  document.getElementById('userProfileModal').classList.add('hidden');
}

async function deleteUserAccount(userId, fullName) {
  if (!confirm(`ئایا دڵنیایت لە سڕینەوەی بنبڕی ئەکاونتی (${fullName}) و دەرکردنی لە پلاتفۆرم؟\nئەم کارە ناگەڕێتەوە و هەموو داتاکانی بە یەکجاری دەسڕدرێنەوە!`)) {
    return;
  }

  try {
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (res.ok && data.success) {
      alert(data.message || 'ئەکاونتەکە بە سەرکەوتوویی سڕایەوە');
      closeUserProfileModal();
      loadAllMembers();
      if (typeof loadAllUsersList === 'function') loadAllUsersList();
    } else {
      alert(data.error || 'هەڵە لە سڕینەوەی ئەکاونت');
    }
  } catch (err) {
    alert('شکستی هێنا لە پەیوەندی کردن بە سێرڤەر');
  }
}

async function changeRole(userId, newRole) {
  let roleName = 'قوتابی';
  if (newRole === 'admin') roleName = 'ئەدمین';
  if (newRole === 'new_student') roleName = 'قوتابی تازە 🔰';
  if (newRole === 'guest') roleName = 'میوان 👁️';

  if (!confirm(`ئایا دڵنیایت لە گۆڕینی پلەی ئەم بەکارهێنەرە بۆ (${roleName})؟`)) {
    loadAllMembers();
    loadAllUsersList();
    return;
  }

  try {
    const res = await fetch('/api/admin/role', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ user_id: userId, role: newRole })
    });
    if (res.ok) {
      loadAllMembers();
      loadAllUsersList();
    }
  } catch (err) {
    alert('هەڵەیەک ڕوویدا');
  }
}

// --- SUPER ADMIN MANAGEMENT MODAL ---
function openAdminModal() {
  localStorage.setItem('seereen_last_pending_visit', Date.now().toString());
  const navBadge = document.getElementById('pendingBadgeCount');
  const mobileNavBadge = document.getElementById('mobilePendingBadgeCount');
  if (navBadge) navBadge.classList.add('hidden');
  if (mobileNavBadge) mobileNavBadge.classList.add('hidden');

  document.getElementById('adminModal').classList.remove('hidden');
  switchAdminSubTab(currentAdminSubTab);
}

function closeAdminModal() {
  document.getElementById('adminModal').classList.add('hidden');
}

function switchAdminSubTab(tab) {
  currentAdminSubTab = tab;
  const tabPending = document.getElementById('adminTabPending');
  const tabUsers = document.getElementById('adminTabUsers');
  const tabPasswordResets = document.getElementById('adminTabPasswordResets');
  const tabBackups = document.getElementById('adminTabBackups');
  const contentPending = document.getElementById('adminContentPending');
  const contentUsers = document.getElementById('adminContentUsers');
  const contentPasswordResets = document.getElementById('adminContentPasswordResets');
  const contentBackups = document.getElementById('adminContentBackups');

  // Reset all tabs to inactive styling
  [tabPending, tabUsers, tabPasswordResets, tabBackups].forEach(t => {
    if (t) t.className = 'pb-3 text-sm font-bold border-b-2 border-transparent text-slate-400 hover:text-slate-200 flex items-center gap-2';
  });
  // Hide all panels
  [contentPending, contentUsers, contentPasswordResets, contentBackups].forEach(c => {
    if (c) c.classList.add('hidden');
  });

  if (tab === 'pending') {
    if (tabPending) tabPending.className = 'pb-3 text-sm font-bold border-b-2 border-[#dfaa86] text-[#dfaa86] flex items-center gap-2';
    if (contentPending) contentPending.classList.remove('hidden');
    loadPendingUsersList();
  } else if (tab === 'users') {
    if (tabUsers) tabUsers.className = 'pb-3 text-sm font-bold border-b-2 border-[#dfaa86] text-[#dfaa86] flex items-center gap-2';
    if (contentUsers) contentUsers.classList.remove('hidden');
    loadAllUsersList();
  } else if (tab === 'password_resets') {
    if (tabPasswordResets) tabPasswordResets.className = 'pb-3 text-sm font-bold border-b-2 border-[#dfaa86] text-[#dfaa86] flex items-center gap-2';
    if (contentPasswordResets) contentPasswordResets.classList.remove('hidden');
    loadPasswordResetsList();
  } else if (tab === 'backups') {
    if (tabBackups) tabBackups.className = 'pb-3 text-sm font-bold border-b-2 border-[#dfaa86] text-[#dfaa86] flex items-center gap-2';
    if (contentBackups) contentBackups.classList.remove('hidden');
    loadAdminBackupsList();
  }
}

// --- ADMIN PASSWORD RESET REQUESTS ---
async function loadPasswordResetsList() {
  const container = document.getElementById('passwordResetsList');
  const emptyMsg = document.getElementById('passwordResetsEmptyMessage');
  const badge = document.getElementById('adminPasswordResetsBadge');
  if (!container) return;

  container.innerHTML = `<div class="text-center py-6 text-slate-400"><i class="fa-solid fa-circle-notch fa-spin text-lg"></i> لە بارکردندایە...</div>`;
  if (emptyMsg) emptyMsg.classList.add('hidden');

  try {
    const res = await fetch('/api/admin/password-resets', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('Failed to fetch');
    const data = await res.json();
    container.innerHTML = '';

    const list = data.requests || [];
    if (badge) {
      badge.innerText = list.length;
      if (list.length > 0) badge.classList.remove('hidden');
      else badge.classList.add('hidden');
    }

    if (list.length === 0) {
      if (emptyMsg) emptyMsg.classList.remove('hidden');
      return;
    }

    list.forEach(req => {
      const timeStr = new Date(req.created_at).toLocaleString('ku-IQ');
      const item = document.createElement('div');
      item.className = 'p-4 rounded-2xl bg-slate-800/80 border border-slate-700/80 flex items-center justify-between gap-3 flex-wrap hover:border-slate-600 transition';
      item.innerHTML = `
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center font-bold text-base">
            <i class="fa-solid fa-key"></i>
          </div>
          <div>
            <div class="flex items-center gap-2 flex-wrap">
              <h4 class="font-bold text-sm text-white">${escapeHtml(req.full_name)}</h4>
              ${renderRoleBadge(req.role)}
              <span class="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                داواکاری وشەی نهێنی نوێ
              </span>
            </div>
            <div class="text-xs text-slate-400 font-mono mt-0.5">
              <span>@${escapeHtml(req.username)}</span> • <span>${timeStr}</span>
            </div>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <button onclick="approvePasswordReset(${req.id}, '${escapeHtml(req.full_name)}')" class="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 shadow transition active:scale-95">
            <i class="fa-solid fa-check"></i>
            <span>پەسەندکردنی وشەی نوێ</span>
          </button>
          <button onclick="rejectPasswordReset(${req.id})" class="px-3 py-1.5 rounded-xl bg-rose-950/60 hover:bg-rose-900 border border-rose-500/30 text-rose-300 font-bold text-xs flex items-center gap-1.5 transition active:scale-95">
            <i class="fa-solid fa-xmark"></i>
            <span>ڕەتکردنەوە</span>
          </button>
        </div>
      `;
      container.appendChild(item);
    });
  } catch (err) {
    container.innerHTML = `<div class="text-rose-400 text-xs text-center py-4">هەڵەیەک ڕوویدا لە بارکردنی داواکارییەکان</div>`;
  }
}

async function approvePasswordReset(requestId, fullName) {
  if (!confirm(`ئایا دڵنیایت لە پەسەندکردنی وشەی نهێنی نوێ بۆ بەکارهێنەر (${fullName})؟\nدوای ئەمە دەتوانێت بە وشەی نهێنی نوێ بچێتە ژوورەوە.`)) {
    return;
  }

  try {
    const res = await fetch(`/api/admin/password-resets/${requestId}/approve`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (res.ok && data.success) {
      alert(data.message || 'وشەی نهێنی بە سەرکەوتوویی نوێکرایەوە');
      loadPasswordResetsList();
      checkPendingCount();
    } else {
      alert(data.error || 'هەڵە لە پەسەندکردن');
    }
  } catch (err) {
    alert('شکستی هێنا لە پەیوەندی کردن بە سێرڤەر');
  }
}

async function rejectPasswordReset(requestId) {
  if (!confirm('ئایا دڵنیایت لە ڕەتکردنەوەی ئەم داواکارییە؟')) return;

  try {
    const res = await fetch(`/api/admin/password-resets/${requestId}/reject`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (res.ok && data.success) {
      alert(data.message || 'داواکاری ڕەتکرایەوە');
      loadPasswordResetsList();
      checkPendingCount();
    } else {
      alert(data.error || 'هەڵە لە ڕەتکردنەوە');
    }
  } catch (err) {
    alert('شکستی هێنا لە پەیوەندی کردن بە سێرڤەر');
  }
}

// --- ADMIN DATABASE BACKUPS ---
async function loadAdminBackupsList() {
  const container = document.getElementById('adminBackupsList');
  if (!container) return;
  container.innerHTML = `<div class="text-center py-6 text-slate-400"><i class="fa-solid fa-circle-notch fa-spin text-lg"></i> لە بارکردندایە...</div>`;

  try {
    const res = await fetch('/api/admin/backups', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('Failed to fetch');
    const data = await res.json();
    container.innerHTML = '';

    if (!data.backups || data.backups.length === 0) {
      container.innerHTML = `
        <div class="text-center py-6 text-slate-500 text-xs">
          هیچ کۆپییەکی یەدەگ نەدۆزرایەوە. دەتوانیت ئێستا کۆپییەکی نوێ دروست بکەیت.
        </div>
      `;
      return;
    }

    data.backups.forEach(b => {
      const isAuto = b.filename.startsWith('auto-');
      const sizeKb = (b.size / 1024).toFixed(1);
      const timeStr = new Date(b.created_at).toLocaleString('ku-IQ');

      const item = document.createElement('div');
      item.className = 'p-3 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between gap-3 hover:border-slate-700 transition';
      item.innerHTML = `
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-xl ${isAuto ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/30' : 'bg-amber-600/20 text-amber-400 border border-amber-500/30'} flex items-center justify-center text-sm font-bold">
            <i class="fa-solid ${isAuto ? 'fa-clock' : 'fa-hand'}"></i>
          </div>
          <div>
            <div class="flex items-center gap-2">
              <span class="text-xs font-bold text-white font-mono">${escapeHtml(b.filename)}</span>
              <span class="text-[10px] font-bold px-1.5 py-0.5 rounded ${isAuto ? 'bg-indigo-500/20 text-indigo-300' : 'bg-amber-500/20 text-amber-300'}">
                ${isAuto ? 'ئۆتۆماتیک' : 'دەستی'}
              </span>
            </div>
            <div class="text-[11px] text-slate-400 font-mono mt-0.5">
              <span>${timeStr}</span> • <span class="text-[#dfaa86]">${sizeKb} KB</span>
            </div>
          </div>
        </div>
        <a href="/api/admin/backups/download?file=${encodeURIComponent(b.filename)}" download class="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-[#dfaa86] text-xs font-bold flex items-center gap-1 border border-slate-700 transition shadow">
          <i class="fa-solid fa-download"></i>
          <span>داگرتن</span>
        </a>
      `;
      container.appendChild(item);
    });
  } catch (err) {
    container.innerHTML = `<div class="text-rose-400 text-xs text-center py-4">هەڵەیەک ڕوویدا لە بارکردنی کۆپییەکان</div>`;
  }
}

async function createManualBackup() {
  try {
    const res = await fetch('/api/admin/backups/create', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (res.ok && data.success) {
      alert('کۆپییەکی یەدەگی نوێ بە سەرکەوتوویی دروستکرا! ✨');
      loadAdminBackupsList();
    } else {
      alert(data.error || 'هەڵە لە دروستکردنی باکئەپ');
    }
  } catch (err) {
    alert('شکستی هێنا لە پەیوەندی کردن بە سێرڤەر');
  }
}

async function checkPendingCount() {
  try {
    const res = await fetch('/api/admin/pending', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return;
    const data = await res.json();
    const pendingList = data.pending || [];
    const count = pendingList.length;

    const navBadge = document.getElementById('pendingBadgeCount');
    const mobileNavBadge = document.getElementById('mobilePendingBadgeCount');
    const modalBadge = document.getElementById('adminPendingBadge');

    if (modalBadge) modalBadge.innerText = count;

    // Check password resets count
    let resetCount = 0;
    try {
      const resetRes = await fetch('/api/admin/password-resets', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (resetRes.ok) {
        const resetData = await resetRes.json();
        const resetList = resetData.requests || [];
        resetCount = resetList.length;
        const resetBadge = document.getElementById('adminPasswordResetsBadge');
        if (resetBadge) {
          resetBadge.innerText = resetCount;
          if (resetCount > 0) resetBadge.classList.remove('hidden');
          else resetBadge.classList.add('hidden');
        }
      }
    } catch (e) {}

    const totalAlerts = count + resetCount;
    const adminModal = document.getElementById('adminModal');
    const isModalOpen = adminModal && !adminModal.classList.contains('hidden');

    if (totalAlerts > 0 && !isModalOpen) {
      if (navBadge) {
        navBadge.innerText = totalAlerts;
        navBadge.classList.remove('hidden');
      }
      if (mobileNavBadge) {
        mobileNavBadge.innerText = totalAlerts;
        mobileNavBadge.classList.remove('hidden');
      }
    } else {
      if (navBadge) navBadge.classList.add('hidden');
      if (mobileNavBadge) mobileNavBadge.classList.add('hidden');
    }
  } catch (err) {}
}

async function loadPendingUsersList() {
  const container = document.getElementById('pendingUsersList');
  const emptyMsg = document.getElementById('pendingEmptyMessage');
  container.innerHTML = `<div class="text-center py-6 text-slate-400"><i class="fa-solid fa-circle-notch fa-spin text-xl"></i> بارکردن...</div>`;

  try {
    const res = await fetch('/api/admin/pending', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    container.innerHTML = '';

    if (!data.pending || data.pending.length === 0) {
      emptyMsg.classList.remove('hidden');
      return;
    }
    emptyMsg.classList.add('hidden');

    data.pending.forEach(u => {
      const card = document.createElement('div');
      card.className = 'p-4 rounded-2xl bg-slate-800/80 border border-slate-700 flex items-center justify-between flex-wrap gap-3';
      const createdDate = new Date(u.created_at).toLocaleDateString('ku-IQ') + ' ' + new Date(u.created_at).toLocaleTimeString('ku-IQ');

      card.innerHTML = `
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold text-sm">
            ${u.gender === 'female' ? '👧' : '👦'}
          </div>
          <div>
            <h4 class="font-bold text-sm text-white">${escapeHtml(u.full_name)} <span class="text-xs ${u.gender === 'female' ? 'text-pink-400' : 'text-sky-400'} font-normal">(${u.gender === 'female' ? 'کچ' : 'کوڕ'})</span></h4>
            <div class="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
              <span>ناوی بەکارهێنەر: <b class="font-mono text-slate-300">@${escapeHtml(u.username)}</b></span>
              <span>•</span>
              <span>کاتی داواکاری: ${createdDate}</span>
            </div>
          </div>
        </div>

        <div class="flex items-center gap-1.5 flex-wrap">
          <button onclick="approveUser(${u.id}, 'student')" class="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold text-xs shadow transition flex items-center gap-1" title="پەسەندکردن وەک قوتابی ئاسایی">
            <i class="fa-solid fa-graduation-cap"></i> قوتابی 🎓
          </button>
          <button onclick="approveUser(${u.id}, 'teacher')" class="px-3 py-1.5 bg-purple-700 hover:bg-purple-600 text-white rounded-xl font-bold text-xs shadow transition flex items-center gap-1" title="پەسەندکردن وەک مامۆستا">
            <span>مامۆستا 👨‍🏫</span>
          </button>
          <button onclick="approveUser(${u.id}, 'new_student')" class="px-3 py-1.5 bg-teal-600 hover:bg-teal-500 text-white rounded-xl font-bold text-xs shadow transition flex items-center gap-1" title="پەسەندکردن وەک قوتابی تازە (١ چات لە ٢٤ کاتژمێردا)">
            <span>قوتابی تازە 🔰</span>
          </button>
          <button onclick="approveUser(${u.id}, 'guest')" class="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-xl font-bold text-xs shadow transition flex items-center gap-1" title="پەسەندکردن وەک میوان (تەنها چاودێر)">
            <span>میوان 👁️</span>
          </button>
          <button onclick="rejectUser(${u.id})" class="px-2.5 py-1.5 bg-red-600/20 hover:bg-red-600 text-red-300 hover:text-white border border-red-500/40 rounded-xl font-bold text-xs transition" title="ڕەتکردنەوە">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
      `;
      container.appendChild(card);
    });

    checkPendingCount();
  } catch (err) {
    container.innerHTML = `<div class="text-red-400 text-sm text-center py-4">هەڵەیەک ڕوویدا</div>`;
  }
}

async function approveUser(userId, role = 'student') {
  try {
    const res = await fetch('/api/admin/approve', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ user_id: userId, role })
    });
    if (res.ok) {
      loadPendingUsersList();
      checkPendingCount();
      loadAllMembers();
    }
  } catch (e) {
    alert('هەڵەیەک ڕوویدا');
  }
}

async function rejectUser(userId) {
  if (!confirm('ئایا دڵنیایت لە ڕەتکردنەوەی ئەم داواکارییە؟')) return;
  try {
    const res = await fetch('/api/admin/reject', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ user_id: userId })
    });
    if (res.ok) {
      loadPendingUsersList();
      checkPendingCount();
    }
  } catch (e) {
    alert('هەڵەیەک ڕوویدا');
  }
}

async function loadAllUsersList() {
  const container = document.getElementById('allUsersList');
  container.innerHTML = `<div class="text-center py-6 text-slate-400"><i class="fa-solid fa-circle-notch fa-spin text-xl"></i> بارکردن...</div>`;

  try {
    const res = await fetch('/api/admin/users', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    container.innerHTML = '';

    const isSuperAdmin = currentUser && currentUser.role === 'super_admin';

    data.users.forEach(u => {
      const isSuper = u.role === 'super_admin';
      const isAdmin = u.role === 'admin';
      const isStudent = u.role === 'student';
      const isMuted = u.muted_until && u.muted_until > Date.now();
      const isBlocked = !!u.is_blocked;
      const nameClass = getUserNameClass(u);

      const card = document.createElement('div');
      card.className = `p-3.5 rounded-2xl bg-slate-800/80 border ${isBlocked ? 'border-red-500/50 bg-red-950/20' : 'border-slate-700'} flex items-center justify-between flex-wrap gap-2.5`;

      card.innerHTML = `
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl ${isSuper ? 'bg-amber-500/20 text-amber-400' : isAdmin ? 'bg-emerald-500/20 text-emerald-400' : 'bg-indigo-500/20 text-indigo-400'} flex items-center justify-center font-bold text-sm">
            <i class="fa-solid ${isSuper ? 'fa-user-shield' : isAdmin ? 'fa-shield' : 'fa-graduation-cap'}"></i>
          </div>
          <div>
            <div class="flex items-center gap-2">
              <h4 class="font-bold text-sm ${nameClass}">${escapeHtml(u.full_name)}</h4>
              ${renderRoleBadge(u.role)}
              ${isBlocked ? '<span class="px-2 py-0.5 rounded bg-red-600 text-white text-[10px] font-black">بلۆککراوە 🚫</span>' : ''}
              ${isMuted ? '<span class="px-2 py-0.5 rounded bg-amber-600 text-white text-[10px] font-black">سڕکراوە 🔇</span>' : ''}
            </div>
            <div class="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
              <span>@${escapeHtml(u.username)}</span>
              ${isStudent ? `<span>• خاوەنی ${u.starInfo ? u.starInfo.stars : 1} ئەستێرە (${u.starInfo ? u.starInfo.points : 0}/10)</span>` : ''}
            </div>
          </div>
        </div>

        <div class="flex items-center gap-2 flex-wrap">
          <button onclick="openUserProfileModal(${u.id})" class="px-2.5 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-xl text-xs font-bold transition flex items-center gap-1">
            <i class="fa-solid fa-circle-info"></i> زانیاری کەسەکە
          </button>

          ${isSuperAdmin && !isSuper ? `
            <div class="flex items-center gap-1 bg-slate-900 border border-slate-700 px-2 py-1 rounded-xl">
              <span class="text-[10px] text-slate-400 font-bold">پلە:</span>
              <select onchange="changeRole(${u.id}, this.value)" class="bg-transparent text-xs text-white font-bold focus:outline-none cursor-pointer">
                <option value="student" class="bg-slate-900 text-sky-400" ${u.role === 'student' ? 'selected' : ''}>🎓 قوتابی</option>
                <option value="teacher" class="bg-slate-900 text-purple-400" ${u.role === 'teacher' ? 'selected' : ''}>👨‍🏫 مامۆستا</option>
                <option value="new_student" class="bg-slate-900 text-teal-400" ${u.role === 'new_student' ? 'selected' : ''}>🔰 قوتابی تازە</option>
                <option value="guest" class="bg-slate-900 text-slate-400" ${u.role === 'guest' ? 'selected' : ''}>👁️ میوان (چاودێر)</option>
                <option value="admin" class="bg-slate-900 text-emerald-400" ${u.role === 'admin' ? 'selected' : ''}>🛡️ ئەدمین</option>
              </select>
            </div>

            <button onclick="toggleBlockUser(${u.id}, ${isBlocked ? 0 : 1})" class="px-2.5 py-1.5 ${isBlocked ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/40' : 'bg-red-600/20 text-red-300 border border-red-500/40'} rounded-xl text-xs font-bold transition flex items-center gap-1">
              <i class="fa-solid ${isBlocked ? 'fa-unlock' : 'fa-ban'}"></i>
              <span>${isBlocked ? 'لادانی بلۆک' : 'بلۆک'}</span>
            </button>

            <button onclick="deleteUserAccount(${u.id}, '${escapeHtml(u.full_name)}')" class="px-2.5 py-1.5 bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/40 rounded-xl text-xs font-bold transition flex items-center gap-1 shadow active:scale-95" title="سڕینەوەی بنبڕی ئەم ئەکاونتە لە سیستەم">
              <i class="fa-solid fa-trash-can"></i>
              <span>سڕینەوە</span>
            </button>
          ` : ''}

          ${(u.role === 'student' || u.role === 'new_student') ? `
            ${isMuted ? `
              <button onclick="unmuteUser(${u.id})" class="px-2.5 py-1.5 bg-amber-600/30 border border-amber-500/40 text-amber-300 rounded-xl text-xs font-bold transition">
                لادانی سڕکردن
              </button>
            ` : `
              <button onclick="muteUser24h(${u.id}, '${escapeHtml(u.full_name)}')" class="px-2.5 py-1.5 bg-slate-700 hover:bg-red-950 text-slate-300 hover:text-red-300 border border-slate-600 rounded-xl text-xs font-bold transition">
                سڕکردن (24h)
              </button>
            `}
          ` : ''}
        </div>
      `;
      container.appendChild(card);
    });
  } catch (err) {
    container.innerHTML = `<div class="text-red-400 text-sm text-center py-4">هەڵەیەک ڕوویدا</div>`;
  }
}

async function toggleBlockUser(userId, blockStatus) {
  const actionText = blockStatus ? 'بلۆککردنی' : 'لادانی بلۆکی';
  if (!confirm(`ئایا دڵنیایت لە ${actionText} ئەم بەکارهێنەرە؟`)) return;

  try {
    const res = await fetch('/api/admin/block', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ user_id: userId, is_blocked: blockStatus })
    });
    if (res.ok) {
      loadAllUsersList();
      loadAllMembers();
    }
  } catch (err) {
    alert('هەڵەیەک ڕوویدا');
  }
}

// --- LEADERBOARD MODAL ---
function openLeaderboardModal() {
  document.getElementById('leaderboardModal').classList.remove('hidden');
  loadStudentOfTheMonth();
  loadLeaderboard();
}

function closeLeaderboardModal() {
  document.getElementById('leaderboardModal').classList.add('hidden');
}

// --- STUDENT OF THE MONTH SPOTLIGHT ---
async function loadStudentOfTheMonth() {
  const container = document.getElementById('studentOfMonthSpotlight');
  if (!container) return;

  try {
    const res = await fetch('/api/chat/student-of-the-month', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return;
    const data = await res.json();

    const student = (data && data.student) || (data && data.topStudents && data.topStudents[0]) || null;
    if (student) {
      const st = student;
      const stars = st.month_stars || st.correct_answers_count || 0;
      container.innerHTML = `
        <div class="p-3.5 md:p-4 rounded-2xl bg-gradient-to-r from-amber-500/15 via-yellow-500/10 to-[#dfaa86]/20 border border-amber-500/40 relative overflow-hidden shadow-xl mb-3">
          <div class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-3">
              <div class="w-12 h-12 rounded-2xl bg-gradient-to-tr from-amber-500 to-yellow-300 text-slate-950 flex items-center justify-center text-xl font-black shadow-lg shadow-amber-500/30">
                👑
              </div>
              <div>
                <div class="flex items-center gap-2">
                  <span class="text-[10px] font-black uppercase tracking-wider bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-md border border-amber-500/30">
                    خوێندکاری مانگ ✨ Student of the Month
                  </span>
                </div>
                <h3 class="text-sm md:text-base font-black text-white mt-1 cursor-pointer hover:underline" onclick="openUserProfileModal(${st.id})">
                  ${escapeHtml(st.full_name)}
                </h3>
                <p class="text-[11px] text-slate-400 font-mono">@${escapeHtml(st.username)}</p>
              </div>
            </div>
            <div class="text-left shrink-0">
              <div class="text-base md:text-lg font-black text-amber-400 font-mono flex items-center gap-1 justify-end">
                <span>${stars}</span>
                <i class="fa-solid fa-star text-amber-400 text-sm"></i>
              </div>
              <div class="text-[10px] text-slate-400 font-bold">ئەستێرەی مانگ ⭐</div>
            </div>
          </div>
        </div>
      `;
    } else {
      container.innerHTML = `
        <div class="p-3 rounded-xl bg-slate-900/60 border border-slate-800 text-xs text-slate-400 text-center flex items-center justify-center gap-2 mb-3">
          <i class="fa-solid fa-crown text-amber-400"></i>
          <span>کێبڕکێی خوێندکاری مانگ بەردەوامە! وەڵامی پرسیارەکان بدەرەوە بۆ گەیشتن بە لوتکە.</span>
        </div>
      `;
    }
  } catch (e) {
    container.innerHTML = '';
  }
}

async function loadLeaderboard() {
  const container = document.getElementById('leaderboardList');
  container.innerHTML = `<div class="text-center py-6 text-slate-400"><i class="fa-solid fa-circle-notch fa-spin text-xl"></i> بارکردن...</div>`;

  try {
    const res = await fetch('/api/chat/leaderboard', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    container.innerHTML = '';

    if (!data.leaderboard || data.leaderboard.length === 0) {
      container.innerHTML = `
        <div class="text-center py-8 text-slate-500">
          <i class="fa-solid fa-star text-3xl mb-2 text-slate-600"></i>
          <p class="font-bold text-sm">هێشتا هیچ ئەستێرەیەک نەبەخشراوە</p>
          <p class="text-xs text-slate-600 mt-1">وەڵامی یەکەم پرسیار بدەرەوە تا بیتە پێشەنگ!</p>
        </div>
      `;
      return;
    }

    data.leaderboard.forEach((st, idx) => {
      const rank = idx + 1;
      let rankBadge = `<span class="w-7 h-7 rounded-full bg-slate-800 text-slate-400 font-mono font-bold flex items-center justify-center text-xs">${rank}</span>`;
      if (rank === 1) {
        rankBadge = `<span class="w-7 h-7 rounded-full bg-amber-500 text-slate-950 font-black flex items-center justify-center text-xs shadow-md shadow-amber-500/40"><i class="fa-solid fa-crown text-[10px]"></i></span>`;
      } else if (rank === 2) {
        rankBadge = `<span class="w-7 h-7 rounded-full bg-slate-300 text-slate-950 font-black flex items-center justify-center text-xs"><i class="fa-solid fa-medal text-[10px]"></i></span>`;
      } else if (rank === 3) {
        rankBadge = `<span class="w-7 h-7 rounded-full bg-amber-700 text-amber-100 font-black flex items-center justify-center text-xs"><i class="fa-solid fa-medal text-[10px]"></i></span>`;
      }

      const nameClass = getUserNameClass(st);
      const item = document.createElement('div');
      item.className = 'p-3 rounded-2xl bg-slate-800/70 border border-slate-700/60 flex items-center justify-between gap-3 cursor-pointer hover:bg-slate-800 transition';
      item.onclick = () => openUserProfileModal(st.id);

      item.innerHTML = `
        <div class="flex items-center gap-3">
          ${rankBadge}
          <div>
            <h4 class="font-bold text-sm ${nameClass}">${escapeHtml(st.full_name)}</h4>
            <p class="text-[11px] text-slate-400 font-mono">@${escapeHtml(st.username)}</p>
          </div>
        </div>
        <div class="text-left">
          ${renderStarBadge(st.correct_answers_count)}
          <div class="text-[10px] text-slate-400 mt-0.5 font-mono text-left">کۆی وەڵامەکان: ${st.correct_answers_count}</div>
        </div>
      `;
      container.appendChild(item);
    });
  } catch (err) {
    container.innerHTML = `<div class="text-red-400 text-sm text-center py-4">هەڵەیەک ڕوویدا</div>`;
  }
}

// Utility: Escape HTML
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// --- QUESTIONS ARCHIVE & BANK ---
let questionsArchiveCache = [];

async function openQuestionsArchiveModal() {
  const modal = document.getElementById('questionsArchiveModal');
  const list = document.getElementById('questionsArchiveList');
  const searchInput = document.getElementById('archiveSearchInput');
  if (searchInput) searchInput.value = '';

  modal.classList.remove('hidden');
  list.innerHTML = `
    <div class="text-center py-12 text-slate-500">
      <i class="fa-solid fa-circle-notch fa-spin text-2xl text-indigo-500 mb-2"></i>
      <p class="text-xs">بارکردنی پرسیار و وەڵامەکان...</p>
    </div>
  `;

  try {
    const res = await fetch('/api/chat/questions/archive', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    questionsArchiveCache = data.questions || [];
    renderQuestionsArchive(questionsArchiveCache);
  } catch (err) {
    list.innerHTML = `<p class="text-xs text-red-400 text-center py-6">هەڵەیەک ڕوویدا لە بارکردنی بانکی پرسیارەکان</p>`;
  }
}

function closeQuestionsArchiveModal() {
  document.getElementById('questionsArchiveModal').classList.add('hidden');
}

function filterQuestionsArchive() {
  const searchInput = document.getElementById('archiveSearchInput');
  const query = (searchInput ? searchInput.value : '').trim().toLowerCase();
  if (!query) {
    renderQuestionsArchive(questionsArchiveCache);
    return;
  }

  const filtered = questionsArchiveCache.filter(q => {
    const qNum = String(q.question_number || '');
    const qText = (q.question_text || '').toLowerCase();
    const qAns = (q.correct_answer || '').toLowerCase();
    const qAdmin = (q.admin_name || '').toLowerCase();
    return qNum.includes(query) || qText.includes(query) || qAns.includes(query) || qAdmin.includes(query);
  });

  renderQuestionsArchive(filtered);
}

function renderQuestionsArchive(list) {
  const container = document.getElementById('questionsArchiveList');
  container.innerHTML = '';

  if (!list || list.length === 0) {
    container.innerHTML = `
      <div class="text-center py-12 text-slate-500">
        <i class="fa-solid fa-book-open text-3xl mb-2 text-slate-600"></i>
        <p class="font-bold text-sm">هیچ پرسیارێک نەدۆزرایەوە</p>
        <p class="text-xs text-slate-600 mt-1">پرسیارە نوێیەکان لەم بەشەدا ئەرشیف دەکرێن</p>
      </div>
    `;
    return;
  }

  list.forEach(q => {
    const dateFormatted = new Date(q.created_at).toLocaleDateString('ku-IQ') + ' ' + new Date(q.created_at).toLocaleTimeString('ku-IQ', { hour: '2-digit', minute: '2-digit' });
    const isRevealed = !!q.is_revealed;
    const card = document.createElement('div');
    card.className = 'p-4 rounded-2xl bg-slate-800/80 border border-slate-700/70 hover:border-slate-600 transition shadow-lg space-y-3';

    let answerSection = '';
    if (q.correct_answer && q.correct_answer.trim()) {
      answerSection = `
        <div class="p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/50 text-emerald-200">
          <div class="text-[11px] font-black text-emerald-400 mb-1 flex items-center gap-1.5">
            <i class="fa-solid fa-circle-check text-xs"></i>
            <span>وەڵامی دروستی پرسیار:</span>
          </div>
          <div class="text-xs md:text-sm font-bold text-white whitespace-pre-wrap leading-relaxed select-text">
            ${escapeHtml(q.correct_answer)}
          </div>
        </div>
      `;
    } else if (!isRevealed) {
      answerSection = `
        <div class="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 flex items-center gap-2">
          <i class="fa-solid fa-lock text-amber-400"></i>
          <span>پرسیارەکە بەردەوامە؛ وەڵامی دروست لەگەڵ تەواوبوونی کات لە گروپ بڵاودەبێتەوە.</span>
        </div>
      `;
    } else {
      answerSection = `
        <div class="text-xs text-slate-500 italic">
          وەڵامی دروست بۆ ئەم پرسیارە لەلایەن ئەدمینەوە تۆمار نەکراوە.
        </div>
      `;
    }

    card.innerHTML = `
      <div class="flex items-center justify-between gap-2 flex-wrap pb-2 border-b border-slate-700/60">
        <div class="flex items-center gap-2">
          <span class="px-2.5 py-0.5 rounded-xl bg-amber-500 text-slate-950 font-black text-xs flex items-center gap-1 shadow">
            <i class="fa-solid fa-circle-question"></i> پرسیاری ژمارە ${q.question_number || 1}
          </span>
          <span class="text-xs text-slate-300 font-bold">لەلایەن: ${escapeHtml(q.admin_name)}</span>
          ${isRevealed 
            ? '<span class="px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold">ئاشکراکراو ✔️</span>' 
            : '<span class="px-2 py-0.5 rounded-md bg-rose-500/20 text-rose-300 border border-rose-500/30 text-[10px] font-bold animate-pulse">کاتی ماوە ⏳</span>'}
        </div>
        <span class="text-[11px] text-slate-400 font-mono">${dateFormatted}</span>
      </div>

      <!-- Question Text (Distinct Color) -->
      <div class="p-3 rounded-xl bg-slate-950/70 border border-slate-700/60">
        <div class="text-[11px] text-amber-400 font-black mb-1 flex items-center gap-1.5">
          <i class="fa-solid fa-clipboard-question text-xs"></i>
          <span>دەقی پرسیار:</span>
        </div>
        <div class="text-xs md:text-sm font-black text-white leading-relaxed select-text">
          ${escapeHtml(q.question_text)}
        </div>
      </div>

      <!-- Official Answer (Distinct Emerald Color) -->
      ${answerSection}

      <div class="pt-1 flex items-center justify-between flex-wrap gap-2">
        <div class="text-[11px] text-slate-400">
          تەوقیتی دانراو: <b class="font-mono text-slate-300">${q.duration_minutes || 5} خولەک</b>
        </div>
        <button 
          onclick="jumpToQuestionInChat(${q.id}, ${q.question_number || 1})" 
          class="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow active:scale-95"
          title="دۆزینەوە و پیشاندانی ئەم پرسیارە لەناو گروپ چات"
        >
          <i class="fa-solid fa-location-crosshairs text-amber-300"></i>
          <span>چوونە سەر پرسیار لە چات 🎯</span>
        </button>
      </div>
    `;

    container.appendChild(card);
  });
}

function jumpToQuestionInChat(questionId, questionNumber) {
  closeQuestionsArchiveModal();

  // Try finding the question element or its revealed answer card in chat container
  const target = document.querySelector(`[data-question-number="${questionNumber}"]`) 
    || document.querySelector(`[data-question-id="${questionId}"]`)
    || document.getElementById(`msg-${questionId}`);

  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.remove('question-jump-target');
    void target.offsetWidth; // Trigger reflow for animation restart
    target.classList.add('question-jump-target');
    playSound('question');
    setTimeout(() => {
      target.classList.remove('question-jump-target');
    }, 2800);
  } else {
    alert(`پرسیاری ژمارە ${questionNumber} لە بەشی پێشووتر نێردراوە و سەرکەوتووانە لەم بانکەدا پارێزراوە.`);
  }
}

// ================= THEME TOGGLE (DARK / LIGHT MODE) =================
function initTheme() {
  const savedTheme = localStorage.getItem('seereen_theme') || 'dark';
  applyTheme(savedTheme);
}

function applyTheme(theme) {
  const icon = document.getElementById('themeToggleIcon');
  const text = document.getElementById('themeToggleText');
  if (theme === 'light') {
    document.body.classList.add('light-theme');
    if (icon) icon.className = 'fa-solid fa-moon text-indigo-400';
    if (text) text.innerText = 'تاریک';
  } else {
    document.body.classList.remove('light-theme');
    if (icon) icon.className = 'fa-solid fa-sun text-amber-400';
    if (text) text.innerText = 'ڕووناک';
  }
  localStorage.setItem('seereen_theme', theme);
}

function toggleTheme() {
  const isLight = document.body.classList.contains('light-theme');
  applyTheme(isLight ? 'dark' : 'light');
}

// ================= LIBRARY (BOOKSHELF) LOGIC =================
let allLibraryBooksCache = [];

function openLibraryModal() {
  document.getElementById('libraryModal').classList.remove('hidden');
  loadLibraryBooks();
}

function closeLibraryModal() {
  document.getElementById('libraryModal').classList.add('hidden');
}

function toggleLibraryUploadForm() {
  const form = document.getElementById('libraryUploadForm');
  const icon = document.getElementById('uploadAccordionIcon');
  if (form.classList.contains('hidden')) {
    form.classList.remove('hidden');
    if (icon) icon.className = 'fa-solid fa-chevron-up text-xs text-slate-400 transition-transform duration-200';
  } else {
    form.classList.add('hidden');
    if (icon) icon.className = 'fa-solid fa-chevron-down text-xs text-slate-400 transition-transform duration-200';
  }
}

async function loadLibraryBooks() {
  const container = document.getElementById('libraryBooksList');
  container.innerHTML = `<div class="text-center py-12 text-slate-500"><i class="fa-solid fa-circle-notch fa-spin text-xl text-teal-500 mb-2"></i><p class="text-xs">بارکردنی کتێبخانە...</p></div>`;

  try {
    const res = await fetch('/api/library/books', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) {
      if (res.status === 403) {
        container.innerHTML = `<div class="text-center py-8 text-rose-400 font-bold text-xs">تۆ وەک میوان (چاودێر) ناتوانیت سەردانی کتێبخانە بکەیت 👁️</div>`;
        return;
      }
      container.innerHTML = `<div class="text-center py-8 text-red-400 text-xs">هەڵەیەک ڕوویدا</div>`;
      return;
    }
    const data = await res.json();
    allLibraryBooksCache = data.books || [];
    renderLibraryBooks(allLibraryBooksCache);
  } catch (err) {
    container.innerHTML = `<div class="text-center py-8 text-red-400 text-xs">پەیوەندی لەگەڵ سێرڤەر ناتەواوە</div>`;
  }
}

function filterLibraryBooks() {
  const q = (document.getElementById('librarySearchInput').value || '').trim().toLowerCase();
  if (!q) {
    renderLibraryBooks(allLibraryBooksCache);
    return;
  }
  const filtered = allLibraryBooksCache.filter(b => 
    (b.title && b.title.toLowerCase().includes(q)) ||
    (b.author && b.author.toLowerCase().includes(q)) ||
    (b.category && b.category.toLowerCase().includes(q)) ||
    (b.description && b.description.toLowerCase().includes(q))
  );
  renderLibraryBooks(filtered);
}

function formatFileSize(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function renderLibraryBooks(books) {
  const container = document.getElementById('libraryBooksList');
  container.innerHTML = '';

  if (!books || books.length === 0) {
    container.innerHTML = `
      <div class="text-center py-12 text-slate-500">
        <i class="fa-solid fa-book text-4xl mb-3 text-slate-600"></i>
        <p class="font-bold text-sm">هیچ کتێب یان سەرچاوەیەک نەدۆزرایەوە</p>
        <p class="text-xs text-slate-600 mt-1">ئەدمین و مامۆستایان دەتوانن کتێبی نوێ دابنێن</p>
      </div>
    `;
    return;
  }

  const isAdmin = currentUser && (currentUser.role === 'admin' || currentUser.role === 'super_admin' || currentUser.role === 'teacher');

  books.forEach(book => {
    const card = document.createElement('div');
    card.className = 'p-4 rounded-2xl bg-slate-800/80 hover:bg-slate-800 border border-slate-700/70 transition flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-md';

    const isPdf = book.file_type && book.file_type.includes('pdf');
    const isDoc = book.file_type && (book.file_type.includes('word') || (book.file_name && (book.file_name.endsWith('.doc') || book.file_name.endsWith('.docx'))));
    const isZip = book.file_type && (book.file_type.includes('zip') || (book.file_name && (book.file_name.endsWith('.zip') || book.file_name.endsWith('.rar'))));

    let fileIconClass = 'fa-solid fa-file-lines text-slate-400';
    let iconBgClass = 'bg-slate-700/50 text-slate-300';
    if (isPdf) {
      fileIconClass = 'fa-solid fa-file-pdf text-red-400';
      iconBgClass = 'bg-red-500/15 text-red-400 border border-red-500/30';
    } else if (isDoc) {
      fileIconClass = 'fa-solid fa-file-word text-blue-400';
      iconBgClass = 'bg-blue-500/15 text-blue-400 border border-blue-500/30';
    } else if (isZip) {
      fileIconClass = 'fa-solid fa-file-zipper text-amber-400';
      iconBgClass = 'bg-amber-500/15 text-amber-400 border border-amber-500/30';
    }

    const dateStr = new Date(book.created_at).toLocaleDateString('ku-IQ');

    card.innerHTML = `
      <div class="flex items-start gap-3 flex-1">
        <div class="w-12 h-12 rounded-2xl ${iconBgClass} flex items-center justify-center text-2xl shrink-0 shadow">
          <i class="${fileIconClass}"></i>
        </div>
        <div class="flex-1">
          <div class="flex items-center gap-2 flex-wrap mb-1">
            <h4 class="font-black text-sm md:text-base text-white">${escapeHtml(book.title)}</h4>
            <span class="px-2 py-0.5 rounded-md bg-teal-500/20 text-teal-300 border border-teal-500/30 text-[10px] font-bold">
              ${escapeHtml(book.category || 'گشتی')}
            </span>
          </div>

          ${book.author ? `<p class="text-xs text-amber-300/90 font-medium mb-1"><i class="fa-solid fa-pen-nib ml-1 text-[10px]"></i>نووسەر: <b>${escapeHtml(book.author)}</b></p>` : ''}
          ${book.description ? `<p class="text-xs text-slate-300 leading-relaxed mb-2">${escapeHtml(book.description)}</p>` : ''}

          <div class="flex items-center gap-3 text-[11px] text-slate-400 font-mono flex-wrap">
            <span><i class="fa-solid fa-hard-drive ml-1"></i>${formatFileSize(book.file_size)}</span>
            <span>•</span>
            <span><i class="fa-solid fa-user-check ml-1"></i>لەلایەن: ${escapeHtml(book.uploader_name)}</span>
            <span>•</span>
            <span><i class="fa-regular fa-clock ml-1"></i>${dateStr}</span>
          </div>
        </div>
      </div>

      <div class="flex items-center gap-2 self-end md:self-center shrink-0">
        <a 
          href="${book.file_url}" 
          target="_blank" 
          download="${escapeHtml(book.file_name)}"
          class="px-4 py-2 bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 text-white font-black text-xs rounded-xl shadow transition flex items-center gap-1.5 active:scale-95"
          title="داگرتن و خوێندنەوەی ئەم کتێبە"
        >
          <i class="fa-solid fa-download"></i>
          <span>داگرتن 📥</span>
        </a>

        ${isAdmin ? `
          <button 
            onclick="deleteLibraryBook(${book.id})" 
            class="p-2 text-rose-400 hover:text-white hover:bg-rose-600/30 rounded-xl transition text-xs border border-rose-500/30"
            title="سڕینەوەی ئەم کتێبە لە کتێبخانە"
          >
            <i class="fa-solid fa-trash-can"></i>
          </button>
        ` : ''}
      </div>
    `;

    container.appendChild(card);
  });
}

async function handleUploadLibraryBook(e) {
  e.preventDefault();
  const fileInput = document.getElementById('libBookFile');
  const file = fileInput.files[0];
  if (!file) {
    alert('تکایە فایلی کتێب یان پەڕاوەکە هەڵبژێرە');
    return;
  }

  const title = document.getElementById('libBookTitle').value.trim();
  const author = document.getElementById('libBookAuthor').value.trim();
  const category = document.getElementById('libBookCategory').value;
  const description = document.getElementById('libBookDescription').value.trim();
  const btn = document.getElementById('libUploadSubmitBtn');

  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> بارکردن...`;

  const formData = new FormData();
  formData.append('file', file);
  formData.append('title', title);
  formData.append('author', author);
  formData.append('category', category);
  formData.append('description', description);

  try {
    const res = await fetch('/api/library/upload', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });
    const data = await res.json();
    if (res.ok) {
      document.getElementById('libraryUploadForm').reset();
      toggleLibraryUploadForm();
      loadLibraryBooks();
      triggerStarCelebration();
    } else {
      alert(data.error || 'هەڵەیەک ڕوویدا لە بارکردن');
    }
  } catch (err) {
    alert('پەیوەندی لەگەڵ سێرڤەر ناتەواوە');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> <span>بارکردن بۆ کتێبخانە</span>`;
  }
}

async function deleteLibraryBook(bookId) {
  if (!confirm('ئایا دڵنیایت لە سڕینەوەی ئەم کتێبە لە کتێبخانە؟')) return;
  try {
    const res = await fetch(`/api/library/books/${bookId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (res.ok) {
      loadLibraryBooks();
    } else {
      alert(data.error || 'هەڵەیەک ڕوویدا');
    }
  } catch (err) {
    alert('پەیوەندی ناتەواوە');
  }
}

// =========================================================================
// ================= DREAM INTERPRETATION (لێکدانەوەی خەون) MODULE =========
// =========================================================================

let currentDreamSession = null;
let dreamSocket = null;
let activeDreamAdminSessionId = null;
let dreamAdminSessionsCache = [];

// Voice Recording state
let dreamMediaRecorder = null;
let dreamAudioChunks = [];
let dreamTimerInterval = null;
let dreamTimerSeconds = 0;
let dreamRecordingIsAdmin = false;

// Audio Call & Two-Way Live Recording State
let rtcPeerConn = null;
let callLocalStream = null;
let callRemoteStream = null;
let callTimerInterval = null;
let callTimerSeconds = 0;
let callAudioContext = null;
let callTwoWayRecorder = null;
let callTwoWayChunks = [];
let callActiveSessionId = null;
let callPendingData = null;
let ringtoneInterval = null;
let isCallMuted = false;
let isSpeakerMode = true;
let callOutputAudioContext = null;
let callOutputGainNode = null;
let callOutputSource = null;
let callRecordingUploaded = false;

// WebRTC Configuration
const rtcIceConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// --- Ringtone Generator (Web Audio API) ---
let ringtoneAudioCtx = null;

function playRingtone() {
  stopRingtone();
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    ringtoneAudioCtx = new AudioCtx();

    const ringBurst = () => {
      try {
        if (!ringtoneAudioCtx || ringtoneAudioCtx.state === 'closed') return;
        if (ringtoneAudioCtx.state === 'suspended') ringtoneAudioCtx.resume();
        const now = ringtoneAudioCtx.currentTime;

        // Realistic classic telephone dual-tone chime (440Hz + 480Hz)
        [440, 480].forEach(freq => {
          const osc = ringtoneAudioCtx.createOscillator();
          const gain = ringtoneAudioCtx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now);

          // Ring 1 (0 to 0.9s)
          gain.gain.setValueAtTime(0.12, now);
          gain.gain.setValueAtTime(0.12, now + 0.85);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.95);

          // Ring 2 (1.2 to 2.1s)
          gain.gain.setValueAtTime(0.12, now + 1.2);
          gain.gain.setValueAtTime(0.12, now + 2.05);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 2.15);

          osc.connect(gain);
          gain.connect(ringtoneAudioCtx.destination);
          osc.start(now);
          osc.stop(now + 2.2);
        });
      } catch (e) {}
    };

    ringBurst();
    ringtoneInterval = setInterval(ringBurst, 3500);
  } catch (e) {}
}

function stopRingtone() {
  if (ringtoneInterval) {
    clearInterval(ringtoneInterval);
    ringtoneInterval = null;
  }
  if (ringtoneAudioCtx) {
    try { ringtoneAudioCtx.close(); } catch (e) {}
    ringtoneAudioCtx = null;
  }
}

// --- DREAMER FLOW (بەشی بەشداربووی خەون) ---

// 1. Open Dream Section from Auth Screen
async function openDreamSection() {
  const dreamToken = localStorage.getItem('seereen_dream_token');
  if (dreamToken) {
    try {
      const res = await fetch('/api/dream/session', {
        headers: { 'x-dream-token': dreamToken }
      });
      if (res.ok) {
        const data = await res.json();
        currentDreamSession = data.session;
        openDreamChatModalWithSession(data.session, data.messages);
        initDreamSocket(dreamToken);
        return;
      } else {
        localStorage.removeItem('seereen_dream_token');
      }
    } catch (e) {
      console.error('Error resuming dream session:', e);
    }
  }
  openDreamAuthModal();
}

function openDreamAuthModal() {
  fetchDreamAvailability();
  const modal = document.getElementById('dreamAuthModal');
  if (modal) modal.classList.remove('hidden');
}

function closeDreamAuthModal() {
  const modal = document.getElementById('dreamAuthModal');
  if (modal) modal.classList.add('hidden');
}

async function submitDreamerStart() {
  const nameInput = document.getElementById('dreamerNameInput');
  const name = (nameInput ? nameInput.value : '').trim();
  if (!name) {
    alert('تکایە ناوت بنووسە');
    return;
  }
  const genderRadio = document.querySelector('input[name="dreamerGenderRadio"]:checked');
  const gender = genderRadio ? genderRadio.value : 'male';

  try {
    const res = await fetch('/api/dream/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, gender })
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'هەڵەیەک ڕوویدا');
      return;
    }
    localStorage.setItem('seereen_dream_token', data.token);
    currentDreamSession = data.session;
    closeDreamAuthModal();
    openDreamChatModalWithSession(data.session, data.messages);
    initDreamSocket(data.token);
  } catch (err) {
    alert('پەیوەندی لەگەڵ سێرڤەر ناتەواوە');
  }
}

async function requestDreamMicrophonePermission() {
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
      const banner = document.getElementById('dreamMicPermissionBanner');
      if (banner) banner.classList.add('hidden');
    } catch (err) {
      console.warn('Microphone permission not granted yet:', err);
      const banner = document.getElementById('dreamMicPermissionBanner');
      if (banner) banner.classList.remove('hidden');
    }
  }
}

function openDreamChatModalWithSession(session, initialMessages) {
  const modal = document.getElementById('dreamChatModal');
  if (!modal) return;
  modal.classList.remove('hidden');

  const container = document.getElementById('dreamMessagesContainer');
  if (container) {
    container.innerHTML = '';
    if (initialMessages && initialMessages.length > 0) {
      initialMessages.forEach(msg => appendDreamMessage(msg, false));
    }
    scrollDreamMessagesToBottom(false);
  }

  // Directly prompt microphone permission on mobile/desktop so voice and calls connect immediately
  setTimeout(() => {
    requestDreamMicrophonePermission();
  }, 250);
}

function closeDreamChatModal() {
  const modal = document.getElementById('dreamChatModal');
  if (modal) modal.classList.add('hidden');
}

function initDreamSocket(dreamToken) {
  if (dreamSocket) {
    dreamSocket.disconnect();
    dreamSocket = null;
  }
  dreamSocket = io({
    auth: { dreamToken }
  });

  dreamSocket.on('dream_new_message', (msg) => {
    appendDreamMessage(msg, false);
    playSound('message');
  });

  dreamSocket.on('dream_incoming_call', (data) => {
    handleIncomingDreamCall(data, false);
  });

  dreamSocket.on('dream_call_accepted', (data) => {
    handleDreamCallAccepted(data);
  });

  dreamSocket.on('dream_call_rejected', (data) => {
    handleDreamCallRejected(data);
  });

  dreamSocket.on('dream_call_signal', (data) => {
    handleDreamCallSignal(data);
  });

  dreamSocket.on('dream_call_ended', () => {
    handleDreamCallEnded();
  });

  dreamSocket.on('dream_message_deleted', (data) => {
    if (data && data.messageId) {
      const el = document.getElementById(`dream-msg-${data.messageId}`);
      if (el) el.remove();
    }
  });

  dreamSocket.on('dream_availability_updated', (data) => {
    updateDreamAvailabilityUI(data);
  });
}

function appendDreamMessage(msg, isAdminView = false) {
  if (!msg) return;
  // If dreamer view and message is secret recording -> DO NOT DISPLAY!
  if (!isAdminView && msg.is_secret_recording) return;

  // If admin view, do not display the redundant summary text message if secret recording is present
  if (isAdminView && msg.type === 'system' && msg.content && msg.content.includes('پەیوەندی تەلەفۆنی ئەنجامدرا')) {
    return;
  }

  // Deduplication check by message ID
  if (msg.id) {
    const existing = document.getElementById(isAdminView ? `dream-admin-msg-${msg.id}` : `dream-msg-${msg.id}`);
    if (existing) return;
  }

  const container = isAdminView 
    ? document.getElementById('dreamAdminMessagesContainer') 
    : document.getElementById('dreamMessagesContainer');
  if (!container) return;

  const msgElem = document.createElement('div');
  if (msg.id) {
    msgElem.id = isAdminView ? `dream-admin-msg-${msg.id}` : `dream-msg-${msg.id}`;
  }
  const isDreamerSender = msg.sender_type === 'dreamer';
  const isSuperAdminSender = msg.sender_type === 'super_admin';
  const isSystem = msg.sender_type === 'system';
  const dateStr = new Date(msg.created_at).toLocaleTimeString('ku-IQ', { hour: '2-digit', minute: '2-digit' });

  if (isSystem) {
    if (msg.type === 'call_record') {
      // Secret Call Recording (Only visible to Admin & Teacher)
      const downloadRecordBtn = (currentUser && currentUser.role === 'super_admin') ? `
        <a href="${msg.attachment_url}" download="call_record_${msg.id || Date.now()}" class="px-2 py-1 bg-amber-500/20 hover:bg-amber-500 text-amber-300 hover:text-slate-950 text-[10px] font-bold rounded-lg border border-amber-500/40 flex items-center gap-1 shrink-0 transition" title="داگرتنی ئەم تۆمارە">
          <i class="fa-solid fa-download"></i> داگرتن
        </a>
      ` : '';
      const deleteRecordBtn = (currentUser && currentUser.role === 'super_admin') ? `
        <button onclick="deleteSingleDreamMessage(${msg.id})" class="px-2 py-1 bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white text-[10px] font-bold rounded-lg border border-rose-500/40 flex items-center gap-1 shrink-0 transition" title="سڕینەوەی ئەم تۆمارە">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      ` : '';
      msgElem.className = 'w-full my-2.5';
      msgElem.innerHTML = `
        <div class="p-3.5 rounded-2xl bg-purple-950/40 border-2 border-purple-500/60 shadow-lg text-right">
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs font-black text-purple-300 flex items-center gap-1.5">
              <i class="fa-solid fa-phone-volume text-emerald-400"></i>
              <span>${escapeHtml(msg.content)}</span>
            </span>
            <div class="flex items-center gap-1.5">
              ${downloadRecordBtn}
              ${deleteRecordBtn}
              <span class="text-[10px] bg-purple-500/20 text-purple-200 px-2 py-0.5 rounded font-mono font-bold">بەڵگەی کوالتی و ئەمنییەت 🔒</span>
            </div>
          </div>
          <audio controls class="w-full h-9 rounded-xl my-1" src="${msg.attachment_url}"></audio>
          <p class="text-[10px] text-amber-300 mt-1 font-medium">⚠️ تێبینی: ئەم تۆمارە تەنها بۆ بەڕێوەبەرە و لای خەون بین ناخرێتەڕوو.</p>
        </div>
      `;
    } else {
      msgElem.className = 'flex justify-center my-2';
      msgElem.innerHTML = `
        <div class="px-3 py-1.5 rounded-xl bg-slate-900 border border-purple-500/20 text-[11px] text-purple-200 text-center max-w-md whitespace-pre-line leading-relaxed shadow">
          ${escapeHtml(msg.content)}
        </div>
      `;
    }
    container.appendChild(msgElem);
    scrollDreamMessagesToBottom(isAdminView);
    return;
  }

  // Text or Voice messages
  let isMine = false;
  if (isAdminView) {
    isMine = isSuperAdminSender;
  } else {
    isMine = isDreamerSender;
  }

  msgElem.className = `flex ${isMine ? 'justify-end' : 'justify-start'} my-2`;

  let bodyContent = '';
  if (msg.type === 'voice' && msg.attachment_url) {
    const downloadDreamVoiceBtn = (currentUser && currentUser.role === 'super_admin') ? `
      <a href="${msg.attachment_url}" download="dream_voice_${msg.id || Date.now()}" class="px-2 py-1 bg-slate-900 hover:bg-slate-700 text-amber-300 text-[10px] font-bold rounded-lg border border-slate-700 flex items-center gap-1 shrink-0 shadow-sm transition" title="داگرتنی ئەم دەنگە">
        <i class="fa-solid fa-download"></i> داگرتن
      </a>
    ` : '';
    bodyContent = `
      <div class="space-y-1">
        <div class="flex items-center gap-2">
          <audio controls class="max-w-xs h-9 rounded-lg" src="${msg.attachment_url}"></audio>
          ${downloadDreamVoiceBtn}
        </div>
        <span class="text-[10px] text-slate-400 block">${escapeHtml(msg.content || 'پەیامی دەنگی')}</span>
      </div>
    `;
  } else {
    bodyContent = `<p class="text-xs md:text-sm leading-relaxed whitespace-pre-wrap ${isSuperAdminSender ? 'msg-text-super-admin' : ''}">${escapeHtml(msg.content)}</p>`;
  }

  const senderBadge = isSuperAdminSender 
    ? '<span class="badge-super-admin-shield inline-flex items-center text-xs select-none mr-1.5" title="ئەدمین">🛡️</span>'
    : '<span class="text-[9px] font-bold text-purple-300 mr-1.5">خەون بین</span>';

  const senderNameHtml = isSuperAdminSender
    ? `<span class="user-name-super-admin font-black">${escapeHtml(msg.sender_name)}</span>`
    : `<span>${escapeHtml(msg.sender_name)}</span>`;

  const deleteMsgBtnHtml = (isAdminView && currentUser && currentUser.role === 'super_admin' && msg.id) ? `
    <button onclick="deleteSingleDreamMessage(${msg.id})" class="text-rose-400 hover:text-rose-300 p-0.5 text-[10px] rounded hover:bg-slate-700/60 transition ml-1" title="سڕینەوەی ئەم نامەیە">
      <i class="fa-solid fa-trash-can"></i>
    </button>
  ` : '';

  msgElem.innerHTML = `
    <div class="max-w-[85%] rounded-2xl p-3 shadow-md ${isMine ? 'bg-indigo-600 text-white rounded-br-none' : 'bg-slate-800 text-slate-100 rounded-bl-none border border-slate-700/60'}">
      <div class="flex items-center justify-between gap-3 text-[10px] mb-1 opacity-80">
        <span class="font-bold flex items-center">${senderBadge} ${senderNameHtml}</span>
        <div class="flex items-center gap-1 font-mono text-[9px]">
          <span>${dateStr}</span>
          ${deleteMsgBtnHtml}
        </div>
      </div>
      ${bodyContent}
    </div>
  `;

  container.appendChild(msgElem);
  scrollDreamMessagesToBottom(isAdminView);
}

function scrollDreamMessagesToBottom(isAdminView = false) {
  const container = isAdminView 
    ? document.getElementById('dreamAdminMessagesContainer') 
    : document.getElementById('dreamMessagesContainer');
  if (container) {
    setTimeout(() => {
      container.scrollTop = container.scrollHeight;
    }, 50);
  }
}

// 2. Send Text Message
async function sendDreamTextMessage(isAdmin = false) {
  const input = isAdmin 
    ? document.getElementById('dreamAdminTextInput') 
    : document.getElementById('dreamTextInput');
  if (!input) return;
  const content = input.value.trim();
  if (!content) return;

  const headers = { 'Content-Type': 'application/json' };
  const body = { content };

  if (isAdmin) {
    if (!activeDreamAdminSessionId) return;
    headers['Authorization'] = `Bearer ${token}`;
    body.sessionId = activeDreamAdminSessionId;
  } else {
    const dToken = localStorage.getItem('seereen_dream_token');
    if (!dToken) return;
    headers['x-dream-token'] = dToken;
  }

  input.value = '';

  try {
    const res = await fetch('/api/dream/message', {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'هەڵەیەک ڕوویدا');
      return;
    }
    if (isAdmin) {
      appendDreamMessage(data.message, true);
    } else {
      appendDreamMessage(data.message, false);
    }
  } catch (err) {
    alert('پەیوەندی ناتەواوە');
  }
}

// 3. Voice Recording for Dream Chat (Dreamer & Admin)
async function toggleDreamVoiceRecording(isAdmin = false) {
  if (dreamMediaRecorder && dreamMediaRecorder.state === 'recording') {
    stopAndSendDreamVoice(isAdmin);
    return;
  }

  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert('⚠️ وێبگەڕەکەت لەسەر ئەم ناونیشانە ڕێگە بە مایکرۆفۆن نادات.\nتکایە دڵنیابە لە ڕێگەپێدانی مایکرۆفۆن یان بەستەری پارێزراو بەکاربهێنە.');
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    dreamAudioChunks = [];
    dreamRecordingIsAdmin = isAdmin;

    let mimeType = '';
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported) {
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) mimeType = 'audio/webm;codecs=opus';
      else if (MediaRecorder.isTypeSupported('audio/webm')) mimeType = 'audio/webm';
      else if (MediaRecorder.isTypeSupported('audio/mp4')) mimeType = 'audio/mp4';
      else if (MediaRecorder.isTypeSupported('audio/aac')) mimeType = 'audio/aac';
      else if (MediaRecorder.isTypeSupported('audio/ogg')) mimeType = 'audio/ogg';
    }
    const options = mimeType ? { mimeType } : {};
    dreamMediaRecorder = new MediaRecorder(stream, options);

    dreamMediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) dreamAudioChunks.push(e.data);
    };

    dreamMediaRecorder.start(250);

    // Show Recording Bar
    const bar = isAdmin ? document.getElementById('dreamAdminVoiceBar') : document.getElementById('dreamVoiceRecordingBar');
    const timerElem = isAdmin ? document.getElementById('dreamAdminVoiceTimer') : document.getElementById('dreamVoiceTimerText');
    if (bar) bar.classList.remove('hidden');

    dreamTimerSeconds = 0;
    if (timerElem) timerElem.innerText = '00:00';
    if (dreamTimerInterval) clearInterval(dreamTimerInterval);
    dreamTimerInterval = setInterval(() => {
      dreamTimerSeconds++;
      const mins = String(Math.floor(dreamTimerSeconds / 60)).padStart(2, '0');
      const secs = String(dreamTimerSeconds % 60).padStart(2, '0');
      if (timerElem) timerElem.innerText = `${mins}:${secs}`;
    }, 1000);

  } catch (err) {
    console.error('Mic error:', err);
    alert('ڕێگەپێدانی مایکرۆفۆن پێویستە بۆ تۆمارکردنی دەنگ');
  }
}

function cancelDreamVoiceRecording(isAdmin = false) {
  if (dreamTimerInterval) clearInterval(dreamTimerInterval);
  if (dreamMediaRecorder && dreamMediaRecorder.state === 'recording') {
    dreamMediaRecorder.onstop = null;
    dreamMediaRecorder.stop();
  }
  if (dreamMediaRecorder && dreamMediaRecorder.stream) {
    dreamMediaRecorder.stream.getTracks().forEach(t => t.stop());
  }
  dreamAudioChunks = [];
  const bar = isAdmin ? document.getElementById('dreamAdminVoiceBar') : document.getElementById('dreamVoiceRecordingBar');
  if (bar) bar.classList.add('hidden');
}

async function stopAndSendDreamVoice(isAdmin = false) {
  if (!dreamMediaRecorder || dreamMediaRecorder.state !== 'recording') return;
  if (dreamTimerInterval) clearInterval(dreamTimerInterval);

  const durationStr = `${Math.floor(dreamTimerSeconds / 60)}:${String(dreamTimerSeconds % 60).padStart(2, '0')}`;

  dreamMediaRecorder.onstop = async () => {
    const bar = isAdmin ? document.getElementById('dreamAdminVoiceBar') : document.getElementById('dreamVoiceRecordingBar');
    if (bar) bar.classList.add('hidden');

    if (dreamMediaRecorder && dreamMediaRecorder.stream) {
      dreamMediaRecorder.stream.getTracks().forEach(t => t.stop());
    }

    if (dreamAudioChunks.length === 0) return;
    const blobType = dreamMediaRecorder.mimeType || 'audio/webm';
    const blob = new Blob(dreamAudioChunks, { type: blobType });
    const ext = blobType.includes('mp4') ? 'mp4' : (blobType.includes('ogg') ? 'ogg' : 'webm');
    const formData = new FormData();
    formData.append('voice', blob, `dream-voice-${Date.now()}.${ext}`);
    formData.append('duration', durationStr);

    const headers = {};
    if (isAdmin) {
      if (!activeDreamAdminSessionId) return;
      headers['Authorization'] = `Bearer ${token}`;
      formData.append('sessionId', activeDreamAdminSessionId);
    } else {
      const dToken = localStorage.getItem('seereen_dream_token');
      if (!dToken) return;
      headers['x-dream-token'] = dToken;
    }

    try {
      const res = await fetch('/api/dream/upload-voice', {
        method: 'POST',
        headers,
        body: formData
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'هەڵەیەک ڕوویدا لە ناردنی دەنگ');
        return;
      }
      appendDreamMessage(data.message, isAdmin);
    } catch (e) {
      alert('پەیوەندی لەگەڵ سێرڤەر ناتەواوە');
    }
  };

  dreamMediaRecorder.stop();
}

// --- SUPER ADMIN & TEACHER DASHBOARD (بەشی بەڕێوەبردنی خەونەکان) ---

async function loadDreamSessionsCount() {
  if (!token || !currentUser) return;
  if (currentUser.role !== 'super_admin' && currentUser.role !== 'teacher') return;

  try {
    const res = await fetch('/api/dream/admin/sessions', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return;
    const data = await res.json();
    const sessions = data.sessions || [];

    const countBadge = document.getElementById('dreamSessionsCountBadge');
    if (countBadge) countBadge.innerText = sessions.length;

    const modal = document.getElementById('dreamAdminModal');
    const isModalOpen = modal && !modal.classList.contains('hidden');
    const lastVisit = parseInt(localStorage.getItem('seereen_last_dream_visit') || '0', 10);

    const unreadSessions = sessions.filter(s => new Date(s.last_activity).getTime() > lastVisit);
    const unreadCount = unreadSessions.length;

    const badge = document.getElementById('dreamUnreadBadge');
    const mobileBadge = document.getElementById('mobileDreamUnreadBadge');

    if (unreadCount > 0 && !isModalOpen) {
      if (badge) {
        badge.innerText = unreadCount;
        badge.classList.remove('hidden');
      }
      if (mobileBadge) {
        mobileBadge.innerText = unreadCount;
        mobileBadge.classList.remove('hidden');
      }
    } else {
      if (badge) badge.classList.add('hidden');
      if (mobileBadge) mobileBadge.classList.add('hidden');
    }
  } catch (e) {}
}

function openDreamAdminModal() {
  localStorage.setItem('seereen_last_dream_visit', Date.now().toString());
  const badge = document.getElementById('dreamUnreadBadge');
  const mobileBadge = document.getElementById('mobileDreamUnreadBadge');
  if (badge) badge.classList.add('hidden');
  if (mobileBadge) mobileBadge.classList.add('hidden');

  const modal = document.getElementById('dreamAdminModal');
  if (!modal) return;
  modal.classList.remove('hidden');

  const sidebar = document.getElementById('dreamAdminSessionsSidebar');
  if (sidebar) sidebar.classList.remove('hidden');

  const roleIndicator = document.getElementById('dreamAdminRoleIndicator');
  if (roleIndicator) {
    if (currentUser && currentUser.role === 'super_admin') {
      roleIndicator.innerText = 'سوپەر ئەدمین (دەسەڵاتی تەواو)';
      roleIndicator.className = 'text-[10px] bg-amber-500/20 text-amber-300 font-bold px-2 py-0.5 rounded-md border border-amber-500/30';
    } else {
      roleIndicator.innerText = 'مامۆستا 👨‍🏫 (تەنها بینین)';
      roleIndicator.className = 'text-[10px] bg-purple-500/20 text-purple-300 font-bold px-2 py-0.5 rounded-md border border-purple-500/30';
    }
  }

  const availToggleWrapper = document.getElementById('dreamAvailabilityToggleWrapper');
  if (availToggleWrapper) {
    if (currentUser && currentUser.role === 'super_admin') {
      availToggleWrapper.classList.remove('hidden');
      fetchDreamAvailability();
    } else {
      availToggleWrapper.classList.add('hidden');
    }
  }

  const downloadAudioBtn = document.getElementById('dreamDownloadAllAudioBtn');
  if (downloadAudioBtn) {
    if (currentUser && currentUser.role === 'super_admin') {
      downloadAudioBtn.classList.remove('hidden');
    } else {
      downloadAudioBtn.classList.add('hidden');
    }
  }

  loadDreamAdminSessions();
  if (currentUser && currentUser.role === 'super_admin') {
    setTimeout(() => { requestDreamMicrophonePermission(); }, 250);
  }
}

function closeDreamAdminModal() {
  const modal = document.getElementById('dreamAdminModal');
  if (modal) modal.classList.add('hidden');
}

function backToDreamAdminSessions() {
  const sidebar = document.getElementById('dreamAdminSessionsSidebar');
  const chatArea = document.getElementById('dreamAdminChatArea');
  const emptyPrompt = document.getElementById('dreamAdminEmptyPrompt');
  if (sidebar) sidebar.classList.remove('hidden');
  if (chatArea) chatArea.classList.add('hidden');
  if (emptyPrompt) emptyPrompt.classList.remove('hidden');
}

let dreamSessionsActiveTab = 'all'; // 'all' or 'favorites'

function switchDreamSessionsTab(tab) {
  dreamSessionsActiveTab = tab;
  const tabAllBtn = document.getElementById('dreamTabAllBtn');
  const tabFavBtn = document.getElementById('dreamTabFavBtn');
  if (tab === 'all') {
    if (tabAllBtn) tabAllBtn.className = 'flex-1 py-1 rounded-lg text-white bg-purple-600 shadow transition flex items-center justify-center gap-1 text-[11px]';
    if (tabFavBtn) tabFavBtn.className = 'flex-1 py-1 rounded-lg text-slate-400 hover:text-amber-300 transition flex items-center justify-center gap-1 text-[11px]';
  } else {
    if (tabAllBtn) tabAllBtn.className = 'flex-1 py-1 rounded-lg text-slate-400 hover:text-white transition flex items-center justify-center gap-1 text-[11px]';
    if (tabFavBtn) tabFavBtn.className = 'flex-1 py-1 rounded-lg text-slate-950 font-black bg-amber-400 shadow transition flex items-center justify-center gap-1 text-[11px]';
  }
  renderDreamAdminSessionsCards();
}

function renderDreamAdminSessionsCards() {
  const allCount = dreamAdminSessionsCache.length;
  const favCount = dreamAdminSessionsCache.filter(s => s.is_favorite).length;

  const countAllBadge = document.getElementById('dreamCountAll');
  const countFavBadge = document.getElementById('dreamCountFavorites');
  const countTotalBadge = document.getElementById('dreamSessionsCountBadge');

  if (countAllBadge) countAllBadge.innerText = allCount;
  if (countFavBadge) countFavBadge.innerText = favCount;
  if (countTotalBadge) countTotalBadge.innerText = (dreamSessionsActiveTab === 'favorites') ? favCount : allCount;

  const listContainer = document.getElementById('dreamSessionsList');
  if (!listContainer) return;
  listContainer.innerHTML = '';

  let listToRender = dreamAdminSessionsCache;
  if (dreamSessionsActiveTab === 'favorites') {
    listToRender = dreamAdminSessionsCache.filter(s => s.is_favorite);
  }

  if (listToRender.length === 0) {
    if (dreamSessionsActiveTab === 'favorites') {
      listContainer.innerHTML = `
        <div class="text-center py-10 text-slate-500 text-xs px-3">
          <i class="fa-regular fa-star text-2xl text-amber-500/40 mb-2 block"></i>
          هیچ چاتێکی دڵخواز دیارینەکراوە.<br>
          <span class="text-[10px] text-slate-600 mt-1 block">دەتوانیت لە ڕێگەی ئەستێرەکەوە چاتە گرنگەکان بخەیتە ئێرە ⭐</span>
        </div>
      `;
    } else {
      listContainer.innerHTML = `
        <div class="text-center py-10 text-slate-500 text-xs">
          هیچ داواکارییەکی لێکدانەوەی خەون نییە
        </div>
      `;
    }
    return;
  }

  const isSuperAdmin = currentUser && currentUser.role === 'super_admin';

  listToRender.forEach(s => {
    const card = document.createElement('div');
    const isSelected = activeDreamAdminSessionId === s.id;
    const genderEmoji = s.dreamer_gender === 'female' ? '👧' : '👦';
    const timeStr = new Date(s.last_activity).toLocaleTimeString('ku-IQ', { hour: '2-digit', minute: '2-digit' });
    const isFav = !!s.is_favorite;

    card.className = `p-2.5 rounded-2xl cursor-pointer transition border text-right relative group ${
      isSelected 
        ? 'bg-purple-950/70 border-purple-500 shadow-md ring-1 ring-purple-500/50' 
        : 'bg-slate-900/80 hover:bg-slate-800/80 border-slate-800'
    }`;

    card.onclick = () => selectDreamSession(s.id);

    const starBtnHtml = isSuperAdmin ? `
      <button onclick="event.stopPropagation(); toggleDreamFavorite(${s.id})" class="p-1 text-xs rounded hover:bg-slate-700/60 transition ${isFav ? 'text-amber-400' : 'text-slate-500 hover:text-amber-400'}" title="${isFav ? 'لابردن لە دڵخواز' : 'کردن بە دڵخواز'}">
        <i class="${isFav ? 'fa-solid' : 'fa-regular'} fa-star"></i>
      </button>
    ` : (isFav ? '<span class="text-amber-400 text-xs">⭐</span>' : '');

    const deleteBtnHtml = isSuperAdmin ? `
      <button onclick="event.stopPropagation(); deleteDreamSession(${s.id})" class="opacity-70 group-hover:opacity-100 p-1 text-slate-500 hover:text-rose-400 text-xs rounded hover:bg-slate-700/60 transition" title="سڕینەوەی ئەم چاتە 🗑️">
        <i class="fa-solid fa-trash-can"></i>
      </button>
    ` : '';

    card.innerHTML = `
      <div class="flex items-center justify-between mb-1">
        <div class="flex items-center gap-1.5 overflow-hidden">
          <span>${genderEmoji}</span>
          <span class="font-bold text-xs truncate ${s.dreamer_gender === 'female' ? 'text-pink-400' : 'text-sky-400'}">${escapeHtml(s.dreamer_name)}</span>
        </div>
        <div class="flex items-center gap-1 shrink-0">
          <span class="text-[10px] text-slate-500 font-mono">${timeStr}</span>
          ${starBtnHtml}
          ${deleteBtnHtml}
        </div>
      </div>
      <div class="text-[11px] text-slate-400 truncate pr-1">
        ${escapeHtml(s.last_message_content || 'دانیشتنی نوێ')}
      </div>
    `;
    listContainer.appendChild(card);
  });
}

async function loadDreamAdminSessions() {
  if (!token) return;
  try {
    const res = await fetch('/api/dream/admin/sessions', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return;
    const data = await res.json();
    dreamAdminSessionsCache = data.sessions || [];
    renderDreamAdminSessionsCards();
  } catch (e) {
    console.error('Error loading dream admin sessions:', e);
  }
}

async function selectDreamSession(sessionId) {
  localStorage.setItem('seereen_last_dream_visit', Date.now().toString());
  const badge = document.getElementById('dreamUnreadBadge');
  const mobileBadge = document.getElementById('mobileDreamUnreadBadge');
  if (badge) badge.classList.add('hidden');
  if (mobileBadge) mobileBadge.classList.add('hidden');

  activeDreamAdminSessionId = sessionId;
  renderDreamAdminSessionsCards(); // refresh active highlight

  if (window.innerWidth < 768) {
    const sidebar = document.getElementById('dreamAdminSessionsSidebar');
    if (sidebar) sidebar.classList.add('hidden');
  }

  const emptyPrompt = document.getElementById('dreamAdminEmptyPrompt');
  const chatArea = document.getElementById('dreamAdminChatArea');
  if (emptyPrompt) emptyPrompt.classList.add('hidden');
  if (chatArea) chatArea.classList.remove('hidden');

  const isSuperAdmin = currentUser && currentUser.role === 'super_admin';
  const inputBar = document.getElementById('dreamAdminInputBar');
  const callBtn = document.getElementById('adminStartCallBtn');
  const teacherNotice = document.getElementById('dreamTeacherNotice');
  const favBtn = document.getElementById('dreamAdminFavBtn');
  const favIcon = document.getElementById('dreamAdminFavIcon');
  const deleteBtn = document.getElementById('dreamAdminDeleteBtn');

  if (isSuperAdmin) {
    if (inputBar) inputBar.classList.remove('hidden');
    if (callBtn) callBtn.classList.remove('hidden');
    if (teacherNotice) teacherNotice.classList.add('hidden');
    if (favBtn) favBtn.classList.remove('hidden');
    if (deleteBtn) deleteBtn.classList.remove('hidden');
  } else {
    // Teacher: READ-ONLY!
    if (inputBar) inputBar.classList.add('hidden');
    if (callBtn) callBtn.classList.add('hidden');
    if (teacherNotice) teacherNotice.classList.remove('hidden');
    if (favBtn) favBtn.classList.add('hidden');
    if (deleteBtn) deleteBtn.classList.add('hidden');
  }

  // Join room in socket
  if (socket) {
    socket.emit('dream_admin_join_session', sessionId);
  }

  try {
    const res = await fetch(`/api/dream/admin/session/${sessionId}/messages`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return;
    const data = await res.json();
    const session = data.session;

    const nameElem = document.getElementById('dreamAdminChatName');
    const genderElem = document.getElementById('dreamAdminChatGender');
    const statusElem = document.getElementById('dreamAdminChatStatus');

    if (nameElem) nameElem.innerText = session.dreamer_name;
    if (genderElem) genderElem.innerText = session.dreamer_gender === 'female' ? '👧' : '👦';
    if (statusElem) statusElem.innerText = `دەستپێکردن: ${new Date(session.created_at).toLocaleDateString('ku-IQ')}`;

    if (favIcon && favBtn) {
      if (session.is_favorite) {
        favIcon.className = 'fa-solid fa-star text-amber-400 text-sm';
        favBtn.title = 'لابردن لە دڵخوازەکان ⭐';
      } else {
        favIcon.className = 'fa-regular fa-star text-slate-400 text-sm';
        favBtn.title = 'کردن بە دڵخواز ⭐';
      }
    }

    const container = document.getElementById('dreamAdminMessagesContainer');
    if (container) {
      container.innerHTML = '';
      (data.messages || []).forEach(msg => appendDreamMessage(msg, true));
      scrollDreamMessagesToBottom(true);
    }

  } catch (e) {
    console.error('Error loading session messages:', e);
  }
}

async function toggleDreamFavorite(sessionId) {
  if (!token || !currentUser || currentUser.role !== 'super_admin') return;
  try {
    const res = await fetch(`/api/dream/admin/session/${sessionId}/favorite`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'هەڵەیەک ڕوویدا');
      return;
    }
    const session = dreamAdminSessionsCache.find(s => s.id === sessionId);
    if (session) {
      session.is_favorite = data.is_favorite;
    }
    renderDreamAdminSessionsCards();

    if (activeDreamAdminSessionId === sessionId) {
      const favIcon = document.getElementById('dreamAdminFavIcon');
      const favBtn = document.getElementById('dreamAdminFavBtn');
      if (favIcon && favBtn) {
        if (data.is_favorite) {
          favIcon.className = 'fa-solid fa-star text-amber-400 text-sm';
          favBtn.title = 'لابردن لە دڵخوازەکان ⭐';
        } else {
          favIcon.className = 'fa-regular fa-star text-slate-400 text-sm';
          favBtn.title = 'کردن بە دڵخواز ⭐';
        }
      }
    }
  } catch (err) {
    console.error('Error toggling dream favorite:', err);
  }
}

function toggleActiveDreamFavorite() {
  if (activeDreamAdminSessionId) {
    toggleDreamFavorite(activeDreamAdminSessionId);
  }
}

async function deleteDreamSession(sessionId) {
  if (!token || !currentUser || currentUser.role !== 'super_admin') return;
  const s = dreamAdminSessionsCache.find(x => x.id === sessionId);
  const name = s ? s.dreamer_name : 'ئەم خەون بینە';
  if (!confirm(`ئایا دڵنیایت لە سڕینەوەی چاتی (${name})؟\nسەرجەم دەنگەکان، نامەکان و تۆماری پەیوەندییەکانی بە یەکجاری دەسڕێنەوە!`)) {
    return;
  }

  try {
    const res = await fetch(`/api/dream/admin/session/${sessionId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || 'هەڵەیەک ڕوویدا لە سڕینەوە');
      return;
    }

    dreamAdminSessionsCache = dreamAdminSessionsCache.filter(x => x.id !== sessionId);

    if (activeDreamAdminSessionId === sessionId) {
      activeDreamAdminSessionId = null;
      const chatArea = document.getElementById('dreamAdminChatArea');
      const emptyPrompt = document.getElementById('dreamAdminEmptyPrompt');
      if (chatArea) chatArea.classList.add('hidden');
      if (emptyPrompt) emptyPrompt.classList.remove('hidden');
    }

    renderDreamAdminSessionsCards();
    loadDreamSessionsCount();
  } catch (err) {
    alert('پەیوەندی لەگەڵ سێرڤەر ناتەواوە');
  }
}

function deleteActiveDreamSession() {
  if (activeDreamAdminSessionId) {
    deleteDreamSession(activeDreamAdminSessionId);
  }
}

async function deleteSingleDreamMessage(msgId) {
  if (!token || !currentUser || currentUser.role !== 'super_admin') return;
  if (!confirm('ئایا دڵنیایت لە سڕینەوەی ئەم نامەیە؟')) return;

  try {
    const res = await fetch(`/api/dream/admin/message/${msgId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || 'هەڵەیەک ڕوویدا لە سڕینەوە');
      return;
    }
    const adminEl = document.getElementById(`dream-admin-msg-${msgId}`);
    if (adminEl) adminEl.remove();
  } catch (err) {
    alert('پەیوەندی لەگەڵ سێرڤەر ناتەواوە');
  }
}

function downloadAllAudioZip() {
  if (!token || !currentUser || currentUser.role !== 'super_admin') {
    alert('تەنها سوپەر ئەدمین دەسەڵاتی داگرتنی هەموو دەنگەکانی هەیە!');
    return;
  }
  const downloadUrl = `/api/admin/audio/download-all?token=${encodeURIComponent(token)}`;
  window.open(downloadUrl, '_blank');
}

function appendDreamAdminMessage(msg) {
  appendDreamMessage(msg, true);
}

// --- REAL-TIME LIVE AUDIO CALL ENGINE WITH AUTOMATIC TWO-WAY RECORDING ---

function startDreamCallFromDreamer() {
  if (currentDreamAvailability !== 'online') {
    alert('⚠️ لە ئێستادا پەیوەندی تەلەفۆنی ناگیرێت (دۆخی ستاف: چالاک نییە 🔴).\nتکایە خەونەکەت بە نامەی دەنگی (ڤۆیس) یان بە دەق لە چاتدا بنێرە و وەڵامت دەدرێتەوە 🌸');
    return;
  }
  if (!currentDreamSession) return;
  initiateDreamAudioCall(currentDreamSession.id, currentDreamSession.dreamer_name, 'dreamer');
}

function startDreamCallFromAdmin() {
  if (!currentUser || currentUser.role !== 'super_admin') {
    alert('تەنها سوپەر ئەدمین بۆی هەیە پەیوەندی تەلەفۆنی بکات!');
    return;
  }
  if (!activeDreamAdminSessionId) return;
  const session = dreamAdminSessionsCache.find(s => s.id === activeDreamAdminSessionId);
  const targetName = session ? session.dreamer_name : 'خەون بین';
  initiateDreamAudioCall(activeDreamAdminSessionId, targetName, 'admin');
}

async function initiateDreamAudioCall(sessionId, peerName, callerRole) {
  callActiveSessionId = sessionId;
  callRecordingUploaded = false;
  isCallInitiator = true;
  isCallMuted = false;
  isSpeakerMode = true;

  const overlay = document.getElementById('dreamCallOverlay');
  if (overlay) overlay.classList.remove('hidden');

  document.getElementById('callPeerName').innerText = peerName;
  document.getElementById('callStatusText').innerText = 'پەیوەندی دەبەسترێت و چاوەڕوانی وەڵامە...';
  document.getElementById('callTimerWrapper').classList.add('hidden');
  document.getElementById('callIncomingActions').classList.add('hidden');
  document.getElementById('callActiveActions').classList.remove('hidden');

  applyAudioOutputMode();
  playRingtone();

  // Send socket event
  const sock = callerRole === 'dreamer' ? dreamSocket : socket;
  if (sock) {
    sock.emit('dream_call_start', {
      sessionId,
      callerName: callerRole === 'dreamer' ? peerName : 'hemn taha',
      callerRole
    });
  }
}

function handleIncomingDreamCall(data, isAdmin) {
  // If teacher receives event -> ignore, only super_admin can answer!
  if (isAdmin && currentUser && currentUser.role !== 'super_admin') return;

  callActiveSessionId = data.sessionId;
  callRecordingUploaded = false;
  callPendingData = data;
  isCallInitiator = false;
  isCallMuted = false;
  isSpeakerMode = true;

  const overlay = document.getElementById('dreamCallOverlay');
  if (overlay) overlay.classList.remove('hidden');

  document.getElementById('callPeerName').innerText = data.callerName || 'پەیوەندیکەر';
  document.getElementById('callStatusText').innerText = '📞 پەیوەندی هاتوو...';
  document.getElementById('callTimerWrapper').classList.add('hidden');
  document.getElementById('callIncomingActions').classList.remove('hidden');
  document.getElementById('callActiveActions').classList.add('hidden');

  applyAudioOutputMode();
  playRingtone();
}

async function acceptIncomingDreamCall() {
  stopRingtone();
  callRecordingUploaded = false;
  isCallMuted = false;
  isSpeakerMode = true;
  document.getElementById('callIncomingActions').classList.add('hidden');
  document.getElementById('callActiveActions').classList.remove('hidden');
  document.getElementById('callStatusText').innerText = 'پەیوەندی بەسترا';
  applyAudioOutputMode();

  const sock = (currentUser && currentUser.role === 'super_admin') ? socket : dreamSocket;
  if (sock) {
    sock.emit('dream_call_accept', { sessionId: callActiveSessionId });
  }

  await establishWebRTCConnection(false);
}

function rejectIncomingDreamCall() {
  stopRingtone();
  const sock = (currentUser && currentUser.role === 'super_admin') ? socket : dreamSocket;
  if (sock) {
    sock.emit('dream_call_reject', { sessionId: callActiveSessionId });
  }
  closeDreamCallOverlay();
}

async function handleDreamCallAccepted(data) {
  stopRingtone();
  document.getElementById('callStatusText').innerText = 'پەیوەندی بەسترا';
  await establishWebRTCConnection(true);
}

function handleDreamCallRejected(data) {
  stopRingtone();
  alert('پەیوەندی ڕەتکرایەوە یان وەڵام نەدرایەوە');
  closeDreamCallOverlay();
}

async function handleDreamCallSignal(data) {
  if (!rtcPeerConn) return;
  try {
    if (data.sdp) {
      await rtcPeerConn.setRemoteDescription(new RTCSessionDescription(data.sdp));
      if (data.sdp.type === 'offer') {
        const answer = await rtcPeerConn.createAnswer();
        await rtcPeerConn.setLocalDescription(answer);
        const sock = (currentUser && currentUser.role === 'super_admin') ? socket : dreamSocket;
        if (sock) sock.emit('dream_call_signal', { sessionId: callActiveSessionId, sdp: answer });
      }
    } else if (data.candidate) {
      await rtcPeerConn.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
  } catch (e) {
    console.error('WebRTC signal handling error:', e);
  }
}

function handleDreamCallEnded() {
  cleanupCallResources();
  closeDreamCallOverlay();
}

function hangupDreamCall() {
  const sock = (currentUser && currentUser.role === 'super_admin') ? socket : dreamSocket;
  if (sock && callActiveSessionId) {
    sock.emit('dream_call_end', { sessionId: callActiveSessionId });
  }
  handleDreamCallEnded();
}

function closeDreamCallOverlay() {
  const overlay = document.getElementById('dreamCallOverlay');
  if (overlay) overlay.classList.add('hidden');
}

// WebRTC and Mixed Recording Setup
async function establishWebRTCConnection(isOffer) {
  try {
    callLocalStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    rtcPeerConn = new RTCPeerConnection(rtcIceConfig);

    callLocalStream.getTracks().forEach(track => rtcPeerConn.addTrack(track, callLocalStream));

    rtcPeerConn.onicecandidate = (event) => {
      if (event.candidate) {
        const sock = (currentUser && currentUser.role === 'super_admin') ? socket : dreamSocket;
        if (sock) sock.emit('dream_call_signal', { sessionId: callActiveSessionId, candidate: event.candidate });
      }
    };

    rtcPeerConn.ontrack = (event) => {
      callRemoteStream = event.streams[0];
      setupRemoteAudioPlayback(callRemoteStream);

      // START AUTOMATIC TWO-WAY AUDIO RECORDING ONLY ON ADMIN SIDE!
      // The dreamer browser does not record or upload secret recordings.
      if (currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'teacher' || currentUser.role === 'admin')) {
        startTwoWayCallRecording(callLocalStream, callRemoteStream, callActiveSessionId);
      }
    };

    if (isOffer) {
      const offer = await rtcPeerConn.createOffer();
      await rtcPeerConn.setLocalDescription(offer);
      const sock = (currentUser && currentUser.role === 'super_admin') ? socket : dreamSocket;
      if (sock) sock.emit('dream_call_signal', { sessionId: callActiveSessionId, sdp: offer });
    }

    startCallTimer();
  } catch (err) {
    console.error('WebRTC setup error:', err);
    startCallTimer();
  }
}

function setupRemoteAudioPlayback(stream) {
  const audioElem = document.getElementById('remoteCallAudio');
  if (audioElem) {
    audioElem.srcObject = stream;
    audioElem.muted = false;
    audioElem.volume = isSpeakerMode ? 1.0 : 0.35;
    audioElem.play().catch(e => console.log('Audio autoplay:', e));
  }
  
  enableWebAudioAmplifier(stream);
  applyAudioOutputMode();
}

function enableWebAudioAmplifier(stream) {
  if (!stream) return;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!callOutputAudioContext) {
      callOutputAudioContext = new AudioCtx();
    }
    if (callOutputAudioContext.state === 'suspended') {
      callOutputAudioContext.resume().catch(() => {});
    }
    if (!callOutputSource) {
      callOutputSource = callOutputAudioContext.createMediaStreamSource(stream);
      callOutputGainNode = callOutputAudioContext.createGain();
      callOutputGainNode.gain.setValueAtTime(isSpeakerMode ? 1.8 : 0.35, callOutputAudioContext.currentTime);
      callOutputSource.connect(callOutputGainNode);
      callOutputGainNode.connect(callOutputAudioContext.destination);

      if (callOutputAudioContext.state === 'running') {
        const audioElem = document.getElementById('remoteCallAudio');
        if (audioElem) audioElem.muted = true;
      }
    }
  } catch (e) {
    console.warn('Web Audio amplification fallback to audio element:', e);
    const audioElem = document.getElementById('remoteCallAudio');
    if (audioElem) audioElem.muted = false;
  }
}

async function toggleCallSpeaker() {
  isSpeakerMode = !isSpeakerMode;

  if (callOutputAudioContext && callOutputAudioContext.state === 'suspended') {
    try { await callOutputAudioContext.resume(); } catch (e) {}
  } else if (!callOutputAudioContext && callRemoteStream) {
    enableWebAudioAmplifier(callRemoteStream);
  }

  await applyAudioOutputMode();
}

async function applyAudioOutputMode() {
  const speakerBtn = document.getElementById('callSpeakerBtn');
  const speakerIcon = document.getElementById('callSpeakerIcon');
  const speakerLabel = document.getElementById('callSpeakerLabel');
  const modeDot = document.getElementById('callAudioModeDot');
  const modeText = document.getElementById('callAudioModeText');
  const audioElem = document.getElementById('remoteCallAudio');

  // Update UI Elements
  if (isSpeakerMode) {
    if (speakerBtn) {
      speakerBtn.className = 'w-14 h-14 rounded-2xl bg-purple-600 hover:bg-purple-500 text-white border border-purple-400 flex flex-col items-center justify-center transition active:scale-95 shadow-lg shadow-purple-900/40 group';
    }
    if (speakerIcon) {
      speakerIcon.className = 'fa-solid fa-volume-high text-lg group-hover:scale-110 transition';
    }
    if (speakerLabel) {
      speakerLabel.innerText = 'دەرەوە';
      speakerLabel.className = 'text-[10px] mt-0.5 text-purple-100 font-bold';
    }
    if (modeDot) modeDot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse';
    if (modeText) {
      modeText.innerText = 'سەوت: بڵندگۆ (دەرەوە) 🔊';
      modeText.className = 'text-xs font-bold text-emerald-300';
    }
  } else {
    if (speakerBtn) {
      speakerBtn.className = 'w-14 h-14 rounded-2xl bg-slate-800 hover:bg-slate-700 text-sky-300 border border-sky-500/50 flex flex-col items-center justify-center transition active:scale-95 shadow group';
    }
    if (speakerIcon) {
      speakerIcon.className = 'fa-solid fa-phone-volume text-lg group-hover:scale-110 transition text-sky-400';
    }
    if (speakerLabel) {
      speakerLabel.innerText = 'ناوەوە';
      speakerLabel.className = 'text-[10px] mt-0.5 text-sky-300 font-bold';
    }
    if (modeDot) modeDot.className = 'w-2.5 h-2.5 rounded-full bg-sky-400 animate-pulse';
    if (modeText) {
      modeText.innerText = 'سەوت: گوێچکە (ناوەوە) 📱';
      modeText.className = 'text-xs font-bold text-sky-300';
    }
  }

  // Adjust Volume / Gain
  if (callOutputAudioContext && callOutputAudioContext.state === 'running' && callOutputGainNode) {
    try {
      const targetGain = isSpeakerMode ? 1.8 : 0.35;
      callOutputGainNode.gain.setValueAtTime(targetGain, callOutputAudioContext.currentTime);
      if (audioElem) audioElem.muted = true;
    } catch (e) {
      if (audioElem) {
        audioElem.muted = false;
        audioElem.volume = isSpeakerMode ? 1.0 : 0.35;
      }
    }
  } else if (audioElem) {
    audioElem.muted = false;
    audioElem.volume = isSpeakerMode ? 1.0 : 0.35;
  }

  // Hardware output routing if setSinkId is supported (Desktop & Android Chrome)
  if (audioElem && typeof audioElem.setSinkId === 'function') {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioOutputs = devices.filter(d => d.kind === 'audiooutput');
      if (audioOutputs.length > 0) {
        if (isSpeakerMode) {
          const spk = audioOutputs.find(d => /speaker|loudspeaker|دەرەوە|بڵندگۆ/i.test(d.label));
          await audioElem.setSinkId(spk ? spk.deviceId : '');
        } else {
          const ear = audioOutputs.find(d => /earpiece|receiver|handset|internal|headset|phone|گوێچکە|ناوەوە/i.test(d.label));
          await audioElem.setSinkId(ear ? ear.deviceId : '');
        }
      }
    } catch (e) {
      console.warn('setSinkId output route change failed:', e);
    }
  }
}

function startCallTimer() {
  document.getElementById('callTimerWrapper').classList.remove('hidden');
  const timerElem = document.getElementById('callDurationTimer');
  callTimerSeconds = 0;
  if (timerElem) timerElem.innerText = '00:00';
  if (callTimerInterval) clearInterval(callTimerInterval);
  callTimerInterval = setInterval(() => {
    callTimerSeconds++;
    const mins = String(Math.floor(callTimerSeconds / 60)).padStart(2, '0');
    const secs = String(callTimerSeconds % 60).padStart(2, '0');
    if (timerElem) timerElem.innerText = `${mins}:${secs}`;
  }, 1000);
}

// Two-Way Audio Mixing via AudioContext Destination
function startTwoWayCallRecording(localStream, remoteStream, sessionId) {
  try {
    callTwoWayChunks = [];
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    callAudioContext = new AudioContextClass();
    const dest = callAudioContext.createMediaStreamDestination();

    if (localStream && localStream.getAudioTracks().length > 0) {
      const src1 = callAudioContext.createMediaStreamSource(localStream);
      src1.connect(dest);
    }
    if (remoteStream && remoteStream.getAudioTracks().length > 0) {
      const src2 = callAudioContext.createMediaStreamSource(remoteStream);
      src2.connect(dest);
    }

    let mimeType = '';
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported) {
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) mimeType = 'audio/webm;codecs=opus';
      else if (MediaRecorder.isTypeSupported('audio/webm')) mimeType = 'audio/webm';
      else if (MediaRecorder.isTypeSupported('audio/mp4')) mimeType = 'audio/mp4';
      else if (MediaRecorder.isTypeSupported('audio/aac')) mimeType = 'audio/aac';
      else if (MediaRecorder.isTypeSupported('audio/ogg')) mimeType = 'audio/ogg';
    }
    const options = mimeType ? { mimeType } : {};
    callTwoWayRecorder = new MediaRecorder(dest.stream, options);

    callTwoWayRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) callTwoWayChunks.push(e.data);
    };

    callTwoWayRecorder.onstop = async () => {
      if (callTwoWayChunks.length === 0 || callRecordingUploaded) return;
      callRecordingUploaded = true;
      const durationStr = `${Math.floor(callTimerSeconds / 60)}:${String(callTimerSeconds % 60).padStart(2, '0')}`;
      const blobType = callTwoWayRecorder.mimeType || 'audio/webm';
      const ext = blobType.includes('mp4') ? 'mp4' : (blobType.includes('ogg') ? 'ogg' : 'webm');
      const blob = new Blob(callTwoWayChunks, { type: blobType });
      await uploadCallRecording(blob, sessionId, durationStr, ext);
    };

    callTwoWayRecorder.start(1000);
  } catch (err) {
    console.error('Two-way recording error:', err);
  }
}

async function uploadCallRecording(blob, sessionId, durationStr, ext = 'webm') {
  try {
    const formData = new FormData();
    formData.append('call_recording', blob, `call-record-${Date.now()}.${ext}`);
    formData.append('sessionId', sessionId);
    formData.append('duration', durationStr);

    await fetch('/api/dream/upload-call-recording', {
      method: 'POST',
      body: formData
    });
  } catch (e) {
    console.error('Failed to upload call recording:', e);
  }
}

function toggleCallMute() {
  if (!callLocalStream) return;
  isCallMuted = !isCallMuted;
  callLocalStream.getAudioTracks().forEach(t => t.enabled = !isCallMuted);
  
  const muteBtn = document.getElementById('callMuteBtn');
  const muteIcon = document.getElementById('callMuteIcon');
  const muteLabel = document.getElementById('callMuteLabel');

  if (muteBtn) {
    if (isCallMuted) {
      muteBtn.className = 'w-14 h-14 rounded-2xl bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-500/60 flex flex-col items-center justify-center transition active:scale-95 shadow-lg shadow-rose-950/50 group';
    } else {
      muteBtn.className = 'w-14 h-14 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700/80 flex flex-col items-center justify-center transition active:scale-95 shadow group';
    }
  }

  if (muteIcon) {
    muteIcon.className = isCallMuted ? 'fa-solid fa-microphone-slash text-lg text-rose-400' : 'fa-solid fa-microphone text-lg';
  }

  if (muteLabel) {
    muteLabel.innerText = isCallMuted ? 'بێدەنگ' : 'مایک';
    muteLabel.className = isCallMuted ? 'text-[10px] mt-0.5 text-rose-300 font-bold' : 'text-[10px] mt-0.5 text-slate-300 font-bold';
  }
}

function cleanupCallResources() {
  stopRingtone();
  if (callTimerInterval) {
    clearInterval(callTimerInterval);
    callTimerInterval = null;
  }
  if (callTwoWayRecorder && callTwoWayRecorder.state === 'recording') {
    callTwoWayRecorder.stop();
    setTimeout(() => {
      if (callLocalStream) {
        callLocalStream.getTracks().forEach(t => t.stop());
        callLocalStream = null;
      }
      if (callAudioContext) {
        try { callAudioContext.close(); } catch (e) {}
        callAudioContext = null;
      }
    }, 600);
  } else {
    if (callLocalStream) {
      callLocalStream.getTracks().forEach(t => t.stop());
      callLocalStream = null;
    }
    if (callAudioContext) {
      try { callAudioContext.close(); } catch (e) {}
      callAudioContext = null;
    }
  }

  // Cleanup Web Audio output amplifier
  if (callOutputAudioContext) {
    try { callOutputAudioContext.close(); } catch (e) {}
    callOutputAudioContext = null;
  }
  callOutputGainNode = null;
  callOutputSource = null;

  // Cleanup remote audio element
  const audioElem = document.getElementById('remoteCallAudio');
  if (audioElem) {
    audioElem.pause();
    audioElem.srcObject = null;
    audioElem.muted = false;
  }

  if (rtcPeerConn) {
    rtcPeerConn.close();
    rtcPeerConn = null;
  }
  callRemoteStream = null;
  callActiveSessionId = null;
  callPendingData = null;
  isCallMuted = false;
  isSpeakerMode = true;

  // Reset Mute button UI
  const muteBtn = document.getElementById('callMuteBtn');
  const muteIcon = document.getElementById('callMuteIcon');
  const muteLabel = document.getElementById('callMuteLabel');
  if (muteBtn) muteBtn.className = 'w-14 h-14 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700/80 flex flex-col items-center justify-center transition active:scale-95 shadow group';
  if (muteIcon) muteIcon.className = 'fa-solid fa-microphone text-lg';
  if (muteLabel) { muteLabel.innerText = 'مایک'; muteLabel.className = 'text-[10px] mt-0.5 text-slate-300 font-bold'; }

  applyAudioOutputMode();
}

// ==========================================
// 1. PWA INSTALLATION & SERVICE WORKER
// ==========================================
let pwaDeferredPrompt = null;

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.log('SW registration note:', err);
    });
  });
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  pwaDeferredPrompt = e;
  const pwaBtn = document.getElementById('pwaInstallBtn');
  const mobilePwaBtn = document.getElementById('mobilePwaInstallBtn');
  if (pwaBtn) pwaBtn.classList.remove('hidden');
  if (mobilePwaBtn) mobilePwaBtn.classList.remove('hidden');
});

window.addEventListener('appinstalled', () => {
  pwaDeferredPrompt = null;
  const pwaBtn = document.getElementById('pwaInstallBtn');
  const mobilePwaBtn = document.getElementById('mobilePwaInstallBtn');
  if (pwaBtn) pwaBtn.classList.add('hidden');
  if (mobilePwaBtn) mobilePwaBtn.classList.add('hidden');
  console.log('PWA app installed successfully');
});

async function installPwaApp() {
  if (!pwaDeferredPrompt) {
    alert('ئەپی سیرین پێشتر دابەزێنراوە یان وێبگەڕەکەت ڕێگری دەکات. لە ڕێگەی مینیۆی براوزەرەکەتەوە (Add to Home screen / Install app) هەڵبژێرە.');
    return;
  }
  pwaDeferredPrompt.prompt();
  const choiceResult = await pwaDeferredPrompt.userChoice;
  if (choiceResult && choiceResult.outcome === 'accepted') {
    const pwaBtn = document.getElementById('pwaInstallBtn');
    const mobilePwaBtn = document.getElementById('mobilePwaInstallBtn');
    if (pwaBtn) pwaBtn.classList.add('hidden');
    if (mobilePwaBtn) mobilePwaBtn.classList.add('hidden');
  }
  pwaDeferredPrompt = null;
}

// ==========================================
// 2. CHAT INSTANT SEARCH
// ==========================================
function toggleChatSearch() {
  const bar = document.getElementById('chatSearchBar');
  const input = document.getElementById('chatSearchInput');
  const counter = document.getElementById('chatSearchResultsCount');
  if (!bar) return;

  const isHidden = bar.classList.contains('hidden');
  if (isHidden) {
    bar.classList.remove('hidden');
    if (input) {
      input.value = '';
      setTimeout(() => input.focus(), 100);
    }
    if (counter) counter.innerText = '';
  } else {
    bar.classList.add('hidden');
    if (input) input.value = '';
    filterChatMessages('');
  }
}

function filterChatMessages(query) {
  const container = document.getElementById('messagesContainer');
  const counter = document.getElementById('chatSearchResultsCount');
  if (!container) return;

  const q = (query || '').trim().toLowerCase();
  const items = container.querySelectorAll('.chat-msg-item');

  if (!q) {
    items.forEach(el => el.classList.remove('hidden'));
    if (counter) counter.innerText = '';
    return;
  }

  let matchCount = 0;
  items.forEach(el => {
    const text = (el.innerText || '').toLowerCase();
    if (text.includes(q)) {
      el.classList.remove('hidden');
      matchCount++;
    } else {
      el.classList.add('hidden');
    }
  });

  if (counter) {
    counter.innerText = matchCount > 0 ? `${matchCount} پەیام دۆزرایەوە` : 'هیچ نەدۆزرایەوە';
  }
}

// ==========================================
// 3. DREAM AVAILABILITY (ONLINE / AWAY)
// ==========================================
let currentDreamAvailability = 'online';

function updateDreamAvailabilityUI(data) {
  if (!data) return;
  const status = data.status || 'online';
  const message = data.message || '';
  currentDreamAvailability = status;

  // 1. Auth modal badge for dreamers
  const authBadge = document.getElementById('dreamAuthStatusBadge');
  const authDot = document.getElementById('dreamAuthStatusDot');
  const authText = document.getElementById('dreamAuthStatusText');
  if (authBadge && authDot && authText) {
    if (status === 'online') {
      authBadge.className = 'p-2.5 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-xs text-emerald-300 font-bold flex items-center gap-2';
      authDot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse';
      authText.innerText = 'پەیوەندی کارایە ✨ دەتوانیت پەیوەندی تەلەفۆنی بکەیت یان بنووسیت';
    } else {
      authBadge.className = 'p-2.5 rounded-xl bg-rose-950/40 border border-rose-500/40 text-xs text-rose-300 font-bold flex items-center gap-2';
      authDot.className = 'w-2.5 h-2.5 rounded-full bg-rose-500';
      authText.innerText = 'چالاک نییە 🔴 - لە ئێستادا پەیوەندی تەلەفۆن ناگیرێت، بەڵام دەتوانیت لە چات بنووسیت یان بە دەنگ خەونەکەت باس بکەیت';
    }
  }

  // 2. Admin panel toggle button
  const toggleBtn = document.getElementById('dreamAvailabilityToggleBtn');
  const toggleDot = document.getElementById('dreamAvailabilityDot');
  const toggleLabel = document.getElementById('dreamAvailabilityLabel');
  if (toggleBtn && toggleDot && toggleLabel) {
    if (status === 'online') {
      toggleBtn.className = 'px-2.5 py-1 rounded-lg text-[10px] font-black transition flex items-center gap-1.5 bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-600/40 active:scale-95';
      toggleDot.className = 'w-2 h-2 rounded-full bg-emerald-400 animate-pulse';
      toggleLabel.innerText = 'پەیوەندی کارایە 🟢';
    } else {
      toggleBtn.className = 'px-2.5 py-1 rounded-lg text-[10px] font-black transition flex items-center gap-1.5 bg-rose-600/30 text-rose-300 border border-rose-500/40 hover:bg-rose-600/40 active:scale-95';
      toggleDot.className = 'w-2 h-2 rounded-full bg-rose-500';
      toggleLabel.innerText = 'چالاک نییە 🔴';
    }
  }

  // 3. Dreamer chat modal header status text & calling button lock
  const dreamChatStatusText = document.getElementById('dreamAdminStatusText');
  const dreamChatStatusDot = document.getElementById('dreamAdminStatusDot');
  const dreamerCallBtn = document.getElementById('dreamerCallBtn');

  if (dreamChatStatusText && dreamChatStatusDot) {
    if (status === 'online') {
      dreamChatStatusText.innerText = 'پەیوەندی کارایە';
      dreamChatStatusText.className = 'font-bold text-emerald-400';
      dreamChatStatusDot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse';
    } else {
      dreamChatStatusText.innerText = 'چالاک نییە 🔴';
      dreamChatStatusText.className = 'font-bold text-rose-400';
      dreamChatStatusDot.className = 'w-2.5 h-2.5 rounded-full bg-rose-500';
    }
  }

  if (dreamerCallBtn) {
    if (status === 'online') {
      dreamerCallBtn.className = 'px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow transition flex items-center gap-1.5 active:scale-95 cursor-pointer opacity-100';
      dreamerCallBtn.title = 'پەیوەندی تەلەفۆنی ڕاستەوخۆ';
    } else {
      dreamerCallBtn.className = 'px-3 py-1.5 bg-slate-800 text-slate-400 border border-rose-500/40 font-bold text-xs rounded-xl shadow transition flex items-center gap-1.5 cursor-not-allowed opacity-60';
      dreamerCallBtn.title = 'تەلەفۆن ڕاگیراوە چونکە دۆخی ستاف چالاک نییە';
    }
  }
}

async function fetchDreamAvailability() {
  try {
    const res = await fetch('/api/dream/availability');
    if (res.ok) {
      const data = await res.json();
      updateDreamAvailabilityUI(data);
    }
  } catch (e) {
    console.error('Failed to fetch dream availability:', e);
  }
}

async function toggleDreamAvailability() {
  if (!currentUser || currentUser.role !== 'super_admin') return;
  const newStatus = (currentDreamAvailability === 'online') ? 'away' : 'online';
  try {
    const res = await fetch('/api/dream/availability', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ status: newStatus })
    });
    if (res.ok) {
      const data = await res.json();
      updateDreamAvailabilityUI({ status: newStatus, message: data.message });
    }
  } catch (e) {
    console.error('Failed to toggle dream availability:', e);
  }
}


