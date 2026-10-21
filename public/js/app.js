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
const mutedUserIds = new Map();

function isUserCurrentlyMuted(userId) {
  if (!userId) return false;
  if (mutedUserIds.has(userId)) {
    const until = mutedUserIds.get(userId);
    if (until > Date.now()) return true;
    mutedUserIds.delete(userId);
  }
  const cached = allMembersCache.find(u => u.id === userId);
  if (cached && cached.muted_until && cached.muted_until > Date.now()) {
    mutedUserIds.set(userId, cached.muted_until);
    return true;
  }
  return false;
}

// Unread messages tracking
let unreadCount = 0;
let isUserScrolledUp = false;

// Reply state
let activeReplyTo = null; // { id, full_name, content }

function setReplyToMessage(msgId, senderName, content) {
  activeReplyTo = { id: msgId, full_name: senderName, content: content };
  const bar = document.getElementById('chatReplyPreviewBar');
  const nameElem = document.getElementById('replyPreviewSenderName');
  const snippetElem = document.getElementById('replyPreviewSnippet');
  if (bar && nameElem && snippetElem) {
    nameElem.innerText = `وەڵامدانەوە بۆ: ${senderName}`;
    snippetElem.innerText = content || 'فایل / پەیامی دەنگی';
    bar.classList.remove('hidden');
    bar.classList.add('flex');
  }
  const input = document.getElementById('messageInput');
  if (input) input.focus();
}

function cancelReplyToMessage() {
  activeReplyTo = null;
  const bar = document.getElementById('chatReplyPreviewBar');
  if (bar) {
    bar.classList.add('hidden');
    bar.classList.remove('flex');
  }
}

function scrollToRepliedMessage(msgId) {
  const target = document.getElementById(`msg-${msgId}`);
  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add('ring-2', 'ring-amber-400', 'bg-amber-500/10');
    setTimeout(() => {
      target.classList.remove('ring-2', 'ring-amber-400', 'bg-amber-500/10');
    }, 2000);
  } else {
    showLiveToastNotification('پەیامی وەڵامدراوە لە مێژووی پێشووتریدایە', 'amber');
  }
}

function formatAudioDuration(secs) {
  if (!secs || isNaN(secs)) return '00:00';
  const mins = Math.floor(secs / 60);
  const remSecs = Math.floor(secs % 60);
  return `${pad(mins)}:${pad(remSecs)}`;
}

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
  const currentPoints = count % 10;
  const level = Math.floor(count / 10);
  
  let starType = 'yellow';
  let icon = '⭐';
  let badgeClass = 'star-badge-yellow';
  let levelName = 'ئاستی یەکەم (زەرد)';
  
  if (level === 1) {
    starType = 'green';
    icon = '⭐';
    badgeClass = 'star-badge-green';
    levelName = 'ئاستی دووەم (سەوز)';
  } else if (level === 2) {
    starType = 'purple';
    icon = '⭐';
    badgeClass = 'star-badge-purple';
    levelName = 'ئاستی سێیەم (مۆر)';
  } else if (level >= 3) {
    starType = 'trophy';
    icon = '🏆';
    badgeClass = 'star-badge-trophy';
    levelName = 'ئاستی قارەمان (کاس)';
  }

  return {
    stars: level + 1,
    level,
    points: currentPoints,
    total: count,
    starType,
    starIcons: icon,
    badgeClass,
    levelName,
    badgeText: `${icon} ${currentPoints}`
  };
}

// Name color classification based on role and gender
function getUserNameClass(user) {
  if (!user) return 'user-name-boy';
  const uname = (user.username || '').toLowerCase().trim();
  const isSuper = user.role === 'super_admin' || uname === 'admin' || uname === 'hemntjabar';
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
  const uname = (user.username || '').toLowerCase().trim();
  const isSuper = user.role === 'super_admin' || uname === 'admin' || uname === 'hemntjabar';

  if (user.role === 'guest') {
    prefix = '👁️ ';
  } else if (user.role === 'new_student') {
    suffix = ' 🔰';
  } else if (user.role === 'teacher') {
    suffix = ' 🎓';
  } else if (isSuper) {
    suffix = ' 🛡️';
  }
  return `${prefix}${user.full_name}${suffix}`;
}

function getGenderEmoji(gender) {
  return gender === 'female' ? '🧕' : '🧔';
}

function renderRoleBadge(role, gender) {
  const isGirl = gender === 'female';
  if (role === 'super_admin') {
    return '';
  } else if (role === 'teacher') {
    return `<span class="role-text-teacher inline-flex items-center gap-1 font-black text-[11px] select-none" title="مامۆستا"><i class="fa-solid fa-graduation-cap text-[10px]"></i> مامۆستا</span>`;
  } else if (role === 'admin') {
    return `<span class="role-text-admin inline-flex items-center gap-1 font-black text-[11px] select-none" title="ئەدمین"><i class="fa-solid fa-shield-halved text-[9px]"></i> ئەدمین</span>`;
  } else if (role === 'new_student') {
    const badgeClass = isGirl ? 'badge-new-student-girl' : 'badge-new-student';
    return `<span class="${badgeClass} px-2 py-0.5 rounded-md text-[10px] font-bold inline-flex items-center gap-1 shadow">🔰 قوتابی تازە</span>`;
  } else if (role === 'guest') {
    return `<span class="badge-guest px-2 py-0.5 rounded-md text-[10px] font-bold inline-flex items-center gap-1 shadow">👁️ میوان (چاودێر)</span>`;
  } else {
    const badgeClass = isGirl ? 'badge-student-girl' : 'badge-student';
    return `<span class="${badgeClass} px-2 py-0.5 rounded-md text-[10px] font-bold inline-flex items-center gap-1 shadow"><i class="fa-solid fa-graduation-cap text-[9px]"></i> قوتابی</span>`;
  }
}

function renderStarBadge(correctCount, role = 'student') {
  if (role && role !== 'student' && role !== 'new_student') {
    return '';
  }
  const info = calculateStars(correctCount);
  return `
    <span class="star-badge ${info.badgeClass} px-2 py-0.5 rounded-lg text-xs font-black inline-flex items-center gap-1 border" title="کۆی گشتی: ${info.total} (${info.levelName})">
      <span>${info.starIcons}</span>
      <span class="font-mono text-[11px] font-black">${info.points}</span>
    </span>
  `;
}

function isMasterSuperAdmin(user) {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  const uname = (user.username || '').toLowerCase();
  return uname === 'hemntjabar' || uname === 'hemn' || uname === 'admin' || user.id === 1;
}

const ALL_SPECIAL_BADGES = ['white', 'blue', 'green', 'black', 'red', 'purple'];

const BADGE_CONFIG = {
  white: {
    color: 'white',
    name: 'باجی سپی (ڕاوێژکار)',
    shortName: 'سپی',
    icon: 'fa-wand-magic-sparkles',
    dotColor: 'bg-white shadow-[0_0_6px_rgba(255,255,255,0.9)]',
    chipClass: 'bg-white/20 text-white border-white/50',
    emoji: '⚪',
    desc: 'مۆڵەتی ڕاوێژکاری زیرەکی ستاف (AI)'
  },
  blue: {
    color: 'blue',
    name: 'باجی شین (پاسەوان)',
    shortName: 'شین',
    icon: 'fa-shield',
    dotColor: 'bg-sky-400',
    chipClass: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
    emoji: '🔵',
    desc: 'سڕینەوەی پەیام و سڕکردنی سەرپێچیکار'
  },
  green: {
    color: 'green',
    name: 'باجی سەوز (بەڕێوەبەر)',
    shortName: 'سەوز',
    icon: 'fa-shield-halved',
    dotColor: 'bg-emerald-400',
    chipClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    emoji: '🟢',
    desc: 'بەڕێوەبردنی ئەندامان، پەسەندکردن، پلە و لایڤ'
  },
  black: {
    color: 'black',
    name: 'باجی ڕەش (سوپەر ئەدمین)',
    shortName: 'ڕەش',
    icon: 'fa-crown',
    dotColor: 'bg-slate-300',
    chipClass: 'bg-slate-950 text-slate-100 border-slate-700',
    emoji: '⚫',
    desc: 'دەسەڵاتی تەواوی سوپەر ئەدمین لە سیستەمدا'
  },
  red: {
    color: 'red',
    name: 'باجی سور (لایڤ)',
    shortName: 'سور',
    icon: 'fa-tower-broadcast',
    dotColor: 'bg-rose-400',
    chipClass: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
    emoji: '🔴',
    desc: 'بەڕێوەبەری وانەی ڕاستەوخۆ و کۆنتڕۆڵی لایڤ'
  },
  purple: {
    color: 'purple',
    name: 'باجی مۆر (خەون)',
    shortName: 'مۆر',
    icon: 'fa-moon',
    dotColor: 'bg-purple-400',
    chipClass: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
    emoji: '🟣',
    desc: 'مۆڵەتی لێکدانەوەی خەونی فێرخوازان'
  }
};

function parseUserBadges(userOrVal) {
  if (!userOrVal) return [];
  let raw = userOrVal;
  if (typeof userOrVal === 'object' && userOrVal !== null) {
    raw = userOrVal.special_badge;
  }
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map(b => String(b).trim().toLowerCase()).filter(b => ALL_SPECIAL_BADGES.includes(b));
  }
  if (typeof raw !== 'string') return [];
  const str = raw.trim();
  if (str.startsWith('[')) {
    try {
      const arr = JSON.parse(str);
      if (Array.isArray(arr)) {
        return arr.map(b => String(b).trim().toLowerCase()).filter(b => ALL_SPECIAL_BADGES.includes(b));
      }
    } catch (e) {}
  }
  return str.split(',').map(b => b.trim().toLowerCase()).filter(b => ALL_SPECIAL_BADGES.includes(b));
}

function hasUserBadge(userOrVal, badgeName) {
  const badges = parseUserBadges(userOrVal);
  return badges.includes(String(badgeName).toLowerCase());
}

function hasSuperAdminPrivileges(user) {
  if (!user) return false;
  if (isMasterSuperAdmin(user) || user.role === 'super_admin') return true;
  return hasUserBadge(user, 'black');
}

function canUserManageMembers(user) {
  if (!user) return false;
  if (hasSuperAdminPrivileges(user)) return true;
  return hasUserBadge(user, 'green');
}

function canUserLockChat(user) {
  if (!user) return false;
  if (hasSuperAdminPrivileges(user)) return true;
  return hasUserBadge(user, 'green');
}

function canUserManageLive(user) {
  if (!user) return false;
  if (hasSuperAdminPrivileges(user)) return true;
  return hasUserBadge(user, 'green') || hasUserBadge(user, 'red');
}

function canUserManageDreams(user) {
  if (!user) return false;
  if (isMasterSuperAdmin(user) || user.role === 'super_admin' || user.role === 'teacher') return true;
  return hasUserBadge(user, 'purple');
}

function canUserModerateChat(user) {
  if (!user) return false;
  if (isMasterSuperAdmin(user) || user.role === 'super_admin' || user.role === 'admin' || user.role === 'teacher') return true;
  return hasUserBadge(user, 'blue') || hasUserBadge(user, 'green') || hasUserBadge(user, 'black');
}

function renderSpecialBadgeHtml(badgeOrUser, options = {}) {
  const badges = parseUserBadges(badgeOrUser);
  if (badges.length === 0) return '';

  const showCount = options.showCount !== false;
  let html = '';

  if (badges.length === 6) {
    html += `
      <span class="px-1.5 py-0.5 rounded-md bg-gradient-to-r from-amber-500/25 via-purple-500/25 to-indigo-500/25 text-amber-300 border border-amber-400/50 text-[9px] font-black inline-flex items-center gap-1 shadow-sm" title="هەموو باجە تایبەتەکانی هەیە">
        <i class="fa-solid fa-crown text-[8px] text-amber-300"></i> هەموو باجەکان (٦ باج)
      </span>
    `;
  } else if (badges.length > 1 && showCount) {
    html += `
      <span class="px-1.5 py-0.5 rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 text-[9px] font-black inline-flex items-center gap-1 shadow-sm" title="خاوەنی ${badges.length} باجی تایبەتە">
        <i class="fa-solid fa-award text-[8px]"></i> ${badges.length} باج
      </span>
    `;
  }

  for (const b of badges) {
    const cfg = BADGE_CONFIG[b];
    if (!cfg) continue;
    html += `
      <span class="px-1.5 py-0.5 rounded-md ${cfg.chipClass} text-[9px] font-black inline-flex items-center gap-1 shadow-sm" title="${cfg.name}: ${cfg.desc}">
        <span class="w-1.5 h-1.5 rounded-full ${cfg.dotColor}"></span>
        <span>${cfg.name}</span>
      </span>
    `;
  }
  return html;
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
  initAppLanguage();
  initAppFontSize();
  initDrawerSettingsState();
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

  handleNotificationUrlParams();

  if (token) {
    await fetchCurrentUser();
    initPushNotifications();
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
  fetchChatLockStatus();
  loadPodiumWidget();
  loadAllMembers();
  checkMuteState();
  initPushNotifications();
  updatePrivateUnreadBadge();
  initQuranSurahsList();

  if (currentUser && (currentUser.role === 'super_admin' || hasSuperAdminPrivileges(currentUser) || canUserManageMembers(currentUser))) {
    checkPendingCount();
  }
  if (currentUser && (currentUser.role === 'super_admin' || hasSuperAdminPrivileges(currentUser) || canUserManageDreams(currentUser))) {
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
  headerNameElem.className = `text-xs font-black max-w-[65px] xs:max-w-[85px] sm:max-w-[120px] truncate block ${getUserNameClass(currentUser)}`;
  
  const isGirl = currentUser.gender === 'female';
  const roleBadgeElem = document.getElementById('headerRoleBadge');
  if (currentUser.role === 'super_admin') {
    roleBadgeElem.className = 'hidden';
    roleBadgeElem.innerText = '';
  } else if (currentUser.role === 'teacher') {
    roleBadgeElem.className = 'role-text-teacher text-[10px] font-black hidden sm:inline-flex items-center gap-1';
    roleBadgeElem.innerHTML = '<i class="fa-solid fa-graduation-cap text-[9px]"></i> مامۆستا';
  } else if (currentUser.role === 'admin') {
    roleBadgeElem.className = 'role-text-admin text-[10px] font-black hidden sm:inline-flex items-center gap-1';
    roleBadgeElem.innerHTML = '<i class="fa-solid fa-shield-halved text-[9px]"></i> ئەدمین';
  } else if (currentUser.role === 'new_student') {
    roleBadgeElem.className = `${isGirl ? 'badge-new-student-girl' : 'badge-new-student'} text-[9px] px-1.5 py-0.2 rounded font-bold hidden sm:inline-block`;
    roleBadgeElem.innerText = 'قوتابی تازە 🔰';
  } else if (currentUser.role === 'guest') {
    roleBadgeElem.className = 'badge-guest text-[9px] px-1.5 py-0.2 rounded font-bold hidden sm:inline-block';
    roleBadgeElem.innerText = 'میوان 👁️';
  } else {
    roleBadgeElem.className = `${isGirl ? 'badge-student-girl' : 'badge-student'} text-[9px] px-1.5 py-0.2 rounded font-bold hidden sm:inline-block`;
    roleBadgeElem.innerText = 'قوتابی 🎓';
  }

  const isStudentUser = currentUser.role === 'student' || currentUser.role === 'new_student';
  const headerStarEl = document.getElementById('headerStarBadge');
  const starInfo = calculateStars(currentUser.correct_answers_count);

  if (headerStarEl) {
    if (isStudentUser) {
      headerStarEl.classList.remove('hidden');
      headerStarEl.innerHTML = `
        <span>${starInfo.starIcons}</span>
        <span class="font-mono font-black">${starInfo.points}</span>
      `;
    } else {
      headerStarEl.classList.add('hidden');
    }
  }

  // Update Drawer User Profile Card
  const drawerAvatar = document.getElementById('drawerUserAvatar');
  const drawerName = document.getElementById('drawerUserName');
  const drawerRole = document.getElementById('drawerUserRoleBadge');
  const drawerStars = document.getElementById('drawerUserStars');
  if (drawerAvatar) drawerAvatar.innerText = getGenderEmoji(currentUser.gender);
  if (drawerName) {
    drawerName.innerText = currentUser.full_name;
    drawerName.className = `font-black text-xs truncate ${getUserNameClass(currentUser)}`;
  }
  if (drawerRole) {
    drawerRole.innerHTML = renderRoleBadge(currentUser.role, currentUser.gender);
  }
  if (drawerStars) {
    if (isStudentUser) {
      drawerStars.classList.remove('hidden');
      drawerStars.innerHTML = `${starInfo.starIcons} ${starInfo.points}`;
    } else {
      drawerStars.classList.add('hidden');
    }
  }

  const drawerSpecialBadges = document.getElementById('drawerUserSpecialBadges');
  if (drawerSpecialBadges) {
    const userBadges = parseUserBadges(currentUser.special_badge);
    if (userBadges.length > 0) {
      drawerSpecialBadges.classList.remove('hidden');
      const dots = userBadges.map(b => BADGE_CONFIG[b]?.emoji || '🎖️').join('');
      const countLabel = userBadges.length === 6 ? '٦ باج 🌟' : `${userBadges.length} باج`;
      drawerSpecialBadges.innerHTML = `<span class="px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-[9px] font-black">${countLabel} ${dots}</span>`;
    } else {
      drawerSpecialBadges.classList.add('hidden');
      drawerSpecialBadges.innerHTML = '';
    }
  }

  const isSuperAdmin = currentUser.role === 'super_admin';
  const isTeacher = currentUser.role === 'teacher';
  const hasBlackBadge = hasSuperAdminPrivileges(currentUser);
  const canManageMbrs = canUserManageMembers(currentUser); // Green Badge, Black Badge, or Super Admin
  const canLive = canUserManageLive(currentUser); // Green, Red, Black, Super Admin
  const canDream = canUserManageDreams(currentUser); // Purple, Super Admin, Teacher
  const canMod = canUserModerateChat(currentUser); // Blue, Green, Black, Super Admin, Teacher, Admin
  const hasAdvisorAccess = isMasterSuperAdmin(currentUser) || hasBlackBadge || hasUserBadge(currentUser, 'white');

  const isAdmin = currentUser.role === 'admin' || isSuperAdmin || isTeacher || hasBlackBadge;
  const canViewMembers = isAdmin || canManageMbrs;
  const canAccessSystemPanel = isSuperAdmin || hasBlackBadge || canManageMbrs;

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
  const drawerAiAdvisorBtn = document.getElementById('drawerAiAdvisorBtn');
  const drawerAiSecurityBtn = document.getElementById('drawerAiSecurityBtn');
  const drawerDreamAdminBtn = document.getElementById('drawerDreamAdminBtn');
  const drawerMembersBtn = document.getElementById('drawerMembersBtn');
  const drawerLibraryBtn = document.getElementById('drawerLibraryBtn');

  if (drawerStaffSection) {
    if (isAdmin || canDream || canManageMbrs || canLive || canMod || hasAdvisorAccess) {
      drawerStaffSection.classList.remove('hidden');
    } else {
      drawerStaffSection.classList.add('hidden');
    }
  }

  // System & Member Management Panel Button (Super Admin, Black Badge, Green Badge)
  if (canAccessSystemPanel) {
    if (adminPanelBtn) adminPanelBtn.classList.remove('hidden');
    if (drawerAdminPanelBtn) {
      drawerAdminPanelBtn.classList.remove('hidden');
      drawerAdminPanelBtn.classList.add('flex');
    }
    checkPendingCount();
  } else {
    if (adminPanelBtn) adminPanelBtn.classList.add('hidden');
    if (drawerAdminPanelBtn) {
      drawerAdminPanelBtn.classList.add('hidden');
      drawerAdminPanelBtn.classList.remove('flex');
    }
  }

  // AI Security Operations Center (Super Admin or Black Badge)
  if (isSuperAdmin || hasBlackBadge) {
    if (drawerAiSecurityBtn) {
      drawerAiSecurityBtn.classList.remove('hidden');
      drawerAiSecurityBtn.classList.add('flex');
    }
  } else {
    if (drawerAiSecurityBtn) {
      drawerAiSecurityBtn.classList.add('hidden');
      drawerAiSecurityBtn.classList.remove('flex');
    }
  }

  // AI Proactive Advisor Button in Drawer (Master Super Admin, Super Admin, Black Badge, or White Badge)
  if (drawerAiAdvisorBtn) {
    if (hasAdvisorAccess) {
      drawerAiAdvisorBtn.classList.remove('hidden');
      drawerAiAdvisorBtn.classList.add('flex');
    } else {
      drawerAiAdvisorBtn.classList.add('hidden');
      drawerAiAdvisorBtn.classList.remove('flex');
    }
  }

  const dreamAdminNavBtn = document.getElementById('dreamAdminNavBtn');
  if (canDream) {
    if (dreamAdminNavBtn) dreamAdminNavBtn.classList.remove('hidden');
    if (drawerDreamAdminBtn) {
      drawerDreamAdminBtn.classList.remove('hidden');
      drawerDreamAdminBtn.classList.add('flex');
    }
    loadDreamSessionsCount();
  } else {
    if (dreamAdminNavBtn) dreamAdminNavBtn.classList.add('hidden');
    if (drawerDreamAdminBtn) {
      drawerDreamAdminBtn.classList.add('hidden');
      drawerDreamAdminBtn.classList.remove('flex');
    }
  }

  // Member Management & Members List visibility (Admin, Super Admin, Teacher, Black Badge, Green Badge)
  if (canViewMembers) {
    if (drawerMembersBtn) {
      drawerMembersBtn.classList.remove('hidden');
      drawerMembersBtn.classList.add('flex');
    }
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
    if (drawerMembersBtn) {
      drawerMembersBtn.classList.add('hidden');
      drawerMembersBtn.classList.remove('flex');
    }
    if (membersNavBtn) membersNavBtn.classList.add('hidden');
    if (membersSidebar) {
      membersSidebar.classList.add('hidden');
      membersSidebar.classList.remove('flex');
      membersSidebar.classList.add('translate-x-full');
    }
    const membersBackdrop = document.getElementById('membersBackdrop');
    if (membersBackdrop) membersBackdrop.classList.add('hidden');
  }

  // Questions and Admin Media Tools (Admin, Super Admin, Teacher, or Black Badge)
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
  }

  // Dream Submission Button: Hidden for staff (Admin, Teacher, Super Admin)
  const drawerDreamSubmitBtn = document.getElementById('drawerDreamSubmitBtn');
  if (drawerDreamSubmitBtn) {
    const isStaff = currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'admin' || currentUser.role === 'teacher');
    if (isStaff) {
      drawerDreamSubmitBtn.classList.add('hidden');
      drawerDreamSubmitBtn.classList.remove('flex');
    } else {
      drawerDreamSubmitBtn.classList.remove('hidden');
      drawerDreamSubmitBtn.classList.add('flex');
    }
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

  // Start/End Lesson & Screen share: Super Admin or Special Badge holders (strictly hidden from normal teachers/admins/students)
  if (canLive) {
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

  // Quran changing controls & Recording button: visible to live managers (Super Admin or badge holders)
  if (canLive) {
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
  try {
    const lastVisible = (typeof getVisibleMessageIdForRestore === 'function') 
      ? getVisibleMessageIdForRestore() 
      : ((typeof getHighestVisibleMessageId === 'function') ? getHighestVisibleMessageId() : 0);
    if (currentUser && lastVisible > 0) {
      setLocalLastReadMessageId(currentUser.id, lastVisible);
      if (token) {
        fetch('/api/chat/last-read', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ message_id: lastVisible }),
          keepalive: true
        }).catch(() => {});
      }
    }
  } catch (e) {}

  localStorage.removeItem('seereen_token');
  token = null;
  currentUser = null;
  if (socket) socket.disconnect();
  showAuthScreen();
}

// --- TOP 3 PODIUM WIDGET (COLLAPSIBLE) ---
function togglePodiumDropdown() {
  const content = document.getElementById('podiumDropdownContent');
  const arrow = document.getElementById('podiumToggleArrow');
  if (!content) return;
  const isHidden = content.classList.contains('hidden');
  if (isHidden) {
    content.classList.remove('hidden');
    if (arrow) arrow.className = 'fa-solid fa-chevron-up text-[10px] text-amber-400/80 transition-transform duration-200';
    loadPodiumWidget();
  } else {
    content.classList.add('hidden');
    if (arrow) arrow.className = 'fa-solid fa-chevron-down text-[10px] text-amber-400/80 transition-transform duration-200';
  }
}

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
      pill.className = `flex items-center gap-1.5 px-2 py-0.5 rounded-xl border ${borders[idx]} cursor-pointer hover:scale-105 transition shrink-0 shadow-sm`;
      pill.onclick = () => openUserProfileModal(st.id);
      pill.innerHTML = `
        <span class="text-xs sm:text-sm shrink-0">${medals[idx]}</span>
        <span class="text-[11px] sm:text-xs font-bold max-w-[75px] xs:max-w-[95px] sm:max-w-[140px] truncate block ${stNameClass}">${escapeHtml(st.full_name)}</span>
        <span class="text-[10px] text-amber-400 font-mono font-black shrink-0">${st.starInfo.starIcons}</span>
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

// --- BROWSER / ANDROID SYSTEM NOTIFICATIONS & WEB PUSH ---
let isPushSubscribed = false;

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function isPushNotificationSupported() {
  return ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window);
}

async function updatePushNotificationUI() {
  if (!isPushNotificationSupported()) {
    const btn = document.getElementById('pushNotificationBtn');
    if (btn) btn.classList.add('opacity-50');
    const drawerBadge = document.getElementById('drawerNotificationStatusBadge');
    if (drawerBadge) {
      drawerBadge.innerText = 'پشتگیری ناکرێت';
      drawerBadge.className = 'text-[10px] bg-rose-500/20 text-rose-300 font-bold px-2 py-0.5 rounded-md';
    }
    const profBadge = document.getElementById('profNotificationStatusBadge');
    if (profBadge) {
      profBadge.innerText = 'پشتگیری ناکرێت';
      profBadge.className = 'text-[10px] bg-rose-500/20 text-rose-300 font-bold px-2 py-0.5 rounded-md';
    }
    return;
  }

  const permission = Notification.permission;
  let active = false;

  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    active = !!sub && permission === 'granted';
    isPushSubscribed = active;
  } catch (err) {
    // ignore
  }

  // 1. Header Button
  const headerIcon = document.getElementById('pushNotificationIcon');
  const headerText = document.getElementById('pushNotificationText');
  const headerBtn = document.getElementById('pushNotificationBtn');
  if (headerBtn) {
    if (active) {
      headerBtn.classList.remove('border-slate-800', 'text-slate-400');
      headerBtn.classList.add('border-amber-500/50', 'text-amber-400', 'bg-amber-500/10');
      if (headerIcon) headerIcon.className = 'fa-solid fa-bell text-amber-400 text-sm';
      if (headerText) headerText.innerText = 'ئاگاداری (چالاکە)';
    } else {
      headerBtn.classList.remove('border-amber-500/50', 'text-amber-400', 'bg-amber-500/10');
      headerBtn.classList.add('border-slate-800', 'text-slate-400');
      if (headerIcon) headerIcon.className = permission === 'denied' ? 'fa-solid fa-bell-slash text-rose-400 text-sm' : 'fa-regular fa-bell text-slate-400 text-sm';
      if (headerText) headerText.innerText = permission === 'denied' ? 'ئاگاداری (بلۆک)' : 'ئاگاداری';
    }
  }

  // 2. Drawer Items
  const drawerIcon = document.getElementById('drawerNotificationIcon');
  const drawerBadge = document.getElementById('drawerNotificationStatusBadge');
  if (drawerBadge) {
    if (active) {
      drawerBadge.innerText = 'چالاکە 🔔';
      drawerBadge.className = 'text-[10px] bg-emerald-500/20 text-emerald-300 font-bold px-2 py-0.5 rounded-md border border-emerald-500/30';
      if (drawerIcon) drawerIcon.className = 'fa-solid fa-bell text-emerald-400 text-sm w-5 text-center';
    } else if (permission === 'denied') {
      drawerBadge.innerText = 'بلۆککراوە 🚫';
      drawerBadge.className = 'text-[10px] bg-rose-500/20 text-rose-300 font-bold px-2 py-0.5 rounded-md border border-rose-500/30';
      if (drawerIcon) drawerIcon.className = 'fa-solid fa-bell-slash text-rose-400 text-sm w-5 text-center';
    } else {
      drawerBadge.innerText = 'ناچالاک 🔕';
      drawerBadge.className = 'text-[10px] bg-slate-700 text-slate-300 font-bold px-2 py-0.5 rounded-md';
      if (drawerIcon) drawerIcon.className = 'fa-solid fa-bell text-slate-400 text-sm w-5 text-center';
    }
  }

  // 3. User Profile Modal Items
  const profBadge = document.getElementById('profNotificationStatusBadge');
  const profToggleBtn = document.getElementById('profNotificationToggleBtn');
  const profTestBtn = document.getElementById('profNotificationTestBtn');

  if (profBadge) {
    if (active) {
      profBadge.innerText = 'چالاکە 🔔';
      profBadge.className = 'text-[10px] bg-emerald-500/20 text-emerald-300 font-bold px-2.5 py-0.5 rounded-full border border-emerald-500/30';
      if (profToggleBtn) {
        profToggleBtn.className = 'flex-1 py-2 px-3 bg-rose-600/30 hover:bg-rose-600 text-rose-300 hover:text-white font-bold text-xs rounded-xl border border-rose-500/40 transition flex items-center justify-center gap-1.5 active:scale-95';
        profToggleBtn.innerHTML = '<i class="fa-solid fa-bell-slash"></i><span>ناچالاککردن</span>';
      }
      if (profTestBtn) profTestBtn.classList.remove('hidden');
    } else if (permission === 'denied') {
      profBadge.innerText = 'بلۆککراوە لە وێبگەڕ 🚫';
      profBadge.className = 'text-[10px] bg-rose-500/20 text-rose-300 font-bold px-2.5 py-0.5 rounded-full border border-rose-500/30';
      if (profToggleBtn) {
        profToggleBtn.className = 'flex-1 py-2 px-3 bg-slate-700 text-slate-400 font-bold text-xs rounded-xl cursor-not-allowed flex items-center justify-center gap-1.5';
        profToggleBtn.innerHTML = '<i class="fa-solid fa-ban"></i><span>بلۆککراوە لە Settings</span>';
      }
      if (profTestBtn) profTestBtn.classList.add('hidden');
    } else {
      profBadge.innerText = 'ناچالاک 🔕';
      profBadge.className = 'text-[10px] bg-amber-500/20 text-amber-300 font-bold px-2.5 py-0.5 rounded-full border border-amber-500/30';
      if (profToggleBtn) {
        profToggleBtn.className = 'flex-1 py-2 px-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black text-xs rounded-xl shadow-lg transition flex items-center justify-center gap-1.5 active:scale-95';
        profToggleBtn.innerHTML = '<i class="fa-solid fa-bell"></i><span>چالاککردنی ئاگاداری مۆبایل</span>';
      }
      if (profTestBtn) profTestBtn.classList.add('hidden');
    }
  }

  // 4. Banner visibility
  const banner = document.getElementById('notificationPermissionBanner');
  if (banner) {
    if (active || permission === 'denied' || sessionStorage.getItem('dismissed_push_banner') === 'true' || !currentUser) {
      banner.classList.add('hidden');
    } else if (permission === 'default') {
      banner.classList.remove('hidden');
    }
  }
}

async function initPushNotifications() {
  if (!isPushNotificationSupported()) return;

  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    
    if (sub && Notification.permission === 'granted' && token) {
      // Sync with server in background to keep active
      fetch('/api/notifications/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          subscription: sub.toJSON(),
          userAgent: navigator.userAgent
        })
      }).catch(() => {});
      isPushSubscribed = true;
    }
  } catch (err) {
    console.warn('initPushNotifications error:', err);
  }

  updatePushNotificationUI();
}

function requestNotificationPermission() {
  initPushNotifications();
}

async function subscribeToPushNotifications(showFeedback = true) {
  if (!isPushNotificationSupported()) {
    if (showFeedback) alert('ببورە! ئەم وێبگەڕە پشتگیری لە سیستەمی ئاگاداری مۆبایل و شاشە (Push Notifications) ناکات.');
    return false;
  }

  try {
    // 1. Request permission
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      if (showFeedback) {
        if (permission === 'denied') {
          alert('ئاگادارییەکان لە وێبگەڕەکەتدا بلۆک کراون (Blocked).\nتکایە لە بەشی سێتینگی وێبگەڕ یان مۆبایلەکەت ڕێگەپێدان بدە بە Notifications.');
        } else {
          showLiveToastNotification('ڕێگەپێدانی ئاگاداری پەسەند نەکرا!', 'amber');
        }
      }
      updatePushNotificationUI();
      return false;
    }

    // 2. Fetch VAPID public key
    const keyRes = await fetch('/api/notifications/vapid-public-key');
    if (!keyRes.ok) throw new Error('سێرڤەر کلیلی ئاگاداری نەدۆزییەوە');
    const { publicKey } = await keyRes.json();
    if (!publicKey) throw new Error('Public key missing');

    // 3. Register or get subscription
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const appKey = urlBase64ToUint8Array(publicKey);
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: appKey
      });
    }

    // 4. Send subscription to server
    if (token) {
      const res = await fetch('/api/notifications/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          subscription: sub.toJSON(),
          userAgent: navigator.userAgent
        })
      });
      if (!res.ok) throw new Error('نەتوانرا لە سێرڤەر تۆمار بکرێت');
    }

    isPushSubscribed = true;
    updatePushNotificationUI();
    const banner = document.getElementById('notificationPermissionBanner');
    if (banner) banner.classList.add('hidden');

    if (showFeedback) {
      showLiveToastNotification('ئاگادارییەکانی مۆبایل و شاشە بە سەرکەوتوویی چالاک کران! 🔔', 'emerald');
    }
    return true;
  } catch (err) {
    console.error('Error subscribing to push notifications:', err);
    if (showFeedback) {
      alert('نەتوانرا ئاگادارییەکان چالاک بکرێن: ' + (err.message || err));
    }
    updatePushNotificationUI();
    return false;
  }
}

async function unsubscribeFromPushNotifications(showFeedback = true) {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      if (token) {
        await fetch('/api/notifications/unsubscribe', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ endpoint: sub.endpoint })
        }).catch(() => {});
      }
      await sub.unsubscribe();
    }
    isPushSubscribed = false;
    updatePushNotificationUI();
    if (showFeedback) {
      showLiveToastNotification('ئاگادارییەکانی سەر شاشە ناچالاک کران 🔕', 'slate');
    }
    return true;
  } catch (err) {
    console.error('Error unsubscribing:', err);
    return false;
  }
}

async function togglePushNotifications() {
  if (!isPushNotificationSupported()) {
    alert('ئەم ئامێرە یان وێبگەڕە پشتگیری لە ئاگاداری سیستەم ناکات.');
    return;
  }

  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();

  if (sub && Notification.permission === 'granted') {
    if (confirm('ئایا دڵنیایت لە ناچالاککردنی ئاگادارییەکانی سەر شاشە و مۆبایل؟')) {
      await unsubscribeFromPushNotifications(true);
    }
  } else {
    await subscribeToPushNotifications(true);
  }
}

async function testPushNotification() {
  if (!token) {
    alert('تکایە سەرەتا بچۆ ژوورەوە بۆ تاقیکردنەوە.');
    return;
  }
  if (!isPushSubscribed && Notification.permission !== 'granted') {
    const ok = confirm('ئاگادارییەکان لەسەر ئەم ئامێرە هێشتا چالاک نەکراون! ئایا دەتەوێت سەرەتا چالاکیان بکەیت؟');
    if (ok) {
      const subSuccess = await subscribeToPushNotifications(true);
      if (!subSuccess) return;
    } else {
      return;
    }
  }

  try {
    showLiveToastNotification('ناردنی ئاگاداری تاقیکاری...', 'indigo');
    const res = await fetch('/api/notifications/test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });
    const data = await res.json();
    if (res.ok) {
      showLiveToastNotification('ئاگاداری تاقیکاری نێردرا! سەیری سەر شاشە و دەنگی مۆبایلەکەت بکە 🔔', 'emerald');
    } else {
      alert(data.error || 'هەڵەیەک لە ناردنی ئاگاداری تاقیکاری ڕوویدا');
    }
  } catch (err) {
    alert('هەڵە لە پەیوەندی بە سێرڤەر: ' + err.message);
  }
}

function dismissNotificationBanner() {
  const banner = document.getElementById('notificationPermissionBanner');
  if (banner) banner.classList.add('hidden');
  sessionStorage.setItem('dismissed_push_banner', 'true');
}

async function enablePushNotificationsFromBanner() {
  const success = await subscribeToPushNotifications(true);
  if (success) {
    dismissNotificationBanner();
  }
}

function handleNotificationUrlParams() {
  try {
    const params = new URLSearchParams(window.location.search);
    const action = params.get('action');
    if (!action) return;

    if (action === 'live') {
      setTimeout(() => {
        if (typeof openLiveLessonModal === 'function') {
          openLiveLessonModal();
        }
      }, 700);
    } else if (action === 'question') {
      const qId = params.get('id');
      setTimeout(() => {
        if (qId) {
          const el = document.querySelector(`[data-question-id="${qId}"]`);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.classList.add('ring-4', 'ring-amber-500', 'transition-all');
            setTimeout(() => {
              el.classList.remove('ring-4', 'ring-amber-500');
            }, 3000);
          }
        }
      }, 900);
    }

    // Clean up URL parameters cleanly
    const cleanUrl = window.location.origin + window.location.pathname;
    window.history.replaceState({}, document.title, cleanUrl);
  } catch (e) {
    console.warn('handleNotificationUrlParams error:', e);
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
    if (typeof loadUserCustomGroups === 'function') loadUserCustomGroups();
  });

  // Custom Groups Socket Events
  socket.on('new_group_message', (data) => {
    if (typeof handleIncomingCustomGroupMessage === 'function') handleIncomingCustomGroupMessage(data);
  });
  socket.on('custom_group_activity', (data) => {
    if (typeof handleCustomGroupActivity === 'function') handleCustomGroupActivity(data);
  });
  socket.on('group_advisor_typing', (data) => {
    if (typeof handleGroupAdvisorTyping === 'function') handleGroupAdvisorTyping(data);
  });
  socket.on('custom_group_user_typing', (data) => {
    if (typeof handleCustomGroupUserTyping === 'function') handleCustomGroupUserTyping(data);
  });
  socket.on('group_message_deleted', (data) => {
    if (typeof handleGroupMessageDeleted === 'function') handleGroupMessageDeleted(data);
  });
  socket.on('custom_group_created', () => {
    if (typeof loadUserCustomGroups === 'function') loadUserCustomGroups();
  });
  socket.on('custom_group_deleted', (data) => {
    if (typeof activeCustomGroupId !== 'undefined' && activeCustomGroupId === data?.groupId) {
      alert('ئەم گروپ چاتە سڕایەوە');
      if (typeof closeCustomGroupChatModal === 'function') closeCustomGroupChatModal();
    }
    if (typeof loadUserCustomGroups === 'function') loadUserCustomGroups();
  });
  socket.on('custom_group_renamed', (data) => {
    if (typeof activeCustomGroupId !== 'undefined' && activeCustomGroupId === data?.groupId) {
      const titleEl = document.getElementById('customGroupModalTitle');
      if (titleEl && data.name) titleEl.innerText = data.name;
    }
    if (typeof loadUserCustomGroups === 'function') loadUserCustomGroups();
  });
  socket.on('custom_group_members_updated', (data) => {
    if (typeof activeCustomGroupId !== 'undefined' && activeCustomGroupId === data?.groupId) {
      if (typeof updateCustomGroupMembersCount === 'function') updateCustomGroupMembersCount(data.members);
    }
    if (typeof loadUserCustomGroups === 'function') loadUserCustomGroups();
  });
  socket.on('custom_group_list_refresh', () => {
    if (typeof loadUserCustomGroups === 'function') loadUserCustomGroups();
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
      } else {
        syncLastReadMessageWithServer(msg.id);
      }
    } else {
      syncLastReadMessageWithServer(msg.id);
    }
  });

  socket.on('new_question', (data) => {
    playSound('question');
    triggerStarCelebration();
    loadActiveQuestion();
    sendQuestionNotification(data.question);
  });

  // Secret submission count updated in real time
  socket.on('submission_count_updated', (data) => {
    if (data && data.question_id) {
      if (todayQuestionsList) {
        const found = todayQuestionsList.find(q => q.id === data.question_id);
        if (found) found.submission_count = data.submission_count;
      }
      if (activeQuestion && activeQuestion.id === data.question_id) {
        activeQuestion.submission_count = data.submission_count;
        const badge = document.getElementById('modalStickySubmissionCountBadge');
        if (badge) badge.innerText = `${data.submission_count} وەڵام تۆمارکراوە`;
      }
    }
  });

  // Simultaneous reveal of all answers!
  socket.on('question_revealed', (data) => {
    playSound('question');
    triggerStarCelebration();
    loadActiveQuestion();
    loadMessages();
  });

  socket.on('question_closed', (data) => {
    const qId = data && data.question_id;
    if (qId && todayQuestionsList) {
      const found = todayQuestionsList.find(q => q.id == qId);
      if (found) found.is_active = 0;
    }
    loadActiveQuestion();
  });

  socket.on('question_cancelled', (data) => {
    const qId = data && data.question_id;
    if (qId && todayQuestionsList) {
      todayQuestionsList = todayQuestionsList.filter(q => q.id != qId);
    }
    if (activeQuestion && (!qId || activeQuestion.id == qId)) {
      activeQuestion = null;
      closeActiveQuestionModal();
    }
    loadActiveQuestion();
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
      if (profStars) profStars.innerHTML = `${starInfo.starIcons} ${starInfo.points}`;
    }
    loadPodiumWidget();
    loadLeaderboard();
  });

  socket.on('user_avatar_updated', (data) => {
    if (currentUser && currentUser.id === data.user_id) {
      currentUser.avatar_url = data.avatar_url;
      const drawerAvatar = document.getElementById('drawerUserAvatar');
      if (drawerAvatar) {
        drawerAvatar.innerHTML = `<img src="${escapeHtml(data.avatar_url)}" class="w-full h-full object-cover rounded-xl pointer-events-none select-none no-zoom-avatar" draggable="false" oncontextmenu="return false;">`;
      }
    }
    if (typeof currentProfileUserId !== 'undefined' && currentProfileUserId === data.user_id) {
      const profAvatar = document.getElementById('profAvatar');
      if (profAvatar) {
        profAvatar.innerHTML = `<img src="${escapeHtml(data.avatar_url)}" alt="Avatar" class="w-full h-full object-cover rounded-2xl pointer-events-none select-none no-zoom-avatar" style="width:100%;height:100%;max-width:100%;max-height:100%;object-fit:cover;" draggable="false" oncontextmenu="return false;">`;
      }
    }
  });

  socket.on('user_special_badge_updated', (data) => {
    if (currentUser && currentUser.id === data.user_id) {
      currentUser.special_badge = data.special_badge;
      updateUserUI();
    }
    if (Array.isArray(allMembersCache)) {
      const u = allMembersCache.find(m => Number(m.id) === Number(data.user_id));
      if (u) {
        u.special_badge = data.special_badge;
        renderMembersList();
      }
    }
    if (Array.isArray(allUsersAdminCache)) {
      const u = allUsersAdminCache.find(m => Number(m.id) === Number(data.user_id));
      if (u) {
        u.special_badge = data.special_badge;
        renderAllUsersList();
      }
    }
    if (typeof currentProfileUserId !== 'undefined' && currentProfileUserId === data.user_id) {
      openUserProfileModal(data.user_id);
    }
  });

  socket.on('new_profile_change_request', () => {
    if (currentUser && (currentUser.role === 'super_admin' || hasSuperAdminPrivileges(currentUser) || canUserManageMembers(currentUser))) {
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
      currentUser.last_star_awarded_at = data.last_star_awarded_at || Date.now();
      updateUserUI();
      triggerStarCelebration();
    }

    // Instantly add radiant star glow to all visible messages from this student in chat
    if (data.user_id) {
      document.querySelectorAll(`.msg-sender-name[data-sender-user-id="${data.user_id}"]`).forEach(nameEl => {
        nameEl.classList.add('user-name-star-glow');
      });
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
    if (data && data.user_id) {
      mutedUserIds.set(data.user_id, data.muted_until || (Date.now() + 24 * 3600 * 1000));
      updateMsgMuteButtons(data.user_id);
    }
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
    if (data && data.user_id) {
      mutedUserIds.delete(data.user_id);
      updateMsgMuteButtons(data.user_id);
    }
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
    if (currentUser && (currentUser.role === 'super_admin' || hasSuperAdminPrivileges(currentUser) || canUserManageMembers(currentUser))) {
      checkPendingCount();
    }
  });

  socket.on('new_dream_session', () => {
    if (canUserManageDreams(currentUser)) {
      loadDreamSessionsCount();
      playSound('message');
      if (typeof loadDreamAdminSessions === 'function') loadDreamAdminSessions();
    }
  });

  // Receive live dream messages for Super Admin, Teacher, and Purple Badge
  socket.on('dream_new_message', (msg) => {
    if (canUserManageDreams(currentUser)) {
      if (typeof activeDreamAdminSessionId !== 'undefined' && activeDreamAdminSessionId && (msg.session_id == activeDreamAdminSessionId || msg.sessionId == activeDreamAdminSessionId)) {
        appendDreamMessage(msg, true);
        scrollDreamMessagesToBottom(true);
      }
    }
  });

  socket.on('dream_admin_new_message', (data) => {
    if (canUserManageDreams(currentUser)) {
      const msg = data.message || data;
      const sessId = data.sessionId || (msg && msg.session_id);
      if (typeof activeDreamAdminSessionId !== 'undefined' && activeDreamAdminSessionId && activeDreamAdminSessionId == sessId) {
        appendDreamMessage(msg, true);
        scrollDreamMessagesToBottom(true);
      }
      if (msg && msg.sender_type === 'dreamer') {
        playSound('message');
      }
      loadDreamSessionsCount();
      if (typeof loadDreamAdminSessions === 'function') {
        loadDreamAdminSessions();
      }
    }
  });

  socket.on('chat_lock_status_updated', (data) => {
    updateChatLockUI(data);
  });

  socket.on('red_alert_state_changed', (data) => {
    isRedAlertActiveGlobal = !!(data && (data.active !== undefined ? data.active : data.is_active));
    updateRedAlertUIState({ active: isRedAlertActiveGlobal });
    if (typeof loadAiSecurityStats === 'function') {
      loadAiSecurityStats();
    }
  });

  socket.on('security_incident_alert', (incident) => {
    if (currentUser && (hasSuperAdminPrivileges(currentUser) || currentUser.role === 'super_admin')) {
      showSecurityIncidentToast(incident);
      if (typeof loadAiSecurityStats === 'function') {
        loadAiSecurityStats();
      }
    }
  });

  socket.on('dream_session_updated', () => {
    if (currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'teacher')) {
      loadDreamSessionsCount();
      if (typeof loadDreamAdminSessions === 'function') loadDreamAdminSessions();
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

  socket.on('dream_session_answered', (data) => {
    if (currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'teacher')) {
      if (data && data.sessionId) {
        const s = dreamAdminSessionsCache.find(x => x.id === data.sessionId);
        if (s) {
          s.answered_by_name = data.answered_by_name;
          s.answered_by_role = data.answered_by_role;
          if (typeof renderDreamAdminSessionsCards === 'function') renderDreamAdminSessionsCards();
        }
        if (activeDreamAdminSessionId === data.sessionId) {
          const statusElem = document.getElementById('dreamAdminChatStatus');
          if (statusElem) {
            statusElem.innerHTML = `وەڵامدراوەتەوە لەلایەن: <strong class="text-emerald-400 font-bold">${escapeHtml(data.answered_by_name)}</strong>`;
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

  socket.on('chat_cleared', () => {
    const container = document.getElementById('messagesContainer');
    if (container) container.innerHTML = '';
  });

  socket.on('messages_restored', (data) => {
    loadMessages();
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

  // Action button clicked in chat (@دوگمە)
  socket.on('message_button_clicked', (data) => {
    // data: { message_id, user_id, user_name, total_clicks }
    const countEl = document.querySelector(`#action-clicks-count-${data.message_id} .clicks-num`);
    if (countEl) {
      countEl.innerText = data.total_clicks;
    }
    if (currentUser && currentUser.id === data.user_id) {
      const btn = document.getElementById(`action-btn-${data.message_id}`);
      if (btn) {
        btn.className = 'action-chat-btn w-full px-5 py-3 rounded-2xl font-black text-sm flex items-center justify-center gap-2.5 transition-all duration-300 active:scale-95 shadow-lg select-none cursor-pointer action-btn-green';
        btn.setAttribute('data-clicked', 'true');
        btn.innerHTML = '<i class="fa-solid fa-circle-check text-base animate-scale-up"></i><span>تۆمارکراوە (دەستت لێداوە) ✅</span>';
      }
    }
  });

  // New private message received
  socket.on('new_private_message', (msg) => {
    handleNewPrivateMessage(msg);
  });

  // Group tag mention alert (@هەموو, @هەمو, @1)
  socket.on('mention_all_alert', (data) => {
    handleMentionAllAlert(data);
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

  socket.on('live_audit_updated', () => {
    const modal = document.getElementById('aiAdvisorModal');
    if (modal && !modal.classList.contains('hidden') && typeof loadAdvisorOverview === 'function') {
      loadAdvisorOverview();
    }
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

  socket.on('live_peer_mic_state', (data) => {
    handleLivePeerMicState(data);
  });

  socket.on('live_audio_chunk', (data) => {
    handleLiveAudioChunk(data);
  });

  socket.on('error_message', (err) => {
    alert(err);
  });
}

// --- LAST READ MESSAGE & SCROLL RESTORATION (TELEGRAM-STYLE) ---
let isRestoringChatPosition = false;

function getLocalLastReadMessageId(userId) {
  if (!userId) return 0;
  const val = localStorage.getItem(`seereen_last_read_msg_${userId}`);
  return val ? parseInt(val, 10) : 0;
}

function setLocalLastReadMessageId(userId, msgId) {
  if (!userId || !msgId) return;
  localStorage.setItem(`seereen_last_read_msg_${userId}`, String(msgId));
}

let lastSyncMsgId = 0;
let lastSyncTimeout = null;

function syncLastReadMessageWithServer(msgId, immediate = false) {
  if (!currentUser || !token || !msgId) return;
  setLocalLastReadMessageId(currentUser.id, msgId);
  if (msgId === lastSyncMsgId && !immediate) return;
  lastSyncMsgId = msgId;

  clearTimeout(lastSyncTimeout);
  if (immediate) {
    fetch('/api/chat/last-read', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ message_id: msgId }),
      keepalive: true
    }).catch(() => {});
    return;
  }

  lastSyncTimeout = setTimeout(() => {
    fetch('/api/chat/last-read', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ message_id: msgId })
    }).catch(() => {});
  }, 500);
}

function getVisibleMessageIdForRestore() {
  const container = document.getElementById('messagesContainer');
  if (!container) return 0;
  const items = container.querySelectorAll('.chat-msg-item[id^="msg-"]');
  if (!items || items.length === 0) return 0;

  // If scrolled to or near bottom (within 40px), consider all read -> return latest message id
  const scrollFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
  if (scrollFromBottom <= 40) {
    const lastEl = items[items.length - 1];
    return parseInt(lastEl.id.replace('msg-', ''), 10) || 0;
  }

  const containerRect = container.getBoundingClientRect();
  // Find first message visible near top of container viewport
  for (let i = 0; i < items.length; i++) {
    const el = items[i];
    const rect = el.getBoundingClientRect();
    if (rect.bottom >= containerRect.top + 25) {
      const id = parseInt(el.id.replace('msg-', ''), 10);
      if (id) return id;
    }
  }

  return getHighestVisibleMessageId();
}

function getHighestVisibleMessageId() {
  const container = document.getElementById('messagesContainer');
  if (!container) return 0;
  const containerRect = container.getBoundingClientRect();
  const items = container.querySelectorAll('.chat-msg-item[id^="msg-"]');
  if (!items || items.length === 0) return 0;

  // If scrolled to or near bottom, consider all read
  const scrollFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
  if (scrollFromBottom <= 40) {
    const lastEl = items[items.length - 1];
    const lastId = parseInt(lastEl.id.replace('msg-', ''), 10);
    if (lastId) return lastId;
  }

  // Iterate backwards to find highest message visible in container viewport
  for (let i = items.length - 1; i >= 0; i--) {
    const el = items[i];
    const rect = el.getBoundingClientRect();
    if (rect.top <= containerRect.bottom - 20) {
      const id = parseInt(el.id.replace('msg-', ''), 10);
      if (id) return id;
    }
  }

  return 0;
}

// --- MESSAGES LOGIC ---
async function loadMessages() {
  isRestoringChatPosition = true;
  try {
    const res = await fetch('/api/chat/messages', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    const container = document.getElementById('messagesContainer');
    container.innerHTML = '';

    if (data.messages && data.messages.length > 0) {
      const serverLastRead = data.last_read_message_id || 0;
      const localLastRead = currentUser ? getLocalLastReadMessageId(currentUser.id) : 0;
      const userLastReadId = serverLastRead || localLastRead || 0;

      const latestMsg = data.messages[data.messages.length - 1];
      const hasUnread = userLastReadId > 0 && userLastReadId < latestMsg.id;
      let dividerInserted = false;

      data.messages.forEach(msg => {
        if (hasUnread && !dividerInserted && msg.id > userLastReadId) {
          const divider = document.createElement('div');
          divider.id = 'chatUnreadDivider';
          divider.className = 'chat-unread-divider my-3.5 flex items-center justify-center gap-3 select-none';
          divider.innerHTML = `
            <div class="h-px bg-indigo-500/40 flex-1"></div>
            <span class="px-3.5 py-1 rounded-full bg-indigo-950/90 border border-indigo-500/40 text-indigo-300 font-black text-xs shadow-md flex items-center gap-1.5 animate-pulse">
              <i class="fa-solid fa-arrow-down text-[10px] text-amber-400"></i> پەیامە نەبینراوەکان
            </span>
            <div class="h-px bg-indigo-500/40 flex-1"></div>
          `;
          container.appendChild(divider);
          dividerInserted = true;
        }
        appendMessage(msg, false);
      });

      if (hasUnread) {
        // Freeze at last read / unread divider (Telegram-style)
        isUserScrolledUp = true;
        const arrowBtn = document.getElementById('scrollToLatestBtn');
        if (arrowBtn) {
          arrowBtn.classList.remove('hidden');
          arrowBtn.classList.add('flex');
        }
        const unreadMessagesCount = data.messages.filter(m => m.id > userLastReadId).length;
        if (unreadMessagesCount > 0) {
          unreadCount = unreadMessagesCount;
          const pill = document.getElementById('unreadJumpPill');
          const countText = document.getElementById('unreadCountText');
          if (pill && countText) {
            countText.innerText = `${unreadMessagesCount} پەیامی نوێ`;
            pill.classList.remove('hidden');
          }
        }

        const scrollToTarget = () => {
          const targetEl = document.getElementById('chatUnreadDivider') || document.getElementById('msg-' + userLastReadId);
          if (targetEl && container) {
            targetEl.scrollIntoView({ behavior: 'instant', block: 'start' });
            container.scrollTop = Math.max(0, container.scrollTop - 40);
          }
        };

        // Scroll immediately
        scrollToTarget();

        // Re-confirm after rendering stabilization
        setTimeout(() => {
          scrollToTarget();
          isRestoringChatPosition = false;
        }, 150);
      } else {
        scrollToBottom();
        if (latestMsg) {
          syncLastReadMessageWithServer(latestMsg.id);
        }
        setTimeout(() => {
          isRestoringChatPosition = false;
        }, 200);
      }
    } else {
      isRestoringChatPosition = false;
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
    isRestoringChatPosition = false;
    console.error('Failed to load messages:', err);
  }
}

// =========================================================================
// KURDISH DATE & TIME HELPERS FOR CHAT MESSAGES
// =========================================================================
const KURDISH_MONTHS = [
  'کانوونی دووەم', 'شوبات', 'ئازار', 'نیسان', 'ئایار', 'حوزەیران',
  'تەمووز', 'ئاب', 'ئەیلوول', 'تشرینی یەکەم', 'تشرینی دووەم', 'کانوونی یەکەم'
];
const KURDISH_WEEKDAYS = [
  'یەکشەممە', 'دووشەممە', 'سێشەممە', 'چوارشەممە', 'پێنجشەممە', 'هەینی', 'شەممە'
];

function getMessageDateTimeInfo(timestamp) {
  if (!timestamp) {
    return {
      shortTime: '',
      shortDate: '',
      dayName: '',
      fullDateStr: '',
      exactTimeStr: '',
      relativeTime: '',
      detailedText: ''
    };
  }
  const raw = (typeof timestamp === 'string' && !isNaN(Number(timestamp))) ? Number(timestamp) : timestamp;
  const d = new Date(raw);
  if (isNaN(d.getTime())) {
    return {
      shortTime: '',
      shortDate: '',
      dayName: '',
      fullDateStr: '',
      exactTimeStr: '',
      relativeTime: '',
      detailedText: ''
    };
  }

  const dayName = KURDISH_WEEKDAYS[d.getDay()] || '';
  const dayNum = d.getDate();
  const monthName = KURDISH_MONTHS[d.getMonth()] || '';
  const yearNum = d.getFullYear();

  const hours24 = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  const isPm = hours24 >= 12;
  const period = isPm ? 'د.ن' : 'ب.ن'; // د.ن = دوای نیوەڕۆ, ب.ن = پێش نیوەڕۆ
  const hours12 = hours24 % 12 || 12;
  const hours12Str = String(hours12).padStart(2, '0');

  const shortTime = `${hours12Str}:${minutes} ${period}`;
  const shortMonthMap = {
    'کانوونی دووەم': 'کانوون',
    'شوبات': 'شوبات',
    'ئازار': 'ئازار',
    'نیسان': 'نیسان',
    'ئایار': 'ئایار',
    'حوزەیران': 'حوزەیران',
    'تەمووز': 'تەمووز',
    'ئاب': 'ئاب',
    'ئەیلوول': 'ئەیلوول',
    'تشرینی یەکەم': 'تشرین',
    'تشرینی دووەم': 'تشرین',
    'کانوونی یەکەم': 'کانوون'
  };
  const shortMonth = shortMonthMap[monthName] || monthName.split(' ')[0] || '';
  const shortDate = `${dayNum} ${shortMonth}`;

  // Relative time calculation
  const now = Date.now();
  const diffSec = Math.max(0, Math.floor((now - d.getTime()) / 1000));
  let relativeTime = '';
  if (diffSec < 45) {
    relativeTime = 'کەمێک لەمەوبەر';
  } else if (diffSec < 3600) {
    const mins = Math.floor(diffSec / 60);
    relativeTime = `پێش ${mins} خولەک`;
  } else if (diffSec < 86400) {
    const hrs = Math.floor(diffSec / 3600);
    relativeTime = `پێش ${hrs} کاتژمێر`;
  } else if (diffSec < 172800) {
    relativeTime = 'دوێنێ';
  } else {
    const days = Math.floor(diffSec / 86400);
    relativeTime = `پێش ${days} ڕۆژ`;
  }

  const fullDateStr = `${dayName}، ${dayNum}ی ${monthName}ی ${yearNum}`;
  const exactTimeStr = `${hours12Str}:${minutes}:${seconds} ${period}`;
  const detailedText = `📅 ${fullDateStr} • ⏰ ${exactTimeStr} (${relativeTime})`;

  return {
    shortTime,
    shortDate,
    dayName,
    fullDateStr,
    exactTimeStr,
    relativeTime,
    detailedText
  };
}

function appendMessage(msg, scroll = true) {
  const container = document.getElementById('messagesContainer');
  const emptyPlaceholder = container.querySelector('.empty-welcome-box, .text-slate-500');
  if (emptyPlaceholder) emptyPlaceholder.remove();

  const isMe = currentUser && msg.user_id === currentUser.id;
  const isAdmin = currentUser && (currentUser.role === 'admin' || currentUser.role === 'super_admin');
  const isSuperAdmin = currentUser && currentUser.role === 'super_admin';
  const isStaff = currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'teacher');
  const isChatMod = canUserModerateChat(currentUser);
  const timeInfo = getMessageDateTimeInfo(msg.created_at);
  const dateStr = timeInfo.shortTime || new Date(msg.created_at).toLocaleTimeString('ku-IQ', { hour: '2-digit', minute: '2-digit' });

  let msgElem = document.createElement('div');
  msgElem.id = `msg-${msg.id}`;
  msgElem.className = 'transition-all duration-200 chat-msg-item';

  // 1. SYSTEM MESSAGES (welcome messages disabled)
  if (msg.type === 'system') {
    if (msg.content && msg.content.includes('بەخێرهات')) {
      return;
    }
    msgElem.className = 'chat-msg-item flex justify-center my-2 select-none';
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
          const TWO_DAYS_MS = 48 * 60 * 60 * 1000;
          const isStudentGlowing = Boolean(s.is_star_glowing || (s.last_star_awarded_at && (Date.now() - Number(s.last_star_awarded_at) <= TWO_DAYS_MS)));
          const sNameClass = `${getUserNameClass(s)} ${isStudentGlowing ? 'user-name-star-glow' : ''}`;
          const timeFormatted = s.submitted_at ? new Date(s.submitted_at).toLocaleTimeString('ku-IQ', { hour: '2-digit', minute: '2-digit' }) : '';
          
          let cardBorderClass = 'border-slate-700/70 bg-slate-850/80 hover:border-slate-600 shadow';
          let answerBoxClass = 'bg-slate-900/90 border-slate-750 text-slate-100';
          let statusBadge = '';
          let cornerBadge = '';
          
          if (s.is_awarded === 1) {
            cardBorderClass = 'border-2 border-teal-500/80 bg-teal-950/30 ring-1 ring-teal-400/30 shadow-lg shadow-teal-500/10';
            answerBoxClass = 'answer-box-turquoise';
            statusBadge = `
              <span class="px-2 py-0.5 bg-teal-500/20 text-teal-300 border border-teal-500/40 font-black text-[11px] rounded-lg inline-flex items-center gap-1 animate-pulse">
                <i class="fa-solid fa-star text-amber-400"></i>
                <span>وەڵامی دروستە ⭐</span>
              </span>
            `;
            cornerBadge = `
              <div class="eval-corner-star">
                <span>⭐</span>
                <span>ڕاستە</span>
              </div>
            `;
          } else if (s.is_awarded === -1) {
            cardBorderClass = 'border-2 border-amber-500/80 bg-amber-950/20 ring-1 ring-amber-500/30 shadow-md shadow-amber-500/10';
            answerBoxClass = 'answer-box-yellow';
            statusBadge = `
              <span class="px-2 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-500/40 font-black text-[11px] rounded-lg inline-flex items-center gap-1">
                <i class="fa-solid fa-circle-xmark text-rose-400"></i>
                <span>وەڵامی هەڵەیە ❌</span>
              </span>
            `;
            cornerBadge = `
              <div class="eval-corner-wrong">
                <span>❌</span>
                <span>هەڵە</span>
              </div>
            `;
          }

          let subTransBtnHtml = '';
          if ((currentAppLanguage === 'ar' || currentAppLanguage === 'en') && s.answer_text) {
            const tLabel = currentAppLanguage === 'ar' ? 'ترجمة' : 'Translate';
            subTransBtnHtml = `
              <button type="button" onclick="translateSubmissionAnswer(${payload.question_id}, ${s.user_id}, this)" class="text-[10px] text-sky-300 hover:text-white px-1.5 py-0.5 bg-slate-800/80 hover:bg-slate-700 rounded-lg border border-slate-700/60 inline-flex items-center gap-1 transition shadow-sm" title="${tLabel}">
                <i class="fa-solid fa-language text-sky-400"></i>
                <span>${tLabel}</span>
              </button>
            `;
          }

          return `
            <div id="sub-card-${payload.question_id}-${s.user_id}" class="submission-card-item p-3 sm:p-4 rounded-2xl border flex flex-col gap-2.5 transition-all duration-300 relative ${cardBorderClass}">
              <!-- Header Row: Student Info & Actions -->
              <div class="flex items-center justify-between gap-2 flex-wrap w-full border-b border-white/5 pb-2">
                <div class="flex items-center gap-2 flex-wrap min-w-0">
                  <span class="text-xs font-mono font-bold text-slate-400">${idx + 1}.</span>
                  <span data-sender-user-id="${s.user_id}" class="msg-sender-name text-xs sm:text-sm font-black cursor-pointer hover:underline ${sNameClass}" onclick="openUserProfileModal(${s.user_id})">${escapeHtml(s.full_name)}</span>
                  <span class="text-[10px] text-slate-400 font-mono">${timeFormatted}</span>
                  <span class="eval-badge-container-${payload.question_id}-${s.user_id}">
                    ${statusBadge}
                  </span>
                  ${subTransBtnHtml}
                </div>
                <div class="shrink-0 eval-slot eval-slot-${payload.question_id}-${s.user_id}">
                  ${isStaff ? `
                    ${s.is_awarded === 1 ? `
                      <div class="flex items-center gap-1">
                        <span class="px-2.5 py-1 bg-teal-600/30 text-teal-300 border border-teal-500/40 font-black text-xs rounded-xl inline-flex items-center gap-1">
                          <i class="fa-solid fa-circle-check text-teal-400"></i>
                          <span>ڕاستە ⭐</span>
                        </span>
                        <button onclick="resetEvaluationFromReveal(${payload.question_id}, ${s.user_id}, '${escapeHtml(s.full_name)}', this)" class="p-1.5 hover:bg-slate-700 text-slate-400 hover:text-white rounded-lg text-xs" title="گەڕاندنەوە">
                          <i class="fa-solid fa-rotate-left text-[11px]"></i>
                        </button>
                      </div>
                    ` : (s.is_awarded === -1 ? `
                      <div class="flex items-center gap-1">
                        <span class="px-2.5 py-1 bg-amber-600/30 text-amber-300 border border-amber-500/40 font-black text-xs rounded-xl inline-flex items-center gap-1">
                          <i class="fa-solid fa-circle-xmark text-rose-400"></i>
                          <span>هەڵە ❌</span>
                        </span>
                        <button onclick="resetEvaluationFromReveal(${payload.question_id}, ${s.user_id}, '${escapeHtml(s.full_name)}', this)" class="p-1.5 hover:bg-slate-700 text-slate-400 hover:text-white rounded-lg text-xs" title="گەڕاندنەوە">
                          <i class="fa-solid fa-rotate-left text-[11px]"></i>
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
                      <span class="px-2.5 py-1 bg-teal-500/20 border border-teal-500/40 text-teal-300 font-black text-xs rounded-xl inline-flex items-center gap-1 shadow-sm">
                        <i class="fa-solid fa-star text-amber-400"></i>
                        <span>وەڵامی دروست ⭐</span>
                      </span>
                    ` : (s.is_awarded === -1 ? `
                      <span class="px-2.5 py-1 bg-amber-500/20 border border-amber-500/40 text-amber-300 font-black text-xs rounded-xl inline-flex items-center gap-1 shadow-sm">
                        <i class="fa-solid fa-circle-xmark text-rose-400"></i>
                        <span>وەڵامی هەڵە ❌</span>
                      </span>
                    ` : `
                      <span class="px-2 py-0.5 text-slate-500 font-medium text-[11px] rounded-lg bg-slate-900/60 border border-slate-800">هێشتا نەپشکنراوە</span>
                    `)}
                  `}
                </div>
              </div>

              <!-- Full Width Answer Box with Corner Badge -->
              <div class="relative w-full mt-1">
                <div id="sub-answer-box-${payload.question_id}-${s.user_id}" class="sub-answer-box relative w-full text-xs sm:text-sm p-3.5 rounded-xl border font-medium whitespace-pre-wrap leading-relaxed select-text shadow-sm transition-all duration-300 ${answerBoxClass}">
                  ${cornerBadge}
                  <div id="sub-answer-content-${payload.question_id}-${s.user_id}">"${escapeHtml(s.answer_text)}"</div>
                </div>
              </div>
            </div>
          `;
        }).join('');
      }

      // Official Answer by Admin / Teacher (Prominent Emerald Green Box at the bottom with Reactions)
      let modelAnswerHtml = '';
      if (payload.model_answer && payload.model_answer.trim()) {
        const reactionsHtml = renderMessageReactionsHtml(msg.reactions || [], msg.id);
        let modelTransBtnHtml = '';
        if ((currentAppLanguage === 'ar' || currentAppLanguage === 'en') && payload.model_answer) {
          const tLabel = currentAppLanguage === 'ar' ? 'ترجمة' : 'Translate';
          modelTransBtnHtml = `
            <button type="button" onclick="translateModelAnswer(${payload.question_id}, this)" class="text-[10px] text-emerald-300 hover:text-white px-2 py-0.5 bg-emerald-900/60 hover:bg-emerald-800 rounded-lg border border-emerald-500/40 inline-flex items-center gap-1 transition shadow-sm" title="${tLabel}">
              <i class="fa-solid fa-language text-emerald-300"></i>
              <span>${tLabel}</span>
            </button>
          `;
        }

        modelAnswerHtml = `
          <div class="mt-3.5 p-3.5 rounded-2xl bg-emerald-950/40 border-2 border-emerald-500/70 shadow-lg text-emerald-200">
            <div class="flex items-center justify-between mb-2 flex-wrap gap-1">
              <span class="text-xs font-black text-emerald-400 flex items-center gap-1.5">
                <i class="fa-solid fa-circle-check text-base text-emerald-400"></i>
                <span>وەڵامی دروستی دیاریکراوی مامۆستا (کۆتا وەڵام):</span>
              </span>
              <div class="flex items-center gap-1.5">
                ${modelTransBtnHtml}
                <span class="text-[10px] bg-emerald-500/20 text-emerald-300 font-bold px-2 py-0.5 rounded-md border border-emerald-500/30">
                  ڕاستیی پرسیار ✨
                </span>
              </div>
            </div>

            <div id="model-answer-content-${payload.question_id}" class="text-xs md:text-sm font-black text-white bg-slate-900/90 p-3 rounded-xl border border-emerald-500/30 whitespace-pre-wrap leading-relaxed select-text shadow-inner">
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

      let qTransBtnHtml = '';
      if ((currentAppLanguage === 'ar' || currentAppLanguage === 'en') && payload.question_text) {
        const tLabel = currentAppLanguage === 'ar' ? 'ترجمة' : 'Translate';
        qTransBtnHtml = `
          <button type="button" onclick="translateQuestionContent(${payload.question_id}, this)" class="text-[10px] text-amber-300 hover:text-white px-1.5 py-0.5 bg-slate-800/80 hover:bg-slate-700 rounded-lg border border-slate-700/60 inline-flex items-center gap-1 transition shadow-sm" title="${tLabel}">
            <i class="fa-solid fa-language text-amber-400"></i>
            <span>${tLabel}</span>
          </button>
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
            <div class="flex items-center justify-between text-[11px] text-amber-400 font-black mb-1">
              <div class="flex items-center gap-1">
                <i class="fa-solid fa-circle-question"></i>
                <span>دەقی پرسیاری ژمارە ${payload.question_number || ''}:</span>
              </div>
              ${qTransBtnHtml}
            </div>
            <p id="question-content-${payload.question_id}" class="text-sm font-black text-white leading-relaxed">
              ${escapeHtml(payload.question_text)}
            </p>
          </div>

          <div class="mb-2">
            <div class="flex items-center justify-between mb-2">
              <span class="text-xs font-black text-slate-200 flex items-center gap-1.5">
                <i class="fa-solid fa-list-check text-emerald-400"></i>
                <span>وەڵامە وەرگیراوەکانی قوتابیان:</span>
              </span>
              ${isSuperAdmin ? '<span class="text-[11px] text-amber-400 font-bold bg-amber-500/10 px-2 py-0.5 rounded-lg border border-amber-500/20">تەنها ئەدمین دەتوانێت وەڵامی دروست دیاری بکات و ئەستێرە ببەخشێت ⭐</span>' : ''}
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

    let durationText = `${qData.duration_minutes || 5} خولەک`;
    const dur = parseInt(qData.duration_minutes) || 5;
    if (dur >= 60) {
      const h = Math.floor(dur / 60);
      const m = dur % 60;
      durationText = m > 0 ? `${h} کاتژمێر و ${m} خولەک` : `${h} کاتژمێر`;
    }

    let activeQTransBtnHtml = '';
    if ((currentAppLanguage === 'ar' || currentAppLanguage === 'en') && qData.question_text) {
      const tLabel = currentAppLanguage === 'ar' ? 'ترجمة' : 'Translate';
      activeQTransBtnHtml = `
        <button type="button" onclick="translateQuestionContent(${qData.question_id || msg.id}, this)" class="text-[10px] text-amber-300 hover:text-white px-1.5 py-0.5 bg-slate-800/80 hover:bg-slate-700 rounded-lg border border-slate-700/60 inline-flex items-center gap-1 transition shadow-sm" title="${tLabel}">
          <i class="fa-solid fa-language text-amber-400"></i>
          <span>${tLabel}</span>
        </button>
      `;
    }

    msgElem.className = 'chat-msg-item w-full my-3';
    msgElem.setAttribute('data-question-id', qData.question_id || msg.id);
    msgElem.setAttribute('data-question-number', qData.question_number || '1');
    msgElem.innerHTML = `
      <div class="question-glow bg-slate-900 border border-amber-500/40 rounded-2xl md:rounded-3xl p-3.5 sm:p-5 shadow-2xl relative overflow-hidden max-w-2xl mx-auto">
        <!-- Row 1: Question Badge + Date & Staff Controls -->
        <div class="flex items-center justify-between pb-2 mb-2 border-b border-amber-500/20 gap-2">
          <span class="px-2.5 py-1 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-black text-xs flex items-center gap-1.5 shadow shrink-0">
            <i class="fa-solid fa-circle-question text-[11px]"></i>
            <span>پرسیاری ژمارە #${qData.question_number || 1}</span>
          </span>

          <div class="flex items-center gap-1.5 shrink-0">
            ${isStaff ? `
              <button type="button" onclick="openEditQuestionModal(${qData.question_id || msg.id})" class="px-2 py-1 bg-sky-600/20 hover:bg-sky-600 text-sky-300 hover:text-white border border-sky-500/40 rounded-lg text-[11px] font-bold transition flex items-center gap-1 shadow-sm active:scale-95" title="دەستکاریکردنی ئەم پرسیارە">
                <i class="fa-solid fa-pen-to-square text-[10px]"></i>
                <span class="hidden sm:inline">دەستکاری</span>
              </button>
              <button type="button" onclick="deleteQuestionDirect(${qData.question_id || msg.id}, ${msg.id})" class="px-2 py-1 bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/40 rounded-lg text-[11px] font-bold transition flex items-center gap-1 shadow-sm active:scale-95" title="سڕینەوەی ئەم پرسیارە">
                <i class="fa-solid fa-trash-can text-[10px]"></i>
                <span class="hidden sm:inline">سڕینەوە</span>
              </button>
            ` : ''}
            <span class="text-[10px] text-slate-400 font-mono bg-slate-950/70 border border-slate-800 px-1.5 py-0.5 rounded-md flex items-center gap-1 select-none">
              <i class="fa-regular fa-clock text-[9px] opacity-60"></i>
              <span>${timeInfo.shortTime}</span>
              <span class="opacity-40">•</span>
              <span class="opacity-75">${timeInfo.shortDate}</span>
            </span>
          </div>
        </div>

        <!-- Row 2: Author, Target, and Timer Pills -->
        <div class="flex items-center gap-2 flex-wrap mb-2 text-[11px]">
          <span class="text-xs text-amber-200 font-bold flex items-center gap-1">
            <i class="fa-solid fa-user-pen text-[10px] text-amber-400"></i>
            <span>لەلایەن: <b>${escapeHtml(qData.admin_name || msg.full_name)}</b></span>
          </span>
          <span class="text-[10px] text-indigo-400 font-mono bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded-md font-bold">@هەمووان</span>
          <span class="text-[10px] text-rose-300 font-bold bg-rose-500/15 border border-rose-500/30 px-2 py-0.5 rounded-md flex items-center gap-1">
            <i class="fa-regular fa-clock text-[9px]"></i>
            <span>تەوقیت: ${durationText}</span>
          </span>
        </div>

        <!-- Question Text Box -->
        <div class="my-2.5 p-3 sm:p-4 rounded-2xl bg-slate-950/60 border border-amber-500/15">
          <div class="flex items-center justify-between mb-1">
            <span class="text-[10px] text-amber-400 font-bold">دەقی پرسیار:</span>
            ${activeQTransBtnHtml}
          </div>
          <p id="question-content-${qData.question_id || msg.id}" class="text-sm md:text-base font-black text-white leading-relaxed select-text">
            ${escapeHtml(qData.question_text)}
          </p>
        </div>

        <!-- Footer Notice -->
        <div class="pt-2 border-t border-slate-800/80 flex items-center justify-between flex-wrap gap-2 text-xs">
          <div class="text-amber-300/90 flex items-center gap-1.5 text-[11px] font-bold">
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
  const isMsgSuperAdmin = msg.role === 'super_admin' || (msg.username && (msg.username.toLowerCase() === 'hemntjabar' || msg.username.toLowerCase() === 'admin'));
  const roleBadge = isMsgSuperAdmin ? renderRoleBadge('super_admin', msg.gender) : renderRoleBadge(msg.role, msg.gender);
  const starBadge = (msg.role === 'student' || msg.role === 'new_student') ? renderStarBadge(msg.correct_answers_count || 0) : '';
  const nameColorClass = getUserNameClass(msg);

  const TWO_DAYS_MS = 48 * 60 * 60 * 1000;
  const isStarGlowing = Boolean(
    msg.is_star_glowing || 
    (msg.last_star_awarded_at && (Date.now() - Number(msg.last_star_awarded_at) <= TWO_DAYS_MS))
  );

  const starGlowPillBadge = isStarGlowing ? `
    <span class="user-star-glow-pill inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-black bg-gradient-to-r from-amber-500/20 via-yellow-400/30 to-amber-500/20 text-amber-300 border border-amber-400/50 select-none animate-pulse" title="ئەم خوێندکارە لە ماوەی ٤٨ کاتژمێری ڕابردوودا ئەستێرەی پێبەخشراوە ⭐">
      <i class="fa-solid fa-star text-amber-400 text-[8px]"></i>
      <span>درەوشاوە</span>
    </span>
  ` : '';

  let attachmentHtml = '';
  const isDoc = msg.attachment_type === 'document' || (msg.attachment_url && (
    msg.attachment_url.toLowerCase().endsWith('.pdf') || 
    msg.attachment_url.toLowerCase().endsWith('.doc') || 
    msg.attachment_url.toLowerCase().endsWith('.docx') || 
    msg.attachment_url.toLowerCase().endsWith('.ppt') || 
    msg.attachment_url.toLowerCase().endsWith('.pptx') || 
    msg.attachment_url.toLowerCase().endsWith('.xls') || 
    msg.attachment_url.toLowerCase().endsWith('.xlsx') || 
    msg.attachment_url.toLowerCase().endsWith('.txt')
  ));

  if (isDoc && msg.attachment_url) {
    const isPdf = msg.attachment_url.toLowerCase().endsWith('.pdf');
    const rawFileName = msg.attachment_url.split('/').pop() || 'document';
    const cleanFileName = rawFileName.replace(/^[0-9]+-[0-9]+-/, '');
    attachmentHtml = `
      <div class="mt-2 p-3 rounded-2xl bg-slate-900/95 border border-slate-700/80 hover:border-slate-600 transition flex items-center justify-between gap-3 max-w-sm shadow-md">
        <div class="flex items-center gap-2.5 min-w-0">
          <div class="w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0 ${isPdf ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' : 'bg-teal-500/20 text-teal-300 border border-teal-500/30'}">
            <i class="fa-solid ${isPdf ? 'fa-file-pdf' : 'fa-file-lines'}"></i>
          </div>
          <div class="min-w-0 flex flex-col">
            <span class="text-xs font-black text-slate-100 truncate" title="${escapeHtml(cleanFileName)}">${escapeHtml(cleanFileName)}</span>
            <span class="text-[10px] text-slate-400 font-mono">${isPdf ? 'فایلی فەرمی PDF' : 'دۆکیومێنت'}</span>
          </div>
        </div>
        <a href="${msg.attachment_url}" target="_blank" download="${escapeHtml(cleanFileName)}" class="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-black text-xs shrink-0 flex items-center gap-1.5 transition active:scale-95 shadow" title="داگرتنی فایل">
          <i class="fa-solid fa-arrow-down-to-bracket text-xs"></i>
          <span>داگرتن</span>
        </a>
      </div>
    `;
  } else if (msg.attachment_type === 'image' && msg.attachment_url) {
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
      <a href="${msg.attachment_url}" download="voice_${msg.id || Date.now()}.webm" class="p-1.5 bg-slate-800/80 hover:bg-slate-700 text-amber-300 text-xs rounded-lg border border-slate-700 flex items-center justify-center shrink-0 shadow-sm transition" title="داگرتنی ئەم دەنگە">
        <i class="fa-solid fa-download"></i>
      </a>
    ` : '';
    
    // Telegram-style interactive waveform player
    attachmentHtml = `
      <div class="mt-2 voice-waveform-card flex items-center gap-2.5 p-2 rounded-2xl bg-slate-900/90 border border-slate-700/60 max-w-xs sm:max-w-sm select-none" id="waveform-card-${msg.id}">
        <button id="wave-play-btn-${msg.id}" onclick="toggleWaveformAudio(${msg.id}, '${msg.attachment_url}', this)" class="w-10 h-10 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center text-sm shrink-0 shadow-md transition active:scale-95" title="لێدان / ڕاگرتن">
          <i class="fa-solid fa-play"></i>
        </button>
        <div class="flex-1 flex flex-col justify-center gap-1 min-w-0">
          <div class="waveform-bars-track flex items-center gap-[3px] h-6 cursor-pointer py-1" onclick="seekWaveformAudio(${msg.id}, event)" title="بۆ پێشەوە و دواوە ڕابکێشە">
            ${generateWaveformBarsHtml(msg.id)}
          </div>
          <div class="flex items-center justify-between text-[10px] text-slate-400 font-mono px-0.5">
            <span id="wave-time-${msg.id}">00:00</span>
            <span id="wave-duration-${msg.id}">--:--</span>
          </div>
        </div>
        <div class="flex items-center gap-1 shrink-0">
          <button id="wave-speed-${msg.id}" onclick="cycleAudioSpeed(${msg.id}, event)" class="px-2 py-0.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[10px] font-bold text-indigo-300 hover:text-white transition" title="خێرایی دەنگ">
            1x
          </button>
          ${downloadBtnHtml}
        </div>
        <audio id="wave-audio-${msg.id}" src="${msg.attachment_url}" preload="metadata" ontimeupdate="updateWaveformAudioProgress(${msg.id})" onloadedmetadata="initWaveformAudioDuration(${msg.id})" onended="onWaveformAudioEnded(${msg.id})"></audio>
      </div>
    `;
  } else if (msg.attachment_type === 'action_button') {
    const isClicked = !!msg.user_has_clicked;
    const clicksCount = msg.button_clicks_count || 0;
    const canViewStats = currentUser && (
      currentUser.role === 'super_admin' || 
      currentUser.role === 'teacher' || 
      currentUser.role === 'admin' ||
      hasSuperAdminPrivileges(currentUser) ||
      hasUserBadge(currentUser, 'white') || 
      hasUserBadge(currentUser, 'black')
    );

    attachmentHtml = `
      <div class="mt-3 pt-2.5 border-t border-white/10 flex flex-col gap-2">
        <button 
          type="button" 
          id="action-btn-${msg.id}" 
          onclick="handleActionButtonClick(${msg.id}, event)"
          class="action-chat-btn w-full px-5 py-3 rounded-2xl font-black text-sm flex items-center justify-center gap-2.5 transition-all duration-300 active:scale-95 shadow-lg select-none cursor-pointer ${isClicked ? 'action-btn-green' : 'action-btn-red'}"
          data-clicked="${isClicked ? 'true' : 'false'}">
          ${isClicked 
            ? '<i class="fa-solid fa-circle-check text-base"></i><span>تۆمارکراوە (دەستت لێداوە) ✅</span>' 
            : '<i class="fa-solid fa-hand-pointer text-base animate-bounce"></i><span>پەنجە داگرە (دەست لێدان) 🔴</span>'
          }
        </button>
        <div class="flex items-center justify-between gap-2 px-1 text-[11px] text-slate-300/80">
          <span id="action-clicks-count-${msg.id}" class="inline-flex items-center gap-1 font-bold">
            <i class="fa-solid fa-users text-amber-400 text-xs"></i>
            <span class="clicks-num font-mono">${clicksCount}</span> کەس پەنجەی پێدا ناوە
          </span>
          ${canViewStats ? `
            <button type="button" onclick="openButtonStatsModal(${msg.id}, event)" class="text-amber-300 hover:text-white px-2 py-0.5 rounded-lg bg-white/10 hover:bg-white/20 transition font-black flex items-center gap-1 text-[10px]">
              <i class="fa-solid fa-list-check"></i>
              <span>ناوی ئەوانەی پەنجەیان داوە</span>
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }

  // Quoted Reply Preview Inside Bubble
  let replyQuoteHtml = '';
  if (msg.reply_to_id) {
    const rName = msg.reply_to_name || 'پەیام';
    let rContent = msg.reply_to_content || '';
    if (!rContent) {
      if (msg.reply_to_attachment_type === 'voice') rContent = '🎤 پەیامی دەنگی';
      else if (msg.reply_to_attachment_type === 'image') rContent = '🖼️ وێنە';
      else if (msg.reply_to_attachment_type === 'video') rContent = '🎬 ڤیدیۆ';
      else if (msg.reply_to_attachment_type === 'document') rContent = '📄 دۆکیومێنت';
      else rContent = 'پەیامی سەرەکی';
    }
    replyQuoteHtml = `
      <div onclick="scrollToRepliedMessage(${msg.reply_to_id})" class="cursor-pointer mb-2 p-2 rounded-xl bg-black/25 hover:bg-black/40 border-r-4 border-indigo-400 text-right transition flex flex-col gap-0.5 text-xs select-none group/quote shadow-inner">
        <div class="font-black text-indigo-300 text-[11px] flex items-center gap-1.5">
          <i class="fa-solid fa-reply fa-flip-horizontal text-[10px]"></i>
          <span>${escapeHtml(rName)}</span>
        </div>
        <div class="text-slate-300 text-[11px] truncate max-w-xs md:max-w-md font-medium opacity-90 group-hover/quote:text-white">
          ${escapeHtml(rContent)}
        </div>
      </div>
    `;
  }

  msgElem.className = `chat-msg-item flex flex-col ${isMe ? 'items-end' : 'items-start'} group`;

  const replyActionBtn = `
    <button onclick="setReplyToMessage(${msg.id}, '${escapeHtml(msg.full_name).replace(/'/g, "\\'")}', '${escapeHtml((msg.content || '').substring(0, 80)).replace(/'/g, "\\'")}', '${msg.attachment_type || ''}')" class="text-indigo-400 hover:text-indigo-300 text-xs px-1.5 py-0.5 rounded hover:bg-slate-700 flex items-center gap-1 font-bold" title="وەڵامدانەوە (Reply)">
      <i class="fa-solid fa-reply fa-flip-horizontal"></i>
      <span class="text-[10px]">وەڵام</span>
    </button>
  `;

  let messageActionsHtml = '';
  let hasActions = true;

  if (isChatMod && !isMe) {
    const isTargetMuted = isUserCurrentlyMuted(msg.user_id);
    const muteBtnHtml = (msg.role === 'student' || msg.role === 'new_student') ? `
      <button onclick="toggleUserMuteFromMsg(${msg.user_id}, '${escapeHtml(msg.full_name)}', event)" 
        data-userid="${msg.user_id}" 
        class="msg-mute-btn text-xs px-2 py-0.5 rounded hover:bg-slate-700 font-bold transition flex items-center gap-1 ${isTargetMuted ? 'text-emerald-400 hover:text-emerald-300' : 'text-rose-400 hover:text-rose-300'}" 
        title="${isTargetMuted ? 'لابردنی سڕکردن' : 'سڕکردن'}">
        <i class="fa-solid ${isTargetMuted ? 'fa-microphone' : 'fa-microphone-slash'}"></i>
        <span>${isTargetMuted ? 'لابردنی سڕکردن' : 'سڕکردن'}</span>
      </button>
    ` : '';

    messageActionsHtml = `
      <div id="msg-actions-${msg.id}" class="msg-actions-bar hidden md:flex md:opacity-0 md:group-hover:opacity-100 transition duration-150 items-center gap-1 mt-1 bg-slate-800/95 border border-slate-700/80 px-2 py-0.5 rounded-xl shadow-lg z-10">
        ${replyActionBtn}
        ${isSuperAdmin && (msg.role === 'student' || msg.role === 'new_student') ? `
          <button onclick="quickAwardStar(${msg.user_id}, '${escapeHtml(msg.full_name)}')" class="text-amber-400 hover:text-amber-300 text-xs px-1.5 py-0.5 rounded hover:bg-slate-700" title="وەڵامی دروستە ⭐ (ئەدمین)">
            <i class="fa-solid fa-star"></i> ئەستێرە
          </button>
        ` : ''}
        ${muteBtnHtml}
        <button onclick="deleteMessage(${msg.id})" class="text-rose-400 hover:text-rose-300 text-xs px-1.5 py-0.5 rounded hover:bg-rose-950/60 flex items-center gap-1 font-bold" title="سڕینەوەی پەیام">
          <i class="fa-solid fa-trash-can"></i>
          <span class="text-[10px]">سڕینەوە</span>
        </button>
      </div>
    `;
  } else if (isMe || isChatMod) {
    messageActionsHtml = `
      <div id="msg-actions-${msg.id}" class="msg-actions-bar hidden md:flex md:opacity-0 md:group-hover:opacity-100 transition duration-150 items-center gap-1 mt-1 bg-slate-800/95 border border-slate-700/80 px-2 py-0.5 rounded-xl shadow-lg z-10">
        ${replyActionBtn}
        <button onclick="deleteMessage(${msg.id})" class="text-rose-400 hover:text-rose-300 text-xs px-1.5 py-0.5 rounded hover:bg-rose-950/60 flex items-center gap-1 font-bold" title="سڕینەوەی پەیام">
          <i class="fa-solid fa-trash-can"></i>
          <span class="text-[10px]">سڕینەوە</span>
        </button>
      </div>
    `;
  } else {
    messageActionsHtml = `
      <div id="msg-actions-${msg.id}" class="msg-actions-bar hidden md:flex md:opacity-0 md:group-hover:opacity-100 transition duration-150 items-center gap-1 mt-1 bg-slate-800/95 border border-slate-700/80 px-2 py-0.5 rounded-xl shadow-lg z-10">
        ${replyActionBtn}
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

  const isMentionAllMsg = msg.is_mention_all || (msg.content && (msg.content.includes('@هەموو') || msg.content.includes('@هەمو') || msg.content.includes('@1') || msg.content.includes('@all')));

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

  if (isMentionAllMsg) {
    bubbleBg += ' msg-mention-all';
  }

  const mentionAllBadge = isMentionAllMsg 
    ? `<span class="px-2 py-0.5 rounded-lg bg-amber-500 text-slate-950 font-black text-[10px] inline-flex items-center gap-1 shadow animate-pulse"><i class="fa-solid fa-bullhorn text-[9px]"></i> @هەمووان</span>` 
    : '';

  let translateBtnHtml = '';
  if ((currentAppLanguage === 'ar' || currentAppLanguage === 'en') && msg.content && msg.type !== 'system') {
    const tLabel = currentAppLanguage === 'ar' ? 'ترجمة' : 'Translate';
    translateBtnHtml = `
      <button type="button" onclick="translateGroupMessage(${msg.id}, this)" class="text-[10px] text-sky-300 hover:text-white px-1.5 py-0.5 bg-slate-800/80 hover:bg-slate-700 rounded-lg border border-slate-700/60 inline-flex items-center gap-1 transition" title="${tLabel}">
        <i class="fa-solid fa-language text-sky-400"></i>
        <span>${tLabel}</span>
      </button>
    `;
  }

  msgElem.innerHTML = `
    <div class="flex items-center gap-2 mb-1 px-1 flex-wrap">
      <span onclick="openUserProfileModal(${msg.user_id})" data-sender-user-id="${msg.user_id}" class="msg-sender-name text-xs cursor-pointer hover:underline ${nameColorClass} ${isStarGlowing ? 'user-name-star-glow' : ''}">${escapeHtml(msg.full_name)}</span>
      ${roleBadge}
      ${starBadge}
      ${starGlowPillBadge}
      ${mentionAllBadge}
      <span id="msg-time-badge-${msg.id}" class="hidden msg-faint-time text-[10px] text-slate-400 font-mono items-center gap-1 opacity-75 select-none animate-fadeIn" title="کات و بەرواری پەیام">
        <i class="fa-regular fa-clock text-[9px] opacity-60"></i>
        <span>${timeInfo.shortTime}</span>
        <span class="opacity-40">•</span>
        <span class="opacity-75">${timeInfo.shortDate}</span>
      </span>
      <button type="button" onclick="toggleReactionPicker(${msg.id}, event)" class="text-slate-400 hover:text-amber-300 px-1 py-0.5 rounded text-[11px] hover:bg-slate-800 transition flex items-center gap-0.5" title="کارلێک بە ئیمۆجی">
        <i class="fa-regular fa-face-smile"></i>
      </button>
      ${translateBtnHtml}
      <button type="button" onclick="toggleMsgActions(${msg.id}, event)" class="md:hidden text-slate-400 hover:text-white px-1.5 py-0.5 rounded text-[11px] hover:bg-slate-800 transition msg-actions-trigger" title="کردارەکان">
        <i class="fa-solid fa-ellipsis"></i>
      </button>
    </div>

    <!-- Quick Reaction Picker Popover (Hidden by default) -->
    <div id="reaction-picker-${msg.id}" class="hidden my-1 bg-slate-900 border border-slate-700/80 rounded-2xl p-1.5 shadow-2xl z-20 flex items-center gap-1 animate-scale-up">
      <button type="button" onclick="sendReaction(${msg.id}, '🏆', event)" class="p-1.5 hover:bg-slate-800 rounded-xl text-sm transition active:scale-125" title="کاس">🏆</button>
      <button type="button" onclick="sendReaction(${msg.id}, '🤲', event)" class="p-1.5 hover:bg-slate-800 rounded-xl text-sm transition active:scale-125" title="دوعا">🤲</button>
      <button type="button" onclick="sendReaction(${msg.id}, '👍', event)" class="p-1.5 hover:bg-slate-800 rounded-xl text-sm transition active:scale-125" title="ڵایک">👍</button>
      <button type="button" onclick="sendReaction(${msg.id}, '💯', event)" class="p-1.5 hover:bg-slate-800 rounded-xl text-sm transition active:scale-125" title="سەد لەسەد">💯</button>
    </div>

    <div id="msg-bubble-${msg.id}" onclick="handleMessageBubbleClick(${msg.id}, event)" class="max-w-lg md:max-w-xl rounded-2xl px-3.5 py-2 text-xs md:text-sm leading-relaxed shadow break-words ${bubbleBg} cursor-pointer transition-transform duration-150 active:scale-[0.99] group/bubble">
      ${replyQuoteHtml}
      ${msg.content ? `<div id="msg-content-${msg.id}" class="${msgTextClass}">${escapeHtml(msg.content)}</div>` : ''}
      ${attachmentHtml}
    </div>

    <!-- Reactions Container -->
    <div id="msg-reactions-${msg.id}" class="flex items-center gap-1 mt-1 flex-wrap">
      ${renderMessageReactionsHtml(msg.reactions || [], msg.id)}
    </div>

    ${messageActionsHtml}
  `;

  container.appendChild(msgElem);
  attachSwipeToReply(msgElem, msg);
  if (scroll && !isUserScrolledUp) scrollToBottom();
}

function scrollToBottom() {
  const container = document.getElementById('messagesContainer');
  if (container) {
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  }
  const arrowBtn = document.getElementById('scrollToLatestBtn');
  if (arrowBtn) {
    arrowBtn.classList.add('hidden');
    arrowBtn.classList.remove('flex');
  }
  hideUnreadJumpPill();
  const divider = document.getElementById('chatUnreadDivider');
  if (divider) divider.remove();
  isUserScrolledUp = false;

  setTimeout(() => {
    const highest = getHighestVisibleMessageId();
    if (highest > 0) syncLastReadMessageWithServer(highest);
  }, 350);
}

// --- MOBILE MESSAGE ACTIONS & FAINT TIME TOGGLE ---
let activeMobileMsgActionsId = null;

function toggleMsgActions(msgId, event) {
  if (event) {
    event.stopPropagation();
  }
  const targetBar = document.getElementById(`msg-actions-${msgId}`);
  const targetTime = document.getElementById(`msg-time-badge-${msgId}`);
  if (!targetBar && !targetTime) return;

  const isCurrentlyOpen = (targetBar && !targetBar.classList.contains('hidden')) || (targetTime && !targetTime.classList.contains('hidden'));

  closeAllMobileMsgActions();

  if (!isCurrentlyOpen) {
    if (targetBar) {
      targetBar.classList.remove('hidden');
      targetBar.classList.add('flex');
    }
    if (targetTime) {
      targetTime.classList.remove('hidden');
      targetTime.classList.add('inline-flex');
    }
    activeMobileMsgActionsId = msgId;
  }
}

function handleMessageBubbleClick(msgId, event) {
  if (!event || !event.target) return;
  if (event.target.closest('button, a, audio, img, input, .waveform-bars-track, .audio-player-btn, .msg-actions-bar, [data-interactive]')) {
    return;
  }
  toggleMsgActions(msgId, event);
}

function closeAllMobileMsgActions() {
  if (activeMobileMsgActionsId !== null) {
    const bar = document.getElementById(`msg-actions-${activeMobileMsgActionsId}`);
    if (bar) {
      bar.classList.add('hidden');
      bar.classList.remove('flex');
    }
    const timeBadge = document.getElementById(`msg-time-badge-${activeMobileMsgActionsId}`);
    if (timeBadge) {
      timeBadge.classList.add('hidden');
      timeBadge.classList.remove('inline-flex');
    }
    activeMobileMsgActionsId = null;
  }
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.msg-actions-bar') && !e.target.closest('.msg-actions-trigger') && !e.target.closest('[id^="msg-bubble-"]')) {
    closeAllMobileMsgActions();
  }
});


// Scroll detection & Unread jump
function handleChatScroll() {
  if (isRestoringChatPosition) return;
  const container = document.getElementById('messagesContainer');
  if (!container) return;
  const scrollFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
  const arrowBtn = document.getElementById('scrollToLatestBtn');

  if (scrollFromBottom > 120) {
    isUserScrolledUp = true;
    if (arrowBtn) {
      arrowBtn.classList.remove('hidden');
      arrowBtn.classList.add('flex');
    }
    const visibleId = getVisibleMessageIdForRestore();
    if (visibleId > 0) {
      syncLastReadMessageWithServer(visibleId);
    }
  } else if (scrollFromBottom <= 40) {
    isUserScrolledUp = false;
    if (arrowBtn) {
      arrowBtn.classList.add('hidden');
      arrowBtn.classList.remove('flex');
    }
    hideUnreadJumpPill();
    const divider = document.getElementById('chatUnreadDivider');
    if (divider) {
      divider.remove();
    }
    const visibleId = getVisibleMessageIdForRestore();
    if (visibleId > 0) {
      syncLastReadMessageWithServer(visibleId);
    }
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
  const divider = document.getElementById('chatUnreadDivider');
  if (divider) divider.remove();
}

let currentChatLockMode = 'none';

async function fetchChatLockStatus() {
  if (!token) return;
  try {
    const res = await fetch('/api/chat/lock-status', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      updateChatLockUI(data);
    }
  } catch (e) {
    console.warn('fetchChatLockStatus error:', e);
  }
}

function updateChatLockUI(data) {
  if (!data || !data.mode) return;
  currentChatLockMode = data.mode;

  const banner = document.getElementById('chatLockBanner');
  const icon = document.getElementById('chatLockIcon');
  const msgEl = document.getElementById('chatLockMessage');
  const adminActions = document.getElementById('chatLockAdminActions');
  const input = document.getElementById('messageInput');
  const sendBtn = document.getElementById('sendBtn');
  const isSuperAdmin = hasSuperAdminPrivileges(currentUser);
  const canLock = canUserLockChat(currentUser);
  const isStaff = currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'admin' || currentUser.role === 'teacher' || hasSuperAdminPrivileges(currentUser) || canUserManageMembers(currentUser));

  if (!banner || !msgEl) return;

  if (currentChatLockMode === 'total_lock') {
    banner.classList.remove('hidden', 'bg-amber-950/80', 'border-amber-500/50', 'text-amber-200');
    banner.classList.add('bg-rose-950/90', 'border-rose-500/60', 'text-rose-100');
    if (icon) icon.innerText = '🔒';
    msgEl.innerText = isSuperAdmin
      ? '🔒 چات داخراوە (تەنها تۆ دەتوانیت بنووسیت).'
      : '🔒 چات داخراوە.';

    if (adminActions) {
      if (isSuperAdmin) {
        adminActions.classList.remove('hidden');
        adminActions.classList.add('flex');
      } else {
        adminActions.classList.add('hidden');
        adminActions.classList.remove('flex');
      }
    }

    if (!isSuperAdmin) {
      if (input) {
        input.disabled = true;
        input.placeholder = '🔒 چات داخراوە';
      }
      if (sendBtn) sendBtn.disabled = true;
    } else {
      if (input) {
        input.disabled = false;
        input.placeholder = 'پەیام بنووسە یان بیکەرەوە...';
      }
      if (sendBtn) sendBtn.disabled = false;
    }
  } else if (currentChatLockMode === 'staff_only') {
    banner.classList.remove('hidden', 'bg-rose-950/90', 'border-rose-500/60', 'text-rose-100');
    banner.classList.add('bg-amber-950/80', 'border-amber-500/50', 'text-amber-200');
    if (icon) icon.innerText = '🛡️';
    msgEl.innerText = isStaff
      ? 'ℹ️ چات تەنها بۆ مامۆستا، ئەدمین و بەڕێوەبەری ئەندامان کراوەیە.'
      : '🔒 چات داخراوە.';

    if (adminActions) {
      if (isSuperAdmin || canLock) {
        adminActions.classList.remove('hidden');
        adminActions.classList.add('flex');
      } else {
        adminActions.classList.add('hidden');
        adminActions.classList.remove('flex');
      }
    }

    if (!isStaff) {
      if (input) {
        input.disabled = true;
        input.placeholder = '🔒 چات داخراوە';
      }
      if (sendBtn) sendBtn.disabled = true;
    } else {
      if (input) {
        input.disabled = false;
        input.placeholder = 'پەیام بنووسە...';
      }
      if (sendBtn) sendBtn.disabled = false;
    }
  } else {
    // Mode is 'none' (Chat open)
    banner.classList.add('hidden');
    if (adminActions) adminActions.classList.add('hidden');
    if (input) {
      if (currentUser && currentUser.role === 'guest') {
        input.disabled = true;
        input.placeholder = '👁️ تۆ وەک میوان (چاودێر) داخڵبوویت و ناتوانیت لە چات قسە بکەیت';
      } else {
        input.disabled = false;
        input.placeholder = 'پەیامەکەت بنووسە...';
      }
    }
    if (sendBtn) sendBtn.disabled = false;
  }
}

async function unlockChatBySuperAdmin() {
  if (!token || !currentUser || !canUserLockChat(currentUser)) return;
  try {
    const res = await fetch('/api/chat/lock', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ mode: 'none' })
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'هەڵەیەک ڕوویدا لە کردنەوەی چات');
    }
  } catch (e) {
    alert('پەیوەندی لەگەڵ سێرڤەر ناتەواوە');
  }
}

// Send Message with Student Link Block & Guest check
function handleSendMessage(e) {
  e.preventDefault();
  const input = document.getElementById('messageInput');
  const content = input.value.trim();
  if (!content) return;

  // Chat lock command check (Super Admin or Green/Black Badge)
  const isLockCmd = content.includes('@قفڵ') || content.includes('@قفل') || content.includes('@کلیل') || content.includes('@كليل');
  if (isLockCmd && currentUser && !canUserLockChat(currentUser)) {
    alert('❌ تەنها سوپەر ئەدمین و خاوەن باجی ڕێگەپێدراو دەسەڵاتی قفڵکردن یان کردنەوەی چاتیان هەیە!');
    return;
  }

  // Active chat lock mode client validation
  if (currentChatLockMode === 'total_lock' && currentUser && currentUser.role !== 'super_admin') {
    alert('🔒 چات داخراوە.');
    return;
  }
  if (currentChatLockMode === 'staff_only' && currentUser && !['super_admin', 'admin', 'teacher'].includes(currentUser.role)) {
    alert('🔒 چات داخراوە.');
    return;
  }

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
    const payload = { content };
    if (activeReplyTo && activeReplyTo.id) {
      payload.reply_to_id = activeReplyTo.id;
    }
    socket.emit('send_message', payload);
    input.value = '';
    cancelReplyToMessage();
    scrollToBottom();
  }
}

// --- SWIPE TO REPLY (TELEGRAM STYLE) ---
function attachSwipeToReply(elem, msg) {
  if (!elem || !msg) return;
  const bubble = elem.querySelector(`#msg-bubble-${msg.id}`);
  if (!bubble) return;

  let startX = 0;
  let startY = 0;
  let currentX = 0;
  let isSwiping = false;

  bubble.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    currentX = startX;
    isSwiping = false;
    bubble.style.transition = 'none';
  }, { passive: true });

  bubble.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 1) return;
    currentX = e.touches[0].clientX;
    const currentY = e.touches[0].clientY;
    const diffX = currentX - startX;
    const diffY = Math.abs(currentY - startY);

    if (!isSwiping && diffY > 18) return;

    // Swiping left (diffX < 0)
    if (diffX < -15) {
      isSwiping = true;
      const pull = Math.max(-80, diffX);
      bubble.style.transform = `translateX(${pull}px)`;
    }
  }, { passive: true });

  bubble.addEventListener('touchend', () => {
    bubble.style.transition = 'transform 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
    bubble.style.transform = '';
    const diffX = currentX - startX;
    if (isSwiping && diffX < -45) {
      if (navigator.vibrate) {
        try { navigator.vibrate(25); } catch(e){}
      }
      setReplyToMessage(msg.id, msg.full_name, msg.content, msg.attachment_type);
    }
    isSwiping = false;
  }, { passive: true });
}

// --- INTERACTIVE WAVEFORM AUDIO PLAYER (TELEGRAM STYLE) ---
const WAVEFORM_HEIGHT_PATTERN = [35, 65, 45, 95, 75, 40, 100, 85, 50, 75, 95, 60, 40, 85, 100, 65, 85, 45, 75, 95, 55, 35, 75, 95, 60, 40, 65, 35];

function generateWaveformBarsHtml(msgId) {
  return WAVEFORM_HEIGHT_PATTERN.map((h) => `
    <div class="wave-bar-${msgId} w-[3px] rounded-full bg-slate-600 transition-colors duration-100" style="height: ${h}%;"></div>
  `).join('');
}

function toggleWaveformAudio(msgId, url, btn) {
  const audio = document.getElementById(`wave-audio-${msgId}`);
  if (!audio) return;

  if (audio.paused) {
    // Pause all other audios
    document.querySelectorAll('audio').forEach(a => {
      if (a !== audio && !a.paused) {
        a.pause();
        const otherId = a.id ? a.id.replace('wave-audio-', '') : null;
        if (otherId) {
          const otherBtn = document.getElementById(`wave-play-btn-${otherId}`);
          if (otherBtn) otherBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
        }
      }
    });

    audio.play().then(() => {
      if (btn) btn.innerHTML = '<i class="fa-solid fa-pause"></i>';
    }).catch(err => {
      console.error('Audio play error:', err);
    });
  } else {
    audio.pause();
    if (btn) btn.innerHTML = '<i class="fa-solid fa-play"></i>';
  }
}

function updateWaveformAudioProgress(msgId) {
  const audio = document.getElementById(`wave-audio-${msgId}`);
  if (!audio || !audio.duration) return;

  const cur = audio.currentTime;
  const dur = audio.duration;
  const timeElem = document.getElementById(`wave-time-${msgId}`);
  if (timeElem) timeElem.innerText = formatAudioDuration(cur);

  const pct = cur / dur;
  const bars = document.querySelectorAll(`.wave-bar-${msgId}`);
  const activeCount = Math.floor(pct * bars.length);

  bars.forEach((bar, idx) => {
    if (idx <= activeCount) {
      bar.classList.remove('bg-slate-600');
      bar.classList.add('bg-amber-400');
    } else {
      bar.classList.remove('bg-amber-400');
      bar.classList.add('bg-slate-600');
    }
  });
}

function initWaveformAudioDuration(msgId) {
  const audio = document.getElementById(`wave-audio-${msgId}`);
  if (!audio || !audio.duration) return;
  const durElem = document.getElementById(`wave-duration-${msgId}`);
  if (durElem) durElem.innerText = formatAudioDuration(audio.duration);
}

function seekWaveformAudio(msgId, event) {
  const audio = document.getElementById(`wave-audio-${msgId}`);
  if (!audio || !audio.duration) return;

  const track = event.currentTarget;
  const rect = track.getBoundingClientRect();
  const clickX = event.clientX - rect.left;
  const pct = Math.max(0, Math.min(1, clickX / rect.width));
  audio.currentTime = pct * audio.duration;
  updateWaveformAudioProgress(msgId);
}

function cycleAudioSpeed(msgId, event) {
  if (event) event.stopPropagation();
  const audio = document.getElementById(`wave-audio-${msgId}`);
  const speedBtn = document.getElementById(`wave-speed-${msgId}`);
  if (!audio || !speedBtn) return;

  const currentRate = audio.playbackRate || 1.0;
  let nextRate = 1.0;
  if (currentRate === 1.0) nextRate = 1.5;
  else if (currentRate === 1.5) nextRate = 2.0;
  else nextRate = 1.0;

  audio.playbackRate = nextRate;
  speedBtn.innerText = `${nextRate}x`;
}

function onWaveformAudioEnded(msgId) {
  const btn = document.getElementById(`wave-play-btn-${msgId}`);
  if (btn) btn.innerHTML = '<i class="fa-solid fa-play"></i>';
  const bars = document.querySelectorAll(`.wave-bar-${msgId}`);
  bars.forEach(bar => {
    bar.classList.remove('bg-amber-400');
    bar.classList.add('bg-slate-600');
  });
  const timeElem = document.getElementById(`wave-time-${msgId}`);
  if (timeElem) timeElem.innerText = '00:00';
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
// --- VOICE RECORDING (TELEGRAM STYLE WITH LIVE WAVEFORM & PREVIEW) ---
let recordingAudioContext = null;
let recordingAnalyser = null;
let recordingAnimationId = null;
let recordedVoiceBlob = null;
let recordedVoiceUrl = null;
let voicePreviewAudio = null;

// --- AI VOICE NOISE CANCELLATION & STUDIO-QUALITY PIPELINE ---
async function getStudioQualityAudioStream() {
  const constraints = {
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1
    }
  };

  let rawStream = null;
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    try {
      rawStream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (e1) {
      console.warn('Advanced mic constraints failed, trying basic audio...', e1);
      rawStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }
  } else {
    const legacyGUM = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia;
    if (legacyGUM) {
      rawStream = await new Promise((resolve, reject) => {
        legacyGUM.call(navigator, { audio: true }, resolve, reject);
      });
    } else {
      throw new Error('NO_GETUSERMEDIA');
    }
  }

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) {
    return rawStream;
  }

  try {
    const ctx = new AudioCtx();
    const source = ctx.createMediaStreamSource(rawStream);

    // 1. High-pass filter at 85Hz (eliminates mic thumps, breath pops, wind noise)
    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 85;
    highpass.Q.value = 0.707;

    // 2. Presence filter at 2800Hz (enhances speech clarity and voice intelligibility)
    const presencePeak = ctx.createBiquadFilter();
    presencePeak.type = 'peaking';
    presencePeak.frequency.value = 2800;
    presencePeak.gain.value = 2.5;
    presencePeak.Q.value = 1.0;

    // 3. Gentle high-shelf filter at 8500Hz (cuts background electronic hiss)
    const hissCut = ctx.createBiquadFilter();
    hissCut.type = 'highshelf';
    hissCut.frequency.value = 8500;
    hissCut.gain.value = -2.0;

    // 4. Dynamics Compressor (studio leveling: smooths vocal dynamics, avoids mic clipping)
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -24;
    compressor.knee.value = 15;
    compressor.ratio.value = 3.5;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;

    // 5. Connect processing pipeline
    source.connect(highpass);
    highpass.connect(presencePeak);
    presencePeak.connect(hissCut);
    hissCut.connect(compressor);

    // 6. MediaStreamDestination for WebRTC / MediaRecorder
    const destination = ctx.createMediaStreamDestination();
    compressor.connect(destination);

    const outStream = destination.stream;
    outStream._rawStream = rawStream;
    outStream._audioCtx = ctx;

    // Hook stop on track to cleanly release hardware microphone and close context
    const outTrack = outStream.getAudioTracks()[0];
    if (outTrack) {
      const origStop = outTrack.stop.bind(outTrack);
      outTrack.stop = () => {
        try { origStop(); } catch (e) {}
        try {
          rawStream.getTracks().forEach(t => t.stop());
        } catch (e) {}
        try {
          if (ctx.state !== 'closed') ctx.close();
        } catch (e) {}
      };
    }

    return outStream;
  } catch (err) {
    console.warn('AI Noise Cancellation AudioContext failed, falling back to raw stream:', err);
    return rawStream;
  }
}

async function startVoiceRecording() {
  try {
    const stream = await getStudioQualityAudioStream();
    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    // Live Web Audio analyser for waveform visualization
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        recordingAudioContext = new AudioCtx();
        const source = recordingAudioContext.createMediaStreamSource(stream);
        recordingAnalyser = recordingAudioContext.createAnalyser();
        recordingAnalyser.fftSize = 64;
        source.connect(recordingAnalyser);
        drawLiveRecordingWaveform();
      }
    } catch (e) {
      console.warn('AudioContext not available for waveform:', e);
    }

    mediaRecorder.start();
    recordingSeconds = 0;
    
    // UI setup
    document.getElementById('voiceRecordingLiveSection')?.classList.remove('hidden');
    document.getElementById('voiceRecordingPreviewSection')?.classList.add('hidden');
    document.getElementById('voiceReviewStopBtn')?.classList.remove('hidden');
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

function drawLiveRecordingWaveform() {
  const canvas = document.getElementById('voiceWaveformCanvas');
  if (!canvas || !recordingAnalyser) return;
  const ctx = canvas.getContext('2d');
  const bufferLength = recordingAnalyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  function draw() {
    if (!mediaRecorder || mediaRecorder.state !== 'recording') return;
    recordingAnimationId = requestAnimationFrame(draw);
    recordingAnalyser.getByteFrequencyData(dataArray);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const barWidth = 3;
    const gap = 2;
    const barCount = Math.floor(canvas.width / (barWidth + gap));

    for (let i = 0; i < barCount; i++) {
      const val = dataArray[i % bufferLength] || 10;
      const percent = Math.min(1, Math.max(0.15, val / 255));
      const barHeight = percent * (canvas.height - 4);
      const x = i * (barWidth + gap);
      const y = (canvas.height - barHeight) / 2;

      ctx.fillStyle = '#f43f5e'; // Vibrant rose
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(x, y, barWidth, barHeight, 2);
      } else {
        ctx.rect(x, y, barWidth, barHeight);
      }
      ctx.fill();
    }
  }
  draw();
}

function pauseAndReviewVoiceRecording() {
  if (!mediaRecorder || mediaRecorder.state !== 'recording') return;
  
  mediaRecorder.onstop = () => {
    recordedVoiceBlob = new Blob(audioChunks, { type: 'audio/webm' });
    recordedVoiceUrl = URL.createObjectURL(recordedVoiceBlob);
    
    // Switch to preview UI
    document.getElementById('voiceRecordingLiveSection')?.classList.add('hidden');
    document.getElementById('voiceRecordingPreviewSection')?.classList.remove('hidden');
    document.getElementById('voiceReviewStopBtn')?.classList.add('hidden');
    
    const previewTimer = document.getElementById('voicePreviewTimer');
    if (previewTimer) {
      previewTimer.innerText = document.getElementById('recordingTimer').innerText;
    }
    
    if (voicePreviewAudio) {
      voicePreviewAudio.pause();
      voicePreviewAudio = null;
    }
    voicePreviewAudio = new Audio(recordedVoiceUrl);
    voicePreviewAudio.ontimeupdate = () => {
      const cur = voicePreviewAudio.currentTime;
      const dur = voicePreviewAudio.duration || 1;
      const pct = (cur / dur) * 100;
      const bar = document.getElementById('voicePreviewProgressBar');
      if (bar) bar.style.width = pct + '%';
      if (previewTimer) previewTimer.innerText = formatAudioDuration(cur);
    };
    voicePreviewAudio.onended = () => {
      const btn = document.getElementById('voicePreviewPlayBtn');
      if (btn) btn.innerHTML = '<i class="fa-solid fa-play"></i>';
      const bar = document.getElementById('voicePreviewProgressBar');
      if (bar) bar.style.width = '0%';
    };
  };

  mediaRecorder.stop();
  mediaRecorder.stream.getTracks().forEach(t => t.stop());
  clearInterval(recordingInterval);
  if (recordingAnimationId) cancelAnimationFrame(recordingAnimationId);
  if (recordingAudioContext) {
    try { recordingAudioContext.close(); } catch(e){}
    recordingAudioContext = null;
  }
}

function toggleVoicePreviewPlay() {
  if (!voicePreviewAudio) return;
  const btn = document.getElementById('voicePreviewPlayBtn');
  if (voicePreviewAudio.paused) {
    voicePreviewAudio.play();
    if (btn) btn.innerHTML = '<i class="fa-solid fa-pause"></i>';
  } else {
    voicePreviewAudio.pause();
    if (btn) btn.innerHTML = '<i class="fa-solid fa-play"></i>';
  }
}

function seekVoicePreview(event) {
  if (!voicePreviewAudio || !voicePreviewAudio.duration) return;
  const track = event.currentTarget;
  const rect = track.getBoundingClientRect();
  const clickX = event.clientX - rect.left;
  const pct = Math.max(0, Math.min(1, clickX / rect.width));
  voicePreviewAudio.currentTime = pct * voicePreviewAudio.duration;
}

function cancelVoiceRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
    mediaRecorder.stream.getTracks().forEach(t => t.stop());
  }
  clearInterval(recordingInterval);
  if (recordingAnimationId) cancelAnimationFrame(recordingAnimationId);
  if (recordingAudioContext) {
    try { recordingAudioContext.close(); } catch(e){}
    recordingAudioContext = null;
  }
  if (voicePreviewAudio) {
    voicePreviewAudio.pause();
    voicePreviewAudio = null;
  }
  if (recordedVoiceUrl) {
    URL.revokeObjectURL(recordedVoiceUrl);
    recordedVoiceUrl = null;
  }
  recordedVoiceBlob = null;
  audioChunks = [];
  document.getElementById('recordingBar')?.classList.add('hidden');
  document.getElementById('voiceReviewStopBtn')?.classList.remove('hidden');
}

async function stopAndSendVoiceRecording() {
  const durationText = document.getElementById('recordingTimer')?.innerText || '00:00';

  const sendBlob = async (blob) => {
    const formData = new FormData();
    formData.append('voice', blob, 'voice.webm');
    formData.append('duration', durationText);
    if (activeReplyTo && activeReplyTo.id) {
      formData.append('reply_to_id', activeReplyTo.id);
    }

    try {
      await fetch('/api/chat/upload-voice', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });
      cancelReplyToMessage();
    } catch (e) {
      alert('هەڵە لە ناردنی دەنگ');
    }
  };

  // If already stopped in preview mode
  if (recordedVoiceBlob) {
    await sendBlob(recordedVoiceBlob);
    cancelVoiceRecording();
    return;
  }

  // If still actively recording
  if (!mediaRecorder) return;
  mediaRecorder.onstop = async () => {
    const blob = new Blob(audioChunks, { type: 'audio/webm' });
    await sendBlob(blob);
    cancelVoiceRecording();
  };

  mediaRecorder.stop();
  mediaRecorder.stream.getTracks().forEach(t => t.stop());
  clearInterval(recordingInterval);
  if (recordingAnimationId) cancelAnimationFrame(recordingAnimationId);
  if (recordingAudioContext) {
    try { recordingAudioContext.close(); } catch(e){}
    recordingAudioContext = null;
  }
}

// --- AI VISUAL & NSFW SHIELD (CLIENT-SIDE COMPUTER VISION PRE-CHECK) ---
async function scanImageWithVisualShield(file) {
  if (!file || !file.type || !file.type.startsWith('image/')) {
    return { safe: true };
  }

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = function(e) {
      const img = new Image();
      img.onload = function() {
        try {
          const canvas = document.createElement('canvas');
          const maxDim = 120;
          let w = img.width;
          let h = img.height;
          if (w > h) {
            h = Math.max(1, Math.round((h * maxDim) / w));
            w = maxDim;
          } else {
            w = Math.max(1, Math.round((w * maxDim) / h));
            h = maxDim;
          }
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, 0, 0, w, h);
          const imgData = ctx.getImageData(0, 0, w, h).data;

          let skinPixels = 0;
          const totalPixels = w * h;

          for (let i = 0; i < imgData.length; i += 4) {
            const r = imgData[i];
            const g = imgData[i + 1];
            const b = imgData[i + 2];
            // Peer et al. skin detection heuristic
            const isSkin = (
              r > 95 && g > 40 && b > 20 &&
              (Math.max(r, g, b) - Math.min(r, g, b)) > 15 &&
              Math.abs(r - g) > 15 &&
              r > g && r > b
            );
            if (isSkin) skinPixels++;
          }

          const skinRatio = skinPixels / totalPixels;
          if (skinRatio > 0.52) {
            // Log to server incident center
            fetch('/api/admin/security/log-incident', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
              },
              body: JSON.stringify({
                type: 'nsfw_image',
                details: `وێنەی نەشیاو (ڕێژەی ڕووتی پێست: ${Math.round(skinRatio * 100)}%) لە کاتی ئەپلۆد ڕەتکرایەوە`,
                severity: 'high',
                action_taken: 'blocked'
              })
            }).catch(() => {});

            resolve({
              safe: false,
              skinRatio,
              message: '⚠️ پاسەوانی AI وێنە: ئەم وێنەیە نەشیاوە یان بە تەواوی داپۆشراو نییە و ڕێگەی پێ نادرێت!'
            });
            return;
          }

          resolve({ safe: true, skinRatio });
        } catch (err) {
          console.warn('Visual shield analysis error:', err);
          resolve({ safe: true });
        }
      };
      img.onerror = () => resolve({ safe: true });
      img.src = e.target.result;
    };
    reader.onerror = () => resolve({ safe: true });
    reader.readAsDataURL(file);
  });
}

// --- IMAGE, VIDEO & DOCUMENT UPLOAD (ADMIN ONLY) ---
function triggerImagePicker() {
  document.getElementById('imageFileInput').click();
}

async function handleImagePicked(e) {
  const file = e.target.files[0];
  if (!file) return;

  const mime = file.type || '';
  if (mime.startsWith('image/')) {
    const shield = await scanImageWithVisualShield(file);
    if (!shield.safe) {
      alert(shield.message || '⚠️ پاسەوانی وێنەی AI: ئەم وێنەیە نەشیاوە و ڕەتکرایەوە!');
      e.target.value = '';
      pendingImageFile = null;
      return;
    }
  }

  pendingImageFile = file;

  const previewImg = document.getElementById('imagePreviewImg');
  const previewVid = document.getElementById('videoPreviewVid');
  const docPreviewBox = document.getElementById('docPreviewBox');
  const docPreviewName = document.getElementById('docPreviewName');
  const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
  const isVideo = mime.startsWith('video/');
  const isPdf = mime === 'application/pdf' || ext === '.pdf';
  const isDoc = isPdf || ['.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.txt'].includes(ext);

  if (isDoc) {
    if (previewImg) previewImg.classList.add('hidden');
    if (previewVid) previewVid.classList.add('hidden');
    if (docPreviewBox) {
      docPreviewBox.innerHTML = isPdf ? '<i class="fa-solid fa-file-pdf"></i>' : '<i class="fa-solid fa-file-lines"></i>';
      docPreviewBox.className = `w-12 h-12 rounded-xl flex items-center justify-center text-xl shrink-0 ${isPdf ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' : 'bg-teal-500/20 text-teal-300 border border-teal-500/30'}`;
      docPreviewBox.classList.remove('hidden');
    }
    if (docPreviewName) {
      docPreviewName.innerText = file.name;
      docPreviewName.classList.remove('hidden');
    }
    document.getElementById('imagePreviewBar').classList.remove('hidden');
    return;
  }

  // Hide doc preview if it was image/video
  if (docPreviewBox) docPreviewBox.classList.add('hidden');
  if (docPreviewName) docPreviewName.classList.add('hidden');

  const reader = new FileReader();
  reader.onload = (evt) => {
    if (isVideo) {
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
  const docPreviewBox = document.getElementById('docPreviewBox');
  if (docPreviewBox) docPreviewBox.classList.add('hidden');
  const docPreviewName = document.getElementById('docPreviewName');
  if (docPreviewName) docPreviewName.classList.add('hidden');
  document.getElementById('imagePreviewBar').classList.add('hidden');
}

async function sendPendingImage() {
  if (!pendingImageFile) return;

  const caption = document.getElementById('imageCaptionInput').value.trim();
  const formData = new FormData();
  formData.append('image', pendingImageFile);
  formData.append('caption', caption);
  if (activeReplyTo && activeReplyTo.id) {
    formData.append('reply_to_id', activeReplyTo.id);
  }

  try {
    const res = await fetch('/api/chat/upload-image', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'هەڵە لە بارکردنی فایل');
    } else {
      cancelImageUpload();
      cancelReplyToMessage();
    }
  } catch (err) {
    alert('پەیوەندی لەگەڵ سێرڤەر ناتەواوە');
  }
}

function openImageZoom(src) {
  // STRICT PRIVACY: Profile pictures can NEVER be zoomed or brought forward!
  if (!src || src.includes('avatar') || src.includes('/uploads/avatar_')) return;
  document.getElementById('imageZoomSrc').src = src;
  document.getElementById('imageZoomModal').classList.remove('hidden');
}

function closeImageZoom() {
  document.getElementById('imageZoomModal').classList.add('hidden');
}

// --- ACTIVE TIMED QUESTIONS BANNER (TODAY'S QUESTIONS) & SECRET SUBMISSION ---
let todayQuestionsList = [];
let pinnedQuestionsCountdownTimer = null;

function formatQuestionPublishTime(timestamp) {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleTimeString('ku-IQ', { hour: '2-digit', minute: '2-digit' });
}

async function loadActiveQuestion() {
  try {
    const res = await fetch('/api/chat/active-question', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    todayQuestionsList = Array.isArray(data.today_questions) ? data.today_questions : (data.question ? [data.question] : []);

    // Set or preserve activeQuestion: ONLY choose active, unrevealed questions!
    const unrevealedActive = todayQuestionsList.filter(q => q.is_active && !q.is_revealed && (q.expires_at === 0 || q.expires_at > Date.now()));
    if (activeQuestion && unrevealedActive.some(q => q.id == activeQuestion.id)) {
      activeQuestion = unrevealedActive.find(q => q.id == activeQuestion.id);
    } else if (unrevealedActive.length > 0) {
      activeQuestion = unrevealedActive[unrevealedActive.length - 1];
    } else {
      activeQuestion = null;
    }

    renderPinnedQuestionsBar(todayQuestionsList, activeQuestion);

    // If activeQuestionModal is currently open, refresh its content
    const modal = document.getElementById('activeQuestionModal');
    if (modal && !modal.classList.contains('hidden') && activeQuestion) {
      populateActiveQuestionModal(activeQuestion);
    }
  } catch (err) {
    console.warn('loadActiveQuestion error:', err);
  }
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

function openActiveQuestionModal(questionId = null) {
  if (questionId) {
    const found = todayQuestionsList.find(q => q.id == questionId);
    if (found) activeQuestion = found;
  }
  if (!activeQuestion && todayQuestionsList.length > 0) {
    const unrevealedActive = todayQuestionsList.filter(q => q.is_active && !q.is_revealed && (q.expires_at === 0 || q.expires_at > Date.now()));
    activeQuestion = unrevealedActive.length > 0 ? unrevealedActive[unrevealedActive.length - 1] : todayQuestionsList[todayQuestionsList.length - 1];
  }
  if (!activeQuestion) return;

  populateActiveQuestionModal(activeQuestion);

  const modal = document.getElementById('activeQuestionModal');
  if (modal) modal.classList.remove('hidden');

  // Restore draft if any
  const input = document.getElementById('modalStickySecretAnswerInput');
  if (input && (!input.value || !input.value.trim())) {
    const draft = localStorage.getItem('draft_ans_' + activeQuestion.id);
    if (draft) input.value = draft;
  }
}

function populateActiveQuestionModal(q) {
  if (!q) return;

  const modalTitle = document.getElementById('modalStickyQuestionTitle');
  const modalText = document.getElementById('modalStickyQuestionText');
  const modalAdmin = document.getElementById('modalStickyQuestionAdmin');
  const modalPublishTime = document.getElementById('modalStickyPublishTime');
  const modalSubCount = document.getElementById('modalStickySubmissionCountBadge');
  const modalCountdownEl = document.getElementById('modalStickyCountdownTime');
  const modalStudentArea = document.getElementById('modalStickyStudentInputArea');
  const modalSubmittedNotice = document.getElementById('modalStickySubmittedNotice');
  const modalSubmittedText = document.getElementById('modalStickySubmittedText');
  const modalGuestNotice = document.getElementById('modalStickyGuestNotice');
  const modalAdminActions = document.getElementById('modalStickyAdminActions');

  if (modalTitle) modalTitle.innerText = `❓ پرسیاری ژمارە #${q.question_number || 1}`;
  if (modalText) modalText.innerText = q.question_text || '';
  if (modalAdmin) modalAdmin.innerText = `لەلایەن: ${q.admin_name || 'مامۆستا / ئەدمین'}`;
  if (modalPublishTime) {
    const pubTime = formatQuestionPublishTime(q.created_at);
    modalPublishTime.innerHTML = `<i class="fa-regular fa-clock text-[10px] text-amber-400"></i><span>کاتی بڵاوبوونەوە: ${pubTime}</span>`;
  }
  if (modalSubCount) modalSubCount.innerText = `${q.submission_count || 0} وەڵام تۆمارکراوە`;

  if (modalCountdownEl) {
    if (q.is_revealed) {
      modalCountdownEl.innerText = 'ئاشکراکرا 📖';
    } else if (q.expires_at) {
      const rem = q.expires_at - Date.now();
      modalCountdownEl.innerText = rem > 0 ? formatRemainingTime(rem) : 'بەسەرچوو 🔒';
    } else {
      modalCountdownEl.innerText = 'بێ سنوور';
    }
  }

  const isStaff = currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'teacher');
  const isGuest = currentUser && currentUser.role === 'guest';
  const cachedAns = localStorage.getItem('cached_ans_' + q.id);
  const existingSubmission = q.my_submission || cachedAns;

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

  const container = document.getElementById('messagesContainer') || document.getElementById('messages');
  if (container) {
    container.scrollTop = container.scrollHeight;
  }
  
  if (typeof showToast === 'function') {
    showToast('نووسینەکەت پارێزراوە، دەتوانیت چات ببینیت و بە دەستنان لە هێمای سەرەوە بگەڕێیتەوە ✨', 'info');
  }
}

function renderPinnedQuestionsBar(questionsList, currentActive) {
  stopQuestionCountdown();

  const sticky = document.getElementById('activeQuestionSticky');
  const container = document.getElementById('pinnedQuestionsList');

  // Filter out revealed questions so revealed questions do NOT linger pinned on top!
  const unrevealedQuestions = (questionsList || []).filter(q => !q.is_revealed);

  if (!unrevealedQuestions || unrevealedQuestions.length === 0) {
    if (sticky) sticky.classList.add('hidden');
    if (container) container.innerHTML = '';
    return;
  }

  if (sticky) sticky.classList.remove('hidden');
  if (!container) return;

  const isStaff = currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'teacher');
  const isGuest = currentUser && currentUser.role === 'guest';

  let html = '';

  // Label when multiple questions exist
  if (unrevealedQuestions.length > 1) {
    html += `
      <div class="shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-950/70 border border-slate-800 text-[10px] font-black text-amber-300 select-none">
        <i class="fa-solid fa-thumbtack text-amber-400 text-[9px]"></i>
        <span class="hidden sm:inline">پرسیارەکانی ئەمڕۆ (${unrevealedQuestions.length}):</span>
        <span class="sm:hidden">پرسیارەکان (${unrevealedQuestions.length}):</span>
      </div>
    `;
  }

  unrevealedQuestions.forEach((q, idx) => {
    const isSelected = currentActive && currentActive.id === q.id;
    const isActiveNow = q.is_active && !q.is_revealed && (!q.expires_at || q.expires_at > Date.now());
    const publishTime = formatQuestionPublishTime(q.created_at);
    const cachedAns = localStorage.getItem('cached_ans_' + q.id);
    const existingSubmission = q.my_submission || cachedAns;
    const qNum = q.question_number || (idx + 1);

    // Live countdown or status
    let statusHtml = '';
    if (isActiveNow && q.expires_at) {
      const remainingMs = q.expires_at - Date.now();
      const timeStr = formatRemainingTime(remainingMs);
      statusHtml = `
        <span class="pinned-timer-pill px-1.5 py-0.5 rounded-md bg-rose-500/20 text-rose-300 border border-rose-500/30 text-[10px] font-mono font-black flex items-center gap-1 shrink-0" data-expires-at="${q.expires_at}" data-qid="${q.id}">
          <i class="fa-solid fa-stopwatch animate-pulse text-[9px]"></i>
          <span class="timer-text">${timeStr}</span>
        </span>
      `;
    } else if (q.is_revealed) {
      statusHtml = `
        <span class="px-1.5 py-0.5 rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-[10px] font-bold shrink-0">
          ئاشکراکرا 📖
        </span>
      `;
    } else if (q.expires_at && q.expires_at <= Date.now()) {
      statusHtml = `
        <span class="px-1.5 py-0.5 rounded-md bg-slate-800 text-slate-400 border border-slate-700 text-[10px] font-bold shrink-0">
          تەواوبوو 🔒
        </span>
      `;
    }

    // Action Pill
    let actionBadge = '';
    if (isStaff) {
      actionBadge = `
        <button type="button" onclick="event.stopPropagation(); deleteQuestionDirect(${q.id}, null)" class="p-1 hover:bg-rose-600/40 text-rose-400 hover:text-white rounded border border-rose-500/30 text-[10px] transition shrink-0" title="سڕینەوەی پرسیار #${qNum}">
          <i class="fa-solid fa-trash-can text-[9px]"></i>
        </button>
      `;
    } else if (isGuest) {
      actionBadge = `<span class="text-[10px] text-slate-400 shrink-0">میوان</span>`;
    } else {
      if (existingSubmission) {
        actionBadge = `
          <span class="px-1.5 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded text-[10px] font-black shrink-0 flex items-center gap-0.5">
            <i class="fa-solid fa-check text-[9px]"></i> وەڵامدراوە
          </span>
        `;
      } else if (isActiveNow) {
        actionBadge = `
          <span class="px-2 py-0.5 bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-black rounded text-[10px] shadow shrink-0 animate-pulse flex items-center gap-1">
            <i class="fa-solid fa-pen-fancy text-[8px]"></i> وەڵامدانەوە
          </span>
        `;
      }
    }

    const qText = (q.question_text || 'دەقی پرسیار').trim();

    html += `
      <div onclick="openActiveQuestionModal(${q.id})" class="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-xl border transition-all cursor-pointer shadow-sm active:scale-98 ${
        isSelected 
          ? 'bg-slate-900 border-amber-500/80 shadow-amber-500/10 ring-1 ring-amber-500/50' 
          : 'bg-slate-900/85 hover:bg-slate-850 border-slate-700/80 hover:border-amber-500/40'
      }" title="کلیک بکە بۆ کردنەوەی پرسیار #${qNum}">
        <!-- Question Number -->
        <span class="w-5 h-5 rounded-md ${isActiveNow ? 'bg-amber-500 text-slate-950 shadow-sm shadow-amber-500/30' : 'bg-slate-800 text-amber-300'} flex items-center justify-center text-[10px] font-black shrink-0">
          #${qNum}
        </span>

        <!-- Publication Time Badge (Always Visible!) -->
        <span class="text-[10px] text-amber-300 font-mono flex items-center gap-1 bg-slate-950/80 px-1.5 py-0.5 rounded border border-slate-800 shrink-0 font-bold" title="کاتی بڵاوبوونەوەی پرسیار">
          <i class="fa-regular fa-clock text-[9px] text-amber-400"></i>
          <span>${publishTime}</span>
        </span>

        <!-- Status / Timer Badge -->
        ${statusHtml}

        <!-- Truncated snippet -->
        <span class="text-xs text-slate-200 font-medium truncate max-w-[95px] xs:max-w-[140px] sm:max-w-[220px] block" title="${escapeHtml(qText)}">
          ${escapeHtml(qText)}
        </span>

        <!-- Action or delete -->
        ${actionBadge}
      </div>
    `;
  });

  container.innerHTML = html;

  // Running 1s countdown ticker
  pinnedQuestionsCountdownTimer = setInterval(() => {
    const pills = container.querySelectorAll('.pinned-timer-pill');
    pills.forEach(pill => {
      const expiresAt = Number(pill.getAttribute('data-expires-at'));
      if (expiresAt) {
        const remaining = expiresAt - Date.now();
        if (remaining <= 0) {
          pill.outerHTML = '<span class="px-1.5 py-0.5 rounded-md bg-slate-800 text-slate-400 border border-slate-700 text-[10px] font-bold shrink-0">تەواوبوو 🔒</span>';
        } else {
          const textSpan = pill.querySelector('.timer-text');
          if (textSpan) textSpan.innerText = formatRemainingTime(remaining);
        }
      }
    });

    // Also update modal countdown if modal is currently open
    const modal = document.getElementById('activeQuestionModal');
    if (modal && !modal.classList.contains('hidden') && activeQuestion && activeQuestion.expires_at) {
      const modalCountdown = document.getElementById('modalStickyCountdownTime');
      if (modalCountdown) {
        const rem = activeQuestion.expires_at - Date.now();
        modalCountdown.innerText = rem > 0 ? formatRemainingTime(rem) : 'بەسەرچوو 🔒';
      }
    }
  }, 1000);
}

function renderActiveQuestionSticky(q) {
  if (!q) {
    renderPinnedQuestionsBar([], null);
  } else {
    renderPinnedQuestionsBar([q], q);
  }
}

function stopQuestionCountdown() {
  if (pinnedQuestionsCountdownTimer) {
    clearInterval(pinnedQuestionsCountdownTimer);
    pinnedQuestionsCountdownTimer = null;
  }
  if (typeof questionCountdownTimer !== 'undefined' && questionCountdownTimer) {
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
  if (!activeQuestion) {
    const unrevealedActive = (todayQuestionsList || []).find(q => q.is_active && !q.is_revealed && (q.expires_at === 0 || q.expires_at > Date.now()));
    if (unrevealedActive) {
      activeQuestion = unrevealedActive;
    } else {
      alert('هیچ پرسیارێکی چالاک نییە لە ئێستادا بۆ وەڵامدانەوە');
      return;
    }
  }
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
      localStorage.setItem('cached_ans_' + activeQuestion.id, answer);
      activeQuestion.my_submission = answer;
      populateActiveQuestionModal(activeQuestion);
      loadActiveQuestion();
      triggerStarCelebration();
    } else {
      alert(data.error || 'هەڵەیەک ڕوویدا لە ناردنی وەڵام');
    }
  } catch (err) {
    // Offline submission cached
    loadActiveQuestion();
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
        closeActiveQuestionModal();
      }
      loadActiveQuestion();
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
      if (activeQuestion) activeQuestion.is_revealed = 1;
      closeActiveQuestionModal();
      loadActiveQuestion();
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
          <span>${getGenderEmoji(st.gender)}</span>
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
            ${getGenderEmoji(st.gender)}
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
      closeActiveQuestionModal();
      loadActiveQuestion();
    }
  } catch (err) {}
}

// --- POST QUESTION MODAL (QUICK TIME & CUSTOM DATE/TIME) ---
let questionTimeMode = 'quick';

function openPostQuestionModal() {
  const modal = document.getElementById('questionModal');
  if (modal) modal.classList.remove('hidden');
  switchTimeMode('quick');
  if (window.innerWidth > 768) {
    const input = document.getElementById('questionTextInput');
    if (input) setTimeout(() => input.focus(), 100);
  }
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

function updateMsgMuteButtons(userId) {
  if (!userId) return;
  const isMuted = isUserCurrentlyMuted(userId);
  document.querySelectorAll(`.msg-mute-btn[data-userid="${userId}"]`).forEach(btn => {
    btn.className = `msg-mute-btn text-xs px-2 py-0.5 rounded hover:bg-slate-700 font-bold transition flex items-center gap-1 ${isMuted ? 'text-emerald-400 hover:text-emerald-300' : 'text-rose-400 hover:text-rose-300'}`;
    btn.title = isMuted ? 'لابردنی سڕکردن' : 'سڕکردن';
    btn.innerHTML = `<i class="fa-solid ${isMuted ? 'fa-microphone' : 'fa-microphone-slash'}"></i> <span>${isMuted ? 'لابردنی سڕکردن' : 'سڕکردن'}</span>`;
  });
}

async function toggleUserMuteFromMsg(userId, studentName, event) {
  if (event) event.stopPropagation();
  const currentlyMuted = isUserCurrentlyMuted(userId);

  if (currentlyMuted) {
    if (!confirm(`ئایا دڵنیایت لە لابردنی سڕکردنی (${studentName})؟`)) return;
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
        mutedUserIds.delete(userId);
        updateMsgMuteButtons(userId);
        loadAllMembers();
        if (document.getElementById('adminModal') && !document.getElementById('adminModal').classList.contains('hidden')) {
          loadAllUsersList();
        }
      } else {
        const d = await res.json();
        alert(d.error || 'هەڵەیەک ڕوویدا');
      }
    } catch (e) {
      alert('پەیوەندی لەگەڵ سێرڤەر ناتەواوە');
    }
  } else {
    if (!confirm(`ئایا دڵنیایت لە سڕکردنی (${studentName}) بۆ ماوەی ٢٤ کاتژمێر؟`)) return;
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
        mutedUserIds.set(userId, Date.now() + 24 * 3600 * 1000);
        updateMsgMuteButtons(userId);
        loadAllMembers();
        if (document.getElementById('adminModal') && !document.getElementById('adminModal').classList.contains('hidden')) {
          loadAllUsersList();
        }
      }
    } catch (e) {
      alert('پەیوەندی لەگەڵ سێرڤەر ناتەواوە');
    }
  }
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

let membersSearchQuery = '';
function handleMembersSearch(query) {
  membersSearchQuery = (query || '').trim().toLowerCase();
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
    allMembersCache.forEach(u => {
      if (u.muted_until && u.muted_until > Date.now()) {
        mutedUserIds.set(u.id, u.muted_until);
      } else {
        mutedUserIds.delete(u.id);
      }
      updateMsgMuteButtons(u.id);
    });
    renderMembersList();
  } catch (err) {}
}

function renderMembersList() {
  const container = document.getElementById('membersListContainer');
  const countBadge = document.getElementById('membersSidebarCount');
  container.innerHTML = '';

  const isSuperAdmin = currentUser && (currentUser.role === 'super_admin' || hasSuperAdminPrivileges(currentUser));
  const canManageMbrs = canUserManageMembers(currentUser);
  const canMod = canUserModerateChat(currentUser);
  const isPrivileged = currentUser && (currentUser.role === 'admin' || currentUser.role === 'super_admin' || currentUser.role === 'teacher' || canManageMbrs || canMod);

  let filtered = allMembersCache.filter(u => u.status === 'approved');
  if (memberFilter === 'student') filtered = filtered.filter(u => u.role === 'student');
  if (memberFilter === 'admin') filtered = filtered.filter(u => u.role === 'admin' || u.role === 'super_admin' || u.role === 'teacher');

  if (membersSearchQuery) {
    filtered = filtered.filter(u => 
      (u.full_name && u.full_name.toLowerCase().includes(membersSearchQuery)) ||
      (u.username && u.username.toLowerCase().includes(membersSearchQuery))
    );
  }

  countBadge.innerText = filtered.length;

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="text-center py-8 text-slate-500">
        <i class="fa-solid fa-magnifying-glass text-2xl text-slate-600 mb-2"></i>
        <p class="text-xs font-bold">هیچ ئەندامێک نەدۆزرایەوە</p>
      </div>
    `;
    return;
  }

  filtered.forEach(u => {
    const isMe = currentUser && u.id === currentUser.id;
    const nameClass = getUserNameClass(u);
    const starBadge = u.role === 'student' ? renderStarBadge(u.correct_answers_count) : '';
    const roleBadge = renderRoleBadge(u.role, u.gender);
    const isMuted = u.muted_until && u.muted_until > Date.now();

    let actionBtn = '';
    if ((isSuperAdmin || canManageMbrs) && !isMe && !isMasterSuperAdmin(u)) {
      if (u.role === 'student' || u.role === 'new_student') {
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
          <div class="w-9 h-9 rounded-xl bg-slate-700/80 flex items-center justify-center text-sm font-black text-slate-300 shrink-0 shadow-inner border border-slate-600/40 overflow-hidden">
            ${u.avatar_url ? `<img src="${escapeHtml(u.avatar_url)}" alt="Avatar" class="w-full h-full object-cover rounded-xl pointer-events-none select-none" draggable="false">` : getGenderEmoji(u.gender)}
          </div>
          <div class="min-w-0 flex-1">
            <div class="text-xs font-black flex items-center gap-1.5 flex-wrap">
              <span class="${nameClass} break-words leading-tight" title="${escapeHtml(u.full_name)}">${escapeHtml(u.full_name)}</span>
              ${isMe ? '<span class="text-[9px] text-indigo-400 font-normal shrink-0">(تۆ)</span>' : ''}
              ${isMuted ? '<span class="text-[9px] bg-rose-500/20 text-rose-300 px-1 py-0.2 rounded border border-rose-500/30 font-bold shrink-0">🔇 سڕکراوە</span>' : ''}
            </div>
            <div class="flex items-center gap-1.5 mt-1 flex-wrap">
              ${roleBadge}
              ${renderSpecialBadgeHtml(u.special_badge)}
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

async function uploadMyAvatar(fileInput) {
  const file = fileInput.files && fileInput.files[0];
  if (!file) return;

  if (file.type && file.type.startsWith('image/')) {
    const shield = await scanImageWithVisualShield(file);
    if (!shield.safe) {
      alert(shield.message || '⚠️ پاسەوانی وێنەی AI: ئەم وێنەیە نەشیاوە بۆ پرۆفایل و ڕەتکرایەوە!');
      fileInput.value = '';
      return;
    }
  }

  const formData = new FormData();
  formData.append('avatar', file);

  const changeBtn = document.getElementById('profChangeAvatarBtn');
  const originalBtnHtml = changeBtn ? changeBtn.innerHTML : '';
  if (changeBtn) {
    changeBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-[10px]"></i>';
    changeBtn.disabled = true;
  }

  try {
    const res = await fetch('/api/users/profile/avatar', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });
    const data = await res.json();
    if (res.ok && data.success && data.avatar_url) {
      if (currentUser) {
        currentUser.avatar_url = data.avatar_url;
      }
      const profAvatar = document.getElementById('profAvatar');
      if (profAvatar) {
        profAvatar.innerHTML = `<img src="${escapeHtml(data.avatar_url)}" alt="Avatar" class="w-full h-full object-cover rounded-2xl pointer-events-none select-none no-zoom-avatar" style="width:100%;height:100%;max-width:100%;max-height:100%;object-fit:cover;" draggable="false" oncontextmenu="return false;">`;
      }
      const drawerAvatar = document.getElementById('drawerUserAvatar');
      if (drawerAvatar) {
        drawerAvatar.innerHTML = `<img src="${escapeHtml(data.avatar_url)}" class="w-full h-full object-cover rounded-xl pointer-events-none select-none no-zoom-avatar" style="width:100%;height:100%;max-width:100%;max-height:100%;object-fit:cover;" draggable="false" oncontextmenu="return false;">`;
      }
      alert('وێنەی پرۆفایلەکەت بە سەرکەوتوویی دانرا ✨');
    } else {
      alert('نەتوانرا وێنە باربکرێت: ' + (data.error || 'هەڵەیەک ڕوویدا'));
    }
  } catch (err) {
    console.error('Error uploading avatar:', err);
    alert('هەڵەیەک ڕوویدا لە کاتی بارکردنی وێنە');
  } finally {
    if (changeBtn) {
      changeBtn.innerHTML = originalBtnHtml || '<i class="fa-solid fa-camera"></i>';
      changeBtn.disabled = false;
    }
    fileInput.value = '';
  }
}

// --- USER PROFILE & DETAILS MODAL ---
function openMyProfile() {
  if (currentUser) openUserProfileModal(currentUser.id);
}

async function openUserProfileModal(userId) {
  const modal = document.getElementById('userProfileModal');
  const dialog = document.getElementById('userProfileModalDialog');
  if (modal) modal.classList.remove('hidden');
  if (dialog) dialog.classList.remove('hidden');

  const profScroll = document.getElementById('profScrollableBody');
  if (profScroll) profScroll.scrollTop = 0;

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
    const isMe = currentUser && currentUser.id === prof.id;

    // Strict Privacy Avatar: Owner can change via camera button; NO ONE can zoom or click any avatar
    const profAvatarEl = document.getElementById('profAvatar');
    const profChangeAvatarBtn = document.getElementById('profChangeAvatarBtn');
    if (profAvatarEl) {
      if (prof.avatar_url) {
        profAvatarEl.innerHTML = `<img src="${escapeHtml(prof.avatar_url)}" alt="Avatar" class="w-full h-full object-cover rounded-2xl pointer-events-none select-none no-zoom-avatar" style="width:100%;height:100%;max-width:100%;max-height:100%;object-fit:cover;" draggable="false" oncontextmenu="return false;">`;
      } else {
        profAvatarEl.innerHTML = `<span class="pointer-events-none select-none text-2xl">${getGenderEmoji(prof.gender)}</span>`;
      }
    }
    if (profChangeAvatarBtn) {
      if (isMe) {
        profChangeAvatarBtn.classList.remove('hidden');
      } else {
        profChangeAvatarBtn.classList.add('hidden');
      }
    }

    const isProfStarGlowing = Boolean(prof.is_star_glowing || (prof.last_star_awarded_at && (Date.now() - Number(prof.last_star_awarded_at) <= 48 * 60 * 60 * 1000)));
    fullNameEl.innerText = prof.full_name;
    fullNameEl.className = `font-black text-base ${getUserNameClass(prof)} ${isProfStarGlowing ? 'user-name-star-glow' : ''}`;
    usernameEl.innerText = `@${prof.username}`;
    if (genderEl) {
      genderEl.innerHTML = '';
      genderEl.classList.add('hidden');
    }
    roleEl.innerHTML = renderRoleBadge(prof.role, prof.gender);

    const userBadges = parseUserBadges(prof.special_badge);
    const specialBadgeSlot = document.getElementById('profSpecialBadgeSlot');
    if (specialBadgeSlot) {
      if (userBadges.length > 0) {
        specialBadgeSlot.innerHTML = renderSpecialBadgeHtml(userBadges, { showCount: true });
        specialBadgeSlot.classList.remove('hidden');
        specialBadgeSlot.classList.add('inline-flex', 'items-center', 'gap-1', 'flex-wrap');
      } else {
        specialBadgeSlot.innerHTML = '';
        specialBadgeSlot.classList.add('hidden');
      }
    }

    const profAdvisorBtn = document.getElementById('profAdvisorBtn');
    if (profAdvisorBtn) {
      // Allowed if it's my profile AND (I am master super admin OR have super admin privileges OR I have white badge)
      const hasAdvisorAccess = isMe && (isMasterSuperAdmin(currentUser) || hasSuperAdminPrivileges(currentUser) || hasUserBadge(currentUser, 'white'));
      if (hasAdvisorAccess) {
        profAdvisorBtn.classList.remove('hidden');
        profAdvisorBtn.classList.add('inline-flex');
      } else {
        profAdvisorBtn.classList.add('hidden');
        profAdvisorBtn.classList.remove('inline-flex');
      }
    }

    // Show Account Badges Showcase Card
    const badgesCard = document.getElementById('profBadgesOverviewCard');
    const badgesCountBadge = document.getElementById('profBadgesCountBadge');
    const badgesSubtext = document.getElementById('profBadgesHeaderSubtext');
    const badgesListContainer = document.getElementById('profBadgesListContainer');
    if (badgesCard && badgesListContainer) {
      if (userBadges.length > 0) {
        badgesCard.classList.remove('hidden');
        if (badgesCountBadge) {
          badgesCountBadge.innerText = userBadges.length === 6 ? '٦ باج (هەمووی)' : `${userBadges.length} باج`;
        }
        if (badgesSubtext) {
          badgesSubtext.innerText = `خاوەنی ${userBadges.length} باجی تایبەتە لە پلاتفۆرم`;
        }
        badgesListContainer.innerHTML = userBadges.map(b => {
          const cfg = BADGE_CONFIG[b];
          if (!cfg) return '';
          return `
            <div class="p-2.5 rounded-2xl bg-slate-900/90 border border-slate-700/80 flex items-center justify-between gap-2 shadow-sm">
              <div class="flex items-center gap-2.5 min-w-0">
                <span class="w-7 h-7 rounded-xl ${cfg.chipClass} flex items-center justify-center text-xs shrink-0 shadow-inner">
                  <i class="fa-solid ${cfg.icon}"></i>
                </span>
                <div class="min-w-0">
                  <span class="font-black text-xs ${cfg.color} block truncate">${cfg.name}</span>
                  <span class="text-[9px] text-slate-400 block truncate">${cfg.desc}</span>
                </div>
              </div>
              <span class="px-2 py-0.5 rounded-full text-[8px] font-black bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shrink-0">چالاکە ✓</span>
            </div>
          `;
        }).join('');
      } else {
        badgesCard.classList.add('hidden');
      }
    }

    const isSuperAdminAccount = prof.role === 'super_admin';
    const regStatsGrid = document.getElementById('profRegularStatsGrid');
    const saCard = document.getElementById('profSuperAdminSpecialCard');
    const roleHistorySec = document.getElementById('profRoleHistorySection');
    const solvedSec = document.getElementById('profSolvedQuestionsSection');

    if (isSuperAdminAccount) {
      if (regStatsGrid) regStatsGrid.classList.add('hidden');
      if (saCard) saCard.classList.remove('hidden');
      if (roleHistorySec) roleHistorySec.classList.add('hidden');
      if (solvedSec) solvedSec.classList.add('hidden');
    } else {
      if (regStatsGrid) regStatsGrid.classList.remove('hidden');
      if (saCard) saCard.classList.add('hidden');
      if (roleHistorySec) roleHistorySec.classList.remove('hidden');
      if (solvedSec) {
        if (prof.role === 'student' || prof.role === 'new_student') {
          solvedSec.classList.remove('hidden');
        } else {
          solvedSec.classList.add('hidden');
        }
      }
    }

    const isProfStudent = prof.role === 'student' || prof.role === 'new_student';
    if (isProfStudent) {
      starsEl.innerHTML = prof.starInfo ? `${prof.starInfo.starIcons} ${prof.starInfo.points}` : '⭐ 0/10';
    } else {
      starsEl.innerHTML = '<span class="text-slate-400 text-xs font-normal">ستاف</span>';
    }
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
    const isMuted = prof.muted_until && prof.muted_until > Date.now();

    // Private Chat Button in Profile
    const privContainer = document.getElementById('profPrivateChatContainer');
    if (privContainer) {
      const isStaffUser = currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'teacher');
      const targetIsStaff = prof.role === 'super_admin' || prof.role === 'teacher';
      const canSendPrivate = !isMe && (isStaffUser || targetIsStaff);

      // Gender rule: male student cannot message female teacher
      const isMaleStudent = currentUser && !isStaffUser && currentUser.gender === 'male';
      const isForbiddenTarget = prof.role === 'teacher' && prof.gender === 'female';

      if (canSendPrivate && !(isMaleStudent && isForbiddenTarget)) {
        privContainer.classList.remove('hidden');
        const privBtn = document.getElementById('profPrivateChatBtn');
        const privBtnText = document.getElementById('profPrivateChatBtnText');
        if (privBtn) {
          privBtn.onclick = () => {
            closeUserProfileModal();
            openPrivateChatWithUser(prof.id, prof.full_name, prof.role, prof.gender);
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

    // Star Adjustment Controls (Super Admin & Teacher only for students)
    const starsAdjustContainer = document.getElementById('profStarsAdjustContainer');
    if (starsAdjustContainer) {
      if (isProfStudent && (isSuperAdmin || (currentUser && currentUser.role === 'teacher'))) {
        starsAdjustContainer.classList.remove('hidden');
      } else {
        starsAdjustContainer.classList.add('hidden');
      }
    }

    // Request Profile Change Button (Only shown on user's OWN profile, but NOT for Super Admin)
    const reqChangeContainer = document.getElementById('profRequestChangeContainer');
    if (reqChangeContainer) {
      if (isMe && !isSuperAdminAccount) {
        reqChangeContainer.classList.remove('hidden');
      } else {
        reqChangeContainer.classList.add('hidden');
      }
    }

    // Push Notification Controls (Only shown on user's OWN profile)
    const notifContainer = document.getElementById('profNotificationContainer');
    if (notifContainer) {
      if (isMe) {
        notifContainer.classList.remove('hidden');
        if (typeof updatePushNotificationUI === 'function') {
          updatePushNotificationUI();
        }
      } else {
        notifContainer.classList.add('hidden');
      }
    }

    // Profile Logout Button (Only visible on own profile)
    const profLogout = document.getElementById('profLogoutContainer');
    if (profLogout) {
      if (isMe) {
        profLogout.classList.remove('hidden');
      } else {
        profLogout.classList.add('hidden');
      }
    }

    const canManageThisUser = canUserManageMembers(currentUser);
    const targetIsMaster = isMasterSuperAdmin(prof);

    // Master Super Admin: Special Badges Panel (باجە تایبەتەکان)
    const badgeAdminCard = document.getElementById('profSpecialBadgeAdminCard');
    const activeBadgeTag = document.getElementById('profActiveBadgeTag');

    if (badgeAdminCard) {
      if (isMasterSuperAdmin(currentUser) && !isMe && !targetIsMaster) {
        badgeAdminCard.classList.remove('hidden');
        const count = userBadges.length;
        if (activeBadgeTag) {
          if (count === 0) {
            activeBadgeTag.innerHTML = '<span class="text-slate-400 font-bold">بێ باج</span>';
          } else if (count === 6) {
            activeBadgeTag.innerHTML = '<span class="text-amber-300 font-black">خاوەنی هەموو ٦ باجەکەیە 🌟</span>';
          } else {
            const dots = userBadges.map(b => BADGE_CONFIG[b]?.emoji || '🎖️').join(' ');
            activeBadgeTag.innerHTML = `<span class="text-emerald-300 font-black">خاوەنی ${count} باجە (${dots})</span>`;
          }
        }
        ALL_SPECIAL_BADGES.forEach(b => {
          const cap = b.charAt(0).toUpperCase() + b.slice(1);
          const btn = document.getElementById(`badgeBtn${cap}`);
          const statusEl = document.getElementById(`badgeStatus${cap}`);
          const isActive = userBadges.includes(b);
          if (btn) {
            if (isActive) {
              btn.classList.add('ring-2', 'ring-indigo-400', 'bg-indigo-950/80', 'border-indigo-400');
            } else {
              btn.classList.remove('ring-2', 'ring-indigo-400', 'bg-indigo-950/80', 'border-indigo-400');
            }
          }
          if (statusEl) {
            if (isActive) {
              statusEl.innerHTML = '<span class="px-1.5 py-0.2 rounded-md bg-emerald-500 text-slate-950 text-[8px] font-black">هەیەتی ✓</span>';
            } else {
              statusEl.innerHTML = '<span class="text-[8px] text-slate-500">لێدان بۆ پێدان</span>';
            }
          }
        });
      } else {
        badgeAdminCard.classList.add('hidden');
      }
    }

    const canModerateThisUser = canUserModerateChat(currentUser);
    if ((isPrivileged || canManageThisUser || canModerateThisUser) && !isMe && !targetIsMaster) {
      superAdminActions.classList.remove('hidden');
      let roleChangeHtml = '';
      let renameActionHtml = '';
      if (canManageThisUser) {
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
          <button onclick="promptAdminEditUserName(${prof.id}, '${escapeHtml(prof.full_name)}')" class="px-2.5 py-1.5 bg-amber-500/20 hover:bg-amber-500 text-amber-300 hover:text-slate-950 border border-amber-500/40 rounded-xl text-xs font-bold transition flex items-center gap-1 shadow active:scale-95" title="دەستکاریکردنی ناوی ئەم ئەکاونتە">
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
      if (hasSuperAdminPrivileges(currentUser) && prof.role !== 'super_admin' && !targetIsMaster) {
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

async function toggleSpecialBadge(badge) {
  if (!currentProfileUserId) return;
  if (!isMasterSuperAdmin(currentUser)) {
    alert('تەنها سوپەر ئەدمینی سەرەکی دەسەڵاتی بەخشینی باجی هەیە.');
    return;
  }

  try {
    const res = await fetch('/api/admin/special-badge', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        user_id: currentProfileUserId,
        action: 'toggle',
        badge: badge
      })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'هەڵەیەک ڕوویدا');
      return;
    }

    if (currentProfileUser) {
      currentProfileUser.special_badge = data.special_badge;
    }

    if (Array.isArray(allMembersCache)) {
      const idx = allMembersCache.findIndex(u => Number(u.id) === Number(currentProfileUserId));
      if (idx !== -1) {
        allMembersCache[idx].special_badge = data.special_badge;
      }
    }

    if (Array.isArray(allUsersAdminCache)) {
      const idx = allUsersAdminCache.findIndex(u => Number(u.id) === Number(currentProfileUserId));
      if (idx !== -1) {
        allUsersAdminCache[idx].special_badge = data.special_badge;
      }
    }

    openUserProfileModal(currentProfileUserId);
    if (typeof renderMembersList === 'function') {
      renderMembersList();
    }
    if (typeof renderAllUsersList === 'function') {
      renderAllUsersList();
    }
  } catch (err) {
    console.error('Toggle special badge error:', err);
    alert('هەڵەیەک لە پەیوەندی بە سێرڤەر ڕوویدا');
  }
}

async function assignAllSpecialBadges() {
  if (!currentProfileUserId) return;
  if (!isMasterSuperAdmin(currentUser)) {
    alert('تەنها سوپەر ئەدمینی سەرەکی دەسەڵاتی بەخشینی باجی هەیە.');
    return;
  }

  if (!confirm('ئایا دڵنیایت لە پێدانی هەموو ٦ باجەکە بەیەکەوە بەم ئەندامە؟')) return;

  try {
    const res = await fetch('/api/admin/special-badge', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        user_id: currentProfileUserId,
        special_badge: 'all'
      })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'هەڵەیەک ڕوویدا');
      return;
    }

    if (currentProfileUser) {
      currentProfileUser.special_badge = data.special_badge;
    }
    if (Array.isArray(allMembersCache)) {
      const idx = allMembersCache.findIndex(u => Number(u.id) === Number(currentProfileUserId));
      if (idx !== -1) allMembersCache[idx].special_badge = data.special_badge;
    }
    if (Array.isArray(allUsersAdminCache)) {
      const idx = allUsersAdminCache.findIndex(u => Number(u.id) === Number(currentProfileUserId));
      if (idx !== -1) allUsersAdminCache[idx].special_badge = data.special_badge;
    }

    openUserProfileModal(currentProfileUserId);
    if (typeof renderMembersList === 'function') renderMembersList();
    if (typeof renderAllUsersList === 'function') renderAllUsersList();
  } catch (err) {
    alert('هەڵەیەک لە پەیوەندی بە سێرڤەر ڕوویدا');
  }
}

async function removeAllSpecialBadges() {
  if (!currentProfileUserId) return;
  if (!isMasterSuperAdmin(currentUser)) {
    alert('تەنها سوپەر ئەدمینی سەرەکی دەسەڵاتی بەخشینی باجی هەیە.');
    return;
  }

  if (!confirm('ئایا دڵنیایت لە لابردنی هەموو باجە تایبەتەکانی ئەم ئەندامە؟')) return;

  try {
    const res = await fetch('/api/admin/special-badge', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        user_id: currentProfileUserId,
        special_badge: 'none'
      })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'هەڵەیەک ڕوویدا');
      return;
    }

    if (currentProfileUser) {
      currentProfileUser.special_badge = null;
    }
    if (Array.isArray(allMembersCache)) {
      const idx = allMembersCache.findIndex(u => Number(u.id) === Number(currentProfileUserId));
      if (idx !== -1) allMembersCache[idx].special_badge = null;
    }
    if (Array.isArray(allUsersAdminCache)) {
      const idx = allUsersAdminCache.findIndex(u => Number(u.id) === Number(currentProfileUserId));
      if (idx !== -1) allUsersAdminCache[idx].special_badge = null;
    }

    openUserProfileModal(currentProfileUserId);
    if (typeof renderMembersList === 'function') renderMembersList();
    if (typeof renderAllUsersList === 'function') renderAllUsersList();
  } catch (err) {
    alert('هەڵەیەک لە پەیوەندی بە سێرڤەر ڕوویدا');
  }
}

// Legacy compatibility
async function assignSpecialBadge(badge) {
  return toggleSpecialBadge(badge);
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
      if (profStars) profStars.innerHTML = `${starInfo.starIcons} ${starInfo.points}`;
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

  const titleEl = document.getElementById('adminModalTitle');
  if (titleEl) {
    titleEl.innerText = hasSuperAdminPrivileges(currentUser) ? 'بەشی بەڕێوەبردن (Super Admin)' : 'بەشی بەڕێوەبردنی ئەندامان و سیستم';
  }

  const isSuper = hasSuperAdminPrivileges(currentUser);
  const tabBackups = document.getElementById('adminTabBackups');
  const tabAiSecurity = document.getElementById('adminTabAiSecurity');
  if (tabBackups) {
    if (isSuper) tabBackups.classList.remove('hidden');
    else tabBackups.classList.add('hidden');
  }
  if (tabAiSecurity) {
    if (isSuper) tabAiSecurity.classList.remove('hidden');
    else tabAiSecurity.classList.add('hidden');
  }

  document.getElementById('adminModal').classList.remove('hidden');
  loadPendingProfileChangesCount();
  switchAdminSubTab(currentAdminSubTab || 'pending');
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
    if (t) t.className = 'px-2.5 py-2 sm:pb-3 text-xs sm:text-sm font-bold border-b-2 border-transparent text-slate-400 hover:text-slate-200 flex items-center gap-1.5 shrink-0 transition';
  });
  // Hide all panels
  [contentPending, contentUsers, contentPasswordResets, contentProfileChanges, contentBackups].forEach(c => {
    if (c) c.classList.add('hidden');
  });

  const activeTabClass = 'px-2.5 py-2 sm:pb-3 text-xs sm:text-sm font-bold border-b-2 border-indigo-500 text-indigo-400 flex items-center gap-1.5 shrink-0 transition';

  if (tab === 'pending') {
    if (tabPending) tabPending.className = activeTabClass;
    if (contentPending) contentPending.classList.remove('hidden');
    loadPendingUsersList();
  } else if (tab === 'users') {
    if (tabUsers) tabUsers.className = activeTabClass;
    if (contentUsers) contentUsers.classList.remove('hidden');
    loadAllUsersList();
  } else if (tab === 'password_resets') {
    if (tabPasswordResets) tabPasswordResets.className = activeTabClass;
    if (contentPasswordResets) contentPasswordResets.classList.remove('hidden');
    loadPasswordResetsList();
  } else if (tab === 'profile_changes') {
    if (tabProfileChanges) tabProfileChanges.className = activeTabClass;
    if (contentProfileChanges) contentProfileChanges.classList.remove('hidden');
    loadPendingProfileChangesList();
  } else if (tab === 'backups') {
    if (tabBackups) tabBackups.className = activeTabClass;
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
              ${renderRoleBadge(req.role, req.gender)}
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
        requested_name: new_name,
        requested_password: new_password,
        new_name,
        new_password,
        reason
      })
    });
    const data = await res.json();
    if (res.ok) {
      closeRequestProfileChangeModal();
      showLiveToastNotification('داواکارییەکەت بەسەرکەوتوویی نێردرا بۆ سوپەر ئەدمین بۆ پەسەندکردن ✨', 'emerald');
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
      card.className = 'p-3.5 sm:p-4 rounded-2xl bg-slate-800/90 border border-slate-700/80 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shadow-sm hover:border-slate-600 transition';
      const createdDate = new Date(u.created_at).toLocaleDateString('ku-IQ') + ' ' + new Date(u.created_at).toLocaleTimeString('ku-IQ');

      card.innerHTML = `
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-11 h-11 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center font-bold text-lg shrink-0">
            ${getGenderEmoji(u.gender)}
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5 flex-wrap">
              <h4 class="font-bold text-sm text-white truncate">${escapeHtml(u.full_name)}</h4>
            </div>
            <div class="flex items-center gap-2 text-xs text-slate-400 mt-0.5 flex-wrap">
              <span>ناوی بەکارهێنەر: <b class="font-mono text-slate-300">@${escapeHtml(u.username)}</b></span>
              <span>•</span>
              <span class="text-[11px] text-slate-400"><i class="fa-regular fa-clock text-[10px]"></i> ${createdDate}</span>
            </div>
          </div>
        </div>

        <div class="grid grid-cols-2 sm:flex sm:items-center gap-1.5 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-700/50 w-full sm:w-auto">
          <button onclick="approveUser(${u.id}, 'student')" class="px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold text-xs shadow transition flex items-center justify-center gap-1 active:scale-95" title="پەسەندکردن وەک قوتابی ئاسایی">
            <i class="fa-solid fa-graduation-cap"></i> قوتابی 🎓
          </button>
          <button onclick="approveUser(${u.id}, 'teacher')" class="px-3 py-2 bg-purple-700 hover:bg-purple-600 text-white rounded-xl font-bold text-xs shadow transition flex items-center justify-center gap-1.5 active:scale-95" title="پەسەندکردن وەک مامۆستا">
            <i class="fa-solid fa-graduation-cap text-white text-[11px]"></i> <span>مامۆستا</span>
          </button>
          <button onclick="approveUser(${u.id}, 'new_student')" class="px-2.5 py-2 bg-teal-600 hover:bg-teal-500 text-white rounded-xl font-bold text-xs shadow transition flex items-center justify-center gap-1 active:scale-95" title="پەسەندکردن وەک قوتابی تازە (١ چات لە ٢٤ کاتژمێردا)">
            <span>تازە 🔰</span>
          </button>
          <button onclick="approveUser(${u.id}, 'guest')" class="px-2.5 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-xl font-bold text-xs shadow transition flex items-center justify-center gap-1 active:scale-95" title="پەسەندکردن وەک میوان (تەنها چاودێر)">
            <span>میوان 👁️</span>
          </button>
          <button onclick="rejectUser(${u.id})" class="col-span-2 sm:col-span-1 px-3 py-2 bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/40 rounded-xl font-bold text-xs transition flex items-center justify-center gap-1 active:scale-95" title="ڕەتکردنەوەی داواکاری">
            <i class="fa-solid fa-xmark"></i> <span>ڕەتکردنەوە</span>
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

let allUsersAdminCache = [];
let adminUsersSearchQuery = '';

function handleAdminUsersSearch(query) {
  adminUsersSearchQuery = (query || '').trim().toLowerCase();
  renderAllUsersList();
}

async function loadAllUsersList() {
  const container = document.getElementById('allUsersList');
  container.innerHTML = `<div class="text-center py-6 text-slate-400"><i class="fa-solid fa-circle-notch fa-spin text-xl"></i> بارکردن...</div>`;

  try {
    const res = await fetch('/api/admin/users', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    allUsersAdminCache = data.users || [];
    renderAllUsersList();
  } catch (e) {
    container.innerHTML = `<div class="text-center py-6 text-rose-400 text-xs font-bold">هەڵەیەک ڕوویدا لە بارکردن</div>`;
  }
}

function renderAllUsersList() {
  const container = document.getElementById('allUsersList');
  if (!container) return;
  container.innerHTML = '';

  try {
    const isSuperAdmin = currentUser && currentUser.role === 'super_admin';

    let list = allUsersAdminCache;
    if (adminUsersSearchQuery) {
      list = list.filter(u => 
        (u.full_name && u.full_name.toLowerCase().includes(adminUsersSearchQuery)) ||
        (u.username && u.username.toLowerCase().includes(adminUsersSearchQuery))
      );
    }

    if (list.length === 0) {
      container.innerHTML = `
        <div class="text-center py-10 text-slate-500">
          <i class="fa-solid fa-user-slash text-2xl text-slate-600 mb-2"></i>
          <p class="text-xs font-bold">هیچ بەکارهێنەرێک بەم ناوە نەدۆزرایەوە</p>
        </div>
      `;
      return;
    }

  list.forEach(u => {
    const isSuper = u.role === 'super_admin';
    const isAdmin = u.role === 'admin';
    const isStudent = u.role === 'student';
    const isMuted = u.muted_until && u.muted_until > Date.now();
    const isBlocked = !!u.is_blocked;
    const nameClass = getUserNameClass(u);

    const card = document.createElement('div');
    card.className = `p-3.5 sm:p-4 rounded-2xl bg-slate-800/90 border ${isBlocked ? 'border-red-500/50 bg-red-950/20' : 'border-slate-700/80'} flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shadow-sm hover:border-slate-600 transition`;

    card.innerHTML = `
      <div class="flex items-center gap-3 min-w-0">
        <div class="w-10 h-10 rounded-xl ${isSuper ? 'bg-amber-500/20 text-amber-400' : isAdmin ? 'bg-emerald-500/20 text-emerald-400' : 'bg-indigo-500/20 text-indigo-400'} flex items-center justify-center font-bold text-sm shrink-0 overflow-hidden">
          ${u.avatar_url ? `<img src="${escapeHtml(u.avatar_url)}" alt="Avatar" class="w-full h-full object-cover rounded-xl pointer-events-none select-none" draggable="false">` : `<i class="fa-solid ${isSuper ? 'fa-user-shield' : isAdmin ? 'fa-shield' : 'fa-graduation-cap'}"></i>`}
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 flex-wrap">
            <h4 class="font-bold text-sm ${nameClass} truncate">${escapeHtml(u.full_name)}</h4>
            ${renderRoleBadge(u.role, u.gender)}
            ${renderSpecialBadgeHtml(u.special_badge)}
              ${isBlocked ? '<span class="px-2 py-0.5 rounded bg-red-600 text-white text-[10px] font-black">بلۆککراوە 🚫</span>' : ''}
              ${isMuted ? '<span class="px-2 py-0.5 rounded bg-amber-600 text-white text-[10px] font-black">سڕکراوە 🔇</span>' : ''}
            </div>
            <div class="flex items-center gap-2 text-xs text-slate-400 mt-0.5 flex-wrap">
              <span class="font-mono">@${escapeHtml(u.username)}</span>
              ${isStudent ? `<span>• خاوەنی ${u.starInfo ? u.starInfo.stars : 1} ئەستێرە (${u.starInfo ? u.starInfo.points : 0}/10)</span>` : ''}
            </div>
          </div>
        </div>

        <div class="flex items-center gap-2 flex-wrap pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-700/50 w-full sm:w-auto">
          <button onclick="openUserProfileModal(${u.id})" class="px-2.5 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-xl text-xs font-bold transition flex items-center gap-1 active:scale-95">
            <i class="fa-solid fa-circle-info"></i> زانیاری
          </button>

          ${canUserManageMembers(currentUser) && !isMasterSuperAdmin(u) ? `
            <div class="flex items-center gap-1 bg-slate-900 border border-slate-700 px-2 py-1 rounded-xl">
              <span class="text-[10px] text-slate-400 font-bold">پلە:</span>
              <select onchange="changeRole(${u.id}, this.value)" class="bg-transparent text-xs text-white font-bold focus:outline-none cursor-pointer">
                <option value="student" class="bg-slate-900 text-sky-400" ${u.role === 'student' ? 'selected' : ''}>🎓 قوتابی</option>
                <option value="teacher" class="bg-slate-900 text-purple-400" ${u.role === 'teacher' ? 'selected' : ''}>👨‍🏫 مامۆستا</option>
                <option value="new_student" class="bg-slate-900 text-teal-400" ${u.role === 'new_student' ? 'selected' : ''}>🔰 تازە</option>
                <option value="guest" class="bg-slate-900 text-slate-400" ${u.role === 'guest' ? 'selected' : ''}>👁️ میوان</option>
                <option value="admin" class="bg-slate-900 text-emerald-400" ${u.role === 'admin' ? 'selected' : ''}>🛡️ ئەدمین</option>
              </select>
            </div>
          ` : ''}

          ${hasSuperAdminPrivileges(currentUser) && !isMasterSuperAdmin(u) && u.id !== currentUser.id ? `
            <button onclick="toggleBlockUser(${u.id}, ${isBlocked ? 0 : 1})" class="px-2.5 py-1.5 ${isBlocked ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/40' : 'bg-red-600/20 text-red-300 border border-red-500/40'} rounded-xl text-xs font-bold transition flex items-center gap-1 active:scale-95">
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
              <button onclick="unmuteUser(${u.id})" class="px-2.5 py-1.5 bg-amber-600/30 border border-amber-500/40 text-amber-300 rounded-xl text-xs font-bold transition active:scale-95">
                لادانی سڕکردن
              </button>
            ` : `
              <button onclick="muteUser24h(${u.id}, '${escapeHtml(u.full_name)}')" class="px-2.5 py-1.5 bg-slate-700 hover:bg-red-950 text-slate-300 hover:text-red-300 border border-slate-600 rounded-xl text-xs font-bold transition active:scale-95">
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
        <div class="p-3 sm:p-3.5 rounded-2xl bg-gradient-to-r from-amber-500/15 via-yellow-500/10 to-[#dfaa86]/20 border border-amber-500/40 relative overflow-hidden shadow-xl mb-3">
          <div class="flex items-center justify-between gap-2.5">
            <div class="flex items-center gap-2.5 min-w-0 flex-1">
              <div class="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-gradient-to-tr from-amber-500 to-yellow-300 text-slate-950 flex items-center justify-center text-lg sm:text-xl font-black shadow-lg shadow-amber-500/30 shrink-0">
                🏆
              </div>
              <div class="min-w-0 flex-1">
                <span class="text-[9px] sm:text-[10px] font-black uppercase tracking-wider bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-md border border-amber-500/30 inline-block">
                  خوێندکاری مانگ 🏆
                </span>
                <h3 class="text-xs sm:text-sm font-black text-white mt-0.5 cursor-pointer hover:underline truncate" onclick="openUserProfileModal(${st.id})">
                  ${escapeHtml(st.full_name)}
                </h3>
                <p class="text-[10px] text-slate-400 font-mono truncate">@${escapeHtml(st.username)}</p>
              </div>
            </div>
            <div class="text-left shrink-0">
              <div class="text-sm sm:text-base font-black text-amber-400 font-mono flex items-center gap-1 justify-end">
                <span>${stars}</span>
                <i class="fa-solid fa-star text-amber-400 text-xs sm:text-sm"></i>
              </div>
              <div class="text-[9px] text-slate-400 font-bold">ئەستێرەی مانگ ⭐</div>
            </div>
          </div>
        </div>
      `;
    } else {
      container.innerHTML = `
        <div class="p-3 rounded-xl bg-slate-900/60 border border-slate-800 text-xs text-slate-400 text-center flex items-center justify-center gap-2 mb-3">
          <i class="fa-solid fa-trophy text-amber-400"></i>
          <span>کێبڕکێی خوێندکاری مانگ بەردەوامە! وەڵامی پرسیارەکان بدەرەوە بۆ بردنەوەی کاس.</span>
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
        rankBadge = `<span class="w-7 h-7 rounded-full bg-amber-500 text-slate-950 font-black flex items-center justify-center text-xs shadow-md shadow-amber-500/40"><i class="fa-solid fa-trophy text-[10px]"></i></span>`;
      } else if (rank === 2) {
        rankBadge = `<span class="w-7 h-7 rounded-full bg-slate-300 text-slate-950 font-black flex items-center justify-center text-xs"><i class="fa-solid fa-medal text-[10px]"></i></span>`;
      } else if (rank === 3) {
        rankBadge = `<span class="w-7 h-7 rounded-full bg-amber-700 text-amber-100 font-black flex items-center justify-center text-xs"><i class="fa-solid fa-medal text-[10px]"></i></span>`;
      }

      const nameClass = getUserNameClass(st);
      const item = document.createElement('div');
      item.className = 'p-2.5 sm:p-3 rounded-2xl bg-slate-800/80 border border-slate-700/60 flex items-center justify-between gap-2.5 cursor-pointer hover:bg-slate-800 transition active:scale-[0.99]';
      item.onclick = () => openUserProfileModal(st.id);

      item.innerHTML = `
        <div class="flex items-center gap-2.5 min-w-0 flex-1">
          <div class="shrink-0">${rankBadge}</div>
          <div class="min-w-0 flex-1">
            <h4 class="font-bold text-xs sm:text-sm ${nameClass} truncate">${escapeHtml(st.full_name)}</h4>
            <p class="text-[10px] sm:text-[11px] text-slate-400 font-mono truncate">@${escapeHtml(st.username)}</p>
          </div>
        </div>
        <div class="text-left shrink-0 flex flex-col items-end">
          ${renderStarBadge(st.correct_answers_count)}
          <span class="text-[9px] sm:text-[10px] text-slate-400 mt-0.5 font-mono">${st.correct_answers_count} وەڵام</span>
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

// ================= THEME SYSTEM (5 RICH MODES) =================
const AVAILABLE_THEMES = [
  {
    id: 'dark',
    name: 'تاریکی بنەڕەتی',
    subtitle: 'شەوانەی کلاسیک 🌙',
    desc: 'دۆخی شینی تۆخی کلاسیکی پڕۆژەکە؛ هێمن، ڕێکخراو و هاوسەنگ بۆ بەکارهێنانی گشتی.',
    icon: 'fa-solid fa-moon',
    iconColor: 'text-indigo-400',
    swatchClass: 'from-slate-950 via-slate-900 to-indigo-950 border-indigo-500/40 text-indigo-400',
    badgeText: 'تاریک'
  },
  {
    id: 'light',
    name: 'دۆخی ڕووناک',
    subtitle: 'ڕۆژانەی گەش ☀️',
    desc: 'ڕووکاری سپی و شەفاف؛ گونجاو بۆ کاتی ڕۆژ و ژوور یان شوێنی پڕ لە ڕووناکی و خۆرەتاو.',
    icon: 'fa-solid fa-sun',
    iconColor: 'text-amber-500',
    swatchClass: 'from-amber-50 via-white to-orange-100 border-amber-400/50 text-amber-500',
    badgeText: 'ڕووناک'
  },
  {
    id: 'sepia',
    name: 'پاراستنی چاو (سێپیا)',
    subtitle: 'تایبەت بە خوێندنەوە 📖',
    desc: 'ڕەنگی کاغەزی گەرم بەبێ تیشکی شینی ماندووکەر؛ باشترینە بۆ خوێندنەوەی دوورودرێژ و قورئان بێ کزبوونی چاو.',
    icon: 'fa-solid fa-book-open',
    iconColor: 'text-amber-600',
    swatchClass: 'from-[#fbf4ea] via-[#f2e5cf] to-[#e4d4ba] border-[#b8864e]/50 text-amber-600',
    badgeText: 'سێپیا'
  },
  {
    id: 'emerald',
    name: 'سەوزی دارستان',
    subtitle: 'ئیسلامی و هێمنی 🌿',
    desc: 'سەوزی ئارامبەخشی دارستان و ڕووکاری ئیسلامی؛ دەروون ئارام دەکاتەوە و تەرکیز بەرز دەکاتەوە بۆ لەبەرکردن.',
    icon: 'fa-solid fa-seedling',
    iconColor: 'text-emerald-400',
    swatchClass: 'from-[#061913] via-[#0c2b21] to-[#144233] border-emerald-500/50 text-emerald-400',
    badgeText: 'سەوز'
  },
  {
    id: 'oled',
    name: 'ڕەشی قووڵ (OLED)',
    subtitle: 'پاشەکەوتی شەحن 🖤',
    desc: 'ڕەشی ڕەها (True Pitch Black)؛ لە شاشەی مۆبایل پێکسڵەکان دەکوژێنێتەوە و کەمترین پاتری بەکاردەهێنێت لە شەواندا.',
    icon: 'fa-solid fa-bolt',
    iconColor: 'text-sky-300',
    swatchClass: 'from-black via-[#0a0a0a] to-[#141414] border-slate-700 text-sky-300',
    badgeText: 'OLED'
  },
  {
    id: 'matte',
    name: 'ڕەشی مات',
    subtitle: 'ماتی لوکس و بێ تیشکدانەوە 🖤',
    desc: 'ڕەنگی خەڵووزی و ماتی مخمەڵی بێ درەوشانەوە؛ دیمەنێکی مۆدێرن و شکۆدار بەبێ ماندووکردنی چاو.',
    icon: 'fa-solid fa-gem',
    iconColor: 'text-zinc-400',
    swatchClass: 'from-[#121214] via-[#18181b] to-[#27272a] border-zinc-700 text-zinc-300',
    badgeText: 'مات'
  }
];

function initTheme() {
  const savedTheme = localStorage.getItem('seereen_theme') || 'dark';
  applyTheme(savedTheme);
}

function getCurrentTheme() {
  return localStorage.getItem('seereen_theme') || 'dark';
}

function applyTheme(theme) {
  const validThemes = ['dark', 'light', 'sepia', 'emerald', 'oled', 'matte'];
  if (!validThemes.includes(theme)) theme = 'dark';

  document.body.classList.remove('light-theme', 'sepia-theme', 'emerald-theme', 'oled-theme', 'matte-theme');
  if (theme !== 'dark') {
    document.body.classList.add(theme + '-theme');
  }
  localStorage.setItem('seereen_theme', theme);

  const themeObj = AVAILABLE_THEMES.find(t => t.id === theme) || AVAILABLE_THEMES[0];

  const icon = document.getElementById('themeToggleIcon');
  const text = document.getElementById('themeToggleText');
  if (icon) icon.className = `${themeObj.icon} ${themeObj.iconColor}`;
  if (text) text.innerText = themeObj.badgeText;

  const drawerIcon = document.getElementById('drawerThemeIcon');
  const drawerText = document.getElementById('drawerThemeText');
  const drawerBadge = document.getElementById('drawerThemeBadge');
  if (drawerIcon) drawerIcon.className = `${themeObj.icon} ${themeObj.iconColor} text-sm w-5 text-center`;
  if (drawerText) drawerText.innerText = (currentAppLanguage === 'ar') ? `تغيير مظهر الشاشة (${themeObj.name})` : ((currentAppLanguage === 'en') ? `Change Screen Theme (${themeObj.name})` : `گۆڕینی شێوەی ڕوونما (${themeObj.name})`);
  if (drawerBadge) drawerBadge.innerText = themeObj.badgeText;
}

function openThemeModal() {
  const modal = document.getElementById('themeModal');
  if (modal) {
    modal.classList.remove('hidden');
    renderThemeCards();
  }
}

function closeThemeModal() {
  const modal = document.getElementById('themeModal');
  if (modal) modal.classList.add('hidden');
}

function selectTheme(themeId) {
  applyTheme(themeId);
  renderThemeCards();
  setTimeout(() => {
    closeThemeModal();
  }, 220);
}

function cycleNextTheme() {
  const current = getCurrentTheme();
  const currentIndex = AVAILABLE_THEMES.findIndex(t => t.id === current);
  const nextIndex = (currentIndex + 1) % AVAILABLE_THEMES.length;
  selectTheme(AVAILABLE_THEMES[nextIndex].id);
}

function toggleTheme() {
  openThemeModal();
}

function renderThemeCards() {
  const container = document.getElementById('themeCardsList');
  if (!container) return;
  const current = getCurrentTheme();

  container.innerHTML = AVAILABLE_THEMES.map(t => {
    const isActive = t.id === current;
    const activeBorder = isActive 
      ? 'border-2 border-amber-500 bg-slate-800/95 shadow-lg' 
      : 'border border-slate-800 bg-slate-800/50 hover:bg-slate-800 hover:border-slate-700';

    return `
      <div onclick="selectTheme('${t.id}')" class="p-3 rounded-2xl cursor-pointer transition-all active:scale-[0.98] ${activeBorder} flex items-center justify-between gap-3">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 border bg-gradient-to-br ${t.swatchClass} shadow-inner text-lg">
            <i class="${t.icon}"></i>
          </div>
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <h4 class="text-xs font-black text-white truncate">${t.name}</h4>
              <span class="text-[10px] text-slate-400 font-medium">${t.subtitle}</span>
            </div>
            <p class="text-[10px] text-slate-400 leading-snug line-clamp-2 mt-0.5">${t.desc}</p>
          </div>
        </div>
        <div class="shrink-0 flex items-center">
          ${isActive 
            ? '<span class="px-2.5 py-1 rounded-xl bg-amber-500 text-slate-950 font-black text-[10px] shadow flex items-center gap-1"><i class="fa-solid fa-check text-[9px]"></i> چالاکە</span>' 
            : '<span class="px-2.5 py-1 rounded-xl bg-slate-700/60 text-slate-300 hover:text-white font-bold text-[10px]">دیاریکردن</span>'}
        </div>
      </div>
    `;
  }).join('');
}

// ================= LIBRARY (BOOKSHELF & MULTI-PDF COLLECTIONS) LOGIC =================
let allLibraryBooksCache = [];
let currentLibraryView = 'grid'; // 'grid' | 'author'
let currentLibraryCategory = 'all';
let currentViewingBookId = null;

function openLibraryModal() {
  const modal = document.getElementById('libraryModal');
  if (modal) modal.classList.remove('hidden');

  // Show upload button for staff
  const uploadBtn = document.getElementById('libOpenUploadBtn');
  if (uploadBtn) {
    const isStaff = currentUser && (currentUser.role === 'admin' || currentUser.role === 'super_admin' || currentUser.role === 'teacher');
    uploadBtn.classList.toggle('hidden', !isStaff);
  }

  loadLibraryBooks();
}

function closeLibraryModal() {
  const modal = document.getElementById('libraryModal');
  if (modal) modal.classList.add('hidden');
}

function toggleLibraryUploadForm() {
  const sec = document.getElementById('libraryUploadSection');
  if (!sec) return;
  sec.classList.toggle('hidden');
  if (!sec.classList.contains('hidden')) {
    const titleInput = document.getElementById('libBookTitle');
    if (titleInput) titleInput.focus();
  }
}

function handleLibFilesSelect(input) {
  const countEl = document.getElementById('libSelectedFilesCount');
  const previewEl = document.getElementById('libSelectedFilesPreview');
  if (!input || !input.files || input.files.length === 0) {
    if (countEl) countEl.innerText = 'هیچ دیاری نەکراوە';
    if (previewEl) {
      previewEl.classList.add('hidden');
      previewEl.innerHTML = '';
    }
    return;
  }

  const files = Array.from(input.files);
  if (countEl) {
    countEl.innerText = `(${files.length}) فایل هەڵبژێردراوە 📚`;
  }

  if (previewEl) {
    previewEl.classList.remove('hidden');
    previewEl.innerHTML = files.map((f, idx) => `
      <div class="flex items-center justify-between text-[11px] p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300">
        <span class="truncate flex items-center gap-1.5">
          <i class="fa-solid fa-file-pdf text-rose-400 text-xs"></i>
          <span class="font-bold text-white">${idx + 1}.</span>
          <span class="truncate">${escapeHtml(f.name)}</span>
        </span>
        <span class="text-teal-400 font-mono text-[10px] shrink-0">${formatFileSize(f.size)}</span>
      </div>
    `).join('');
  }
}

function switchLibraryView(view) {
  currentLibraryView = view;
  const gridBtn = document.getElementById('libViewGridBtn');
  const authorBtn = document.getElementById('libViewAuthorBtn');

  if (view === 'grid') {
    if (gridBtn) {
      gridBtn.className = 'px-2 py-1 rounded-lg bg-teal-600 text-white font-bold transition flex items-center gap-1';
    }
    if (authorBtn) {
      authorBtn.className = 'px-2 py-1 rounded-lg text-slate-400 hover:text-white font-bold transition flex items-center gap-1';
    }
  } else {
    if (gridBtn) {
      gridBtn.className = 'px-2 py-1 rounded-lg text-slate-400 hover:text-white font-bold transition flex items-center gap-1';
    }
    if (authorBtn) {
      authorBtn.className = 'px-2 py-1 rounded-lg bg-teal-600 text-white font-bold transition flex items-center gap-1';
    }
  }

  filterLibraryBooks();
}

function setLibraryCategoryFilter(cat) {
  currentLibraryCategory = cat;

  // Update chip styles
  const chips = document.querySelectorAll('.lib-cat-chip');
  chips.forEach(chip => {
    const chipCat = chip.getAttribute('data-category');
    if (chipCat === cat) {
      chip.className = 'lib-cat-chip px-2.5 py-1 rounded-full text-[11px] font-bold bg-teal-600 text-white transition shrink-0 active:scale-95 shadow-sm';
    } else {
      chip.className = 'lib-cat-chip px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-800 hover:bg-slate-700 text-slate-300 transition shrink-0 border border-slate-700/60 active:scale-95';
    }
  });

  filterLibraryBooks();
}

function clearLibrarySearch() {
  const inp = document.getElementById('librarySearchInput');
  if (inp) {
    inp.value = '';
    filterLibraryBooks();
    inp.focus();
  }
}

async function loadLibraryBooks() {
  const container = document.getElementById('libraryBooksList');
  if (container) {
    container.innerHTML = `
      <div class="text-center py-12 text-slate-500">
        <i class="fa-solid fa-circle-notch fa-spin text-xl text-teal-500 mb-2"></i>
        <p class="text-xs">بارکردنی کتێبخانە...</p>
      </div>
    `;
  }

  try {
    const res = await fetch('/api/library/books', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) {
      if (res.status === 403) {
        if (container) container.innerHTML = `<div class="text-center py-8 text-rose-400 font-bold text-xs">تۆ وەک میوان ناتوانیت سەردانی کتێبخانە بکەیت 👁️</div>`;
        return;
      }
      if (container) container.innerHTML = `<div class="text-center py-8 text-red-400 text-xs">هەڵەیەک ڕوویدا لە بارکردنی کتێبەکان</div>`;
      return;
    }
    const data = await res.json();
    allLibraryBooksCache = data.books || [];
    filterLibraryBooks();
  } catch (err) {
    if (container) container.innerHTML = `<div class="text-center py-8 text-red-400 text-xs">پەیوەندی لەگەڵ سێرڤەر ناتەواوە</div>`;
  }
}

function filterLibraryBooks() {
  const qInput = document.getElementById('librarySearchInput');
  const q = (qInput ? qInput.value : '').trim().toLowerCase();
  const clearBtn = document.getElementById('libClearSearchBtn');
  if (clearBtn) clearBtn.classList.toggle('hidden', !q);

  let filtered = allLibraryBooksCache;

  // Category filter
  if (currentLibraryCategory && currentLibraryCategory !== 'all') {
    filtered = filtered.filter(b => b.category === currentLibraryCategory);
  }

  // Text search
  if (q) {
    filtered = filtered.filter(b => {
      const matchTitle = b.title && b.title.toLowerCase().includes(q);
      const matchAuthor = b.author && b.author.toLowerCase().includes(q);
      const matchDesc = b.description && b.description.toLowerCase().includes(q);
      const matchCat = b.category && b.category.toLowerCase().includes(q);
      const matchFiles = Array.isArray(b.files) && b.files.some(f => f.file_name && f.file_name.toLowerCase().includes(q));
      return matchTitle || matchAuthor || matchDesc || matchCat || matchFiles;
    });
  }

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
  if (!container) return;
  container.innerHTML = '';

  // Update Header Stats
  const totalBooksCount = allLibraryBooksCache.length;
  let totalFilesCount = 0;
  allLibraryBooksCache.forEach(b => {
    totalFilesCount += (Array.isArray(b.files) && b.files.length > 0) ? b.files.length : 1;
  });
  const statsBadge = document.getElementById('libStatsBadge');
  if (statsBadge) {
    statsBadge.innerText = `${totalBooksCount} ناونیشان • ${totalFilesCount} فایل`;
  }

  if (!books || books.length === 0) {
    container.className = 'w-full py-12';
    container.innerHTML = `
      <div class="text-center text-slate-500">
        <div class="w-16 h-16 rounded-3xl bg-slate-800/80 border border-slate-700/60 mx-auto flex items-center justify-center text-2xl text-slate-400 mb-3 shadow-inner">
          <i class="fa-solid fa-book"></i>
        </div>
        <p class="font-bold text-sm text-slate-300">هیچ کتێب یان سەرچاوەیەک نەدۆزرایەوە</p>
        <p class="text-xs text-slate-500 mt-1">مامۆستایان و ئەدمین دەتوانن لە دوگمەی سەرەوە کتێب دابنێن</p>
      </div>
    `;
    return;
  }

  const isAdmin = currentUser && (currentUser.role === 'admin' || currentUser.role === 'super_admin' || currentUser.role === 'teacher');

  // VIEW 1: DENSE RESPONSIVE GRID (DEFAULT - MAXIMUM BOOKS VISIBLE WITHOUT SCROLLING)
  if (currentLibraryView === 'grid') {
    container.className = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2.5 sm:gap-3.5 pb-2';

    books.forEach(book => {
      const files = Array.isArray(book.files) && book.files.length > 0 ? book.files : [{
        file_name: book.file_name || 'فایلی سەرەکی',
        file_url: book.file_url,
        file_size: book.file_size || 0,
        file_type: book.file_type || 'pdf'
      }];
      const fileCount = files.length;
      const totalSize = files.reduce((acc, f) => acc + (f.file_size || 0), 0);

      const card = document.createElement('div');
      card.className = 'group relative rounded-2xl bg-gradient-to-b from-slate-800/90 to-slate-900 border border-slate-700/70 hover:border-teal-500/50 transition-all duration-200 flex flex-col justify-between p-2.5 sm:p-3 shadow-md hover:shadow-xl hover:shadow-teal-950/20 overflow-hidden cursor-pointer';
      card.onclick = (e) => {
        if (e.target.closest('a') || e.target.closest('button')) return;
        openBookVolumesModal(book.id);
      };

      const hasMultiple = fileCount > 1;
      const badgeHtml = hasMultiple
        ? `<span class="px-1.5 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[9px] sm:text-[10px] font-black flex items-center gap-1 shadow-sm">
             <i class="fa-solid fa-layer-group text-[8px]"></i>
             <span>${fileCount} بەرگ</span>
           </span>`
        : `<span class="px-1.5 py-0.5 rounded-md bg-slate-800/80 text-slate-400 text-[9px] sm:text-[10px] font-mono">
             ١ فایل
           </span>`;

      card.innerHTML = `
        <!-- Top Spine Accent & Category -->
        <div>
          <div class="flex items-center justify-between gap-1 mb-2">
            <span class="text-[9px] px-1.5 py-0.5 rounded bg-teal-500/15 text-teal-300 border border-teal-500/30 font-bold truncate max-w-[85px]">
              ${escapeHtml(book.category || 'گشتی')}
            </span>
            ${badgeHtml}
          </div>

          <!-- 3D Book Cover Graphic -->
          <div class="h-24 sm:h-28 rounded-xl bg-gradient-to-tr from-teal-950 via-slate-800 to-emerald-950/40 border border-slate-700/60 flex flex-col items-center justify-center p-2 text-center relative overflow-hidden group-hover:scale-[1.02] transition-transform">
            <div class="absolute inset-y-0 right-0 w-1.5 bg-gradient-to-l from-black/40 to-transparent"></div>
            <i class="fa-solid ${hasMultiple ? 'fa-book-journal-whills text-emerald-400' : 'fa-file-pdf text-rose-400'} text-2xl sm:text-3xl mb-1 drop-shadow"></i>
            <span class="text-[9px] text-slate-400 font-mono">${formatFileSize(totalSize)}</span>
          </div>

          <!-- Title & Author (Owner) -->
          <div class="mt-2 min-w-0">
            <h4 class="font-black text-xs sm:text-sm text-white line-clamp-2 leading-tight group-hover:text-teal-300 transition" title="${escapeHtml(book.title)}">
              ${escapeHtml(book.title)}
            </h4>
            <p class="text-[10px] text-amber-300/90 font-medium truncate mt-1 flex items-center gap-1" title="${escapeHtml(book.author || 'خاوەن کتێبی گشتی')}">
              <i class="fa-solid fa-feather-pointed text-[9px] text-amber-400 shrink-0"></i>
              <span class="truncate">${escapeHtml(book.author || 'خاوەن کتێبی گشتی')}</span>
            </p>
          </div>
        </div>

        <!-- Bottom Action Pill -->
        <div class="mt-2.5 pt-2 border-t border-slate-800/80 flex items-center justify-between gap-1 shrink-0">
          <button 
            type="button" 
            onclick="openBookVolumesModal(${book.id})" 
            class="flex-1 py-1.5 px-2 rounded-xl bg-teal-600/20 hover:bg-teal-600 text-teal-200 hover:text-white font-bold text-[10px] sm:text-xs transition flex items-center justify-center gap-1 active:scale-95 border border-teal-500/30"
          >
            <i class="fa-solid fa-book-open text-[10px]"></i>
            <span>${hasMultiple ? 'بینینی بەرگەکان' : 'خوێندنەوە'}</span>
          </button>

          ${!hasMultiple ? `
            <a 
              href="${files[0].file_url}" 
              target="_blank" 
              download="${escapeHtml(files[0].file_name)}" 
              onclick="event.stopPropagation()" 
              class="w-7 h-7 rounded-xl bg-slate-800 hover:bg-teal-600 text-slate-300 hover:text-white flex items-center justify-center text-xs transition border border-slate-700 shrink-0" 
              title="داگرتنی فایل"
            >
              <i class="fa-solid fa-download text-[10px]"></i>
            </a>
          ` : ''}

          ${isAdmin ? `
            <button 
              type="button" 
              onclick="deleteLibraryBook(${book.id}); event.stopPropagation();" 
              class="w-7 h-7 rounded-xl bg-slate-800 hover:bg-rose-900/60 text-slate-400 hover:text-rose-200 flex items-center justify-center text-xs transition border border-slate-700 shrink-0" 
              title="سڕینەوەی ئەم کتێبە"
            >
              <i class="fa-solid fa-trash-can text-[10px]"></i>
            </button>
          ` : ''}
        </div>
      `;

      container.appendChild(card);
    });
    return;
  }

  // VIEW 2: GROUPED BY AUTHOR / BOOK OWNER
  if (currentLibraryView === 'author') {
    container.className = 'space-y-3.5 pb-2';

    // Group books by author
    const authorMap = new Map();
    books.forEach(book => {
      const authorKey = (book.author && book.author.trim()) ? book.author.trim() : 'خاوەن کتێبی گشتی / نەزانراو';
      if (!authorMap.has(authorKey)) {
        authorMap.set(authorKey, []);
      }
      authorMap.get(authorKey).push(book);
    });

    authorMap.forEach((authorBooks, authorName) => {
      let totalPdfsInAuthor = 0;
      authorBooks.forEach(b => {
        totalPdfsInAuthor += (Array.isArray(b.files) && b.files.length > 0) ? b.files.length : 1;
      });

      const section = document.createElement('div');
      section.className = 'rounded-2xl bg-slate-900/90 border border-slate-800 p-3 sm:p-4 space-y-2.5 shadow-md';

      let booksHtml = authorBooks.map(book => {
        const files = Array.isArray(book.files) && book.files.length > 0 ? book.files : [{
          file_name: book.file_name || 'فایلی سەرەکی',
          file_url: book.file_url,
          file_size: book.file_size || 0,
          file_type: book.file_type || 'pdf'
        }];
        const fileCount = files.length;
        return `
          <div onclick="openBookVolumesModal(${book.id})" class="p-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-800 border border-slate-700/60 transition flex items-center justify-between gap-2 cursor-pointer group">
            <div class="flex items-center gap-2.5 min-w-0 flex-1">
              <div class="w-8 h-8 rounded-lg bg-teal-600/20 text-teal-400 flex items-center justify-center text-sm shrink-0">
                <i class="fa-solid ${fileCount > 1 ? 'fa-book-journal-whills text-emerald-400' : 'fa-file-pdf text-rose-400'}"></i>
              </div>
              <div class="min-w-0 flex-1">
                <h5 class="text-xs font-black text-white truncate group-hover:text-teal-300 transition">${escapeHtml(book.title)}</h5>
                <div class="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5">
                  <span class="text-teal-300">${escapeHtml(book.category || 'گشتی')}</span>
                  <span>•</span>
                  <span class="font-bold ${fileCount > 1 ? 'text-emerald-300' : 'text-slate-400'}">${fileCount} فایل / بەرگ</span>
                </div>
              </div>
            </div>
            <button type="button" class="px-2.5 py-1 rounded-lg bg-teal-600 text-white text-[10px] font-bold shrink-0">
              کردنەوە
            </button>
          </div>
        `;
      }).join('');

      section.innerHTML = `
        <div class="flex items-center justify-between border-b border-slate-800 pb-2">
          <div class="flex items-center gap-2">
            <div class="w-7 h-7 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center text-xs">
              <i class="fa-solid fa-user-pen"></i>
            </div>
            <div>
              <h4 class="font-black text-xs sm:text-sm text-white">${escapeHtml(authorName)}</h4>
              <p class="text-[10px] text-slate-400">${authorBooks.length} کتێب • ${totalPdfsInAuthor} بەرگی PDF</p>
            </div>
          </div>
          <span class="text-[10px] px-2 py-0.5 rounded-full bg-teal-500/15 text-teal-300 border border-teal-500/30 font-bold">
            ${authorBooks.length} ناونیشان
          </span>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
          ${booksHtml}
        </div>
      `;

      container.appendChild(section);
    });
  }
}

function openBookVolumesModal(bookId) {
  const book = allLibraryBooksCache.find(b => b.id === bookId);
  if (!book) return;

  currentViewingBookId = bookId;
  const modal = document.getElementById('libraryVolumesModal');
  if (!modal) return;

  // Title & Author
  const titleEl = document.getElementById('libVolModalTitle');
  if (titleEl) titleEl.innerText = book.title;

  const authorEl = document.getElementById('libVolModalAuthor');
  if (authorEl) {
    authorEl.innerText = `خاوەن کتێب: ${book.author || 'گشتی'} • پۆلێن: ${book.category || 'گشتی'}`;
  }

  // Description
  const descWrap = document.getElementById('libVolModalDescWrap');
  if (descWrap) {
    if (book.description && book.description.trim()) {
      descWrap.classList.remove('hidden');
      descWrap.innerText = book.description;
    } else {
      descWrap.classList.add('hidden');
    }
  }

  // Files List
  const listEl = document.getElementById('libVolModalList');
  const files = Array.isArray(book.files) && book.files.length > 0 ? book.files : [{
    file_name: book.file_name || 'فایلی سەرەکی',
    file_url: book.file_url,
    file_size: book.file_size || 0,
    file_type: book.file_type || 'pdf'
  }];

  const isAdmin = currentUser && (currentUser.role === 'admin' || currentUser.role === 'super_admin' || currentUser.role === 'teacher');

  if (listEl) {
    listEl.innerHTML = files.map((f, idx) => {
      const isPdf = f.file_type && f.file_type.includes('pdf');
      const icon = isPdf ? 'fa-file-pdf text-rose-400' : 'fa-file-lines text-teal-400';

      return `
        <div class="p-2.5 rounded-2xl bg-slate-950/80 border border-slate-800 flex items-center justify-between gap-2 text-xs hover:border-teal-500/40 transition">
          <div class="flex items-center gap-2.5 min-w-0 flex-1">
            <div class="w-8 h-8 rounded-xl bg-slate-800 flex items-center justify-center shrink-0">
              <i class="fa-solid ${icon} text-sm"></i>
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5 flex-wrap">
                <span class="font-bold text-white text-xs truncate max-w-full">${escapeHtml(f.file_name)}</span>
              </div>
              <div class="flex items-center gap-2 text-[10px] text-slate-400 font-mono mt-0.5">
                <span class="text-amber-400 font-bold">بەرگی ${idx + 1}</span>
                <span>•</span>
                <span>${formatFileSize(f.file_size)}</span>
              </div>
            </div>
          </div>

          <div class="flex items-center gap-1.5 shrink-0">
            <a 
              href="${f.file_url}" 
              target="_blank" 
              class="px-2.5 py-1.5 rounded-xl bg-teal-600/30 hover:bg-teal-600 text-teal-200 hover:text-white font-bold text-xs transition flex items-center gap-1"
              title="خوێندنەوەی ڕاستەوخۆ"
            >
              <i class="fa-solid fa-eye text-xs"></i>
              <span>خوێندنەوە</span>
            </a>
            <a 
              href="${f.file_url}" 
              target="_blank" 
              download="${escapeHtml(f.file_name)}"
              class="w-7 h-7 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center text-xs transition border border-slate-700"
              title="داگرتن"
            >
              <i class="fa-solid fa-download"></i>
            </a>

            ${isAdmin && files.length > 1 ? `
              <button 
                type="button" 
                onclick="deleteLibraryVolumeFile(${book.id}, ${idx})" 
                class="w-7 h-7 rounded-xl bg-slate-800 hover:bg-rose-900/60 text-slate-400 hover:text-rose-200 flex items-center justify-center text-xs transition border border-slate-700" 
                title="سڕینەوەی ئەم بەرگە بە تەنیا"
              >
                <i class="fa-solid fa-trash-can"></i>
              </button>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  // Admin Section in Modal
  const adminSec = document.getElementById('libVolModalAdminSection');
  if (adminSec) {
    adminSec.classList.toggle('hidden', !isAdmin);
  }
  const deleteBookBtn = document.getElementById('libVolDeleteBookBtn');
  if (deleteBookBtn) {
    deleteBookBtn.onclick = () => {
      closeLibraryVolumesModal();
      deleteLibraryBook(book.id);
    };
  }

  modal.classList.remove('hidden');
}

function closeLibraryVolumesModal() {
  const modal = document.getElementById('libraryVolumesModal');
  if (modal) modal.classList.add('hidden');
  currentViewingBookId = null;
}

async function handleAppendFilesToCurrentBook() {
  if (!currentViewingBookId) return;
  const input = document.getElementById('libVolAppendFileInput');
  if (!input || !input.files || input.files.length === 0) {
    alert('تکایە لانیکەم فایلێک هەڵبژێرە بۆ زیادکردن');
    return;
  }

  const btn = document.getElementById('libVolAppendSubmitBtn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> بارکردن...`;
  }

  const formData = new FormData();
  for (let i = 0; i < input.files.length; i++) {
    formData.append('files', input.files[i]);
  }

  try {
    const res = await fetch(`/api/library/books/${currentViewingBookId}/add-files`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });
    const data = await res.json();
    if (res.ok) {
      input.value = '';
      await loadLibraryBooks();
      openBookVolumesModal(currentViewingBookId);
      if (typeof triggerStarCelebration === 'function') triggerStarCelebration();
    } else {
      alert(data.error || 'هەڵەیەک ڕوویدا');
    }
  } catch (e) {
    alert('پەیوەندی لەگەڵ سێرڤەر ناتەواوە');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-solid fa-plus"></i> <span>زیادکردن</span>`;
    }
  }
}

async function deleteLibraryVolumeFile(bookId, fileIndex) {
  if (!confirm('ئایا دڵنیایت لە سڕینەوەی ئەم بەرگە؟')) return;
  try {
    const res = await fetch(`/api/library/books/${bookId}/files/${fileIndex}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (res.ok) {
      await loadLibraryBooks();
      openBookVolumesModal(bookId);
    } else {
      alert(data.error || 'هەڵە لە سڕینەوە');
    }
  } catch (e) {
    alert('پەیوەندی ناتەواوە');
  }
}

async function handleUploadLibraryBook(e) {
  e.preventDefault();
  const fileInput = document.getElementById('libBookFile');
  if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
    alert('تکایە فایلی کتێب یان پێدی ئێفەکان هەڵبژێرە');
    return;
  }

  const title = document.getElementById('libBookTitle').value.trim();
  const author = document.getElementById('libBookAuthor').value.trim();
  const category = document.getElementById('libBookCategory').value;
  const description = document.getElementById('libBookDescription').value.trim();
  const btn = document.getElementById('libUploadSubmitBtn');

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> بارکردن...`;
  }

  const formData = new FormData();
  for (let i = 0; i < fileInput.files.length; i++) {
    formData.append('files', fileInput.files[i]);
  }
  // Also append first file for single-file handlers
  formData.append('file', fileInput.files[0]);
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
      handleLibFilesSelect(null);
      toggleLibraryUploadForm();
      await loadLibraryBooks();
      if (typeof triggerStarCelebration === 'function') triggerStarCelebration();
    } else {
      alert(data.error || 'هەڵەیەک ڕوویدا لە بارکردن');
    }
  } catch (err) {
    alert('پەیوەندی لەگەڵ سێرڤەر ناتەواوە');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> <span>بارکردنی کتێب و بەرگەکان</span>`;
    }
  }
}

async function deleteLibraryBook(bookId) {
  if (!confirm('ئایا دڵنیایت لە سڕینەوەی ئەم کتێبە و هەموو بەرگەکانی لە کتێبخانە؟')) return;
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
  if (currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'admin' || currentUser.role === 'teacher')) {
    alert('تەنها قوتابیان و بەشداربووان دەتوانن خەون بنێرن بۆ لێکدانەوە.');
    return;
  }

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
  if (currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'admin' || currentUser.role === 'teacher')) {
    alert('تەنها قوتابیان و بەشداربووان دەتوانن خەون بنێرن بۆ لێکدانەوە.');
    return;
  }

  fetchDreamAvailability();
  const modal = document.getElementById('dreamAuthModal');
  if (modal) modal.classList.remove('hidden');
  const nameInput = document.getElementById('dreamerNameInput');
  const nameLabel = nameInput ? nameInput.previousElementSibling : null;

  if (currentUser && currentUser.full_name) {
    if (nameInput) {
      nameInput.value = currentUser.full_name;
      nameInput.readOnly = true;
      nameInput.classList.add('bg-slate-800/50', 'cursor-not-allowed', 'opacity-85');
    }
    if (nameLabel) {
      nameLabel.innerHTML = 'ناوی قوتابی (ناوە فەرمییەکەت <i class="fa-solid fa-lock text-purple-400 text-xs"></i>)';
    }
    if (currentUser.gender) {
      const radio = document.querySelector(`input[name="dreamerGenderRadio"][value="${currentUser.gender}"]`);
      if (radio) radio.checked = true;
      const radios = document.querySelectorAll('input[name="dreamerGenderRadio"]');
      radios.forEach(r => r.disabled = true);
    }
  } else {
    if (nameInput) {
      nameInput.readOnly = false;
      nameInput.classList.remove('bg-slate-800/50', 'cursor-not-allowed', 'opacity-85');
    }
    if (nameLabel) {
      nameLabel.innerText = 'ناوی تۆ (ناوی خۆت یان خوازراو)';
    }
    const radios = document.querySelectorAll('input[name="dreamerGenderRadio"]');
    radios.forEach(r => r.disabled = false);
  }
}

function closeDreamAuthModal() {
  const modal = document.getElementById('dreamAuthModal');
  if (modal) modal.classList.add('hidden');
}

async function submitDreamerStart() {
  if (currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'admin' || currentUser.role === 'teacher')) {
    alert('مامۆستا و ئەدمین ناتوانن خەون بنێرن بۆ لێکدانەوە.');
    return;
  }

  const nameInput = document.getElementById('dreamerNameInput');
  const name = (currentUser && currentUser.full_name) ? currentUser.full_name : (nameInput ? nameInput.value : '').trim();
  if (!name) {
    alert('تکایە ناوت بنووسە');
    return;
  }
  const genderRadio = document.querySelector('input[name="dreamerGenderRadio"]:checked');
  const gender = (currentUser && currentUser.gender) ? currentUser.gender : (genderRadio ? genderRadio.value : 'male');

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch('/api/dream/start', {
      method: 'POST',
      headers,
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

const dreamClientAliasMap = new Map();
let nextDynamicClientTeacherIndex = 3;

function toKurdishNumber(n) {
  const digits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  return String(n).replace(/\d/g, d => digits[d]);
}

function getDreamTeacherAlias(senderName) {
  if (!senderName) return 'مامۆستا ١';
  const clean = String(senderName).trim();
  const lower = clean.toLowerCase();
  if (lower.startsWith('مامۆستا ') && /[٠-٩\d]+$/.test(clean)) {
    return clean;
  }
  if (lower.includes('hemn') || lower.includes('هێمن') || lower.includes('taha') || lower.includes('تەها') || lower.includes('طه')) {
    return 'مامۆستا ١';
  }
  if (lower.includes('rasti') || lower.includes('ڕاستی') || lower.includes('راستی')) {
    return 'مامۆستا ٢';
  }
  if (dreamClientAliasMap.has(clean)) {
    return dreamClientAliasMap.get(clean);
  }
  const alias = `مامۆستا ${toKurdishNumber(nextDynamicClientTeacherIndex++)}`;
  dreamClientAliasMap.set(clean, alias);
  return alias;
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
  let senderNameHtml = '';

  if (isAdminView) {
    // Admin & Teacher View: show real names and badges so staff know who handled what
    if (isSuperAdminSender) {
      senderBadge = '';
      senderNameHtml = `<span class="user-name-super-admin font-black">${escapeHtml(msg.sender_name)}</span>`;
    } else if (isTeacherSender) {
      senderBadge = '<span class="role-text-teacher font-black text-[10px] inline-flex items-center gap-1 mr-1.5 select-none" title="مامۆستا"><i class="fa-solid fa-graduation-cap text-[9px]"></i> مامۆستا</span>';
      senderNameHtml = `<span class="text-amber-300 font-black">${escapeHtml(msg.sender_name)}</span>`;
    } else {
      senderBadge = '<span class="text-[9px] font-bold text-purple-300 mr-1.5">خەون بین</span>';
      senderNameHtml = `<span>${escapeHtml(msg.sender_name)}</span>`;
    }
  } else {
    // Dreamer View: Mask teacher identity as مامۆستا ١, مامۆستا ٢, etc.
    if (isStaffSender) {
      const alias = getDreamTeacherAlias(msg.sender_name);
      senderBadge = '<span class="role-text-teacher font-black text-[10px] inline-flex items-center gap-1 mr-1.5 select-none" title="مامۆستا"><i class="fa-solid fa-graduation-cap text-[9px]"></i> مامۆستا</span>';
      senderNameHtml = `<span class="text-amber-300 font-black">${escapeHtml(alias)}</span>`;
    } else {
      senderBadge = '<span class="text-[9px] font-bold text-purple-300 mr-1.5">خەون بین</span>';
      senderNameHtml = `<span>${escapeHtml(msg.sender_name)}</span>`;
    }
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

    const stream = await getStudioQualityAudioStream();
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
      roleIndicator.innerHTML = '';
      roleIndicator.className = 'hidden';
    } else {
      roleIndicator.innerHTML = '<i class="fa-solid fa-graduation-cap text-[10px]"></i> مامۆستا';
      roleIndicator.className = 'role-text-teacher text-[11px] font-black whitespace-nowrap inline-flex items-center gap-1';
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
    const genderEmoji = getGenderEmoji(s.dreamer_gender);
    const timeStr = new Date(s.last_activity).toLocaleTimeString('ku-IQ', { hour: '2-digit', minute: '2-digit' });
    const isFav = !!s.is_favorite;
    const hasVoice = Boolean(s.has_voice && s.has_voice > 0);

    const voiceBadgeHtml = hasVoice 
      ? `<span class="px-2 py-0.5 rounded-lg bg-emerald-500 text-slate-950 font-black text-[10px] inline-flex items-center gap-1 shadow animate-pulse"><i class="fa-solid fa-microphone text-[10px]"></i> 🎙️ ڤۆیسی هەیە</span>`
      : `<span class="px-1.5 py-0.5 rounded-md bg-slate-800 text-slate-500 border border-slate-700/60 font-bold text-[9px] inline-flex items-center gap-1">بێ دەنگ</span>`;

    let cardBgClass = isSelected 
      ? 'bg-purple-950/70 border-purple-500 shadow-md ring-1 ring-purple-500/50' 
      : (hasVoice ? 'dream-has-voice-card bg-emerald-950/30 hover:bg-emerald-950/50 border-emerald-500/50' : 'bg-slate-900/80 hover:bg-slate-800/80 border-slate-800');

    card.className = `p-2.5 rounded-2xl cursor-pointer transition border text-right relative group ${cardBgClass}`;

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
      <div class="flex items-center justify-between gap-1 mt-1">
        <div class="text-[11px] text-slate-400 truncate pr-1 flex-1">
          ${escapeHtml(s.last_message_content || 'دانیشتنی نوێ')}
        </div>
        <div class="shrink-0">
          ${voiceBadgeHtml}
        </div>
      </div>
      <div class="mt-2 pt-1.5 border-t border-slate-800/80 flex items-center justify-between text-[10px]">
        ${s.answered_by_name ? `
          <div class="inline-flex items-center gap-1.5 min-w-0">
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0"></span>
            <span class="text-slate-400 text-[10px] truncate">وەڵامدراوەتەوە لەلایەن: <strong class="text-emerald-400 font-bold">${escapeHtml(s.answered_by_name)}</strong></span>
          </div>
          <span class="text-[9px] px-1.5 py-0.5 rounded ${s.answered_by_role === 'teacher' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'} shrink-0 font-bold">
            ${s.answered_by_role === 'teacher' ? 'مامۆستا' : 'ئەدمین'}
          </span>
        ` : `
          <div class="inline-flex items-center gap-1.5 text-amber-400/90 font-medium">
            <span class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shrink-0"></span>
            <span class="text-[10px]">چاوەڕوانی وەڵامە ⏳</span>
          </div>
        `}
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
    if (genderElem) genderElem.innerText = getGenderEmoji(session.dreamer_gender);
    if (statusElem) {
      if (session.answered_by_name) {
        statusElem.innerHTML = `وەڵامدراوەتەوە لەلایەن: <strong class="text-emerald-400 font-bold">${escapeHtml(session.answered_by_name)}</strong>`;
      } else {
        statusElem.innerHTML = `<span class="text-amber-400 font-medium">چاوەڕوانی وەڵامە ⏳</span>`;
      }
    }

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
async function startTwoWayCallRecording(localStream, remoteStream, sessionId) {
  try {
    if (callTwoWayRecorder && callTwoWayRecorder.state === 'recording') {
      return;
    }
    callTwoWayChunks = [];
    callRecordingUploaded = false;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    // Reuse callOutputAudioContext if available so Web Audio graphs don't conflict
    if (callOutputAudioContext && callOutputAudioContext.state !== 'closed') {
      callAudioContext = callOutputAudioContext;
    } else if (!callAudioContext || callAudioContext.state === 'closed') {
      callAudioContext = new AudioContextClass();
    }
    if (callAudioContext.state === 'suspended') {
      await callAudioContext.resume().catch(() => {});
    }
    const dest = callAudioContext.createMediaStreamDestination();

    // 1. Connect Local Microphone (Caller / Admin)
    const local = localStream || callLocalStream;
    if (local && local.getAudioTracks().length > 0) {
      try {
        const src1 = callAudioContext.createMediaStreamSource(local);
        const gain1 = callAudioContext.createGain();
        gain1.gain.value = 1.0;
        src1.connect(gain1);
        gain1.connect(dest);
      } catch (e) {
        console.warn('Call record local stream source warning:', e);
      }
    }

    // 2. Connect Remote Audio (Peer / Dreamer)
    const remote = remoteStream || callRemoteStream;
    if (remote && remote.getAudioTracks().length > 0) {
      try {
        const src2 = callAudioContext.createMediaStreamSource(remote);
        const gain2 = callAudioContext.createGain();
        gain2.gain.value = 1.25;
        src2.connect(gain2);
        gain2.connect(dest);
      } catch (e) {
        console.warn('Call record remote stream source warning:', e);
      }
    }

    // 3. Fallback: connect from output source if available
    if (callOutputSource) {
      try {
        callOutputSource.connect(dest);
      } catch (e) {}
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
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      try { reg.update(); } catch (e) {}
      if (typeof initPushNotifications === 'function') {
        initPushNotifications();
      }
    }).catch((err) => {
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
    const dropdown = document.getElementById('chatSearchResultsDropdown');
    if (dropdown) {
      dropdown.classList.add('hidden');
      dropdown.innerHTML = '';
    }
  } else {
    bar.classList.add('hidden');
    if (input) input.value = '';
    const dropdown = document.getElementById('chatSearchResultsDropdown');
    if (dropdown) {
      dropdown.classList.add('hidden');
      dropdown.innerHTML = '';
    }
    filterChatMessages('');
  }
}

// --- KURDISH / ARABIC TEXT NORMALIZATION HELPER ---
function normalizeKurdishText(str) {
  if (!str) return '';
  return String(str)
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // zero-width spaces
    .replace(/[يى]/g, 'ی')
    .replace(/[ك]/g, 'ک')
    .replace(/[ة]/g, 'ە')
    .replace(/[ھ]/g, 'ه')
    .replace(/[أإآ]/g, 'ا')
    .replace(/[ؤ]/g, 'و')
    .replace(/[ئ]/g, 'ی')
    .replace(/[\u064B-\u065F]/g, '') // harakat (fatha, damma, etc.)
    .trim();
}

let _chatSearchServerTimeout = null;

function filterChatMessages(query) {
  const container = document.getElementById('messagesContainer');
  const counter = document.getElementById('chatSearchResultsCount');
  const dropdown = document.getElementById('chatSearchResultsDropdown');
  if (!container) return;

  const rawQ = (query || '').trim();
  const normQ = normalizeKurdishText(rawQ);
  const items = container.querySelectorAll('.chat-msg-item');

  if (!normQ) {
    items.forEach(el => el.classList.remove('hidden'));
    if (counter) counter.innerText = '';
    if (dropdown) {
      dropdown.classList.add('hidden');
      dropdown.innerHTML = '';
    }
    return;
  }

  let matchCount = 0;
  items.forEach(el => {
    const rawText = el.innerText || '';
    const normText = normalizeKurdishText(rawText);
    if (normText.includes(normQ) || rawText.toLowerCase().includes(rawQ.toLowerCase())) {
      el.classList.remove('hidden');
      matchCount++;
    } else {
      el.classList.add('hidden');
    }
  });

  if (counter) {
    counter.innerText = matchCount > 0 
      ? `${matchCount} پەیام دۆزرایەوە لەم بەشەدا` 
      : 'لە پەیامە نوێیەکاندا نەدۆزرایەوە (گەڕانی گشتی لە خوارەوە...)';
  }

  // Trigger server search across entire database history
  if (rawQ.length >= 2) {
    clearTimeout(_chatSearchServerTimeout);
    _chatSearchServerTimeout = setTimeout(() => {
      executeServerChatSearch(rawQ);
    }, 350);
  }
}

async function executeServerChatSearch(query) {
  const dropdown = document.getElementById('chatSearchResultsDropdown');
  if (!dropdown) return;

  const q = (query || '').trim();
  if (!q) {
    dropdown.classList.add('hidden');
    dropdown.innerHTML = '';
    return;
  }

  dropdown.classList.remove('hidden');
  dropdown.innerHTML = '<div class="p-3 text-center text-slate-400 text-xs">لە گەڕاندایە لە هەموو مێژووی چات... 🔍</div>';

  try {
    const res = await fetch(`/api/chat/search?q=${encodeURIComponent(q)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok || !data.results) {
      dropdown.innerHTML = '<div class="p-3 text-center text-rose-400 text-xs">هەڵەیەک ڕوویدا لە گەڕاندا</div>';
      return;
    }

    if (data.results.length === 0) {
      dropdown.innerHTML = '<div class="p-3 text-center text-slate-500 text-xs">هیچ پەیامێک یان کەسێک بەم ناوە نەدۆزرایەوە</div>';
      return;
    }

    dropdown.innerHTML = `
      <div class="p-2 border-b border-slate-700/80 flex items-center justify-between text-[11px] text-slate-400 font-bold bg-slate-900/95 sticky top-0">
        <span>ئەنجامەکانی گشتی لە داتابەیس (${data.results.length} پەیام):</span>
        <button type="button" onclick="document.getElementById('chatSearchResultsDropdown').classList.add('hidden')" class="text-slate-400 hover:text-white text-xs px-1.5 py-0.5 rounded hover:bg-slate-800">✕</button>
      </div>
      <div class="max-h-72 overflow-y-auto divide-y divide-slate-800">
        ${data.results.map(item => {
          const dateStr = new Date(item.created_at).toLocaleDateString('ku-IQ') + ' ' + new Date(item.created_at).toLocaleTimeString('ku-IQ', { hour: '2-digit', minute: '2-digit' });
          let snippet = item.content || '';
          if (!snippet) {
            if (item.attachment_type === 'voice') snippet = '🎤 پەیامی دەنگی';
            else if (item.attachment_type === 'image') snippet = '🖼️ وێنە';
            else if (item.attachment_type === 'video') snippet = '🎬 ڤیدیۆ';
            else if (item.attachment_type === 'document') snippet = '📄 دۆکیومێنت';
          }
          return `
            <div onclick="jumpToSearchResultMessage(${item.id})" class="p-2.5 hover:bg-slate-800/80 cursor-pointer transition flex flex-col gap-1 text-right">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-amber-300 hover:underline">${escapeHtml(item.full_name)}</span>
                <span class="text-[10px] text-slate-500 font-mono">${dateStr}</span>
              </div>
              <p class="text-xs text-slate-200 line-clamp-2 leading-relaxed font-medium">
                ${escapeHtml(snippet)}
              </p>
            </div>
          `;
        }).join('')}
      </div>
    `;
  } catch (e) {
    dropdown.innerHTML = '<div class="p-3 text-center text-rose-400 text-xs">پەیوەندی ناتەواوە</div>';
  }
}

function jumpToSearchResultMessage(msgId) {
  const dropdown = document.getElementById('chatSearchResultsDropdown');
  if (dropdown) dropdown.classList.add('hidden');

  const elem = document.getElementById(`msg-${msgId}`);
  if (elem) {
    elem.classList.remove('hidden');
    elem.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const bubble = elem.querySelector(`#msg-bubble-${msgId}`) || elem;
    bubble.classList.add('ring-4', 'ring-amber-400', 'animate-pulse');
    setTimeout(() => {
      bubble.classList.remove('ring-4', 'ring-amber-400', 'animate-pulse');
    }, 2500);
  } else {
    showLiveToastNotification(`پەیامەکە کۆنە (ID: ${msgId})`, 'indigo');
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
  const isStaff = currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'teacher');
  return reactions.map(r => {
    const activeClass = r.userReacted
      ? 'bg-sky-500/25 text-sky-300 border-sky-400/60 shadow-sm scale-105'
      : 'bg-slate-800/80 text-slate-300 border-slate-700/80 hover:border-slate-500';
    
    // Super Admin & Teacher can tap to see who gave reaction; Students toggle reaction
    const clickHandler = isStaff
      ? `showReactionUsersModal(${messageId}, '${r.emoji}', event)`
      : `sendReaction(${messageId}, '${r.emoji}', event)`;
    
    const clickTitle = isStaff
      ? `پەنجە بنێ بۆ بینینی ئەوانەی کاردانەوەی ${r.emoji}یان داناوە`
      : r.emoji;

    return `
      <button 
        type="button"
        onclick="${clickHandler}" 
        class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold border transition shadow-sm active:scale-95 cursor-pointer ${activeClass}"
        title="${clickTitle}"
      >
        <span>${r.emoji}</span>
        <span class="text-[10px] font-mono font-black">${r.count}</span>
      </button>
    `;
  }).join('');
}

let currentReactionModalMsgId = null;
let currentReactionModalEmoji = null;

async function showReactionUsersModal(messageId, emoji, event) {
  if (event) event.stopPropagation();
  const isStaff = currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'teacher');
  if (!isStaff) return;

  currentReactionModalMsgId = messageId;
  currentReactionModalEmoji = emoji;

  const modal = document.getElementById('reactionUsersModal');
  const emojiIcon = document.getElementById('reactionModalEmoji');
  const title = document.getElementById('reactionModalTitle');
  const subtitle = document.getElementById('reactionModalSubtitle');
  const list = document.getElementById('reactionUsersList');
  const toggleBtn = document.getElementById('reactionToggleSelfBtn');
  const toggleIcon = document.getElementById('reactionToggleSelfIcon');
  const toggleText = document.getElementById('reactionToggleSelfText');

  if (!modal || !list) return;

  if (emojiIcon) emojiIcon.innerText = emoji;
  if (title) title.innerText = `کاردانەوەی ${emoji}`;
  if (subtitle) subtitle.innerText = 'لە بارکردندایە...';
  list.innerHTML = `
    <div class="text-center py-6 text-slate-400 text-xs">
      <i class="fa-solid fa-circle-notch fa-spin text-base text-indigo-400 mb-1"></i>
      <p>بارکردنی ئەندامان...</p>
    </div>
  `;

  if (toggleIcon) toggleIcon.innerText = emoji;
  if (toggleBtn) {
    toggleBtn.onclick = async (e) => {
      await sendReaction(messageId, emoji, e);
      showReactionUsersModal(messageId, emoji, null);
    };
  }

  modal.classList.remove('hidden');

  try {
    const res = await fetch(`/api/chat/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/users`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok || !data.users) {
      list.innerHTML = `<p class="text-xs text-rose-400 text-center py-4">${escapeHtml(data.error || 'کێشە لە هێنانی زانیاری ڕوویدا')}</p>`;
      return;
    }

    if (subtitle) subtitle.innerText = `${data.users.length} کەس ئەم کاردانەوەیەیان داناوە`;

    if (data.users.length === 0) {
      list.innerHTML = `<p class="text-xs text-slate-500 text-center py-6">هیچ کەسێک ئەم کاردانەوەیەی نەداوە</p>`;
      return;
    }

    const hasMe = currentUser && data.users.some(u => u.id === currentUser.id);
    if (toggleText) {
      toggleText.innerText = hasMe ? 'لابردنی کاردانەوەکەم' : 'تۆش ئەم کاردانەوەیە بدە';
    }

    list.innerHTML = '';
    data.users.forEach(u => {
      const isMe = currentUser && u.id === currentUser.id;
      const nameClass = getUserNameClass(u);
      const roleBadge = renderRoleBadge(u.role, u.gender);
      const timeStr = u.created_at ? new Date(u.created_at).toLocaleTimeString('ku-IQ', { hour: '2-digit', minute: '2-digit' }) : '';

      const row = document.createElement('div');
      row.className = 'p-2 rounded-2xl bg-slate-800/60 border border-slate-700/50 flex items-center justify-between gap-2.5';
      row.innerHTML = `
        <div class="flex items-center gap-2.5 min-w-0">
          <div class="w-8 h-8 rounded-xl bg-slate-700 flex items-center justify-center text-xs font-black text-slate-300 shrink-0 border border-slate-600/40 overflow-hidden">
            ${u.avatar_url ? `<img src="${escapeHtml(u.avatar_url)}" alt="Avatar" class="w-full h-full object-cover rounded-xl pointer-events-none select-none" draggable="false">` : getGenderEmoji(u.gender)}
          </div>
          <div class="min-w-0">
            <div class="flex items-center gap-1.5 flex-wrap">
              <span class="text-xs font-black ${nameClass} truncate">${escapeHtml(u.full_name)}</span>
              ${isMe ? '<span class="text-[9px] text-indigo-400">(تۆ)</span>' : ''}
            </div>
            <div class="mt-0.5">${roleBadge}</div>
          </div>
        </div>
        ${timeStr ? `<span class="text-[10px] text-slate-500 font-mono shrink-0">${timeStr}</span>` : ''}
      `;
      list.appendChild(row);
    });
  } catch (err) {
    list.innerHTML = `<p class="text-xs text-rose-400 text-center py-4">کێشە لە هێنانەوەی کاردانەوەکان هەیە</p>`;
  }
}

function closeReactionUsersModal() {
  const modal = document.getElementById('reactionUsersModal');
  if (modal) modal.classList.add('hidden');
  currentReactionModalMsgId = null;
  currentReactionModalEmoji = null;
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
      'border-slate-700/70', 'bg-slate-800/80', 'bg-slate-850/80', 'hover:border-slate-600',
      'border-2', 'border-teal-500/80', 'bg-teal-950/30', 'ring-teal-400/30', 'shadow-teal-500/10',
      'border-amber-500/80', 'bg-amber-950/20', 'ring-amber-500/30', 'shadow-amber-500/10',
      'border-emerald-500/80', 'bg-emerald-950/25', 'ring-emerald-500/30', 'shadow-emerald-500/10',
      'border-rose-500/70', 'bg-rose-950/20', 'ring-rose-500/30', 'shadow-rose-500/10', 'ring-1', 'shadow-md', 'shadow-lg'
    );
    if (data.is_correct === 1) {
      card.classList.add('border-2', 'border-teal-500/80', 'bg-teal-950/30', 'ring-1', 'ring-teal-400/30', 'shadow-lg', 'shadow-teal-500/10');
    } else if (data.is_correct === -1) {
      card.classList.add('border-2', 'border-amber-500/80', 'bg-amber-950/20', 'ring-1', 'ring-amber-500/30', 'shadow-md', 'shadow-amber-500/10');
    } else {
      card.classList.add('border-slate-700/70', 'bg-slate-850/80', 'shadow');
    }
  }

  // 2. Update Answer Box Styling & Prominent Corner Star / Wrong Badge
  const answerBox = document.getElementById(`sub-answer-box-${data.question_id}-${data.user_id}`);
  if (answerBox) {
    const oldCorner = answerBox.querySelector('.eval-corner-star, .eval-corner-wrong');
    if (oldCorner) oldCorner.remove();

    answerBox.classList.remove('answer-box-turquoise', 'answer-box-yellow', 'bg-slate-900/90', 'border-slate-750', 'text-slate-100');

    if (data.is_correct === 1) {
      answerBox.classList.add('answer-box-turquoise');
      const starBadge = document.createElement('div');
      starBadge.className = 'eval-corner-star';
      starBadge.innerHTML = '<span>⭐</span><span>ڕاستە</span>';
      answerBox.prepend(starBadge);
    } else if (data.is_correct === -1) {
      answerBox.classList.add('answer-box-yellow');
      const wrongBadge = document.createElement('div');
      wrongBadge.className = 'eval-corner-wrong';
      wrongBadge.innerHTML = '<span>❌</span><span>هەڵە</span>';
      answerBox.prepend(wrongBadge);
    } else {
      answerBox.classList.add('bg-slate-900/90', 'border-slate-750', 'text-slate-100');
    }
  }

  // 3. Update Student Header Badge Container
  const badgeContainers = document.querySelectorAll(`.eval-badge-container-${data.question_id}-${data.user_id}`);
  badgeContainers.forEach(container => {
    if (data.is_correct === 1) {
      container.innerHTML = `
        <span class="px-2 py-0.5 bg-teal-500/20 text-teal-300 border border-teal-500/40 font-black text-[11px] rounded-lg inline-flex items-center gap-1 animate-pulse">
          <i class="fa-solid fa-star text-amber-400"></i>
          <span>وەڵامی دروستە ⭐</span>
        </span>
      `;
    } else if (data.is_correct === -1) {
      container.innerHTML = `
        <span class="px-2 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-500/40 font-black text-[11px] rounded-lg inline-flex items-center gap-1">
          <i class="fa-solid fa-circle-xmark text-rose-400"></i>
          <span>وەڵامی هەڵەیە ❌</span>
        </span>
      `;
    } else {
      container.innerHTML = '';
    }
  });

  // 4. Update evaluation slot buttons / student status
  const targetSlots = document.querySelectorAll(`.eval-slot-${data.question_id}-${data.user_id}`);
  targetSlots.forEach(slot => {
    if (isStaff) {
      if (data.is_correct === 1) {
        slot.innerHTML = `
          <div class="flex items-center gap-1">
            <span class="px-2.5 py-1 bg-teal-600/30 text-teal-300 border border-teal-500/40 font-black text-xs rounded-xl inline-flex items-center gap-1">
              <i class="fa-solid fa-circle-check text-teal-400"></i>
              <span>ڕاستە ⭐</span>
            </span>
            <button onclick="resetEvaluationFromReveal(${data.question_id}, ${data.user_id}, '${escapeHtml(data.user_name || '')}', this)" class="p-1.5 hover:bg-slate-700 text-slate-400 hover:text-white rounded-lg text-xs" title="گەڕاندنەوە">
              <i class="fa-solid fa-rotate-left text-[11px]"></i>
            </button>
          </div>
        `;
      } else if (data.is_correct === -1) {
        slot.innerHTML = `
          <div class="flex items-center gap-1">
            <span class="px-2.5 py-1 bg-amber-600/30 text-amber-300 border border-amber-500/40 font-black text-xs rounded-xl inline-flex items-center gap-1">
              <i class="fa-solid fa-circle-xmark text-rose-400"></i>
              <span>هەڵە ❌</span>
            </span>
            <button onclick="resetEvaluationFromReveal(${data.question_id}, ${data.user_id}, '${escapeHtml(data.user_name || '')}', this)" class="p-1.5 hover:bg-slate-700 text-slate-400 hover:text-white rounded-lg text-xs" title="گەڕاندنەوە">
              <i class="fa-solid fa-rotate-left text-[11px]"></i>
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
          <span class="px-2.5 py-1 bg-teal-500/20 border border-teal-500/40 text-teal-300 font-black text-xs rounded-xl inline-flex items-center gap-1 shadow-sm">
            <i class="fa-solid fa-star text-amber-400"></i>
            <span>وەڵامی دروست ⭐</span>
          </span>
        `;
      } else if (data.is_correct === -1) {
        slot.innerHTML = `
          <span class="px-2.5 py-1 bg-amber-500/20 border border-amber-500/40 text-amber-300 font-black text-xs rounded-xl inline-flex items-center gap-1 shadow-sm">
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
let privateMediaRecorder = null;
let privateAudioChunks = [];
let privateRecordingInterval = null;
let privateRecordingSeconds = 0;
let privateAudioStream = null;

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

  // If student: default to staff tab. If staff: default to conversations tab
  if (currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'teacher')) {
    switchPrivateChatTab('conversations');
  } else {
    switchPrivateChatTab('staff');
  }
}

function closePrivateChatModal() {
  cancelPrivateVoiceRecording();
  const modal = document.getElementById('privateChatModal');
  if (modal) modal.classList.add('hidden');
}

function switchPrivateChatTab(tab) {
  const staffContainer = document.getElementById('privateStaffListContainer');
  const convList = document.getElementById('privateConversationsList');
  const staffBtn = document.getElementById('privateTabStaffBtn');
  const convBtn = document.getElementById('privateTabConvBtn');

  if (tab === 'staff') {
    if (staffContainer) staffContainer.classList.remove('hidden');
    if (convList) convList.classList.add('hidden');
    if (staffBtn) {
      staffBtn.className = 'flex-1 py-1.5 px-2 rounded-xl text-white font-bold bg-sky-600 shadow transition flex items-center justify-center gap-1.5 text-xs';
    }
    if (convBtn) {
      convBtn.className = 'flex-1 py-1.5 px-2 rounded-xl text-slate-400 hover:text-white transition flex items-center justify-center gap-1.5 text-xs';
    }
    loadPrivateStaffList();
  } else {
    if (staffContainer) staffContainer.classList.add('hidden');
    if (convList) convList.classList.remove('hidden');
    if (staffBtn) {
      staffBtn.className = 'flex-1 py-1.5 px-2 rounded-xl text-slate-400 hover:text-white transition flex items-center justify-center gap-1.5 text-xs';
    }
    if (convBtn) {
      convBtn.className = 'flex-1 py-1.5 px-2 rounded-xl text-white font-bold bg-sky-600 shadow transition flex items-center justify-center gap-1.5 text-xs';
    }
    loadPrivateConversations();
  }
}

async function loadPrivateStaffList() {
  const listEl = document.getElementById('privateStaffList');
  if (!listEl) return;
  listEl.innerHTML = '<div class="p-4 text-center text-slate-500 text-xs">لە بارکردندایە...</div>';

  try {
    const res = await fetch('/api/chat/private/staff-list', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok || !Array.isArray(data.staff)) {
      listEl.innerHTML = '<div class="p-4 text-center text-rose-400 text-xs">نەتوانرا لیستی مامۆستاکان بهێنرێت</div>';
      return;
    }

    if (data.staff.length === 0) {
      listEl.innerHTML = '<div class="p-4 text-center text-slate-500 text-xs">هیچ مامۆستا یان ئەدمینێک بەردەست نییە</div>';
      return;
    }

    const isMaleStudent = currentUser && currentUser.role !== 'super_admin' && currentUser.role !== 'teacher' && currentUser.gender === 'male';
    const availableStaff = isMaleStudent ? data.staff.filter(s => !(s.role === 'teacher' && s.gender === 'female')) : data.staff;

    const superAdmins = availableStaff.filter(s => s.role === 'super_admin');
    const teachers = availableStaff.filter(s => s.role === 'teacher');

    let html = '';

    if (superAdmins.length > 0) {
      html += `
        <div class="pt-1 pb-1 px-1 text-[11px] font-bold text-purple-400 flex items-center gap-1">
          <i class="fa-solid fa-shield-halved"></i>
          <span>ئەدمین</span>
        </div>
      `;
      html += superAdmins.map(s => renderStaffCardHtml(s)).join('');
    }

    if (teachers.length > 0) {
      html += `
        <div class="pt-3 pb-1 px-1 text-[11px] font-bold text-emerald-400 flex items-center gap-1">
          <i class="fa-solid fa-graduation-cap"></i>
          <span>مامۆستاکان</span>
        </div>
      `;
      html += teachers.map(t => renderStaffCardHtml(t)).join('');
    }

    listEl.innerHTML = html;
  } catch (err) {
    console.error('Error loading private staff list:', err);
    listEl.innerHTML = '<div class="p-4 text-center text-rose-400 text-xs">هەڵەیەک لە هێناندا ڕوویدا</div>';
  }
}

function renderStaffCardHtml(s) {
  const isCurrent = activePrivateOtherUser && activePrivateOtherUser.id === s.id;
  const activeBg = isCurrent ? 'bg-sky-600/20 border-sky-500/50' : 'bg-slate-900/80 hover:bg-slate-800/80 border-slate-800';
  const roleBadge = (s.role === 'super_admin' || s.role === 'admin')
    ? `<span class="role-text-admin text-xs font-black inline-flex items-center gap-1 select-none"><i class="fa-solid fa-shield-halved text-[10px]"></i> ئەدمین</span>`
    : `<span class="role-text-teacher text-xs font-black inline-flex items-center gap-1 select-none"><i class="fa-solid fa-graduation-cap text-[10px]"></i> مامۆستا</span>`;
  const onlineDot = s.is_online 
    ? `<span class="w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-emerald-500/30" title="لەسەر هێڵە"></span>`
    : `<span class="w-2.5 h-2.5 rounded-full bg-slate-600" title="دەرەوەی هێڵە"></span>`;

  return `
    <div 
      onclick="openPrivateChatWithUser(${s.id}, '${escapeHtml(s.full_name)}', '${s.role}', '${s.gender || 'male'}')"
      class="p-2.5 rounded-2xl border cursor-pointer transition ${activeBg} flex items-center justify-between gap-2 shadow-sm"
    >
      <div class="flex items-center gap-2.5 min-w-0">
        <div class="relative w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-xs shrink-0 shadow">
          ${getGenderEmoji(s.gender)}
          <span class="absolute -bottom-0.5 -right-0.5">${onlineDot}</span>
        </div>
        <div class="min-w-0">
          <div class="font-black text-white text-xs truncate">${escapeHtml(s.full_name)}</div>
          <div class="mt-0.5">${roleBadge}</div>
        </div>
      </div>
      <button type="button" class="px-2.5 py-1 bg-sky-600 hover:bg-sky-500 text-slate-950 font-black rounded-xl text-[11px] shadow transition active:scale-95 shrink-0 flex items-center gap-1">
        <span>چات</span>
        <i class="fa-solid fa-paper-plane text-[9px]"></i>
      </button>
    </div>
  `;
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
      const isMaleStudent = currentUser && currentUser.role !== 'super_admin' && currentUser.role !== 'teacher' && currentUser.gender === 'male';
      const availableConversations = isMaleStudent ? data.conversations.filter(c => !((c.other_role || c.role) === 'teacher' && (c.other_gender || c.gender) === 'female')) : data.conversations;

      if (countBadge) countBadge.innerText = availableConversations.length;
      if (availableConversations.length === 0) {
        listEl.innerHTML = `
          <div class="p-6 text-center text-slate-500 text-xs leading-relaxed">
            هیچ گفتوگۆیەکت لەم بەشەدا نییە.<br>
            <span class="text-[11px] text-sky-400 mt-1 block">دەتوانیت لە تابی «مامۆستا و ئەدمین» دەست بکەیت بە گفتوگۆ.</span>
          </div>
        `;
        return;
      }

      listEl.innerHTML = availableConversations.map(c => {
        const otherId = c.other_id || c.other_user_id;
        const otherName = c.other_name || c.full_name || 'بەکارهێنەر';
        const otherRole = c.other_role || c.role || 'student';
        const otherGender = c.other_gender || c.gender || 'male';

        const isCurrent = activePrivateOtherUser && activePrivateOtherUser.id === otherId;
        const activeBg = isCurrent ? 'bg-sky-600/20 border-sky-500/50' : 'bg-slate-900/60 hover:bg-slate-800/80 border-slate-800';
        const roleLabel = otherRole === 'super_admin' ? 'ئەدمین' : (otherRole === 'teacher' ? 'مامۆستا' : 'قوتابی');
        const roleColor = otherRole === 'teacher' ? 'text-emerald-400' : (otherRole === 'super_admin' || otherRole === 'admin' ? 'text-purple-400' : 'text-sky-400');
        const lastTime = c.last_message_at ? new Date(c.last_message_at).toLocaleTimeString('ku-IQ', { hour: '2-digit', minute: '2-digit' }) : '';
        const unreadHtml = c.unread_count > 0 
          ? `<span class="px-1.5 py-0.5 rounded-full bg-sky-500 text-slate-950 text-[10px] font-black">${c.unread_count}</span>` 
          : '';

        let previewText = escapeHtml(c.last_message || '');
        if (c.last_message_type === 'voice') {
          previewText = '<span class="text-emerald-400 font-bold">🎙️ پەیامی دەنگی</span>';
        } else if (c.last_message_type === 'image') {
          previewText = '<span class="text-sky-300 font-bold">🖼️ وێنە</span>';
        }

        return `
          <div 
            onclick="openPrivateChatWithUser(${otherId}, '${escapeHtml(otherName)}', '${otherRole}', '${otherGender}')"
            class="p-2.5 rounded-2xl border cursor-pointer transition ${activeBg} flex items-center gap-2.5 shadow-sm"
          >
            <div class="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-xs shrink-0">
              ${getGenderEmoji(otherGender)}
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center justify-between">
                <span class="font-black text-white truncate text-xs">${escapeHtml(otherName)}</span>
                <span class="text-[10px] text-slate-500 font-mono">${lastTime}</span>
              </div>
              <div class="flex items-center justify-between mt-0.5">
                <span class="text-[11px] text-slate-400 truncate max-w-[140px]">${previewText}</span>
                <div class="flex items-center gap-1 shrink-0">
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
  const isMaleStudent = currentUser && currentUser.role !== 'super_admin' && currentUser.role !== 'teacher' && currentUser.gender === 'male';
  if (isMaleStudent && targetRole === 'teacher' && targetGender === 'female') {
    alert('بەپێی ڕێنماییەکان، قوتابی کوڕ ناتوانێت پەیوەندی بە مامۆستای ئافرەتەوە بکات.');
    return;
  }

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

  // On mobile view: show chat area and hide sidebar
  if (window.innerWidth < 768) {
    const sidebar = document.getElementById('privateConversationsSidebar');
    if (sidebar) sidebar.classList.add('hidden');
  }

  const nameEl = document.getElementById('privateChatTargetName');
  const roleEl = document.getElementById('privateChatTargetRole');
  const avatarEl = document.getElementById('privateChatTargetAvatar');
  if (nameEl) nameEl.innerText = targetName;
  if (roleEl) {
    roleEl.innerText = targetRole === 'super_admin' ? 'ئەدمین' : (targetRole === 'teacher' ? 'مامۆستا' : 'قوتابی');
  }
  if (avatarEl) {
    avatarEl.innerText = getGenderEmoji(targetGender);
  }

  await loadPrivateThread(targetUserId);
}

function showPrivateConversationsSidebarMobile() {
  const sidebar = document.getElementById('privateConversationsSidebar');
  const emptyState = document.getElementById('privateChatEmptyState');
  const activeBox = document.getElementById('privateChatActiveBox');
  if (!sidebar) return;

  if (sidebar.classList.contains('hidden')) {
    sidebar.classList.remove('hidden');
    if (activeBox) activeBox.classList.add('hidden');
    if (emptyState) emptyState.classList.add('hidden');
  } else {
    sidebar.classList.add('hidden');
    if (activePrivateOtherUser && activeBox) {
      activeBox.classList.remove('hidden');
    } else if (emptyState) {
      emptyState.classList.remove('hidden');
    }
  }
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
            هیچ نامەیەک لەنێوانتاندا نییە. دەتوانیت ئێستا نامەی دەنگی، وێنە یان نوسراو بنێریت!
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
  const pTimeInfo = getMessageDateTimeInfo(m.created_at);
  const timeFormatted = pTimeInfo.shortTime || (m.created_at ? new Date(m.created_at).toLocaleTimeString('ku-IQ', { hour: '2-digit', minute: '2-digit' }) : '');

  const mediaUrl = m.attachment_url || (m.content && m.content.startsWith('/uploads/') ? m.content : '');
  const isAudio = m.type === 'voice' || (mediaUrl && (mediaUrl.endsWith('.webm') || mediaUrl.endsWith('.mp3') || mediaUrl.endsWith('.ogg') || mediaUrl.endsWith('.m4a') || mediaUrl.endsWith('.wav')));
  const isImage = m.type === 'image' || (mediaUrl && (mediaUrl.endsWith('.png') || mediaUrl.endsWith('.jpg') || mediaUrl.endsWith('.jpeg') || mediaUrl.endsWith('.webp') || mediaUrl.endsWith('.gif')));

  let bodyHtml = '';
  if (isAudio && mediaUrl) {
    bodyHtml = `
      <div class="my-1 space-y-1">
        <audio controls src="${escapeHtml(mediaUrl)}" class="max-w-[220px] sm:max-w-[280px] h-8 rounded-xl"></audio>
        ${m.content && !m.content.startsWith('/uploads/') ? `<p class="text-[10px] text-slate-300 font-medium">${escapeHtml(m.content)}</p>` : ''}
      </div>
    `;
  } else if (isImage && mediaUrl) {
    bodyHtml = `
      <div class="my-1 cursor-pointer space-y-1" onclick="openPrivateImageModal('${escapeHtml(mediaUrl)}')">
        <img src="${escapeHtml(mediaUrl)}" alt="وێنە" class="max-w-[180px] sm:max-w-[260px] max-h-48 rounded-2xl object-cover border border-slate-700/80 shadow hover:opacity-95 transition" loading="lazy">
        ${m.content && m.content !== '🖼️ وێنە' && !m.content.startsWith('/uploads/') ? `<p class="text-[11px] text-slate-200 mt-1">${escapeHtml(m.content)}</p>` : ''}
      </div>
    `;
  } else {
    bodyHtml = `<div class="select-text whitespace-pre-wrap">${escapeHtml(m.content)}</div>`;
  }

  const div = document.createElement('div');
  if (m.id) div.id = `private-msg-${m.id}`;
  div.className = `flex flex-col ${isMe ? 'items-end' : 'items-start'} my-1.5`;
  div.innerHTML = `
    <div class="max-w-[85%] sm:max-w-[75%] rounded-2xl px-3.5 py-2 text-xs leading-relaxed shadow break-words ${
      isMe ? 'bg-sky-600 text-white rounded-br-none' : 'bg-slate-800 text-slate-100 border border-slate-700/80 rounded-bl-none'
    }">
      ${bodyHtml}
      <div class="msg-faint-time text-[9px] mt-1 text-right font-mono ${isMe ? 'text-sky-200/80' : 'text-slate-400/80'} flex items-center justify-end gap-1 select-none">
        <span>${pTimeInfo.shortTime}</span>
        <span class="opacity-50">•</span>
        <span class="opacity-80">${pTimeInfo.shortDate}</span>
      </div>
    </div>
  `;
  container.appendChild(div);
  if (scroll) {
    container.scrollTop = container.scrollHeight;
  }
}

// Voice recording in private chat
async function togglePrivateVoiceRecording() {
  if (privateMediaRecorder && privateMediaRecorder.state === 'recording') {
    finishAndSendPrivateVoice();
    return;
  }

  try {
    privateAudioStream = await getStudioQualityAudioStream();
    privateAudioChunks = [];
    privateRecordingSeconds = 0;

    let mimeType = '';
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported) {
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) mimeType = 'audio/webm;codecs=opus';
      else if (MediaRecorder.isTypeSupported('audio/webm')) mimeType = 'audio/webm';
      else if (MediaRecorder.isTypeSupported('audio/mp4')) mimeType = 'audio/mp4';
      else if (MediaRecorder.isTypeSupported('audio/ogg')) mimeType = 'audio/ogg';
    }
    const options = mimeType ? { mimeType } : {};
    privateMediaRecorder = new MediaRecorder(privateAudioStream, options);

    privateMediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        privateAudioChunks.push(e.data);
      }
    };

    privateMediaRecorder.start(250);

    const bar = document.getElementById('privateRecordingBar');
    const timer = document.getElementById('privateRecordingTimer');
    if (bar) bar.classList.remove('hidden');
    if (timer) timer.innerText = '00:00';

    if (privateRecordingInterval) clearInterval(privateRecordingInterval);
    privateRecordingInterval = setInterval(() => {
      privateRecordingSeconds++;
      const mins = String(Math.floor(privateRecordingSeconds / 60)).padStart(2, '0');
      const secs = String(privateRecordingSeconds % 60).padStart(2, '0');
      if (timer) timer.innerText = `${mins}:${secs}`;
    }, 1000);
  } catch (err) {
    console.error('Private voice recording error:', err);
    alert('ڕێگەپێدانی مایکرۆفۆن ڕەتکرایەوە یان مایکرۆفۆن لەم وێبگەڕەدا کار ناکات.');
  }
}

async function finishAndSendPrivateVoice() {
  if (!privateMediaRecorder || !activePrivateOtherUser) return;
  if (privateRecordingInterval) clearInterval(privateRecordingInterval);

  const bar = document.getElementById('privateRecordingBar');
  if (bar) bar.classList.add('hidden');

  privateMediaRecorder.onstop = async () => {
    try {
      if (privateAudioChunks.length === 0) return;
      const mimeType = privateMediaRecorder.mimeType || 'audio/webm';
      const ext = mimeType.includes('mp4') ? 'mp4' : (mimeType.includes('ogg') ? 'ogg' : 'webm');
      const blob = new Blob(privateAudioChunks, { type: mimeType });

      const formData = new FormData();
      formData.append('recipient_id', activePrivateOtherUser.id);
      formData.append('voice', blob, `voice_${Date.now()}.${ext}`);
      formData.append('audio', blob, `voice_${Date.now()}.${ext}`);
      const durationStr = `${Math.floor(privateRecordingSeconds / 60)}:${String(privateRecordingSeconds % 60).padStart(2, '0')}`;
      formData.append('duration', durationStr);

      const res = await fetch('/api/chat/private/upload-voice', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });
      const data = await res.json();
      if (res.ok && data.message) {
        appendPrivateMessageToThread(data.message, true);
        loadPrivateConversations();
      } else {
        alert(data.error || 'نەتوانرا دەنگەکە بنێردرێت');
      }
    } catch (e) {
      console.error('Failed to send private voice:', e);
      alert('هەڵەیەک لە ناردنی دەنگدا ڕوویدا');
    } finally {
      if (privateAudioStream) {
        privateAudioStream.getTracks().forEach(t => t.stop());
        privateAudioStream = null;
      }
      privateMediaRecorder = null;
      privateAudioChunks = [];
    }
  };

  privateMediaRecorder.stop();
}

function cancelPrivateVoiceRecording() {
  if (privateRecordingInterval) clearInterval(privateRecordingInterval);
  if (privateMediaRecorder && privateMediaRecorder.state !== 'inactive') {
    privateMediaRecorder.onstop = null;
    privateMediaRecorder.stop();
  }
  if (privateAudioStream) {
    privateAudioStream.getTracks().forEach(t => t.stop());
    privateAudioStream = null;
  }
  privateMediaRecorder = null;
  privateAudioChunks = [];
  const bar = document.getElementById('privateRecordingBar');
  if (bar) bar.classList.add('hidden');
}

// Image compression helper for private chat and general media
async function compressImageForUpload(file, maxDimension = 1600, quality = 0.82) {
  if (!file || !file.type || !file.type.startsWith('image/')) return file;
  if (file.type === 'image/gif' || file.type === 'image/svg+xml') return file;

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.naturalWidth || img.width;
        let height = img.naturalHeight || img.height;
        if (!width || !height) return resolve(file);

        if (file.size < 400 * 1024 && width <= maxDimension && height <= maxDimension && (file.type === 'image/jpeg' || file.type === 'image/png')) {
          return resolve(file);
        }

        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob((blob) => {
          if (!blob) return resolve(file);
          const baseName = (file.name || 'image').replace(/\.[^/.]+$/, '');
          const compressed = new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' });
          resolve(compressed);
        }, 'image/jpeg', quality);
      };
      img.onerror = () => resolve(file);
      img.src = e.target.result;
    };
    reader.onerror = () => resolve(file);
    reader.readAsDataURL(file);
  });
}

// Image upload in private chat with automatic compression
async function uploadPrivateImage(input) {
  if (!input || !input.files || input.files.length === 0 || !activePrivateOtherUser) return;
  const rawFile = input.files[0];
  input.value = '';

  showLiveToastNotification('وێنەکە لە ئامادەکردن و بارکردندایە... 🖼️', 'emerald');

  try {
    const fileToUpload = await compressImageForUpload(rawFile);

    const formData = new FormData();
    formData.append('recipient_id', activePrivateOtherUser.id);
    formData.append('image', fileToUpload);

    const res = await fetch('/api/chat/private/upload-image', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });
    const data = await res.json();
    if (res.ok && data.message) {
      appendPrivateMessageToThread(data.message, true);
      loadPrivateConversations();
      showLiveToastNotification('وێنەکە بە سەرکەوتوویی نێردرا ✨', 'emerald');
    } else {
      alert(data.error || 'نەتوانرا وێنەکە بنێردرێت');
    }
  } catch (err) {
    console.error('Failed to upload private image:', err);
    alert('هەڵەیەک لە ناردنی وێنەدا ڕوویدا');
  }
}

function openPrivateImageModal(src) {
  if (!src) return;
  const existing = document.getElementById('privateImagePreviewModal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'privateImagePreviewModal';
  modal.className = 'fixed inset-0 z-[999999] flex flex-col items-center justify-center p-3 sm:p-6 bg-slate-950/95 backdrop-blur-md select-none animate-in fade-in duration-200';
  modal.onclick = (e) => {
    if (e.target === modal) modal.remove();
  };

  modal.innerHTML = `
    <div class="relative max-w-4xl w-full max-h-[92vh] flex flex-col items-center" onclick="event.stopPropagation()">
      <!-- Top Action Bar -->
      <div class="w-full flex items-center justify-between gap-2 mb-2 px-2 text-white">
        <div class="flex items-center gap-2">
          <a href="${escapeHtml(src)}" download target="_blank" class="px-3 py-1.5 bg-slate-800/90 hover:bg-slate-700 text-sky-400 hover:text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 border border-slate-700/60 shadow-sm" title="داگرتنی وێنە">
            <i class="fa-solid fa-download"></i>
            <span>داگرتن</span>
          </a>
          <a href="${escapeHtml(src)}" target="_blank" class="px-3 py-1.5 bg-slate-800/90 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 border border-slate-700/60 shadow-sm" title="کردنەوە لە پەڕەیەکی نوێ">
            <i class="fa-solid fa-arrow-up-right-from-square"></i>
            <span class="hidden xs:inline">کردنەوە لە پەڕەی تر</span>
          </a>
        </div>
        <button onclick="document.getElementById('privateImagePreviewModal')?.remove()" class="px-3 py-1.5 bg-rose-600/80 hover:bg-rose-600 text-white rounded-xl text-xs font-bold transition flex items-center gap-1 shadow-sm">
          <span>داخستن</span>
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>

      <!-- Image Box with Loading Spinner -->
      <div class="relative w-full flex items-center justify-center min-h-[220px]">
        <div id="privatePreviewSpinner" class="absolute inset-0 flex flex-col items-center justify-center text-sky-400 gap-2">
          <i class="fa-solid fa-circle-notch fa-spin text-2xl"></i>
          <span class="text-xs text-slate-400 font-medium">وێنەکە لە بارکردندایە...</span>
        </div>
        <img id="privatePreviewImg" 
             src="${escapeHtml(src)}" 
             alt="وێنەی گەورەکراو" 
             class="max-w-full max-h-[80vh] rounded-2xl object-contain shadow-2xl border border-slate-700/80 transition opacity-0 duration-200"
             onload="this.classList.remove('opacity-0'); document.getElementById('privatePreviewSpinner')?.remove();"
             onerror="const sp = document.getElementById('privatePreviewSpinner'); if(sp) sp.innerHTML = '<div class=\\'text-rose-400 text-xs font-bold\\'>⚠️ نەتوانرا وێنەکە پیشانبدرێت. <a href=\\'${escapeHtml(src)}\\' target=\\'_blank\\' class=\\'underline text-sky-400 ml-1\\'>کردنەوەی ڕاستەوخۆ</a></div>';"
        >
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const escHandler = (e) => {
    if (e.key === 'Escape') {
      modal.remove();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);
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
  const isStaff = canUserManageLive(currentUser);
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
let liveAudioMasterGain = null;
let liveAudioFilterHigh = null;
let liveAudioFilterLow = null;
let liveIncomingBusNode = null;
let liveRecordingDestination = null;
let liveHostMicGainNode = null;
let liveHostMicSourceNode = null;
let liveQuranMediaElementSource = null;
let liveQuranRecordingGainNode = null;
const liveRemoteAudioStreams = new Map();
let currentLiveAudioOutputMode = 'speaker';

function getLiveAudioMasterGain() {
  try {
    if (!liveAudioContext || liveAudioContext.state === 'closed') {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      liveAudioContext = new AudioCtx();
    }
    if (!liveAudioMasterGain) {
      liveAudioMasterGain = liveAudioContext.createGain();
      liveAudioFilterHigh = liveAudioContext.createBiquadFilter();
      liveAudioFilterHigh.type = 'highpass';
      liveAudioFilterHigh.frequency.value = (currentLiveAudioOutputMode === 'earpiece' ? 300 : 20);

      liveAudioFilterLow = liveAudioContext.createBiquadFilter();
      liveAudioFilterLow.type = 'lowpass';
      liveAudioFilterLow.frequency.value = (currentLiveAudioOutputMode === 'earpiece' ? 3400 : 20000);

      // Dedicated summing bus for all remote participants/students
      liveIncomingBusNode = liveAudioContext.createGain();
      liveIncomingBusNode.gain.value = 1.0;

      // Routing: incomingBus -> filterHigh -> filterLow -> masterGain -> destination (speakers)
      liveIncomingBusNode.connect(liveAudioFilterHigh);
      liveAudioFilterHigh.connect(liveAudioFilterLow);
      liveAudioFilterLow.connect(liveAudioMasterGain);
      liveAudioMasterGain.connect(liveAudioContext.destination);

      liveAudioMasterGain.gain.value = (currentLiveAudioOutputMode === 'earpiece' ? 0.22 : 1.0);
    }
    return { 
      masterGain: liveAudioMasterGain, 
      filterHigh: liveAudioFilterHigh, 
      filterLow: liveAudioFilterLow,
      incomingBus: liveIncomingBusNode 
    };
  } catch (err) {
    console.log('getLiveAudioMasterGain error:', err);
    return { masterGain: null, filterHigh: null, filterLow: null, incomingBus: null };
  }
}

function connectHostMicToRecording() {
  if (!liveRecordingDestination || !liveAudioContext) return;
  if (!localLiveAudioStream) return;
  try {
    if (liveHostMicSourceNode) {
      try { liveHostMicSourceNode.disconnect(); } catch (e) {}
    }
    if (liveHostMicGainNode) {
      try { liveHostMicGainNode.disconnect(); } catch (e) {}
    }
    liveHostMicSourceNode = liveAudioContext.createMediaStreamSource(localLiveAudioStream);
    liveHostMicGainNode = liveAudioContext.createGain();
    liveHostMicGainNode.gain.value = 1.0;
    liveHostMicSourceNode.connect(liveHostMicGainNode);
    liveHostMicGainNode.connect(liveRecordingDestination);
  } catch (e) {
    console.log('connectHostMicToRecording note:', e);
  }
}

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

  const isStaff = canUserManageLive(currentUser);
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
    const isStaff = canUserManageLive(currentUser);
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
  const isStaff = canUserManageLive(currentUser);
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

  return await getStudioQualityAudioStream();
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

    const isStaff = canUserManageLive(currentUser);
    const hasPermission = isStaff || localMicPermissionGranted || (myParticipant && myParticipant.hasMicPermission);

    if (!hasPermission) {
      alert('تەنها پێشکەشکار و بەڕێوەبەری وانە دەتوانن قسە بکەن. تکایە دوگمەی «دەست بەرزکردنەوە ✋» دابگرە تا مۆڵەتی مایکت پێدەدرێت.');
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
        connectHostMicToRecording();

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
  const isStaff = canUserManageLive(currentUser);
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

// Mobile Landscape & Fullscreen for Viewers (سەرلاکردنی شاشەی شەیرکراو و شاشەی پڕ)
function toggleScreenShareLandscape() {
  const container = document.getElementById('liveScreenContainer');
  const btnText = document.getElementById('screenRotateBtnText');
  const btn = document.getElementById('screenRotateBtn');
  if (!container) return;

  const isLandscape = container.classList.toggle('live-screen-landscape-active');
  if (isLandscape) {
    if (btnText) btnText.textContent = 'ئاسایی 📱';
    if (btn) {
      btn.classList.remove('bg-indigo-600/90');
      btn.classList.add('bg-rose-600/90');
    }
    try {
      if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('landscape').catch(() => {});
      }
    } catch (e) {}
  } else {
    if (btnText) btnText.textContent = 'سەرلاکردن 🔄';
    if (btn) {
      btn.classList.remove('bg-rose-600/90');
      btn.classList.add('bg-indigo-600/90');
    }
    try {
      if (screen.orientation && screen.orientation.unlock) {
        screen.orientation.unlock();
      }
    } catch (e) {}
  }
}

function toggleScreenShareFullscreen() {
  const container = document.getElementById('liveScreenContainer');
  const video = document.getElementById('liveScreenVideo');
  if (!container) return;

  // iOS Safari specific fullscreen handling
  if (video && typeof video.webkitEnterFullscreen === 'function' && !document.fullscreenElement && !document.webkitFullscreenElement) {
    try {
      video.webkitEnterFullscreen();
      return;
    } catch (e) {}
  }

  if (!document.fullscreenElement && !document.webkitFullscreenElement) {
    if (container.requestFullscreen) {
      container.requestFullscreen().catch(() => toggleScreenShareLandscape());
    } else if (container.webkitRequestFullscreen) {
      container.webkitRequestFullscreen();
    } else {
      toggleScreenShareLandscape();
    }
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    }
  }
}

// Unlimited Two-Way Recording (تۆمارکردنی دەنگی وانە لە هەردوولا بێ سنوور: مامۆستا + هەموو قوتابیان)
async function toggleLiveRecording() {
  const recordBtn = document.getElementById('liveRecordBtn');
  const recordDot = document.getElementById('liveRecordDot');
  const recordText = document.getElementById('liveRecordText');

  if (liveMediaRecorder && liveMediaRecorder.state !== 'inactive') {
    try {
      liveMediaRecorder.stop();
    } catch (e) {}
    if (liveRecordingTimer) clearInterval(liveRecordingTimer);
    liveRecordingTimer = null;

    if (recordBtn) recordBtn.className = 'px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow';
    if (recordDot) recordDot.className = 'w-2.5 h-2.5 rounded-full bg-rose-500';
    if (recordText) recordText.innerText = 'تۆمارکردنی دەنگ';
    return;
  }

  try {
    const { incomingBus } = getLiveAudioMasterGain();
    if (liveAudioContext && liveAudioContext.state === 'suspended') {
      await liveAudioContext.resume().catch(() => {});
    }

    // Destination stream that will mix both Host Microphone + ALL Remote Students/Members Voices + Quran
    liveRecordingDestination = liveAudioContext.createMediaStreamDestination();

    // 1. Connect remote participants bus directly to recording destination
    if (incomingBus) {
      try {
        incomingBus.connect(liveRecordingDestination);
      } catch (e) {
        console.log('incomingBus connect note:', e);
      }
    }

    // Fallback: Also connect all active remote streams and DOM audio elements to destination
    liveRemoteAudioStreams.forEach((rStream) => {
      try {
        if (rStream && rStream.getAudioTracks && rStream.getAudioTracks().length > 0) {
          const peerSrc = liveAudioContext.createMediaStreamSource(rStream);
          peerSrc.connect(liveRecordingDestination);
        }
      } catch (e) {}
    });

    document.querySelectorAll('audio[id^="live_audio_"]').forEach(el => {
      if (el && el.srcObject) {
        try {
          const domSrc = liveAudioContext.createMediaStreamSource(el.srcObject);
          domSrc.connect(liveRecordingDestination);
        } catch (e) {}
      }
    });

    // 2. Connect Quran Audio if playing
    const quranAudio = document.getElementById('liveQuranAudio');
    if (quranAudio && !quranAudio.paused) {
      try {
        if (!liveQuranMediaElementSource) {
          liveQuranMediaElementSource = liveAudioContext.createMediaElementSource(quranAudio);
          liveQuranMediaElementSource.connect(liveAudioContext.destination);
        }
        liveQuranRecordingGainNode = liveAudioContext.createGain();
        liveQuranRecordingGainNode.gain.value = 0.8;
        liveQuranMediaElementSource.connect(liveQuranRecordingGainNode);
        liveQuranRecordingGainNode.connect(liveRecordingDestination);
      } catch (e) {
        console.log('Quran recording connect note:', e);
      }
    }

    // 3. Connect Host's Microphone (خاوەن لایڤ / مامۆستا)
    if (!localLiveAudioStream) {
      try {
        localLiveAudioStream = await requestLiveAudioStream();
      } catch (e) {
        try {
          localLiveAudioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (err) {}
      }
    }

    if (localLiveAudioStream) {
      connectHostMicToRecording();
    }

    liveRecordedAudioChunks = [];
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') 
      ? 'audio/webm;codecs=opus' 
      : (MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4');

    liveMediaRecorder = new MediaRecorder(liveRecordingDestination.stream, { mimeType });

    liveMediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        liveRecordedAudioChunks.push(e.data);
      }
    };

    liveMediaRecorder.onstop = () => {
      // Disconnect recording nodes cleanly
      try {
        if (incomingBus && liveRecordingDestination) {
          incomingBus.disconnect(liveRecordingDestination);
        }
      } catch (e) {}
      try {
        if (liveHostMicGainNode && liveRecordingDestination) {
          liveHostMicGainNode.disconnect(liveRecordingDestination);
        }
      } catch (e) {}
      try {
        if (liveQuranRecordingGainNode && liveRecordingDestination) {
          liveQuranRecordingGainNode.disconnect(liveRecordingDestination);
        }
      } catch (e) {}
      liveRecordingDestination = null;

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

      // Auto archive to server live recordings list
      try {
        if (token && currentUser && (currentUser.role === 'teacher' || currentUser.role === 'super_admin')) {
          const totalSecs = Math.max(1, Math.floor((Date.now() - (liveRecordingStartTime || Date.now())) / 1000));
          const durStr = `${String(Math.floor(totalSecs / 60)).padStart(2, '0')}:${String(totalSecs % 60).padStart(2, '0')}`;
          const formData = new FormData();
          formData.append('audio', blob, `live_lesson_${Date.now()}.${mimeType.includes('mp4') ? 'mp4' : 'webm'}`);
          formData.append('duration', durStr);
          formData.append('title', `وانەی لایڤ (${now.toLocaleDateString('ku-IQ')})`);
          fetch('/api/live-recordings/upload', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
          }).then(r => r.json()).then(data => {
            if (data && data.success) {
              showLiveToastNotification('وانەکە بە سەرکەوتوویی لە بەشی تۆماری وانەکان پاشەکەوت کرا 🎙️', 'emerald');
            }
          }).catch(e => console.error('Failed to auto-archive live lesson:', e));
        }
      } catch (archErr) {
        console.error('Archive error:', archErr);
      }

      alert('تۆمارکردنی دەنگ تەواو بوو و دەنگی (مامۆستا + هەموو ئەندامەکان) بە سەرکەوتوویی داگیرا و لە بەشی تۆماری وانەکان ئەرشیڤ کرا! 🎙️📥');
    };

    liveMediaRecorder.start(2000);
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
  currentLiveAudioOutputMode = type;
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

  const targetVol = (type === 'earpiece' ? 0.22 : 1.0);

  // 1. Control Web Audio master gain and telephone acoustics
  try {
    const { masterGain, filterHigh, filterLow } = getLiveAudioMasterGain();
    if (liveAudioContext && masterGain) {
      if (liveAudioContext.state === 'suspended') {
        liveAudioContext.resume().catch(() => {});
      }
      if (type === 'earpiece') {
        masterGain.gain.setValueAtTime(0.22, liveAudioContext.currentTime);
        if (filterHigh) filterHigh.frequency.setValueAtTime(300, liveAudioContext.currentTime);
        if (filterLow) filterLow.frequency.setValueAtTime(3400, liveAudioContext.currentTime);
      } else {
        masterGain.gain.setValueAtTime(1.0, liveAudioContext.currentTime);
        if (filterHigh) filterHigh.frequency.setValueAtTime(20, liveAudioContext.currentTime);
        if (filterLow) filterLow.frequency.setValueAtTime(20000, liveAudioContext.currentTime);
      }
    }
  } catch (e) {
    console.log('WebAudio gain update note:', e);
  }

  // 2. Hardware routing (setSinkId) and fallback HTML audio elements
  try {
    const liveAudio = document.getElementById('liveRoomAudio');
    const quranAudio = document.getElementById('liveQuranAudio');
    if (liveAudio) liveAudio.volume = targetVol;

    let targetDeviceId = '';
    if (typeof HTMLMediaElement.prototype.setSinkId === 'function') {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioOutputs = devices.filter(d => d.kind === 'audiooutput');

      if (type === 'bluetooth') {
        const bt = audioOutputs.find(d => 
          d.label.toLowerCase().includes('bluetooth') || 
          d.label.toLowerCase().includes('headset') || 
          d.label.toLowerCase().includes('buds') ||
          d.label.toLowerCase().includes('wireless')
        );
        if (bt) targetDeviceId = bt.deviceId;
      } else if (type === 'earpiece') {
        const ep = audioOutputs.find(d => 
          d.label.toLowerCase().includes('earpiece') || 
          d.label.toLowerCase().includes('receiver') ||
          d.label.toLowerCase().includes('phone') ||
          d.label.toLowerCase().includes('telephony')
        );
        if (ep) targetDeviceId = ep.deviceId;
      }

      if (liveAudio && liveAudio.setSinkId) await liveAudio.setSinkId(targetDeviceId || '');
      if (quranAudio && quranAudio.setSinkId) await quranAudio.setSinkId(targetDeviceId || '');
    }

    document.querySelectorAll('audio[id^="live_audio_"]').forEach(async el => {
      try {
        el.volume = targetVol;
        if (el.setSinkId) {
          await el.setSinkId(targetDeviceId || '');
        }
      } catch (e) {}
    });

    if (liveAudioContext && typeof liveAudioContext.setSinkId === 'function') {
      try {
        await liveAudioContext.setSinkId(targetDeviceId || '');
      } catch (e) {}
    }
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

  const isAdmin = canUserManageLive(currentUser);

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
      presenterText.innerText = `وانەبێژ: ${state.startedBy.name} (${state.startedBy.role === 'teacher' ? 'مامۆستا' : 'ئەدمین'})`;
    }
    const isTeacherOrSuperAdmin = canUserManageLive(currentUser);
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
    
    const isTeacherOrSuperAdmin = canUserManageLive(currentUser);
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
        const roleLabel = (p.role === 'super_admin' || p.role === 'admin') ? 'ئەدمین' : (p.role === 'teacher' ? 'مامۆستا' : 'قوتابی');
        const roleColor = (p.role === 'super_admin' || p.role === 'admin') ? 'text-indigo-400' : (p.role === 'teacher' ? 'text-amber-400' : 'text-slate-400');
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
                  ${getGenderEmoji(p.gender)}
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
                ${p.handRaised ? '<span class="px-2 py-0.5 rounded-md bg-indigo-600/30 text-indigo-300 text-[10px] font-black border border-indigo-500/40 animate-pulse">دەست بەرزکراوە ✋</span>' : ''}
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

  // Update student's raise hand button state dynamically
  const myParticipant = participants.find(p => currentUser && Number(p.userId) === Number(currentUser.id));
  const raiseHandBtn = document.getElementById('liveRaiseHandBtn');
  const raiseHandText = document.getElementById('liveRaiseHandText');
  if (raiseHandBtn && raiseHandText) {
    if (myParticipant && myParticipant.handRaised) {
      raiseHandText.innerText = 'دەستت بەرزکراوەتەوە ✋';
      raiseHandBtn.className = 'px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white border border-indigo-400 rounded-xl text-xs font-bold transition flex items-center gap-2 shadow active:scale-95 animate-pulse';
    } else {
      raiseHandText.innerText = 'دەست بەرزکردنەوە ✋';
      raiseHandBtn.className = 'px-3.5 py-2 bg-indigo-600/20 hover:bg-indigo-600 text-indigo-300 hover:text-white border border-indigo-500/40 rounded-xl text-xs font-bold transition flex items-center gap-2 shadow active:scale-95';
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

function createOrGetLivePeerConnection(peerSocketId) {
  if (!peerSocketId || peerSocketId === socket.id) return null;

  let pc = livePeerConnections.get(peerSocketId);
  if (pc && pc.connectionState !== 'closed' && pc.connectionState !== 'failed') {
    return pc;
  }

  if (pc) {
    try { pc.close(); } catch (e) {}
    livePeerConnections.delete(peerSocketId);
  }

  pc = new RTCPeerConnection(rtcLiveIceConfig);
  livePeerConnections.set(peerSocketId, pc);

  // 1. Inbound tracks handler (Works for BOTH offerer and answerer!)
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
        video.muted = true;
        video.play().catch(e => console.log('Live screen video play:', e));
      }
      if (screenContainer) screenContainer.classList.remove('hidden');
      if (standbyBox) standbyBox.classList.add('hidden');
    } else if (event.track.kind === 'audio') {
      handleIncomingLiveAudio(event.track, stream, peerSocketId);
    }
  };

  // 2. ICE candidates
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('live_signal', {
        to: peerSocketId,
        type: 'candidate',
        candidate: event.candidate
      });
    }
  };

  // 3. Connection state changes
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
      try { pc.close(); } catch (e) {}
      livePeerConnections.delete(peerSocketId);
    }
  };

  return pc;
}

function syncLocalTracksToPC(pc) {
  if (!pc) return;
  const senders = pc.getSenders();

  // Screen share tracks
  if (localLiveScreenStream) {
    localLiveScreenStream.getTracks().forEach(track => {
      const existing = senders.find(s => s.track && s.track.kind === track.kind);
      if (existing) {
        try { existing.replaceTrack(track); } catch (e) {}
      } else {
        try { pc.addTrack(track, localLiveScreenStream); } catch (e) {}
      }
    });
  }

  // Microphone audio tracks
  if (localLiveAudioStream && !isLocalMicMuted) {
    localLiveAudioStream.getAudioTracks().forEach(track => {
      if (track.enabled) {
        const existing = senders.find(s => s.track && s.track.kind === 'audio');
        if (existing) {
          try { existing.replaceTrack(track); } catch (e) {}
        } else {
          try { pc.addTrack(track, localLiveAudioStream); } catch (e) {}
        }
      }
    });
  }

  // Ensure audio transceiver exists so audio can ALWAYS be received both ways
  const hasAudioSender = pc.getSenders().some(s => s.track && s.track.kind === 'audio');
  if (!hasAudioSender) {
    const transceivers = pc.getTransceivers ? pc.getTransceivers() : [];
    const hasAudioTransceiver = transceivers.some(t => t.receiver && t.receiver.track && t.receiver.track.kind === 'audio');
    if (!hasAudioTransceiver) {
      try {
        pc.addTransceiver('audio', { direction: 'recvonly' });
      } catch (e) {}
    }
  }
}

async function broadcastLiveMediaToPeer(targetSocketId) {
  if (!targetSocketId || targetSocketId === socket.id) return;

  const pc = createOrGetLivePeerConnection(targetSocketId);
  if (!pc) return;

  syncLocalTracksToPC(pc);

  try {
    const offer = await pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true
    });
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
  liveRemoteAudioStreams.delete(targetSocketId);
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
      broadcastLiveMediaToPeer(fromSocketId);
      return;
    }

    if (data.type === 'offer' && data.sdp) {
      let pc = livePeerConnections.get(fromSocketId);
      if (pc) {
        try { pc.close(); } catch (e) {}
        livePeerConnections.delete(fromSocketId);
      }

      pc = createOrGetLivePeerConnection(fromSocketId);
      syncLocalTracksToPC(pc);

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
  if (!track) return;
  const mediaStream = stream || new MediaStream([track]);

  liveRemoteAudioStreams.set(fromSocketId, mediaStream);

  const targetVol = (currentLiveAudioOutputMode === 'earpiece' ? 0.22 : 1.0);

  // 1. Dual output A: Off-screen HTML5 Audio element
  let audioElem = document.getElementById(`live_audio_${fromSocketId}`);
  if (!audioElem) {
    audioElem = document.createElement('audio');
    audioElem.id = `live_audio_${fromSocketId}`;
    audioElem.autoplay = true;
    audioElem.playsInline = true;
    // Offscreen positioning to avoid display:none media pipeline suspension
    audioElem.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0.01;pointer-events:none;';
    document.body.appendChild(audioElem);
  }

  audioElem.srcObject = mediaStream;
  audioElem.volume = targetVol;

  const playAudio = () => {
    audioElem.play().catch(err => {
      console.log('Live audio element playback waiting for gesture:', err);
    });
  };

  playAudio();
  track.onunmute = () => {
    playAudio();
    try {
      if (liveAudioContext && liveAudioContext.state === 'suspended') {
        liveAudioContext.resume().catch(() => {});
      }
    } catch (e) {}
  };

  // 2. Dual output B: Web Audio API routing through incomingBus and recording mixer
  try {
    const { masterGain, incomingBus } = getLiveAudioMasterGain();
    if (liveAudioContext && incomingBus && masterGain) {
      if (liveAudioContext.state === 'suspended') {
        liveAudioContext.resume().catch(() => {});
      }
      const srcNode = liveAudioContext.createMediaStreamSource(mediaStream);
      srcNode.connect(incomingBus);

      // If recording is active, pipe student's voice directly into recording destination
      if (liveRecordingDestination) {
        try {
          srcNode.connect(liveRecordingDestination);
        } catch (recErr) {}
      }

      // Web Audio is handling output with master gain control; mute HTML element to eliminate echo/doubling
      audioElem.muted = true;
    } else {
      audioElem.muted = false;
    }
  } catch (e) {
    console.log('WebAudio live direct routing note, fallback to HTML5 audio:', e);
    audioElem.muted = false;
  }

  // Apply volume / earphone mode
  applyLiveAudioOutputMode(audioElem);
}

function applyLiveAudioOutputMode(audioElem) {
  if (!audioElem) return;
  const targetVol = (currentLiveAudioOutputMode === 'earpiece' ? 0.22 : 1.0);
  audioElem.volume = targetVol;
}

function handleLivePeerJoined(data) {
  if (!data || !data.socketId) return;
  broadcastLiveMediaToPeer(data.socketId);
}

function handleLivePeerLeft(data) {
  if (!data || !data.socketId) return;
  closeLivePeerConnection(data.socketId);
}

function handleLivePeerMicState(data) {
  if (!data || !data.socketId) return;
  if (!data.isMuted && data.socketId !== socket.id) {
    // When an attendee un-mutes, immediately ensure connection and request their audio stream
    const pc = livePeerConnections.get(data.socketId);
    if (!pc || pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
      socket.emit('live_signal', {
        to: data.socketId,
        type: 'request_stream'
      });
    }
  }
}

function handleLiveAudioChunk(data) {
  // Reserved for optional fallback streaming
}

// =========================================================================
// 5. LOGO POPUP ANIMATION (ستافی سیرین 3D ZOOM)
// =========================================================================
let logoPopupTimeout = null;

function showLogoPopupAnimation() {
  const modal = document.getElementById('logoPopupModal');
  if (!modal) return;
  modal.classList.remove('hidden');

  if (logoPopupTimeout) clearTimeout(logoPopupTimeout);
  logoPopupTimeout = setTimeout(() => {
    closeLogoPopupAnimation();
  }, 3000);
}

function closeLogoPopupAnimation() {
  const modal = document.getElementById('logoPopupModal');
  if (!modal) return;
  modal.classList.add('hidden');
  if (logoPopupTimeout) {
    clearTimeout(logoPopupTimeout);
    logoPopupTimeout = null;
  }
}

// =========================================================================
// 6. MULTI-LANGUAGE ENGINE & GROUP CHAT TRANSLATION (کوردی / العربية / English)
// =========================================================================
let currentAppLanguage = localStorage.getItem('seereen_lang') || 'ku';
const translatedMsgsCache = new Map();

const APP_TRANSLATIONS = {
  ar: {
    drawerProfileText: 'الملف الشخصي',
    drawerSettingsTitle: 'الإعدادات',
    drawerLangTitle: 'تغيير اللغة',
    drawerFontTitle: 'تغيير حجم الخط',
    drawerGeneralHeader: 'الخدمات الرئيسية',
    drawerRecordedLessonsText: 'الدروس المسجلة',
    drawerRecordedLessonsBadge: 'استماع',
    drawerLibraryText: 'مكتبة ستاف',
    drawerQuestionsText: 'بنك الأسئلة والأجوبة',
    drawerLeaderboardText: 'الترتيب والنقاط',
    drawerPrivateChatText: 'محادثة خاصة مع المعلم',
    drawerDreamSubmitText: 'إرسال حلم للتفسير',
    drawerDreamSubmitBadge: '١ إلى ١',
    drawerSearchText: 'البحث في الرسائل',
    drawerMembersText: 'قائمة الأعضاء',
    drawerNotificationText: 'إشعارات الهاتف والشاشة',
    drawerThemeText: 'تغيير مظهر الشاشة',
    drawerThemeBadge: 'المظهر',
    drawerPwaText: 'تثبيت التطبيق (PWA)',
    drawerStaffHeader: 'أدوات الإدارة والمعلم',
    drawerLiveRecordingsText: 'تسجيلات الدروس (مباشر)',
    drawerLiveRecordingsBadge: 'تحميل',
    drawerPostQuestionText: 'نشر سؤال جديد',
    drawerPostQuestionBadge: 'جديد',
    drawerUnansweredText: 'قائمة غير المجاب عليها',
    drawerDreamAdminText: 'تفسير الأحلام',
    drawerAdminPanelText: 'إدارة الأعضاء والنظام',
    drawerLogoutText: 'تسجيل الخروج من الحساب',
    topPodiumBtnText: 'المتصدرون',
    drawerRecordedLessonsBtn: 'الدروس المسجلة',
    drawerPrivateChatBtn: 'رسالة خاصة',
    drawerLiveRecordingsBtn: 'تسجيلات البث المباشر (الإدارة)',
    drawerProfileBtn: 'ملفي الشخصي',
    drawerLogoutBtn: 'تسجيل الخروج',
    drawerDreamBtn: 'تفسير الأحلام',
    drawerQuranBtn: 'القرآن الكريم',
    drawerPendingBtn: 'الطلبات المعلقة',
    drawerAdminBtn: 'لوحة التحكم',
    drawerLiveBtn: 'غرفة البث المباشر',
    chatTabBtn: 'الدردشة',
    membersTabBtn: 'الأعضاء',
    privateChatHeaderTitle: 'الرسائل الخاصة',
    privateTabStaffText: 'الأستاذ والمشرف',
    privateTabConvText: 'المحادثات'
  },
  en: {
    drawerProfileText: 'Profile',
    drawerSettingsTitle: 'Settings',
    drawerLangTitle: 'Change Language',
    drawerFontTitle: 'Change Font Size',
    drawerGeneralHeader: 'Main Services',
    drawerRecordedLessonsText: 'Recorded Lessons',
    drawerRecordedLessonsBadge: 'Listen',
    drawerLibraryText: 'Staff Library',
    drawerQuestionsText: 'Questions & Answers Bank',
    drawerLeaderboardText: 'Leaderboard & Points',
    drawerPrivateChatText: 'Private Chat with Teacher',
    drawerDreamSubmitText: 'Submit Dream for Interpretation',
    drawerDreamSubmitBadge: '1-on-1',
    drawerSearchText: 'Search Messages',
    drawerMembersText: 'Members List',
    drawerNotificationText: 'Phone & Screen Alerts',
    drawerThemeText: 'Change Screen Theme',
    drawerThemeBadge: 'Theme',
    drawerPwaText: 'Install Application (PWA)',
    drawerStaffHeader: 'Staff & Admin Tools',
    drawerLiveRecordingsText: 'Live Lessons Archive',
    drawerLiveRecordingsBadge: 'Download',
    drawerPostQuestionText: 'Post New Question',
    drawerPostQuestionBadge: 'New',
    drawerUnansweredText: 'Unanswered Questions',
    drawerDreamAdminText: 'Dream Interpretations',
    drawerAdminPanelText: 'System & User Admin',
    drawerLogoutText: 'Sign Out of Account',
    topPodiumBtnText: 'Top Leaders',
    drawerRecordedLessonsBtn: 'Recorded Lessons',
    drawerPrivateChatBtn: 'Private Messages',
    drawerLiveRecordingsBtn: 'Live Recordings Archive',
    drawerProfileBtn: 'My Profile',
    drawerLogoutBtn: 'Sign Out',
    drawerDreamBtn: 'Dream Interpretation',
    drawerQuranBtn: 'Holy Quran',
    drawerPendingBtn: 'Pending Requests',
    drawerAdminBtn: 'Admin Dashboard',
    drawerLiveBtn: 'Live Stream Room',
    chatTabBtn: 'Chat',
    membersTabBtn: 'Members',
    privateChatHeaderTitle: 'Private Messages',
    privateTabStaffText: 'Staff & Admin',
    privateTabConvText: 'Conversations'
  }
};

function initAppLanguage() {
  setAppLanguage(currentAppLanguage, false);
}

function setAppLanguage(lang, triggerRerender = true) {
  currentAppLanguage = lang;
  localStorage.setItem('seereen_lang', lang);

  // Update Drawer Language Buttons
  const kuBtn = document.getElementById('langBtn_ku');
  const arBtn = document.getElementById('langBtn_ar');
  const enBtn = document.getElementById('langBtn_en');
  const badge = document.getElementById('drawerCurrentLangBadge');

  const activeBtnClass = 'py-1.5 px-2 rounded-xl bg-amber-500 text-slate-950 font-black text-center transition active:scale-95 shadow';
  const inactiveBtnClass = 'py-1.5 px-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-center border border-slate-700 transition active:scale-95';

  if (kuBtn) kuBtn.className = (lang === 'ku') ? activeBtnClass : inactiveBtnClass;
  if (arBtn) arBtn.className = (lang === 'ar') ? activeBtnClass : inactiveBtnClass;
  if (enBtn) enBtn.className = (lang === 'en') ? activeBtnClass : inactiveBtnClass;

  if (badge) {
    badge.innerText = (lang === 'ku') ? 'کوردی' : (lang === 'ar' ? 'العربية' : 'English');
  }

  applyAppLanguage(lang);

  // Re-render chat messages if needed so translation buttons update
  if (triggerRerender && typeof loadMessages === 'function') {
    loadMessages();
  }
}

function applyAppLanguage(lang) {
  const isEn = lang === 'en';
  const isAr = lang === 'ar';

  // Update Direction and Language attribute
  document.documentElement.setAttribute('lang', lang);

  // Placeholders
  const msgInput = document.getElementById('messageInput');
  if (msgInput) {
    if (isAr) msgInput.placeholder = 'اكتب رسالتك هنا...';
    else if (isEn) msgInput.placeholder = 'Type your message here...';
    else msgInput.placeholder = 'پەیامەکەت بنووسە...';
  }

  const searchInput = document.getElementById('chatSearchInput');
  if (searchInput) {
    if (isAr) searchInput.placeholder = 'بحث في الرسائل والمواضيع...';
    else if (isEn) searchInput.placeholder = 'Search messages...';
    else searchInput.placeholder = 'گەڕان بەپێی دەق، بابەت یان ناوی نێرەر...';
  }

  const privInput = document.getElementById('privateMsgInput');
  if (privInput) {
    if (isAr) privInput.placeholder = 'اكتب رسالتك...';
    else if (isEn) privInput.placeholder = 'Type your message...';
    else privInput.placeholder = 'نامەکەت بنووسە...';
  }

  const sendBtn = document.getElementById('sendBtn');
  if (sendBtn) {
    sendBtn.title = isAr ? 'إرسال' : (isEn ? 'Send' : 'ناردن');
  }

  const themeToggleText = document.getElementById('themeToggleText');
  if (themeToggleText) {
    themeToggleText.innerText = isAr ? 'المظهر' : (isEn ? 'Theme' : 'مۆد');
  }

  const pushText = document.getElementById('pushNotificationText');
  if (pushText) {
    pushText.innerText = isAr ? 'إشعارات' : (isEn ? 'Alerts' : 'ئاگاداری');
  }

  const liveNav = document.getElementById('liveLessonNavBtn');
  if (liveNav) {
    const span = liveNav.querySelector('span.hidden.sm\\:inline') || liveNav.querySelector('span:not([id])');
    if (span) span.innerText = isAr ? 'الدرس' : (isEn ? 'Lesson' : 'وانە');
  }

  const sidebarHeading = document.querySelector('#membersSidebar h3');
  if (sidebarHeading) {
    sidebarHeading.innerText = isAr ? 'قائمة الطلاب والأعضاء' : (isEn ? 'Students & Members' : 'لیستی خوێندکاران و ئەندامان');
  }

  if (lang === 'ku') {
    // Restore default Kurdish text
    const kuDefaults = {
      drawerProfileText: 'پرۆفایل',
      drawerSettingsTitle: 'ڕێکخستن',
      drawerLangTitle: 'گۆڕینی زمان',
      drawerFontTitle: 'قەبارەی پیت',
      drawerGeneralHeader: 'خزمەتگوزارییە سەرەکییەکان',
      drawerRecordedLessonsText: 'وانە تۆمارکراوەکان',
      drawerRecordedLessonsBadge: 'گوێگرتن',
      drawerLibraryText: 'کتێبخانەی ستاف',
      drawerQuestionsText: 'بانکی پرسیار و وەڵامەکان',
      drawerLeaderboardText: 'ڕیزبەندی و خاڵەکان',
      drawerPrivateChatText: 'نامەی تایبەت لەگەڵ مامۆستا',
      drawerDreamSubmitText: 'ناردنی خەون بۆ لێکدانەوە',
      drawerDreamSubmitBadge: '١ بە ١',
      drawerSearchText: 'گەڕان لەناو پەیامەکان',
      drawerMembersText: 'لیستی ئەندامان',
      drawerNotificationText: 'ئاگاداری مۆبایل و ڕوونما',
      drawerThemeText: 'گۆڕینی شێوەی ڕوونما',
      drawerThemeBadge: 'مۆد',
      drawerPwaText: 'داگرتنی ئەپڵیکەیشن (PWA)',
      drawerStaffHeader: 'ئامرازەکانی ستاف و ئەدمین',
      drawerLiveRecordingsText: 'تۆماری وانەکان (ڕاستەوخۆ)',
      drawerLiveRecordingsBadge: 'داگرتن',
      drawerPostQuestionText: 'دانانی پرسیاری نوێ',
      drawerPostQuestionBadge: 'نوێ',
      drawerUnansweredText: 'لیستی وەڵامنەدراوەکان',
      drawerDreamAdminText: 'لێکدانەوەی خەونەکان',
      drawerAdminPanelText: 'بەڕێوەبردنی ئەندامان و سیستم',
      drawerLogoutText: 'چوونە دەرەوە لە ئەکاونت',
      topPodiumBtnText: 'پێشەنگەکان',
      drawerRecordedLessonsBtn: 'وانە تۆمارکراوەکان',
      drawerPrivateChatBtn: 'نامەی تایبەت',
      drawerLiveRecordingsBtn: 'تۆماری وانەکان (ڕاستەوخۆ)',
      drawerProfileBtn: 'پرۆفایلەکەم',
      drawerLogoutBtn: 'چوونەدەرەوە',
      drawerDreamBtn: 'لێکدانەوەی خەون',
      drawerQuranBtn: 'قورئانی پیرۆز',
      drawerPendingBtn: 'داواکارییە هەڵپەسێردراوەکان',
      drawerAdminBtn: 'بەڕێوەبردن (Admin)',
      drawerLiveBtn: 'ژووری وانەی ڕاستەوخۆ',
      chatTabBtn: 'چات',
      membersTabBtn: 'ئەندامان',
      privateChatHeaderTitle: 'نامەی تایبەت',
      privateTabStaffText: 'مامۆستا و ئەدمین',
      privateTabConvText: 'گفتوگۆکان'
    };
    for (const [id, val] of Object.entries(kuDefaults)) {
      const el = document.getElementById(id);
      if (el) {
        const span = el.querySelector('span:last-child') || el;
        span.innerText = val;
      }
    }
    if (typeof setAppFontSize === 'function') setAppFontSize(currentAppFontSize);
    return;
  }

  const dict = APP_TRANSLATIONS[lang];
  if (!dict) return;

  for (const [id, val] of Object.entries(dict)) {
    const el = document.getElementById(id);
    if (el) {
      const span = el.querySelector('span:last-child') || el;
      span.innerText = val;
    }
  }

  if (typeof setAppFontSize === 'function') setAppFontSize(currentAppFontSize);
}

async function translateGroupMessage(msgId, btnElem) {
  const bubble = document.getElementById(`msg-bubble-${msgId}`) || (btnElem ? btnElem.closest('.msg-bubble') : null);
  const contentEl = document.getElementById(`msg-content-${msgId}`) || (bubble ? bubble.querySelector('.msg-text-content') : null);

  if (!bubble || !contentEl) return;

  const translationBoxId = `translated-box-${msgId}`;
  const existingBox = document.getElementById(translationBoxId);
  if (existingBox) {
    if (existingBox.classList.contains('hidden')) {
      existingBox.classList.remove('hidden');
    } else {
      existingBox.classList.add('hidden');
    }
    return;
  }

  const originalText = contentEl.innerText.trim();
  if (!originalText) return;

  const targetLang = (currentAppLanguage === 'ar' || currentAppLanguage === 'en') ? currentAppLanguage : 'ar';
  const cacheKey = `${msgId}_${targetLang}`;

  if (translatedMsgsCache.has(cacheKey)) {
    renderTranslationBox(bubble, translationBoxId, translatedMsgsCache.get(cacheKey), targetLang);
    return;
  }

  const originalBtnHtml = btnElem ? btnElem.innerHTML : '';
  if (btnElem) {
    btnElem.innerHTML = `<i class="fa-solid fa-spinner fa-spin text-sky-400"></i>`;
    btnElem.disabled = true;
  }

  try {
    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ text: originalText, target: targetLang })
    });
    const data = await res.json();
    if (res.ok && data.translatedText) {
      translatedMsgsCache.set(cacheKey, data.translatedText);
      renderTranslationBox(bubble, translationBoxId, data.translatedText, targetLang);
    } else {
      alert('نەتوانرا تەرجومە بکرێت: ' + (data.error || 'هەڵەیەک ڕوویدا'));
    }
  } catch (err) {
    console.error('Translation error:', err);
  } finally {
    if (btnElem) {
      btnElem.innerHTML = originalBtnHtml;
      btnElem.disabled = false;
    }
  }
}

function renderTranslationBox(container, boxId, text, lang) {
  const existing = document.getElementById(boxId);
  if (existing) {
    existing.classList.remove('hidden');
    return;
  }
  const box = document.createElement('div');
  box.id = boxId;
  box.className = 'mt-2 pt-1.5 border-t border-slate-700/60 text-xs text-sky-200 select-text leading-relaxed bg-slate-950/40 p-2 rounded-xl border border-sky-500/30';
  const label = lang === 'ar' ? '🌐 الترجمة:' : '🌐 Translation:';
  box.innerHTML = `<span class="text-[10px] text-sky-400 font-bold block mb-0.5">${label}</span><span>${escapeHtml(text)}</span>`;
  container.appendChild(box);
}

// 6b. QUESTION ANSWERS & CONTENT TRANSLATION (ترجمة إجابات الطلاب والأسئلة)
async function translateSubmissionAnswer(questionId, userId, btnElem) {
  const container = document.getElementById(`sub-answer-box-${questionId}-${userId}`);
  const contentEl = document.getElementById(`sub-answer-content-${questionId}-${userId}`);
  if (!container || !contentEl) return;

  const translationBoxId = `sub-trans-${questionId}-${userId}`;
  const existingBox = document.getElementById(translationBoxId);
  if (existingBox) {
    existingBox.classList.toggle('hidden');
    return;
  }

  const originalText = contentEl.innerText.replace(/^["“”']|["“”']$/g, '').trim();
  if (!originalText) return;

  const targetLang = (currentAppLanguage === 'ar' || currentAppLanguage === 'en') ? currentAppLanguage : 'ar';
  const cacheKey = `sub_${questionId}_${userId}_${targetLang}`;

  if (translatedMsgsCache.has(cacheKey)) {
    renderTranslationBox(container, translationBoxId, translatedMsgsCache.get(cacheKey), targetLang);
    return;
  }

  const originalBtnHtml = btnElem ? btnElem.innerHTML : '';
  if (btnElem) {
    btnElem.innerHTML = `<i class="fa-solid fa-spinner fa-spin text-sky-400"></i>`;
    btnElem.disabled = true;
  }

  try {
    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ text: originalText, target: targetLang })
    });
    const data = await res.json();
    if (res.ok && data.translatedText) {
      translatedMsgsCache.set(cacheKey, data.translatedText);
      renderTranslationBox(container, translationBoxId, data.translatedText, targetLang);
    } else {
      alert('نەتوانرا تەرجومە بکرێت: ' + (data.error || 'هەڵەیەک ڕوویدا'));
    }
  } catch (err) {
    console.error('Translation error:', err);
  } finally {
    if (btnElem) {
      btnElem.innerHTML = originalBtnHtml;
      btnElem.disabled = false;
    }
  }
}

async function translateModelAnswer(questionId, btnElem) {
  const contentEl = document.getElementById(`model-answer-content-${questionId}`);
  if (!contentEl) return;
  const container = contentEl.parentElement || contentEl;

  const translationBoxId = `model-trans-${questionId}`;
  const existingBox = document.getElementById(translationBoxId);
  if (existingBox) {
    existingBox.classList.toggle('hidden');
    return;
  }

  const originalText = contentEl.innerText.trim();
  if (!originalText) return;

  const targetLang = (currentAppLanguage === 'ar' || currentAppLanguage === 'en') ? currentAppLanguage : 'ar';
  const cacheKey = `model_${questionId}_${targetLang}`;

  if (translatedMsgsCache.has(cacheKey)) {
    renderTranslationBox(container, translationBoxId, translatedMsgsCache.get(cacheKey), targetLang);
    return;
  }

  const originalBtnHtml = btnElem ? btnElem.innerHTML : '';
  if (btnElem) {
    btnElem.innerHTML = `<i class="fa-solid fa-spinner fa-spin text-emerald-300"></i>`;
    btnElem.disabled = true;
  }

  try {
    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ text: originalText, target: targetLang })
    });
    const data = await res.json();
    if (res.ok && data.translatedText) {
      translatedMsgsCache.set(cacheKey, data.translatedText);
      renderTranslationBox(container, translationBoxId, data.translatedText, targetLang);
    } else {
      alert('نەتوانرا تەرجومە بکرێت: ' + (data.error || 'هەڵەیەک ڕوویدا'));
    }
  } catch (err) {
    console.error('Translation error:', err);
  } finally {
    if (btnElem) {
      btnElem.innerHTML = originalBtnHtml;
      btnElem.disabled = false;
    }
  }
}

async function translateQuestionContent(questionId, btnElem) {
  const contentEl = document.getElementById(`question-content-${questionId}`);
  if (!contentEl) return;
  const container = contentEl.parentElement || contentEl;

  const translationBoxId = `q-trans-${questionId}`;
  const existingBox = document.getElementById(translationBoxId);
  if (existingBox) {
    existingBox.classList.toggle('hidden');
    return;
  }

  const originalText = contentEl.innerText.trim();
  if (!originalText) return;

  const targetLang = (currentAppLanguage === 'ar' || currentAppLanguage === 'en') ? currentAppLanguage : 'ar';
  const cacheKey = `q_${questionId}_${targetLang}`;

  if (translatedMsgsCache.has(cacheKey)) {
    renderTranslationBox(container, translationBoxId, translatedMsgsCache.get(cacheKey), targetLang);
    return;
  }

  const originalBtnHtml = btnElem ? btnElem.innerHTML : '';
  if (btnElem) {
    btnElem.innerHTML = `<i class="fa-solid fa-spinner fa-spin text-amber-300"></i>`;
    btnElem.disabled = true;
  }

  try {
    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ text: originalText, target: targetLang })
    });
    const data = await res.json();
    if (res.ok && data.translatedText) {
      translatedMsgsCache.set(cacheKey, data.translatedText);
      renderTranslationBox(container, translationBoxId, data.translatedText, targetLang);
    } else {
      alert('نەتوانرا تەرجومە بکرێت: ' + (data.error || 'هەڵەیەک ڕوویدا'));
    }
  } catch (err) {
    console.error('Translation error:', err);
  } finally {
    if (btnElem) {
      btnElem.innerHTML = originalBtnHtml;
      btnElem.disabled = false;
    }
  }
}

// =========================================================================
// 7. DRAWER SETTINGS & PREFERENCES (ڕێکخستن)
// =========================================================================
function toggleDrawerSettings() {
  const list = document.getElementById('drawerSettingsList');
  const chevron = document.getElementById('drawerSettingsChevron');
  if (!list) return;
  const isHidden = list.classList.contains('hidden');
  if (isHidden) {
    list.classList.remove('hidden');
    if (chevron) chevron.classList.add('rotate-180');
    localStorage.setItem('drawer_settings_collapsed', 'false');
  } else {
    list.classList.add('hidden');
    if (chevron) chevron.classList.remove('rotate-180');
    localStorage.setItem('drawer_settings_collapsed', 'true');
  }
}

function initDrawerSettingsState() {
  const isCollapsed = localStorage.getItem('drawer_settings_collapsed') === 'true';
  const list = document.getElementById('drawerSettingsList');
  const chevron = document.getElementById('drawerSettingsChevron');
  if (list && isCollapsed) {
    list.classList.add('hidden');
    if (chevron) chevron.classList.remove('rotate-180');
  } else if (list && !isCollapsed) {
    list.classList.remove('hidden');
    if (chevron) chevron.classList.add('rotate-180');
  }
}

function toggleDrawerLangPicker() {
  const opts = document.getElementById('drawerLangPickerOptions');
  const chevron = document.getElementById('drawerLangChevron');
  if (!opts) return;
  const isHidden = opts.classList.contains('hidden');
  if (isHidden) {
    opts.classList.remove('hidden');
    if (chevron) chevron.classList.add('rotate-180');
  } else {
    opts.classList.add('hidden');
    if (chevron) chevron.classList.remove('rotate-180');
  }
}

function toggleDrawerFontPicker() {
  const opts = document.getElementById('drawerFontPickerOptions');
  const chevron = document.getElementById('drawerFontChevron');
  if (!opts) return;
  const isHidden = opts.classList.contains('hidden');
  if (isHidden) {
    opts.classList.remove('hidden');
    if (chevron) chevron.classList.add('rotate-180');
  } else {
    opts.classList.add('hidden');
    if (chevron) chevron.classList.remove('rotate-180');
  }
}

let currentAppFontSize = localStorage.getItem('seereen_font_size') || 'normal';

function initAppFontSize() {
  setAppFontSize(currentAppFontSize);
}

function setAppFontSize(size) {
  currentAppFontSize = size;
  localStorage.setItem('seereen_font_size', size);
  document.documentElement.setAttribute('data-font-size', size);

  // Update button highlights in Drawer
  const sizes = ['small', 'normal', 'large', 'xl', 'xxl'];
  const labelsKu = {
    small: 'بچووک',
    normal: 'ئاسایی',
    large: 'گەورە',
    xl: 'گەورەتر',
    xxl: 'زۆر گەورە'
  };
  const labelsAr = {
    small: 'صغير',
    normal: 'عادي',
    large: 'كبير',
    xl: 'أكبر',
    xxl: 'كبير جداً'
  };
  const labelsEn = {
    small: 'Small',
    normal: 'Normal',
    large: 'Large',
    xl: 'X-Large',
    xxl: 'Huge'
  };

  sizes.forEach(s => {
    const btn = document.getElementById(`fontBtn_${s}`);
    if (btn) {
      if (s === size) {
        btn.className = 'py-1.5 rounded-xl bg-sky-600 text-slate-950 font-black transition active:scale-95 shadow text-center';
      } else {
        btn.className = 'py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition active:scale-95 text-center';
      }
    }
  });

  const badge = document.getElementById('drawerCurrentFontBadge');
  if (badge) {
    const dict = (currentAppLanguage === 'ar') ? labelsAr : ((currentAppLanguage === 'en') ? labelsEn : labelsKu);
    badge.innerText = dict[size] || 'ئاسایی';
  }
}

// =========================================================================
// 8. GROUP TAG MENTION ALERT (@هەموو, @هەمو, @1)
// =========================================================================
function handleMentionAllAlert(data) {
  if (!data) return;
  playSound('question');

  if (navigator.vibrate) {
    try { navigator.vibrate([200, 100, 200]); } catch (e) {}
  }

  // Display on-screen announcement toast
  const banner = document.createElement('div');
  banner.className = 'fixed top-3 left-1/2 -translate-x-1/2 z-[110] px-4 py-2.5 rounded-2xl bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-black text-xs shadow-2xl border-2 border-amber-300 flex items-center gap-2.5 transition-all transform duration-300 animate-bounce cursor-pointer';
  banner.onclick = () => banner.remove();
  banner.innerHTML = `
    <span class="text-base">📢</span>
    <div class="leading-tight">
      <span class="block text-[11px] font-black">${escapeHtml(data.sender_name)} (@هەمووان):</span>
      <span class="text-[10px] font-bold text-slate-900">${escapeHtml(data.content)}</span>
    </div>
  `;
  document.body.appendChild(banner);

  setTimeout(() => {
    banner.style.opacity = '0';
    setTimeout(() => banner.remove(), 400);
  }, 7000);

  // Send desktop notification if enabled
  if (window.Notification && Notification.permission === 'granted' && document.hidden) {
    try {
      new Notification(`📢 ${data.sender_name} (@هەمووان)`, {
        body: data.content,
        icon: '/logo.png'
      });
    } catch (e) {}
  }
}

// =========================================================================
// 9. LIVE RECORDINGS ARCHIVE CONTROLLER (تۆماری وانەکانی لایڤ - بێ چات)
// =========================================================================
function openLiveRecordingsModal() {
  const modal = document.getElementById('liveRecordingsModal');
  if (!modal) return;
  modal.classList.remove('hidden');
  loadLiveRecordings();
}

function closeLiveRecordingsModal() {
  const modal = document.getElementById('liveRecordingsModal');
  if (modal) modal.classList.add('hidden');
}

// --- RESUME LISTENING ENGINE FOR LESSONS & LIVE RECORDINGS ---
function initResumeLessonAudio(audioElem, storageKey) {
  if (!audioElem || !storageKey) return;
  const savedSecs = parseFloat(localStorage.getItem(storageKey) || '0');

  const applySavedTime = () => {
    if (savedSecs > 3 && (!audioElem.duration || savedSecs < audioElem.duration - 4)) {
      try {
        audioElem.currentTime = savedSecs;
      } catch (e) {}
    }
  };

  if (audioElem.readyState >= 1) {
    applySavedTime();
  } else {
    audioElem.addEventListener('loadedmetadata', applySavedTime, { once: true });
  }

  audioElem.addEventListener('play', () => {
    const curSaved = parseFloat(localStorage.getItem(storageKey) || '0');
    if (curSaved > 3 && audioElem.currentTime < 1) {
      try {
        audioElem.currentTime = curSaved;
      } catch (e) {}
    }
  });

  let lastSaved = 0;
  audioElem.addEventListener('timeupdate', () => {
    const cur = audioElem.currentTime;
    if (Math.abs(cur - lastSaved) >= 1.5) {
      lastSaved = cur;
      localStorage.setItem(storageKey, cur.toString());
      const badge = document.getElementById(`resume-badge-${audioElem.id}`);
      if (badge && cur > 3) {
        badge.classList.remove('hidden');
        const bText = badge.querySelector('b');
        if (bText) bText.innerText = formatAudioDuration(cur);
      }
    }
  });

  audioElem.addEventListener('pause', () => {
    if (audioElem.currentTime > 3) {
      localStorage.setItem(storageKey, audioElem.currentTime.toString());
    }
  });

  audioElem.addEventListener('ended', () => {
    localStorage.removeItem(storageKey);
    const badge = document.getElementById(`resume-badge-${audioElem.id}`);
    if (badge) badge.classList.add('hidden');
  });
}

function resetLessonAudioToStart(audioId, storageKey) {
  const audio = document.getElementById(audioId);
  if (audio) {
    audio.currentTime = 0;
    localStorage.removeItem(storageKey);
    const badge = document.getElementById(`resume-badge-${audioId}`);
    if (badge) badge.classList.add('hidden');
    showLiveToastNotification('وانەکە گەڕێندرایەوە بۆ سەرەتا ↺', 'indigo');
  }
}

async function loadLiveRecordings() {
  const container = document.getElementById('liveRecordingsListContainer');
  const countBadge = document.getElementById('liveRecordingsCountBadge');
  if (!container) return;
  container.innerHTML = '<div class="p-6 text-center text-slate-500 text-xs">لە بارکردندایە...</div>';

  try {
    const res = await fetch('/api/live-recordings', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok || !Array.isArray(data.recordings)) {
      container.innerHTML = '<div class="p-6 text-center text-rose-400 text-xs">نەتوانرا تۆمارەکان بهێنرێت</div>';
      return;
    }

    if (countBadge) countBadge.innerText = `${data.recordings.length} تۆمار`;

    if (data.recordings.length === 0) {
      container.innerHTML = `
        <div class="p-8 text-center text-slate-500 text-xs leading-relaxed">
          هیچ وانەیەکی لایڤ تۆمار نەکراوە.<br>
          کاتێک لە کاتی پەخشی ڕاستەوخۆ دوگمەی تۆمارکردن 🎙️ دابگریت و ڕایبگریت، بە شێوەیەکی ئۆتۆماتیکی لێرە ئەرشیڤ دەبێت.
        </div>
      `;
      return;
    }

    const isStaff = currentUser && (currentUser.role === 'teacher' || currentUser.role === 'super_admin');

    container.innerHTML = data.recordings.map(rec => {
      const createdTime = rec.created_at ? new Date(rec.created_at).toLocaleString('ku-IQ') : '';
      const editBtn = isStaff ? `
        <button type="button" onclick="editLiveRecordingTitle(${rec.id}, '${escapeHtml(rec.title)}', ${rec.recording_number})" class="p-1 text-slate-400 hover:text-amber-300 rounded-lg hover:bg-slate-800 transition" title="دەستکاریکردنی ناو و ژمارە">
          <i class="fa-solid fa-pen-to-square text-xs"></i>
        </button>
      ` : '';

      const deleteBtn = isStaff ? `
        <button type="button" onclick="deleteLiveRecording(${rec.id})" class="p-1 text-slate-400 hover:text-rose-400 rounded-lg hover:bg-slate-800 transition" title="سڕینەوە">
          <i class="fa-solid fa-trash text-xs"></i>
        </button>
      ` : '';

      const storageKey = `seereen_liverec_pos_${rec.id}`;
      const savedPos = parseFloat(localStorage.getItem(storageKey) || '0');
      const hasSavedPos = savedPos > 3;
      const resumeBadgeHtml = `
        <div id="resume-badge-liverec-audio-${rec.id}" class="${hasSavedPos ? '' : 'hidden '}flex items-center justify-between text-[11px] px-2.5 py-1 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-300 font-bold">
          <div class="flex items-center gap-1.5">
            <i class="fa-solid fa-clock-rotate-left"></i>
            <span>شوێنی وەستان: <b>${formatAudioDuration(savedPos)}</b> ⏱️</span>
          </div>
          <button type="button" onclick="resetLessonAudioToStart('liverec-audio-${rec.id}', '${storageKey}')" class="text-[10px] text-slate-400 hover:text-white underline hover:no-underline" title="دەستپێکردنەوە لە سەرەتاوە">
            لە سەرەتاوە ↺
          </button>
        </div>
      `;

      return `
        <div class="p-3.5 bg-slate-900/90 border border-slate-800 rounded-2xl space-y-2 shadow-sm">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="px-2 py-0.5 rounded-lg bg-rose-500/20 text-rose-300 font-mono font-bold text-xs border border-rose-500/30">
                #${rec.recording_number}
              </span>
              <h4 class="font-black text-xs sm:text-sm text-white">${escapeHtml(rec.title)}</h4>
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
              ${editBtn}
              ${deleteBtn}
            </div>
          </div>

          <div class="flex items-center justify-between text-[11px] text-slate-400">
            <span>تۆمارکراوە لەلایەن: <strong class="text-slate-300">${escapeHtml(rec.uploaded_by_name || 'مامۆستا')}</strong></span>
            <span class="font-mono text-[10px] text-slate-500">${createdTime}</span>
          </div>

          ${resumeBadgeHtml}

          <div class="pt-1 flex items-center gap-2">
            <audio id="liverec-audio-${rec.id}" controls src="${escapeHtml(rec.audio_url)}" class="flex-1 h-9 rounded-xl"></audio>
            <a href="${escapeHtml(rec.audio_url)}" download="${escapeHtml(rec.title)}.webm" class="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl text-xs flex items-center gap-1 shadow transition active:scale-95 shrink-0" title="داگرتنی فایل">
              <i class="fa-solid fa-download text-[11px]"></i>
              <span>داگرتن</span>
            </a>
          </div>
        </div>
      `;
    }).join('');

    // Attach resume listeners
    data.recordings.forEach(rec => {
      const audio = document.getElementById(`liverec-audio-${rec.id}`);
      if (audio) initResumeLessonAudio(audio, `seereen_liverec_pos_${rec.id}`);
    });
  } catch (err) {
    console.error('Error loading live recordings:', err);
    container.innerHTML = '<div class="p-6 text-center text-rose-400 text-xs">هەڵەیەک ڕوویدا</div>';
  }
}

async function editLiveRecordingTitle(id, currentTitle, currentNum) {
  const newTitle = prompt('ناوی نوێی ئەم وانەیە بنووسە:', currentTitle);
  if (newTitle === null) return;
  if (!newTitle.trim()) {
    alert('ناوی وانە نابێت بەتاڵ بێت');
    return;
  }

  const newNumStr = prompt('ژمارەی نوێی وانەکە (یان هەر وەک خۆی):', String(currentNum || 1));
  const newNum = parseInt(newNumStr) || currentNum;

  try {
    const res = await fetch(`/api/live-recordings/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ title: newTitle.trim(), recording_number: newNum })
    });
    if (res.ok) {
      loadLiveRecordings();
      showLiveToastNotification('ناوی وانەکە بە سەرکەوتوویی نوێکرایەوە ✏️', 'emerald');
    } else {
      alert('نەتوانرا ناوی وانە بگۆڕدرێت');
    }
  } catch (e) {
    alert('پەیوەندی ناتەواوە');
  }
}

async function deleteLiveRecording(id) {
  if (!confirm('ئایا دڵنیایت لە سڕینەوەی ئەم تۆمارەی لایڤ؟')) return;
  try {
    const res = await fetch(`/api/live-recordings/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      loadLiveRecordings();
      showLiveToastNotification('تۆمارەکە سڕایەوە 🗑️', 'amber');
    }
  } catch (e) {
    alert('پەیوەندی ناتەواوە');
  }
}

// =========================================================================
// 10. RECORDED LESSONS FOR STUDENTS (وانە تۆمارکراوەکان - بێ داونلۆد)
// =========================================================================
let lessonAudioFileBlob = null;
let lessonMediaRecorder = null;
let lessonAudioChunks = [];
let lessonRecordTimerInterval = null;
let lessonRecordSeconds = 0;
let lessonAudioStream = null;

function openRecordedLessonsModal() {
  const modal = document.getElementById('recordedLessonsModal');
  if (!modal) return;
  modal.classList.remove('hidden');

  const staffBox = document.getElementById('addRecordedLessonStaffBox');
  if (staffBox) {
    if (currentUser && (currentUser.role === 'teacher' || currentUser.role === 'super_admin')) {
      staffBox.classList.remove('hidden');
    } else {
      staffBox.classList.add('hidden');
    }
  }

  loadRecordedLessons();
}

function closeRecordedLessonsModal() {
  const modal = document.getElementById('recordedLessonsModal');
  if (modal) modal.classList.add('hidden');
}

function toggleAddLessonForm() {
  const form = document.getElementById('addLessonForm');
  const btn = document.getElementById('toggleAddLessonBtn');
  if (!form) return;
  if (form.classList.contains('hidden')) {
    form.classList.remove('hidden');
    if (btn) btn.innerText = '✕ داخستنی فۆرم';
  } else {
    form.classList.add('hidden');
    if (btn) btn.innerText = '+ زیادکردنی وانە';
  }
}

function handleLessonAudioSelected(input) {
  const label = document.getElementById('lessonAudioSelectLabel');
  if (input && input.files && input.files[0]) {
    lessonAudioFileBlob = input.files[0];
    if (label) label.innerText = `فایل: ${input.files[0].name.slice(0, 15)}...`;
  }
}

async function toggleLessonVoiceRecord() {
  if (lessonMediaRecorder && lessonMediaRecorder.state === 'recording') {
    // Stop recording
    if (lessonRecordTimerInterval) clearInterval(lessonRecordTimerInterval);
    const timerBar = document.getElementById('lessonRecordTimerBar');
    if (timerBar) timerBar.classList.add('hidden');

    const label = document.getElementById('lessonRecordLabel');
    if (label) label.innerText = 'تۆمارکردن بە مایک';

    lessonMediaRecorder.onstop = () => {
      const mimeType = lessonMediaRecorder.mimeType || 'audio/webm';
      lessonAudioFileBlob = new Blob(lessonAudioChunks, { type: mimeType });
      const selLabel = document.getElementById('lessonAudioSelectLabel');
      if (selLabel) selLabel.innerText = `دەنگ تۆمارکرا (${lessonRecordSeconds} چـ)`;
      if (lessonAudioStream) {
        lessonAudioStream.getTracks().forEach(t => t.stop());
        lessonAudioStream = null;
      }
      lessonMediaRecorder = null;
    };
    lessonMediaRecorder.stop();
    return;
  }

  try {
    lessonAudioStream = await getStudioQualityAudioStream();
    lessonAudioChunks = [];
    lessonRecordSeconds = 0;

    let mimeType = '';
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported) {
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) mimeType = 'audio/webm;codecs=opus';
      else if (MediaRecorder.isTypeSupported('audio/webm')) mimeType = 'audio/webm';
      else if (MediaRecorder.isTypeSupported('audio/mp4')) mimeType = 'audio/mp4';
      else if (MediaRecorder.isTypeSupported('audio/ogg')) mimeType = 'audio/ogg';
    }
    const options = mimeType ? { mimeType } : {};
    lessonMediaRecorder = new MediaRecorder(lessonAudioStream, options);

    lessonMediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) lessonAudioChunks.push(e.data);
    };

    lessonMediaRecorder.start(250);

    const timerBar = document.getElementById('lessonRecordTimerBar');
    const timerText = document.getElementById('lessonRecordTimer');
    const label = document.getElementById('lessonRecordLabel');
    if (timerBar) timerBar.classList.remove('hidden');
    if (label) label.innerText = 'ڕاگرتن و پاشەکەوت ⏹️';

    if (lessonRecordTimerInterval) clearInterval(lessonRecordTimerInterval);
    lessonRecordTimerInterval = setInterval(() => {
      lessonRecordSeconds++;
      const mins = String(Math.floor(lessonRecordSeconds / 60)).padStart(2, '0');
      const secs = String(lessonRecordSeconds % 60).padStart(2, '0');
      if (timerText) timerText.innerText = `${mins}:${secs}`;
    }, 1000);
  } catch (err) {
    console.error('Lesson voice record error:', err);
    alert('ڕێگەپێدانی مایکرۆفۆن ڕەتکرایەوە یان مایکرۆفۆن بەردەست نییە.');
  }
}

async function submitNewRecordedLesson() {
  const titleInput = document.getElementById('newLessonTitleInput');
  const numInput = document.getElementById('newLessonNumberInput');
  const descInput = document.getElementById('newLessonDescInput');

  const title = titleInput ? titleInput.value.trim() : '';
  const lessonNumber = numInput ? numInput.value.trim() : '';
  const description = descInput ? descInput.value.trim() : '';

  if (!title) {
    alert('تکایە ناوی وانە بنووسە');
    return;
  }

  if (!lessonAudioFileBlob) {
    alert('تکایە سەرەتا فایلی دەنگ هەڵبژێرە یان بە مایک تۆماری بکە');
    return;
  }

  const formData = new FormData();
  formData.append('title', title);
  if (lessonNumber) formData.append('lesson_number', lessonNumber);
  if (description) formData.append('description', description);
  formData.append('audio', lessonAudioFileBlob, `lesson_${Date.now()}.webm`);

  try {
    showLiveToastNotification('وانەکە لە بڵاوکردنەوەدایە... 🎙️', 'emerald');
    const res = await fetch('/api/recorded-lessons/upload', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showLiveToastNotification('وانەکە بە سەرکەوتوویی بڵاوکرایەوە! 🎉', 'emerald');
      // Reset form
      if (titleInput) titleInput.value = '';
      if (numInput) numInput.value = '';
      if (descInput) descInput.value = '';
      lessonAudioFileBlob = null;
      const fileInput = document.getElementById('newLessonAudioFileInput');
      if (fileInput) fileInput.value = '';
      const label = document.getElementById('lessonAudioSelectLabel');
      if (label) label.innerText = 'هەڵبژاردنی فایلی دەنگ';
      toggleAddLessonForm();
      loadRecordedLessons();
    } else {
      alert(data.error || 'نەتوانرا وانەکە باربکرێت');
    }
  } catch (err) {
    console.error('Submit recorded lesson error:', err);
    alert('هەڵەیەک ڕوویدا لە بارکردنی وانەدا');
  }
}

async function loadRecordedLessons() {
  const container = document.getElementById('recordedLessonsListContainer');
  if (!container) return;
  container.innerHTML = '<div class="p-6 text-center text-slate-500 text-xs">لە بارکردندایە...</div>';

  try {
    const res = await fetch('/api/recorded-lessons', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok || !Array.isArray(data.lessons)) {
      container.innerHTML = '<div class="p-6 text-center text-rose-400 text-xs">نەتوانرا وانەکان بهێنرێت</div>';
      return;
    }

    if (data.lessons.length === 0) {
      container.innerHTML = `
        <div class="p-8 text-center text-slate-500 text-xs leading-relaxed">
          هیچ وانەیەکی تۆمارکراو بەردەست نییە.<br>
          کاتێک مامۆستا یان سوپەر ئەدمین وانەی دەنگی دابنێن، لێرەدا دەتوانیت گوێیان لێ بگریت.
        </div>
      `;
      return;
    }

    const isStaff = currentUser && (currentUser.role === 'teacher' || currentUser.role === 'super_admin');

    container.innerHTML = data.lessons.map(lesson => {
      const createdTime = lesson.created_at ? new Date(lesson.created_at).toLocaleDateString('ku-IQ') : '';
      const deleteBtn = isStaff ? `
        <button type="button" onclick="deleteRecordedLesson(${lesson.id})" class="p-1 text-slate-400 hover:text-rose-400 rounded-lg hover:bg-slate-800 transition" title="سڕینەوە">
          <i class="fa-solid fa-trash text-xs"></i>
        </button>
      ` : '';

      const storageKey = `seereen_lesson_pos_${lesson.id}`;
      const savedPos = parseFloat(localStorage.getItem(storageKey) || '0');
      const hasSavedPos = savedPos > 3;
      const resumeBadgeHtml = `
        <div id="resume-badge-lesson-audio-${lesson.id}" class="${hasSavedPos ? '' : 'hidden '}flex items-center justify-between text-[11px] px-2.5 py-1 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-300 font-bold">
          <div class="flex items-center gap-1.5">
            <i class="fa-solid fa-clock-rotate-left"></i>
            <span>شوێنی وەستان: <b>${formatAudioDuration(savedPos)}</b> ⏱️</span>
          </div>
          <button type="button" onclick="resetLessonAudioToStart('lesson-audio-${lesson.id}', '${storageKey}')" class="text-[10px] text-slate-400 hover:text-white underline hover:no-underline" title="دەستپێکردنەوە لە سەرەتاوە">
            لە سەرەتاوە ↺
          </button>
        </div>
      `;

      return `
        <div class="p-3.5 bg-slate-900/90 border border-slate-800 rounded-2xl space-y-2.5 shadow-sm">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="px-2 py-0.5 rounded-lg bg-emerald-500/20 text-emerald-300 font-mono font-bold text-xs border border-emerald-500/30">
                #${lesson.lesson_number}
              </span>
              <h4 class="font-black text-xs sm:text-sm text-white">${escapeHtml(lesson.title)}</h4>
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
              ${deleteBtn}
            </div>
          </div>

          ${lesson.description ? `
            <p class="text-xs text-slate-300 leading-relaxed bg-slate-950/40 p-2.5 rounded-xl border border-slate-800/80">
              ${escapeHtml(lesson.description)}
            </p>
          ` : ''}

          <div class="flex items-center justify-between text-[11px] text-slate-400">
            <span>مامۆستا: <strong class="text-amber-300">${escapeHtml(lesson.instructor_name || 'مامۆستا')}</strong></span>
            <span class="font-mono text-[10px] text-slate-500">${createdTime}</span>
          </div>

          ${resumeBadgeHtml}

          <!-- Audio Player Protected from Download (داونلۆد بە تەواوی قەدەغەیە) -->
          <div class="pt-1">
            <audio id="lesson-audio-${lesson.id}" controls controlsList="nodownload" oncontextmenu="return false;" src="${escapeHtml(lesson.audio_url)}" class="w-full h-9 rounded-xl"></audio>
          </div>
        </div>
      `;
    }).join('');

    // Attach resume listeners
    data.lessons.forEach(lesson => {
      const audio = document.getElementById(`lesson-audio-${lesson.id}`);
      if (audio) initResumeLessonAudio(audio, `seereen_lesson_pos_${lesson.id}`);
    });
  } catch (err) {
    console.error('Error loading recorded lessons:', err);
    container.innerHTML = '<div class="p-6 text-center text-rose-400 text-xs">هەڵەیەک ڕوویدا</div>';
  }
}

async function deleteRecordedLesson(id) {
  if (!confirm('ئایا دڵنیایت لە سڕینەوەی ئەم وانەیە؟')) return;
  try {
    const res = await fetch(`/api/recorded-lessons/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      loadRecordedLessons();
      showLiveToastNotification('وانەکە سڕایەوە 🗑️', 'amber');
    }
  } catch (e) {
    alert('پەیوەندی ناتەواوە');
  }
}

// --- AUTO-SAVE CHAT SCROLL / LAST READ ON APP EXIT OR TAB SWITCH ---
window.addEventListener('beforeunload', () => {
  try {
    if (currentUser && token) {
      const lastVisible = (typeof getVisibleMessageIdForRestore === 'function') 
        ? getVisibleMessageIdForRestore() 
        : ((typeof getHighestVisibleMessageId === 'function') ? getHighestVisibleMessageId() : 0);
      if (lastVisible > 0) {
        setLocalLastReadMessageId(currentUser.id, lastVisible);
        fetch('/api/chat/last-read', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ message_id: lastVisible }),
          keepalive: true
        }).catch(() => {});
      }
    }
  } catch (e) {}
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && currentUser && token) {
    try {
      const lastVisible = (typeof getVisibleMessageIdForRestore === 'function') 
        ? getVisibleMessageIdForRestore() 
        : ((typeof getHighestVisibleMessageId === 'function') ? getHighestVisibleMessageId() : 0);
      if (lastVisible > 0) {
        syncLastReadMessageWithServer(lastVisible, true);
      }
    } catch (e) {}
  }
});

// =========================================================================
// AI SECURITY COMMAND CENTER & RED ALERT LOCKDOWN (SUPER ADMIN ONLY)
// =========================================================================
let isRedAlertActiveGlobal = false;

function openAiSecurityModal() {
  const modal = document.getElementById('aiSecurityModal');
  if (!modal) return;
  modal.classList.remove('hidden');
  loadAiSecurityStats();
}

function closeAiSecurityModal() {
  const modal = document.getElementById('aiSecurityModal');
  if (modal) modal.classList.add('hidden');
}

async function loadAiSecurityStats() {
  if (!currentUser || (!hasSuperAdminPrivileges(currentUser) && currentUser.role !== 'super_admin')) return;
  try {
    const res = await fetch('/api/admin/security/stats', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return;
    const data = await res.json();
    if (!data.success) return;

    isRedAlertActiveGlobal = !!data.isRedAlertActive;
    updateRedAlertUIState({ active: isRedAlertActiveGlobal });

    const stats = data.stats || {};
    const totalThreats = Number(stats.total_incidents ?? stats.totalBlocked ?? 0);

    const badWords = Number(stats.bad_words ?? stats.badWords ?? 0);
    const nsfw = Number(stats.nsfw_images ?? stats.nsfw ?? 0);
    const floods = Number(stats.flood_raids ?? stats.flood ?? 0);
    const links = Number(stats.malicious_links ?? stats.links ?? 0);
    const frauds = Number(stats.star_frauds ?? stats.starFraud ?? 0) + Number(stats.harassments ?? stats.harassment ?? 0);

    const badWordEl = document.getElementById('aiSecBadWordVal');
    if (badWordEl) badWordEl.innerText = `${badWords} ڕەتکراوە`;

    const nsfwEl = document.getElementById('aiSecNsfwVal');
    if (nsfwEl) nsfwEl.innerText = `${nsfw} ڕەتکراوە`;

    const floodEl = document.getElementById('aiSecFloodVal');
    if (floodEl) floodEl.innerText = `${floods} بێدەنگکراو`;

    const linksEl = document.getElementById('aiSecLinksVal');
    if (linksEl) linksEl.innerText = `${links} تێکشکێنراو`;

    const fraudEl = document.getElementById('aiSecFraudVal');
    if (fraudEl) fraudEl.innerText = `${frauds} تۆمار`;

    // Dynamic safety rating
    const safetyRate = stats.safetyRating || (totalThreats === 0 ? '100%' : `${Math.max(94.5, 100 - (totalThreats * 0.15)).toFixed(1)}%`);
    const ratingEl = document.getElementById('aiSecRatingVal');
    if (ratingEl) ratingEl.innerText = safetyRate;

    // Render Recent Incidents Feed
    const listEl = document.getElementById('aiSecIncidentsList');
    const badgeEl = document.getElementById('aiSecIncidentCountBadge');
    if (badgeEl) badgeEl.innerText = `${(data.recent || []).length} ڕووداو`;

    if (listEl) {
      if (!data.recent || data.recent.length === 0) {
        listEl.innerHTML = `
          <div class="text-center py-8 text-slate-500">
            <i class="fa-solid fa-shield-check text-3xl text-emerald-500/60 mb-2"></i>
            <p class="text-xs font-bold text-slate-400">هیچ ڕووداوێکی مەترسیدار تۆمار نەکراوە - سیستم بە تەواوی ئارامە ✅</p>
          </div>
        `;
      } else {
        listEl.innerHTML = data.recent.map(inc => {
          const typeMap = {
            bad_word: { label: 'دەقی فێڵاوی (NLP)', color: 'bg-purple-900/50 text-purple-300 border-purple-500/40', icon: 'fa-spell-check' },
            nsfw_image: { label: 'وێنەی نەشیاو (NSFW)', color: 'bg-pink-900/50 text-pink-300 border-pink-500/40', icon: 'fa-eye-slash' },
            flood_raid: { label: 'هێرشی لافاو (Flood)', color: 'bg-amber-900/50 text-amber-300 border-amber-500/40', icon: 'fa-bolt' },
            flood_attack: { label: 'هێرشی لافاو (Flood)', color: 'bg-amber-900/50 text-amber-300 border-amber-500/40', icon: 'fa-bolt' },
            malicious_link: { label: 'لینکی زیانبەخش', color: 'bg-cyan-900/50 text-cyan-300 border-cyan-500/40', icon: 'fa-link-slash' },
            star_fraud: { label: 'فێڵی ئەستێرە', color: 'bg-indigo-900/50 text-indigo-300 border-indigo-500/40', icon: 'fa-star' },
            harassment: { label: 'هەراسانکاری / ژمارە', color: 'bg-rose-900/50 text-rose-300 border-rose-500/40', icon: 'fa-phone-slash' },
            impersonation: { label: 'خۆکردن بە ئەدمین', color: 'bg-red-900/50 text-red-300 border-red-500/40', icon: 'fa-user-ninja' },
            red_alert: { label: 'قەڵغانی پۆڵایین', color: 'bg-rose-900/70 text-rose-200 border-rose-500/50', icon: 'fa-bullhorn' }
          };
          const tInfo = typeMap[inc.incident_type] || { label: inc.incident_type, color: 'bg-slate-800 text-slate-300 border-slate-700', icon: 'fa-shield' };
          const actionMap = {
            blocked: 'بلۆککرا (Blocked)',
            auto_muted: 'بێدەنگکراوە',
            auto_muted_60s: 'بێدەنگکرا بۆ ٦٠ چرکە',
            auto_muted_300s: 'بێدەنگکرا بۆ ٥ خولەک',
            red_alert_active: 'بارودۆخی نائاسایی کارابوو',
            red_alert_disabled: 'بارودۆخی نائاسایی کۆتایی هات'
          };
          const actLabel = actionMap[inc.action_taken] || inc.action_taken || 'ڕێگری لێکرا';
          const timeStr = new Date(inc.created_at).toLocaleTimeString('ku-IQ', { hour: '2-digit', minute: '2-digit' });

          return `
            <div class="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center justify-between gap-3 text-xs hover:border-slate-700 transition">
              <div class="flex items-center gap-2.5 min-w-0">
                <span class="px-2 py-0.5 rounded-lg border text-[10px] font-bold flex items-center gap-1 shrink-0 ${tInfo.color}">
                  <i class="fa-solid ${tInfo.icon}"></i>
                  <span>${tInfo.label}</span>
                </span>
                <div class="min-w-0">
                  <p class="font-bold text-white truncate text-[11px]">${escapeHtml(inc.user_name || 'نەناسراو')}</p>
                  <p class="text-[10px] text-slate-400 truncate">${escapeHtml(inc.details || '')}</p>
                </div>
              </div>
              <div class="text-left shrink-0">
                <span class="px-1.5 py-0.5 rounded bg-slate-800 text-[9px] text-emerald-400 font-bold block">${actLabel}</span>
                <span class="text-[9px] text-slate-500">${timeStr}</span>
              </div>
            </div>
          `;
        }).join('');
      }
    }
  } catch (err) {
    console.error('Failed to load AI security stats:', err);
  }
}

async function toggleRedAlertLockdown() {
  if (!currentUser || (!hasSuperAdminPrivileges(currentUser) && currentUser.role !== 'super_admin')) return;
  const newActive = !isRedAlertActiveGlobal;
  const confirmMsg = newActive 
    ? '🚨 ئایا دڵنیایت لە چالاککردنی قەڵغانی پۆڵایین (Red Alert Lockdown)؟\nچاتی گشتی دەستبەجێ قفڵ دەبێت و تەنها سوپەر ئەدمین و مامۆستایان دەتوانن بنووسن.'
    : 'ئایا دڵنیایت لە ناچالاککردنەوەی قەڵغانی پۆڵایین؟ چات ئاسایی دەبێتەوە.';
  
  if (!confirm(confirmMsg)) return;

  try {
    const res = await fetch('/api/admin/security/red-alert', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ active: newActive })
    });
    const data = await res.json();
    if (data.success) {
      isRedAlertActiveGlobal = !!data.isRedAlertActive;
      updateRedAlertUIState({ active: isRedAlertActiveGlobal });
      loadAiSecurityStats();
    } else {
      alert('نەتوانرا گۆڕانکاری بکرێت: ' + (data.error || 'هەڵەیەک ڕوویدا'));
    }
  } catch (err) {
    alert('هەڵەی پەیوەندی بە سێرڤەرەوە');
  }
}

function updateRedAlertUIState(data) {
  const active = !!(data && data.active);
  const badge = document.getElementById('aiSecurityLockdownStatusBadge');
  const btn = document.getElementById('aiSecurityRedAlertBtn');
  const btnText = document.getElementById('aiSecurityRedAlertBtnText');

  if (badge) {
    if (active) {
      badge.className = 'px-2.5 py-0.5 rounded-full text-[11px] font-black bg-rose-500 text-white animate-pulse shadow';
      badge.innerText = '🚨 قەڵغانی پۆڵایین کارایە!';
    } else {
      badge.className = 'px-2.5 py-0.5 rounded-full text-[11px] font-black bg-emerald-500/20 text-emerald-300 border border-emerald-500/40';
      badge.innerText = 'سیستم ئاساییە';
    }
  }

  if (btn) {
    if (active) {
      btn.className = 'px-4 py-2.5 rounded-xl font-black text-xs sm:text-sm transition flex items-center gap-2 shadow-lg active:scale-95 shrink-0 bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-400';
      if (btnText) btnText.innerText = 'ناچالاککردنەوەی قەڵغان (گەڕانەوە بۆ دۆخی ئاسایی)';
    } else {
      btn.className = 'px-4 py-2.5 rounded-xl font-black text-xs sm:text-sm transition flex items-center gap-2 shadow-lg active:scale-95 shrink-0 bg-rose-600 hover:bg-rose-500 text-white border border-rose-400';
      if (btnText) btnText.innerText = 'چالاککردنی قەڵغانی پۆڵایین';
    }
  }
}

async function clearAiSecurityIncidents() {
  if (!currentUser || (!hasSuperAdminPrivileges(currentUser) && currentUser.role !== 'super_admin')) return;
  if (!confirm('ئایا دڵنیایت لە سڕینەوە و پاککردنەوەی هەموو تۆمارەکانی ئاسایش؟')) return;

  try {
    const res = await fetch('/api/admin/security/clear-incidents', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });
    const data = await res.json();
    if (data.success) {
      loadAiSecurityStats();
    } else {
      alert(data.error || 'نەتوانرا تۆمارەکان پاکبکرێتەوە');
    }
  } catch (err) {
    alert('هەڵەی پەیوەندی بە سێرڤەرەوە');
  }
}

function showSecurityIncidentToast(incident) {
  if (!incident) return;
  const toast = document.createElement('div');
  toast.className = 'fixed bottom-20 left-4 right-4 sm:left-auto sm:right-6 sm:w-96 z-50 p-3 bg-rose-950/95 border border-rose-500/60 rounded-2xl shadow-2xl flex items-center gap-3 text-white text-xs animate-bounce';
  toast.innerHTML = `
    <div class="w-8 h-8 rounded-xl bg-rose-600 text-white flex items-center justify-center shrink-0">
      <i class="fa-solid fa-shield-halved text-sm"></i>
    </div>
    <div class="min-w-0 flex-1">
      <p class="font-black text-rose-200">ئاگاداری پاسەوانی AI 🛡️</p>
      <p class="text-[11px] text-slate-200 truncate">${escapeHtml(incident.details || incident.message || incident.user_name || incident.userName || 'هەڕەشەیەک ڕەتکرایەوە')}</p>
    </div>
    <button onclick="this.parentElement.remove(); openAiSecurityModal();" class="px-2 py-1 bg-rose-800 hover:bg-rose-700 text-[10px] font-bold rounded-lg shrink-0">بینین</button>
  `;
  document.body.appendChild(toast);
  setTimeout(() => {
    try { toast.remove(); } catch (e) {}
  }, 6000);
}

// =========================================================================
// AI ADVISOR & COMPANION FOR MASTER SUPER ADMIN (ڕاوێژکاری زیرەکی هێمن)
// =========================================================================

let advisorTelemetryCache = null;
let isAdvisorTyping = false;

function openAiAdvisorModal() {
  const hasAccess = isMasterSuperAdmin(currentUser) || hasSuperAdminPrivileges(currentUser) || hasUserBadge(currentUser, 'white');
  if (!hasAccess) {
    alert('ئەم بەشە تەنها بۆ کاک هێمن، سوپەر ئەدمین یان هەڵگرانی باجی سپی ڕێگەپێدراوە.');
    return;
  }
  const modal = document.getElementById('aiAdvisorModal');
  if (!modal) return;
  const titleEl = document.getElementById('advisorModalTitle');
  if (titleEl) {
    titleEl.innerText = isMasterSuperAdmin(currentUser) ? 'ڕاوێژکاری زیرەکی هێمن' : 'ڕاوێژکاری زیرەکی سیرین';
  }
  modal.classList.remove('hidden');
  switchAdvisorTab('scanner');
  loadAdvisorOverview();
  loadAdvisorChatHistory();
  checkAdvisorGeminiStatus();
}

function closeAiAdvisorModal() {
  const modal = document.getElementById('aiAdvisorModal');
  if (modal) modal.classList.add('hidden');
  const overlay = document.getElementById('advisorSettingsOverlay');
  if (overlay) overlay.classList.add('hidden');
}

function switchAdvisorTab(tab) {
  const scannerTab = document.getElementById('advisorTabScanner');
  const chatTab = document.getElementById('advisorTabChat');
  const btnScanner = document.getElementById('advisorTabBtnScanner');
  const btnChat = document.getElementById('advisorTabBtnChat');

  if (tab === 'scanner') {
    if (scannerTab) scannerTab.classList.remove('hidden');
    if (chatTab) chatTab.classList.add('hidden');
    if (btnScanner) {
      btnScanner.className = 'py-2.5 px-3 text-xs sm:text-sm font-black border-b-2 border-purple-400 text-purple-300 flex items-center gap-2 transition';
    }
    if (btnChat) {
      btnChat.className = 'py-2.5 px-3 text-xs sm:text-sm font-bold border-b-2 border-transparent text-slate-400 hover:text-purple-300 flex items-center gap-2 transition';
    }
  } else if (tab === 'chat') {
    if (scannerTab) scannerTab.classList.add('hidden');
    if (chatTab) chatTab.classList.remove('hidden');
    if (btnScanner) {
      btnScanner.className = 'py-2.5 px-3 text-xs sm:text-sm font-bold border-b-2 border-transparent text-slate-400 hover:text-purple-300 flex items-center gap-2 transition';
    }
    if (btnChat) {
      btnChat.className = 'py-2.5 px-3 text-xs sm:text-sm font-black border-b-2 border-purple-400 text-purple-300 flex items-center gap-2 transition';
    }
    const container = document.getElementById('advisorChatMessages');
    if (container) container.scrollTop = container.scrollHeight;
    const input = document.getElementById('advisorChatInput');
    if (input) setTimeout(() => input.focus(), 100);
  }
}

async function loadAdvisorOverview() {
  const refreshBtn = document.getElementById('advisorRefreshBtn');
  if (refreshBtn) {
    const icon = refreshBtn.querySelector('i');
    if (icon) icon.classList.add('fa-spin');
  }

  try {
    const res = await fetch('/api/advisor/overview', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('Failed to fetch advisor overview');
    const data = await res.json();
    if (!data.success || !data.data) return;

    advisorTelemetryCache = data.data.telemetry;
    const t = data.data.telemetry;

    // Update Live Cards
    const elOnline = document.getElementById('advStatOnline');
    if (elOnline) elOnline.innerText = t.onlineCount || 0;

    const elTotalUsers = document.getElementById('advStatTotalUsers');
    if (elTotalUsers) elTotalUsers.innerText = t.totalUsers || 0;

    const elPending = document.getElementById('advStatPendingWrap');
    if (elPending) {
      elPending.innerText = t.pendingUsers > 0 ? `${t.pendingUsers} چاوەڕوان` : 'بێ چاوەڕوان';
      elPending.className = t.pendingUsers > 0 ? 'text-amber-400 font-bold' : 'text-slate-400 font-normal';
    }

    const elPurpleBadge = document.getElementById('advStatPurpleBadgeCount');
    if (elPurpleBadge) {
      const pCount = t.purpleBadgeHolders?.length || 0;
      elPurpleBadge.innerText = `${pCount} باجی مۆر`;
    }

    const elUnansweredDreams = document.getElementById('advStatUnansweredDreams');
    if (elUnansweredDreams) elUnansweredDreams.innerText = t.unansweredDreams || 0;

    const elTotalDreams = document.getElementById('advStatTotalDreams');
    if (elTotalDreams) elTotalDreams.innerText = t.totalDreams || 0;

    const elFavDreams = document.getElementById('advStatFavDreams');
    if (elFavDreams) elFavDreams.innerText = t.favoriteDreams || 0;

    const elLiveBadge = document.getElementById('advStatLiveBadge');
    if (elLiveBadge) {
      elLiveBadge.innerText = t.isLive ? 'چالاک 🔴' : 'ناچالاک';
      elLiveBadge.className = t.isLive
        ? 'text-[9px] px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse font-bold'
        : 'text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400';
    }

    const elLiveViewers = document.getElementById('advStatLiveViewers');
    if (elLiveViewers) elLiveViewers.innerText = t.liveViewers || 0;

    const elLiveHost = document.getElementById('advStatLiveHost');
    if (elLiveHost) {
      elLiveHost.innerText = t.isLive ? `وانەبێژ: ${t.liveStartedBy || 'مامۆستا'}` : 'دەستپێنەکراوە';
    }

    const elSafety = document.getElementById('advStatSafetyRating');
    if (elSafety) elSafety.innerText = t.secStats?.safetyRating || '100%';

    const elBlocked = document.getElementById('advStatBlockedThreats');
    if (elBlocked) elBlocked.innerText = t.secStats?.totalBlocked || 0;

    const elChatLock = document.getElementById('advStatChatLockMode');
    if (elChatLock) {
      elChatLock.innerText = t.chatLockMode === 'unlocked' ? 'کراوە' : 'داخراو';
      elChatLock.className = t.chatLockMode === 'unlocked' ? 'text-emerald-400' : 'text-rose-400 font-bold';
    }

    const elRedAlert = document.getElementById('advStatRedAlertTag');
    if (elRedAlert) {
      elRedAlert.innerText = t.isRedAlert ? 'Red Alert ⚠️' : 'پارێزراو';
      elRedAlert.className = t.isRedAlert ? 'text-rose-400 font-bold animate-pulse' : 'text-emerald-400';
    }

    // Update Action Button (@دوگمە) Card in Advisor
    const btnReport = t.latest_button_report;
    const btnCard = document.getElementById('advActionButtonCard');
    if (btnCard) {
      if (btnReport && btnReport.message) {
        btnCard.classList.remove('hidden');
        const msgEl = document.getElementById('advBtnMsgText');
        if (msgEl) msgEl.innerText = btnReport.message.content;
        const clickedEl = document.getElementById('advBtnClickedCount');
        if (clickedEl) clickedEl.innerText = btnReport.clicked_count || 0;
        const unclickedEl = document.getElementById('advBtnUnclickedCount');
        if (unclickedEl) unclickedEl.innerText = btnReport.unclicked_count || 0;
      } else {
        const msgEl = document.getElementById('advBtnMsgText');
        if (msgEl) msgEl.innerText = 'هێشتا هیچ پەیامێکی دوگمە (@دوگمە) دانەنراوە';
        const clickedEl = document.getElementById('advBtnClickedCount');
        if (clickedEl) clickedEl.innerText = '0';
        const unclickedEl = document.getElementById('advBtnUnclickedCount');
        if (unclickedEl) unclickedEl.innerText = '0';
      }
    }

    // Render suggestions
    const badgeCount = document.getElementById('advisorSuggestionsCountBadge');
    if (badgeCount) badgeCount.innerText = (data.data.suggestions || []).length;

    renderAdvisorSuggestions(data.data.suggestions || []);

    // Render Live Streams Audit Logs
    renderAdvisorLiveAudit(t.liveAuditLogs || []);

    const scanTime = document.getElementById('advLastScanTime');
    if (scanTime) {
      const now = new Date();
      scanTime.innerText = `دواین پشکنین: ${now.toLocaleTimeString('ckb', { hour: '2-digit', minute: '2-digit' })}`;
    }
  } catch (err) {
    console.error('Advisor overview error:', err);
  } finally {
    if (refreshBtn) {
      const icon = refreshBtn.querySelector('i');
      if (icon) setTimeout(() => icon.classList.remove('fa-spin'), 600);
    }
  }
}

function renderAdvisorSuggestions(suggestions) {
  const container = document.getElementById('advisorSuggestionsList');
  if (!container) return;

  if (!suggestions || suggestions.length === 0) {
    container.innerHTML = `
      <div class="text-center py-6 text-slate-500 text-xs">
        <i class="fa-solid fa-circle-check text-emerald-400 text-2xl mb-1.5"></i>
        <p class="font-bold text-slate-300">هەموو بەشەکانی پلاتفۆرم بە تەواوی ڕێکوپێکن و هیچ کێشەیەک نییە ✅</p>
      </div>
    `;
    return;
  }

  const priorityStyles = {
    high: {
      border: 'border-rose-500/40',
      bg: 'bg-rose-950/20',
      tagBg: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
      tagText: 'پڕبایەخ ⚠️'
    },
    medium: {
      border: 'border-amber-500/30',
      bg: 'bg-amber-950/15',
      tagBg: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
      tagText: 'مامناوەند ⚡'
    },
    low: {
      border: 'border-emerald-500/30',
      bg: 'bg-emerald-950/15',
      tagBg: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
      tagText: 'ئاسایی / هەواڵی باش 💡'
    }
  };

  container.innerHTML = suggestions.map(s => {
    const style = priorityStyles[s.priority] || priorityStyles.low;
    let actionBtnHtml = '';
    if (s.action && s.actionText) {
      actionBtnHtml = `
        <button onclick="handleAdvisorAction('${s.action}')" class="px-3 py-1.5 bg-purple-600/30 hover:bg-purple-600 text-purple-200 hover:text-white border border-purple-500/40 rounded-xl text-xs font-bold transition flex items-center gap-1.5 active:scale-95 shrink-0 shadow-sm">
          <span>${escapeHtml(s.actionText)}</span>
          <i class="fa-solid fa-arrow-left text-[10px]"></i>
        </button>
      `;
    }

    return `
      <div class="p-3 sm:p-3.5 rounded-2xl ${style.bg} border ${style.border} flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm hover:border-purple-400/50 transition">
        <div class="flex items-start gap-3">
          <div class="w-8 h-8 rounded-xl bg-purple-500/20 text-purple-300 border border-purple-500/30 flex items-center justify-center shrink-0 mt-0.5">
            <i class="fa-solid ${s.icon || 'fa-lightbulb'} text-xs"></i>
          </div>
          <div>
            <div class="flex items-center gap-2 mb-1 flex-wrap">
              <span class="text-xs font-black text-white">${escapeHtml(s.title)}</span>
              <span class="text-[9px] px-2 py-0.5 rounded-md border font-black ${style.tagBg}">${style.tagText}</span>
              <span class="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-bold">${escapeHtml(s.category)}</span>
            </div>
            <p class="text-[11px] text-slate-300 leading-relaxed">${escapeHtml(s.text)}</p>
          </div>
        </div>
        <div class="flex justify-end shrink-0">
          ${actionBtnHtml}
        </div>
      </div>
    `;
  }).join('');
}

function renderAdvisorLiveAudit(logs) {
  const container = document.getElementById('advLiveAuditList');
  const countBadge = document.getElementById('advLiveAuditCountBadge');
  if (countBadge) countBadge.innerText = `${(logs || []).length} تۆمار`;
  if (!container) return;

  if (!logs || logs.length === 0) {
    container.innerHTML = `
      <div class="text-center py-4 text-slate-500 text-xs">
        <i class="fa-solid fa-clock-rotate-left text-base mb-1 block opacity-60"></i>
        <span>هێشتا هیچ تۆمارێکی کردنەوە یان داخستنی لایڤ نییە</span>
      </div>
    `;
    return;
  }

  container.innerHTML = logs.map(l => {
    const isOpened = l.action === 'opened';
    const actionText = isOpened ? 'کردنەوەی لایڤ 🔴' : 'داخستنی لایڤ ⏹️';
    const badgeClass = isOpened ? 'bg-rose-500/20 text-rose-300 border-rose-500/30' : 'bg-slate-700/50 text-slate-300 border-slate-600/40';
    const icon = isOpened ? 'fa-tower-broadcast text-rose-400' : 'fa-circle-stop text-slate-400';
    const timeFormatted = new Date(l.created_at).toLocaleTimeString('ckb', { hour: '2-digit', minute: '2-digit' }) + ' • ' + new Date(l.created_at).toLocaleDateString('ckb', { day: 'numeric', month: 'short' });
    const durationText = (!isOpened && l.duration_seconds > 0) ? ` (ماوەی لایڤ: ${Math.round(l.duration_seconds / 60)} خولەک)` : '';
    const startedBySubtext = (!isOpened && l.started_by_name) ? `<span class="text-[10px] text-slate-400 mr-1.5">کەسێک کە لایڤەکەی کردبۆوە: <b class="text-slate-300">${escapeHtml(l.started_by_name)}</b></span>` : '';

    return `
      <div class="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center justify-between gap-2 text-xs">
        <div class="flex items-center gap-2 min-w-0 flex-1">
          <div class="w-7 h-7 rounded-lg ${isOpened ? 'bg-rose-500/10' : 'bg-slate-800'} flex items-center justify-center shrink-0">
            <i class="fa-solid ${icon} text-xs"></i>
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5 flex-wrap">
              <span class="font-black text-white text-xs">${escapeHtml(l.user_name || l.username)}</span>
              <span class="text-[9px] px-1.5 py-0.2 rounded border ${badgeClass} font-bold">${actionText}</span>
              ${durationText ? `<span class="text-[10px] text-amber-300 font-mono">${durationText}</span>` : ''}
            </div>
            ${l.title ? `<p class="text-[10px] text-slate-300 truncate mt-0.5">ناونیشان: «${escapeHtml(l.title)}»</p>` : ''}
            ${startedBySubtext}
          </div>
        </div>
        <div class="text-[10px] text-slate-400 shrink-0 font-mono">${timeFormatted}</div>
      </div>
    `;
  }).join('');
}

function handleAdvisorAction(action) {
  closeAiAdvisorModal();
  if (action === 'dream_admin') {
    if (typeof openDreamAdminModal === 'function') openDreamAdminModal();
  } else if (action === 'admin_members') {
    if (typeof openAdminModal === 'function') openAdminModal();
  } else if (action === 'live_lesson') {
    if (typeof openLiveModal === 'function') openLiveModal();
  } else if (action === 'post_question') {
    if (typeof openPostQuestionModal === 'function') openPostQuestionModal();
  } else if (action === 'ai_security') {
    if (typeof openAiSecurityModal === 'function') openAiSecurityModal();
  }
}

async function loadAdvisorChatHistory() {
  const container = document.getElementById('advisorChatMessages');
  if (!container) return;

  try {
    const res = await fetch('/api/advisor/chat-history', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return;
    const data = await res.json();
    const history = data.history || [];

    if (history.length > 0) {
      container.innerHTML = history.map(item => {
        const isUser = item.sender === 'user';
        const timeStr = item.created_at ? new Date(item.created_at).toLocaleTimeString('ckb', { hour: '2-digit', minute: '2-digit' }) : '';
        if (isUser) {
          return `
            <div class="flex items-start gap-2.5 max-w-[85%] mr-auto justify-end">
              <div class="bg-gradient-to-r from-purple-700 to-indigo-700 text-white rounded-2xl rounded-tl-none p-3 shadow-md">
                <div class="flex items-center justify-between gap-2 mb-1">
                  <span class="text-xs font-black text-purple-200">کاک هێمن</span>
                  <span class="text-[9px] text-purple-300/80">${timeStr}</span>
                </div>
                <p class="text-xs leading-relaxed whitespace-pre-wrap">${escapeHtml(item.message)}</p>
              </div>
              <div class="w-8 h-8 rounded-xl bg-purple-600 text-white flex items-center justify-center shrink-0 text-xs font-bold shadow-md">
                هـ
              </div>
            </div>
          `;
        } else {
          return `
            <div class="flex items-start gap-2.5 max-w-[85%] advisor-bubble">
              <div class="w-8 h-8 rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-600 text-white flex items-center justify-center shrink-0 shadow-md">
                <i class="fa-solid fa-wand-magic-sparkles text-xs"></i>
              </div>
              <div class="bg-slate-800/90 border border-purple-500/30 rounded-2xl rounded-tr-none p-3 shadow-md">
                <div class="flex items-center justify-between gap-2 mb-1">
                  <span class="text-xs font-black text-purple-300">ڕاوێژکار</span>
                  <span class="text-[9px] text-slate-400">${timeStr}</span>
                </div>
                <p class="text-xs text-slate-200 leading-relaxed whitespace-pre-wrap">${escapeHtml(item.message)}</p>
              </div>
            </div>
          `;
        }
      }).join('');
      container.scrollTop = container.scrollHeight;
    }
  } catch (err) {
    console.error('Advisor chat history error:', err);
  }
}

async function sendAdvisorMessage() {
  if (isAdvisorTyping) return;
  const input = document.getElementById('advisorChatInput');
  const sendBtn = document.getElementById('advisorSendBtn');
  if (!input) return;

  const text = input.value.trim();
  if (!text) return;

  input.value = '';
  const container = document.getElementById('advisorChatMessages');

  // Append user message immediately
  const nowStr = new Date().toLocaleTimeString('ckb', { hour: '2-digit', minute: '2-digit' });
  const userHtml = `
    <div class="flex items-start gap-2.5 max-w-[85%] mr-auto justify-end">
      <div class="bg-gradient-to-r from-purple-700 to-indigo-700 text-white rounded-2xl rounded-tl-none p-3 shadow-md">
        <div class="flex items-center justify-between gap-2 mb-1">
          <span class="text-xs font-black text-purple-200">کاک هێمن</span>
          <span class="text-[9px] text-purple-300/80">${nowStr}</span>
        </div>
        <p class="text-xs leading-relaxed whitespace-pre-wrap">${escapeHtml(text)}</p>
      </div>
      <div class="w-8 h-8 rounded-xl bg-purple-600 text-white flex items-center justify-center shrink-0 text-xs font-bold shadow-md">
        هـ
      </div>
    </div>
  `;
  container.insertAdjacentHTML('beforeend', userHtml);

  // Append typing indicator
  const typingId = 'advisorTypingIndicator_' + Date.now();
  const typingHtml = `
    <div id="${typingId}" class="flex items-start gap-2.5 max-w-[85%]">
      <div class="w-8 h-8 rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-600 text-white flex items-center justify-center shrink-0 shadow-md">
        <i class="fa-solid fa-wand-magic-sparkles text-xs animate-pulse"></i>
      </div>
      <div class="bg-slate-800/90 border border-purple-500/30 rounded-2xl rounded-tr-none p-3 shadow-md">
        <div class="flex items-center gap-2">
          <span class="text-xs font-black text-purple-300">ڕاوێژکار</span>
          <span class="text-[10px] text-slate-400 italic">سەرقاڵی پشکنین و داڕشتنی وەڵامە...</span>
          <span class="flex gap-1">
            <span class="w-1.5 h-1.5 rounded-full bg-purple-400 animate-bounce"></span>
            <span class="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style="animation-delay: 0.2s"></span>
            <span class="w-1.5 h-1.5 rounded-full bg-purple-400 animate-bounce" style="animation-delay: 0.4s"></span>
          </span>
        </div>
      </div>
    </div>
  `;
  container.insertAdjacentHTML('beforeend', typingHtml);
  container.scrollTop = container.scrollHeight;

  isAdvisorTyping = true;
  if (sendBtn) sendBtn.disabled = true;

  try {
    const res = await fetch('/api/advisor/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ message: text })
    });

    const typingElem = document.getElementById(typingId);
    if (typingElem) typingElem.remove();

    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'هەڵەیەک ڕوویدا');
    }

    const data = await res.json();
    const reply = data.reply || 'ببوورە کاک هێمن گیان، کێشەیەک ڕوویدا لە وەڵامدانەوە.';

    const replyTimeStr = new Date().toLocaleTimeString('ckb', { hour: '2-digit', minute: '2-digit' });
    const replyHtml = `
      <div class="flex items-start gap-2.5 max-w-[85%] advisor-bubble">
        <div class="w-8 h-8 rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-600 text-white flex items-center justify-center shrink-0 shadow-md">
          <i class="fa-solid fa-wand-magic-sparkles text-xs"></i>
        </div>
        <div class="bg-slate-800/90 border border-purple-500/30 rounded-2xl rounded-tr-none p-3 shadow-md">
          <div class="flex items-center justify-between gap-2 mb-1">
            <span class="text-xs font-black text-purple-300">ڕاوێژکار</span>
            <span class="text-[9px] text-slate-400">${replyTimeStr}</span>
          </div>
          <p class="text-xs text-slate-200 leading-relaxed whitespace-pre-wrap">${escapeHtml(reply)}</p>
        </div>
      </div>
    `;
    container.insertAdjacentHTML('beforeend', replyHtml);
    container.scrollTop = container.scrollHeight;
  } catch (err) {
    const typingElem = document.getElementById(typingId);
    if (typingElem) typingElem.remove();

    console.error('Advisor chat error:', err);
    const replyTimeStr = new Date().toLocaleTimeString('ckb', { hour: '2-digit', minute: '2-digit' });
    const errText = (err && err.message) ? err.message : 'ببورە کاک هێمن گیان، کێشەیەک لە پەیوەندیکردن بە زیرەکی دەستکرد دروست بوو؛ تکایە دووبارەی بکەرەوە.';

    const replyHtml = `
      <div class="flex items-start gap-2.5 max-w-[85%] advisor-bubble">
        <div class="w-8 h-8 rounded-xl bg-gradient-to-tr from-rose-600 to-purple-600 text-white flex items-center justify-center shrink-0 shadow-md">
          <i class="fa-solid fa-triangle-exclamation text-xs"></i>
        </div>
        <div class="bg-slate-800/90 border border-rose-500/30 rounded-2xl rounded-tr-none p-3 shadow-md">
          <div class="flex items-center justify-between gap-2 mb-1">
            <span class="text-xs font-black text-rose-300">ڕاوێژکار (سیستەم)</span>
            <span class="text-[9px] text-slate-400">${replyTimeStr}</span>
          </div>
          <p class="text-xs text-rose-200 leading-relaxed whitespace-pre-wrap">${escapeHtml(errText)}</p>
        </div>
      </div>
    `;
    container.insertAdjacentHTML('beforeend', replyHtml);
    container.scrollTop = container.scrollHeight;
  } finally {
    isAdvisorTyping = false;
    if (sendBtn) sendBtn.disabled = false;
    setTimeout(() => {
      const inp = document.getElementById('advisorChatInput');
      if (inp) inp.focus();
    }, 50);
  }
}



function quickAskAdvisor(promptText) {
  switchAdvisorTab('chat');
  const input = document.getElementById('advisorChatInput');
  if (input) {
    input.value = promptText;
    sendAdvisorMessage();
  }
}

function toggleAdvisorSettings() {
  const overlay = document.getElementById('advisorSettingsOverlay');
  if (overlay) overlay.classList.toggle('hidden');
}

async function checkAdvisorGeminiStatus() {
  try {
    const res = await fetch('/api/advisor/gemini-status', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return;
    const data = await res.json();
    const badge = document.getElementById('advisorGeminiStatusBadge');
    if (badge) {
      if (data.hasKey) {
        badge.innerText = data.isCustom ? 'Gemini تایبەت چالاکە 🤖' : 'Gemini سێرڤەر چالاکە 🤖';
        badge.className = 'text-[9px] px-2 py-0.5 rounded-md bg-purple-500/20 text-purple-300 border border-purple-500/30 font-bold';
      } else {
        badge.innerText = 'سیستەمی کوردی چالاکە 🧠';
        badge.className = 'text-[9px] px-2 py-0.5 rounded-md bg-slate-800 text-slate-400 font-bold';
      }
    }
  } catch (e) {}
}

async function saveAdvisorGeminiKey() {
  const input = document.getElementById('advisorGeminiKeyInput');
  if (!input) return;
  const key = input.value.trim();

  try {
    const res = await fetch('/api/advisor/gemini-key', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ apiKey: key })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'هەڵە لە تۆمارکردن');
    alert(data.message || 'سەرکەوتوو بوو');
    input.value = '';
    checkAdvisorGeminiStatus();
  } catch (e) {
    alert(e.message || 'هەڵەیەک ڕوویدا');
  }
}

async function clearAdvisorChatHistory() {
  if (!confirm('ئایا دڵنیایت لە سڕینەوەی تەواوی مێژووی گفتوگۆکانت لەگەڵ ڕاوێژکار؟')) return;

  try {
    const res = await fetch('/api/advisor/clear-history', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'هەڵە لە سڕینەوە');

    const container = document.getElementById('advisorChatMessages');
    if (container) {
      container.innerHTML = `
        <div class="flex items-start gap-2.5 max-w-[85%]">
          <div class="w-8 h-8 rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-600 text-white flex items-center justify-center shrink-0 shadow-md">
            <i class="fa-solid fa-wand-magic-sparkles text-xs"></i>
          </div>
          <div class="bg-slate-800/90 border border-purple-500/30 rounded-2xl rounded-tr-none p-3 shadow-md">
            <div class="flex items-center justify-between gap-2 mb-1">
              <span class="text-xs font-black text-purple-300">ڕاوێژکاری تایبەت</span>
              <span class="text-[9px] text-slate-400">ئێستا</span>
            </div>
            <p class="text-xs text-slate-200 leading-relaxed">
              سڵاو کاک هێمن گیان! مێژووی گفتوگۆکان پاککرایەوە. هەموو کات لە خزمەتتدام بۆ هەر پرسیار و ڕاوێژێک لەبارەی پلاتفۆرمی سیرین ستاف. 💜
            </p>
          </div>
        </div>
      `;
    }
    alert('مێژووی گفتوگۆکان سڕایەوە');
    toggleAdvisorSettings();
  } catch (e) {
    alert(e.message || 'هەڵەیەک ڕوویدا');
  }
}

// ================= ACTION BUTTON (@دوگمە) CHAT & ATTENDANCE FUNCTIONS =================
async function handleActionButtonClick(messageId, event) {
  if (event) event.stopPropagation();
  const btn = document.getElementById(`action-btn-${messageId}`);
  if (!btn) return;

  try {
    btn.disabled = true;
    const res = await fetch(`/api/chat/messages/${messageId}/button-click`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });
    const data = await res.json();
    if (res.ok && data.success) {
      btn.className = 'action-chat-btn w-full px-5 py-3 rounded-2xl font-black text-sm flex items-center justify-center gap-2.5 transition-all duration-300 active:scale-95 shadow-lg select-none cursor-pointer action-btn-green';
      btn.setAttribute('data-clicked', 'true');
      btn.innerHTML = '<i class="fa-solid fa-circle-check text-base animate-scale-up"></i><span>تۆمارکراوە (دەستت لێداوە) ✅</span>';

      const countEl = document.querySelector(`#action-clicks-count-${messageId} .clicks-num`);
      if (countEl) countEl.innerText = data.total_clicks;

      playSound('correct');
      showToastNotification('دەستت لێدا و تۆمارکرا! دوگمەکە سەوز بوو 🟢', 'emerald');
    } else {
      showToastNotification(data.error || 'هەڵە لە دەستلێدان', 'rose');
    }
  } catch (err) {
    console.error('Action button click error:', err);
  } finally {
    btn.disabled = false;
  }
}

let currentButtonReportData = null;
let currentButtonAttendanceTab = 'clicked';

async function openButtonStatsModal(messageId, event) {
  if (event) event.stopPropagation();
  const modal = document.getElementById('buttonAttendanceModal');
  if (!modal) return;
  modal.classList.remove('hidden');

  const listEl = document.getElementById('btnAttUsersList');
  if (listEl) listEl.innerHTML = '<div class="text-center py-8 text-slate-500 text-xs"><i class="fa-solid fa-spinner fa-spin mr-1"></i> بارکردنی ئامار...</div>';

  try {
    const res = await fetch(`/api/chat/messages/${messageId}/button-stats`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      if (listEl) listEl.innerHTML = `<div class="text-center py-8 text-rose-400 text-xs">${escapeHtml(data.error || 'نەدۆزرایەوە')}</div>`;
      return;
    }
    currentButtonReportData = data;
    renderButtonAttendanceModalContent();
  } catch (err) {
    console.error('Error fetching button stats:', err);
    if (listEl) listEl.innerHTML = '<div class="text-center py-8 text-rose-400 text-xs">هەڵە لە وەرگرتنی زانیارییەکان</div>';
  }
}

async function openLatestButtonStatsModal() {
  const modal = document.getElementById('buttonAttendanceModal');
  if (!modal) return;
  modal.classList.remove('hidden');

  const listEl = document.getElementById('btnAttUsersList');
  if (listEl) listEl.innerHTML = '<div class="text-center py-8 text-slate-500 text-xs"><i class="fa-solid fa-spinner fa-spin mr-1"></i> بارکردنی ئامار...</div>';

  try {
    const res = await fetch('/api/chat/button-latest-stats', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      if (listEl) listEl.innerHTML = `<div class="text-center py-8 text-rose-400 text-xs">${escapeHtml(data.error || 'هیچ دوگمەیەک نەدۆزرایەوە')}</div>`;
      return;
    }
    currentButtonReportData = data;
    renderButtonAttendanceModalContent();
  } catch (err) {
    console.error('Error fetching latest button stats:', err);
    if (listEl) listEl.innerHTML = '<div class="text-center py-8 text-rose-400 text-xs">هەڵە لە وەرگرتنی زانیارییەکان</div>';
  }
}

function closeButtonAttendanceModal() {
  const modal = document.getElementById('buttonAttendanceModal');
  if (modal) modal.classList.add('hidden');
  const searchInput = document.getElementById('btnAttSearchInput');
  if (searchInput) searchInput.value = '';
}

function switchButtonAttendanceTab(tab) {
  currentButtonAttendanceTab = tab;
  const tabClicked = document.getElementById('btnAttTabClicked');
  const tabUnclicked = document.getElementById('btnAttTabUnclicked');

  if (tab === 'clicked') {
    if (tabClicked) tabClicked.className = 'py-2 px-3 rounded-xl font-black text-xs flex items-center justify-center gap-1.5 transition bg-emerald-600/30 text-emerald-300 border border-emerald-500/50 shadow-sm';
    if (tabUnclicked) tabUnclicked.className = 'py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition bg-slate-800/80 text-slate-400 hover:text-rose-300 border border-slate-700/60';
  } else {
    if (tabClicked) tabClicked.className = 'py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition bg-slate-800/80 text-slate-400 hover:text-emerald-300 border border-slate-700/60';
    if (tabUnclicked) tabUnclicked.className = 'py-2 px-3 rounded-xl font-black text-xs flex items-center justify-center gap-1.5 transition bg-rose-600/30 text-rose-300 border border-rose-500/50 shadow-sm';
  }
  filterButtonAttendanceList();
}

function renderButtonAttendanceModalContent() {
  if (!currentButtonReportData) return;
  const rep = currentButtonReportData;

  const summaryEl = document.getElementById('btnAttMsgSummary');
  if (summaryEl) {
    summaryEl.innerText = rep.message ? `«${rep.message.content}» (${new Date(rep.message.created_at).toLocaleTimeString('ku-IQ')})` : '';
  }

  const clickedBadge = document.getElementById('btnAttClickedCountBadge');
  if (clickedBadge) clickedBadge.innerText = rep.clicked_count || 0;

  const unclickedBadge = document.getElementById('btnAttUnclickedCountBadge');
  if (unclickedBadge) unclickedBadge.innerText = rep.unclicked_count || 0;

  filterButtonAttendanceList();
}

function filterButtonAttendanceList() {
  if (!currentButtonReportData) return;
  const listEl = document.getElementById('btnAttUsersList');
  if (!listEl) return;

  const query = (document.getElementById('btnAttSearchInput')?.value || '').trim().toLowerCase();
  const isClicked = currentButtonAttendanceTab === 'clicked';
  const rawList = isClicked ? (currentButtonReportData.clicked_users || []) : (currentButtonReportData.unclicked_users || []);

  const filtered = rawList.filter(u => {
    if (!query) return true;
    return (u.full_name && u.full_name.toLowerCase().includes(query)) || (u.username && u.username.toLowerCase().includes(query));
  });

  if (filtered.length === 0) {
    listEl.innerHTML = `
      <div class="text-center py-10 text-slate-500 text-xs">
        <i class="fa-solid fa-user-slash text-2xl block mb-2 opacity-50"></i>
        <span>${isClicked ? 'هیچ کەسێک دەستی لێنەداوە' : 'هیچ کەسێک نەدۆزرایەوە (هەمووان دەستیان لێداوە)'}</span>
      </div>
    `;
    return;
  }

  listEl.innerHTML = filtered.map((u, idx) => {
    const avatarHtml = u.avatar_url 
      ? `<img src="${escapeHtml(u.avatar_url)}" class="w-8 h-8 rounded-xl object-cover border border-slate-700 pointer-events-none" draggable="false">`
      : `<div class="w-8 h-8 rounded-xl bg-slate-800 text-slate-300 flex items-center justify-center text-xs font-bold border border-slate-700">${getGenderEmoji(u.gender)}</div>`;

    const timeFormatted = u.clicked_at ? new Date(u.clicked_at).toLocaleTimeString('ku-IQ', { hour: '2-digit', minute: '2-digit' }) : '';
    const roleBadgeHtml = renderRoleBadge(u.role, u.gender);
    const specialBadgeHtml = u.special_badge ? renderSpecialBadgeHtml(u.special_badge) : '';

    return `
      <div class="p-2.5 rounded-2xl bg-slate-800/80 hover:bg-slate-800 border border-slate-700/60 flex items-center justify-between gap-2.5 transition">
        <div class="flex items-center gap-2.5 min-w-0">
          <span class="text-xs font-mono font-bold text-slate-500 w-5 text-center">${idx + 1}</span>
          ${avatarHtml}
          <div class="min-w-0">
            <div class="flex items-center gap-1.5 flex-wrap">
              <span class="text-xs font-black text-white hover:underline cursor-pointer" onclick="closeButtonAttendanceModal(); openUserProfileModal(${u.id})">${escapeHtml(u.full_name)}</span>
              ${roleBadgeHtml}
              ${specialBadgeHtml}
            </div>
            <span class="text-[10px] text-slate-400 font-mono">@${escapeHtml(u.username)}</span>
          </div>
        </div>
        <div class="shrink-0 text-left">
          ${isClicked 
            ? `<span class="px-2 py-0.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-black inline-flex items-center gap-1"><i class="fa-solid fa-check text-[9px]"></i> ${timeFormatted}</span>`
            : `<span class="px-2 py-0.5 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/40 text-[10px] font-bold inline-flex items-center gap-1"><i class="fa-solid fa-xmark text-[9px]"></i> لێنەدراوە</span>`
          }
        </div>
      </div>
    `;
  }).join('');
}

function copyButtonAttendanceList() {
  if (!currentButtonReportData) return;
  const isClicked = currentButtonAttendanceTab === 'clicked';
  const rawList = isClicked ? (currentButtonReportData.clicked_users || []) : (currentButtonReportData.unclicked_users || []);
  if (!rawList.length) {
    showToastNotification('هیچ ناوێک نییە بۆ کۆپیکردن!', 'amber');
    return;
  }

  const title = isClicked ? '🟢 لیستی ئەوانەی دەستیان لە دوگمەکە داوە:' : '🔴 لیستی ئەوانەی دەستیان لە دوگمەکە نەداوە:';
  const text = `${title}\n` + rawList.map((u, i) => `${i + 1}. ${u.full_name} (@${u.username}) ${u.clicked_at ? '[' + new Date(u.clicked_at).toLocaleTimeString('ku-IQ') + ']' : ''}`).join('\n');

  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => {
      showToastNotification('تەواوی ناوەکان کۆپیکران! دەتوانیت پەیسی بکەیت ✅', 'emerald');
    }).catch(() => {
      showToastNotification('هەڵە لە کۆپیکردن', 'rose');
    });
  }
}





// =========================================================================
// CUSTOM PRIVATE GROUP CHATS MODULE (گروپ چاتە تایبەتەکان بە سەرپەرشتی ڕاوێژکار)
// =========================================================================

let userCustomGroupsCache = [];
let activeCustomGroupId = null;
let activeCustomGroupData = null;
let activeGroupMessages = [];
let selectedGroupFile = null;
let customGroupMediaRecorder = null;
let customGroupAudioChunks = [];
let customGroupVoiceInterval = null;
let customGroupVoiceDurationSecs = 0;
let customGroupVoiceBlob = null;
let allUsersForGroupChecklistCache = [];
let currentPlayingCustomGroupVoiceId = null;

// 1. Load user custom groups from server
async function loadUserCustomGroups() {
  if (typeof token === 'undefined' || !token) return;
  try {
    const res = await fetch('/api/custom-groups', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return;
    const data = await res.json();
    userCustomGroupsCache = data.groups || [];
    renderCustomGroupsHeader();
    renderDrawerCustomGroups();
  } catch (err) {
    console.error('Error loading custom groups:', err);
  }
}

// 2. Render top header bar with glowing radiant dots for unread groups
function renderCustomGroupsHeader() {
  const bar = document.getElementById('customGroupsHeaderBar');
  const container = document.getElementById('customGroupsPillsContainer');
  const adminActions = document.getElementById('customGroupsAdminActions');
  if (!bar || !container) return;

  const isSuperAdmin = typeof currentUser !== 'undefined' && currentUser && currentUser.role === 'super_admin';

  if (adminActions) {
    if (isSuperAdmin) {
      adminActions.classList.remove('hidden');
    } else {
      adminActions.classList.add('hidden');
    }
  }

  if (userCustomGroupsCache.length === 0 && !isSuperAdmin) {
    bar.classList.add('hidden');
    container.innerHTML = '';
    return;
  }

  bar.classList.remove('hidden');

  if (userCustomGroupsCache.length === 0 && isSuperAdmin) {
    container.innerHTML = `
      <div class="text-[11px] text-amber-300/80 font-bold flex items-center gap-1.5 py-0.5">
        <i class="fa-solid fa-users-viewfinder text-amber-400"></i>
        <span>گروپ چاتی تایبەت نییە؛ دەتوانیت لە دوگمەی تەنیشتەوە دروستی بکەیت</span>
      </div>
    `;
    return;
  }

  container.innerHTML = userCustomGroupsCache.map(g => {
    const hasUnread = (g.unread_count || 0) > 0;
    return `
      <button type="button" 
        onclick="openCustomGroupChatModal(${g.id})" 
        class="relative px-3 py-1 bg-gradient-to-r from-slate-900 to-indigo-950/80 hover:from-slate-800 hover:to-indigo-900 border ${hasUnread ? 'border-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.35)]' : 'border-indigo-500/30 hover:border-indigo-500/60'} rounded-xl text-xs font-black text-slate-100 flex items-center gap-2 transition shrink-0 active:scale-95 group" 
        title="${escapeHtml(g.name)} (${g.member_count || 0} ئەندام)">
        
        ${hasUnread 
          ? `<span class="radiant-dot" title="قسەی نوێی تیاکراوە"></span>` 
          : `<i class="fa-solid fa-comments text-indigo-400 text-xs"></i>`
        }

        <span class="truncate max-w-[130px] sm:max-w-[180px]">${escapeHtml(g.name)}</span>
        
        ${hasUnread 
          ? `<span class="px-1.5 py-0.2 rounded-md bg-emerald-500/20 text-emerald-300 text-[10px] font-mono font-bold animate-pulse">نوێ ✨</span>` 
          : `<span class="text-[10px] text-indigo-300/60 font-mono">(${g.member_count || 0})</span>`
        }
      </button>
    `;
  }).join('');
}

// 3. Render in Main Drawer Menu
function renderDrawerCustomGroups() {
  const section = document.getElementById('drawerCustomGroupsSection');
  const list = document.getElementById('drawerCustomGroupsList');
  const createBtn = document.getElementById('drawerCreateGroupBtn');
  if (!section || !list) return;

  const isSuperAdmin = typeof currentUser !== 'undefined' && currentUser && currentUser.role === 'super_admin';

  if (createBtn) {
    if (isSuperAdmin) {
      createBtn.classList.remove('hidden');
    } else {
      createBtn.classList.add('hidden');
    }
  }

  if (userCustomGroupsCache.length === 0 && !isSuperAdmin) {
    section.classList.add('hidden');
    list.innerHTML = '';
    return;
  }

  section.classList.remove('hidden');

  if (userCustomGroupsCache.length === 0 && isSuperAdmin) {
    list.innerHTML = `
      <p class="text-[11px] text-slate-400 py-1 px-2">هیچ گروپ چاتێک نییە؛ کلیک لە دوگمەی سەرەوە بکە بۆ دروستکردن.</p>
    `;
    return;
  }

  list.innerHTML = userCustomGroupsCache.map(g => {
    const hasUnread = (g.unread_count || 0) > 0;
    return `
      <button type="button" 
        onclick="closeMainMenuDrawer(); openCustomGroupChatModal(${g.id});" 
        class="w-full flex items-center justify-between px-3 py-2 rounded-xl text-slate-200 hover:text-white bg-slate-800/60 hover:bg-slate-800 border ${hasUnread ? 'border-emerald-500/50 shadow-sm shadow-emerald-500/20' : 'border-slate-800 hover:border-slate-700'} transition text-xs font-bold">
        <span class="flex items-center gap-2 min-w-0">
          ${hasUnread 
            ? `<span class="radiant-dot"></span>` 
            : `<i class="fa-solid fa-users text-indigo-400 text-xs w-4 text-center"></i>`
          }
          <span class="truncate">${escapeHtml(g.name)}</span>
        </span>
        <div class="flex items-center gap-1.5 shrink-0">
          <span class="text-[10px] text-slate-400 font-mono">${g.member_count || 0} ئەندام</span>
          ${hasUnread ? `<span class="px-1.5 py-0.2 rounded-md bg-emerald-500/20 text-emerald-300 text-[9px] font-bold animate-pulse">قسە کراوە</span>` : ''}
        </div>
      </button>
    `;
  }).join('');
}

// 4. Open Custom Group Chat Modal
async function openCustomGroupChatModal(groupId) {
  activeCustomGroupId = groupId;
  const modal = document.getElementById('customGroupChatModal');
  if (!modal) return;

  const isSuperAdmin = typeof currentUser !== 'undefined' && currentUser && currentUser.role === 'super_admin';

  // Toggle admin manage button and quick-tag bar
  const manageBtn = document.getElementById('customGroupManageBtn');
  if (manageBtn) {
    if (isSuperAdmin) manageBtn.classList.remove('hidden');
    else manageBtn.classList.add('hidden');
  }
  const quickTagBar = document.getElementById('customGroupQuickTagBar');
  if (quickTagBar) {
    if (isSuperAdmin) quickTagBar.classList.remove('hidden');
    else quickTagBar.classList.add('hidden');
  }

  // Clear typing indicators & reset inputs
  const advTyping = document.getElementById('customGroupAdvisorTyping');
  if (advTyping) advTyping.classList.add('hidden');
  const userTyping = document.getElementById('customGroupUserTyping');
  if (userTyping) userTyping.classList.add('hidden');
  cancelCustomGroupFile();
  cancelCustomGroupVoiceRecord();

  modal.classList.remove('hidden');

  // Join socket room
  if (typeof socket !== 'undefined' && socket && socket.connected) {
    socket.emit('join_custom_group', { groupId });
  }

  // Clear unread in local cache
  const cachedGroup = userCustomGroupsCache.find(g => g.id === groupId);
  if (cachedGroup) {
    cachedGroup.unread_count = 0;
    renderCustomGroupsHeader();
    renderDrawerCustomGroups();
  }

  // Fetch group details and messages
  try {
    const [groupRes, msgsRes] = await Promise.all([
      fetch(`/api/custom-groups/${groupId}`, { headers: { 'Authorization': `Bearer ${token}` } }),
      fetch(`/api/custom-groups/${groupId}/messages`, { headers: { 'Authorization': `Bearer ${token}` } })
    ]);

    if (groupRes.ok) {
      const gData = await groupRes.json();
      activeCustomGroupData = gData.group;
      document.getElementById('customGroupModalTitle').innerText = activeCustomGroupData.name || 'گروپ چات';
      const mCount = (activeCustomGroupData.members || []).length;
      document.getElementById('customGroupMembersCountText').innerText = `${mCount} ئەندام`;
    }

    if (msgsRes.ok) {
      const mData = await msgsRes.json();
      activeGroupMessages = mData.messages || [];
      renderCustomGroupMessages(activeGroupMessages);
    }
  } catch (err) {
    console.error('Error loading group data:', err);
  }
}

// 5. Close Custom Group Chat Modal
function closeCustomGroupChatModal() {
  const modal = document.getElementById('customGroupChatModal');
  if (modal) modal.classList.add('hidden');

  if (typeof socket !== 'undefined' && socket && socket.connected && activeCustomGroupId) {
    socket.emit('leave_custom_group', { groupId: activeCustomGroupId });
  }

  cancelCustomGroupVoiceRecord();
  cancelCustomGroupFile();

  if (currentPlayingCustomGroupVoiceId) {
    const audio = document.getElementById(`cg-voice-audio-${currentPlayingCustomGroupVoiceId}`);
    if (audio) audio.pause();
    currentPlayingCustomGroupVoiceId = null;
  }

  activeCustomGroupId = null;
  activeCustomGroupData = null;
  activeGroupMessages = [];
}

// 6. Render Group Messages
function renderCustomGroupMessages(messagesList) {
  const container = document.getElementById('customGroupMessagesContainer');
  if (!container) return;

  if (!messagesList || messagesList.length === 0) {
    container.innerHTML = `
      <div class="text-center py-16 text-slate-500">
        <i class="fa-solid fa-comments text-4xl text-indigo-500/40 mb-3 block"></i>
        <h4 class="text-sm font-black text-slate-300 mb-1">بەخێربێن بۆ ئەم گروپ چاتە تایبەتە</h4>
        <p class="text-xs text-slate-400 max-w-xs mx-auto">دەتوانن دەنگ، وێنە، فایل و نوسین بنێرن. دەنگەکان پارێزراون لە داونلۆد و ڕاوێژکاریش ئامادەی وەڵامدانەوەیە.</p>
      </div>
    `;
    return;
  }

  const isSuperAdmin = typeof currentUser !== 'undefined' && currentUser && currentUser.role === 'super_admin';

  container.innerHTML = messagesList.map(msg => {
    return buildCustomGroupMessageHtml(msg, isSuperAdmin);
  }).join('');

  scrollCustomGroupToBottom();
}

// Helper: build HTML for a single custom group message
function buildCustomGroupMessageHtml(msg, isSuperAdmin) {
  const isMine = typeof currentUser !== 'undefined' && currentUser && msg.sender_id === currentUser.id;
  const isAdvisor = !!msg.is_advisor || msg.sender_role === 'advisor';
  const canDelete = isMine || isSuperAdmin;

  const timeFormatted = new Date(msg.created_at).toLocaleTimeString('ku-IQ', { hour: '2-digit', minute: '2-digit' });
  const dateFormatted = new Date(msg.created_at).toLocaleDateString('ku-IQ', { month: 'numeric', day: 'numeric' });

  // Advisor luxury card style
  if (isAdvisor) {
    return `
      <div id="cg-msg-${msg.id}" class="my-3 p-3.5 sm:p-4 rounded-3xl advisor-chat-card text-slate-100 max-w-xl mx-auto shadow-xl select-text transition">
        <div class="flex items-center justify-between gap-2 border-b border-indigo-500/20 pb-2 mb-2.5">
          <div class="flex items-center gap-2">
            <div class="w-8 h-8 rounded-xl bg-gradient-to-br from-cyan-500 to-indigo-600 text-white flex items-center justify-center text-sm shadow-md shadow-cyan-950">
              <i class="fa-solid fa-robot"></i>
            </div>
            <div>
              <div class="flex items-center gap-1.5">
                <span class="text-xs font-black text-cyan-300">ڕاوێژکار</span>
                <span class="px-1.5 py-0.2 rounded-md bg-cyan-500/20 text-cyan-300 text-[9px] font-bold border border-cyan-500/30">Executive AI</span>
              </div>
              <span class="text-[10px] text-slate-400 font-mono">${dateFormatted} • ${timeFormatted}</span>
            </div>
          </div>
          ${canDelete ? `
            <button type="button" onclick="deleteCustomGroupMessage(${msg.group_id}, ${msg.id})" class="text-slate-500 hover:text-rose-400 p-1 rounded-lg transition" title="سڕینەوەی ئەم پەیامە">
              <i class="fa-solid fa-trash-can text-xs"></i>
            </button>
          ` : ''}
        </div>
        <div class="text-xs sm:text-sm leading-relaxed whitespace-pre-wrap text-slate-100 font-medium">${formatAdvisorMessageContent(msg.content)}</div>
      </div>
    `;
  }

  // Attachment HTML
  let attachmentHtml = '';
  if (msg.type === 'image' && msg.attachment_url) {
    attachmentHtml = `
      <div class="mt-2 rounded-2xl overflow-hidden border border-slate-700/80 max-w-xs cursor-pointer hover:opacity-95 transition" onclick="openImageZoom('${msg.attachment_url}')">
        <img src="${msg.attachment_url}" class="w-full h-auto max-h-64 object-cover" loading="lazy">
      </div>
    `;
  } else if (msg.type === 'audio' && msg.attachment_url) {
    // CRITICAL REQUIREMENT: Audio cannot be downloaded! Custom in-app player with controlsList="nodownload" and contextmenu disabled
    attachmentHtml = `
      <div class="mt-2 p-2.5 rounded-2xl bg-slate-900/90 border border-slate-700/80 max-w-xs select-none" oncontextmenu="return false;">
        <div class="flex items-center gap-2.5">
          <button type="button" id="cg-voice-btn-${msg.id}" onclick="toggleCustomGroupVoicePlay(${msg.id}, '${msg.attachment_url}')" class="w-9 h-9 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center text-xs shrink-0 shadow transition active:scale-95" title="لێدان">
            <i class="fa-solid fa-play"></i>
          </button>
          <div class="flex-1 min-w-0">
            <div class="h-2 bg-slate-800 rounded-full overflow-hidden cursor-pointer" onclick="seekCustomGroupVoice(${msg.id}, event)">
              <div id="cg-voice-progress-${msg.id}" class="h-full bg-gradient-to-r from-indigo-500 to-purple-500 w-0 transition-all duration-150"></div>
            </div>
            <div class="flex items-center justify-between text-[10px] text-slate-400 font-mono mt-1">
              <span id="cg-voice-time-${msg.id}">00:00</span>
              <span class="text-emerald-400 font-bold flex items-center gap-1">
                <i class="fa-solid fa-lock text-[9px]"></i> دەنگی پارێزراو
              </span>
            </div>
          </div>
        </div>
        <audio id="cg-voice-audio-${msg.id}" src="${msg.attachment_url}" preload="metadata" controlsList="nodownload noplaybackrate" oncontextmenu="return false;" ontimeupdate="updateCustomGroupVoiceProgress(${msg.id})" onended="onCustomGroupVoiceEnded(${msg.id})"></audio>
      </div>
    `;
  } else if (msg.type === 'file' && msg.attachment_url) {
    const rawFileName = msg.attachment_name || msg.attachment_url.split('/').pop() || 'file';
    const isPdf = rawFileName.toLowerCase().endsWith('.pdf');
    attachmentHtml = `
      <div class="mt-2 p-2.5 rounded-2xl bg-slate-900/95 border border-slate-700/80 flex items-center justify-between gap-2.5 max-w-xs shadow">
        <div class="flex items-center gap-2 min-w-0">
          <div class="w-8 h-8 rounded-xl ${isPdf ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' : 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'} flex items-center justify-center text-xs shrink-0">
            <i class="fa-solid ${isPdf ? 'fa-file-pdf' : 'fa-file'}"></i>
          </div>
          <div class="min-w-0">
            <p class="text-xs font-black text-white truncate" title="${escapeHtml(rawFileName)}">${escapeHtml(rawFileName)}</p>
            <span class="text-[10px] text-slate-400 font-mono">${isPdf ? 'PDF دۆکیومێنت' : 'فایل'}</span>
          </div>
        </div>
        <a href="${msg.attachment_url}" download="${escapeHtml(rawFileName)}" class="px-2.5 py-1 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-black text-xs shrink-0 flex items-center gap-1 transition active:scale-95 shadow" title="داگرتن">
          <i class="fa-solid fa-arrow-down-to-bracket text-[10px]"></i>
          <span>داگرتن</span>
        </a>
      </div>
    `;
  }

  const roleBadgeHtml = typeof renderRoleBadge === 'function' ? renderRoleBadge(msg.sender_role, 'male') : '';

  return `
    <div id="cg-msg-${msg.id}" class="flex flex-col ${isMine ? 'items-end' : 'items-start'} transition group">
      <!-- Sender & Date header -->
      <div class="flex items-center gap-1.5 px-1 mb-1 text-[10px] text-slate-400">
        <span class="font-bold text-slate-300">${escapeHtml(msg.sender_name)}</span>
        ${roleBadgeHtml}
        <span class="text-slate-500 font-mono">${dateFormatted} • ${timeFormatted}</span>
        ${canDelete ? `
          <button type="button" onclick="deleteCustomGroupMessage(${msg.group_id}, ${msg.id})" class="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-rose-400 px-1 transition" title="سڕینەوەی ئەم پەیامە">
            <i class="fa-solid fa-trash-can text-[10px]"></i>
          </button>
        ` : ''}
      </div>

      <!-- Bubble -->
      <div class="px-3.5 py-2.5 rounded-2xl max-w-sm sm:max-w-md ${isMine ? 'bg-indigo-600 text-white rounded-tl-sm' : 'bg-slate-800 text-slate-100 border border-slate-700/80 rounded-tr-sm'} shadow-md">
        ${msg.content ? `<div class="text-xs sm:text-sm leading-relaxed whitespace-pre-wrap">${highlightMentions(escapeHtml(msg.content))}</div>` : ''}
        ${attachmentHtml}
      </div>
    </div>
  `;
}

function formatAdvisorMessageContent(content) {
  if (!content) return '';
  return escapeHtml(content)
    .replace(/\*\*(.*?)\*\*/g, '<b class="text-cyan-300 font-black">$1</b>')
    .replace(/•/g, '<span class="text-cyan-400 font-black">•</span>');
}

function highlightMentions(text) {
  if (!text) return '';
  return text.replace(/(@ڕاوێژکار|@advisor|@rawêjkar)/g, '<span class="px-1.5 py-0.2 rounded-md bg-cyan-400/20 text-cyan-300 font-black">$1</span>');
}

function scrollCustomGroupToBottom() {
  const container = document.getElementById('customGroupMessagesContainer');
  if (container) {
    container.scrollTop = container.scrollHeight;
  }
}

// 7. Custom Group Voice Player (No Download Button!)
function toggleCustomGroupVoicePlay(msgId, audioUrl) {
  const audio = document.getElementById(`cg-voice-audio-${msgId}`);
  const btn = document.getElementById(`cg-voice-btn-${msgId}`);
  if (!audio || !btn) return;

  if (currentPlayingCustomGroupVoiceId && currentPlayingCustomGroupVoiceId !== msgId) {
    const prevAudio = document.getElementById(`cg-voice-audio-${currentPlayingCustomGroupVoiceId}`);
    const prevBtn = document.getElementById(`cg-voice-btn-${currentPlayingCustomGroupVoiceId}`);
    if (prevAudio) prevAudio.pause();
    if (prevBtn) prevBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
  }

  if (audio.paused) {
    audio.play();
    btn.innerHTML = '<i class="fa-solid fa-pause"></i>';
    currentPlayingCustomGroupVoiceId = msgId;
  } else {
    audio.pause();
    btn.innerHTML = '<i class="fa-solid fa-play"></i>';
    currentPlayingCustomGroupVoiceId = null;
  }
}

function updateCustomGroupVoiceProgress(msgId) {
  const audio = document.getElementById(`cg-voice-audio-${msgId}`);
  const bar = document.getElementById(`cg-voice-progress-${msgId}`);
  const time = document.getElementById(`cg-voice-time-${msgId}`);
  if (!audio || !bar) return;

  const cur = audio.currentTime || 0;
  const dur = audio.duration || 1;
  bar.style.width = ((cur / dur) * 100) + '%';
  if (time && typeof formatAudioDuration === 'function') time.innerText = formatAudioDuration(cur);
}

function onCustomGroupVoiceEnded(msgId) {
  const btn = document.getElementById(`cg-voice-btn-${msgId}`);
  const bar = document.getElementById(`cg-voice-progress-${msgId}`);
  if (btn) btn.innerHTML = '<i class="fa-solid fa-play"></i>';
  if (bar) bar.style.width = '0%';
  if (currentPlayingCustomGroupVoiceId === msgId) currentPlayingCustomGroupVoiceId = null;
}

function seekCustomGroupVoice(msgId, event) {
  const audio = document.getElementById(`cg-voice-audio-${msgId}`);
  if (!audio || !audio.duration) return;
  const track = event.currentTarget;
  const rect = track.getBoundingClientRect();
  const clickX = event.clientX - rect.left;
  const pct = Math.max(0, Math.min(1, clickX / rect.width));
  audio.currentTime = pct * audio.duration;
}

// 8. File Handling for Custom Group
function handleCustomGroupFileSelect(input) {
  if (!input || !input.files || !input.files[0]) return;
  selectedGroupFile = input.files[0];

  const preview = document.getElementById('customGroupFilePreviewSection');
  const nameEl = document.getElementById('customGroupPreviewName');
  const sizeEl = document.getElementById('customGroupPreviewSize');
  const iconEl = document.getElementById('customGroupPreviewIcon');

  if (nameEl) nameEl.innerText = selectedGroupFile.name;
  if (sizeEl) sizeEl.innerText = `${(selectedGroupFile.size / 1024).toFixed(1)} KB`;
  if (iconEl) {
    if (selectedGroupFile.type.startsWith('image/')) {
      iconEl.innerHTML = '<i class="fa-solid fa-image"></i>';
    } else if (selectedGroupFile.name.toLowerCase().endsWith('.pdf')) {
      iconEl.innerHTML = '<i class="fa-solid fa-file-pdf"></i>';
    } else {
      iconEl.innerHTML = '<i class="fa-solid fa-file"></i>';
    }
  }
  if (preview) preview.classList.remove('hidden');
}

function cancelCustomGroupFile() {
  selectedGroupFile = null;
  const fileInput = document.getElementById('customGroupFileInput');
  if (fileInput) fileInput.value = '';
  const preview = document.getElementById('customGroupFilePreviewSection');
  if (preview) preview.classList.add('hidden');
}

// 9. Voice Recording in Custom Group
async function toggleCustomGroupVoiceRecord() {
  if (customGroupMediaRecorder && customGroupMediaRecorder.state === 'recording') {
    finishAndSendCustomGroupVoiceRecord();
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    customGroupAudioChunks = [];
    customGroupMediaRecorder = new MediaRecorder(stream);
    customGroupMediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) customGroupAudioChunks.push(e.data);
    };

    customGroupVoiceDurationSecs = 0;
    const timerEl = document.getElementById('customGroupVoiceTimer');
    if (timerEl) timerEl.innerText = '00:00';
    const section = document.getElementById('customGroupVoiceRecordSection');
    if (section) section.classList.remove('hidden');

    customGroupVoiceInterval = setInterval(() => {
      customGroupVoiceDurationSecs++;
      if (timerEl && typeof formatAudioDuration === 'function') {
        timerEl.innerText = formatAudioDuration(customGroupVoiceDurationSecs);
      }
    }, 1000);

    customGroupMediaRecorder.start();
  } catch (err) {
    alert('ڕێگەپێدانی مایکرۆفۆن پێویستە بۆ تۆمارکردنی دەنگ');
  }
}

function cancelCustomGroupVoiceRecord() {
  if (customGroupMediaRecorder && customGroupMediaRecorder.state !== 'inactive') {
    customGroupMediaRecorder.stop();
    customGroupMediaRecorder.stream.getTracks().forEach(t => t.stop());
  }
  clearInterval(customGroupVoiceInterval);
  customGroupAudioChunks = [];
  const section = document.getElementById('customGroupVoiceRecordSection');
  if (section) section.classList.add('hidden');
}

function finishAndSendCustomGroupVoiceRecord() {
  if (!customGroupMediaRecorder || customGroupMediaRecorder.state !== 'recording') return;

  customGroupMediaRecorder.onstop = async () => {
    customGroupVoiceBlob = new Blob(customGroupAudioChunks, { type: 'audio/webm' });
    const section = document.getElementById('customGroupVoiceRecordSection');
    if (section) section.classList.add('hidden');
    clearInterval(customGroupVoiceInterval);

    // Upload voice blob and send as group audio message
    try {
      const formData = new FormData();
      formData.append('file', customGroupVoiceBlob, `voice_${Date.now()}.webm`);
      formData.append('type', 'audio');

      const uploadRes = await fetch(`/api/custom-groups/${activeCustomGroupId}/upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });
      const uploadData = await uploadRes.json();
      if (!uploadRes.ok) throw new Error(uploadData.error || 'هەڵە لە بارکردنی دەنگ');

      await fetch(`/api/custom-groups/${activeCustomGroupId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          content: '',
          type: 'audio',
          attachmentUrl: uploadData.fileUrl,
          attachmentName: 'دەنگی تۆمارکراو',
          attachmentSize: uploadData.fileSize
        })
      });
    } catch (err) {
      alert(err.message || 'هەڵە لە ناردنی دەنگ');
    }
  };

  customGroupMediaRecorder.stop();
  customGroupMediaRecorder.stream.getTracks().forEach(t => t.stop());
}

// 10. Send Message (Text & Attachment)
async function handleSendCustomGroupMessage(e) {
  if (e) e.preventDefault();
  if (!activeCustomGroupId) return;

  const textInput = document.getElementById('customGroupTextInput');
  const content = textInput ? textInput.value.trim() : '';

  if (!content && !selectedGroupFile) return;

  const sendBtn = document.getElementById('customGroupSendBtn');
  if (sendBtn) sendBtn.disabled = true;

  try {
    let attachmentUrl = null;
    let attachmentName = null;
    let attachmentSize = 0;
    let msgType = 'text';

    if (selectedGroupFile) {
      const formData = new FormData();
      formData.append('file', selectedGroupFile);
      const isImg = selectedGroupFile.type.startsWith('image/');
      formData.append('type', isImg ? 'image' : 'file');

      const uploadRes = await fetch(`/api/custom-groups/${activeCustomGroupId}/upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });
      const uploadData = await uploadRes.json();
      if (!uploadRes.ok) throw new Error(uploadData.error || 'هەڵە لە بارکردنی فایل');

      attachmentUrl = uploadData.fileUrl;
      attachmentName = uploadData.fileName;
      attachmentSize = uploadData.fileSize;
      msgType = isImg ? 'image' : 'file';
    }

    const res = await fetch(`/api/custom-groups/${activeCustomGroupId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        content,
        type: msgType,
        attachmentUrl,
        attachmentName,
        attachmentSize
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'هەڵە لە ناردنی پەیام');

    if (textInput) {
      textInput.value = '';
      textInput.style.height = 'auto';
    }
    cancelCustomGroupFile();
  } catch (err) {
    alert(err.message || 'هەڵە لە ناردن');
  } finally {
    if (sendBtn) sendBtn.disabled = false;
  }
}

// 11. Delete Message
async function deleteCustomGroupMessage(groupId, messageId) {
  if (!confirm('ئایا دڵنیایت لە سڕینەوەی ئەم پەیامە؟')) return;
  try {
    const res = await fetch(`/api/custom-groups/${groupId}/messages/${messageId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok) alert(data.error || 'هەڵە لە سڕینەوە');
  } catch (err) {
    alert('هەڵە لە پەیوەندی');
  }
}

// 12. Quick Helper: Insert @ڕاوێژکار into input
function insertAdvisorTagIntoInput() {
  const input = document.getElementById('customGroupTextInput');
  if (!input) return;
  const current = input.value.trim();
  if (!current.includes('@ڕاوێژکار')) {
    input.value = `@ڕاوێژکار ${current}`.trim() + ' ';
  }
  input.focus();
}

// 13. Super Admin: Create Group Modal Logic
async function openCreateCustomGroupModal() {
  const modal = document.getElementById('createCustomGroupModal');
  const nameInput = document.getElementById('newGroupNameInput');
  const searchInput = document.getElementById('newGroupMemberSearchInput');
  if (nameInput) nameInput.value = '';
  if (searchInput) searchInput.value = '';
  updateSelectedMembersBadge();

  if (modal) modal.classList.remove('hidden');

  const container = document.getElementById('newGroupMembersChecklist');
  if (container) {
    container.innerHTML = '<div class="text-center py-6 text-slate-500 text-xs">بارکردنی ئەندامان...</div>';
  }

  try {
    const res = await fetch('/api/admin/users', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      allUsersForGroupChecklistCache = (data.users || []).filter(u => u.id !== currentUser.id && u.status === 'approved');
      renderNewGroupMembersChecklist(allUsersForGroupChecklistCache);
    }
  } catch (e) {
    if (container) container.innerHTML = '<p class="text-center text-rose-400 text-xs py-4">هەڵە لە هێنانی ئەندامان</p>';
  }
}

function closeCreateCustomGroupModal() {
  const modal = document.getElementById('createCustomGroupModal');
  if (modal) modal.classList.add('hidden');
}

let manageGroupAvailableMembersCache = [];

function renderNewGroupMembersChecklist(usersList) {
  const container = document.getElementById('newGroupMembersChecklist');
  if (!container) return;

  if (!usersList.length) {
    container.innerHTML = '<p class="text-xs text-slate-500 text-center py-6 font-bold">هیچ ئەندامێک نەدۆزرایەوە.</p>';
    return;
  }

  container.innerHTML = usersList.map(u => {
    const nameClass = typeof getUserNameClass === 'function' ? getUserNameClass(u) : 'user-name-boy';
    const roleBadge = typeof renderRoleBadge === 'function' ? renderRoleBadge(u.role, u.gender || 'male') : '';
    const specialBadgeHtml = typeof renderSpecialBadgeHtml === 'function' ? renderSpecialBadgeHtml(u.special_badge) : '';
    const avatarHtml = u.avatar_url 
      ? `<img src="${escapeHtml(u.avatar_url)}" alt="Avatar" class="w-full h-full object-cover rounded-xl pointer-events-none select-none" draggable="false">` 
      : (typeof getGenderEmoji === 'function' ? getGenderEmoji(u.gender) : '👤');

    return `
      <label class="p-2.5 rounded-2xl bg-slate-800/80 hover:bg-slate-800 border border-slate-700/60 flex items-center justify-between gap-2.5 transition shadow-sm cursor-pointer select-none group">
        <div class="flex items-center gap-2.5 min-w-0 flex-1">
          <input type="checkbox" name="selectedGroupMembers" value="${u.id}" onchange="updateSelectedMembersBadge()" class="w-4 h-4 rounded text-amber-500 focus:ring-amber-500 bg-slate-900 border-slate-700 shrink-0">
          <div class="w-10 h-10 rounded-xl bg-slate-700/80 flex items-center justify-center text-sm font-black text-slate-300 shrink-0 shadow-inner border border-slate-600/40 overflow-hidden">
            ${avatarHtml}
          </div>
          <div class="min-w-0 flex-1">
            <div class="text-xs font-black flex items-center gap-1.5 flex-wrap">
              <span class="${nameClass} break-words leading-tight" title="${escapeHtml(u.full_name)}">${escapeHtml(u.full_name)}</span>
            </div>
            <div class="flex items-center gap-1.5 mt-1 flex-wrap">
              ${roleBadge}
              ${specialBadgeHtml}
            </div>
          </div>
        </div>
        <button type="button" onclick="event.preventDefault(); event.stopPropagation(); openUserProfileModal(${u.id})" class="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-indigo-400 text-xs rounded-lg hover:bg-slate-700/60 transition shrink-0" title="زانیاری">
          <i class="fa-solid fa-circle-info"></i>
        </button>
      </label>
    `;
  }).join('');
}

function filterNewGroupMembersList() {
  const q = (document.getElementById('newGroupMemberSearchInput')?.value || '').toLowerCase().trim();
  if (!q) {
    renderNewGroupMembersChecklist(allUsersForGroupChecklistCache);
    return;
  }
  const filtered = allUsersForGroupChecklistCache.filter(u => 
    (u.full_name && u.full_name.toLowerCase().includes(q)) ||
    (u.username && u.username.toLowerCase().includes(q))
  );
  renderNewGroupMembersChecklist(filtered);
}

function updateSelectedMembersBadge() {
  const checkboxes = document.querySelectorAll('input[name="selectedGroupMembers"]:checked');
  const badge = document.getElementById('selectedMembersCountBadge');
  if (badge) badge.innerText = `${checkboxes.length} هەڵبژێردراو`;
}

async function handleCreateCustomGroupSubmit(e) {
  e.preventDefault();
  const name = document.getElementById('newGroupNameInput')?.value.trim();
  if (!name) return alert('تکایە ناوی گروپ بنووسە');

  const checkboxes = document.querySelectorAll('input[name="selectedGroupMembers"]:checked');
  const memberIds = Array.from(checkboxes).map(cb => parseInt(cb.value, 10));

  const btn = document.getElementById('createGroupSubmitBtn');
  if (btn) btn.disabled = true;

  try {
    const res = await fetch('/api/custom-groups', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ name, memberIds })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'هەڵە لە دروستکردن');

    closeCreateCustomGroupModal();
    await loadUserCustomGroups();
    if (data.group && data.group.id) {
      openCustomGroupChatModal(data.group.id);
    }
  } catch (err) {
    alert(err.message || 'هەڵە لە دروستکردنی گروپ');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// 14. Super Admin: Manage Group Modal Logic
async function openCustomGroupManageModal() {
  if (!activeCustomGroupId) return;
  const modal = document.getElementById('customGroupManageModal');
  if (modal) modal.classList.remove('hidden');

  const nameInput = document.getElementById('manageGroupNameInput');
  if (nameInput && activeCustomGroupData) {
    nameInput.value = activeCustomGroupData.name || '';
  }

  await refreshManageGroupMembersUI();
}

function closeCustomGroupManageModal() {
  const modal = document.getElementById('customGroupManageModal');
  if (modal) modal.classList.add('hidden');
}

async function refreshManageGroupMembersUI() {
  if (!activeCustomGroupId) return;
  const list = document.getElementById('manageGroupMembersList');
  const badge = document.getElementById('manageGroupMembersBadge');
  const searchInput = document.getElementById('manageGroupMemberSearchInput');
  if (searchInput) searchInput.value = '';

  try {
    const [groupRes, allUsersRes] = await Promise.all([
      fetch(`/api/custom-groups/${activeCustomGroupId}`, { headers: { 'Authorization': `Bearer ${token}` } }),
      fetch('/api/admin/users', { headers: { 'Authorization': `Bearer ${token}` } })
    ]);

    if (groupRes.ok && allUsersRes.ok) {
      const gData = await groupRes.json();
      activeCustomGroupData = gData.group;
      const members = activeCustomGroupData.members || [];
      const allUsers = (await allUsersRes.json()).users || [];

      if (badge) badge.innerText = `${members.length} ئەندام`;

      // 1. Render Current Members List exactly like screenshot
      if (list) {
        if (!members.length) {
          list.innerHTML = '<p class="text-center text-xs text-slate-500 py-6 font-bold">هیچ ئەندامێک لەم گروپەدا نییە.</p>';
        } else {
          list.innerHTML = members.map(m => {
            const isCreator = m.id === activeCustomGroupData.created_by_id || m.role === 'super_admin';
            const nameClass = typeof getUserNameClass === 'function' ? getUserNameClass(m) : 'user-name-boy';
            const roleBadge = typeof renderRoleBadge === 'function' ? renderRoleBadge(m.role, 'male') : '';
            const specialBadgeHtml = typeof renderSpecialBadgeHtml === 'function' ? renderSpecialBadgeHtml(m.special_badge) : '';
            const avatarHtml = m.avatar_url 
              ? `<img src="${escapeHtml(m.avatar_url)}" alt="Avatar" class="w-full h-full object-cover rounded-xl pointer-events-none select-none" draggable="false">` 
              : (typeof getGenderEmoji === 'function' ? getGenderEmoji(m.gender) : '👤');

            return `
              <div class="p-2.5 rounded-2xl bg-slate-800/80 hover:bg-slate-800 border border-slate-700/60 flex items-center justify-between gap-2.5 transition shadow-sm">
                <!-- Member Info -->
                <div class="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer" onclick="openUserProfileModal(${m.id})">
                  <div class="w-10 h-10 rounded-xl bg-slate-700/80 flex items-center justify-center text-sm font-black text-slate-300 shrink-0 shadow-inner border border-slate-600/40 overflow-hidden">
                    ${avatarHtml}
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="text-xs font-black flex items-center gap-1.5 flex-wrap">
                      <span class="${nameClass} break-words leading-tight" title="${escapeHtml(m.full_name)}">${escapeHtml(m.full_name)}</span>
                      ${m.id === currentUser?.id ? '<span class="text-[9px] text-indigo-400 font-normal shrink-0">(تۆ)</span>' : ''}
                    </div>
                    <div class="flex items-center gap-1.5 mt-1 flex-wrap">
                      ${roleBadge}
                      ${specialBadgeHtml}
                    </div>
                  </div>
                </div>

                <!-- Action Buttons: Info & Remove -->
                <div class="flex items-center gap-1.5 shrink-0">
                  <button type="button" onclick="openUserProfileModal(${m.id})" class="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-indigo-400 text-xs rounded-lg hover:bg-slate-700/60 transition shrink-0" title="زانیاری">
                    <i class="fa-solid fa-circle-info"></i>
                  </button>
                  ${!isCreator ? `
                    <button type="button" onclick="removeMemberFromCustomGroup(${m.id})" class="px-2.5 py-1.5 rounded-xl bg-rose-500/20 text-rose-300 hover:bg-rose-500 hover:text-white text-xs font-bold transition flex items-center gap-1 active:scale-95 shadow shrink-0" title="لابردن لە گروپ">
                      <i class="fa-solid fa-user-minus text-[10px]"></i>
                      <span>لابردن</span>
                    </button>
                  ` : `<span class="text-[10px] text-amber-400 font-black px-2 py-1 rounded-xl bg-amber-500/10 border border-amber-500/30 shrink-0">سەرپەرشتیار</span>`}
                </div>
              </div>
            `;
          }).join('');
        }
      }

      // 2. Filter & Render Available Non-Members with Search
      const memberIds = new Set(members.map(m => m.id));
      manageGroupAvailableMembersCache = allUsers.filter(u => !memberIds.has(u.id) && u.status === 'approved');
      renderManageGroupAvailableMembers(manageGroupAvailableMembersCache);
    }
  } catch (err) {
    console.error('Error refreshing manage group members:', err);
  }
}

function renderManageGroupAvailableMembers(usersList) {
  const container = document.getElementById('manageGroupAvailableMembersList');
  const badge = document.getElementById('manageGroupAvailableBadge');
  if (!container) return;

  if (badge) badge.innerText = `${usersList.length} ئەندام`;

  if (!usersList.length) {
    container.innerHTML = `
      <div class="text-center py-6 text-slate-500">
        <i class="fa-solid fa-user-check text-2xl text-emerald-500/40 mb-2 block"></i>
        <p class="text-xs font-bold">هیچ ئەندامێکی تر نەماوە بۆ زیادکردن</p>
      </div>
    `;
    return;
  }

  container.innerHTML = usersList.map(u => {
    const nameClass = typeof getUserNameClass === 'function' ? getUserNameClass(u) : 'user-name-boy';
    const roleBadge = typeof renderRoleBadge === 'function' ? renderRoleBadge(u.role, u.gender) : '';
    const specialBadgeHtml = typeof renderSpecialBadgeHtml === 'function' ? renderSpecialBadgeHtml(u.special_badge) : '';
    const avatarHtml = u.avatar_url 
      ? `<img src="${escapeHtml(u.avatar_url)}" alt="Avatar" class="w-full h-full object-cover rounded-xl pointer-events-none select-none" draggable="false">` 
      : (typeof getGenderEmoji === 'function' ? getGenderEmoji(u.gender) : '👤');

    return `
      <div class="p-2.5 rounded-2xl bg-slate-800/80 hover:bg-slate-800 border border-slate-700/60 flex items-center justify-between gap-2.5 transition shadow-sm">
        <!-- Member Info -->
        <div class="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer" onclick="openUserProfileModal(${u.id})">
          <div class="w-10 h-10 rounded-xl bg-slate-700/80 flex items-center justify-center text-sm font-black text-slate-300 shrink-0 shadow-inner border border-slate-600/40 overflow-hidden">
            ${avatarHtml}
          </div>
          <div class="min-w-0 flex-1">
            <div class="text-xs font-black flex items-center gap-1.5 flex-wrap">
              <span class="${nameClass} break-words leading-tight" title="${escapeHtml(u.full_name)}">${escapeHtml(u.full_name)}</span>
            </div>
            <div class="flex items-center gap-1.5 mt-1 flex-wrap">
              ${roleBadge}
              ${specialBadgeHtml}
            </div>
          </div>
        </div>

        <!-- Action Buttons: Info & Add -->
        <div class="flex items-center gap-1.5 shrink-0">
          <button type="button" onclick="openUserProfileModal(${u.id})" class="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-indigo-400 text-xs rounded-lg hover:bg-slate-700/60 transition shrink-0" title="زانیاری">
            <i class="fa-solid fa-circle-info"></i>
          </button>
          <button type="button" onclick="addSpecificMemberToCustomGroup(${u.id})" class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-black transition flex items-center gap-1.5 shadow active:scale-95 shrink-0" title="زیادکردن بۆ گروپ">
            <i class="fa-solid fa-plus text-[10px]"></i>
            <span>زیادکردن</span>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function filterManageGroupAvailableMembers() {
  const q = (document.getElementById('manageGroupMemberSearchInput')?.value || '').toLowerCase().trim();
  if (!q) {
    renderManageGroupAvailableMembers(manageGroupAvailableMembersCache);
    return;
  }
  const filtered = manageGroupAvailableMembersCache.filter(u => 
    (u.full_name && u.full_name.toLowerCase().includes(q)) ||
    (u.username && u.username.toLowerCase().includes(q))
  );
  renderManageGroupAvailableMembers(filtered);
}

async function addSpecificMemberToCustomGroup(userId) {
  if (!activeCustomGroupId || !userId) return;
  try {
    const res = await fetch(`/api/custom-groups/${activeCustomGroupId}/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ userId })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'هەڵە لە زیادکردن');

    await refreshManageGroupMembersUI();
    await loadUserCustomGroups();
  } catch (err) {
    alert(err.message || 'هەڵە لە زیادکردنی ئەندام');
  }
}

async function saveCustomGroupRenamed() {
  if (!activeCustomGroupId) return;
  const name = document.getElementById('manageGroupNameInput')?.value.trim();
  if (!name) return alert('تکایە ناو بنووسە');

  try {
    const res = await fetch(`/api/custom-groups/${activeCustomGroupId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ name })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'هەڵە لە گۆڕینی ناو');

    document.getElementById('customGroupModalTitle').innerText = name;
    await loadUserCustomGroups();
    alert('ناوی گروپەکە گۆڕدرا ✅');
  } catch (err) {
    alert(err.message || 'هەڵە لە نوێکردنەوە');
  }
}

async function removeMemberFromCustomGroup(userId) {
  if (!activeCustomGroupId) return;
  if (!confirm('ئایا دڵنیایت لە دەرهێنانی ئەم ئەندامە لە گروپ؟')) return;

  try {
    const res = await fetch(`/api/custom-groups/${activeCustomGroupId}/members/${userId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'هەڵە لە لابردن');

    await refreshManageGroupMembersUI();
    await loadUserCustomGroups();
  } catch (err) {
    alert(err.message || 'هەڵە لە لابردنی ئەندام');
  }
}

async function confirmDeleteCustomGroup() {
  if (!activeCustomGroupId) return;
  if (!confirm('⚠️ ئایا تەواو دڵنیایت لە سڕینەوەی ئەم گروپ چاتە و هەموو پەیامەکانی؟')) return;

  try {
    const res = await fetch(`/api/custom-groups/${activeCustomGroupId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'هەڵە لە سڕینەوە');

    closeCustomGroupManageModal();
    closeCustomGroupChatModal();
    await loadUserCustomGroups();
    alert('گروپ چاتەکە بە سەرکەوتوویی سڕایەوە ✅');
  } catch (err) {
    alert(err.message || 'هەڵە لە سڕینەوەی گروپ');
  }
}

// 15. Socket event handlers
function handleIncomingCustomGroupMessage(data) {
  if (!data || !data.message) return;
  const msg = data.message;
  if (activeCustomGroupId === data.groupId) {
    activeGroupMessages.push(msg);
    const container = document.getElementById('customGroupMessagesContainer');
    if (container) {
      const isSuperAdmin = typeof currentUser !== 'undefined' && currentUser && currentUser.role === 'super_admin';
      const div = document.createElement('div');
      div.innerHTML = buildCustomGroupMessageHtml(msg, isSuperAdmin);
      container.appendChild(div.firstElementChild);
      scrollCustomGroupToBottom();
    }
    // Mark read
    fetch(`/api/custom-groups/${data.groupId}/mark-read`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    }).catch(() => {});
  } else {
    const grp = userCustomGroupsCache.find(g => g.id === data.groupId);
    if (grp) {
      grp.unread_count = (grp.unread_count || 0) + 1;
      renderCustomGroupsHeader();
      renderDrawerCustomGroups();
    } else {
      loadUserCustomGroups();
    }
    if (typeof playSound === 'function') playSound('message');
  }
}

function handleCustomGroupActivity(data) {
  if (!data) return;
  if (data.groupId !== activeCustomGroupId) {
    const grp = userCustomGroupsCache.find(g => g.id === data.groupId);
    if (grp) {
      grp.unread_count = (grp.unread_count || 0) + 1;
      renderCustomGroupsHeader();
      renderDrawerCustomGroups();
    } else {
      loadUserCustomGroups();
    }
  }
}

function handleGroupAdvisorTyping(data) {
  if (!data || data.groupId !== activeCustomGroupId) return;
  const banner = document.getElementById('customGroupAdvisorTyping');
  if (banner) {
    if (data.isTyping) {
      banner.classList.remove('hidden');
      scrollCustomGroupToBottom();
    } else {
      banner.classList.add('hidden');
    }
  }
}

function handleCustomGroupUserTyping(data) {
  if (!data || data.groupId !== activeCustomGroupId) return;
  const indicator = document.getElementById('customGroupUserTyping');
  const textEl = document.getElementById('customGroupUserTypingText');
  if (indicator && textEl) {
    if (data.isTyping) {
      textEl.innerText = `${data.userName} دەنووسێت...`;
      indicator.classList.remove('hidden');
    } else {
      indicator.classList.add('hidden');
    }
  }
}

function handleGroupMessageDeleted(data) {
  if (!data || data.groupId !== activeCustomGroupId) return;
  const el = document.getElementById(`cg-msg-${data.messageId}`);
  if (el) {
    el.style.opacity = '0';
    el.style.transform = 'scale(0.9)';
    setTimeout(() => el.remove(), 250);
  }
}

function updateCustomGroupMembersCount(members) {
  if (Array.isArray(members)) {
    const countEl = document.getElementById('customGroupMembersCountText');
    if (countEl) countEl.innerText = `${members.length} ئەندام`;
  }
}
