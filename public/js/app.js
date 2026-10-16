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

function showLiveToastNotification(message, color = 'emerald') {
  const toast = document.createElement('div');
  const bgClass = color === 'emerald' ? 'bg-emerald-600/95 border-emerald-400' : 'bg-amber-600/95 border-amber-400';
  toast.className = `fixed top-16 left-1/2 -translate-x-1/2 z-[100] px-4 py-2 rounded-2xl ${bgClass} text-white font-black text-xs shadow-2xl border backdrop-blur-md flex items-center gap-2 transition-all transform duration-300`;
  toast.innerHTML = `<span>${message}</span>`;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translate(-50%, -20px)';
    setTimeout(() => toast.remove(), 400);
  }, 4000);
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

  // Handle mobile keyboard adaptation and secret answer draft
  const secretInput = document.getElementById('modalStickySecretAnswerInput');
  if (secretInput) {
    secretInput.addEventListener('input', (e) => {
      if (activeQuestion && activeQuestion.id) {
        localStorage.setItem('draft_ans_' + activeQuestion.id, e.target.value);
      }
    });
    secretInput.addEventListener('focus', () => {
      setTimeout(() => {
        secretInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 250);
    });
  }

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      const activeModal = document.getElementById('activeQuestionModal');
      const modalCard = document.getElementById('activeQuestionModalCard');
      if (activeModal && !activeModal.classList.contains('hidden') && modalCard) {
        const vpHeight = window.visualViewport.height;
        if (window.innerHeight - vpHeight > 100) {
          modalCard.style.maxHeight = `${Math.floor(vpHeight * 0.9)}px`;
          const input = document.getElementById('modalStickySecretAnswerInput');
          if (input && document.activeElement === input) {
            input.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        } else {
          modalCard.style.maxHeight = '';
        }
      }
    });
  }

  // Handle ESC key to close drawer or active question modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const drawer = document.getElementById('mainMenuDrawer');
      if (drawer && !drawer.classList.contains('hidden')) {
        closeMainMenuDrawer();
      }
    }
  });

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
  updatePrivateUnreadBadge();
  initQuranSurahsList();

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

function togglePasswordVisibility(inputId, iconId) {
  const input = document.getElementById(inputId);
  const icon = document.getElementById(iconId);
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    if (icon) {
      icon.classList.remove('fa-eye');
      icon.classList.add('fa-eye-slash');
    }
  } else {
    input.type = 'password';
    if (icon) {
      icon.classList.remove('fa-eye-slash');
      icon.classList.add('fa-eye');
    }
  }
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

  // Drawer elements
  const drawerStaffSection = document.getElementById('drawerStaffSection');
  const drawerPostQuestionBtn = document.getElementById('drawerPostQuestionBtn');
  const drawerUnansweredBtn = document.getElementById('drawerUnansweredBtn');
  const drawerAdminPanelBtn = document.getElementById('drawerAdminPanelBtn');
  const drawerDreamAdminBtn = document.getElementById('drawerDreamAdminBtn');
  const drawerMembersBtn = document.getElementById('drawerMembersBtn');
  const drawerLibraryBtn = document.getElementById('drawerLibraryBtn');

  if (drawerStaffSection) {
    if (isAdmin) {
      drawerStaffSection.classList.remove('hidden');
    } else {
      drawerStaffSection.classList.add('hidden');
    }
  }

  if (isSuperAdmin) {
    if (adminPanelBtn) adminPanelBtn.classList.remove('hidden');
    if (drawerAdminPanelBtn) drawerAdminPanelBtn.classList.remove('hidden');
  } else {
    if (adminPanelBtn) adminPanelBtn.classList.add('hidden');
    if (drawerAdminPanelBtn) drawerAdminPanelBtn.classList.add('hidden');
  }

  const dreamAdminNavBtn = document.getElementById('dreamAdminNavBtn');
  if (isSuperAdmin || isTeacher) {
    if (dreamAdminNavBtn) dreamAdminNavBtn.classList.remove('hidden');
    if (drawerDreamAdminBtn) drawerDreamAdminBtn.classList.remove('hidden');
    loadDreamSessionsCount();
  } else {
    if (dreamAdminNavBtn) dreamAdminNavBtn.classList.add('hidden');
    if (drawerDreamAdminBtn) drawerDreamAdminBtn.classList.add('hidden');
  }

  if (isAdmin) {
    if (postQuestionNavBtn) postQuestionNavBtn.classList.remove('hidden');
    if (drawerPostQuestionBtn) drawerPostQuestionBtn.classList.remove('hidden');
    if (unansweredStatsNavBtn) unansweredStatsNavBtn.classList.remove('hidden');
    if (drawerUnansweredBtn) drawerUnansweredBtn.classList.remove('hidden');
    if (adminMediaTools) {
      adminMediaTools.classList.remove('hidden');
      adminMediaTools.classList.add('flex');
    }
    if (libraryUploadSection) libraryUploadSection.classList.remove('hidden');
    if (drawerMembersBtn) drawerMembersBtn.classList.remove('hidden');
    if (membersNavBtn) membersNavBtn.classList.remove('hidden');
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
    if (postQuestionNavBtn) postQuestionNavBtn.classList.add('hidden');
    if (drawerPostQuestionBtn) drawerPostQuestionBtn.classList.add('hidden');
    if (unansweredStatsNavBtn) unansweredStatsNavBtn.classList.add('hidden');
    if (drawerUnansweredBtn) drawerUnansweredBtn.classList.add('hidden');
    if (adminMediaTools) {
      adminMediaTools.classList.add('hidden');
      adminMediaTools.classList.remove('flex');
    }
    if (libraryUploadSection) libraryUploadSection.classList.add('hidden');
    if (drawerMembersBtn) drawerMembersBtn.classList.add('hidden');
    if (membersNavBtn) membersNavBtn.classList.add('hidden');
    if (membersSidebar) {
      membersSidebar.classList.add('hidden');
      membersSidebar.classList.remove('flex');
      membersSidebar.classList.add('translate-x-full');
    }
    const membersBackdrop = document.getElementById('membersBackdrop');
    if (membersBackdrop) membersBackdrop.classList.add('hidden');
  }

  // Library button visibility: hidden only for guests
  if (currentUser.role === 'guest') {
    if (libraryNavBtn) libraryNavBtn.classList.add('hidden');
    if (drawerLibraryBtn) drawerLibraryBtn.classList.add('hidden');
  } else {
    if (libraryNavBtn) libraryNavBtn.classList.remove('hidden');
    if (drawerLibraryBtn) drawerLibraryBtn.classList.remove('hidden');
  }

  // Live Lesson ("وانە") Controls configuration
  const liveStartEndBtn = document.getElementById('liveStartEndBtn');
  const liveScreenShareBtn = document.getElementById('liveScreenShareBtn');
  const liveQuranAdminControls = document.getElementById('liveQuranAdminControls');
  const liveQuranStudentNotice = document.getElementById('liveQuranStudentNotice');
  const liveRecordBtn = document.getElementById('liveRecordBtn');

  // Start/End Lesson & Screen share: Super Admin & Teacher ONLY (strictly hidden from students)
  if (isSuperAdmin || isTeacher) {
    if (liveStartEndBtn) {
      liveStartEndBtn.classList.remove('hidden');
      liveStartEndBtn.classList.add('flex');
      liveStartEndBtn.style.setProperty('display', 'flex', 'important');
    }
    if (liveScreenShareBtn) {
      liveScreenShareBtn.classList.remove('hidden');
      liveScreenShareBtn.classList.add('flex');
      liveScreenShareBtn.style.setProperty('display', 'flex', 'important');
    }
  } else {
    if (liveStartEndBtn) {
      liveStartEndBtn.classList.add('hidden');
      liveStartEndBtn.classList.remove('flex');
      liveStartEndBtn.style.setProperty('display', 'none', 'important');
    }
    if (liveScreenShareBtn) {
      liveScreenShareBtn.classList.add('hidden');
      liveScreenShareBtn.classList.remove('flex');
      liveScreenShareBtn.style.setProperty('display', 'none', 'important');
    }
  }

  // Quran changing controls & Recording button: visible to Super Admin, Teacher, and Admin ONLY
  if (isAdmin) {
    if (liveQuranAdminControls) liveQuranAdminControls.classList.remove('hidden');
    if (liveQuranStudentNotice) liveQuranStudentNotice.classList.add('hidden');
    if (liveRecordBtn) {
      liveRecordBtn.classList.remove('hidden');
      liveRecordBtn.classList.add('flex');
    }
  } else {
    if (liveQuranAdminControls) liveQuranAdminControls.classList.add('hidden');
    if (liveQuranStudentNotice) liveQuranStudentNotice.classList.remove('hidden');
    if (liveRecordBtn) {
      liveRecordBtn.classList.add('hidden');
      liveRecordBtn.classList.remove('flex');
    }
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

  socket.on('connect', () => {
    socket.emit('live_get_state');
    updatePrivateUnreadBadge();
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
      closeActiveQuestionModal();
    }
    playSound('question');
    triggerStarCelebration();
  });

  socket.on('question_closed', (data) => {
    if (activeQuestion && (!data || !data.question_id || activeQuestion.id === data.question_id)) {
      activeQuestion = null;
      stopQuestionCountdown();
      renderActiveQuestionSticky(null);
      closeActiveQuestionModal();
    }
  });

  socket.on('question_cancelled', (data) => {
    if (activeQuestion && (!data || !data.question_id || activeQuestion.id === data.question_id)) {
      activeQuestion = null;
      stopQuestionCountdown();
      renderActiveQuestionSticky(null);
      closeActiveQuestionModal();
    }
  });

  socket.on('question_updated', (data) => {
    if (activeQuestion && activeQuestion.id === data.question_id) {
      activeQuestion.question_text = data.question_text;
      if (data.model_answer !== undefined) activeQuestion.model_answer = data.model_answer;
      if (data.expires_at) activeQuestion.expires_at = data.expires_at;
      renderActiveQuestionSticky(activeQuestion);
    }
    loadMessages();
  });

  socket.on('questions_renumbered', () => {
    loadMessages();
  });

  socket.on('user_stars_updated', (data) => {
    if (currentUser && currentUser.id === data.user_id) {
      currentUser.correct_answers_count = data.new_stars;
      updateUserUI();
      if (data.delta > 0) triggerStarCelebration();
    }
    if (typeof currentProfileUserId !== 'undefined' && currentProfileUserId === data.user_id) {
      const starInfo = calculateStars(data.new_stars);
      const profStars = document.getElementById('profStars');
      if (profStars) profStars.innerHTML = `${starInfo.starIcons} (${starInfo.points}/10)`;
    }
    loadPodiumWidget();
    loadLeaderboard();
  });

  socket.on('new_profile_change_request', () => {
    if (currentUser && currentUser.role === 'super_admin') {
      loadPendingProfileChangesCount();
    }
  });

  socket.on('live_teacher_joined', (data) => {
    playSound('question');
    showLiveToastNotification(`🔔 مامۆستا (${data.fullName}) هاتە ژووری وانە`, 'emerald');
  });

  socket.on('live_teacher_left', (data) => {
    playSound('mute');
    showLiveToastNotification(`🚪 مامۆستا (${data.fullName}) لە وانە چووە دەرەوە`, 'amber');
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

  // Question submission evaluation updated (⭐ or ❌)
  socket.on('submission_evaluated', (data) => {
    handleSubmissionEvaluated(data);
  });

  // Message reaction updated (🏆, 🤲, 👍, 💯)
  socket.on('message_reaction_updated', (data) => {
    const el = document.getElementById(`msg-reactions-${data.message_id}`);
    if (el) el.innerHTML = renderMessageReactionsHtml(data.reactions, data.message_id);
  });

  // New private message received
  socket.on('new_private_message', (msg) => {
    handleNewPrivateMessage(msg);
  });

  // Live Lesson ("وانە") events
  socket.on('live_lesson_state', (state) => {
    handleLiveLessonStateUpdate(state);
  });

  socket.on('live_lesson_started_alert', (data) => {
    handleLiveStartedAlert(data);
  });

  socket.on('live_lesson_ended_notice', () => {
    handleLiveEndedNotice();
  });

  socket.on('live_mic_permission_granted', () => {
    handleLiveMicGranted();
  });

  socket.on('live_mic_permission_revoked', () => {
    handleLiveMicRevoked();
  });

  socket.on('live_kicked_notice', (reason) => {
    handleLiveKicked(reason);
  });

  socket.on('live_quran_playing', (data) => {
    handleLiveQuranPlaying(data);
  });

  socket.on('live_quran_stopped', () => {
    handleLiveQuranStopped();
  });

  socket.on('live_screen_started', (data) => {
    handleLiveScreenStarted(data);
  });

  socket.on('live_screen_stopped', () => {
    handleLiveScreenStopped();
  });

  socket.on('live_signal', (data) => {
    handleLiveSignal(data);
  });

  socket.on('live_peer_joined', (data) => {
    handleLivePeerJoined(data);
  });

  socket.on('live_peer_left', (data) => {
    handleLivePeerLeft(data);
  });

  socket.on('live_audio_chunk', (data) => {
    handleLiveAudioChunk(data);
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
  const isStaff = currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'teacher');
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
          
          let cardBorderClass = 'border-slate-700/70 bg-slate-800/80 hover:border-slate-600';
          let statusBadge = '';
          
          if (s.is_awarded === 1) {
            cardBorderClass = 'border-2 border-emerald-500/80 bg-emerald-950/25 ring-1 ring-emerald-500/30 shadow-md shadow-emerald-500/10';
            statusBadge = `
              <span class="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-black text-[11px] rounded-lg inline-flex items-center gap-1 animate-pulse">
                <i class="fa-solid fa-star text-amber-400"></i>
                <span>وەڵامی دروستە ⭐</span>
              </span>
            `;
          } else if (s.is_awarded === -1) {
            cardBorderClass = 'border-2 border-rose-500/70 bg-rose-950/20 ring-1 ring-rose-500/30 shadow-md shadow-rose-500/10';
            statusBadge = `
              <span class="px-2 py-0.5 bg-rose-500/20 text-rose-300 border border-rose-500/40 font-black text-[11px] rounded-lg inline-flex items-center gap-1">
                <i class="fa-solid fa-circle-xmark text-rose-400"></i>
                <span>وەڵامی هەڵەیە ❌</span>
              </span>
            `;
          }

          return `
            <div id="sub-card-${payload.question_id}-${s.user_id}" class="submission-card-item p-3 sm:p-3.5 rounded-2xl border flex items-start justify-between gap-3 transition-all duration-200 ${cardBorderClass}">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1.5 flex-wrap">
                  <span class="text-xs font-mono font-bold text-slate-400">${idx + 1}.</span>
                  <span class="text-xs font-black cursor-pointer hover:underline ${sNameClass}" onclick="openUserProfileModal(${s.user_id})">${escapeHtml(s.full_name)}</span>
                  <span class="text-[10px] text-slate-500 font-mono">${timeFormatted}</span>
                  <span class="eval-badge-container-${payload.question_id}-${s.user_id}">
                    ${statusBadge}
                  </span>
                </div>
                <div class="text-xs md:text-sm text-slate-100 bg-slate-900/90 p-2.5 rounded-xl border border-slate-800 font-medium whitespace-pre-wrap leading-relaxed select-text">
                  "${escapeHtml(s.answer_text)}"
                </div>
              </div>
              <div class="shrink-0 mt-1 eval-slot eval-slot-${payload.question_id}-${s.user_id}">
                ${isStaff ? `
                  ${s.is_awarded === 1 ? `
                    <div class="flex items-center gap-1">
                      <span class="px-2.5 py-1 bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 font-black text-xs rounded-xl inline-flex items-center gap-1">
                        <i class="fa-solid fa-circle-check text-emerald-400"></i>
                        <span>ڕاستە ⭐</span>
                      </span>
                      <button onclick="resetEvaluationFromReveal(${payload.question_id}, ${s.user_id}, '${escapeHtml(s.full_name)}', this)" class="p-1 hover:bg-slate-700 text-slate-400 hover:text-white rounded-lg text-xs" title="گەڕاندنەوە">
                        <i class="fa-solid fa-rotate-left text-[10px]"></i>
                      </button>
                    </div>
                  ` : (s.is_awarded === -1 ? `
                    <div class="flex items-center gap-1">
                      <span class="px-2.5 py-1 bg-rose-600/30 text-rose-300 border border-rose-500/40 font-black text-xs rounded-xl inline-flex items-center gap-1">
                        <i class="fa-solid fa-circle-xmark text-rose-400"></i>
                        <span>هەڵە ❌</span>
                      </span>
                      <button onclick="resetEvaluationFromReveal(${payload.question_id}, ${s.user_id}, '${escapeHtml(s.full_name)}', this)" class="p-1 hover:bg-slate-700 text-slate-400 hover:text-white rounded-lg text-xs" title="گەڕاندنەوە">
                        <i class="fa-solid fa-rotate-left text-[10px]"></i>
                      </button>
                    </div>
                  ` : `
                    <div class="flex items-center gap-1.5">
                      <button 
                        onclick="awardStarFromReveal(${payload.question_id}, ${s.user_id}, '${escapeHtml(s.full_name)}', this)" 
                        class="award-star-btn px-2.5 py-1 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 text-slate-950 font-black text-xs rounded-xl shadow-md transition flex items-center gap-1 active:scale-95"
                        title="وەڵامی دروستە ⭐"
                      >
                        <i class="fa-solid fa-star"></i>
                        <span>⭐ ڕاستە</span>
                      </button>
                      <button 
                        onclick="markWrongFromReveal(${payload.question_id}, ${s.user_id}, '${escapeHtml(s.full_name)}', this)" 
                        class="mark-wrong-btn px-2.5 py-1 bg-rose-600/30 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/40 font-black text-xs rounded-xl transition flex items-center gap-1 active:scale-95"
                        title="وەڵامی هەڵەیە ❌"
                      >
                        <i class="fa-solid fa-xmark"></i>
                        <span>❌ هەڵە</span>
                      </button>
                    </div>
                  `)}
                ` : `
                  ${s.is_awarded === 1 ? `
                    <span class="px-2.5 py-1 bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-black text-xs rounded-xl inline-flex items-center gap-1 shadow-sm">
                      <i class="fa-solid fa-star text-amber-400"></i>
                      <span>وەڵامی دروست ⭐</span>
                    </span>
                  ` : (s.is_awarded === -1 ? `
                    <span class="px-2.5 py-1 bg-rose-500/20 border border-rose-500/40 text-rose-300 font-black text-xs rounded-xl inline-flex items-center gap-1 shadow-sm">
                      <i class="fa-solid fa-circle-xmark text-rose-400"></i>
                      <span>وەڵامی هەڵە ❌</span>
                    </span>
                  ` : `
                    <span class="px-2 py-0.5 text-slate-500 font-medium text-[11px] rounded-lg bg-slate-900/60 border border-slate-800">هێشتا نەپشکنراوە</span>
                  `)}
                `}
              </div>
            </div>
          `;
        }).join('');
      }

      // Official Answer by Admin / Teacher (Prominent Emerald Green Box at the bottom with Reactions)
      let modelAnswerHtml = '';
      if (payload.model_answer && payload.model_answer.trim()) {
        const reactionsHtml = renderMessageReactionsHtml(msg.reactions || [], msg.id);
        modelAnswerHtml = `
          <div class="mt-3.5 p-3.5 rounded-2xl bg-emerald-950/40 border-2 border-emerald-500/70 shadow-lg text-emerald-200">
            <div class="flex items-center justify-between mb-2 flex-wrap gap-1">
              <span class="text-xs font-black text-emerald-400 flex items-center gap-1.5">
                <i class="fa-solid fa-circle-check text-base text-emerald-400"></i>
                <span>وەڵامی دروستی دیاریکراوی مامۆستا (کۆتا وەڵام):</span>
              </span>
              <span class="text-[10px] bg-emerald-500/20 text-emerald-300 font-bold px-2 py-0.5 rounded-md border border-emerald-500/30">
                ڕاستیی پرسیار ✨
              </span>
            </div>

            <div class="text-xs md:text-sm font-black text-white bg-slate-900/90 p-3 rounded-xl border border-emerald-500/30 whitespace-pre-wrap leading-relaxed select-text shadow-inner">
              ${escapeHtml(payload.model_answer)}
            </div>

            <!-- Reaction section for the teacher's model answer -->
            <div class="mt-2.5 pt-2 border-t border-emerald-500/30 flex items-center justify-between gap-2 flex-wrap">
              <div class="flex items-center gap-1.5">
                <span class="text-[11px] font-bold text-emerald-300/80">کاردانەوە:</span>
                <div class="flex items-center gap-1">
                  <button type="button" onclick="sendReaction(${msg.id}, '⭐', event)" class="px-2 py-0.5 rounded-lg bg-emerald-900/40 hover:bg-emerald-800/60 border border-emerald-500/30 text-xs transition active:scale-95" title="ئەستێرە">⭐</button>
                  <button type="button" onclick="sendReaction(${msg.id}, '💯', event)" class="px-2 py-0.5 rounded-lg bg-emerald-900/40 hover:bg-emerald-800/60 border border-emerald-500/30 text-xs transition active:scale-95" title="سەد لە سەد">💯</button>
                  <button type="button" onclick="sendReaction(${msg.id}, '🤲', event)" class="px-2 py-0.5 rounded-lg bg-emerald-900/40 hover:bg-emerald-800/60 border border-emerald-500/30 text-xs transition active:scale-95" title="دەستخۆشی و دوعا">🤲</button>
                  <button type="button" onclick="sendReaction(${msg.id}, '👍', event)" class="px-2 py-0.5 rounded-lg bg-emerald-900/40 hover:bg-emerald-800/60 border border-emerald-500/30 text-xs transition active:scale-95" title="بەدڵبوون">👍</button>
                  <button type="button" onclick="sendReaction(${msg.id}, '🏆', event)" class="px-2 py-0.5 rounded-lg bg-emerald-900/40 hover:bg-emerald-800/60 border border-emerald-500/30 text-xs transition active:scale-95" title="نایاب">🏆</button>
                  <button type="button" onclick="sendReaction(${msg.id}, '❤️', event)" class="px-2 py-0.5 rounded-lg bg-emerald-900/40 hover:bg-emerald-800/60 border border-emerald-500/30 text-xs transition active:scale-95" title="دڵ">❤️</button>
                </div>
              </div>

              <!-- Reactions Container rendered dynamically -->
              <div id="msg-reactions-${msg.id}" class="flex items-center gap-1 flex-wrap">
                ${reactionsHtml}
              </div>
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
          <div class="flex items-center justify-between pb-3 border-b border-indigo-500/30 mb-3.5 gap-2 flex-wrap">
            <div class="flex items-center gap-2.5">
              <div class="w-9 h-9 rounded-xl bg-indigo-600/30 text-indigo-400 flex items-center justify-center text-base font-black border border-indigo-500/40">
                <i class="fa-solid fa-bullhorn"></i>
              </div>
              <div>
                <h4 class="font-black text-sm md:text-base text-white">⏰ وەڵامەکانی پرسیاری ژمارە ${payload.question_number || ''}</h4>
                <p class="text-[11px] text-indigo-300">کاتی دیاریکراو بەسەرچوو (${subs.length} قوتابی وەڵامی داوەتەوە)</p>
              </div>
            </div>
            <div class="flex items-center gap-2">
              ${isStaff ? `
                <button type="button" onclick="openEditQuestionModal(${payload.question_id || msg.id})" class="px-2.5 py-1 bg-sky-600/20 hover:bg-sky-600 text-sky-300 hover:text-white border border-sky-500/40 rounded-xl text-xs font-bold transition flex items-center gap-1 shadow-sm active:scale-95" title="دەستکاریکردنی ئەم پرسیارە">
                  <i class="fa-solid fa-pen-to-square text-[11px]"></i>
                  <span>دەستکاری</span>
                </button>
                <button type="button" onclick="deleteQuestionDirect(${payload.question_id || msg.id}, ${msg.id})" class="px-2.5 py-1 bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/40 rounded-xl text-xs font-bold transition flex items-center gap-1 shadow-sm active:scale-95" title="سڕینەوەی ئەم پرسیارە">
                  <i class="fa-solid fa-trash-can text-[11px]"></i>
                  <span>سڕینەوە</span>
                </button>
              ` : ''}
              <span class="text-[11px] text-slate-400 font-mono">${dateStr}</span>
            </div>
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
          <div class="flex items-center gap-2">
            ${isStaff ? `
              <button type="button" onclick="openEditQuestionModal(${qData.question_id || msg.id})" class="px-2.5 py-1 bg-sky-600/20 hover:bg-sky-600 text-sky-300 hover:text-white border border-sky-500/40 rounded-xl text-xs font-bold transition flex items-center gap-1 shadow-sm active:scale-95" title="دەستکاریکردنی ئەم پرسیارە">
                <i class="fa-solid fa-pen-to-square text-[11px]"></i>
                <span>دەستکاری</span>
              </button>
              <button type="button" onclick="deleteQuestionDirect(${qData.question_id || msg.id}, ${msg.id})" class="px-2.5 py-1 bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/40 rounded-xl text-xs font-bold transition flex items-center gap-1 shadow-sm active:scale-95" title="سڕینەوەی ئەم پرسیارە">
                <i class="fa-solid fa-trash-can text-[11px]"></i>
                <span>سڕینەوە</span>
              </button>
            ` : ''}
            <span class="text-[11px] text-slate-400 font-mono">${dateStr}</span>
          </div>
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
  let hasActions = false;

  if (isAdmin && !isMe) {
    hasActions = true;
    messageActionsHtml = `
      <div id="msg-actions-${msg.id}" class="msg-actions-bar hidden md:flex md:opacity-0 md:group-hover:opacity-100 transition duration-150 items-center gap-1 mt-1 bg-slate-800/95 border border-slate-700/80 px-2 py-0.5 rounded-xl shadow-lg z-10">
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
    hasActions = true;
    messageActionsHtml = `
      <div id="msg-actions-${msg.id}" class="msg-actions-bar hidden md:flex md:opacity-0 md:group-hover:opacity-100 transition duration-150 items-center gap-1 mt-1 bg-slate-800/95 border border-slate-700/80 px-2 py-0.5 rounded-xl shadow-lg z-10">
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
      <button type="button" onclick="toggleReactionPicker(${msg.id}, event)" class="text-slate-400 hover:text-amber-300 px-1 py-0.5 rounded text-[11px] hover:bg-slate-800 transition flex items-center gap-0.5" title="کارلێک بە ئیمۆجی">
        <i class="fa-regular fa-face-smile"></i>
      </button>
      ${hasActions ? `
        <button type="button" onclick="toggleMsgActions(${msg.id}, event)" class="md:hidden text-slate-400 hover:text-white px-1.5 py-0.5 rounded text-[11px] hover:bg-slate-800 transition msg-actions-trigger" title="کردارەکان">
          <i class="fa-solid fa-ellipsis"></i>
        </button>
      ` : ''}
    </div>

    <!-- Quick Reaction Picker Popover (Hidden by default) -->
    <div id="reaction-picker-${msg.id}" class="hidden my-1 bg-slate-900 border border-slate-700/80 rounded-2xl p-1.5 shadow-2xl z-20 flex items-center gap-1 animate-scale-up">
      <button type="button" onclick="sendReaction(${msg.id}, '🏆', event)" class="p-1.5 hover:bg-slate-800 rounded-xl text-sm transition active:scale-125" title="کاس">🏆</button>
      <button type="button" onclick="sendReaction(${msg.id}, '🤲', event)" class="p-1.5 hover:bg-slate-800 rounded-xl text-sm transition active:scale-125" title="دوعا">🤲</button>
      <button type="button" onclick="sendReaction(${msg.id}, '👍', event)" class="p-1.5 hover:bg-slate-800 rounded-xl text-sm transition active:scale-125" title="ڵایک">👍</button>
      <button type="button" onclick="sendReaction(${msg.id}, '💯', event)" class="p-1.5 hover:bg-slate-800 rounded-xl text-sm transition active:scale-125" title="سەد لەسەد">💯</button>
    </div>

    <div onclick="handleMessageBubbleClick(${msg.id}, event)" class="max-w-lg md:max-w-xl rounded-2xl px-3.5 py-2 text-xs md:text-sm leading-relaxed shadow break-words ${bubbleBg} cursor-pointer md:cursor-default">
      ${msg.content ? `<div class="${msgTextClass}">${escapeHtml(msg.content)}</div>` : ''}
      ${attachmentHtml}
    </div>

    <!-- Reactions Container -->
    <div id="msg-reactions-${msg.id}" class="flex items-center gap-1 mt-1 flex-wrap">
      ${renderMessageReactionsHtml(msg.reactions || [], msg.id)}
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

// --- MOBILE MESSAGE ACTIONS TOGGLE ---
let activeMobileMsgActionsId = null;

function toggleMsgActions(msgId, event) {
  if (event) {
    event.stopPropagation();
  }
  const targetBar = document.getElementById(`msg-actions-${msgId}`);
  if (!targetBar) return;

  const isCurrentlyOpen = !targetBar.classList.contains('hidden');

  closeAllMobileMsgActions();

  if (!isCurrentlyOpen) {
    targetBar.classList.remove('hidden');
    targetBar.classList.add('flex');
    activeMobileMsgActionsId = msgId;
  }
}

function handleMessageBubbleClick(msgId, event) {
  if (window.innerWidth >= 768) return; // Desktop uses hover
  if (!event || !event.target) return;
  if (event.target.closest('button, a, audio, img, input, .audio-player-btn, i')) return;
  toggleMsgActions(msgId, event);
}

function closeAllMobileMsgActions() {
  if (activeMobileMsgActionsId !== null) {
    const bar = document.getElementById(`msg-actions-${activeMobileMsgActionsId}`);
    if (bar) {
      bar.classList.add('hidden');
      bar.classList.remove('flex');
    }
    activeMobileMsgActionsId = null;
  }
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.msg-actions-bar') && !e.target.closest('.msg-actions-trigger')) {
    closeAllMobileMsgActions();
  }
});


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

function openActiveQuestionModal() {
  if (!activeQuestion) return;
  const modal = document.getElementById('activeQuestionModal');
  if (modal) modal.classList.remove('hidden');

  // Restore draft if any
  const input = document.getElementById('modalStickySecretAnswerInput');
  if (input && (!input.value || !input.value.trim())) {
    const draft = localStorage.getItem('draft_ans_' + activeQuestion.id);
    if (draft) input.value = draft;
  }
}

function closeActiveQuestionModal() {
  const modal = document.getElementById('activeQuestionModal');
  if (modal) modal.classList.add('hidden');
}

function minimizeActiveQuestionToChat() {
  const input = document.getElementById('modalStickySecretAnswerInput');
  if (input && activeQuestion) {
    if (input.value && input.value.trim()) {
      localStorage.setItem('draft_ans_' + activeQuestion.id, input.value);
    }
  }
  closeActiveQuestionModal();

  // Scroll chat so user can see recent messages
  const container = document.getElementById('chatMessagesContainer') || document.getElementById('messages');
  if (container) {
    container.scrollTop = container.scrollHeight;
  }
  
  if (typeof showToast === 'function') {
    showToast('نووسینەکەت پارێزراوە، دەتوانیت چات ببینیت و بە دەستنان لە هێمای سەرەوە بگەڕێیتەوە ✨', 'info');
  }
}

function renderActiveQuestionSticky(q) {
  stopQuestionCountdown();

  const sticky = document.getElementById('activeQuestionSticky');
  const previewText = document.getElementById('stickyQuestionPreviewText');
  const countdownEl = document.getElementById('stickyCountdownTime');
  const modalCountdownEl = document.getElementById('modalStickyCountdownTime');
  const stickyStudentTag = document.getElementById('stickyStudentTag');
  const stickyAdminTag = document.getElementById('stickyAdminTag');

  // Modal elements
  const modalText = document.getElementById('modalStickyQuestionText');
  const modalAdmin = document.getElementById('modalStickyQuestionAdmin');
  const modalSubCount = document.getElementById('modalStickySubmissionCountBadge');
  const modalStudentArea = document.getElementById('modalStickyStudentInputArea');
  const modalSubmittedNotice = document.getElementById('modalStickySubmittedNotice');
  const modalSubmittedText = document.getElementById('modalStickySubmittedText');
  const modalGuestNotice = document.getElementById('modalStickyGuestNotice');
  const modalAdminActions = document.getElementById('modalStickyAdminActions');

  if (!q || q.is_revealed || (q.expires_at && q.expires_at <= Date.now())) {
    if (sticky) sticky.classList.add('hidden');
    closeActiveQuestionModal();
    return;
  }

  // Update Compact Banner Preview
  if (previewText) previewText.innerText = q.question_text || 'پرسیاری نوێ';
  if (sticky) sticky.classList.remove('hidden');

  // Update Modal Content
  if (modalText) modalText.innerText = q.question_text;
  if (modalAdmin) modalAdmin.innerText = `لەلایەن: ${q.admin_name || 'مامۆستا / ئەدمین'}`;
  if (modalSubCount) modalSubCount.innerText = `${q.submission_count || 0} وەڵام تۆمارکراوە`;

  const isStaff = currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'teacher');
  const isGuest = currentUser && currentUser.role === 'guest';
  const cachedAns = localStorage.getItem('cached_ans_' + q.id);
  const existingSubmission = q.my_submission || cachedAns;

  // Banner Tags
  if (isStaff) {
    if (stickyAdminTag) stickyAdminTag.classList.remove('hidden');
    if (stickyStudentTag) stickyStudentTag.classList.add('hidden');
  } else {
    if (stickyAdminTag) stickyAdminTag.classList.add('hidden');
    if (stickyStudentTag) {
      stickyStudentTag.classList.remove('hidden');
      if (existingSubmission) {
        stickyStudentTag.innerHTML = `
          <button type="button" class="px-2.5 py-1 bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 text-xs font-black rounded-lg flex items-center gap-1 shadow-sm">
            <i class="fa-solid fa-circle-check text-emerald-400"></i>
            <span>وەڵامت دراوەتەوە ✅</span>
          </button>
        `;
      } else if (isGuest) {
        stickyStudentTag.innerHTML = `
          <span class="px-2 py-1 bg-slate-800 text-slate-400 text-xs font-bold rounded-lg border border-slate-700">میوان 👁️</span>
        `;
      } else {
        stickyStudentTag.innerHTML = `
          <button type="button" class="px-2.5 py-1 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 text-slate-950 text-xs font-black rounded-lg shadow flex items-center gap-1 active:scale-95 animate-pulse">
            <i class="fa-solid fa-pen-fancy text-[10px]"></i>
            <span>وەڵامدانەوە ✍️</span>
          </button>
        `;
      }
    }
  }

  // Modal Sections
  if (isStaff) {
    if (modalAdminActions) modalAdminActions.classList.remove('hidden');
    if (modalStudentArea) modalStudentArea.classList.add('hidden');
    if (modalSubmittedNotice) modalSubmittedNotice.classList.add('hidden');
    if (modalGuestNotice) modalGuestNotice.classList.add('hidden');
  } else if (isGuest) {
    if (modalAdminActions) modalAdminActions.classList.add('hidden');
    if (modalStudentArea) modalStudentArea.classList.add('hidden');
    if (modalSubmittedNotice) modalSubmittedNotice.classList.add('hidden');
    if (modalGuestNotice) modalGuestNotice.classList.remove('hidden');
  } else {
    if (modalAdminActions) modalAdminActions.classList.add('hidden');
    if (modalGuestNotice) modalGuestNotice.classList.add('hidden');

    if (existingSubmission) {
      if (modalStudentArea) modalStudentArea.classList.add('hidden');
      if (modalSubmittedNotice) modalSubmittedNotice.classList.remove('hidden');
      if (modalSubmittedText) modalSubmittedText.innerText = `"${existingSubmission}"`;
    } else {
      if (modalStudentArea) modalStudentArea.classList.remove('hidden');
      if (modalSubmittedNotice) modalSubmittedNotice.classList.add('hidden');
      const input = document.getElementById('modalStickySecretAnswerInput');
      if (input) {
        const draft = localStorage.getItem('draft_ans_' + q.id);
        if (draft && !input.value) {
          input.value = draft;
        }
      }
      const cancelBtn = document.getElementById('modalCancelEditAnswerBtn');
      if (cancelBtn) cancelBtn.classList.add('hidden');
      const submitBtnText = document.getElementById('modalSubmitSecretAnswerBtnText');
      if (submitBtnText) submitBtnText.innerText = 'ناردن و جێگیرکردنی وەڵام';
    }
  }

  // Handle countdown timer supporting days, hours, mins, secs
  if (q.expires_at && !q.is_revealed) {
    function updateTimer() {
      const remainingMs = q.expires_at - Date.now();
      if (remainingMs <= 0) {
        stopQuestionCountdown();
        if (sticky) sticky.classList.add('hidden');
        closeActiveQuestionModal();
        return;
      }
      const timeStr = formatRemainingTime(remainingMs);
      if (countdownEl) countdownEl.innerText = timeStr;
      if (modalCountdownEl) modalCountdownEl.innerText = timeStr;
    }

    updateTimer();
    questionCountdownTimer = setInterval(updateTimer, 1000);
  } else {
    if (countdownEl) countdownEl.innerText = 'بەسەرچوو';
    if (modalCountdownEl) modalCountdownEl.innerText = 'بەسەرچوو';
  }
}

function stopQuestionCountdown() {
  if (questionCountdownTimer) {
    clearInterval(questionCountdownTimer);
    questionCountdownTimer = null;
  }
}

// Student Edit Secret Answer inside Modal
function enableEditSecretAnswerInModal() {
  if (!activeQuestion) return;
  const cachedAns = localStorage.getItem('cached_ans_' + activeQuestion.id);
  const currentAnswer = activeQuestion.my_submission || cachedAns || '';
  const input = document.getElementById('modalStickySecretAnswerInput');
  if (input) input.value = currentAnswer;

  const submittedNotice = document.getElementById('modalStickySubmittedNotice');
  const studentArea = document.getElementById('modalStickyStudentInputArea');
  const cancelBtn = document.getElementById('modalCancelEditAnswerBtn');
  const submitBtnText = document.getElementById('modalSubmitSecretAnswerBtnText');

  if (submittedNotice) submittedNotice.classList.add('hidden');
  if (studentArea) studentArea.classList.remove('hidden');
  if (cancelBtn) cancelBtn.classList.remove('hidden');
  if (submitBtnText) submitBtnText.innerText = 'نوێکردنەوەی وەڵام ✏️';

  if (input) {
    input.focus();
    input.select();
  }
}

function cancelEditSecretAnswerInModal() {
  const studentArea = document.getElementById('modalStickyStudentInputArea');
  const cancelBtn = document.getElementById('modalCancelEditAnswerBtn');
  const submittedNotice = document.getElementById('modalStickySubmittedNotice');
  const submitBtnText = document.getElementById('modalSubmitSecretAnswerBtnText');

  if (studentArea) studentArea.classList.add('hidden');
  if (cancelBtn) cancelBtn.classList.add('hidden');
  if (submittedNotice) submittedNotice.classList.remove('hidden');
  if (submitBtnText) submitBtnText.innerText = 'ناردن و جێگیرکردنی وەڵام';
}

// Student Submits Secret Answer from Modal
async function submitSecretAnswerFromModal() {
  if (!activeQuestion) return;
  if (currentUser && currentUser.role === 'guest') {
    alert('تۆ وەک میوان (چاودێر) لە گروپیت و ناتوانیت وەڵامی پرسیار بنێریت 👁️');
    return;
  }

  const input = document.getElementById('modalStickySecretAnswerInput');
  const answer = input ? input.value.trim() : '';
  if (!answer) {
    alert('تکایە دەقی وەڵامەکەت بنووسە');
    return;
  }

  // Cache locally
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
      localStorage.removeItem('draft_ans_' + activeQuestion.id);
      renderActiveQuestionSticky(activeQuestion);
      triggerStarCelebration();
    } else {
      alert(data.error || 'هەڵەیەک ڕوویدا لە ناردنی وەڵام');
    }
  } catch (err) {
    // Offline submission cached
    renderActiveQuestionSticky(activeQuestion);
  }
}

// Delete / Remove Question Directly (Super Admin & Teacher)
async function deleteQuestionDirect(questionId, messageId) {
  const isStaff = currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'teacher');
  if (!isStaff) {
    alert('تەنها سوپەر ئەدمین و مامۆستا دەسەڵاتی لابردن و سڕینەوەی پرسیاریان هەیە');
    return;
  }

  if (!confirm('ئایا دڵنیایت لە لابردن و سڕینەوەی ئەم پرسیارە لە گروپ؟\nسەرجەم وەڵامەکان و کاتەکە دەسڕێنەوە و نامێنن.')) {
    return;
  }

  try {
    const res = await fetch('/api/chat/question/cancel', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ question_id: questionId, message_id: messageId })
    });
    const data = await res.json();
    if (res.ok) {
      if (activeQuestion && (activeQuestion.id == questionId || activeQuestion.message_id == messageId || !questionId)) {
        activeQuestion = null;
        stopQuestionCountdown();
        renderActiveQuestionSticky(null);
        closeActiveQuestionModal();
      }
      if (messageId) {
        const msgElem = document.getElementById(`msg-${messageId}`);
        if (msgElem) msgElem.remove();
      }
      if (questionId) {
        document.querySelectorAll(`[data-question-id="${questionId}"]`).forEach(el => el.remove());
      }
      if (typeof questionsArchiveCache !== 'undefined' && Array.isArray(questionsArchiveCache)) {
        questionsArchiveCache = questionsArchiveCache.filter(q => q.id != questionId);
        if (typeof renderQuestionsArchive === 'function') {
          renderQuestionsArchive();
        }
      }
    } else {
      alert(data.error || 'هەڵەیەک ڕوویدا لە لابردنی پرسیار');
    }
  } catch (err) {
    alert('پەیوەندی لەگەڵ سێرڤەر ناتەواوە');
  }
}

// Cancel & Remove Active Question (Super Admin & Teacher)
async function cancelActiveQuestion() {
  if (!activeQuestion) return;
  await deleteQuestionDirect(activeQuestion.id, activeQuestion.message_id);
}

let currentEditQuestionId = null;

function openEditQuestionModal(questionId) {
  const targetId = questionId || (activeQuestion ? activeQuestion.id : null);
  if (!targetId) return;
  currentEditQuestionId = targetId;

  const textInput = document.getElementById('editQuestionTextInput');
  const modelAnswerInput = document.getElementById('editQuestionModelAnswerInput');
  const durationInput = document.getElementById('editQuestionDurationInput');

  if (activeQuestion && activeQuestion.id == targetId) {
    if (textInput) textInput.value = activeQuestion.question_text || '';
    if (modelAnswerInput) modelAnswerInput.value = activeQuestion.model_answer || '';
    if (durationInput) {
      if (activeQuestion.expires_at) {
        const remainingMinutes = Math.max(1, Math.round((activeQuestion.expires_at - Date.now()) / 60000));
        durationInput.value = remainingMinutes;
      } else {
        durationInput.value = '';
      }
    }
  } else {
    // If opened from a message card in chat:
    const card = document.querySelector(`[data-question-id="${targetId}"]`);
    if (card) {
      const qText = card.querySelector('p')?.innerText || '';
      if (textInput) textInput.value = qText;
    }
    if (durationInput) durationInput.value = '';
  }

  const modal = document.getElementById('editQuestionModal');
  if (modal) modal.classList.remove('hidden');
}

function closeEditQuestionModal() {
  const modal = document.getElementById('editQuestionModal');
  if (modal) modal.classList.add('hidden');
  currentEditQuestionId = null;
}

async function submitEditQuestion() {
  if (!currentEditQuestionId) return;
  const textInput = document.getElementById('editQuestionTextInput');
  const modelAnswerInput = document.getElementById('editQuestionModelAnswerInput');
  const durationInput = document.getElementById('editQuestionDurationInput');
  const saveBtn = document.getElementById('saveEditQuestionBtn');

  const question_text = textInput ? textInput.value.trim() : '';
  if (!question_text) {
    alert('تکایە دەقی پرسیار بنووسە');
    return;
  }

  const model_answer = modelAnswerInput ? modelAnswerInput.value.trim() : '';
  const duration_minutes = durationInput && durationInput.value ? parseInt(durationInput.value) : null;

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> پاشەکەوتکردن...';
  }

  try {
    const res = await fetch('/api/chat/question/edit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        question_id: currentEditQuestionId,
        question_text,
        model_answer,
        duration_minutes
      })
    });
    const data = await res.json();
    if (res.ok) {
      if (activeQuestion && activeQuestion.id == currentEditQuestionId) {
        activeQuestion.question_text = question_text;
        activeQuestion.model_answer = model_answer;
        if (data.expires_at) activeQuestion.expires_at = data.expires_at;
        renderActiveQuestionSticky(activeQuestion);
      }
      closeEditQuestionModal();
      loadMessages();
      alert('دەستکاریکردنی پرسیار بەسەرکەوتوویی پاشەکەوت کرا ✨');
    } else {
      alert(data.error || 'هەڵەیەک ڕوویدا لە دەستکاریکردنی پرسیار');
    }
  } catch (err) {
    alert('پەیوەندی لەگەڵ سێرڤەر ناتەواوە');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<i class="fa-solid fa-check"></i> <span>پاشەکەوتکردنی گۆڕانکاری</span>';
    }
  }
}

// Backward-compatible wrappers for older call sites
function enableEditSecretAnswer() { enableEditSecretAnswerInModal(); }
function cancelEditSecretAnswer() { cancelEditSecretAnswerInModal(); }
function submitSecretAnswer() { submitSecretAnswerFromModal(); }

// Admin manual award star from revealed submissions card in chat
async function awardStarFromReveal(questionId, userId, studentName, btn) {
  if (studentName && !confirm(`ئایا دڵنیایت کە وەڵامەکەی (${studentName}) دروستە و ئەستێرەی پێدەدەیت؟`)) return;
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
        btn.className = 'px-2.5 py-1 bg-emerald-600/30 text-emerald-400 border border-emerald-500/40 font-black text-xs rounded-xl flex items-center gap-1 cursor-default';
        btn.innerHTML = '<i class="fa-solid fa-circle-check"></i> <span>ڕاستە ⭐</span>';
      }
      triggerStarCelebration(btn);
    } else {
      alert(data.error || 'هەڵەیەک ڕوویدا');
    }
  } catch (e) {
    alert('پەیوەندی ناتەواوە');
  }
}

// Admin mark answer as wrong (زەڕب ❌)
async function markWrongFromReveal(questionId, userId, studentName, btn) {
  if (studentName && !confirm(`ئایا دڵنیایت کە وەڵامەکەی (${studentName}) هەڵەیە و نیشانەی زەڕبی (❌) لێدەدەیت؟`)) return;
  try {
    const res = await fetch('/api/chat/mark-wrong', {
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
      if (btn && btn.parentElement) {
        btn.parentElement.innerHTML = `
          <div class="flex items-center gap-1">
            <span class="px-2.5 py-1 bg-rose-600/20 text-rose-400 border border-rose-500/30 font-black text-xs rounded-xl inline-flex items-center gap-1">
              <i class="fa-solid fa-circle-xmark"></i>
              <span>هەڵە ❌</span>
            </span>
            <button onclick="resetEvaluationFromReveal(${questionId}, ${userId}, '${escapeHtml(studentName || '')}', this)" class="p-1 hover:bg-slate-700 text-slate-400 hover:text-white rounded-lg text-xs" title="گەڕاندنەوە">
              <i class="fa-solid fa-rotate-left text-[10px]"></i>
            </button>
          </div>
        `;
      }
    } else {
      alert(data.error || 'هەڵەیەک ڕوویدا');
    }
  } catch (e) {
    alert('پەیوەندی ناتەواوە');
  }
}

// Reset evaluation for an answer
async function resetEvaluationFromReveal(questionId, userId, studentName, btn) {
  try {
    const res = await fetch('/api/chat/reset-evaluation', {
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
    if (res.ok) {
      const slot = btn ? btn.closest('.eval-slot') : null;
      if (slot) {
        slot.innerHTML = `
          <div class="flex items-center gap-1.5">
            <button 
              onclick="awardStarFromReveal(${questionId}, ${userId}, '${escapeHtml(studentName || '')}', this)" 
              class="award-star-btn px-2.5 py-1 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 text-slate-950 font-black text-xs rounded-xl shadow-md transition flex items-center gap-1 active:scale-95"
              title="وەڵامی دروستە ⭐"
            >
              <i class="fa-solid fa-star"></i>
              <span>⭐</span>
            </button>
            <button 
              onclick="markWrongFromReveal(${questionId}, ${userId}, '${escapeHtml(studentName || '')}', this)" 
              class="mark-wrong-btn px-2.5 py-1 bg-rose-600/30 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/40 font-black text-xs rounded-xl transition flex items-center gap-1 active:scale-95"
              title="وەڵامی هەڵەیە ❌"
            >
              <i class="fa-solid fa-xmark"></i>
              <span>❌</span>
            </button>
          </div>
        `;
      }
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
      renderActiveQuestionSticky(null);
      closeActiveQuestionModal();
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

// --- MAIN SLIDE-OUT DRAWER (سێ خەت) ---
function toggleMainMenuDrawer() {
  const drawer = document.getElementById('mainMenuDrawer');
  const panel = document.getElementById('mainMenuDrawerPanel');
  const backdrop = document.getElementById('mainMenuDrawerBackdrop');
  if (!drawer || !panel) return;

  if (drawer.classList.contains('hidden')) {
    drawer.classList.remove('hidden');
    requestAnimationFrame(() => {
      if (backdrop) backdrop.classList.remove('opacity-0');
      panel.classList.remove('translate-x-full');
      panel.classList.add('translate-x-0');
    });
  } else {
    closeMainMenuDrawer();
  }
}

function closeMainMenuDrawer() {
  const drawer = document.getElementById('mainMenuDrawer');
  const panel = document.getElementById('mainMenuDrawerPanel');
  const backdrop = document.getElementById('mainMenuDrawerBackdrop');
  if (!drawer || !panel) return;

  if (backdrop) backdrop.classList.add('opacity-0');
  panel.classList.remove('translate-x-0');
  panel.classList.add('translate-x-full');
  setTimeout(() => {
    drawer.classList.add('hidden');
  }, 300);
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

    const hasBottomRow = !!(starBadge || muteBtn || actionBtn);

    const card = document.createElement('div');
    card.className = `p-2.5 rounded-2xl bg-slate-800/60 hover:bg-slate-800/90 border ${isMuted ? 'border-rose-500/40 bg-rose-950/20' : 'border-slate-700/50'} flex flex-col gap-2 transition shadow-sm`;

    card.innerHTML = `
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer" onclick="openUserProfileModal(${u.id})">
          <div class="w-9 h-9 rounded-xl bg-slate-700/80 flex items-center justify-center text-sm font-black text-slate-300 shrink-0 shadow-inner border border-slate-600/40">
            ${u.gender === 'female' ? '👧' : '👦'}
          </div>
          <div class="min-w-0 flex-1">
            <div class="text-xs font-black flex items-center gap-1.5 flex-wrap">
              <span class="${nameClass} break-words leading-tight" title="${escapeHtml(u.full_name)}">${escapeHtml(u.full_name)}</span>
              ${isMe ? '<span class="text-[9px] text-indigo-400 font-normal shrink-0">(تۆ)</span>' : ''}
              ${isMuted ? '<span class="text-[9px] bg-rose-500/20 text-rose-300 px-1 py-0.2 rounded border border-rose-500/30 font-bold shrink-0">🔇 سڕکراوە</span>' : ''}
            </div>
            <div class="flex items-center gap-1.5 mt-1">
              ${roleBadge}
            </div>
          </div>
        </div>

        <button onclick="openUserProfileModal(${u.id})" class="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-indigo-400 text-xs rounded-lg hover:bg-slate-700/60 transition shrink-0" title="زانیاری دەربارەی کەسەکە">
          <i class="fa-solid fa-circle-info"></i>
        </button>
      </div>

      ${hasBottomRow ? `
        <div class="flex items-center justify-between gap-1.5 pt-2 border-t border-slate-700/50 text-[10px]">
          <div class="flex items-center gap-1 shrink-0">
            ${starBadge}
          </div>
          <div class="flex items-center gap-1.5 shrink-0">
            ${muteBtn}
            ${actionBtn}
          </div>
        </div>
      ` : ''}
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

    // Private Chat Button in Profile
    const privContainer = document.getElementById('profPrivateChatContainer');
    if (privContainer) {
      const isStaffUser = currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'teacher');
      const targetIsStaff = prof.role === 'super_admin' || prof.role === 'teacher';
      const canSendPrivate = !isMe && (isStaffUser || targetIsStaff);

      if (canSendPrivate) {
        privContainer.classList.remove('hidden');
        const privBtn = document.getElementById('profPrivateChatBtn');
        const privBtnText = document.getElementById('profPrivateChatBtnText');
        if (privBtn) {
          privBtn.onclick = () => {
            closeUserProfileModal();
            openPrivateChatWithUser(prof.id, prof.full_name, prof.role);
          };
        }
        if (privBtnText) {
          privBtnText.innerText = `ناردنی نامەی تایبەت بۆ (${prof.full_name}) ✉️`;
        }
      } else {
        privContainer.classList.add('hidden');
      }
    }

    currentProfileUserId = prof.id;
    currentProfileUser = prof;

    // Star Adjustment Controls (Super Admin & Teacher)
    const starsAdjustContainer = document.getElementById('profStarsAdjustContainer');
    if (starsAdjustContainer) {
      if (currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'teacher')) {
        starsAdjustContainer.classList.remove('hidden');
      } else {
        starsAdjustContainer.classList.add('hidden');
      }
    }

    // Request Profile Change Button (Only shown on user's OWN profile)
    const reqChangeContainer = document.getElementById('profRequestChangeContainer');
    if (reqChangeContainer) {
      if (isMe) {
        reqChangeContainer.classList.remove('hidden');
      } else {
        reqChangeContainer.classList.add('hidden');
      }
    }

    if (isPrivileged && !isMe) {
      superAdminActions.classList.remove('hidden');
      let roleChangeHtml = '';
      let renameActionHtml = '';
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
        renameActionHtml = `
          <button onclick="promptAdminEditUserName(${prof.id}, '${escapeHtml(prof.full_name)}')" class="px-2.5 py-1.5 bg-amber-500/20 hover:bg-amber-500 text-amber-300 hover:text-slate-950 border border-amber-500/40 rounded-xl text-xs font-bold transition flex items-center gap-1 shadow active:scale-95" title="دەستکاریکردنی ناوی ئەم ئەکاونتە لەلایەن سوپەر ئەدمین">
            <i class="fa-solid fa-user-pen"></i> گۆڕینی ناو
          </button>
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

      actionSlot.innerHTML = `${roleChangeHtml} ${renameActionHtml} ${muteActionHtml} ${deleteActionHtml}`;
    } else {
      superAdminActions.classList.add('hidden');
    }

  } catch (err) {
    fullNameEl.innerText = 'هەڵەیەک ڕوویدا';
  }
}

function closeUserProfileModal() {
  document.getElementById('userProfileModal').classList.add('hidden');
  currentProfileUserId = null;
  currentProfileUser = null;
}

async function adjustCurrentProfileStars(delta) {
  if (!currentProfileUserId) return;
  const actionText = delta > 0 ? 'زیادکردنی ١ ئەستێرە' : 'کەمکردنەوەی ١ ئەستێرە';
  if (!confirm(`ئایا دڵنیایت لە ${actionText} بۆ ئەم بەکارهێنەرە؟`)) return;

  try {
    const res = await fetch(`/api/admin/users/${currentProfileUserId}/adjust-stars`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ delta })
    });
    const data = await res.json();
    if (res.ok) {
      const starInfo = calculateStars(data.new_stars);
      const profStars = document.getElementById('profStars');
      if (profStars) profStars.innerHTML = `${starInfo.starIcons} (${starInfo.points}/10)`;
      alert(`ئەستێرە بەسەرکەوتوویی گۆڕدرا: (${data.new_stars} ئەستێرە) ⭐`);
    } else {
      alert(data.error || 'هەڵەیەک ڕوویدا لە دەستکاریکردنی ئەستێرە');
    }
  } catch (err) {
    alert('پەیوەندی لەگەڵ سێرڤەر ناتەواوە');
  }
}

async function promptAdminEditUserName(userId, currentName) {
  const newName = prompt('ناوی نوێ بۆ ئەم ئەکاونتە بنووسە:', currentName);
  if (!newName || !newName.trim() || newName.trim() === currentName) return;

  try {
    const res = await fetch(`/api/admin/users/${userId}/update-name`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ full_name: newName.trim() })
    });
    const data = await res.json();
    if (res.ok) {
      alert('ناو بەسەرکەوتوویی نوێکرایەوە ✨');
      openUserProfileModal(userId);
      loadAllMembers();
      loadMessages();
    } else {
      alert(data.error || 'هەڵەیەک ڕوویدا');
    }
  } catch (err) {
    alert('پەیوەندی لەگەڵ سێرڤەر ناتەواوە');
  }
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
  const drawerPendingBadge = document.getElementById('drawerPendingBadgeCount');
  if (navBadge) navBadge.classList.add('hidden');
  if (mobileNavBadge) mobileNavBadge.classList.add('hidden');
  if (drawerPendingBadge) drawerPendingBadge.classList.add('hidden');

  document.getElementById('adminModal').classList.remove('hidden');
  loadPendingProfileChangesCount();
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
  const tabProfileChanges = document.getElementById('adminTabProfileChanges');
  const tabBackups = document.getElementById('adminTabBackups');
  const contentPending = document.getElementById('adminContentPending');
  const contentUsers = document.getElementById('adminContentUsers');
  const contentPasswordResets = document.getElementById('adminContentPasswordResets');
  const contentProfileChanges = document.getElementById('adminContentProfileChanges');
  const contentBackups = document.getElementById('adminContentBackups');

  // Reset all tabs to inactive styling
  [tabPending, tabUsers, tabPasswordResets, tabProfileChanges, tabBackups].forEach(t => {
    if (t) t.className = 'pb-3 text-sm font-bold border-b-2 border-transparent text-slate-400 hover:text-slate-200 flex items-center gap-2';
  });
  // Hide all panels
  [contentPending, contentUsers, contentPasswordResets, contentProfileChanges, contentBackups].forEach(c => {
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
  } else if (tab === 'profile_changes') {
    if (tabProfileChanges) tabProfileChanges.className = 'pb-3 text-sm font-bold border-b-2 border-[#dfaa86] text-[#dfaa86] flex items-center gap-2';
    if (contentProfileChanges) contentProfileChanges.classList.remove('hidden');
    loadPendingProfileChangesList();
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

// --- USER PROFILE CHANGE REQUESTS (NAME & PASSWORD) ---
function openRequestProfileChangeModal() {
  if (!currentUser) return;
  const modal = document.getElementById('requestProfileChangeModal');
  const typeSelect = document.getElementById('reqProfileChangeType');
  const nameInput = document.getElementById('reqProfileNewName');
  const passInput = document.getElementById('reqProfileNewPassword');
  const reasonInput = document.getElementById('reqProfileReason');

  if (typeSelect) typeSelect.value = 'name';
  if (nameInput) nameInput.value = currentUser.full_name || '';
  if (passInput) passInput.value = '';
  if (reasonInput) reasonInput.value = '';

  toggleProfileChangeFields();
  if (modal) modal.classList.remove('hidden');
}

function closeRequestProfileChangeModal() {
  const modal = document.getElementById('requestProfileChangeModal');
  if (modal) modal.classList.add('hidden');
}

function toggleProfileChangeFields() {
  const type = document.getElementById('reqProfileChangeType')?.value || 'name';
  const nameField = document.getElementById('reqProfileNameField');
  const passField = document.getElementById('reqProfilePasswordField');

  if (type === 'name') {
    if (nameField) nameField.classList.remove('hidden');
    if (passField) passField.classList.add('hidden');
  } else {
    if (nameField) nameField.classList.add('hidden');
    if (passField) passField.classList.remove('hidden');
  }
}

async function submitProfileChangeRequest() {
  const type = document.getElementById('reqProfileChangeType')?.value || 'name';
  const nameInput = document.getElementById('reqProfileNewName');
  const passInput = document.getElementById('reqProfileNewPassword');
  const reasonInput = document.getElementById('reqProfileReason');
  const btn = document.getElementById('submitProfileChangeRequestBtn');

  const new_name = (type === 'name' && nameInput) ? nameInput.value.trim() : null;
  const new_password = (type === 'password' && passInput) ? passInput.value : null;
  const reason = reasonInput ? reasonInput.value.trim() : '';

  if (type === 'name' && (!new_name || new_name === currentUser.full_name)) {
    alert('تکایە ناوێکی نوێ و جیاواز بنووسە');
    return;
  }
  if (type === 'password' && (!new_password || new_password.length < 6)) {
    alert('وشەی تێپەڕی نوێ دەبێت لانیکەم ٦ پیت بێت');
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> ناردن...';
  }

  try {
    const res = await fetch('/api/user/request-profile-change', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        change_type: type,
        new_name,
        new_password,
        reason
      })
    });
    const data = await res.json();
    if (res.ok) {
      closeRequestProfileChangeModal();
      alert('داواکارییەکەت بەسەرکەوتوویی نێردرا بۆ سوپەر ئەدمین بۆ پەسەندکردن ✨');
    } else {
      alert(data.error || 'هەڵەیەک ڕوویدا لە ناردنی داواکاری');
    }
  } catch (err) {
    alert('پەیوەندی لەگەڵ سێرڤەر ناتەواوە');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> <span>ناردنی داواکاری بۆ سوپەر ئەدمین</span>';
    }
  }
}

// --- ADMIN PROFILE CHANGE REQUESTS REVIEW ---
async function loadPendingProfileChangesList() {
  const container = document.getElementById('profileChangesList');
  const emptyMsg = document.getElementById('profileChangesEmptyMessage');
  const badge = document.getElementById('adminProfileChangesBadge');
  if (!container) return;

  container.innerHTML = `<div class="text-center py-6 text-slate-400"><i class="fa-solid fa-circle-notch fa-spin text-lg"></i> لە بارکردندایە...</div>`;
  if (emptyMsg) emptyMsg.classList.add('hidden');

  try {
    const res = await fetch('/api/admin/profile-change-requests', {
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
      const card = document.createElement('div');
      card.className = 'p-3.5 rounded-2xl bg-slate-800/80 border border-slate-700/70 flex items-center justify-between gap-3 flex-wrap';
      const isName = req.change_type === 'name';
      const typeLabel = isName ? 'گۆڕینی ناوی تەواو' : 'گۆڕینی وشەی تێپەڕ';
      const typeColor = isName ? 'text-indigo-400 bg-indigo-500/10 border-indigo-500/30' : 'text-amber-400 bg-amber-500/10 border-amber-500/30';
      const createdStr = new Date(req.created_at).toLocaleDateString('ku-IQ') + ' ' + new Date(req.created_at).toLocaleTimeString('ku-IQ', { hour: '2-digit', minute: '2-digit' });

      card.innerHTML = `
        <div class="space-y-1">
          <div class="flex items-center gap-2">
            <span class="px-2 py-0.5 rounded-md border text-[11px] font-bold ${typeColor}">${typeLabel}</span>
            <span class="font-bold text-white text-xs">${escapeHtml(req.full_name)}</span>
            <span class="text-slate-400 text-xs font-mono">(@${escapeHtml(req.username)})</span>
          </div>
          ${isName ? `
            <div class="text-xs text-slate-300">
              ناوی نوێی داواکراو: <b class="text-emerald-400">${escapeHtml(req.new_name)}</b>
            </div>
          ` : `
            <div class="text-xs text-amber-300">
              داوای گۆڕینی وشەی تێپەڕ دەکات
            </div>
          `}
          ${req.reason ? `
            <div class="text-[11px] text-slate-400 italic">
              هۆکار: "${escapeHtml(req.reason)}"
            </div>
          ` : ''}
          <div class="text-[10px] text-slate-500 font-mono">${createdStr}</div>
        </div>

        <div class="flex items-center gap-2">
          <button onclick="approveProfileChange(${req.id})" class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow transition flex items-center gap-1 active:scale-95">
            <i class="fa-solid fa-check"></i> پەسەندکردن
          </button>
          <button onclick="rejectProfileChange(${req.id})" class="px-3 py-1.5 bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/40 font-bold text-xs rounded-xl transition flex items-center gap-1 active:scale-95">
            <i class="fa-solid fa-xmark"></i> ڕەتکردنەوە
          </button>
        </div>
      `;
      container.appendChild(card);
    });
  } catch (err) {
    container.innerHTML = `<div class="text-center py-4 text-rose-400 text-xs">هەڵە لە بارکردنی داواکارییەکان</div>`;
  }
}

async function loadPendingProfileChangesCount() {
  if (!token || !currentUser || currentUser.role !== 'super_admin') return;
  try {
    const res = await fetch('/api/admin/profile-change-requests', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return;
    const data = await res.json();
    const count = (data.requests || []).length;
    const badge = document.getElementById('adminProfileChangesBadge');
    if (badge) {
      badge.innerText = count;
      if (count > 0) badge.classList.remove('hidden');
      else badge.classList.add('hidden');
    }
  } catch (e) {}
}

async function approveProfileChange(id) {
  if (!confirm('ئایا دڵنیایت لە پەسەندکردنی ئەم گۆڕانکارییە؟')) return;
  try {
    const res = await fetch(`/api/admin/profile-change-requests/${id}/approve`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (res.ok) {
      alert('گۆڕانکارییەکە بەسەرکەوتوویی پەسەندکرا و جێبەجێکرا!');
      loadPendingProfileChangesList();
      loadPendingProfileChangesCount();
      loadAllMembers();
    } else {
      alert(data.error || 'هەڵەیەک ڕوویدا');
    }
  } catch (err) {
    alert('پەیوەندی لەگەڵ سێرڤەر ناتەواوە');
  }
}

async function rejectProfileChange(id) {
  if (!confirm('ئایا دڵنیایت لە ڕەتکردنەوەی ئەم داواکارییە؟')) return;
  try {
    const res = await fetch(`/api/admin/profile-change-requests/${id}/reject`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (res.ok) {
      alert('داواکارییەکە ڕەتکرایەوە.');
      loadPendingProfileChangesList();
      loadPendingProfileChangesCount();
    } else {
      alert(data.error || 'هەڵەیەک ڕوویدا');
    }
  } catch (err) {
    alert('پەیوەندی لەگەڵ سێرڤەر ناتەواوە');
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

    const drawerPendingBadge = document.getElementById('drawerPendingBadgeCount');
    const mainMenuDot = document.getElementById('mainMenuBadgeDot');

    if (totalAlerts > 0 && !isModalOpen) {
      if (navBadge) {
        navBadge.innerText = totalAlerts;
        navBadge.classList.remove('hidden');
      }
      if (mobileNavBadge) {
        mobileNavBadge.innerText = totalAlerts;
        mobileNavBadge.classList.remove('hidden');
      }
      if (drawerPendingBadge) {
        drawerPendingBadge.innerText = totalAlerts;
        drawerPendingBadge.classList.remove('hidden');
      }
      if (mainMenuDot) mainMenuDot.classList.remove('hidden');
    } else {
      if (navBadge) navBadge.classList.add('hidden');
      if (mobileNavBadge) mobileNavBadge.classList.add('hidden');
      if (drawerPendingBadge) drawerPendingBadge.classList.add('hidden');
      if (mainMenuDot) {
        const privateBadge = document.getElementById('drawerPrivateUnreadBadge');
        const hasPrivate = privateBadge && !privateBadge.classList.contains('hidden');
        if (!hasPrivate) mainMenuDot.classList.add('hidden');
      }
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
        <div class="flex items-center gap-2">
          ${(currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'teacher')) ? `
            <button 
              type="button" 
              onclick="deleteQuestionDirect(${q.id}, ${q.message_id || 'null'})" 
              class="px-2.5 py-1 bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/40 rounded-xl text-xs font-bold transition flex items-center gap-1 shadow-sm active:scale-95" 
              title="سڕینەوەی ئەم پرسیارە"
            >
              <i class="fa-solid fa-trash-can text-[11px]"></i>
              <span>سڕینەوە</span>
            </button>
          ` : ''}
          <span class="text-[11px] text-slate-400 font-mono">${dateFormatted}</span>
        </div>
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
        <div class="flex items-center gap-2">
          ${(currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'teacher')) ? `
            <button 
              type="button" 
              onclick="deleteQuestionDirect(${q.id}, ${q.message_id || 'null'})" 
              class="px-3 py-1.5 bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/40 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow active:scale-95" 
              title="سڕینەوەی پرسیار"
            >
              <i class="fa-solid fa-trash-can text-[11px]"></i>
              <span>سڕینەوە</span>
            </button>
          ` : ''}
          <button 
            onclick="jumpToQuestionInChat(${q.id}, ${q.question_number || 1})" 
            class="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow active:scale-95"
            title="دۆزینەوە و پیشاندانی ئەم پرسیارە لەناو گروپ چات"
          >
            <i class="fa-solid fa-location-crosshairs text-amber-300"></i>
            <span>چوونە سەر پرسیار لە چات 🎯</span>
          </button>
        </div>
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
  const isTeacherSender = msg.sender_type === 'teacher';
  const isStaffSender = isSuperAdminSender || isTeacherSender;
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
    isMine = isStaffSender;
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

  let senderBadge = '';
  if (isSuperAdminSender) {
    senderBadge = '<span class="badge-super-admin-shield inline-flex items-center text-xs select-none mr-1.5" title="سوپەر ئەدمین">🛡️</span>';
  } else if (isTeacherSender) {
    senderBadge = '<span class="badge-teacher inline-flex items-center text-xs select-none mr-1.5" title="مامۆستا">👨‍🏫</span>';
  } else {
    senderBadge = '<span class="text-[9px] font-bold text-purple-300 mr-1.5">خەون بین</span>';
  }

  let senderNameHtml = '';
  if (isSuperAdminSender) {
    senderNameHtml = `<span class="user-name-super-admin font-black">${escapeHtml(msg.sender_name)}</span>`;
  } else if (isTeacherSender) {
    senderNameHtml = `<span class="text-amber-300 font-black">${escapeHtml(msg.sender_name)}</span>`;
  } else {
    senderNameHtml = `<span>${escapeHtml(msg.sender_name)}</span>`;
  }

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
    const drawerBadge = document.getElementById('drawerDreamUnreadBadge');

    if (unreadCount > 0 && !isModalOpen) {
      if (badge) {
        badge.innerText = unreadCount;
        badge.classList.remove('hidden');
      }
      if (mobileBadge) {
        mobileBadge.innerText = unreadCount;
        mobileBadge.classList.remove('hidden');
      }
      if (drawerBadge) {
        drawerBadge.innerText = unreadCount;
        drawerBadge.classList.remove('hidden');
      }
    } else {
      if (badge) badge.classList.add('hidden');
      if (mobileBadge) mobileBadge.classList.add('hidden');
      if (drawerBadge) drawerBadge.classList.add('hidden');
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
      roleIndicator.innerText = 'مامۆستا 👨‍🏫 (وەڵامدانەوەی خەون)';
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
  if (currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'teacher')) {
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

    const canFavorite = isSuperAdmin || (currentUser && currentUser.role === 'teacher');
    const starBtnHtml = canFavorite ? `
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
  const isTeacher = currentUser && currentUser.role === 'teacher';
  const canAnswer = isSuperAdmin || isTeacher;
  const inputBar = document.getElementById('dreamAdminInputBar');
  const callBtn = document.getElementById('adminStartCallBtn');
  const teacherNotice = document.getElementById('dreamTeacherNotice');
  const favBtn = document.getElementById('dreamAdminFavBtn');
  const favIcon = document.getElementById('dreamAdminFavIcon');
  const deleteBtn = document.getElementById('dreamAdminDeleteBtn');

  if (canAnswer) {
    if (inputBar) inputBar.classList.remove('hidden');
    if (callBtn) callBtn.classList.remove('hidden');
    if (teacherNotice) teacherNotice.classList.add('hidden');
    if (favBtn) favBtn.classList.remove('hidden');
    if (deleteBtn) {
      if (isSuperAdmin) deleteBtn.classList.remove('hidden');
      else deleteBtn.classList.add('hidden');
    }
  } else {
    // Other / non-privileged: READ-ONLY!
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
  if (!token || !currentUser || (currentUser.role !== 'super_admin' && currentUser.role !== 'teacher')) return;
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
  // If teacher or super_admin receives event -> allow answering!
  if (isAdmin && currentUser && currentUser.role !== 'super_admin' && currentUser.role !== 'teacher') return;

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

  const sock = (currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'teacher')) ? socket : dreamSocket;
  if (sock) {
    sock.emit('dream_call_accept', { sessionId: callActiveSessionId });
  }

  await establishWebRTCConnection(false);
}

function rejectIncomingDreamCall() {
  stopRingtone();
  const sock = (currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'teacher')) ? socket : dreamSocket;
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
        const sock = (currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'teacher')) ? socket : dreamSocket;
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
  const sock = (currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'teacher')) ? socket : dreamSocket;
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
        const sock = (currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'teacher')) ? socket : dreamSocket;
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
      const sock = (currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'teacher')) ? socket : dreamSocket;
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
  const drawerPwaBtn = document.getElementById('drawerPwaInstallBtn');
  if (pwaBtn) pwaBtn.classList.remove('hidden');
  if (mobilePwaBtn) mobilePwaBtn.classList.remove('hidden');
  if (drawerPwaBtn) drawerPwaBtn.classList.remove('hidden');
});

window.addEventListener('appinstalled', () => {
  pwaDeferredPrompt = null;
  const pwaBtn = document.getElementById('pwaInstallBtn');
  const mobilePwaBtn = document.getElementById('mobilePwaInstallBtn');
  const drawerPwaBtn = document.getElementById('drawerPwaInstallBtn');
  if (pwaBtn) pwaBtn.classList.add('hidden');
  if (mobilePwaBtn) mobilePwaBtn.classList.add('hidden');
  if (drawerPwaBtn) drawerPwaBtn.classList.add('hidden');
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
    const drawerPwaBtn = document.getElementById('drawerPwaInstallBtn');
    if (pwaBtn) pwaBtn.classList.add('hidden');
    if (mobilePwaBtn) mobilePwaBtn.classList.add('hidden');
    if (drawerPwaBtn) drawerPwaBtn.classList.add('hidden');
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



// =========================================================================
// 1. CHAT MESSAGE REACTIONS SYSTEM (🏆, 🤲, 👍, 💯)
// =========================================================================

function renderMessageReactionsHtml(reactions, messageId) {
  if (!reactions || !Array.isArray(reactions) || reactions.length === 0) return '';
  return reactions.map(r => {
    const activeClass = r.userReacted
      ? 'bg-sky-500/25 text-sky-300 border-sky-400/60 shadow-sm scale-105'
      : 'bg-slate-800/80 text-slate-300 border-slate-700/80 hover:border-slate-500';
    return `
      <button 
        type="button"
        onclick="sendReaction(${messageId}, '${r.emoji}', event)" 
        class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold border transition shadow-sm active:scale-95 ${activeClass}"
        title="${r.emoji}"
      >
        <span>${r.emoji}</span>
        <span class="text-[10px] font-mono font-black">${r.count}</span>
      </button>
    `;
  }).join('');
}

function toggleReactionPicker(messageId, event) {
  if (event) event.stopPropagation();
  const picker = document.getElementById(`reaction-picker-${messageId}`);
  if (!picker) return;
  const isHidden = picker.classList.contains('hidden');
  closeAllReactionPickers();
  if (isHidden) {
    picker.classList.remove('hidden');
  }
}

function closeAllReactionPickers() {
  document.querySelectorAll('[id^="reaction-picker-"]').forEach(el => el.classList.add('hidden'));
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('[id^="reaction-picker-"]') && !e.target.closest('[onclick*="toggleReactionPicker"]')) {
    closeAllReactionPickers();
  }
  const audioMenu = document.getElementById('liveAudioOutputMenu');
  if (audioMenu && !e.target.closest('#liveAudioOutputBtn') && !e.target.closest('#liveAudioOutputMenu')) {
    audioMenu.classList.add('hidden');
  }
});

async function sendReaction(messageId, emoji, event) {
  if (event) event.stopPropagation();
  closeAllReactionPickers();
  try {
    const res = await fetch(`/api/chat/messages/${messageId}/react`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ emoji })
    });
    const data = await res.json();
    if (res.ok && data.reactions) {
      const el = document.getElementById(`msg-reactions-${messageId}`);
      if (el) el.innerHTML = renderMessageReactionsHtml(data.reactions, messageId);
    }
  } catch (e) {
    console.error('Reaction request failed:', e);
  }
}

// =========================================================================
// 2. QUESTION EVALUATION & REAL-TIME UPDATE (⭐ or ❌)
// =========================================================================

function handleSubmissionEvaluated(data) {
  if (!data || !data.question_id || !data.user_id) return;
  const isStaff = currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'teacher');

  // 1. Update Card Border & Highlight Container
  const card = document.getElementById(`sub-card-${data.question_id}-${data.user_id}`);
  if (card) {
    card.classList.remove(
      'border-slate-700/70', 'bg-slate-800/80',
      'border-2', 'border-emerald-500/80', 'bg-emerald-950/25', 'ring-emerald-500/30', 'shadow-emerald-500/10',
      'border-rose-500/70', 'bg-rose-950/20', 'ring-rose-500/30', 'shadow-rose-500/10', 'ring-1', 'shadow-md'
    );
    if (data.is_correct === 1) {
      card.classList.add('border-2', 'border-emerald-500/80', 'bg-emerald-950/25', 'ring-1', 'ring-emerald-500/30', 'shadow-md', 'shadow-emerald-500/10');
    } else if (data.is_correct === -1) {
      card.classList.add('border-2', 'border-rose-500/70', 'bg-rose-950/20', 'ring-1', 'ring-rose-500/30', 'shadow-md', 'shadow-rose-500/10');
    } else {
      card.classList.add('border-slate-700/70', 'bg-slate-800/80');
    }
  }

  // 2. Update Student Header Badge Container
  const badgeContainers = document.querySelectorAll(`.eval-badge-container-${data.question_id}-${data.user_id}`);
  badgeContainers.forEach(container => {
    if (data.is_correct === 1) {
      container.innerHTML = `
        <span class="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-black text-[11px] rounded-lg inline-flex items-center gap-1 animate-pulse">
          <i class="fa-solid fa-star text-amber-400"></i>
          <span>وەڵامی دروستە ⭐</span>
        </span>
      `;
    } else if (data.is_correct === -1) {
      container.innerHTML = `
        <span class="px-2 py-0.5 bg-rose-500/20 text-rose-300 border border-rose-500/40 font-black text-[11px] rounded-lg inline-flex items-center gap-1">
          <i class="fa-solid fa-circle-xmark text-rose-400"></i>
          <span>وەڵامی هەڵەیە ❌</span>
        </span>
      `;
    } else {
      container.innerHTML = '';
    }
  });

  // 3. Update evaluation slot buttons / student status
  const targetSlots = document.querySelectorAll(`.eval-slot-${data.question_id}-${data.user_id}`);
  targetSlots.forEach(slot => {
    if (isStaff) {
      if (data.is_correct === 1) {
        slot.innerHTML = `
          <div class="flex items-center gap-1">
            <span class="px-2.5 py-1 bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 font-black text-xs rounded-xl inline-flex items-center gap-1">
              <i class="fa-solid fa-circle-check text-emerald-400"></i>
              <span>ڕاستە ⭐</span>
            </span>
            <button onclick="resetEvaluationFromReveal(${data.question_id}, ${data.user_id}, '${escapeHtml(data.user_name || '')}', this)" class="p-1 hover:bg-slate-700 text-slate-400 hover:text-white rounded-lg text-xs" title="گەڕاندنەوە">
              <i class="fa-solid fa-rotate-left text-[10px]"></i>
            </button>
          </div>
        `;
      } else if (data.is_correct === -1) {
        slot.innerHTML = `
          <div class="flex items-center gap-1">
            <span class="px-2.5 py-1 bg-rose-600/30 text-rose-300 border border-rose-500/40 font-black text-xs rounded-xl inline-flex items-center gap-1">
              <i class="fa-solid fa-circle-xmark text-rose-400"></i>
              <span>هەڵە ❌</span>
            </span>
            <button onclick="resetEvaluationFromReveal(${data.question_id}, ${data.user_id}, '${escapeHtml(data.user_name || '')}', this)" class="p-1 hover:bg-slate-700 text-slate-400 hover:text-white rounded-lg text-xs" title="گەڕاندنەوە">
              <i class="fa-solid fa-rotate-left text-[10px]"></i>
            </button>
          </div>
        `;
      } else {
        slot.innerHTML = `
          <div class="flex items-center gap-1.5">
            <button 
              onclick="awardStarFromReveal(${data.question_id}, ${data.user_id}, '${escapeHtml(data.user_name || '')}', this)" 
              class="award-star-btn px-2.5 py-1 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 text-slate-950 font-black text-xs rounded-xl shadow-md transition flex items-center gap-1 active:scale-95"
              title="وەڵامی دروستە ⭐"
            >
              <i class="fa-solid fa-star"></i>
              <span>⭐ ڕاستە</span>
            </button>
            <button 
              onclick="markWrongFromReveal(${data.question_id}, ${data.user_id}, '${escapeHtml(data.user_name || '')}', this)" 
              class="mark-wrong-btn px-2.5 py-1 bg-rose-600/30 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/40 font-black text-xs rounded-xl transition flex items-center gap-1 active:scale-95"
              title="وەڵامی هەڵەیە ❌"
            >
              <i class="fa-solid fa-xmark"></i>
              <span>❌ هەڵە</span>
            </button>
          </div>
        `;
      }
    } else {
      if (data.is_correct === 1) {
        slot.innerHTML = `
          <span class="px-2.5 py-1 bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-black text-xs rounded-xl inline-flex items-center gap-1 shadow-sm">
            <i class="fa-solid fa-star text-amber-400"></i>
            <span>وەڵامی دروست ⭐</span>
          </span>
        `;
      } else if (data.is_correct === -1) {
        slot.innerHTML = `
          <span class="px-2.5 py-1 bg-rose-500/20 border border-rose-500/40 text-rose-300 font-black text-xs rounded-xl inline-flex items-center gap-1 shadow-sm">
            <i class="fa-solid fa-circle-xmark text-rose-400"></i>
            <span>وەڵامی هەڵە ❌</span>
          </span>
        `;
      } else {
        slot.innerHTML = `<span class="px-2 py-0.5 text-slate-500 font-medium text-[11px] rounded-lg bg-slate-900/60 border border-slate-800">هێشتا نەپشکنراوە</span>`;
      }
    }
  });

  // If the evaluation was for the currently logged in student
  if (currentUser && currentUser.id === data.user_id) {
    if (typeof data.total_stars === 'number') {
      currentUser.correct_answers_count = data.total_stars;
      updateUserUI();
    }
    if (data.is_correct === 1) {
      playSound('star');
      alert(`پیرۆزە! وەڵامەکەت دروست بوو و ئەستێرەت (⭐) پێبەخشرا!`);
    } else if (data.is_correct === -1) {
      playSound('question');
      alert(`وەڵامەکەت هەڵەیە (❌) لەلایەن مامۆستاوە.`);
    }
  }
}

// =========================================================================
// 3. PRIVATE MESSAGING ENGINE (1-ON-1 WITH TEACHER & SUPER ADMIN)
// =========================================================================

let activePrivateOtherUser = null;

async function openPrivateChatModal() {
  const modal = document.getElementById('privateChatModal');
  if (!modal) return;
  modal.classList.remove('hidden');

  const sub = document.getElementById('privateChatHeaderSub');
  if (sub && currentUser) {
    if (currentUser.role === 'super_admin' || currentUser.role === 'teacher') {
      sub.innerText = 'ناردنی نامەی تایبەت بۆ هەموو بەکارهێنەران و قوتابیان';
    } else {
      sub.innerText = 'گفتوگۆی تایبەت و ڕاستەوخۆ لەگەڵ مامۆستا و سوپەر ئەدمین';
    }
  }

  await loadPrivateConversations();
}

function closePrivateChatModal() {
  const modal = document.getElementById('privateChatModal');
  if (modal) modal.classList.add('hidden');
}

async function loadPrivateConversations() {
  const listEl = document.getElementById('privateConversationsList');
  const countBadge = document.getElementById('privateConvCountBadge');
  if (!listEl) return;

  try {
    const res = await fetch('/api/chat/private/conversations', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (res.ok && Array.isArray(data.conversations)) {
      if (countBadge) countBadge.innerText = data.conversations.length;
      if (data.conversations.length === 0) {
        listEl.innerHTML = `
          <div class="p-4 text-center text-slate-500 text-xs leading-relaxed">
            هیچ گفتوگۆیەکت نییە.<br>
            دەتوانیت لە پرۆفایلی مامۆستا یان سوپەر ئەدمین کلیک لە «نامەی تایبەت» بکەیت.
          </div>
        `;
        return;
      }

      listEl.innerHTML = data.conversations.map(c => {
        const isCurrent = activePrivateOtherUser && activePrivateOtherUser.id === c.other_id;
        const activeBg = isCurrent ? 'bg-sky-600/20 border-sky-500/50' : 'bg-slate-900/60 hover:bg-slate-800/80 border-slate-800';
        const roleLabel = c.other_role === 'super_admin' ? 'سوپەر ئەدمین' : (c.other_role === 'teacher' ? 'مامۆستا' : 'قوتابی');
        const roleColor = c.other_role === 'teacher' ? 'text-amber-400' : (c.other_role === 'super_admin' ? 'text-rose-400' : 'text-sky-400');
        const lastTime = c.last_message_at ? new Date(c.last_message_at).toLocaleTimeString('ku-IQ', { hour: '2-digit', minute: '2-digit' }) : '';
        const unreadHtml = c.unread_count > 0 
          ? `<span class="px-1.5 py-0.5 rounded-full bg-sky-500 text-slate-950 text-[10px] font-black">${c.unread_count}</span>` 
          : '';

        return `
          <div 
            onclick="openPrivateChatWithUser(${c.other_id}, '${escapeHtml(c.other_name)}', '${c.other_role}', '${c.other_gender || 'male'}')"
            class="p-2.5 rounded-2xl border cursor-pointer transition ${activeBg} flex items-center gap-2.5"
          >
            <div class="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-xs shrink-0">
              ${c.other_gender === 'female' ? '🧕' : '👤'}
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center justify-between">
                <span class="font-black text-white truncate text-xs">${escapeHtml(c.other_name)}</span>
                <span class="text-[10px] text-slate-500 font-mono">${lastTime}</span>
              </div>
              <div class="flex items-center justify-between mt-0.5">
                <span class="text-[11px] text-slate-400 truncate max-w-[130px]">${escapeHtml(c.last_message || '')}</span>
                <div class="flex items-center gap-1">
                  <span class="text-[9px] ${roleColor} font-bold">${roleLabel}</span>
                  ${unreadHtml}
                </div>
              </div>
            </div>
          </div>
        `;
      }).join('');
    }
  } catch (e) {
    console.error('Failed to load private conversations:', e);
  }
}

async function openPrivateChatWithUser(targetUserId, targetName, targetRole, targetGender) {
  openPrivateChatModal();
  activePrivateOtherUser = {
    id: parseInt(targetUserId),
    full_name: targetName,
    role: targetRole,
    gender: targetGender || 'male'
  };

  const emptyState = document.getElementById('privateChatEmptyState');
  const activeBox = document.getElementById('privateChatActiveBox');
  if (emptyState) emptyState.classList.add('hidden');
  if (activeBox) activeBox.classList.remove('hidden');

  const nameEl = document.getElementById('privateChatTargetName');
  const roleEl = document.getElementById('privateChatTargetRole');
  const avatarEl = document.getElementById('privateChatTargetAvatar');
  if (nameEl) nameEl.innerText = targetName;
  if (roleEl) {
    roleEl.innerText = targetRole === 'super_admin' ? 'سوپەر ئەدمین' : (targetRole === 'teacher' ? 'مامۆستا' : 'قوتابی');
  }
  if (avatarEl) {
    avatarEl.innerText = targetGender === 'female' ? '🧕' : '👤';
  }

  await loadPrivateThread(targetUserId);
}

async function loadPrivateThread(otherUserId) {
  const container = document.getElementById('privateMessagesContainer');
  if (!container) return;
  container.innerHTML = '<div class="p-4 text-center text-slate-500 text-xs">لە بارکردندایە...</div>';

  try {
    const res = await fetch(`/api/chat/private/messages/${otherUserId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (res.ok && Array.isArray(data.messages)) {
      if (data.messages.length === 0) {
        container.innerHTML = `
          <div class="p-6 text-center text-slate-500 text-xs">
            هیچ نامەیەک لەنێوانتاندا نییە. دەتوانیت ئێستا یەکەم نامە بنێریت!
          </div>
        `;
      } else {
        container.innerHTML = '';
        data.messages.forEach(m => appendPrivateMessageToThread(m, false));
        container.scrollTop = container.scrollHeight;
      }
      updatePrivateUnreadBadge();
    }
  } catch (e) {
    console.error('Failed to load private messages:', e);
  }
}

function appendPrivateMessageToThread(m, scroll = true) {
  const container = document.getElementById('privateMessagesContainer');
  if (!container || !m) return;

  // Prevent duplicate rendering
  if (m.id && document.getElementById(`private-msg-${m.id}`)) {
    return;
  }

  const isMe = currentUser && m.sender_id === currentUser.id;
  const timeFormatted = m.created_at ? new Date(m.created_at).toLocaleTimeString('ku-IQ', { hour: '2-digit', minute: '2-digit' }) : '';

  const div = document.createElement('div');
  if (m.id) div.id = `private-msg-${m.id}`;
  div.className = `flex flex-col ${isMe ? 'items-end' : 'items-start'} my-1.5`;
  div.innerHTML = `
    <div class="max-w-[80%] rounded-2xl px-3.5 py-2 text-xs leading-relaxed shadow break-words ${
      isMe ? 'bg-sky-600 text-white rounded-br-none' : 'bg-slate-800 text-slate-100 border border-slate-700/80 rounded-bl-none'
    }">
      <div>${escapeHtml(m.content)}</div>
      <div class="text-[9px] mt-1 text-right font-mono ${isMe ? 'text-sky-200' : 'text-slate-400'}">
        ${timeFormatted}
      </div>
    </div>
  `;
  container.appendChild(div);
  if (scroll) {
    container.scrollTop = container.scrollHeight;
  }
}

let isSendingPrivateMessage = false;

async function sendPrivateChatMessage() {
  if (!activePrivateOtherUser || isSendingPrivateMessage) return;
  const input = document.getElementById('privateMsgInput');
  if (!input) return;
  const content = input.value.trim();
  if (!content) return;

  isSendingPrivateMessage = true;
  input.value = '';
  try {
    const res = await fetch('/api/chat/private/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        recipient_id: activePrivateOtherUser.id,
        content
      })
    });
    const data = await res.json();
    if (res.ok && data.message) {
      appendPrivateMessageToThread(data.message, true);
      loadPrivateConversations();
    } else {
      alert(data.error || 'نەتوانرا نامە بنێردرێت');
    }
  } catch (e) {
    alert('پەیوەندی ناتەواوە');
  } finally {
    isSendingPrivateMessage = false;
  }
}

function handlePrivateInputKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendPrivateChatMessage();
  }
}

async function updatePrivateUnreadBadge() {
  if (!token) return;
  try {
    const res = await fetch('/api/chat/private/unread-count', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    const count = (res.ok && data.unread_count) ? data.unread_count : 0;

    const desktopBadge = document.getElementById('privateChatUnreadBadge');
    const mobileBadge = document.getElementById('mobilePrivateUnreadBadge');
    const drawerBadge = document.getElementById('drawerPrivateUnreadBadge');
    const mainMenuDot = document.getElementById('mainMenuBadgeDot');

    [desktopBadge, mobileBadge, drawerBadge].forEach(b => {
      if (!b) return;
      if (count > 0) {
        b.innerText = count > 99 ? '99+' : count;
        b.classList.remove('hidden');
      } else {
        b.classList.add('hidden');
      }
    });

    if (mainMenuDot) {
      if (count > 0) {
        mainMenuDot.classList.remove('hidden');
      } else {
        const pendingBadge = document.getElementById('drawerPendingBadgeCount');
        const hasPending = pendingBadge && !pendingBadge.classList.contains('hidden');
        if (!hasPending) mainMenuDot.classList.add('hidden');
      }
    }
  } catch (e) {}
}

function handleNewPrivateMessage(msg) {
  updatePrivateUnreadBadge();
  loadPrivateConversations();

  if (activePrivateOtherUser && (activePrivateOtherUser.id === msg.sender_id || activePrivateOtherUser.id === msg.recipient_id)) {
    appendPrivateMessageToThread(msg, true);
    fetch(`/api/chat/private/messages/${activePrivateOtherUser.id}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    }).catch(() => {});
  } else {
    playSound('question');
  }
}

// =========================================================================
// 4. BUILT-IN QURAN PLAYER (114 SURAHS & POPULAR RECITERS)
// =========================================================================

const QURAN_SURAHS_LIST = [
  "1. سورة الفاتحة", "2. سورة البقرة", "3. سورة آل عمران", "4. سورة النساء", "5. سورة المائدة",
  "6. سورة الأنعام", "7. سورة الأعراف", "8. سورة الأنفال", "9. سورة التوبة", "10. سورة يونس",
  "11. سورة هود", "12. سورة يوسف", "13. سورة الرعد", "14. سورة إبراهيم", "15. سورة الحجر",
  "16. سورة النحل", "17. سورة الإسراء", "18. سورة الكهف", "19. سورة مريم", "20. سورة طه",
  "21. سورة الأنبياء", "22. سورة الحج", "23. سورة المؤمنون", "24. سورة النور", "25. سورة الفرقان",
  "26. سورة الشعراء", "27. سورة النمل", "28. سورة القصص", "29. سورة العنكبوت", "30. سورة الروم",
  "31. سورة لقمان", "32. سورة السجدة", "33. سورة الأحزاب", "34. سورة سبأ", "35. سورة فاطر",
  "36. سورة يس", "37. سورة الصافات", "38. سورة ص", "39. سورة الزمر", "40. سورة غافر",
  "41. سورة فصلت", "42. سورة الشورى", "43. سورة الزخرف", "44. سورة الدخان", "45. سورة الجاثية",
  "46. سورة الأحقاف", "47. سورة محمد", "48. سورة الفتح", "49. سورة الحجرات", "50. سورة ق",
  "51. سورة الذاريات", "52. سورة الطور", "53. سورة النجم", "54. سورة القمر", "55. سورة الرحمن",
  "56. سورة الواقعة", "57. سورة الحديد", "58. سورة المجادلة", "59. سورة الحشر", "60. سورة الممتحنة",
  "61. سورة الصف", "62. سورة الجمعة", "63. سورة المنافقون", "64. سورة التغابن", "65. سورة الطلاق",
  "66. سورة التحريم", "67. سورة الملك", "68. سورة القلم", "69. سورة الحاقة", "70. سورة المعارج",
  "71. سورة نوح", "72. سورة الجن", "73. سورة المزمل", "74. سورة المدثر", "75. سورة القيامة",
  "76. سورة الإنسان", "77. سورة المرسلات", "78. سورة النبأ", "79. سورة النازعات", "80. سورة عبس",
  "81. سورة التكوير", "82. سورة الانفطار", "83. سورة المطففين", "84. سورة الانشقاق", "85. سورة البروج",
  "86. سورة الطارق", "87. سورة الأعلى", "88. سورة الغاشية", "89. سورة الفجر", "90. سورة البلد",
  "91. سورة الشمس", "92. سورة الليل", "93. سورة الضحى", "94. سورة الشرح", "95. سورة التين",
  "96. سورة العلق", "97. سورة القدر", "98. سورة البينة", "99. سورة الزلزلة", "100. سورة العاديات",
  "101. سورة القارعة", "102. سورة التكاثر", "103. سورة العصر", "104. سورة الهمزة", "105. سورة الفيل",
  "106. سورة قريش", "107. سورة الماعون", "108. سورة الكوثر", "109. سورة الكافرون", "110. سورة النصر",
  "111. سورة المسد", "112. سورة الإخلاص", "113. سورة الفلق", "114. سورة الناس"
];

function initQuranSurahsList() {
  const select = document.getElementById('liveQuranSurahSelect');
  if (!select || select.children.length > 0) return;
  select.innerHTML = QURAN_SURAHS_LIST.map((name, idx) => {
    return `<option value="${idx + 1}">${name}</option>`;
  }).join('');
}

function getQuranAudioUrl(reciter, surahNum) {
  const sNum = String(surahNum).padStart(3, '0');
  switch (reciter) {
    case 'AbdulBaset_Murattal':
      return `https://server7.mp3quran.net/basit/${sNum}.mp3`;
    case 'Alafasy':
      return `https://server8.mp3quran.net/afs/${sNum}.mp3`;
    case 'Maher_AlMuaiqly':
      return `https://server12.mp3quran.net/maher/${sNum}.mp3`;
    case 'Minshawi_Murattal':
      return `https://server10.mp3quran.net/minsh/${sNum}.mp3`;
    case 'Ghamadi':
      return `https://server8.mp3quran.net/ghamdi/${sNum}.mp3`;
    case 'Islam_Sobhi':
      return `https://server14.mp3quran.net/islam/Rewayat-Hafs-A-n-Assem/${sNum}.mp3`;
    default:
      return `https://server8.mp3quran.net/afs/${sNum}.mp3`;
  }
}

function toggleBroadcastQuran() {
  const isStaff = currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'teacher' || currentUser.role === 'admin');
  if (!isStaff) return;

  if (currentLiveLessonState && currentLiveLessonState.quranState && currentLiveLessonState.quranState.isPlaying) {
    socket.emit('live_quran_stop');
  } else {
    const reciterSelect = document.getElementById('liveQuranReciterSelect');
    const surahSelect = document.getElementById('liveQuranSurahSelect');
    const reciter = reciterSelect ? reciterSelect.value : 'Alafasy';
    const surahNum = surahSelect ? parseInt(surahSelect.value) || 1 : 1;
    const surahName = surahSelect ? surahSelect.options[surahSelect.selectedIndex].text : 'سورة الفاتحة';
    const audioUrl = getQuranAudioUrl(reciter, surahNum);

    socket.emit('live_quran_play', {
      reciter,
      surahName,
      audioUrl
    });
  }
}

function handleLiveQuranPlaying(data) {
  const audio = document.getElementById('liveQuranAudio');
  const badge = document.getElementById('liveQuranNowPlayingBadge');
  const playBtnText = document.getElementById('liveQuranPlayBtnText');
  const playBtn = document.getElementById('liveQuranPlayBtn');

  if (badge) {
    badge.innerText = `دەنگی قورئان پەخش دەبێت (${data.surahName || ''}) 🎶`;
    badge.classList.remove('hidden');
  }
  if (playBtnText) playBtnText.innerText = 'وەستاندنی قورئان ⏹️';
  if (playBtn) {
    playBtn.className = 'flex-1 py-2 px-3 bg-rose-600 hover:bg-rose-500 text-white font-black text-xs rounded-xl transition flex items-center justify-center gap-2 shadow active:scale-95';
  }

  if (audio && data && data.audioUrl) {
    if (audio.src !== data.audioUrl) {
      audio.src = data.audioUrl;
    }
    audio.play().catch(e => {
      console.log('Autoplay blocked, user interaction required:', e);
    });
  }
}

function handleLiveQuranStopped() {
  const audio = document.getElementById('liveQuranAudio');
  const badge = document.getElementById('liveQuranNowPlayingBadge');
  const playBtnText = document.getElementById('liveQuranPlayBtnText');
  const playBtn = document.getElementById('liveQuranPlayBtn');

  if (badge) badge.classList.add('hidden');
  if (playBtnText) playBtnText.innerText = 'دەستپێکردنی قورئان لەناو وانە';
  if (playBtn) {
    playBtn.className = 'flex-1 py-2 px-3 bg-amber-600 hover:bg-amber-500 text-slate-950 font-black text-xs rounded-xl transition flex items-center justify-center gap-2 shadow active:scale-95';
  }
  if (audio) {
    audio.pause();
    audio.currentTime = 0;
  }
}

// =========================================================================
// 5. LIVE LESSON ("وانە") REAL-TIME ENGINE
// =========================================================================

let currentLiveLessonState = null;
let localLiveAudioStream = null;
let localLiveScreenStream = null;
let isLocalMicMuted = true;
let isLocalScreenSharing = false;
let isTogglingMic = false;
let localMicPermissionGranted = false;
let liveLessonDurationTimer = null;
let livePeerConnections = new Map(); // socketId -> RTCPeerConnection
let pendingLiveCandidates = new Map(); // socketId -> Array of candidate

// High-reliability multi-STUN configuration for real-time live video & audio
const rtcLiveIceConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' }
  ],
  iceCandidatePoolSize: 10
};

// Unlimited Two-Way Audio Recording state
let liveMediaRecorder = null;
let liveRecordedAudioChunks = [];
let liveRecordingStartTime = null;
let liveRecordingTimer = null;
let liveAudioContext = null;

let livePingInterval = null;
function startLivePingReporting() {
  if (livePingInterval) clearInterval(livePingInterval);
  livePingInterval = setInterval(() => {
    if (!currentLiveLessonState || !currentLiveLessonState.isActive) return;
    let rtt = 50;
    if (navigator.connection && navigator.connection.rtt) {
      rtt = navigator.connection.rtt;
    }
    socket.emit('live_ping_report', { pingMs: rtt });
  }, 4000);
}

function stopLivePingReporting() {
  if (livePingInterval) {
    clearInterval(livePingInterval);
    livePingInterval = null;
  }
}

function openLiveLessonModal() {
  const modal = document.getElementById('liveLessonModal');
  const floatingBar = document.getElementById('floatingLiveBar');
  if (modal) modal.classList.remove('hidden');
  if (floatingBar) floatingBar.classList.add('hidden');

  const isStaff = currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'teacher');
  const startEndBtn = document.getElementById('liveStartEndBtn');
  if (startEndBtn) {
    if (!isStaff) {
      startEndBtn.classList.add('hidden');
      startEndBtn.classList.remove('flex');
      startEndBtn.style.setProperty('display', 'none', 'important');
    } else {
      startEndBtn.classList.remove('hidden');
      startEndBtn.classList.add('flex');
      startEndBtn.style.setProperty('display', 'flex', 'important');
    }
  }

  // Pre-unlock audio playback for mobile browser policies
  const roomAudio = document.getElementById('liveRoomAudio');
  if (roomAudio) {
    roomAudio.play().catch(() => {});
  }

  socket.emit('live_join');
  startLivePingReporting();
}

function minimizeLiveLessonModal() {
  const modal = document.getElementById('liveLessonModal');
  const floatingBar = document.getElementById('floatingLiveBar');
  if (modal) modal.classList.add('hidden');

  if (currentLiveLessonState && currentLiveLessonState.isActive) {
    if (floatingBar) floatingBar.classList.remove('hidden');
  }
}

function expandLiveLessonModal() {
  openLiveLessonModal();
}

function leaveLiveLessonRoom() {
  stopLivePingReporting();
  if (currentLiveLessonState && currentLiveLessonState.isActive) {
    const isStaff = currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'teacher');
    if (isStaff) {
      const choice = confirm('ئایا دەتەوێت لە ژوورەکە دەرچیت؟ (بۆ کۆتاییهێنان بە تەواوی وانەکە دوگمەی کۆتاییهێنان داگرە)');
      if (!choice) return;
    }
  }

  socket.emit('live_leave');

  // Close and clean up all WebRTC peer connections
  livePeerConnections.forEach(pc => {
    try { pc.close(); } catch (e) {}
  });
  livePeerConnections.clear();

  // Remove remote audio elements
  document.querySelectorAll('audio[id^="live_audio_"]').forEach(el => el.remove());

  if (localLiveAudioStream) {
    localLiveAudioStream.getTracks().forEach(t => t.stop());
    localLiveAudioStream = null;
  }
  if (localLiveScreenStream) {
    localLiveScreenStream.getTracks().forEach(t => t.stop());
    localLiveScreenStream = null;
  }
  isLocalScreenSharing = false;

  if (liveMediaRecorder && liveMediaRecorder.state !== 'inactive') {
    liveMediaRecorder.stop();
  }

  const liveAudio = document.getElementById('liveRoomAudio');
  const quranAudio = document.getElementById('liveQuranAudio');
  if (liveAudio) { liveAudio.pause(); liveAudio.srcObject = null; }
  if (quranAudio) { quranAudio.pause(); }

  const modal = document.getElementById('liveLessonModal');
  const floatingBar = document.getElementById('floatingLiveBar');
  if (modal) modal.classList.add('hidden');
  if (floatingBar) floatingBar.classList.add('hidden');

  isLocalMicMuted = true;
  localMicPermissionGranted = false;
  isTogglingMic = false;
  pendingLiveCandidates.clear();
  updateLiveMicUI(true);
}

function toggleFloatingMute() {
  const liveAudio = document.getElementById('liveRoomAudio');
  const quranAudio = document.getElementById('liveQuranAudio');
  const icon = document.getElementById('floatingMuteIcon');
  if (!liveAudio) return;

  const willMute = !liveAudio.muted;
  liveAudio.muted = willMute;
  if (quranAudio) quranAudio.muted = willMute;

  document.querySelectorAll('audio[id^="live_audio_"]').forEach(el => {
    el.muted = willMute;
  });

  if (icon) {
    if (willMute) {
      icon.className = 'fa-solid fa-volume-xmark text-rose-400';
    } else {
      icon.className = 'fa-solid fa-volume-high text-emerald-400';
    }
  }
}

function toggleLiveStartEnd() {
  const isStaff = currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'teacher');
  if (!isStaff) return;

  if (currentLiveLessonState && currentLiveLessonState.isActive) {
    if (!confirm('ئایا دڵنیایت لە کۆتاییهێنان بە وانەی ڕاستەوخۆ؟')) return;
    socket.emit('live_end');
  } else {
    const title = prompt('ناوی بابەت یان ناونیشانی وانەکە بنووسە:', 'وانەی ڕاستەوخۆ') || 'وانەی ڕاستەوخۆ';
    socket.emit('live_start', { title });
  }
}

async function requestLiveAudioStream() {
  if (localLiveAudioStream) {
    const liveTracks = localLiveAudioStream.getAudioTracks().filter(t => t.readyState === 'live');
    if (liveTracks.length > 0) {
      return localLiveAudioStream;
    }
    try {
      localLiveAudioStream.getTracks().forEach(t => t.stop());
    } catch (e) {}
    localLiveAudioStream = null;
  }

  // 1. Modern navigator.mediaDevices.getUserMedia with fallback
  if (navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function') {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
    } catch (err1) {
      console.warn('Advanced audio constraints failed, trying basic audio...', err1);
      try {
        return await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err2) {
        console.warn('Basic audio constraint failed:', err2);
        throw err2;
      }
    }
  }

  // 2. Legacy getUserMedia polyfill
  const legacyGUM = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia;
  if (legacyGUM) {
    return new Promise((resolve, reject) => {
      legacyGUM.call(navigator, { audio: true }, resolve, reject);
    });
  }

  throw new Error('NO_GETUSERMEDIA');
}

async function toggleLiveMic() {
  if (isTogglingMic) return;
  isTogglingMic = true;

  const btn = document.getElementById('liveMicToggleBtn');
  if (btn) btn.disabled = true;

  try {
    const myUserId = currentUser ? Number(currentUser.id) : null;
    const myParticipant = currentLiveLessonState && currentLiveLessonState.participants 
      ? currentLiveLessonState.participants.find(p => Number(p.userId) === myUserId)
      : null;

    const isStaff = currentUser && (
      currentUser.role === 'super_admin' || 
      currentUser.role === 'teacher' || 
      currentUser.role === 'admin' ||
      currentUser.username === 'hemn taha'
    );
    const hasPermission = isStaff || localMicPermissionGranted || (myParticipant && myParticipant.hasMicPermission);

    if (!hasPermission) {
      alert('تەنها مامۆستا و ئەدمین دەتوانن قسە بکەن. تکایە دوگمەی «دەست هەڵبڕین ✋» دابگرە تا مامۆستا مۆڵەتی مایکت پێدەدات.');
      return;
    }

    if (isLocalMicMuted) {
      try {
        localLiveAudioStream = await requestLiveAudioStream();
        localLiveAudioStream.getAudioTracks().forEach(t => {
          t.enabled = true;
        });
        isLocalMicMuted = false;
        updateLiveMicUI(false);
        socket.emit('live_mic_toggle', false);

        // Broadcast audio to all room participants
        broadcastLiveMediaToAll();
      } catch (err) {
        console.error('Failed to start live mic:', err);
        const isSecure = window.isSecureContext || window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          alert('ڕێگەپێدانی مایکرۆفۆن لە وێبگەڕدا ڕەتکرایەوە یان بلۆک کراوە.\nتکایە لە تەنیشت ناونیشانی ماڵپەڕەکە لە وێبگەڕ نیشانەی قوفڵ یان ڕێکخستنەکان دابگرە و ڕێگە بە مایکرۆفۆن بدە (Allow Microphone).');
        } else if (!isSecure && (!navigator.mediaDevices || err.message === 'NO_GETUSERMEDIA')) {
          alert('ئاگاداری بۆ کرۆم لەسەر مۆبایل و کۆمپیوتەر:\nبەهۆی یاسای نوێی وێبگەڕەکان، مایک پێویستی بە چالاککردنی ناونیشانەکەیە:\n1. تابی نوێ بکەرەوە و بڕۆ بۆ: chrome://flags/#unsafely-treat-insecure-origin-as-secure\n2. ناونیشانی ' + window.location.origin + ' بنووسە و بیکە بە Enabled پاشان Relaunch دابگرە.');
        } else {
          alert('نەتوانرا مایکرۆفۆن بکرێتەوە: ' + (err.message || 'هەڵەیەک لە دەستپێکردندا ڕوویدا'));
        }
      }
    } else {
      if (localLiveAudioStream) {
        localLiveAudioStream.getAudioTracks().forEach(t => {
          t.enabled = false;
        });
      }
      isLocalMicMuted = true;
      updateLiveMicUI(true);
      socket.emit('live_mic_toggle', true);

      if (localLiveScreenStream) {
        broadcastLiveMediaToAll();
      }
    }
  } finally {
    isTogglingMic = false;
    if (btn) btn.disabled = false;
  }
}

function updateLiveMicUI(muted) {
  const btn = document.getElementById('liveMicToggleBtn');
  const icon = document.getElementById('liveMicIcon');
  const text = document.getElementById('liveMicText');

  if (!btn) return;
  if (muted) {
    btn.className = 'px-3.5 py-2 bg-slate-800 text-slate-400 border border-slate-700 rounded-xl text-xs font-bold transition flex items-center gap-2 shadow active:scale-95';
    if (icon) icon.className = 'fa-solid fa-microphone-slash text-rose-400';
    if (text) text.innerText = 'مایک داخراوە';
  } else {
    btn.className = 'px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-400 rounded-xl text-xs font-bold transition flex items-center gap-2 shadow-lg active:scale-95 animate-pulse';
    if (icon) icon.className = 'fa-solid fa-microphone text-white';
    if (text) text.innerText = 'مایک کراوەیە 🎙️';
  }
}

function toggleLiveRaiseHand() {
  socket.emit('live_raise_hand');
}

async function toggleLiveScreenShare() {
  const isStaff = currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'teacher' || currentUser.role === 'admin');
  if (!isStaff) return;

  const btn = document.getElementById('liveScreenShareBtn');
  const btnText = document.getElementById('liveScreenShareText');
  const screenContainer = document.getElementById('liveScreenContainer');
  const standbyBox = document.getElementById('liveStandbyBox');
  const video = document.getElementById('liveScreenVideo');

  if (localLiveScreenStream) {
    localLiveScreenStream.getTracks().forEach(t => t.stop());
    localLiveScreenStream = null;
    isLocalScreenSharing = false;
    socket.emit('live_screen_stop');
    if (video) video.srcObject = null;
    if (screenContainer) screenContainer.classList.add('hidden');
    if (standbyBox) standbyBox.classList.remove('hidden');
    if (btnText) btnText.innerText = 'شەیرکردنی شاشە';
    if (btn) btn.className = 'px-3.5 py-2 bg-amber-500/20 hover:bg-amber-500 text-amber-300 hover:text-slate-950 border border-amber-500/40 rounded-xl text-xs font-bold transition flex items-center gap-2 shadow active:scale-95';

    if (localLiveAudioStream && !isLocalMicMuted) {
      broadcastLiveMediaToAll();
    }
  } else {
    try {
      if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
        alert('شەیرکردنی شاشە لە وێبگەڕی ئەم ئامێرەدا پشتگیری ناکرێت (تەنها کۆمپیوتەر یان ئەو وێبگەڕانەی دەتوانن شاشە شەیر بکەن).');
        return;
      }

      try {
        localLiveScreenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: false
        });
      } catch (errDisplay) {
        localLiveScreenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      }

      if (video) {
        video.srcObject = localLiveScreenStream;
        video.muted = true;
        video.playsInline = true;
        video.autoplay = true;
        video.play().catch(e => console.log('Local video play:', e));
      }
      if (screenContainer) screenContainer.classList.remove('hidden');
      if (standbyBox) standbyBox.classList.add('hidden');
      if (btnText) btnText.innerText = 'وەستاندنی شاشە ⏹️';
      if (btn) btn.className = 'px-3.5 py-2 bg-rose-600 hover:bg-rose-500 text-white border border-rose-400 rounded-xl text-xs font-bold transition flex items-center gap-2 shadow-lg active:scale-95';

      isLocalScreenSharing = true;
      socket.emit('live_screen_start');

      // Immediately broadcast screen stream to all room participants
      broadcastLiveMediaToAll();

      localLiveScreenStream.getVideoTracks()[0].onended = () => {
        toggleLiveScreenShare();
      };
    } catch (err) {
      console.log('Screen sharing cancelled or failed:', err);
      if (err.name !== 'NotAllowedError' && err.name !== 'AbortError') {
        alert('نەتوانرا شاشە شەیر بکرێت: ' + (err.message || 'هەڵەیەک ڕوویدا'));
      }
    }
  }
}

function toggleScreenShareFullscreen() {
  const container = document.getElementById('liveScreenContainer');
  if (!container) return;
  if (!document.fullscreenElement) {
    container.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
}

// Unlimited Two-Way Recording (تۆمارکردنی دەنگی وانە لە هەردوولا بێ سنوور)
async function toggleLiveRecording() {
  const recordBtn = document.getElementById('liveRecordBtn');
  const recordDot = document.getElementById('liveRecordDot');
  const recordText = document.getElementById('liveRecordText');

  if (liveMediaRecorder && liveMediaRecorder.state !== 'inactive') {
    liveMediaRecorder.stop();
    if (liveRecordingTimer) clearInterval(liveRecordingTimer);
    liveRecordingTimer = null;

    if (recordBtn) recordBtn.className = 'px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow';
    if (recordDot) recordDot.className = 'w-2.5 h-2.5 rounded-full bg-rose-500';
    if (recordText) recordText.innerText = 'تۆمارکردنی دەنگ';
    return;
  }

  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    liveAudioContext = new AudioCtx();
    const destination = liveAudioContext.createMediaStreamDestination();

    const liveAudio = document.getElementById('liveRoomAudio');
    if (liveAudio && liveAudio.srcObject) {
      try {
        const remoteSource = liveAudioContext.createMediaStreamSource(liveAudio.srcObject);
        remoteSource.connect(destination);
      } catch (e) {}
    }

    const quranAudio = document.getElementById('liveQuranAudio');
    if (quranAudio && !quranAudio.paused) {
      try {
        const quranSource = liveAudioContext.createMediaElementSource(quranAudio);
        quranSource.connect(destination);
        quranSource.connect(liveAudioContext.destination);
      } catch (e) {}
    }

    if (localLiveAudioStream) {
      try {
        const micSource = liveAudioContext.createMediaStreamSource(localLiveAudioStream);
        micSource.connect(destination);
      } catch (e) {}
    } else {
      try {
        const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        localLiveAudioStream = micStream;
        const micSource = liveAudioContext.createMediaStreamSource(micStream);
        micSource.connect(destination);
      } catch (e) {}
    }

    liveRecordedAudioChunks = [];
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') 
      ? 'audio/webm;codecs=opus' 
      : (MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4');

    liveMediaRecorder = new MediaRecorder(destination.stream, { mimeType });

    liveMediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        liveRecordedAudioChunks.push(e.data);
      }
    };

    liveMediaRecorder.onstop = () => {
      const blob = new Blob(liveRecordedAudioChunks, { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const now = new Date();
      const dateStr = `${now.getFullYear()}-${now.getMonth()+1}-${now.getDate()}_${now.getHours()}-${now.getMinutes()}`;
      a.href = url;
      a.download = `وانەی_ستافی_سیرین_${dateStr}.webm`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 100);
      alert('تۆمارکردنی دەنگ تەواو بوو و دەنگەکە بە سەرکەوتوویی داگیرا! 🎙️📥');
    };

    liveMediaRecorder.start(5000);
    liveRecordingStartTime = Date.now();

    if (recordBtn) recordBtn.className = 'px-3 py-2 bg-rose-600 hover:bg-rose-500 border border-rose-400 text-white rounded-xl text-xs font-black transition flex items-center gap-1.5 shadow-lg animate-pulse';
    if (recordDot) recordDot.className = 'w-2.5 h-2.5 rounded-full bg-white animate-ping';

    liveRecordingTimer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - liveRecordingStartTime) / 1000);
      const hrs = String(Math.floor(elapsed / 3600)).padStart(2, '0');
      const mins = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
      const secs = String(elapsed % 60).padStart(2, '0');
      if (recordText) recordText.innerText = `تۆمار دەکرێت (${hrs}:${mins}:${secs})`;
    }, 1000);

  } catch (err) {
    alert('نەتوانرا تۆمارکردنی دەنگ دەستپێبکرێت: ' + err.message);
  }
}

// Audio Output Switcher (دەرەوە / ناوەوە / بلوتوس)
function toggleAudioOutputMenu() {
  const menu = document.getElementById('liveAudioOutputMenu');
  if (menu) menu.classList.toggle('hidden');
}

async function selectLiveAudioOutput(type) {
  const menu = document.getElementById('liveAudioOutputMenu');
  if (menu) menu.classList.add('hidden');

  const icon = document.getElementById('liveAudioOutputIcon');
  const text = document.getElementById('liveAudioOutputText');

  let label = 'بڵندگۆ (دەرەوە)';
  let iconClass = 'fa-solid fa-volume-high text-emerald-400';

  if (type === 'earpiece') {
    label = 'بیستۆک (ناوەوە)';
    iconClass = 'fa-solid fa-phone text-sky-400';
  } else if (type === 'bluetooth') {
    label = 'بلوتوس / هێدفۆن';
    iconClass = 'fa-brands fa-bluetooth-b text-indigo-400';
  }

  if (icon) icon.className = iconClass;
  if (text) text.innerText = label;

  try {
    const liveAudio = document.getElementById('liveRoomAudio');
    const quranAudio = document.getElementById('liveQuranAudio');

    if (typeof HTMLMediaElement.prototype.setSinkId === 'function') {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioOutputs = devices.filter(d => d.kind === 'audiooutput');
      let targetDeviceId = '';

      if (type === 'bluetooth') {
        const bt = audioOutputs.find(d => d.label.toLowerCase().includes('bluetooth') || d.label.toLowerCase().includes('headset') || d.label.toLowerCase().includes('buds'));
        if (bt) targetDeviceId = bt.deviceId;
      } else if (type === 'earpiece') {
        const ep = audioOutputs.find(d => d.label.toLowerCase().includes('earpiece') || d.label.toLowerCase().includes('receiver'));
        if (ep) targetDeviceId = ep.deviceId;
      }

      if (targetDeviceId) {
        if (liveAudio && liveAudio.setSinkId) await liveAudio.setSinkId(targetDeviceId);
        if (quranAudio && quranAudio.setSinkId) await quranAudio.setSinkId(targetDeviceId);
        document.querySelectorAll('audio[id^="live_audio_"]').forEach(async el => {
          try { if (el.setSinkId) await el.setSinkId(targetDeviceId); } catch (e) {}
        });
      }
    }
    // Set appropriate volume level for output mode
    document.querySelectorAll('audio[id^="live_audio_"]').forEach(el => {
      el.volume = (type === 'earpiece' ? 0.35 : 1.0);
    });
  } catch (err) {
    console.log('Audio sink selection fallback:', err);
  }
}

// Moderation: Grant Mic, Revoke Mic, Kick
function grantLiveMicPermission(targetUserId) {
  socket.emit('live_grant_mic', { targetUserId });
}

function revokeLiveMicPermission(targetUserId) {
  socket.emit('live_revoke_mic', { targetUserId });
}

function kickUserFromLive(targetUserId, targetName) {
  if (!confirm(`ئایا دڵنیایت لە دەرکردنی (${targetName}) لەم وانەیە؟`)) return;
  socket.emit('live_kick', { targetUserId });
}

// Live Socket Event Handlers
function handleLiveLessonStateUpdate(state) {
  currentLiveLessonState = state;

  const isAdmin = currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'teacher' || currentUser.role === 'admin');

  const deskDot = document.getElementById('liveLessonPulseDot');
  const mobDot = document.getElementById('mobileLiveLessonPulseDot');
  const activeBadge = document.getElementById('liveLessonActiveBadge');
  const modalBadge = document.getElementById('liveLessonHeaderBadge');
  const timerBox = document.getElementById('liveDurationTimer');
  const modalTitle = document.getElementById('liveLessonModalTitle');
  const presenterText = document.getElementById('liveLessonPresenterText');
  const startEndBtn = document.getElementById('liveStartEndBtn');
  const startEndBtnText = document.getElementById('liveStartEndBtnText');

  const deskNavBtn = document.getElementById('liveLessonNavBtn');
  const mobNavBtn = document.getElementById('mobileLiveLessonBtn');

  if (state.isActive) {
    if (deskDot) deskDot.className = 'w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping ring-2 ring-rose-400';
    if (mobDot) mobDot.className = 'w-2 h-2 rounded-full bg-rose-500 animate-ping ring-2 ring-rose-400';
    if (deskNavBtn) {
      deskNavBtn.className = 'relative px-2.5 py-1.5 md:px-3 md:py-1.5 bg-rose-950/90 border-2 border-rose-500 text-white font-black text-xs rounded-xl shadow-lg shadow-rose-900/60 flex items-center gap-1.5 shrink-0 transition animate-pulse';
    }
    if (mobNavBtn) {
      mobNavBtn.className = 'relative px-3 py-1.5 rounded-xl bg-rose-950/90 border-2 border-rose-500 text-xs font-black text-white flex items-center gap-1.5 shrink-0 shadow-lg shadow-rose-900/60 active:scale-95 animate-pulse';
    }
    if (activeBadge) activeBadge.classList.remove('hidden');
    if (modalBadge) modalBadge.classList.remove('hidden');
    if (timerBox) timerBox.classList.remove('hidden');
    if (modalTitle) modalTitle.innerText = state.title || 'ژووری وانەی ڕاستەوخۆ';
    if (presenterText && state.startedBy) {
      presenterText.innerText = `وانەبێژ: ${state.startedBy.name} (${state.startedBy.role === 'teacher' ? 'مامۆستا' : 'سوپەر ئەدمین'})`;
    }
    const isTeacherOrSuperAdmin = currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'teacher');
    if (startEndBtn) {
      if (isTeacherOrSuperAdmin) {
        startEndBtn.classList.remove('hidden');
        startEndBtn.classList.add('flex');
        startEndBtn.style.setProperty('display', 'flex', 'important');
        startEndBtn.className = 'px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-black text-xs rounded-xl shadow-lg transition flex items-center gap-1.5 active:scale-95';
        if (startEndBtnText) startEndBtnText.innerText = 'کۆتاییهێنان بە وانە ⏹️';
      } else {
        startEndBtn.classList.add('hidden');
        startEndBtn.classList.remove('flex');
        startEndBtn.style.setProperty('display', 'none', 'important');
      }
    }

    if (!liveLessonDurationTimer && state.startedAt) {
      liveLessonDurationTimer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - state.startedAt) / 1000);
        const hrs = String(Math.floor(elapsed / 3600)).padStart(2, '0');
        const mins = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
        const secs = String(elapsed % 60).padStart(2, '0');
        const timerText = document.getElementById('liveDurationText');
        if (timerText) timerText.innerText = `${hrs}:${mins}:${secs}`;
      }, 1000);
    }
  } else {
    if (deskDot) deskDot.className = 'w-2.5 h-2.5 rounded-full bg-rose-950 border border-rose-900/60';
    if (mobDot) mobDot.className = 'w-2 h-2 rounded-full bg-rose-950 border border-rose-900/60';
    if (deskNavBtn) {
      deskNavBtn.className = 'relative px-2.5 py-1.5 md:px-3 md:py-1.5 bg-slate-900 border border-slate-800 text-slate-400 font-black text-xs rounded-xl transition flex items-center gap-1.5 shrink-0 shadow-sm opacity-80';
    }
    if (mobNavBtn) {
      mobNavBtn.className = 'relative px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs font-black text-slate-400 flex items-center gap-1.5 shrink-0 shadow-sm active:scale-95 opacity-80';
    }
    if (activeBadge) activeBadge.classList.add('hidden');
    if (modalBadge) modalBadge.classList.add('hidden');
    if (timerBox) timerBox.classList.add('hidden');
    if (modalTitle) modalTitle.innerText = 'ژووری وانەی ڕاستەوخۆ';
    if (presenterText) presenterText.innerText = 'چاوەڕوانی دەستپێکردنی وانەیە...';
    
    const isTeacherOrSuperAdmin = currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'teacher');
    if (startEndBtn) {
      if (isTeacherOrSuperAdmin) {
        startEndBtn.classList.remove('hidden');
        startEndBtn.classList.add('flex');
        startEndBtn.style.setProperty('display', 'flex', 'important');
        startEndBtn.className = 'px-4 py-2 bg-gradient-to-r from-rose-600 to-rose-700 hover:from-rose-500 text-white font-black text-xs rounded-xl shadow-lg transition flex items-center gap-1.5 active:scale-95';
        if (startEndBtnText) startEndBtnText.innerText = 'دەستپێکردنی وانە 🔴';
      } else {
        startEndBtn.classList.add('hidden');
        startEndBtn.classList.remove('flex');
        startEndBtn.style.setProperty('display', 'none', 'important');
      }
    }
    if (liveLessonDurationTimer) {
      clearInterval(liveLessonDurationTimer);
      liveLessonDurationTimer = null;
    }
    const timerText = document.getElementById('liveDurationText');
    if (timerText) timerText.innerText = '00:00:00';
  }

  const countBadge = document.getElementById('liveParticipantsCountBadge');
  const listEl = document.getElementById('liveParticipantsList');
  const participants = state.participants || [];
  if (countBadge) countBadge.innerText = participants.length;

  // Hand raised ALWAYS sorted to the VERY TOP!
  const sortedParticipants = [...participants].sort((a, b) => {
    if (a.handRaised && !b.handRaised) return -1;
    if (!a.handRaised && b.handRaised) return 1;
    return 0;
  });

  if (listEl) {
    if (sortedParticipants.length === 0) {
      listEl.innerHTML = '<div class="p-3 text-center text-slate-500 text-xs">هیچ کەسێک لە ژوورەکەدا نییە</div>';
    } else {
      listEl.innerHTML = sortedParticipants.map(p => {
        const isMe = currentUser && p.userId === currentUser.id;
        const roleLabel = p.role === 'super_admin' ? 'سوپەر ئەدمین' : (p.role === 'teacher' ? 'مامۆستا' : (p.role === 'admin' ? 'ئەدمین' : 'قوتابی'));
        const roleColor = p.role === 'super_admin' ? 'text-rose-400' : (p.role === 'teacher' ? 'text-amber-400' : (p.role === 'admin' ? 'text-indigo-400' : 'text-slate-400'));
        const isSpeaking = !p.isMuted && p.hasMicPermission;

        // Network Quality Ring & Warning Badge
        const q = p.networkQuality || 'good';
        let netColorClass = 'border-slate-700';
        let netBadgeHtml = '';
        if (q === 'poor') {
          netColorClass = 'border-rose-500 ring-2 ring-rose-500';
          netBadgeHtml = `<span class="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-400 text-[10px] font-black border border-rose-500/30 flex items-center gap-1">⚠️ خەتەکەی خراپە</span>`;
        } else if (q === 'fair') {
          netColorClass = 'border-amber-500 ring-1 ring-amber-500';
          netBadgeHtml = `<span class="px-1 py-0.5 text-amber-400 text-[10px] font-bold">خەت مامناوەند</span>`;
        } else {
          netColorClass = isSpeaking ? 'border-emerald-500 ring-2 ring-emerald-400' : 'border-slate-700';
        }

        let modButtonsHtml = '';
        if (isAdmin && !isMe) {
          modButtonsHtml = `
            <div class="flex items-center gap-1 mt-1.5 pt-1.5 border-t border-slate-800">
              ${p.hasMicPermission ? `
                <button onclick="revokeLiveMicPermission(${p.userId})" class="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-rose-300 rounded text-[10px] font-bold">
                  سەندنەوەی مایک 🔇
                </button>
              ` : `
                <button onclick="grantLiveMicPermission(${p.userId})" class="px-2 py-0.5 bg-emerald-600/30 hover:bg-emerald-600 text-emerald-300 hover:text-white rounded text-[10px] font-bold">
                  مۆڵەتدان بە مایک 🎙️
                </button>
              `}
              <button onclick="kickUserFromLive(${p.userId}, '${escapeHtml(p.fullName)}')" class="px-2 py-0.5 bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white rounded text-[10px] font-bold" title="دەرکردن لە وانە">
                دەرکردن 🚫
              </button>
            </div>
          `;
        }

        return `
          <div class="p-2.5 rounded-2xl bg-slate-900 border ${p.handRaised ? 'border-indigo-500 shadow-md shadow-indigo-950/40 bg-indigo-950/20' : (q === 'poor' ? 'border-rose-500/80 bg-rose-950/20' : (isSpeaking ? 'border-emerald-500/60 shadow-md' : 'border-slate-800'))} transition">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span class="w-8 h-8 rounded-full bg-slate-800 border-2 ${netColorClass} flex items-center justify-center text-xs relative shrink-0">
                  ${p.gender === 'female' ? '🧕' : '👤'}
                  ${p.handRaised ? '<span class="absolute -top-1 -right-1 text-xs">✋</span>' : ''}
                </span>
                <div>
                  <div class="font-black text-white text-xs flex items-center gap-1.5">
                    <span>${escapeHtml(p.fullName)}</span>
                    ${isMe ? '<span class="text-[9px] text-sky-400 font-bold">(خۆت)</span>' : ''}
                  </div>
                  <div class="flex items-center gap-1.5">
                    <span class="text-[10px] ${roleColor} font-bold">${roleLabel}</span>
                    ${netBadgeHtml}
                  </div>
                </div>
              </div>

              <div class="flex items-center gap-1.5">
                ${p.handRaised ? '<span class="px-2 py-0.5 rounded-md bg-indigo-600/30 text-indigo-300 text-[10px] font-black border border-indigo-500/40 animate-pulse">دەست هەڵبڕاو</span>' : ''}
                ${isSpeaking 
                  ? '<span class="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 text-[10px] font-black flex items-center gap-1"><i class="fa-solid fa-microphone text-xs animate-pulse"></i> قسە دەکات</span>' 
                  : '<i class="fa-solid fa-microphone-slash text-slate-600 text-xs" title="مایک داخراوە"></i>'
                }
              </div>
            </div>
            ${modButtonsHtml}
          </div>
        `;
      }).join('');
    }
  }

  const screenContainer = document.getElementById('liveScreenContainer');
  const standbyBox = document.getElementById('liveStandbyBox');
  const sharerNameEl = document.getElementById('liveScreenSharerName');

  if (state.screenSharingBy) {
    if (screenContainer) screenContainer.classList.remove('hidden');
    if (standbyBox) standbyBox.classList.add('hidden');
    if (sharerNameEl) sharerNameEl.innerText = `شاشەی ${state.screenSharingBy.name}`;
  } else if (!localLiveScreenStream) {
    if (screenContainer) screenContainer.classList.add('hidden');
    if (standbyBox) standbyBox.classList.remove('hidden');
  }

  if (state.quranState && state.quranState.isPlaying) {
    handleLiveQuranPlaying(state.quranState);
  } else {
    handleLiveQuranStopped();
  }
}

function handleLiveStartedAlert(data) {
  playSound('question');
  alert(`🔴 وانەی نوێ دەستیپێکرد: ${data.title || 'وانەی ڕاستەوخۆ'}\nلەلایەن: ${data.startedBy || 'مامۆستا'}`);
}

function handleLiveEndedNotice() {
  alert('وانەی ڕاستەوخۆ کۆتایی پێهات.');
  leaveLiveLessonRoom();
}

function handleLiveMicGranted() {
  localMicPermissionGranted = true;
  playSound('star');
  alert('مۆڵەتی مایکت پێبەخشرا لەلایەن مامۆستاوە! دەتوانیت مایک بکەیتەوە و قسە بکەیت 🎙️');
  const myParticipant = currentLiveLessonState && currentLiveLessonState.participants 
    ? currentLiveLessonState.participants.find(p => Number(p.userId) === (currentUser ? Number(currentUser.id) : null))
    : null;
  if (myParticipant) myParticipant.hasMicPermission = true;
}

function handleLiveMicRevoked() {
  localMicPermissionGranted = false;
  alert('مۆڵەتی مایکت لێسەندرایەوە لەلایەن بەڕێوەبەرەوە.');
  isLocalMicMuted = true;
  if (localLiveAudioStream) {
    localLiveAudioStream.getAudioTracks().forEach(t => t.enabled = false);
  }
  updateLiveMicUI(true);
}

function handleLiveKicked(reason) {
  alert(reason || 'تۆ لەم وانەیە دەرکرایت.');
  leaveLiveLessonRoom();
}

function handleLiveScreenStarted(sharer) {
  const screenContainer = document.getElementById('liveScreenContainer');
  const standbyBox = document.getElementById('liveStandbyBox');
  const sharerNameEl = document.getElementById('liveScreenSharerName');
  if (screenContainer) screenContainer.classList.remove('hidden');
  if (standbyBox) standbyBox.classList.add('hidden');
  if (sharerNameEl) sharerNameEl.innerText = `شاشەی ${sharer ? (sharer.name || sharer.fullName) : 'مامۆستا'}`;

  // If we are not the sharer, request live stream from the sharer
  if (sharer && sharer.socketId && sharer.socketId !== socket.id) {
    socket.emit('live_signal', {
      to: sharer.socketId,
      type: 'request_stream'
    });
  }
}

function handleLiveScreenStopped() {
  if (localLiveScreenStream) return;
  const screenContainer = document.getElementById('liveScreenContainer');
  const standbyBox = document.getElementById('liveStandbyBox');
  const video = document.getElementById('liveScreenVideo');
  if (screenContainer) screenContainer.classList.add('hidden');
  if (standbyBox) standbyBox.classList.remove('hidden');
  if (video) video.srcObject = null;
}

// =========================================================================
// 6. LIVE WEBRTC REAL-TIME PEER-TO-PEER ENGINE (AUDIO & SCREEN SHARE)
// =========================================================================

async function broadcastLiveMediaToPeer(targetSocketId) {
  if (!targetSocketId || targetSocketId === socket.id) return;

  let pc = livePeerConnections.get(targetSocketId);
  if (pc) {
    try { pc.close(); } catch (e) {}
    livePeerConnections.delete(targetSocketId);
  }

  pc = new RTCPeerConnection(rtcLiveIceConfig);
  livePeerConnections.set(targetSocketId, pc);

  // 1. Add screen video and audio tracks if local screen sharing is active
  if (localLiveScreenStream) {
    localLiveScreenStream.getTracks().forEach(track => {
      try { pc.addTrack(track, localLiveScreenStream); } catch (e) {}
    });
  }

  // 2. Add microphone audio track if mic is active and unmuted
  if (localLiveAudioStream && !isLocalMicMuted) {
    localLiveAudioStream.getAudioTracks().forEach(track => {
      if (track.enabled) {
        try { pc.addTrack(track, localLiveAudioStream); } catch (e) {}
      }
    });
  }

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('live_signal', {
        to: targetSocketId,
        type: 'candidate',
        candidate: event.candidate
      });
    }
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
      try { pc.close(); } catch (e) {}
      livePeerConnections.delete(targetSocketId);
    }
  };

  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('live_signal', {
      to: targetSocketId,
      type: 'offer',
      sdp: offer,
      hasVideo: !!localLiveScreenStream,
      hasAudio: !!(localLiveAudioStream && !isLocalMicMuted)
    });
  } catch (err) {
    console.error(`Failed to create live offer for ${targetSocketId}:`, err);
  }
}

function broadcastLiveMediaToAll() {
  if (!currentLiveLessonState || !currentLiveLessonState.participants) return;
  currentLiveLessonState.participants.forEach(p => {
    if (p.socketId && p.socketId !== socket.id) {
      broadcastLiveMediaToPeer(p.socketId);
    }
  });
}

function closeLivePeerConnection(targetSocketId) {
  if (livePeerConnections.has(targetSocketId)) {
    try {
      livePeerConnections.get(targetSocketId).close();
    } catch (e) {}
    livePeerConnections.delete(targetSocketId);
  }
  const audioElem = document.getElementById(`live_audio_${targetSocketId}`);
  if (audioElem) audioElem.remove();
}

async function handleLiveSignal(data) {
  if (!data || !data.from) return;
  const fromSocketId = data.from;

  try {
    if (data.type === 'request_stream') {
      if (localLiveScreenStream || (localLiveAudioStream && !isLocalMicMuted)) {
        broadcastLiveMediaToPeer(fromSocketId);
      }
      return;
    }

    if (data.type === 'offer' && data.sdp) {
      let pc = livePeerConnections.get(fromSocketId);
      if (pc) {
        try { pc.close(); } catch (e) {}
      }

      pc = new RTCPeerConnection(rtcLiveIceConfig);
      livePeerConnections.set(fromSocketId, pc);

      pc.ontrack = (event) => {
        const stream = (event.streams && event.streams[0]) || new MediaStream([event.track]);
        
        if (event.track.kind === 'video') {
          const video = document.getElementById('liveScreenVideo');
          const screenContainer = document.getElementById('liveScreenContainer');
          const standbyBox = document.getElementById('liveStandbyBox');
          if (video) {
            video.srcObject = stream;
            video.playsInline = true;
            video.autoplay = true;
            video.muted = true; // Essential: allows autoplay without user interaction block
            video.play().catch(e => console.log('Live screen video play:', e));
          }
          if (screenContainer) screenContainer.classList.remove('hidden');
          if (standbyBox) standbyBox.classList.add('hidden');
        } else if (event.track.kind === 'audio') {
          handleIncomingLiveAudio(event.track, stream, fromSocketId);
        }
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('live_signal', {
            to: fromSocketId,
            type: 'candidate',
            candidate: event.candidate
          });
        }
      };

      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));

      // Process any queued candidates
      if (pendingLiveCandidates.has(fromSocketId)) {
        const queue = pendingLiveCandidates.get(fromSocketId) || [];
        for (const c of queue) {
          try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch (e) {}
        }
        pendingLiveCandidates.delete(fromSocketId);
      }

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socket.emit('live_signal', {
        to: fromSocketId,
        type: 'answer',
        sdp: answer
      });
      return;
    }

    if (data.type === 'answer' && data.sdp) {
      const pc = livePeerConnections.get(fromSocketId);
      if (pc && pc.signalingState !== 'stable') {
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        if (pendingLiveCandidates.has(fromSocketId)) {
          const queue = pendingLiveCandidates.get(fromSocketId) || [];
          for (const c of queue) {
            try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch (e) {}
          }
          pendingLiveCandidates.delete(fromSocketId);
        }
      }
      return;
    }

    if (data.type === 'candidate' && data.candidate) {
      const pc = livePeerConnections.get(fromSocketId);
      if (pc && pc.remoteDescription && pc.remoteDescription.type) {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      } else {
        if (!pendingLiveCandidates.has(fromSocketId)) {
          pendingLiveCandidates.set(fromSocketId, []);
        }
        pendingLiveCandidates.get(fromSocketId).push(data.candidate);
      }
      return;
    }
  } catch (err) {
    console.error('Error handling live signal:', err);
  }
}

function handleIncomingLiveAudio(track, stream, fromSocketId) {
  let audioElem = document.getElementById(`live_audio_${fromSocketId}`);
  if (!audioElem) {
    audioElem = document.createElement('audio');
    audioElem.id = `live_audio_${fromSocketId}`;
    audioElem.autoplay = true;
    audioElem.playsInline = true;
    audioElem.className = 'hidden';
    document.body.appendChild(audioElem);
  }
  audioElem.srcObject = new MediaStream([track]);
  audioElem.muted = false;
  audioElem.play().catch(err => {
    console.log('Live audio autoplay need interaction:', err);
    const unlockAudio = () => {
      audioElem.play().catch(() => {});
      document.removeEventListener('click', unlockAudio);
      document.removeEventListener('touchstart', unlockAudio);
    };
    document.addEventListener('click', unlockAudio, { once: true });
    document.addEventListener('touchstart', unlockAudio, { once: true });
  });

  // Apply current audio output volume / mode
  applyLiveAudioOutputMode(audioElem);
}

function applyLiveAudioOutputMode(audioElem) {
  if (!audioElem) return;
  const currentOutput = document.getElementById('liveAudioOutputText');
  const label = currentOutput ? currentOutput.innerText : '';
  if (label.includes('بیستۆک')) {
    audioElem.volume = 0.35;
  } else {
    audioElem.volume = 1.0;
  }
}

function handleLivePeerJoined(data) {
  if (!data || !data.socketId) return;
  if (localLiveScreenStream || (localLiveAudioStream && !isLocalMicMuted)) {
    broadcastLiveMediaToPeer(data.socketId);
  }
}

function handleLivePeerLeft(data) {
  if (!data || !data.socketId) return;
  closeLivePeerConnection(data.socketId);
}

function handleLiveAudioChunk(data) {
  // Reserved for optional fallback streaming
}



