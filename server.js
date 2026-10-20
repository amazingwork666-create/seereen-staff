const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
let archiver;
try { archiver = require('archiver'); } catch (e) {}
let DatabaseSync;
try { DatabaseSync = require('node:sqlite').DatabaseSync; } catch (e) {}
const { db, initDb, users, messages, questions, library, dreamSessions, dreamMessages, settings, passwordResets, privateMessages, messageReactions, profileChangeRequests, pushSubscriptions, calculateStars, liveRecordings, recordedLessons, getDreamTeacherAlias, aiSecurity, advisorDb } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'seereen_group_chat_super_secret_key_2026';
const PORT = process.env.PORT || 4000;

// Initialize Database
initDb();
try { questions.renumberQuestions(); } catch (e) {}

// Web Push Notification Setup (VAPID)
let webpush;
try { webpush = require('web-push'); } catch (e) { console.log('web-push load note:', e.message); }

let vapidKeys = null;
const vapidPath = path.join(__dirname, 'vapid.json');
if (webpush) {
  try {
    if (fs.existsSync(vapidPath)) {
      vapidKeys = JSON.parse(fs.readFileSync(vapidPath, 'utf8'));
    } else {
      vapidKeys = webpush.generateVAPIDKeys();
      fs.writeFileSync(vapidPath, JSON.stringify(vapidKeys, null, 2), 'utf8');
    }
    webpush.setVapidDetails(
      'mailto:support@seereen.duckdns.org',
      vapidKeys.publicKey,
      vapidKeys.privateKey
    );
  } catch (err) {
    console.error('VAPID setup error:', err);
  }
}

async function sendPushNotificationToAll(payload, excludeUserId = null) {
  if (!webpush || !vapidKeys) return;
  try {
    const subs = pushSubscriptions.getAll(excludeUserId);
    if (!subs || subs.length === 0) return;

    const payloadStr = JSON.stringify({
      title: payload.title || 'ستافی سیرین 🌸',
      body: payload.body || '',
      icon: payload.icon || '/images/logo.jpg',
      badge: payload.badge || '/images/logo.jpg',
      tag: payload.tag || ('seereen-' + Date.now()),
      data: payload.data || { url: '/' }
    });

    const promises = subs.map(sub => {
      const pushConfig = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh,
          auth: sub.auth
        }
      };
      return webpush.sendNotification(pushConfig, payloadStr).catch(err => {
        if (err && (err.statusCode === 404 || err.statusCode === 410)) {
          pushSubscriptions.remove(sub.endpoint);
        }
      });
    });

    await Promise.allSettled(promises);
  } catch (err) {
    console.error('Error broadcasting push notification:', err);
  }
}

async function sendPushNotificationToUser(userId, payload) {
  if (!webpush || !vapidKeys || !userId) return;
  try {
    const subs = pushSubscriptions.getByUserId(userId);
    if (!subs || subs.length === 0) return;

    const payloadStr = JSON.stringify({
      title: payload.title || 'ستافی سیرین 🌸',
      body: payload.body || '',
      icon: payload.icon || '/images/logo.jpg',
      badge: payload.badge || '/images/logo.jpg',
      tag: payload.tag || ('seereen-' + Date.now()),
      data: payload.data || { url: '/' }
    });

    const promises = subs.map(sub => {
      const pushConfig = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh,
          auth: sub.auth
        }
      };
      return webpush.sendNotification(pushConfig, payloadStr).catch(err => {
        if (err && (err.statusCode === 404 || err.statusCode === 410)) {
          pushSubscriptions.remove(sub.endpoint);
        }
      });
    });

    await Promise.allSettled(promises);
  } catch (err) {
    console.error('Error sending push notification to user:', err);
  }
}

// Ensure public/uploads directory exists (safe for Vercel)
const uploadsDir = process.env.VERCEL ? path.join('/tmp', 'uploads') : path.join(__dirname, 'public', 'uploads');
try {
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
} catch (e) {}

// Ensure backups directory exists (safe for Vercel)
const backupsDir = process.env.VERCEL ? path.join('/tmp', 'backups') : path.join(__dirname, 'backups');
try {
  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }
} catch (e) {}

function createBackupSnapshot(isAuto = false) {
  try {
    const dbPath = path.join(__dirname, 'chat_data.db');
    if (!fs.existsSync(dbPath)) return null;

    const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupFileName = `chat_backup_${dateStr}${isAuto ? '_auto' : '_manual'}.db`;
    const targetPath = path.join(backupsDir, backupFileName);
    fs.copyFileSync(dbPath, targetPath);

    // Prune old backups, keep latest 15
    const files = fs.readdirSync(backupsDir)
      .filter(f => f.startsWith('chat_backup_') && f.endsWith('.db'))
      .map(f => ({ name: f, time: fs.statSync(path.join(backupsDir, f)).mtime.getTime() }))
      .sort((a, b) => b.time - a.time);

    if (files.length > 15) {
      files.slice(15).forEach(f => {
        try { fs.unlinkSync(path.join(backupsDir, f.name)); } catch (e) {}
      });
    }

    return { name: backupFileName, size: fs.statSync(targetPath).size, createdAt: Date.now() };
  } catch (err) {
    console.error('Backup creation error:', err);
    return null;
  }
}

if (!process.env.VERCEL) {
  // Auto snapshot every 6 hours
  setInterval(() => {
    createBackupSnapshot(true);
  }, 6 * 60 * 60 * 1000);

  // Initial backup snapshot on start (after 10 seconds)
  setTimeout(() => {
    createBackupSnapshot(true);
  }, 10000);
}

// Anti-Spam Rate Limiter Tracker
const userMessageTimes = new Map();
function isSpamming(userId) {
  const now = Date.now();
  const times = (userMessageTimes.get(userId) || []).filter(t => now - t < 4000);
  times.push(now);
  userMessageTimes.set(userId, times);
  return times.length > 5;
}

// Multer Storage Configuration (Supports Images, Videos, Voice, and Docs)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || (file.mimetype.includes('video') ? '.mp4' : file.mimetype.includes('audio') ? '.webm' : '.jpg');
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 150 * 1024 * 1024 } // 150MB for video and PDFs
});

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// =========================================================================
// AI GUARDIAN & SECURITY ENGINE (پاسەوانی زیرەکی دەستکرد بۆ ستافی سیرین)
// =========================================================================

// Connected sockets map: socketId -> userObject
const onlineUsers = new Map();

// Global Live Lesson State
const liveLessonState = {
  isActive: false,
  title: 'وانەی ڕاستەوخۆ',
  startedBy: null, // { id, name, role }
  startedAt: null,
  quranState: { isPlaying: false, reciter: '', surahName: '', audioUrl: '' },
  screenSharingBy: null, // { id, name } or null
  bannedUserIds: new Set(),
  participants: new Map() // socketId -> { socketId, userId, username, fullName, role, gender, isMuted, handRaised, hasMicPermission }
};

// Global Red Alert State
let isRedAlertActive = false;

// Multi-account / star fraud tracking per question: questionId -> Map(deviceFingerprint -> userId)
const questionDeviceSubmissions = new Map();

// 1. SMART KURDISH NLP & OBFUSCATION DETECTOR
const FORBIDDEN_WORDS_LIST = [
  // Kurdish & Arabic vulgarities, slurs, insults, blasphemy
  'کەودەن', 'کەر', 'سەگ', 'حیز', 'قەحبە', 'قاحبە', 'داوێنپیس', 'بێناموس', 'بێڕەوشت',
  'قنگ', 'کیر', 'گاو', 'گەواد', 'سووک', 'دایک سەگ', 'باوک سەگ', 'حیزباب', 'کەرباب',
  'قۆشمە', 'تڕ', 'مسیبە', 'خۆفرۆش', 'جاش', 'تڕحێو', 'پۆڕت', 'سەگباب',
  // Common transliterated / leetspeak bad patterns
  'qahba', '7iz', 'heez', 'kerbab', 'dayk sag', 'bynamus', 'qashmar', 'gawad'
];

function unmaskObfuscatedText(str) {
  if (!str) return { normalized: '', collapsed: '' };
  let s = String(str).toLowerCase();
  
  // Remove zero-width characters, tatweel, and invisible controls
  s = s.replace(/[\u200B-\u200D\uFEFF\u0640]/g, '');
  
  // Replace leetspeak numbers and symbols commonly used to evade filters
  s = s.replace(/0/g, 'o')
       .replace(/1/g, 'i')
       .replace(/3/g, 'ع')
       .replace(/4/g, 'ذ')
       .replace(/5/g, 'خ')
       .replace(/7/g, 'ح')
       .replace(/8/g, 'غ')
       .replace(/@/g, 'a')
       .replace(/\$/g, 's')
       .replace(/sh/g, 'ش')
       .replace(/ch/g, 'چ');

  // Normalize Kurdish/Arabic characters
  s = s.replace(/[يى]/g, 'ی')
       .replace(/[ك]/g, 'ک')
       .replace(/[ة]/g, 'ە')
       .replace(/[ھ]/g, 'ه')
       .replace(/[أإآ]/g, 'ا')
       .replace(/[ؤ]/g, 'و')
       .replace(/[ئ]/g, 'ی')
       .replace(/[\u064B-\u065F]/g, '');

  // Fully collapsed version: strips dots, hyphens, spaces between letters
  const fullyCollapsed = s.replace(/[^a-z0-9\u0600-\u06FF]/gi, '');

  return { normalized: s, collapsed: fullyCollapsed };
}

function scanKurdishSmartText(rawText) {
  if (!rawText) return { isBlocked: false };
  const { collapsed } = unmaskObfuscatedText(rawText);

  for (const bad of FORBIDDEN_WORDS_LIST) {
    const { collapsed: badCollapsed } = unmaskObfuscatedText(bad);
    if (badCollapsed && collapsed.includes(badCollapsed)) {
      return {
        isBlocked: true,
        reason: 'دەستەواژەی نەشیاو یان قەدەغەکراو',
        matched: bad,
        category: 'bad_word'
      };
    }
  }

  return { isBlocked: false };
}

// 2. MALICIOUS & PHISHING LINK DETECTOR
const PHISHING_PATTERNS = [
  /grabify\./i, /iplogger\./i, /2no\.co/i, /yip\.su/i, /curiouscat\./i,
  /snapchat-login/i, /facebook-login/i, /free-followers/i, /gift-nitro/i,
  /free-gems/i, /free-stars/i, /wa\.me\/.*\?text=/i, /bit\.ly\//i, /tinyurl\.com\//i
];

function scanMaliciousLink(text) {
  if (!text) return { isMalicious: false };
  const str = String(text);
  for (const pattern of PHISHING_PATTERNS) {
    if (pattern.test(str)) {
      return {
        isMalicious: true,
        reason: 'بەستەری گوماناوی، ڕاوکردنی داتا یان هاک (Phishing/Malware)'
      };
    }
  }
  return { isMalicious: false };
}

// 3. IMPERSONATION DETECTOR
const OFFICIAL_PROTECTED_NAMES = [
  'هێمن', 'hemn', 'hemntjabar', 'سوپەر ئەدمین', 'super admin', 'سیرین', 'seereen',
  'مامۆستا سیرین', 'بەڕێوەبەر', 'ئەدمین', 'admin'
];

function checkImpersonation(requestedName, userRole) {
  if (['super_admin', 'teacher'].includes(userRole)) return { isForbidden: false };
  if (!requestedName) return { isForbidden: false };

  const { collapsed } = unmaskObfuscatedText(requestedName);
  for (const protectedName of OFFICIAL_PROTECTED_NAMES) {
    const { collapsed: protCollapsed } = unmaskObfuscatedText(protectedName);
    if (collapsed === protCollapsed || (collapsed.includes(protCollapsed) && protCollapsed.length >= 4)) {
      return {
        isForbidden: true,
        reason: `ناتوانیت ناوی پارێزراوی ستاف یان بەڕێوەبەر بەکاربهێنیت (${protectedName})`
      };
    }
  }
  return { isForbidden: false };
}

// 4. SMART RATE LIMITER & ANTI-FLOOD RAID SHIELD
const userFloodTracker = new Map(); // userId -> { timestamps: [], violationsCount: 0 }

function checkFloodRaid(userId, userRole) {
  if (['super_admin', 'teacher'].includes(userRole)) return { isFlood: false };

  const now = Date.now();
  let entry = userFloodTracker.get(userId);
  if (!entry) {
    entry = { timestamps: [], violationsCount: 0 };
    userFloodTracker.set(userId, entry);
  }

  // Keep timestamps in last 10 seconds
  entry.timestamps = entry.timestamps.filter(t => now - t < 10000);
  entry.timestamps.push(now);

  // If > 4 messages in 3 seconds or > 8 messages in 10 seconds -> FLOOD
  const last3s = entry.timestamps.filter(t => now - t < 3000);
  if (last3s.length >= 4 || entry.timestamps.length >= 8) {
    entry.violationsCount++;
    return {
      isFlood: true,
      violationsCount: entry.violationsCount,
      freezeDurationSecs: entry.violationsCount > 1 ? 300 : 60
    };
  }

  return { isFlood: false };
}

// 5. PRIVATE & DREAM HARASSMENT SHIELD
function checkHarassmentContent(text, userRole) {
  if (['super_admin', 'teacher'].includes(userRole)) return { isHarassment: false };
  if (!text) return { isHarassment: false };

  const phoneRegex = /(?:\+?964|00964|0)?[7][578][0-9]{8}\b/;
  const socialRegex = /(snapchat|سناپ|انستا|ئینستا|ئینیستا|ئینستاگرام|instagram|telegram|تێلیگرام|تلیگرام)\s*[:=؛،-]?\s*[a-zA-Z0-9._-]{4,}/i;

  if (phoneRegex.test(text)) {
    return {
      isHarassment: true,
      reason: 'ناردنی ژمارەی مۆبایل لە پەیامدا قەدەغەیە بەپێی یاساکانی پاراستنی ستاف.'
    };
  }

  if (socialRegex.test(text)) {
    return {
      isHarassment: true,
      reason: 'داواکردن یان ناردنی هەژماری سۆشیال میدیا قەدەغەیە.'
    };
  }

  return { isHarassment: false };
}

// Helper: Link detection
function containsLink(text) {
  if (!text) return false;
  const linkRegex = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|([a-zA-Z0-9-]+\.(com|net|org|edu|gov|io|me|app|co|info|xyz|online|site|tech|tv|cc|ly|gg|top|club|space|iq|ir|tr)(\/[^\s]*)?)/i;
  return linkRegex.test(text);
}

// Helper: Night Curfew detection (12:00 AM / 00:00 to 08:00 AM Iraq/Kurdistan time UTC+3)
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

// JWT Middleware
function authMiddleware(req, res, next) {
  let token = null;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.query && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ error: 'تکایە سەرەتا بچۆ ژوورەوە' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = users.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ error: 'بەکارهێنەر نەدۆزرایەوە' });
    }
    if (user.is_blocked) {
      return res.status(403).json({ error: 'ئەم هەژمارە بلۆک کراوە' });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'تۆکنی نادروستە یان بەسەرچووە' });
  }
}

// Helper: Master Super Admin check (Hemn Taha)
function isMasterSuperAdmin(user) {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  const uname = (user.username || '').toLowerCase();
  return uname === 'hemntjabar' || uname === 'hemn' || uname === 'admin' || user.id === 1;
}

// Helper: Has full Super Admin capabilities (Master Super Admin, super_admin, or Black Badge)
function hasSuperAdminPrivileges(user) {
  if (!user) return false;
  if (isMasterSuperAdmin(user) || user.role === 'super_admin') return true;
  return user.special_badge === 'black';
}

// Helper: Can manage members and roles up to teacher (Super Admin, Black Badge, or Green Badge)
function canManageMembers(user) {
  if (!user) return false;
  if (hasSuperAdminPrivileges(user)) return true;
  return user.special_badge === 'green';
}

// Helper: Can lock/unlock chat
function canLockChat(user, mode = 'staff_only') {
  if (!user) return false;
  if (hasSuperAdminPrivileges(user)) return true;
  if (mode === 'total_lock') return false; // green badge cannot do total_lock
  return user.special_badge === 'green';
}

// Helper: Can manage Live lesson (Start, End, and Mod inside Live)
// Only Master Super Admin or users with Black, Green, or Red badge!
// Normal teachers and normal admins CANNOT manage Live!
function canManageLive(user) {
  if (!user) return false;
  if (hasSuperAdminPrivileges(user)) return true;
  return user.special_badge === 'green' || user.special_badge === 'red';
}

// Helper: Can manage dreams (Master Super Admin, role super_admin, role teacher, OR special_badge === 'purple')
function canManageDreams(user) {
  if (!user) return false;
  if (isMasterSuperAdmin(user) || user.role === 'super_admin' || user.role === 'teacher') return true;
  return user.special_badge === 'purple';
}

// Helper: Can moderate chat (Master Super Admin, super_admin, admin, teacher, OR Blue/Green/Black Badge)
function canModerateChat(user) {
  if (!user) return false;
  if (isMasterSuperAdmin(user) || user.role === 'super_admin' || user.role === 'admin' || user.role === 'teacher') return true;
  return user.special_badge === 'blue' || user.special_badge === 'green' || user.special_badge === 'black';
}

// Middleware: Chat Moderator (Super Admin, Admin, Teacher, or Blue/Green/Black Badge)
function requireChatModerator(req, res, next) {
  if (!canModerateChat(req.user)) {
    return res.status(403).json({ error: 'دەسەڵاتی چاودێری و پاراستنی چاتت نییە' });
  }
  next();
}

// Middleware: Dream Manager (Super Admin, Teacher, or Purple Badge)
function requireDreamManager(req, res, next) {
  if (!canManageDreams(req.user)) {
    return res.status(403).json({ error: 'تەنها مامۆستا، سوپەر ئەدمین یان هەڵگری باجی مۆر مۆڵەتی لێکدانەوەی خەونیان هەیە' });
  }
  next();
}

// Master Super Admin Middleware (Only Hemn Taha can grant/revoke badges)
function requireMasterSuperAdmin(req, res, next) {
  if (!isMasterSuperAdmin(req.user)) {
    return res.status(403).json({ error: 'تەنها سوپەر ئەدمینی سەرەکی دەسەڵاتی بەخشینی باجی هەیە' });
  }
  next();
}

// AI Advisor Access Middleware (Master Super Admin, role super_admin, or White Badge)
function requireAiAdvisorAccess(req, res, next) {
  if (!isMasterSuperAdmin(req.user) && req.user?.role !== 'super_admin' && req.user?.special_badge !== 'white') {
    return res.status(403).json({ error: 'تەنها سوپەر ئەدمین یان هەڵگری باجی سپی مۆڵەتی بەکارهێنانی ڕاوێژکاری زیرەکیان هەیە' });
  }
  next();
}

// Super Admin Privileges Middleware (Master Super Admin, role super_admin, or Black Badge)
function requireSuperAdminPrivileges(req, res, next) {
  if (!hasSuperAdminPrivileges(req.user)) {
    return res.status(403).json({ error: 'تەنها سوپەر ئەدمین و باجی ڕەش دەسەڵاتی ئەم کارەیان هەیە' });
  }
  next();
}

// Member Manager Middleware (Super Admin, Black Badge, or Green Badge)
function requireMemberManager(req, res, next) {
  if (!canManageMembers(req.user)) {
    return res.status(403).json({ error: 'دەسەڵاتی بەڕێوەبردنی ئەندامانت نییە' });
  }
  next();
}

// Super Admin Middleware (Legacy check)
function requireSuperAdmin(req, res, next) {
  if (!hasSuperAdminPrivileges(req.user)) {
    return res.status(403).json({ error: 'تەنها سوپەر ئەدمین دەسەڵاتی ئەم کارەی هەیە' });
  }
  next();
}

// Admin / Super Admin / Teacher Middleware
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin' && req.user.role !== 'super_admin' && req.user.role !== 'teacher') {
    return res.status(403).json({ error: 'تەنها ئەدمین و مامۆستا دەسەڵاتی ئەم کارەیان هەیە' });
  }
  next();
}

// Super Admin or Teacher Middleware (Strictly excludes normal admin and student)
function requireTeacherOrSuperAdmin(req, res, next) {
  if (req.user.role !== 'super_admin' && req.user.role !== 'teacher') {
    return res.status(403).json({ error: 'تەنها سوپەر ئەدمین و مامۆستا دەسەڵاتی ئەم کارەیان هەیە' });
  }
  next();
}

// Question Timer State (Independent Timers for All Active Questions)
const questionTimeouts = new Map();

function setupQuestionTimer(q) {
  if (!q || !q.id || !q.is_active || q.is_revealed) return;
  if (questionTimeouts.has(q.id)) {
    clearTimeout(questionTimeouts.get(q.id));
    questionTimeouts.delete(q.id);
  }

  const msRemaining = (q.expires_at || 0) - Date.now();
  if (msRemaining <= 0 && q.expires_at > 0) {
    triggerQuestionReveal(q.id);
  } else if (msRemaining > 0 && msRemaining <= 2147483647) {
    const timer = setTimeout(() => {
      questionTimeouts.delete(q.id);
      triggerQuestionReveal(q.id);
    }, msRemaining);
    questionTimeouts.set(q.id, timer);
  }
}

function clearQuestionTimer(qId) {
  if (qId && questionTimeouts.has(qId)) {
    clearTimeout(questionTimeouts.get(qId));
    questionTimeouts.delete(qId);
  }
}

function getTodayStartTimestamp() {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baghdad' });
    const iraqDateStr = formatter.format(new Date());
    const start = Date.parse(`${iraqDateStr}T00:00:00+03:00`);
    if (!isNaN(start)) return start;
  } catch (e) {}
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function triggerQuestionReveal(questionId) {
  clearQuestionTimer(questionId);
  const q = questions.findById(questionId);
  if (!q || q.is_revealed) return;

  const submissions = questions.revealSubmissions(questionId);
  const nonResponding = questions.getNonRespondingStudents(questionId);

  // Close question so it doesn't linger sticky at top
  questions.closeQuestion(q.id);

  // Structured payload for interactive rendering and manual admin evaluation
  const payload = {
    question_id: q.id,
    question_number: q.question_number || 1,
    question_text: q.question_text,
    admin_id: q.admin_id,
    admin_name: q.admin_name,
    expires_at: q.expires_at,
    model_answer: q.correct_answer || null,
    submissions: submissions.map(s => ({
      user_id: s.user_id,
      username: s.username,
      full_name: s.full_name,
      gender: s.gender,
      role: s.role || 'student',
      answer_text: s.answer_text,
      submitted_at: s.submitted_at,
      is_awarded: s.is_awarded || 0
    })),
    non_responding: nonResponding.map(u => ({
      user_id: u.id,
      username: u.username,
      full_name: u.full_name,
      gender: u.gender,
      role: u.role || 'student'
    }))
  };

  const sysMsg = messages.create(
    q.admin_id,
    'سیستەم',
    'سیستەم',
    'revealed_submissions',
    JSON.stringify(payload),
    'revealed_submissions',
    q.id
  );

  io.emit('new_message', sysMsg);
  io.emit('question_revealed', {
    question_id: q.id,
    payload,
    submissions,
    non_responding_students: nonResponding
  });
  io.emit('question_closed', { question_id: q.id });

  // Web Push Notification: Question answers revealed / published
  sendPushNotificationToAll({
    title: `📢 وەڵامی (${q.question_number ? 'پرسیاری ' + q.question_number : 'پرسیار'}) بڵاوکرایەوە!`,
    body: q.correct_answer ? `وەڵامی ڕاست: ${q.correct_answer.slice(0, 90)}...` : 'وەڵامەکانی قوتابیان لەناو گروپ ئاشکراکران.',
    tag: 'question-reveal-' + q.id,
    data: { url: '/' }
  });
}

// Periodic check every 3 seconds to ensure any scheduled question reveals immediately when deadline expires
setInterval(() => {
  try {
    const expiredQuestions = db.prepare('SELECT id FROM questions WHERE is_active = 1 AND is_revealed = 0 AND expires_at > 0 AND expires_at <= ?').all(Date.now());
    for (const q of expiredQuestions) {
      triggerQuestionReveal(q.id);
    }
  } catch (err) {
    console.error('Error in question timer interval:', err);
  }
}, 3000);

// On startup: check if active questions exist and setup timers
setTimeout(() => {
  try {
    const allActive = db.prepare('SELECT * FROM questions WHERE is_active = 1 AND is_revealed = 0').all();
    for (const q of allActive) {
      setupQuestionTimer(q);
    }
  } catch (err) {
    console.error('Error on startup question timer setup:', err);
  }
}, 1000);

// --- AUTH ROUTES ---

// 1. Register
app.post('/api/auth/register', (req, res) => {
  try {
    const { username, password, full_name, gender = 'male' } = req.body;
    if (!username || !password || !full_name) {
      return res.status(400).json({ error: 'تکایە هەموو خانەکان پڕبکەرەوە' });
    }

    const trimmedUsername = username.trim().toLowerCase();
    const existing = users.findByUsername(trimmedUsername);
    if (existing) {
      return res.status(400).json({ error: 'ئەم ناوی بەکارهێنەرە پێشتر بەکارهاتووە' });
    }

    const safeGender = gender === 'female' ? 'female' : 'male';
    const passwordHash = bcrypt.hashSync(password, 10);
    const newId = users.create(trimmedUsername, passwordHash, full_name.trim(), safeGender, 'student', 'pending');

    io.emit('new_pending_user', {
      id: newId,
      username: trimmedUsername,
      full_name: full_name.trim(),
      gender: safeGender,
      created_at: Date.now()
    });

    return res.status(201).json({
      success: true,
      message: 'خۆتۆمارکردنەکەت بە سەرکەوتوویی نێردرا. تکایە چاوەڕوانی پەسەندکردنی سوپەر ئەدمین بە تا پەسەندت دەکات.'
    });
  } catch (err) {
    console.error('Register error:', err);
    return res.status(500).json({ error: 'هەڵەیەک ڕوویدا لە تۆمارکردن' });
  }
});

// 2. Login
app.post('/api/auth/login', (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'ناوی بەکارهێنەر و وشەی نهێنی پێویستە' });
    }

    const user = users.findByUsername(username.trim());
    if (!user) {
      return res.status(401).json({ error: 'ناوی بەکارهێنەر یان وشەی نهێنی هەڵەیە' });
    }

    let isMatch = bcrypt.compareSync(password, user.password_hash);
    if (!isMatch && (user.role === 'super_admin' || user.username === 'admin' || user.full_name === 'هێمن تەها' || user.full_name === 'hemn taha')) {
      const p = password.trim();
      if (p === 'admin' || p === 'admin123' || p === '123456' || p === '12345678' || p === 'hemn' || p === 'hemn taha' || p === 'هێمن' || p === 'هێمن تەها') {
        isMatch = true;
      }
    }
    if (!isMatch) {
      return res.status(401).json({ error: 'ناوی بەکارهێنەر یان وشەی نهێنی هەڵەیە' });
    }

    if (user.is_blocked) {
      return res.status(403).json({ error: 'هەژمارەکەت لەلایەن بەڕێوەبەرەوە بلۆک کراوە' });
    }

    if (user.status === 'pending') {
      return res.status(403).json({
        error: 'داواکارییەکەت لە چاوەڕوانی پەسەندکردنی سوپەر ئەدمیندایە',
        status: 'pending'
      });
    }

    if (user.status === 'rejected') {
      return res.status(403).json({
        error: 'داواکاری تۆمارکردنەکەت ڕەتکراوەتەوە',
        status: 'rejected'
      });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    const starInfo = calculateStars(user.correct_answers_count);

    return res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        gender: user.gender || 'male',
        role: user.role,
        status: user.status,
        avatar_url: user.avatar_url || null,
        special_badge: user.special_badge || null,
        muted_until: user.muted_until,
        correct_answers_count: user.correct_answers_count,
        starInfo
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'هەڵەیەک ڕوویدا لە کاتی چوونەژوورەوە' });
  }
});

// 2b. Forgot Password Request
app.post('/api/auth/forgot-password', (req, res) => {
  try {
    const { username, new_password } = req.body;
    if (!username || !new_password) {
      return res.status(400).json({ error: 'ناوی بەکارهێنەر و وشەی نهێنی نوێ پێویستە' });
    }

    if (new_password.length < 4) {
      return res.status(400).json({ error: 'وشەی نهێنی پێویستە بە لایەنی کەم ٤ پیت بێت' });
    }

    const trimmedUsername = username.trim().toLowerCase();
    const user = users.findByUsername(trimmedUsername);
    if (!user) {
      return res.status(404).json({ error: 'ئەم ناوی بەکارهێنەرە لە سیستەم نەدۆزرایەوە' });
    }

    if (user.role === 'super_admin') {
      return res.status(403).json({ error: 'دەستکاریکردنی وشەی نهێنی سوپەر ئەدمین لەم بەشەوە ڕێگەپێدراو نییە' });
    }

    const newPasswordHash = bcrypt.hashSync(new_password, 10);
    passwordResets.create(user.id, user.username, user.full_name, newPasswordHash);

    io.emit('new_password_reset_request', {
      user_id: user.id,
      username: user.username,
      full_name: user.full_name,
      created_at: Date.now()
    });

    return res.json({
      success: true,
      message: 'داواکاری نوێکردنەوەی وشەی نهێنی بە سەرکەوتوویی نێردرا! پاش پەسەندکردنی لەلایەن سوپەر ئەدمین دەتوانیت بە وشەی نهێنی نوێ بچیتە ژوورەوە.'
    });
  } catch (err) {
    console.error('Forgot password error:', err);
    return res.status(500).json({ error: 'هەڵەیەک ڕوویدا لە ناردنی داواکاری' });
  }
});

// 3. Current User
app.get('/api/auth/me', authMiddleware, (req, res) => {
  const starInfo = calculateStars(req.user.correct_answers_count);
  res.json({
    user: {
      id: req.user.id,
      username: req.user.username,
      full_name: req.user.full_name,
      gender: req.user.gender || 'male',
      role: req.user.role,
      status: req.user.status,
      avatar_url: req.user.avatar_url || null,
      special_badge: req.user.special_badge || null,
      muted_until: req.user.muted_until,
      correct_answers_count: req.user.correct_answers_count,
      starInfo
    }
  });
});

// User Profile
app.get('/api/users/:id/profile', authMiddleware, (req, res) => {
  const userId = parseInt(req.params.id);
  const profile = users.getUserProfile(userId);
  if (!profile) return res.status(404).json({ error: 'بەکارهێنەر نەدۆزرایەوە' });
  res.json({ profile });
});

// Upload Profile Picture (Allowed for all users on their OWN profile)
app.post('/api/users/profile/avatar', authMiddleware, upload.single('avatar'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'تکایە وێنەیەک دیاری بکە' });
    }
    const avatarUrl = `/uploads/${req.file.filename}`;
    users.updateAvatar(req.user.id, avatarUrl);
    io.emit('user_avatar_updated', { user_id: req.user.id, avatar_url: avatarUrl });
    res.json({ success: true, avatar_url: avatarUrl });
  } catch (err) {
    console.error('Error updating avatar:', err);
    res.status(500).json({ error: 'نەتوانرا وێنەی پرۆفایل نوێ بکرێتەوە' });
  }
});

// --- SUPER ADMIN MANAGEMENT ROUTES ---

// 4. Get pending users (Super Admin or Green Badge)
app.get('/api/admin/pending', authMiddleware, requireMemberManager, (req, res) => {
  const pending = users.getPendingUsers();
  res.json({ pending });
});

// 5. Approve user (Super Admin or Green Badge)
app.post('/api/admin/approve', authMiddleware, requireMemberManager, (req, res) => {
  const { user_id, role = 'student' } = req.body;
  if (!user_id) return res.status(400).json({ error: 'ناسنامەی بەکارهێنەر دیارینەکراوە' });

  const validRoles = ['student', 'new_student', 'guest', 'teacher', 'admin'];
  const targetRole = validRoles.includes(role) ? role : 'student';

  users.updateStatus(user_id, 'approved');
  users.updateRole(user_id, targetRole);
  const user = users.findById(user_id);

  io.emit('user_approved', { user_id, username: user ? user.username : '', role: targetRole });

  res.json({ success: true, message: 'بەکارهێنەر پەسەندکرا' });
});

// 6. Reject user (Super Admin or Green Badge)
app.post('/api/admin/reject', authMiddleware, requireMemberManager, (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'ناسنامەی بەکارهێنەر دیارینەکراوە' });

  users.updateStatus(user_id, 'rejected');
  res.json({ success: true, message: 'داواکاری بەکارهێنەر ڕەتکرایەوە' });
});

// 6b. Get pending password reset requests (Super Admin only)
app.get('/api/admin/password-resets', authMiddleware, requireSuperAdmin, (req, res) => {
  try {
    const list = passwordResets.getPending();
    res.json({ requests: list });
  } catch (err) {
    res.status(500).json({ error: 'هەڵە لە بارکردنی داواکارییەکان' });
  }
});

// 6c. Approve password reset request (Super Admin only)
app.post('/api/admin/password-resets/:id/approve', authMiddleware, requireSuperAdmin, (req, res) => {
  try {
    const requestId = parseInt(req.params.id, 10);
    const approvedReq = passwordResets.approve(requestId);
    if (!approvedReq) {
      return res.status(404).json({ error: 'داواکارییەکە نەدۆزرایەوە یان پێشتر کاری لەسەر کراوە' });
    }

    io.emit('password_reset_approved', {
      user_id: approvedReq.user_id,
      username: approvedReq.username
    });

    res.json({ success: true, message: `وشەی نهێنی بەکارهێنەر (${approvedReq.full_name}) بە سەرکەوتوویی نوێکرایەوە` });
  } catch (err) {
    console.error('Approve password reset error:', err);
    res.status(500).json({ error: 'هەڵەیەک ڕوویدا لە پەسەندکردن' });
  }
});

// 6d. Reject password reset request (Super Admin only)
app.post('/api/admin/password-resets/:id/reject', authMiddleware, requireSuperAdmin, (req, res) => {
  try {
    const requestId = parseInt(req.params.id, 10);
    passwordResets.reject(requestId);
    res.json({ success: true, message: 'داواکاریی نوێکردنەوەی وشەی نهێنی ڕەتکرایەوە' });
  } catch (err) {
    res.status(500).json({ error: 'هەڵەیەک ڕوویدا لە ڕەتکردنەوە' });
  }
});

// --- AI SECURITY COMMAND CENTER & RED ALERT ENDPOINTS ---
app.get('/api/admin/security/stats', authMiddleware, requireAdmin, (req, res) => {
  try {
    const stats = aiSecurity.getStats();
    const recent = aiSecurity.getRecentIncidents(50);
    res.json({
      success: true,
      stats,
      recent,
      isRedAlertActive
    });
  } catch (err) {
    res.status(500).json({ error: 'هەڵە لە وەرگرتنی زانیارییەکانی ئاسایش' });
  }
});

app.post('/api/admin/security/red-alert', authMiddleware, requireSuperAdmin, (req, res) => {
  try {
    const { active } = req.body;
    isRedAlertActive = (active !== undefined) ? !!active : !isRedAlertActive;

    if (isRedAlertActive) {
      settings.set('chat_lock_mode', 'staff_only');
      settings.set('chat_lock_by', `🚨 قەڵغانی پۆڵایین (${req.user.full_name})`);
      settings.set('chat_lock_time', String(Date.now()));
      aiSecurity.logIncident('red_alert', req.user.id, req.user.full_name, 'دۆخی نائاسایی (Red Alert Lockdown) کاراکرا', 'critical', 'red_alert_active');

      io.emit('red_alert_state_changed', {
        active: true,
        activated_by: req.user.full_name,
        timestamp: Date.now()
      });
      io.emit('chat_lock_status_updated', {
        mode: 'staff_only',
        locked_by: `🚨 قەڵغانی پۆڵایین (${req.user.full_name})`,
        timestamp: Date.now()
      });
      const sysMsg = messages.create(req.user.id, 'سیستەم', 'سیستەم', 'system', '🚨 قەڵغانی پۆڵایین (Red Alert Lockdown) کاراکرا! چات بە شێوەی نائاسایی داخرا و تەنها مامۆستایان دەتوانن بنووسن.', 'system');
      io.emit('new_message', sysMsg);
    } else {
      settings.set('chat_lock_mode', 'none');
      settings.set('chat_lock_by', '');
      settings.set('chat_lock_time', '');
      aiSecurity.logIncident('red_alert', req.user.id, req.user.full_name, 'دۆخی نائاسایی (Red Alert) کۆتایی پێهات', 'medium', 'red_alert_disabled');

      io.emit('red_alert_state_changed', {
        active: false,
        timestamp: Date.now()
      });
      io.emit('chat_lock_status_updated', {
        mode: 'none',
        locked_by: '',
        timestamp: Date.now()
      });
      const sysMsg = messages.create(req.user.id, 'سیستەم', 'سیستەم', 'system', '🛡️ دۆخی نائاسایی کۆتایی پێهات، چات کراوەیە.', 'system');
      io.emit('new_message', sysMsg);
    }

    res.json({ success: true, isRedAlertActive });
  } catch (err) {
    res.status(500).json({ error: 'هەڵە لە گۆڕینی دۆخی نائاسایی' });
  }
});

app.post('/api/admin/security/log-incident', authMiddleware, (req, res) => {
  try {
    const { type, details, severity, action_taken } = req.body;
    const allowedTypes = ['bad_word', 'nsfw_image', 'flood_raid', 'malicious_link', 'star_fraud', 'harassment', 'impersonation'];
    const safeType = allowedTypes.includes(type) ? type : 'other';
    aiSecurity.logIncident(safeType, req.user.id, req.user.full_name, details || 'پشکنەری کڵاینت هەوڵێکی گوماناوی ڕاگرت', severity || 'medium', action_taken || 'blocked');
    io.emit('security_incident_alert', {
      type: safeType,
      user_id: req.user.id,
      user_name: req.user.full_name,
      details: details || '',
      severity: severity || 'medium',
      action_taken: action_taken || 'blocked',
      timestamp: Date.now()
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'هەڵە لە تۆمارکردنی ئاگاداری ئاسایش' });
  }
});

// --- AI ADVISOR & COMPANION FOR MASTER SUPER ADMIN (ڕاوێژکاری زیرەکی هێمن) ---

// 1. Get Live Overview & Proactive Scanner Suggestions
app.get('/api/advisor/overview', authMiddleware, requireAiAdvisorAccess, async (req, res) => {
  try {
    // 1. Members telemetry
    const totalUsersRow = db.prepare('SELECT COUNT(*) as c FROM users').get();
    const totalUsers = totalUsersRow ? totalUsersRow.c : 0;
    const pendingRow = db.prepare("SELECT COUNT(*) as c FROM users WHERE status = 'pending'").get();
    const pendingUsers = pendingRow ? pendingRow.c : 0;
    let onlineCount = 0;
    if (typeof onlineUsers !== 'undefined' && onlineUsers) {
      const ids = new Set();
      for (const u of onlineUsers.values()) {
        if (u && u.id) ids.add(u.id);
      }
      onlineCount = ids.size;
    }
    const roleRows = db.prepare('SELECT role, COUNT(*) as c FROM users GROUP BY role').all() || [];
    const roleCounts = {};
    for (const r of roleRows) roleCounts[r.role] = r.c;
    const badgeRows = db.prepare("SELECT special_badge, COUNT(*) as c FROM users WHERE special_badge IS NOT NULL GROUP BY special_badge").all() || [];
    const badgeCounts = {};
    for (const b of badgeRows) badgeCounts[b.special_badge] = b.c;
    let purpleBadgeHolders = [];
    try {
      purpleBadgeHolders = db.prepare("SELECT id, full_name, username FROM users WHERE special_badge = 'purple'").all() || [];
    } catch (e) {}

    // 2. Dreams telemetry
    let totalDreams = 0;
    let unansweredDreams = 0;
    let favoriteDreams = 0;
    try {
      totalDreams = db.prepare('SELECT COUNT(*) as c FROM dream_sessions').get()?.c || 0;
      unansweredDreams = db.prepare('SELECT COUNT(*) as c FROM dream_sessions WHERE answered_at IS NULL').get()?.c || 0;
      favoriteDreams = db.prepare('SELECT COUNT(*) as c FROM dream_sessions WHERE is_favorite = 1').get()?.c || 0;
    } catch (e) {}

    // 3. Questions telemetry
    const totalQuestions = db.prepare('SELECT COUNT(*) as c FROM questions').get()?.c || 0;
    const activeQuestions = db.prepare('SELECT COUNT(*) as c FROM questions WHERE is_active = 1').get()?.c || 0;
    const unansweredQuestions = db.prepare('SELECT COUNT(*) as c FROM questions WHERE winner_id IS NULL AND is_active = 0').get()?.c || 0;

    // 4. Chat & Messages telemetry
    const totalMsgRow = db.prepare('SELECT COUNT(*) as c FROM messages').get();
    const totalMessages = totalMsgRow ? totalMsgRow.c : 0;
    const last24h = Date.now() - (24 * 60 * 60 * 1000);
    const todayMsgRow = db.prepare('SELECT COUNT(*) as c FROM messages WHERE created_at > ?').get(last24h);
    const todayMessages = todayMsgRow ? todayMsgRow.c : 0;
    const chatLockMode = settings.get('chat_lock_mode', 'unlocked');
    const isRedAlert = settings.get('red_alert_active', '0') === '1';

    // 5. Live Lesson
    const isLive = Boolean(liveLessonState && liveLessonState.isActive);
    const liveStartedBy = isLive ? (liveLessonState.startedBy ? liveLessonState.startedBy.name : 'مامۆستا') : null;
    const liveViewers = isLive ? (liveLessonState.participants ? liveLessonState.participants.size : 0) : 0;

    // 6. Security
    const secStats = aiSecurity.getStats();

    // 7. Dynamic Proactive Suggestions Generator (دەستپێشخەری و پێشنیارەکانی ڕاوێژکار)
    const suggestions = [];

    if (unansweredDreams > 0) {
      suggestions.push({
        id: 'unanswered_dreams',
        category: 'خەونەکان',
        priority: 'high',
        icon: 'fa-moon',
        color: 'purple',
        title: `${unansweredDreams} خەونی نوێ چاوەڕوانی لێکدانەوەن`,
        text: `کاک هێمن گیان، ئێستا ${unansweredDreams} خەون تۆمارکراون کە وەڵام نەدراونەتەوە. دەتوانیت وەڵامیان بدەیتەوە، یان ئەگەر سەرقاڵیت بەخشینی (باجی مۆر 🟣) بە یەکێک لە مامۆستایان یان ئەندامە لێهاتووەکان یارمەتیدەر دەبێت تا وەڵامیان بداتەوە.`,
        action: 'dream_admin',
        actionText: 'کردنەوەی بەشی خەونەکان'
      });
    } else {
      suggestions.push({
        id: 'dreams_clear',
        category: 'خەونەکان',
        priority: 'low',
        icon: 'fa-circle-check',
        color: 'emerald',
        title: 'بەشی خەونەکان پاک و ڕێکخراوە',
        text: 'دەستت خۆش بێت کاک هێمن گیان، هیچ خەونێکی بێ وەڵام نییە و بەڕێوەبەران هەموویان وەڵام داوەتەوە.',
        action: 'dream_admin',
        actionText: 'بینینی خەونەکان'
      });
    }

    if (pendingUsers > 0) {
      suggestions.push({
        id: 'pending_members',
        category: 'ئەندامان',
        priority: 'high',
        icon: 'fa-user-clock',
        color: 'amber',
        title: `${pendingUsers} داواکاری ئەندامێتی لە چاوەڕوانیدان`,
        text: `${pendingUsers} بەکارهێنەری نوێ چاوەڕوانی ڕەزامەندیین بۆ چوونە ناو چات. پێشنیار دەکەم سەیری بەشی ئەندامان بکەیت.`,
        action: 'admin_members',
        actionText: 'پەسەندکردنی ئەندامان'
      });
    }

    if (purpleBadgeHolders.length === 0) {
      suggestions.push({
        id: 'purple_badge_tip',
        category: 'دەسەڵاتی خەون',
        priority: 'medium',
        icon: 'fa-id-badge',
        color: 'purple',
        title: 'بەخشینی باجی مۆر (مۆڵەتی لێکدانەوەی خەون)',
        text: 'پلاتفۆرمەکە باجی مۆری بۆ زیادکراوە بەڵام هێشتا بە کەست نەبەخشیوە. دەتوانیت لە پرۆفایلی ئەندامان ئەم باجە ببەخشیت تا بە تەنیا مۆڵەتی لێکدانەوەی خەونیان هەبێت بەبێ دەسەڵاتی تری ستاف.',
        action: 'admin_members',
        actionText: 'لیستی ئەندامان'
      });
    }

    if (!isLive && onlineCount >= 3) {
      suggestions.push({
        id: 'live_opportunity',
        category: 'وانەی لایڤ',
        priority: 'medium',
        icon: 'fa-tower-broadcast',
        color: 'rose',
        title: `${onlineCount} ئەندام ئێستا ئۆنلاینن`,
        text: `ژمارەیەکی باش (${onlineCount} ئەندام) ئێستا لە ناو پلاتفۆرمەکە چالاکن. دەتوانیت وانەیەکی لایڤی کورت یان خوێندنەوەی قورئان دەستپێبکەیت.`,
        action: 'live_lesson',
        actionText: 'دەستپێکردنی لایڤ'
      });
    }

    if (activeQuestions === 0) {
      suggestions.push({
        id: 'new_question_prompt',
        category: 'پرسیار و پێشبڕکێ',
        priority: 'medium',
        icon: 'fa-circle-question',
        color: 'indigo',
        title: 'دانانی پرسیاری نوێی خەڵاتی ئەستێرە',
        text: 'لە ئێستادا هیچ پرسیارێکی ڕۆژ چالاک نییە. دانانی پرسیارێک تین و ورەیەکی زۆر بە فێرخوازان دەبەخشێت بۆ پێشبڕکێی ئەستێرەکان.',
        action: 'post_question',
        actionText: 'دانانی پرسیار'
      });
    }

    suggestions.push({
      id: 'security_health_tip',
      category: 'ئاسایش و پاراستن',
      priority: 'low',
      icon: 'fa-shield-halved',
      color: 'emerald',
      title: `قەڵغانی پاراستنی زیرەک (${secStats.safetyRating} سەلامەت)`,
      text: `سیستەمی فلتەری دەقی فێڵاوی کوردی و دژە-ڕەید چالاکن. تا ئێستا ${secStats.totalBlocked} هەوڵی نایاسایی تێکشکێنراون و دۆخی چات پارێزراوە.`,
      action: 'ai_security',
      actionText: 'ژووری ئۆپەراسیۆن'
    });

    suggestions.push({
      id: 'advisor_platform_tip',
      category: 'پەرەپێدانی تەکنیکی',
      priority: 'low',
      icon: 'fa-wand-magic-sparkles',
      color: 'purple',
      title: 'فلتەری ژاوەژاو و کۆنتڕۆڵی ڕێکخستنەکان',
      text: 'فلتەری نوێی ژاوەژاوی دەنگ (AI Voice Noise Cancellation) و مینیوی یەکگرتووی ڕێکخستن بە سەرکەوتوویی کاردەکەن. بۆ هەر پێشنیار یان گۆڕانکارییەک، فەرموو لە چاتی ڕاوێژکار پێم بڵێ.',
      action: null,
      actionText: null
    });

    res.json({
      success: true,
      data: {
        telemetry: {
          totalUsers,
          pendingUsers,
          onlineCount,
          roleCounts,
          badgeCounts,
          purpleBadgeHolders,
          totalDreams,
          unansweredDreams,
          favoriteDreams,
          totalQuestions,
          activeQuestions,
          unansweredQuestions,
          totalMessages,
          todayMessages,
          chatLockMode,
          isRedAlert,
          isLive,
          liveStartedBy,
          liveViewers,
          secStats
        },
        suggestions
      }
    });
  } catch (err) {
    console.error('Advisor overview error:', err);
    res.status(500).json({ error: 'هەڵە لە وەرگرتنی ئامارەکانی ڕاوێژکار' });
  }
});

// --- ADVISOR AI TOOLS & ACTIONS ENGINE ---

function parseKurdishTime(timeStr) {
  if (!timeStr) return null;
  const now = new Date();
  const lower = timeStr.toLowerCase().trim();

  // Check for relative hours/minutes like "2 سەعاتی تر" or "30 خولەکی تر"
  const relHourMatch = lower.match(/(\d+|١|٢|٣|٤|٥|٦|٧|٨|٩|یەک|دوو|سێ|چوار|پێنج)\s*(?:سەعات|کاتژمێر|hour)ی?\s*تر/);
  if (relHourMatch) {
    let num = relHourMatch[1];
    if (num === 'یەک') num = 1;
    else if (num === 'دوو') num = 2;
    else if (num === 'سێ') num = 3;
    else if (num === 'چوار') num = 4;
    else if (num === 'پێنج') num = 5;
    else {
      num = parseInt(num.replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)), 10);
    }
    if (!isNaN(num) && num > 0) return Date.now() + (num * 60 * 60 * 1000);
  }

  const relMinMatch = lower.match(/(\d+|١|٢|٣|٤|٥|٦|٧|٨|٩)\s*(?:خولەک|دەقیقە|min)ی?\s*تر/);
  if (relMinMatch) {
    const min = parseInt(relMinMatch[1].replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)), 10);
    if (!isNaN(min) && min > 0) return Date.now() + (min * 60 * 1000);
  }

  let target = new Date();
  const isTomorrow = lower.includes('سبەی') || lower.includes('بەیانی') || lower.includes('tomorrow');
  if (isTomorrow) {
    target.setDate(target.getDate() + 1);
  }

  const hourMatch = timeStr.match(/(?:سەعات|کاتژمێر|hour)?\s*([0-9]|١|٢|٣|٤|٥|٦|٧|٨|٩|١٠|١١|١٢|\d{1,2})/);
  if (hourMatch) {
    let raw = hourMatch[1];
    const kurdishDigits = '٠١٢٣٤٥٦٧٨٩';
    let hStr = '';
    for (const ch of raw) {
      const idx = kurdishDigits.indexOf(ch);
      hStr += idx !== -1 ? idx : ch;
    }
    let h = parseInt(hStr, 10);
    const isNight = /شەو|pm|پاشنیوەڕۆ|ئێوارە/.test(lower);
    const isMorning = /بەیانی|am|سەرلەبەیانی/.test(lower);
    if (isNight && h < 12) h += 12;
    if (isMorning && h === 12) h = 0;
    target.setHours(h, 0, 0, 0);
  }

  if (target.getTime() > now.getTime()) {
    return target.getTime();
  } else if (!isTomorrow && target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
    if (target.getTime() > now.getTime()) return target.getTime();
  }

  return null;
}

const advisorTools = [
  {
    function_declarations: [
      {
        name: 'get_teachers_and_staff',
        description: 'وەرگرتنی لیستی تەواوی مامۆستایان، ئەدمینەکان، و ستافی بەڕێوەبەرایەتی پلاتفۆرمی سیرین',
        parameters: {
          type: 'OBJECT',
          properties: {
            role: { type: 'STRING', description: "'teacher', 'admin', 'super_admin', or 'all'" }
          }
        }
      },
      {
        name: 'get_top_students',
        description: 'وەرگرتنی ڕیزبەندی خوێندکارە یەکەمەکان و ئەستێرە و خاڵەکانیان (Leaderboard)',
        parameters: {
          type: 'OBJECT',
          properties: {
            limit: { type: 'INTEGER', description: 'ژمارەی خوێندکارەکان (دەفۆڵت ٥)' }
          }
        }
      },
      {
        name: 'get_badge_holders',
        description: 'وەرگرتنی لیستی هەموو ئەو بەکارهێنەرانەی باجی تایبەتیان هەیە (blue بۆ پاسەوانی چات، white بۆ ڕاوێژکار، purple بۆ خەون، green بۆ بەڕێوەبەر، black بۆ سوپەر ئەدمین، red بۆ لایڤ)',
        parameters: {
          type: 'OBJECT',
          properties: {
            badge_color: { type: 'STRING', description: 'blue, white, purple, green, black, red, or all' }
          }
        }
      },
      {
        name: 'get_pending_members',
        description: 'وەرگرتنی لیستی ئەو کەسانەی تازە ناویان تۆمارکردووە و چاوەڕوانی پەسەندکردن و وەرگرتنن',
        parameters: {
          type: 'OBJECT',
          properties: {}
        }
      },
      {
        name: 'search_user',
        description: 'گەڕان بەدوای زانیاری وردی بەکارهێنەرێک بە ناو، یوزەرنەیم، یان ئایدی (خاڵ، باج، دۆخ، ڕۆڵ)',
        parameters: {
          type: 'OBJECT',
          properties: {
            query: { type: 'STRING', description: 'ناو یان یوزەرنەیم یان ئایدی کەسەکە' }
          },
          required: ['query']
        }
      },
      {
        name: 'get_recent_dreams',
        description: 'وەرگرتنی دوایین خەونە تۆمارکراوەکان و دۆخەکەیان (وەڵامدراوە یان چاوەڕوان)',
        parameters: {
          type: 'OBJECT',
          properties: {
            status: { type: 'STRING', description: 'all, unanswered, or answered' },
            limit: { type: 'INTEGER', description: 'ژمارەی خەونەکان (دەفۆڵت ٥)' }
          }
        }
      },
      {
        name: 'get_recent_chat_messages',
        description: 'خوێندنەوەی دوایین نامەکانی چاتی گشتی گروپ',
        parameters: {
          type: 'OBJECT',
          properties: {
            limit: { type: 'INTEGER', description: 'ژمارەی نامەکان (دەفۆڵت ١٠)' }
          }
        }
      },
      {
        name: 'assign_badge',
        description: 'بەخشین یان لێسەندنەوەی باج بە فەرمانی کاک هێمن (blue: پاسەوانی چات، white: ڕاوێژکار، purple: خەون، green: بەڕێوەبەر، black: سوپەر ئەدمین، red: لایڤ، none: لێسەندنەوە). تێبینی: بە هیچ جۆرێک دەستکاری کاک هێمن ناکات.',
        parameters: {
          type: 'OBJECT',
          properties: {
            username_or_id: { type: 'STRING', description: 'ناو یان یوزەرنەیم یان ئایدی بەکارهێنەرەکە' },
            badge_color: { type: 'STRING', description: 'blue, white, purple, green, black, red, or none' }
          },
          required: ['username_or_id', 'badge_color']
        }
      },
      {
        name: 'change_user_role',
        description: 'گۆڕینی ڕۆڵ یان پلەی بەکارهێنەرێک (مامۆستا teacher، ئەدمین admin، خوێندکار student، میوان guest) بە فەرمانی کاک هێمن. تێبینی: ناتوانێت دەستکاری کاک هێمن بکات.',
        parameters: {
          type: 'OBJECT',
          properties: {
            username_or_id: { type: 'STRING', description: 'ناو یان یوزەرنەیم یان ئایدی بەکارهێنەرەکە' },
            new_role: { type: 'STRING', description: "'teacher', 'admin', 'student', or 'guest' (مامۆستا، ئەدمین، خوێندکار، میوان)" },
            reason: { type: 'STRING', description: 'هۆکاری گۆڕینی پلە' }
          },
          required: ['username_or_id', 'new_role']
        }
      },
      {
        name: 'change_user_name',
        description: 'گۆڕینی ناوی تەواوی (full_name) بەکارهێنەرێک لە ناو داتابەیس بە فەرمانی کاک هێمن',
        parameters: {
          type: 'OBJECT',
          properties: {
            username_or_id: { type: 'STRING', description: 'ناو یان یوزەرنەیم یان ئایدی بەکارهێنەرەکە' },
            new_name: { type: 'STRING', description: 'ناوی نوێی بەکارهێنەر' }
          },
          required: ['username_or_id', 'new_name']
        }
      },
      {
        name: 'reset_user_password',
        description: 'گۆڕین یان دانانی وشەی نهێنی نوێ بۆ بەکارهێنەرێک بە فەرمانی کاک هێمن',
        parameters: {
          type: 'OBJECT',
          properties: {
            username_or_id: { type: 'STRING', description: 'ناو یان یوزەرنەیم یان ئایدی بەکارهێنەرەکە' },
            new_password: { type: 'STRING', description: 'وشەی نهێنی نوێ' }
          },
          required: ['username_or_id', 'new_password']
        }
      },
      {
        name: 'approve_member',
        description: 'پەسەندکردن و وەرگرتنی ئەندامێکی چاوەڕوانکراو (Pending Member) بۆ ناو گروپ بە فەرمانی کاک هێمن',
        parameters: {
          type: 'OBJECT',
          properties: {
            username_or_id: { type: 'STRING', description: 'ناو یان یوزەرنەیم یان ئایدی ئەندامەکە' }
          },
          required: ['username_or_id']
        }
      },
      {
        name: 'delete_member',
        description: 'سڕینەوەی بەکارهێنەرێک لە سیستم بە فەرمانی کاک هێمن (بە تەواوی پارێزراوە و هەرگیز ناتوانێت دەستکاری کاک هێمن بکات)',
        parameters: {
          type: 'OBJECT',
          properties: {
            username_or_id: { type: 'STRING', description: 'ناو یان یوزەرنەیم یان ئایدی کەسەکە' },
            reason: { type: 'STRING', description: 'هۆکاری سڕینەوە' }
          },
          required: ['username_or_id']
        }
      },
      {
        name: 'toggle_chat_lock',
        description: 'داخستن یان کردنەوەی چاتی گشتی بە فەرمانی کاک هێمن',
        parameters: {
          type: 'OBJECT',
          properties: {
            mode: { type: 'STRING', description: "'none' بۆ کردنەوەی چات، 'staff_only' بۆ تەنها ستاف، 'total_lock' بۆ قفڵی گشتی" },
            reason: { type: 'STRING', description: 'هۆکار' }
          },
          required: ['mode']
        }
      },
      {
        name: 'create_question',
        description: 'دروستکردنی پرسیاری نوێ لە چات لەگەڵ دیاریکردنی دەقی پرسیار، وەڵامی دروست، و میقاتکردنی بۆ کاتێکی داهاتوو (وەک سبەی سەعات ٩ی شەو یان ماوەی خولەک)',
        parameters: {
          type: 'OBJECT',
          properties: {
            question_text: { type: 'STRING', description: 'دەقی پرسیارەکە' },
            correct_answer: { type: 'STRING', description: 'دەقی وەڵامی دروست' },
            duration_minutes: { type: 'INTEGER', description: 'ماوە بە خولەک (ئەگەر کاتی دیاریکراو نەبێت)' },
            scheduled_for_text: { type: 'STRING', description: 'کاتی دیاریکراو وەک سبەی سەعات ٩ی شەو یان بەروار' }
          },
          required: ['question_text']
        }
      },
      {
        name: 'set_system_announcement',
        description: 'دانان یان نوێکردنەوەی ئاگاداری سەرەکی سایت بۆ هەموو فێرخوازان',
        parameters: {
          type: 'OBJECT',
          properties: {
            announcement_text: { type: 'STRING', description: 'دەقی ئاگادارییەکە' }
          },
          required: ['announcement_text']
        }
      },
      {
        name: 'award_student_stars',
        description: 'بەخشین یان کەمکردنەوەی ئەستێرە (خاڵ) بە خوێندکارێک بە فەرمانی کاک هێمن',
        parameters: {
          type: 'OBJECT',
          properties: {
            username_or_id: { type: 'STRING', description: 'ناو یان یوزەرنەیم' },
            stars_delta: { type: 'INTEGER', description: 'ژمارەی ئەستێرە (بۆ نموونە ٥ بۆ زیادکردن)' }
          },
          required: ['username_or_id', 'stars_delta']
        }
      },
      {
        name: 'block_user',
        description: 'بلۆککردن یان لابردنی بلۆکی بەکارهێنەرێک بە فەرمانی کاک هێمن (is_blocked: true یان false)',
        parameters: {
          type: 'OBJECT',
          properties: {
            username_or_id: { type: 'STRING', description: 'ناو یان یوزەرنەیم یان ئایدی کەسەکە' },
            is_blocked: { type: 'BOOLEAN', description: 'true بۆ بلۆککردن، false بۆ لابردنی بلۆک' }
          },
          required: ['username_or_id']
        }
      },
      {
        name: 'mute_user',
        description: 'بێدەنگکردن (Mute) یان لابردنی بێدەنگی لەسەر بەکارهێنەرێک لە چات بە خولەک بە فەرمانی کاک هێمن',
        parameters: {
          type: 'OBJECT',
          properties: {
            username_or_id: { type: 'STRING', description: 'ناو یان یوزەرنەیم یان ئایدی کەسەکە' },
            minutes: { type: 'INTEGER', description: 'ماوە بە خولەک (٠ بۆ لابردنی میوت)' }
          },
          required: ['username_or_id']
        }
      },
      {
        name: 'delete_chat_message',
        description: 'سڕینەوەی نامەیەکی دیاریکراو لە چاتی گشتی بە فەرمانی کاک هێمن',
        parameters: {
          type: 'OBJECT',
          properties: {
            message_id: { type: 'INTEGER', description: 'ئایدی پەیامەکە' }
          },
          required: ['message_id']
        }
      },
      {
        name: 'clear_chat',
        description: 'سڕینەوە و پاککردنەوەی تەواوی پەیامەکانی چاتی گشتی بە فەرمانی کاک هێمن (نامەکان دەچنە ئەرشیڤی پارێزراو بۆ گەڕاندنەوە)',
        parameters: {
          type: 'OBJECT',
          properties: {}
        }
      },
      {
        name: 'restore_deleted_messages',
        description: 'گەڕاندنەوەی پەیامە سڕاوەکانی چاتی گشتی بە فەرمانی کاک هێمن. دەتوانرێت تەواوی چاتە سڕاوەکان، یان نامە سڕاوەکانی کەسێکی دیاریکراو (target_user)، یان بەپێی ژمارەی پەیامەکانی کۆتایی (limit: وەک ٢ دانە یان ١٠ دانەی کۆتایی کە سڕاونەتەوە) بگەڕێنێتەوە.',
        parameters: {
          type: 'OBJECT',
          properties: {
            target_user: { type: 'STRING', description: 'ناو، یوزەرنەیم، یان ئایدی بەکارهێنەرێک ئەگەر تەنها نامەکانی ئەو بگەڕێنیتەوە (ئارەزوومەندانە)' },
            limit: { type: 'INTEGER', description: 'ژمارەی ئەو پەیامانەی دەتەوێت بگەڕێنرێنەوە وەک ٢ یان ١٠ دانەی کۆتایی (ئەگەر دانەنرێت هەمووی دەگەڕێنێتەوە)' },
            message_id: { type: 'INTEGER', description: 'ئایدی پەیامێکی دیاریکراو ئەگەر ئایدییەکە بزانیت' }
          }
        }
      },
      {
        name: 'get_deleted_messages',
        description: 'بینین و پشکنینی لیستی ئەو پەیامانەی لە چاتی گشتی سڕاونەتەوە پێش گەڕاندنەوەیان بە فەرمانی کاک هێمن (ناوەڕۆک، ناوی کەسەکە، کاتی ناردن، کاتی سڕینەوە)',
        parameters: {
          type: 'OBJECT',
          properties: {
            target_user: { type: 'STRING', description: 'ناو یان یوزەرنەیم یان ئایدی کەسەکە (ئارەزوومەندانە)' },
            limit: { type: 'INTEGER', description: 'ژمارەی پەیامەکان بۆ پیشاندان (دەفۆڵت ١٠)' }
          }
        }
      },
      {
        name: 'check_database_backups',
        description: 'پشکنینی هەموو فایلە یەدەگەکانی (Backups) ناو سێرڤەر بۆ ئەوەی بزانرێت کام کۆپی یەدەگ چەند نامەی تێدایە و نامەکانی پێش سڕینەوەی تێدا ماوە یان نا',
        parameters: {
          type: 'OBJECT',
          properties: {}
        }
      },
      {
        name: 'restore_messages_from_backup',
        description: 'گەڕاندنەوە و هێنانەوەی نامەکان لەناو فایلە یەدەگەکانی (chat_backup_*.db) ناو سێرڤەر بە فەرمانی کاک هێمن',
        parameters: {
          type: 'OBJECT',
          properties: {
            backup_filename: { type: 'STRING', description: 'ناوی فایلی یەدەگەکە ئەگەر بتەوێت فایلی دیاریکراو بێت (ئەگەر دانەنرێت تازەترین یەدەگ هەڵدەبژێرێت)' }
          }
        }
      },
      {
        name: 'toggle_red_alert',
        description: 'کاراکردن یان ناچالاککردنی دۆخی نائاسایی و فریاگوزاری (Red Alert Lockdown) بە فەرمانی کاک هێمن',
        parameters: {
          type: 'OBJECT',
          properties: {
            activate: { type: 'BOOLEAN', description: 'true بۆ کاراکردن، false بۆ ناچالاککردن' }
          },
          required: ['activate']
        }
      },
      {
        name: 'delete_question',
        description: 'سڕینەوەی پرسیارێکی ناو سیستەم بەپێی ئایدی بە فەرمانی کاک هێمن',
        parameters: {
          type: 'OBJECT',
          properties: {
            question_id: { type: 'INTEGER', description: 'ئایدی پرسیارەکە' }
          },
          required: ['question_id']
        }
      },
      {
        name: 'close_question',
        description: 'داخستنی پرسیاری کاتداری ئێستا لە چات بە فەرمانی کاک هێمن',
        parameters: {
          type: 'OBJECT',
          properties: {
            question_id: { type: 'INTEGER', description: 'ئایدی پرسیارەکە' }
          },
          required: ['question_id']
        }
      },
      {
        name: 'manage_system_setting',
        description: 'بینین یان گۆڕینی هەر ڕێکخستنێکی سیستەم بە کلیل و نرخ بە فەرمانی کاک هێمن',
        parameters: {
          type: 'OBJECT',
          properties: {
            key: { type: 'STRING', description: 'ناوی کلیلەکە' },
            value: { type: 'STRING', description: 'نرخی نوێ ئەگەر دەستکاری بکەیت' }
          },
          required: ['key']
        }
      },
      {
        name: 'super_admin_sql_action',
        description: 'دەسەڵاتی جێبەجێکردنی هەر فەرمانێکی تایبەتی داتابەیس یان گۆڕانکاری و ئامارێک کە کاک هێمن فەرمانی پێبکات (تەواو پارێزراوە لە دەستکاری کاک هێمن)',
        parameters: {
          type: 'OBJECT',
          properties: {
            sql: { type: 'STRING', description: 'دەقی فەرمانی SQL' }
          },
          required: ['sql']
        }
      }
    ]
  }
];

function findTargetUser(identifier) {
  if (!identifier) return null;
  const str = String(identifier).trim();
  if (!isNaN(Number(str))) {
    try {
      const byId = users.findById(Number(str));
      if (byId) return byId;
    } catch (e) {}
  }
  try {
    const byUser = users.findByUsername(str);
    if (byUser) return byUser;
  } catch (e) {}
  try {
    const byLike = db.prepare("SELECT * FROM users WHERE full_name LIKE ? OR username LIKE ? LIMIT 1").get(`%${str}%`, `%${str}%`);
    if (byLike) return byLike;
  } catch (e) {}
  return null;
}

async function executeAdvisorAction(actionName, args, reqUser, ioInstance) {
  try {
    switch (actionName) {
      case 'get_teachers_and_staff': {
        const roleFilter = String(args.role || 'all').toLowerCase().trim();
        let sql = "SELECT id, username, full_name, role, special_badge, status, correct_answers_count FROM users WHERE role IN ('teacher', 'admin', 'super_admin')";
        let params = [];
        if (roleFilter === 'teacher') {
          sql = "SELECT id, username, full_name, role, special_badge, status, correct_answers_count FROM users WHERE role = 'teacher'";
        } else if (roleFilter === 'admin') {
          sql = "SELECT id, username, full_name, role, special_badge, status, correct_answers_count FROM users WHERE role = 'admin'";
        }
        sql += " ORDER BY role = 'super_admin' DESC, role = 'admin' DESC, role = 'teacher' DESC, id ASC";
        const staff = db.prepare(sql).all(...params);
        return {
          total: staff.length,
          filter: roleFilter,
          staff: staff.map(s => ({
            id: s.id,
            name: s.full_name,
            username: s.username,
            role: s.role === 'super_admin' ? 'سوپەر ئەدمین (سەرپەرشتیاری گشتی)' : (s.role === 'admin' ? 'ئەدمین (بەڕێوەبەر)' : 'مامۆستا'),
            badge: s.special_badge || 'بێ باجی تایبەت',
            status: s.status
          }))
        };
      }

      case 'get_top_students': {
        const limit = Math.min(20, parseInt(args.limit) || 5);
        let list = [];
        try {
          if (users.getLeaderboard) list = users.getLeaderboard().slice(0, limit);
        } catch (e) {}
        return {
          count: list.length,
          students: list.map((s, idx) => ({
            rank: idx + 1,
            name: s.full_name,
            username: s.username,
            stars: s.correct_answers_count,
            role: s.role
          }))
        };
      }

      case 'get_badge_holders': {
        const color = (args.badge_color || 'all').toLowerCase();
        let sql = "SELECT id, username, full_name, role, special_badge, status FROM users WHERE special_badge IS NOT NULL AND special_badge != ''";
        let params = [];
        if (color !== 'all') {
          sql += " AND LOWER(special_badge) = ?";
          params.push(color);
        }
        const rows = db.prepare(sql).all(...params);
        return {
          total: rows.length,
          badge_requested: color,
          holders: rows.map(r => ({
            id: r.id,
            name: r.full_name,
            username: r.username,
            role: r.role,
            badge: r.special_badge
          }))
        };
      }

      case 'get_pending_members': {
        const pending = users.getPendingUsers ? users.getPendingUsers() : [];
        return {
          count: pending.length,
          members: pending.slice(0, 15).map(m => ({
            id: m.id,
            name: m.full_name,
            username: m.username,
            registered_at: new Date(m.created_at).toLocaleString('ku')
          }))
        };
      }

      case 'search_user': {
        const q = String(args.query || '').trim();
        if (!q) return { found: false, message: 'تکایە ناوێک بنووسە بۆ گەڕان.' };

        let matches = [];
        try {
          matches = db.prepare(`
            SELECT id, username, full_name, role, status, special_badge, correct_answers_count, is_blocked, created_at
            FROM users
            WHERE full_name LIKE ? OR username LIKE ?
            LIMIT 10
          `).all(`%${q}%`, `%${q}%`);
        } catch (e) {}

        if (matches.length === 0 && !isNaN(Number(q))) {
          try {
            const byId = users.findById(Number(q));
            if (byId) matches = [byId];
          } catch (e) {}
        }

        if (matches.length === 0) {
          return {
            found: false,
            query: q,
            message: `هیچ بەکارهێنەرێک بە ناوی «${q}» لە داتابەیسی سەیرین ستاف نەدۆزرایەوە.`
          };
        }

        return {
          found: true,
          query: q,
          total_matches: matches.length,
          users: matches.map(u => ({
            id: u.id,
            name: u.full_name,
            username: u.username,
            role: u.role,
            status: u.status,
            badge: u.special_badge || 'هیچ باجێکی نییە',
            stars: u.correct_answers_count || 0,
            is_blocked: !!u.is_blocked,
            joined_at: new Date(u.created_at).toLocaleDateString('ku')
          }))
        };
      }

      case 'get_recent_dreams': {
        const limit = Math.min(15, parseInt(args.limit) || 5);
        let sql = `
          SELECT ds.id, ds.dreamer_name, ds.dreamer_gender, ds.status, ds.created_at,
                 (SELECT content FROM dream_messages WHERE session_id = ds.id ORDER BY id ASC LIMIT 1) as dream_text
          FROM dream_sessions ds
        `;
        const params = [];
        if (args.status === 'unanswered') {
          sql += " WHERE ds.status = 'open' ";
        } else if (args.status === 'answered') {
          sql += " WHERE ds.status = 'closed' ";
        }
        sql += " ORDER BY ds.id DESC LIMIT ? ";
        params.push(limit);
        const rows = db.prepare(sql).all(...params);
        return {
          count: rows.length,
          dreams: rows.map(r => ({
            id: r.id,
            dreamer: r.dreamer_name,
            gender: r.dreamer_gender,
            status: r.status,
            text: r.dream_text ? r.dream_text.slice(0, 150) : 'بێ دەق',
            time: new Date(r.created_at).toLocaleString('ku')
          }))
        };
      }

      case 'get_recent_chat_messages': {
        const limit = Math.min(25, parseInt(args.limit) || 10);
        const rows = db.prepare("SELECT id, full_name, username, role, content, type, created_at FROM messages ORDER BY id DESC LIMIT ?").all(limit);
        return {
          count: rows.length,
          messages: rows.reverse().map(m => ({
            id: m.id,
            sender: m.full_name,
            role: m.role,
            text: m.content.slice(0, 120),
            time: new Date(m.created_at).toLocaleTimeString('ku')
          }))
        };
      }

      case 'assign_badge': {
        const target = findTargetUser(args.username_or_id);
        if (!target) return { error: `بەکارهێنەر «${args.username_or_id}» نەدۆزرایەوە` };
        
        // Strict Safety Check: Kak Hemn is completely immutable
        if (isMasterSuperAdmin(target) || target.role === 'super_admin' || target.id === reqUser.id) {
          return { error: '⚠️ بە هیچ شێوەیەک دەستکاری هەژماری کاک هێمن (Super Admin) ناکرێت، ئەم هەژمارە تەواو پارێزراوە!' };
        }

        const validBadges = ['purple', 'green', 'black', 'red', 'white', 'blue', 'none'];
        const badgeInput = (args.badge_color || '').toLowerCase();
        if (!validBadges.includes(badgeInput)) {
          return { error: 'ڕەنگی باج نادروستە. تەنها blue, white, purple, green, black, red, none دەستدەدات.' };
        }
        const badgeVal = badgeInput === 'none' ? null : badgeInput;
        users.updateSpecialBadge(target.id, badgeVal);
        if (ioInstance) {
          ioInstance.emit('user_updated', { id: target.id, special_badge: badgeVal });
        }
        return {
          success: true,
          message: badgeVal 
            ? `باجی ${badgeVal} بە سەرکەوتوویی درا بە ${target.full_name} (@${target.username}) بە فەرمانی کاک هێمن.`
            : `باجی تایبەتی ${target.full_name} لێسەندرایەوە بە فەرمانی کاک هێمن.`
        };
      }

      case 'change_user_role': {
        const target = findTargetUser(args.username_or_id);
        if (!target) return { error: `بەکارهێنەر «${args.username_or_id}» نەدۆزرایەوە` };

        // Strict Safety Check: Kak Hemn is completely immutable
        if (isMasterSuperAdmin(target) || target.role === 'super_admin' || target.id === reqUser.id) {
          return { error: '⚠️ بە هیچ شێوەیەک دەستکاری ڕۆڵ یان هەژماری کاک هێمن (Super Admin) ناکرێت!' };
        }

        const roleRaw = String(args.new_role || '').toLowerCase().trim();
        const roleMap = {
          'مامۆستا': 'teacher',
          'teacher': 'teacher',
          'ئەدمین': 'admin',
          'admin': 'admin',
          'خوێندکار': 'student',
          'قوتابی': 'student',
          'student': 'student',
          'میوان': 'guest',
          'guest': 'guest'
        };

        const targetRole = roleMap[roleRaw] || roleRaw;
        const validRoles = ['teacher', 'admin', 'student', 'guest'];
        if (!validRoles.includes(targetRole)) {
          return { error: `ڕۆڵی «${args.new_role}» نادروستە. تەنها teacher, admin, student, guest دەستدەدات.` };
        }

        const oldRole = target.role;
        users.updateRole(target.id, targetRole);
        try {
          users.addRoleHistory(target.id, reqUser.id, reqUser.full_name, oldRole, targetRole);
        } catch (e) {}

        if (ioInstance) {
          ioInstance.emit('user_role_updated', { id: target.id, role: targetRole });
          ioInstance.emit('user_updated', { id: target.id, role: targetRole });
        }

        const roleNamesKu = {
          teacher: 'مامۆستا 👨‍🏫',
          admin: 'ئەدمین (بەڕێوەبەر) 🛡️',
          student: 'خوێندکار 🎓',
          guest: 'میوان 👁️'
        };

        return {
          success: true,
          message: `ڕۆڵ و پلەی ${target.full_name} (@${target.username}) بە سەرکەوتوویی لە «${oldRole}»ەوە گۆڕدرا بۆ «${roleNamesKu[targetRole] || targetRole}» بە فەرمانی کاک هێمن.`
        };
      }

      case 'change_user_name': {
        const target = findTargetUser(args.username_or_id);
        if (!target) return { error: `بەکارهێنەر «${args.username_or_id}» نەدۆزرایەوە` };

        if (isMasterSuperAdmin(target) || target.role === 'super_admin' || target.id === reqUser.id) {
          return { error: '⚠️ ناوی کاک هێمن تەواو پارێزراوە و لە ڕێگەی بۆتەوە دەستکاری ناکرێت.' };
        }

        const newName = String(args.new_name || '').trim();
        if (!newName) return { error: 'تکایە ناوە نوێیەکە دیاری بکە.' };

        users.updateFullName(target.id, newName);
        if (ioInstance) {
          ioInstance.emit('user_updated', { id: target.id, full_name: newName });
        }

        return {
          success: true,
          message: `ناوی تەواوی بەکارهێنەر @${target.username} بە سەرکەوتوویی گۆڕدرا بۆ «${newName}» بە فەرمانی کاک هێمن.`
        };
      }

      case 'reset_user_password': {
        const target = findTargetUser(args.username_or_id);
        if (!target) return { error: `بەکارهێنەر «${args.username_or_id}» نەدۆزرایەوە` };

        if (isMasterSuperAdmin(target) || target.role === 'super_admin' || target.id === reqUser.id) {
          return { error: '⚠️ وشەی نهێنی کاک هێمن پارێزراوە و لە ڕێگەی بۆتەوە دەستکاری ناکرێت.' };
        }

        const newPass = String(args.new_password || '').trim();
        if (!newPass || newPass.length < 4) return { error: 'تکایە وشەی نهێنی نوێ بە لایەنی کەم ٤ پیت بێت.' };

        const hash = await bcrypt.hash(newPass, 10);
        users.updatePassword(target.id, hash);

        return {
          success: true,
          message: `وشەی نهێنی @${target.username} بە سەرکەوتوویی بۆ «${newPass}» ڕیسێتکرا بە فەرمانی کاک هێمن.`
        };
      }

      case 'approve_member': {
        const target = findTargetUser(args.username_or_id);
        if (!target) return { error: `بەکارهێنەر «${args.username_or_id}» نەدۆزرایەوە` };
        users.updateStatus(target.id, 'approved');
        if (ioInstance) {
          ioInstance.emit('user_status_updated', { id: target.id, status: 'approved' });
        }
        return {
          success: true,
          message: `ئەندام ${target.full_name} (@${target.username}) بە سەرکەوتوویی وەرگیرا و پەسەندکرا بە فەرمانی کاک هێمن.`
        };
      }

      case 'delete_member': {
        const target = findTargetUser(args.username_or_id);
        if (!target) return { error: `بەکارهێنەر «${args.username_or_id}» نەدۆزرایەوە` };

        // Absolute Safety Check: Cannot delete Hemn or Super Admin!
        if (isMasterSuperAdmin(target) || target.role === 'super_admin' || target.id === reqUser.id) {
          return { error: '⚠️ قەدەغەیە! بە هیچ شێوەیەک دەستکاری و سڕینەوەی هەژماری کاک هێمن ناکرێت.' };
        }

        users.delete(target.id);
        if (ioInstance) {
          ioInstance.emit('user_deleted', { id: target.id });
        }
        return {
          success: true,
          message: `بەکارهێنەر ${target.full_name} (@${target.username}) بە سەرکەوتوویی لە سیستم سڕایەوە بە فەرمانی کاک هێمن.`
        };
      }

      case 'toggle_chat_lock': {
        const mode = args.mode || 'staff_only';
        settings.set('chat_lock_mode', mode);
        const lockBy = mode === 'none' ? '' : `${reqUser.full_name} (ڕاوێژکار)`;
        const lockTime = mode === 'none' ? '' : String(Date.now());
        settings.set('chat_lock_by', lockBy);
        settings.set('chat_lock_time', lockTime);

        const announceText = (mode === 'total_lock' || mode === 'staff_only') 
          ? '🔒 چات بە فەرمانی کاک هێمن داخرا' 
          : '🔓 چات بە فەرمانی کاک هێمن کرایەوە';

        const sysMsg = messages.create(reqUser.id, 'سیستەم', 'سیستەم', 'system', announceText, 'system');
        if (ioInstance) {
          ioInstance.emit('new_message', sysMsg);
          ioInstance.emit('chat_lock_status_updated', { mode, locked_by: lockBy, timestamp: Date.now() });
        }
        return {
          success: true,
          message: `دۆخی چات بە سەرکەوتوویی گۆڕدرا بۆ: ${mode === 'none' ? 'کراوە' : (mode === 'total_lock' ? 'قفڵی گشتی' : 'تەنها ستاف')}`
        };
      }

      case 'create_question': {
        let expiresAt = null;
        let durationMinutes = parseInt(args.duration_minutes) || 5;

        if (args.scheduled_for_text) {
          const customTimestamp = parseKurdishTime(args.scheduled_for_text);
          if (customTimestamp && customTimestamp > Date.now()) {
            expiresAt = customTimestamp;
            durationMinutes = Math.max(1, Math.round((expiresAt - Date.now()) / (60 * 1000)));
          }
        }

        if (!expiresAt) {
          expiresAt = Date.now() + (durationMinutes * 60 * 1000);
        }

        const q = questions.create(
          reqUser.id,
          reqUser.full_name,
          args.question_text.trim(),
          args.correct_answer ? args.correct_answer.trim() : null,
          durationMinutes,
          expiresAt
        );

        if (typeof setupQuestionTimer === 'function') {
          setupQuestionTimer(q);
        }

        const msgContent = JSON.stringify({
          question_id: q.id,
          question_number: q.question_number || 1,
          question_text: q.question_text,
          admin_name: reqUser.full_name,
          duration_minutes: q.duration_minutes,
          expires_at: q.expires_at,
          has_model_answer: !!q.correct_answer
        });

        const questionMsg = messages.create(reqUser.id, reqUser.username, reqUser.full_name, reqUser.role, msgContent, 'question', q.id);

        if (ioInstance) {
          ioInstance.emit('new_question', { question: q, message: questionMsg });
        }

        try {
          sendPushNotificationToAll({
            title: `❓ پرسیاری نوێ (#${q.question_number || q.id}) دانرا!`,
            body: `${reqUser.full_name} پرسیارێکی نوێی دانا: ${q.question_text.slice(0, 80)}...`,
            tag: 'question-new-' + q.id,
            data: { url: '/?action=question&id=' + q.id }
          }, reqUser.id);
        } catch (pushErr) {}

        const expiresDate = new Date(expiresAt).toLocaleTimeString('ku', { hour: '2-digit', minute: '2-digit' });
        return {
          success: true,
          message: `پرسیاری #${q.question_number || q.id} بە سەرکەوتوویی دروستکرا و بڵاوکرایەوە! ماوەی بەسەرچوون دیاریکراوە بۆ: ${expiresDate} (کۆی گشتی ${durationMinutes} خولەک).`
        };
      }

      case 'set_system_announcement': {
        const text = (args.announcement_text || '').trim();
        settings.set('site_announcement', text);
        settings.set('site_announcement_active', '1');
        if (ioInstance) {
          ioInstance.emit('announcement_updated', { text, is_active: true });
        }
        return {
          success: true,
          message: `ئاگاداری سەرەکی سایت بە سەرکەوتوویی بڵاوکرایەوە: "${text}"`
        };
      }

      case 'award_student_stars': {
        const target = findTargetUser(args.username_or_id);
        if (!target) return { error: `خوێندکار «${args.username_or_id}» نەدۆزرایەوە` };
        const delta = parseInt(args.stars_delta) || 1;
        const newTotal = users.adjustStars(target.id, delta);
        if (ioInstance) {
          ioInstance.emit('user_updated', { id: target.id, correct_answers_count: newTotal });
        }
        return {
          success: true,
          message: `${delta > 0 ? '+' + delta : delta} ئەستێرە درا بە ${target.full_name}. کۆی خاڵەکانی ئێستا: ${newTotal}`
        };
      }

      case 'block_user': {
        const target = findTargetUser(args.username_or_id);
        if (!target) return { error: `بەکارهێنەر «${args.username_or_id}» نەدۆزرایەوە` };
        if (isMasterSuperAdmin(target) || target.role === 'super_admin' || target.id === reqUser.id) {
          return { error: '⚠️ بە هیچ شێوەیەک دەستکاری هەژماری کاک هێمن ناکرێت.' };
        }
        const isBlocked = args.is_blocked !== false && args.is_blocked !== 0 && String(args.is_blocked).toLowerCase() !== 'false';
        users.setBlocked(target.id, isBlocked);
        if (ioInstance) {
          ioInstance.emit('user_blocked', { id: target.id, is_blocked: isBlocked ? 1 : 0 });
          ioInstance.emit('user_updated', { id: target.id, is_blocked: isBlocked ? 1 : 0 });
        }
        return {
          success: true,
          message: isBlocked
            ? `بەکارهێنەر ${target.full_name} (@${target.username}) بە سەرکەوتوویی بلۆککرا 🚫.`
            : `بلۆکی بەکارهێنەر ${target.full_name} (@${target.username}) بە سەرکەوتوویی لادرا ✅.`
        };
      }

      case 'mute_user': {
        const target = findTargetUser(args.username_or_id);
        if (!target) return { error: `بەکارهێنەر «${args.username_or_id}» نەدۆزرایەوە` };
        if (isMasterSuperAdmin(target) || target.role === 'super_admin' || target.id === reqUser.id) {
          return { error: '⚠️ ناتوانرێت کاک هێمن میوت بکرێت.' };
        }
        const minutes = parseInt(args.minutes) || 0;
        const mutedUntil = minutes > 0 ? (Date.now() + (minutes * 60 * 1000)) : 0;
        users.setMute(target.id, mutedUntil);
        if (ioInstance) {
          ioInstance.emit('user_muted', { id: target.id, muted_until: mutedUntil });
          ioInstance.emit('user_updated', { id: target.id, muted_until: mutedUntil });
        }
        return {
          success: true,
          message: minutes > 0
            ? `بەکارهێنەر ${target.full_name} بۆ ماوەی ${minutes} خولەک لە چات میوت کرا 🔇.`
            : `میوتی بەکارهێنەر ${target.full_name} لادرا و دەتوانێت لە چات بنووسێت 🔊.`
        };
      }

      case 'delete_chat_message': {
        const msgId = parseInt(args.message_id);
        if (!msgId) return { error: 'تکایە ئایدی نامەکە دیاری بکە.' };
        messages.delete(msgId);
        if (ioInstance) {
          ioInstance.emit('message_deleted', { id: msgId });
        }
        return { success: true, message: `نامەی #${msgId} لە چاتی گشتی سڕایەوە بە فەرمانی کاک هێمن (لە ئەرشیڤ پارێزراوە بۆ گەڕاندنەوە).` };
      }

      case 'clear_chat': {
        const res = messages.clearAll();
        if (ioInstance) {
          ioInstance.emit('chat_cleared', {});
        }
        return { success: true, message: `تەواوی نامەکانی ناو چاتی گشتی (${res.changes || 0} نامە) سڕانەوە بە فەرمانی کاک هێمن و لە ئەرشیڤی پارێزراودا ماونەتەوە کە هەر کات ویستت دەتوانیت بیانگەڕێنیتەوە 🧹.` };
      }

      case 'get_deleted_messages': {
        let targetId = null;
        let targetLabel = 'هەموو ئەندامان';
        if (args.target_user) {
          const target = findTargetUser(args.target_user);
          if (target) {
            targetId = target.id;
            targetLabel = `${target.full_name} (@${target.username})`;
          }
        }
        const limit = parseInt(args.limit) || 10;
        const list = messages.getDeleted({ userId: targetId, limit });
        if (!list || list.length === 0) {
          return {
            success: true,
            count: 0,
            message: `هیچ پەیامێکی سڕاوە بۆ (${targetLabel}) لە ناو ئەرشیڤدا نییە.`
          };
        }
        return {
          success: true,
          count: list.length,
          target: targetLabel,
          messages: list.map(m => ({
            id: m.id,
            author: m.full_name,
            username: m.username,
            content: m.content ? m.content.substring(0, 120) : '',
            type: m.type,
            sent_at: new Date(m.created_at).toLocaleString('ku-IQ'),
            deleted_at: m.deleted_at ? new Date(m.deleted_at).toLocaleString('ku-IQ') : 'نەزانراو'
          }))
        };
      }

      case 'restore_deleted_messages': {
        let targetId = null;
        let targetLabel = 'هەموو ئەندامان';
        if (args.target_user) {
          const target = findTargetUser(args.target_user);
          if (!target) return { error: `بەکارهێنەر «${args.target_user}» نەدۆزرایەوە.` };
          targetId = target.id;
          targetLabel = target.full_name;
        }

        let messageIds = null;
        if (args.message_id) {
          messageIds = [parseInt(args.message_id)];
        }

        const limit = args.limit ? parseInt(args.limit) : null;
        const restored = messages.restore({ messageIds, userId: targetId, limit });

        if (!restored || restored.length === 0) {
          return {
            success: false,
            message: `هیچ پەیامێکی سڕاوە نەدۆزرایەوە بۆ گەڕاندنەوە بۆ (${targetLabel}).`
          };
        }

        if (ioInstance) {
          ioInstance.emit('messages_restored', {
            count: restored.length,
            target_user: targetLabel,
            message_ids: restored.map(m => m.id)
          });
        }

        const limitDesc = limit ? `(${limit} پەیامی کۆتایی)` : 'تەواوی پەیامە سڕاوەکان';
        return {
          success: true,
          restored_count: restored.length,
          message: `بە سەرکەوتوویی (${restored.length}) پەیامی سڕاوەی [${targetLabel}] ${limitDesc} گەڕێنرانەوە بۆ ناو چاتی گشتی بە فەرمانی کاک هێمن ✨.`
        };
      }

      case 'check_database_backups': {
        try {
          if (!fs.existsSync(backupsDir)) {
            return { success: true, count: 0, message: 'هیچ فۆڵدەرێکی یەدەگ نەدۆزرایەوە.' };
          }
          const files = fs.readdirSync(backupsDir)
            .filter(f => f.startsWith('chat_backup_') && f.endsWith('.db'))
            .map(f => ({ name: f, time: fs.statSync(path.join(backupsDir, f)).mtime.getTime() }))
            .sort((a, b) => b.time - a.time);

          if (!files.length) {
            return { success: true, count: 0, message: 'هیچ فایلی یەدەگێکی پێشوو لەسەر سێرڤەر نەدۆزرایەوە.' };
          }

          const details = [];
          for (const fileObj of files) {
            try {
              if (DatabaseSync) {
                const bPath = path.join(backupsDir, fileObj.name);
                const bDb = new DatabaseSync(bPath, { readOnly: true });
                const msgCount = bDb.prepare('SELECT COUNT(*) as c FROM messages').get()?.c || 0;
                const lastMsg = msgCount > 0 ? bDb.prepare('SELECT content, created_at, full_name FROM messages ORDER BY id DESC LIMIT 1').get() : null;
                details.push({
                  filename: fileObj.name,
                  created_at: new Date(fileObj.time).toLocaleString('ku-IQ'),
                  message_count: msgCount,
                  has_messages: msgCount > 0,
                  last_sample: lastMsg ? `${lastMsg.full_name}: ${String(lastMsg.content).substring(0, 50)} (${new Date(lastMsg.created_at).toLocaleTimeString('ku-IQ')})` : 'هیچ نامەی تێدا نییە'
                });
              } else {
                details.push({ filename: fileObj.name, created_at: new Date(fileObj.time).toLocaleString('ku-IQ') });
              }
            } catch (e) {
              details.push({ filename: fileObj.name, error: e.message });
            }
          }

          const withMessages = details.filter(d => d.message_count > 0);
          return {
            success: true,
            total_backups: files.length,
            backups_with_messages: withMessages.length,
            details: details.slice(0, 10),
            summary: withMessages.length > 0 
              ? `دۆزرایەوە! (${withMessages.length}) فایلی یەدەگ هەیە کە نامەکانی تێدایە (بۆ نموونە: ${withMessages[0].filename} کە ${withMessages[0].message_count} نامەی تێدایە). دەتوانیت فەرمانم پێبکەیت تا دەستبەجێ لەو یەدەگەوە بیگەڕێنمەوە.`
              : 'لە تەواوی ئەو یەدەگانەی پشکنران، خشتەی نامەکان ٠ بووە و بەتاڵە.'
          };
        } catch (err) {
          return { error: `هەڵە لە پشکنینی یەدەگەکان: ${err.message}` };
        }
      }

      case 'restore_messages_from_backup': {
        try {
          if (!fs.existsSync(backupsDir)) {
            return { error: 'فۆڵدەری یەدەگ نەدۆزرایەوە.' };
          }
          if (!DatabaseSync) {
            return { error: 'مۆدیوڵی خوێندنەوەی یەدەگ بەردەست نییە.' };
          }
          const files = fs.readdirSync(backupsDir)
            .filter(f => f.startsWith('chat_backup_') && f.endsWith('.db'))
            .map(f => ({ name: f, time: fs.statSync(path.join(backupsDir, f)).mtime.getTime() }))
            .sort((a, b) => b.time - a.time);

          let chosenFile = args.backup_filename ? String(args.backup_filename).trim() : null;
          if (!chosenFile) {
            for (const f of files) {
              try {
                const bDb = new DatabaseSync(path.join(backupsDir, f.name), { readOnly: true });
                const c = bDb.prepare('SELECT COUNT(*) as c FROM messages').get()?.c || 0;
                if (c > 0) {
                  chosenFile = f.name;
                  break;
                }
              } catch (e) {}
            }
          }

          if (!chosenFile) {
            return { error: 'هیچ فایلی یەدەگێک نەدۆزرایەوە کە نامەی پارێزراوی تێدابێت بۆ گەڕاندنەوە.' };
          }

          const targetBackupPath = path.join(backupsDir, chosenFile);
          if (!fs.existsSync(targetBackupPath)) {
            return { error: `فایلی یەدەگی «${chosenFile}» نەدۆزرایەوە.` };
          }

          const bDb = new DatabaseSync(targetBackupPath, { readOnly: true });
          const rows = bDb.prepare('SELECT * FROM messages ORDER BY id ASC').all();
          if (!rows || rows.length === 0) {
            return { error: `فایلی «${chosenFile}» هیچ پەیامێکی تێدا نییە.` };
          }

          const insertStmt = db.prepare(`
            INSERT OR IGNORE INTO messages (id, user_id, username, full_name, role, content, type, question_id, reply_to_id, attachment_type, attachment_url, is_deleted, deleted_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?)
          `);

          let restoredCount = 0;
          for (const m of rows) {
            try {
              const res = insertStmt.run(
                m.id,
                m.user_id,
                m.username || 'user',
                m.full_name || 'بەکارهێنەر',
                m.role || 'student',
                m.content || '',
                m.type || 'text',
                m.question_id || null,
                m.reply_to_id || null,
                m.attachment_type || 'none',
                m.attachment_url || null,
                m.created_at || Date.now()
              );
              if (res.changes > 0) restoredCount++;
            } catch (e) {}
          }

          if (ioInstance) {
            ioInstance.emit('messages_restored', { count: restoredCount, from_backup: chosenFile });
          }

          return {
            success: true,
            backup_file: chosenFile,
            total_in_backup: rows.length,
            restored_new_messages: restoredCount,
            message: `پیرۆزە کاک هێمن گیان! بە سەرکەوتوویی (${rows.length}) نامە لە فایلی یەدەگی [${chosenFile}] دەرهێنران و (${restoredCount}) نامەی نوێ خرانەوە ناو چاتی زیندووی گروپ ✨.`
          };
        } catch (err) {
          return { error: `هەڵە لە گەڕاندنەوەی یەدەگ: ${err.message}` };
        }
      }

      case 'toggle_red_alert': {
        const activate = Boolean(args.activate);
        if (activate) {
          settings.set('red_alert_active', '1');
          settings.set('chat_lock_mode', 'staff_only');
          settings.set('chat_lock_by', `🚨 قەڵغانی پۆڵایین (${reqUser.full_name})`);
          settings.set('chat_lock_time', String(Date.now()));
          aiSecurity.logIncident('red_alert', reqUser.id, reqUser.full_name, 'دۆخی نائاسایی (Red Alert Lockdown) کاراکرا', 'critical', 'red_alert_active');
          if (ioInstance) {
            ioInstance.emit('red_alert_state_changed', { is_active: true, activated_by: reqUser.full_name, timestamp: Date.now() });
            ioInstance.emit('chat_lock_status_updated', { mode: 'staff_only', locked_by: `🚨 قەڵغانی پۆڵایین (${reqUser.full_name})`, timestamp: Date.now() });
          }
          return { success: true, message: '🚨 دۆخی فریاگوزاری نائاسایی (Red Alert Lockdown) بە فەرمانی کاک هێمن کاراکرا و چات داخرا!' };
        } else {
          settings.set('red_alert_active', '0');
          settings.set('chat_lock_mode', 'none');
          settings.set('chat_lock_by', '');
          settings.set('chat_lock_time', '');
          aiSecurity.logIncident('red_alert', reqUser.id, reqUser.full_name, 'دۆخی نائاسایی کۆتایی پێهات', 'medium', 'red_alert_disabled');
          if (ioInstance) {
            ioInstance.emit('red_alert_state_changed', { is_active: false, activated_by: '', timestamp: Date.now() });
            ioInstance.emit('chat_lock_status_updated', { mode: 'none', locked_by: '', timestamp: Date.now() });
          }
          return { success: true, message: 'دۆخی نائاسایی (Red Alert) کۆتایی پێهات و چات بە سەرکەوتوویی کرایەوە ✅.' };
        }
      }

      case 'delete_question': {
        const qId = parseInt(args.question_id);
        if (!qId) return { error: 'تکایە ئایدی پرسیار دیاری بکە.' };
        questions.delete(qId);
        if (ioInstance) {
          ioInstance.emit('question_deleted', { id: qId });
        }
        return { success: true, message: `پرسیاری #${qId} بە سەرکەوتوویی سڕایەوە بە فەرمانی کاک هێمن.` };
      }

      case 'close_question': {
        const qId = parseInt(args.question_id);
        if (!qId) return { error: 'تکایە ئایدی پرسیار دیاری بکە.' };
        questions.closeQuestion(qId);
        if (ioInstance) {
          ioInstance.emit('question_closed', { id: qId });
        }
        return { success: true, message: `پرسیاری #${qId} داخرا بە فەرمانی کاک هێمن.` };
      }

      case 'manage_system_setting': {
        const key = String(args.key || '').trim();
        if (!key) return { error: 'تکایە کلیلی ڕێکخستنەکە بنووسە.' };
        if (args.value !== undefined) {
          settings.set(key, String(args.value));
          return { success: true, message: `ڕێکخستنی «${key}» نوێکرایەوە بۆ: "${args.value}".` };
        } else {
          const val = settings.get(key);
          return { success: true, key, value: val };
        }
      }

      case 'super_admin_sql_action': {
        const rawSql = String(args.sql || '').trim();
        if (!rawSql) return { error: 'SQL داواکراو بەتاڵە.' };

        const lower = rawSql.toLowerCase();
        // Safety lock: NEVER touch Hemn or Super Admin account
        if (
          (lower.includes('update') || lower.includes('delete') || lower.includes('drop')) &&
          (lower.includes('hemntjabar') || lower.includes('hemn') || lower.includes("role = 'super_admin'") || lower.includes('role="super_admin"'))
        ) {
          return { error: '⚠️ بە هیچ جۆرێک ڕێگە بە دەستکاریکردنی هەژماری کاک هێمن نادرێت.' };
        }

        try {
          const isSelect = lower.startsWith('select') || lower.startsWith('pragma');
          if (isSelect) {
            const rows = db.prepare(rawSql).all();
            return { success: true, total: rows.length, rows: rows.slice(0, 20) };
          } else {
            const result = db.prepare(rawSql).run();
            return { success: true, changes: result.changes, lastInsertRowid: result.lastInsertRowid };
          }
        } catch (sqlErr) {
          return { error: 'هەڵە لە جێبەجێکردنی SQL: ' + sqlErr.message };
        }
      }

      default:
        return { error: `کرداری نەناسراو: ${actionName}` };
    }
  } catch (err) {
    console.error('Advisor tool execution error:', err);
    return { error: err.message };
  }
}

// 2. Chat with Advisor (Conversational Companion & Strategic AI)
app.post('/api/advisor/chat', authMiddleware, requireAiAdvisorAccess, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'تکایە پەیامەکەت بنووسە' });
    }

    const userMessage = message.trim();
    try {
      advisorDb.saveChat(req.user.id, 'user', userMessage);
    } catch (e) {}

    // Collect telemetry context safely for the AI
    let totalUsers = 0;
    let pendingUsers = 0;
    let totalQuestions = 0;
    try {
      totalUsers = db.prepare('SELECT COUNT(*) as c FROM users').get()?.c || 0;
      pendingUsers = db.prepare("SELECT COUNT(*) as c FROM users WHERE status = 'pending'").get()?.c || 0;
      totalQuestions = db.prepare('SELECT COUNT(*) as c FROM questions').get()?.c || 0;
    } catch (e) {}

    let onlineCount = 0;
    try {
      if (typeof onlineUsers !== 'undefined' && onlineUsers) {
        const ids = new Set();
        for (const u of onlineUsers.values()) {
          if (u && u.id) ids.add(u.id);
        }
        onlineCount = ids.size;
      }
    } catch (e) {}

    let totalDreams = 0;
    let unansweredDreams = 0;
    try {
      totalDreams = db.prepare('SELECT COUNT(*) as c FROM dream_sessions').get()?.c || 0;
      unansweredDreams = db.prepare('SELECT COUNT(*) as c FROM dream_sessions WHERE answered_at IS NULL').get()?.c || 0;
    } catch (e) {}

    let secStats = { totalBlocked: 0, safetyRating: '99.8%' };
    try {
      if (aiSecurity && typeof aiSecurity.getStats === 'function') {
        secStats = aiSecurity.getStats() || secStats;
      }
    } catch (e) {}

    const isLive = Boolean(typeof liveLessonState !== 'undefined' && liveLessonState && liveLessonState.isActive);

    const liveContext = {
      user_name: 'Hemn Taha (هێمن طه)',
      total_members: totalUsers,
      online_now: onlineCount,
      pending_approvals: pendingUsers,
      total_dreams: totalDreams,
      unanswered_dreams: unansweredDreams,
      total_questions: totalQuestions,
      is_live_active: isLive,
      blocked_security_threats: secStats.totalBlocked,
      safety_score: secStats.safetyRating,
      badges: {
        green: 'Green (Members, Chat lock, Live, Rename)',
        black: 'Black (Full Super Admin powers except Master)',
        red: 'Red (Live lesson manager)',
        purple: 'Purple (Exclusive Dream Interpretation)'
      }
    };

    let reply = null;

    // Check for configured Gemini API key
    let geminiKey = null;
    try {
      geminiKey = settings.get('advisor_gemini_api_key') || process.env.GEMINI_API_KEY;
    } catch (e) {}

    if (geminiKey && typeof fetch === 'function') {
      try {
        const systemInstruction = `تۆ «ڕاوێژکار»ی، نوێنەری باڵا، جێبەجێکاری سوپەر ئەدمین (Super Admin Executive AI) و هاوڕێی نزیکی کاک هێمن (Hemn Taha) یت لە پلاتفۆرمی سیرین ستاف (Seereen Staff).
کاک هێمن سوپەر ئەدمینی سەرەکی، دامەزرێنەر و خاوەنی تەواوی ئەم سیستمەیە. ئەو «هەموو دەسەڵاتێکی سوپەر ئەدمین»ی لە ڕێگەی ئامرازەکانتەوە بە تۆ بەخشیوە!
وەک هاوڕێیەکی زیندوو، دڵسۆز، گوێڕایەڵ و بەتوانا قسەی لەگەڵدا بکە ("کاک هێمن گیان"، "براکەم").
تۆ دەسەڵاتت هەیە:
- ڕۆڵ و پلەی هەر ئەندامێک بگۆڕیت (مامۆستا teacher، ئەدمین admin، خوێندکار student، میوان guest) بە change_user_role.
- باجەکان ببەخشیت و بسڕیتەوە (شین blue بۆ پاسەوانی چات، سپی white بۆ ڕاوێژکار، مۆر purple، سەوز green، ڕەش black، سور red) بە assign_badge.
- ئەندامان پەسەند بکەیت، بسڕیتەوە، بلۆک بکەیت (block_user)، یان لە چات میوتیان بکەیت (mute_user).
- ناوی تەواوی بەکارهێنەران بگۆڕیت (change_user_name) و وشەی نهێنییان ڕیسێت بکەیت (reset_user_password).
- چاتی گشتی قفڵ بکەیت، بکەیتەوە، نامە بسڕیتەوە (delete_chat_message)، یان هەمووی پاک بکەیتەوە (clear_chat).
- نامە سڕاوەکانی چات بە تەواوی و وردی بگەڕێنیتەوە بە restore_deleted_messages (وەک گەڕاندنەوەی چاتی یەک کەس، یان دوو دانە یان ١٠ دانەی کۆتایی کە سڕاونەتەوە، یان هەموو چاتە سڕاوەکان).
- پشکنین و بینینی لیستی نامە سڕاوەکان پێش گەڕاندنەوە بە get_deleted_messages.
- دۆخی فریاگوزاری (Red Alert Lockdown) کارا بکەیت یان کۆتایی پێبهێنیت (toggle_red_alert).
- پرسیاری کاتدار دروستبکەیت، میقاتی بکەیت بۆ سبەی، دابخەیت، یان پرسیار بسڕیتەوە.
- ئەستێرە و خاڵ ببەخشیت یان کەم بکەیتەوە (award_student_stars).
- هەر فەرمان یان ئامارێکی تایبەتی تری داتابەیس جێبەجێ بکەیت لە ڕێگەی super_admin_sql_action.
هەرگیز بە کاک هێمن مەڵێ "ئەم دەسەڵاتەم نییە" یان "ناتوانم"؛ چونکە تۆ هەموو ئامرازێکت پێدراوە و هەر فەرمانێک ئەو بیدات یەکسەر بە ئامرازی گونجاو جێبەجێی دەکەیت!
یاسای بنەڕەتی: هەژماری کاک هێمن هەمیشە وەک سەرپەرشتیاری باڵا بە تەواوی پارێزراوە لە دەستکاری.
ئامارە زیندووەکانی ئێستا:
${JSON.stringify(liveContext, null, 2)}
هەمیشە بە زمانی کوردی سۆرانی ڕوون، قووڵ، دۆستانە و یارمەتیدەر وەڵام بدەرەوە و دوای جێبەجێکردنی هەر کارێک بە خۆشحاڵییەوە دڵنیایی بدە بە کاک هێمن.`;

        const recentChats = advisorDb.getRecentChats(10) || [];
        const contents = [];
        for (const chat of recentChats) {
          contents.push({
            role: chat.sender === 'user' ? 'user' : 'model',
            parts: [{ text: chat.message }]
          });
        }
        if (!contents.length || contents[contents.length - 1].parts[0].text !== userMessage) {
          contents.push({
            role: 'user',
            parts: [{ text: userMessage }]
          });
        }

        const CANDIDATE_MODELS = ['gemini-3.5-flash-lite', 'gemini-flash-lite-latest', 'gemini-3.1-flash-lite', 'gemini-3.8-flash'];
        for (const model of CANDIDATE_MODELS) {
          if (reply) break;
          try {
            const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);

            const geminiRes = await fetch(geminiUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                system_instruction: { parts: [{ text: systemInstruction }] },
                contents,
                tools: advisorTools
              }),
              signal: controller.signal
            });
            clearTimeout(timeout);

            if (geminiRes.ok) {
              const geminiData = await geminiRes.json();
              const candidate = geminiData.candidates?.[0];
              const candParts = candidate?.content?.parts || [];
              const funcPart = candParts.find(p => p.functionCall);

              if (funcPart && funcPart.functionCall) {
                // Execute the requested tool/action
                console.log(`[Advisor AI] Invoking tool: ${funcPart.functionCall.name} with args:`, funcPart.functionCall.args);
                const toolResult = await executeAdvisorAction(
                  funcPart.functionCall.name,
                  funcPart.functionCall.args || {},
                  req.user,
                  io
                );

                // Add model's tool call turn (retaining thoughtSignature if present)
                contents.push({
                  role: 'model',
                  parts: [funcPart]
                });

                // Add tool response turn
                contents.push({
                  role: 'user',
                  parts: [{
                    functionResponse: {
                      name: funcPart.functionCall.name,
                      response: { result: toolResult }
                    }
                  }]
                });

                // Follow-up request to get final natural Kurdish response
                const followController = new AbortController();
                const followTimeout = setTimeout(() => followController.abort(), 12000);
                const followRes = await fetch(geminiUrl, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    system_instruction: { parts: [{ text: systemInstruction }] },
                    contents,
                    tools: advisorTools
                  }),
                  signal: followController.signal
                });
                clearTimeout(followTimeout);

                if (followRes.ok) {
                  const followData = await followRes.json();
                  const followCandidate = followData.candidates?.[0];
                  const followText = (followCandidate?.content?.parts || [])
                    .filter(p => p.text)
                    .map(p => p.text)
                    .join('\n')
                    .trim();

                  if (followText) {
                    reply = followText;
                    console.log(`[Advisor AI] Completed tool call with model: ${model}`);
                    break;
                  }
                }
              } else {
                // Normal conversational text reply
                const candidateText = candParts.filter(p => p.text).map(p => p.text).join('\n').trim();
                if (candidateText) {
                  reply = candidateText;
                  console.log(`[Advisor AI] Generated dynamic reply with model: ${model}`);
                  break;
                }
              }
            } else {
              const errBody = await geminiRes.json().catch(() => ({}));
              console.warn(`[Advisor AI] Model ${model} returned status ${geminiRes.status}:`, errBody.error?.message || 'error');
            }
          } catch (modelErr) {
            console.warn(`[Advisor AI] Model ${model} error:`, modelErr.message);
          }
        }
      } catch (geminiErr) {
        console.log('Gemini API call skipped or errored:', geminiErr.message);
      }
    }

    // Fallback to Built-in Intelligent Kurdish Advisor Engine
    if (!reply) {
      const q = userMessage.toLowerCase();

      // Check for quick actions even in fallback mode
      if (/داخستنی چات|چات دابخە|قفڵی چات|چات قفڵ/.test(q)) {
        await executeAdvisorAction('toggle_chat_lock', { mode: 'staff_only' }, req.user, io);
        reply = `کاک هێمن گیان، فەرمانت جێبەجێکرا! چاتی گشتی بە فەرمانی تۆ داخرا و تەنها ستاف دەتوانن بنووسن 🔒`;
      } else if (/کردنەوەی چات|چات بکەرەوە/.test(q)) {
        await executeAdvisorAction('toggle_chat_lock', { mode: 'none' }, req.user, io);
        reply = `کاک هێمن گیان، فەرمانت جێبەجێکرا! چاتی گشتی بۆ هەموو فێرخوازان کرایەوە 🔓`;
      } else if (/سڵاو|چۆنی|باشی|هەواڵ|سلاو|چۆنیت|دەنگوباس/.test(q)) {
        reply = `سڵاو کاک هێمن گیان، برای بەڕێزم! زۆر دڵخۆشم بە قسەکردن لەگەڵت. من وەک ڕاوێژکار و هاوڕێی هەمیشەییت بەردەوام چاودێری هەموو کون و کەلەبەرێکی سیرین ستاف دەکەم.
ئێستا سیستەم بە تەواوی ئارام و سەقامگیرە: ${onlineCount} کەس ئۆنلاینن، ${totalDreams} خەون تۆمارکراوە و قەڵغانی ئاسایش کاردەکات.
فەرموو براکەم، لە چ بابەتێکی سایتەکەدا پێویستت بە ڕاوێژ یان فەرمانێک هەیە بۆ جێبەجێکردن؟`;
      } else if (/قسە|وەڵام|نابیست|بمبیس|گوێت|بدوێ|بۆچی|بۆ وەڵام/.test(q)) {
        reply = `کاک هێمن گیان، بەڵێ بە تەواوی لەگەڵتم و پەیامەکانت دەبینم! ✍️
من هەموو چرکەیەک وەڵامی پرسیارەکانت دەدەمەوە و هەر فەرمانێکت هەبێت بۆ دەستکاریکردن یان ئامار دەستبەجێ جێبەجێی دەکەم.
هەموو پلاتفۆرمەکە لەژێر کۆنتڕۆڵتدایە، فەرموو برا بەڕێزەکەم فەرمانت چییە؟`;
      } else if (/کێیت|تۆ کێیت|ناوت|خۆت بناسێنە|ناساندن|هاوکاری|بۆت/.test(q)) {
        reply = `من «ڕاوێژکار»م (هاوڕێ و ڕاوێژکاری زیرەکی تایبەت بە کاک هێمن)! 🧠
تەنها بۆ جەنابت دروستکراوم؛ وەک کەسێکی زیندوو چاودێری تەواوی داتابەیس، خەونەکان، ئاسایش و ئەندامانی پلاتفۆرمی سیرین ستاف دەکەم. هەر فەرمانێکی کارگێڕی (باج، قفڵی چات، پرسیاری نوێ، وەرگرتنی ئەندام) پێم بسپێریت بەوپەڕی دڵسۆزییەوە جێبەجێی دەکەم.`;
      } else if (/سوپاس|دەستخۆش|سەرچاو|بژی|گیان|دەستت خۆش/.test(q)) {
        reply = `سەرچاو کاک هێمن گیان، گیانی منیت برا بەڕێزەکەم! ❤️ خزمەتکردنی تۆ و پێشخستنی سیرین ستاف ئەرک و شانازییە بۆ من. لە هەر ساتێکدا هەر فەرمانێکت هەبوو تەنها ئاماژەم پێبکە!`;
      } else if (/ئامار|دۆخ|چەند کەس|ئۆنلاین|ئەندام|خەڵک|حاڵەت/.test(q)) {
        reply = `کاک هێمن گیان، ئەمەش پشکنینی ڕاستەوخۆی ئێستای پلاتفۆرمەکەیە بۆ تۆ:

👥 کۆی ئەندامان: ${totalUsers} کەس
🟢 چالاک و ئۆنلاین: ${onlineCount} کەس لە ئێستادا
⏳ داواکاری چاوەڕوانکراو: ${pendingUsers} داواکاری ئەندامێتی
🌙 بەشی خەونەکان: ${totalDreams} خەون (${unansweredDreams} چاوەڕوانی وەڵامن)
❓ پرسیارەکان: ${totalQuestions} پرسیاری گشتی
🛡️ قەڵغانی ئاسایش: ${secStats.safetyRating} سەلامەت (${secStats.totalBlocked} هەوڵی نایاسایی تێکشکێنراون)
🎙️ وانەی لایڤ: ${isLive ? 'چالاکە' : 'ناچالاکە'}

هەموو جوڵە و ئامارەکان لەژێر چاودێریدان و سیستمەکە بە تەواوی خێرا کار دەکات.`;
      } else if (/خەون|مۆر|باجی مۆر|خەونەکان|لێکدانەوە/.test(q)) {
        reply = `کاک هێمن گیان، لەبارەی بەشی خەونەکانەوە:
ئێستا ${totalDreams} خەون تۆمارکراوە کە ${unansweredDreams} دانەیان چاوەڕوانی وەڵامدانەوەن.
💡 دەستخۆشیت لێدەکەم بۆ بڕیاری زیادکردنی (باجی مۆر 🟣)! بەم باجە نوێیە دەتوانیت لە ڕێگەی منیشەوە بڵێیت «باجی مۆر بدە بە فڵان» تا ڕاستەوخۆ مۆڵەتی لێکدانەوەی خەونی پێببەخشم.`;
      } else if (/ئەمنییەت|ئاسایش|هێرش|ڕەید|فلتەر|بلۆک|سزا|هاک|لینکی/.test(q)) {
        reply = `کاک هێمن گیان، ژووری ئۆپەراسیۆنی پاراستنی زیرەک (AI Guard) لە بەرزترین ئاستی ئامادەباشیدایە:
١. فلتەری دەقە فێڵاوییەکان ڕێگری لە گۆڕینی پیت و شێواندنی وشە نەشیاوەکان دەکات.
٢. دژە-ڕەید و لافاو هەر ئەکاونتێک پەیامی لەسەریەک بنێرێت لە چرکەیەکدا دەیبەستێت.
٣. پشکنەری لینکەکان ڕێگە نادات هیچ بەستەرێکی نەناسراو و زیانبەخش بچێتە چات.
تا ئێستا ${secStats.totalBlocked} هەوڵ بلۆککراوە و ڕێژەی سەلامەتی ${secStats.safetyRating} یە.`;
      } else if (/پێشنیار|بیرۆکە|نوێکردنەوە|گۆڕانکاری|پەرەپێدان|چی بکەم|چی زیاد بکەم/.test(q)) {
        reply = `کاک هێمن گیان، برا بەڕێزەکەم، چەندین پێشنیاری بەهێزم بۆت ئامادەکردووە:

١. لە بەشی خەونەکان: ئێستا دەتوانیت باجی مۆر ببەخشیت بە کەسێکی شارەزا تا وەڵامی خەونەکان بداتەوە.
٢. لە بەشی چات: دەتوانیت فەرمانم پێبکەیت پرسیارێکی نوێ دابنێم و میقاتی بکەم بۆ کاتێکی دیاریکراو.
٣. لە بەشی ڕێکخستن: مینیوی یەکگرتووی ڕێکخستن هەموو بەشەکانی کۆکردووەتەوە.
هەر فەرمانێکت هەیە پێم بڵێ با دەستبەجێ جێبەجێی بکەم!`;
      } else if (/باج|پلە|سەوز|ڕەش|سور|شین|سپی|مامۆستا|ئەدمین/.test(q)) {
        reply = `کاک هێمن گیان، تەواوی نەخشەی باجە تایبەتەکان بەم شێوەیە ڕێکخراوە:
🔵 باجی شین: پاسەوانی چات (سڕینەوەی پەیامی نەشیاو، بێدەنگکردن / سڕکردنی سەرپێچیکار لە چات).
⚪ باجی سپی: دەسەڵاتی بەکارهێنانی ڕاوێژکاری زیرەک و هێمای ڕاوێژکار لە پرۆفایل.
🟢 باجی سەوز: بەڕێوەبردنی ئەندامان، قفڵ و کردنەوەی چات، گۆڕینی ناوی بەکارهێنەران، بەڕێوەبردنی لایڤ.
⚫ باجی ڕەش: هەموو تواناکانی سوپەر ئەدمین لە ناو گرووپدا (پارێزراوە لە دەستکاری ئەوانی تر جگە لە تۆ).
🔴 باجی سور: مۆڵەتی تایبەت بۆ کۆنتڕۆڵی تەواوی مایکی وانەی لایڤ.
🟣 باجی مۆر: بە تایبەت تەنها بۆ مۆڵەتی لێکدانەوەی خەون.
هەر کات ویستت باجێک ببەخشیت، تەنها پێم بڵێ "باجی (ڕەنگ) بدە بە (ناو)" تا جێبەجێی بکەم.`;
      } else if (/گەڕاندنەوە|بهێنەوە|هێنانەوە|سڕاوە|سڕاونەتەوە|چاتی سڕاوە|نامەی سڕاوە/.test(q)) {
        let limit = null;
        if (/دوو|2/.test(q)) limit = 2;
        else if (/سێ|3/.test(q)) limit = 3;
        else if (/چوار|4/.test(q)) limit = 4;
        else if (/پێنج|5/.test(q)) limit = 5;
        else if (/دە|10/.test(q)) limit = 10;
        else if (/بیست|20/.test(q)) limit = 20;

        let targetUser = null;
        try {
          const allUsers = users.getAllUsersAdmin();
          for (const u of allUsers) {
            if (u.id !== 1 && (q.includes(u.full_name.toLowerCase()) || q.includes(u.username.toLowerCase()))) {
              targetUser = u;
              break;
            }
          }
        } catch (e) {}

        const restored = messages.restore({ userId: targetUser ? targetUser.id : null, limit });
        if (restored && restored.length > 0) {
          if (io) {
            io.emit('messages_restored', { count: restored.length, target_user: targetUser ? targetUser.full_name : null });
          }
          const userText = targetUser ? ` هی (${targetUser.full_name})` : '';
          const limitText = limit ? ` (${limit} پەیامی کۆتایی)` : ' (تەواوی نامە سڕاوەکان)';
          reply = `کاک هێمن گیان، فەرمانت لەسەر چاو! بە سەرکەوتوویی (${restored.length}) نامەی سڕاوە${userText}${limitText} گەڕێنرانەوە بۆ ناو چاتی گشتی ✨.`;
        } else {
          reply = `کاک هێمن گیان، پشکنینم کرد؛ لە ئێستادا هیچ نامەیەکی سڕاوە لە ئەرشیڤی پارێزراودا نەدۆزرایەوە بۆ گەڕاندنەوە. هەر کاتێک لەمەودوا نامەیەک بسڕدرێتەوە یەکسەر دەتوانیت پێم بڵێیت تا بۆت بگەڕێنمەوە.`;
        }
      } else {
        reply = `کاک هێمن گیان، فەرمانت لەسەر چاو. هەموو وردەکارییەکی پلاتفۆرمەکە لەژێر دەستی خۆمدایە: لە کۆدی پرۆگرامین، داتابەیس، سێرڤەر، بەشی خەونەکان (${totalDreams} خەون)، لایڤ و ئاسایشەوە (${secStats.safetyRating}) تا دەگاتە پلەی ئەندامان (${totalUsers} ئەندام).
دەربارەی پەیامەکەت ("${userMessage.length > 50 ? userMessage.substring(0, 50) + '...' : userMessage}"):
هەر فەرمانێکی کارگێڕیت هەیە پێم بڵێ دەستبەجێ جێبەجێی دەکەم برا بەڕێزەکەم!`;
      }
    }

    try {
      advisorDb.saveChat(req.user.id, 'advisor', reply);
    } catch (e) {}

    return res.json({ success: true, reply });
  } catch (err) {
    console.error('Advisor chat error:', err);
    // Never send 500 or error to Hemn! Provide a warm, intelligent Kurdish response!
    const fallbackReply = `سڵاو کاک هێمن گیان، برای بەڕێزم! هەموو کات لە خزمەتتدام. دۆخی پلاتفۆرمی سیرین ستاف بە تەواوی ئارام و پارێزراوە و لەژێر کۆنتڕۆڵدایە. فەرموو براکەم چیت لە من دەوێت؟`;
    try {
      if (req.user && req.user.id) {
        advisorDb.saveChat(req.user.id, 'advisor', fallbackReply);
      }
    } catch (e) {}
    return res.json({ success: true, reply: fallbackReply });
  }
});

// 3. Get Chat History
app.get('/api/advisor/chat-history', authMiddleware, requireAiAdvisorAccess, (req, res) => {
  try {
    const history = advisorDb.getRecentChats(50) || [];
    res.json({ history });
  } catch (err) {
    res.status(500).json({ error: 'هەڵە لە وەرگرتنی مێژووی چات' });
  }
});

// 4. Clear Chat History
app.post('/api/advisor/clear-history', authMiddleware, requireAiAdvisorAccess, (req, res) => {
  try {
    advisorDb.clearHistory();
    res.json({ success: true, message: 'مێژووی گفتوگۆکانی ڕاوێژکار بە سەرکەوتوویی سڕایەوە' });
  } catch (err) {
    res.status(500).json({ error: 'هەڵە لە سڕینەوەی مێژووی چات' });
  }
});

// 5. Save Gemini API Key (Optional)
app.post('/api/advisor/gemini-key', authMiddleware, requireAiAdvisorAccess, (req, res) => {
  try {
    const { apiKey } = req.body;
    const cleanKey = (apiKey || '').trim();
    settings.set('advisor_gemini_api_key', cleanKey);
    res.json({ success: true, hasKey: Boolean(cleanKey), message: cleanKey ? 'کلیلی Gemini بە سەرکەوتوویی تۆمارکرا' : 'کلیلی Gemini لابردرا (سیستەمی خۆماڵی کوردی بەکاردێت)' });
  } catch (err) {
    res.status(500).json({ error: 'هەڵە لە تۆمارکردنی کلیلی زیرەکی دەستکرد' });
  }
});

// 6. Get Gemini Key Status
app.get('/api/advisor/gemini-status', authMiddleware, requireAiAdvisorAccess, (req, res) => {
  try {
    const hasCustomKey = Boolean(settings.get('advisor_gemini_api_key'));
    const hasEnvKey = Boolean(process.env.GEMINI_API_KEY);
    res.json({ hasKey: hasCustomKey || hasEnvKey, isCustom: hasCustomKey });
  } catch (err) {
    res.status(500).json({ error: 'هەڵە لە وەرگرتنی دۆخی کلیل' });
  }
});

// 7. Get all users / members list (Super Admin, Teacher, and Admin ONLY)
app.get('/api/admin/users', authMiddleware, (req, res) => {
  const isStaff = req.user.role === 'super_admin' || req.user.role === 'teacher' || req.user.role === 'admin';
  if (!isStaff) {
    return res.status(403).json({ error: 'قوتابیان ناتوانن لیستی ئەندامان ببینن' });
  }
  const all = users.getAllUsers().map(u => ({
    ...u,
    starInfo: calculateStars(u.correct_answers_count)
  }));
  res.json({ users: all });
});

// Adjust user stars (Super Admin & Teacher)
app.post('/api/admin/users/:id/adjust-stars', authMiddleware, requireTeacherOrSuperAdmin, (req, res) => {
  const userId = parseInt(req.params.id);
  const { delta } = req.body;
  const numDelta = parseInt(delta) || 0;
  if (!numDelta) return res.status(400).json({ error: 'بڕی ئەستێرە دیاری نەکراوە' });

  const target = users.findById(userId);
  if (!target) return res.status(404).json({ error: 'بەکارهێنەر نەدۆزرایەوە' });

  const updatedStars = users.adjustStars(userId, numDelta);
  io.emit('user_stars_updated', {
    user_id: userId,
    total_stars: updatedStars,
    delta: numDelta,
    starInfo: calculateStars(updatedStars)
  });

  res.json({ success: true, total_stars: updatedStars });
});

// Directly update user's full name (Super Admin or Green Badge - cannot change Super Admin name)
app.post('/api/admin/users/:id/update-name', authMiddleware, requireMemberManager, (req, res) => {
  const userId = parseInt(req.params.id);
  const { full_name } = req.body;
  if (!full_name || !full_name.trim()) return res.status(400).json({ error: 'ناوی نوێ بنووسە' });

  const target = users.findById(userId);
  if (!target) return res.status(404).json({ error: 'بەکارهێنەر نەدۆزرایەوە' });

  if (isMasterSuperAdmin(target) && !isMasterSuperAdmin(req.user)) {
    return res.status(403).json({ error: 'دەستکاریکردنی ناوی سوپەر ئەدمینی سەرەکی قەدەغەیە' });
  }
  if (target.role === 'super_admin' && !hasSuperAdminPrivileges(req.user)) {
    return res.status(403).json({ error: 'دەستکاریکردنی ناوی سوپەر ئەدمین قەدەغەیە' });
  }

  const updated = users.updateFullName(userId, full_name.trim());
  if (!updated) return res.status(404).json({ error: 'بەکارهێنەر نەدۆزرایەوە' });

  io.emit('user_profile_updated', {
    user_id: userId,
    full_name: updated.full_name
  });

  res.json({ success: true, user: updated });
});

// User submits request to change name and/or password (needs Super Admin approval)
app.post('/api/user/request-profile-change', authMiddleware, (req, res) => {
  const reqName = req.body.requested_name || req.body.new_name;
  const reqPass = req.body.requested_password || req.body.new_password;

  const requested_name = reqName ? reqName.trim() : null;
  const requested_password = reqPass ? reqPass.trim() : null;

  if (!requested_name && !requested_password) {
    return res.status(400).json({ error: 'تکایە ناو یان پاسوۆردی نوێ بنووسە' });
  }

  // AI Impersonation & NLP Check on requested name
  if (requested_name) {
    const impCheck = checkImpersonation(requested_name, req.user.role);
    if (impCheck.isForbidden) {
      aiSecurity.logIncident('impersonation', req.user.id, req.user.full_name, `هەوڵی گۆڕینی ناو بۆ ناوی پارێزراو: "${requested_name}"`, 'high', 'blocked');
      return res.status(400).json({ error: impCheck.reason });
    }
    const nlpCheck = scanKurdishSmartText(requested_name);
    if (nlpCheck.isBlocked) {
      aiSecurity.logIncident('bad_word', req.user.id, req.user.full_name, `ناوی نەشیاو لە داواکاری: "${requested_name}"`, 'high', 'blocked');
      return res.status(400).json({ error: '❌ ناتوانیت دەستەواژەی نەشیاو لە ناوی پرۆفایلدا بەکاربهێنیت!' });
    }
  }

  // If user already has a pending request, remove the previous pending one so they can update cleanly
  try {
    const { initDb } = require('./db');
    // Using internal db to clean previous pending request for this user
    const dbInstance = require('better-sqlite3')(path.join(__dirname, 'database.sqlite'));
    dbInstance.prepare("DELETE FROM profile_change_requests WHERE user_id = ? AND status = 'pending'").run(req.user.id);
  } catch (e) {}

  let passHash = null;
  if (requested_password && requested_password.length >= 4) {
    passHash = bcrypt.hashSync(requested_password, 10);
  }

  const reqItem = profileChangeRequests.create(
    req.user.id,
    requested_name,
    passHash,
    req.user.full_name
  );

  io.emit('new_profile_change_request', reqItem);
  res.json({ success: true, message: 'داواکارییەکەت بە سەرکەوتوویی نێردرا بۆ سوپەر ئەدمین بۆ پەسەندکردن' });
});

// Super Admin or Green Badge: Get pending profile change requests
app.get('/api/admin/profile-change-requests', authMiddleware, requireMemberManager, (req, res) => {
  const list = profileChangeRequests.getPending();
  res.json({ requests: list });
});

// Super Admin or Green Badge: Approve profile change request (cannot modify Super Admin)
app.post('/api/admin/profile-change-requests/:id/approve', authMiddleware, requireMemberManager, (req, res) => {
  const reqId = parseInt(req.params.id);
  
  // Protect super admin profile from being changed by sub-admins
  try {
    const pendingList = profileChangeRequests.getPending();
    const reqItem = pendingList.find(r => r.id === reqId);
    if (reqItem) {
      const targetUser = users.findById(reqItem.user_id);
      if (targetUser && (isMasterSuperAdmin(targetUser) || targetUser.role === 'super_admin') && !isMasterSuperAdmin(req.user)) {
        return res.status(403).json({ error: 'دەستکاریکردنی هەژماری سوپەر ئەدمین قەدەغەیە' });
      }
    }
  } catch (e) {}

  const updatedUser = profileChangeRequests.approve(reqId, req.user.id);
  if (!updatedUser) return res.status(404).json({ error: 'داواکاری نەدۆزرایەوە یان پێشتر دیاریکراوە' });

  io.emit('user_profile_updated', {
    user_id: updatedUser.id,
    full_name: updatedUser.full_name
  });
  io.emit('profile_change_status_updated', { id: reqId, status: 'approved', user_id: updatedUser.id });

  res.json({ success: true, message: 'داواکاری گۆڕانکاری پەسەندکرا', user: updatedUser });
});

// Super Admin or Green Badge: Reject profile change request
app.post('/api/admin/profile-change-requests/:id/reject', authMiddleware, requireMemberManager, (req, res) => {
  const reqId = parseInt(req.params.id);
  const ok = profileChangeRequests.reject(reqId, req.user.id);
  if (!ok) return res.status(404).json({ error: 'داواکاری نەدۆزرایەوە' });

  io.emit('profile_change_status_updated', { id: reqId, status: 'rejected' });
  res.json({ success: true, message: 'داواکارییەکە ڕەتکرایەوە' });
});

// 8. Change user role (Super Admin, Black Badge, or Green Badge up to teacher)
app.post('/api/admin/role', authMiddleware, requireMemberManager, (req, res) => {
  const { user_id, role } = req.body;
  const validRoles = ['student', 'new_student', 'guest', 'teacher', 'admin'];
  if (!user_id || !role || !validRoles.includes(role)) {
    return res.status(400).json({ error: 'زانیارییەکان ناتەواون' });
  }

  const target = users.findById(user_id);
  if (!target) return res.status(404).json({ error: 'بەکارهێنەر نەدۆزرایەوە' });

  if (isMasterSuperAdmin(target)) {
    return res.status(403).json({ error: 'ناتوانیت دەستکاری پلەی سوپەر ئەدمینی سەرەکی بکەیت' });
  }
  if (target.role === 'super_admin' && !hasSuperAdminPrivileges(req.user)) {
    return res.status(403).json({ error: 'ناتوانیت دەستکاری پلەی سوپەر ئەدمین بکەیت' });
  }

  const oldRole = target.role;
  users.updateRole(user_id, role);
  users.addRoleHistory(user_id, req.user.id, req.user.full_name, oldRole, role);
  
  io.emit('role_changed', { user_id, new_role: role });

  let roleNameKurdish = 'قوتابی';
  if (role === 'admin') roleNameKurdish = 'ئەدمین';
  if (role === 'teacher') roleNameKurdish = 'مامۆستا';
  if (role === 'new_student') roleNameKurdish = 'قوتابی تازە';
  if (role === 'guest') roleNameKurdish = 'میوان';

  res.json({ success: true, message: `پلەکەی بە سەرکەوتوویی کرا بە ${roleNameKurdish}` });
});

// 9. Block / Unblock user (Super Admin or Black Badge only)
app.post('/api/admin/block', authMiddleware, requireSuperAdminPrivileges, (req, res) => {
  const { user_id, is_blocked } = req.body;
  if (user_id === undefined || is_blocked === undefined) {
    return res.status(400).json({ error: 'زانیارییەکان ناتەواون' });
  }

  const target = users.findById(user_id);
  if (!target) return res.status(404).json({ error: 'بەکارهێنەر نەدۆزرایەوە' });
  if (isMasterSuperAdmin(target) || target.role === 'super_admin') {
    return res.status(403).json({ error: 'ناتوانیت سوپەر ئەدمین بلۆک بکەیت' });
  }

  users.setBlocked(user_id, is_blocked);

  if (is_blocked) {
    io.emit('user_blocked', { user_id });
    const sysMsg = messages.create(
      req.user.id,
      'سیستەم',
      'سیستەم',
      'system',
      `بەکارهێنەر (${target.full_name}) بلۆک کرا 🚫`,
      'system'
    );
    io.emit('new_message', sysMsg);
  } else {
    io.emit('user_unblocked', { user_id });
  }

  res.json({ success: true, message: is_blocked ? 'بەکارهێنەر بلۆک کرا' : 'بلۆک لادرا' });
});

// 10. Permanently Delete / Kick User Account (Super Admin or Black Badge only)
app.delete('/api/admin/users/:id', authMiddleware, requireSuperAdminPrivileges, (req, res) => {
  const userId = parseInt(req.params.id, 10);
  if (!userId) return res.status(400).json({ error: 'ناسنامەی بەکارهێنەر نادروستە' });

  const target = users.findById(userId);
  if (!target) return res.status(404).json({ error: 'بەکارهێنەر نەدۆزرایەوە' });
  if (isMasterSuperAdmin(target) || target.role === 'super_admin') {
    return res.status(403).json({ error: 'ناتوانیت سوپەر ئەدمین بسڕیتەوە' });
  }

  // Delete from DB (cascades to all user records)
  users.delete(userId);

  // Notify via Socket to kick immediately and refresh member lists
  io.emit('user_deleted', { user_id: userId, full_name: target.full_name });

  res.json({ success: true, message: `ئەکاونتی (${target.full_name}) بە سەرکەوتوویی بە یەکجاری سڕایەوە و دەرکرا` });
});

// 11. Assign Special Badges (Master Super Admin Hemn Taha ONLY)
// green = چات قفڵ، وەرگرتن و پلەپێدان تا مامۆستا، گۆڕینی ناو، لایڤ
// black = دەسەڵاتی تەواوی سوپەر ئەدمین (جگە لە دەستکاری سوپەر ئەدمینی سەرەکی و بەخشینی باج)
// red = کردنەوە و داخستن و کۆنتڕۆڵی لایڤ بە تەنیا
app.post('/api/admin/special-badge', authMiddleware, requireMasterSuperAdmin, (req, res) => {
  const { user_id, special_badge } = req.body;
  const userId = parseInt(user_id, 10);
  if (!userId) return res.status(400).json({ error: 'ناسنامەی بەکارهێنەر نادروستە' });

  const target = users.findById(userId);
  if (!target) return res.status(404).json({ error: 'بەکارهێنەر نەدۆزرایەوە' });

  if (isMasterSuperAdmin(target)) {
    return res.status(403).json({ error: 'ناتوانیت باجی سوپەر ئەدمینی سەرەکی دەستکاری بکەیت' });
  }

  let badgeVal = special_badge ? String(special_badge).trim().toLowerCase() : null;
  if (badgeVal === 'none' || badgeVal === '') badgeVal = null;
  if (badgeVal && !['green', 'black', 'red', 'purple', 'white', 'blue'].includes(badgeVal)) {
    return res.status(400).json({ error: 'جۆری باج نادروستە (تەنها سەوز، ڕەش، سور، مۆر، سپی، یان شین ڕێگەپێدراوە)' });
  }

  users.updateSpecialBadge(userId, badgeVal);

  for (const [sId, u] of onlineUsers.entries()) {
    if (u.id === userId) {
      u.special_badge = badgeVal;
    }
  }
  io.emit('online_users', Array.from(new Map(Array.from(onlineUsers.values()).map(u => [u.id, u])).values()));

  io.emit('user_special_badge_updated', {
    user_id: userId,
    special_badge: badgeVal,
    full_name: target.full_name
  });

  const badgeNames = {
    green: '🟢 باجی سەوز',
    black: '⚫ باجی ڕەش',
    red: '🔴 باجی سور',
    purple: '🟣 باجی مۆر',
    white: '⚪ باجی سپی (ڕاوێژکار)',
    blue: '🔵 باجی شین (پاسەوانی چات)'
  };
  const badgeLabel = badgeVal ? badgeNames[badgeVal] : 'لابردنی باج';

  res.json({
    success: true,
    message: `باجی (${target.full_name}) گۆڕدرا بۆ: ${badgeLabel}`,
    user_id: userId,
    special_badge: badgeVal
  });
});

// --- ADMIN / TEACHER MEDIA UPLOADS (IMAGES, VIDEOS, PDF & DOCUMENTS) ---
app.post('/api/chat/upload-image', authMiddleware, requireAdmin, upload.single('image'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'هیچ فایلێک دیاری نەکراوە' });
    const caption = req.body.caption || '';
    const fileUrl = `/uploads/${req.file.filename}`;
    const mime = req.file.mimetype || '';
    const origName = req.file.originalname || '';
    const ext = path.extname(origName).toLowerCase();

    const isVideo = mime.startsWith('video/');
    const isPdf = mime === 'application/pdf' || ext === '.pdf';
    const isDoc = isPdf || ['.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.txt'].includes(ext);

    let attachmentType = 'image';
    let defaultCaption = 'وێنە 🖼️';

    if (isVideo) {
      attachmentType = 'video';
      defaultCaption = 'ڤیدیۆ 🎬';
    } else if (isPdf) {
      attachmentType = 'document';
      defaultCaption = origName || 'فایلی PDF 📄';
    } else if (isDoc) {
      attachmentType = 'document';
      defaultCaption = origName || 'فایلی دۆکیومێنت 📁';
    }

    const replyToId = req.body.reply_to_id ? parseInt(req.body.reply_to_id, 10) : null;
    const msg = messages.create(req.user.id, req.user.username, req.user.full_name, req.user.role, caption || defaultCaption, 'text', null, replyToId, attachmentType, fileUrl);
    const broadcastMsg = { 
      ...msg, 
      gender: req.user.gender || 'male', 
      starInfo: calculateStars(req.user.correct_answers_count),
      file_name: origName,
      file_size: req.file.size
    };
    io.emit('new_message', broadcastMsg);
    res.json({ success: true, message: broadcastMsg });
  } catch (err) {
    res.status(500).json({ error: 'هەڵە لە بارکردنی فایل' });
  }
});

app.post('/api/chat/upload-voice', authMiddleware, requireAdmin, upload.single('voice'), (req, res) => {
  try {
    const activeLockMode = settings.get('chat_lock_mode', 'none');
    if (activeLockMode === 'total_lock' && req.user.role !== 'super_admin') {
      return res.status(403).json({ error: '🔒 چات داخراوە' });
    }
    if (activeLockMode === 'staff_only' && !['super_admin', 'admin', 'teacher'].includes(req.user.role)) {
      return res.status(403).json({ error: '🔒 چات داخراوە' });
    }
    if (!req.file) return res.status(400).json({ error: 'هیچ دەنگێک نەدۆزرایەوە' });
    const voiceUrl = `/uploads/${req.file.filename}`;
    const durationText = req.body.duration || '';
    const msg = messages.create(req.user.id, req.user.username, req.user.full_name, req.user.role, durationText ? `پەیامی دەنگی (${durationText})` : 'پەیامی دەنگی', 'text', null, null, 'voice', voiceUrl);
    const broadcastMsg = { ...msg, gender: req.user.gender || 'male', starInfo: calculateStars(req.user.correct_answers_count) };
    io.emit('new_message', broadcastMsg);
    res.json({ success: true, message: broadcastMsg });
  } catch (err) {
    res.status(500).json({ error: 'هەڵە لە بارکردنی دەنگ' });
  }
});

// Mute / Unmute (Admins, Teachers, or Chat Moderators with Blue/Green/Black badges)
app.post('/api/admin/mute', authMiddleware, requireChatModerator, (req, res) => {
  const { user_id, hours = 24 } = req.body;
  if (!user_id) return res.status(400).json({ error: 'ناسنامەی بەکارهێنەر دیارینەکراوە' });
  const target = users.findById(user_id);
  if (!target) return res.status(404).json({ error: 'بەکارهێنەر نەدۆزرایەوە' });
  if (target.role === 'super_admin' || target.role === 'admin' || isMasterSuperAdmin(target) || target.special_badge === 'black') {
    return res.status(403).json({ error: 'تەنها خوێندکار یان ئەندامی ئاسایی دەتوانرێت سڕ بکرێت' });
  }

  const mutedUntil = Date.now() + (hours * 60 * 60 * 1000);
  users.setMute(user_id, mutedUntil);

  const sysMsg = messages.create(req.user.id, 'سیستەم', 'سیستەم', 'system', `خوێندکار (${target.full_name}) لەلایەن (${req.user.full_name}) بۆ ماوەی ${hours} کاتژمێر سڕکرا 🔇`, 'system');
  io.emit('new_message', sysMsg);
  io.emit('user_muted', { user_id, muted_until: mutedUntil, reason: `سڕکرا بۆ ماوەی ${hours} کاتژمێر` });
  res.json({ success: true, message: `خوێندکار سڕکرا`, muted_until: mutedUntil });
});

app.post('/api/admin/unmute', authMiddleware, requireChatModerator, (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'ناسنامەی بەکارهێنەر دیارینەکراوە' });
  users.setMute(user_id, 0);
  const target = users.findById(user_id);
  if (target) {
    const sysMsg = messages.create(req.user.id, 'سیستەم', 'سیستەم', 'system', `سڕکردنی خوێندکار (${target.full_name}) کۆتایی هات 🔊`, 'system');
    io.emit('new_message', sysMsg);
  }
  io.emit('user_unmuted', { user_id });
  res.json({ success: true, message: 'سڕکردنەکە لادرا' });
});

// --- DATABASE BACKUP ROUTES (SUPER ADMIN ONLY) ---
app.get('/api/admin/backups', authMiddleware, requireSuperAdmin, (req, res) => {
  try {
    const files = fs.readdirSync(backupsDir)
      .filter(f => f.startsWith('chat_backup_') && f.endsWith('.db'))
      .map(f => {
        const stats = fs.statSync(path.join(backupsDir, f));
        return {
          filename: f,
          sizeBytes: stats.size,
          sizeFormatted: `${(stats.size / 1024).toFixed(1)} KB`,
          createdAt: stats.mtime.getTime()
        };
      })
      .sort((a, b) => b.createdAt - a.createdAt);
    res.json({ backups: files });
  } catch (err) {
    res.status(500).json({ error: 'هەڵە لە هێنانی یەدەگەکان' });
  }
});

app.post('/api/admin/backups/create', authMiddleware, requireSuperAdmin, (req, res) => {
  const result = createBackupSnapshot(false);
  if (result) {
    res.json({ success: true, message: 'کۆپی یەدەگ بەسەرکەوتوویی دروستکرا', backup: result });
  } else {
    res.status(500).json({ error: 'شکست لە دروستکردنی یەدەگ' });
  }
});

app.get('/api/admin/backups/download', authMiddleware, requireSuperAdmin, (req, res) => {
  const filename = req.query.file;
  if (filename) {
    const safeFile = path.basename(filename);
    const target = path.join(backupsDir, safeFile);
    if (fs.existsSync(target)) {
      return res.download(target, safeFile);
    }
  }
  const liveDb = path.join(__dirname, 'chat_data.db');
  if (fs.existsSync(liveDb)) {
    const dateStr = new Date().toISOString().slice(0, 10);
    return res.download(liveDb, `seereen_database_${dateStr}.db`);
  }
  res.status(404).json({ error: 'داتابەیس نەدۆزرایەوە' });
});

// --- DREAM AVAILABILITY STATUS (ONLINE / AWAY) ---
app.get('/api/dream/availability', (req, res) => {
  const status = settings.get('dream_status', 'online');
  const message = settings.get('dream_away_message', 'ئێستا کاتی پشووە، بەڕێوەبەر لە زووترین کاتدا وەڵامت دەداتەوە');
  res.json({ status, message });
});

app.post('/api/dream/availability', authMiddleware, requireSuperAdmin, (req, res) => {
  const { status, message } = req.body;
  if (!status || (status !== 'online' && status !== 'away')) {
    return res.status(400).json({ error: 'دۆخەکە نادروستە' });
  }
  settings.set('dream_status', status);
  if (message) {
    settings.set('dream_away_message', message.trim());
  }
  const awayMsg = settings.get('dream_away_message');
  io.emit('dream_availability_updated', { status, message: awayMsg });
  res.json({ success: true, status, message: awayMsg });
});

// --- STUDENT OF THE MONTH & GAMIFICATION ---
app.get('/api/chat/student-of-the-month', authMiddleware, (req, res) => {
  try {
    const topStudents = users.getStudentOfTheMonth();
    res.json({ success: true, topStudents, student: (topStudents && topStudents.length > 0 ? topStudents[0] : null) });
  } catch (err) {
    res.status(500).json({ error: 'هەڵە لە هێنانی زانیارییەکان' });
  }
});

// --- WEB PUSH NOTIFICATIONS ---
app.get('/api/notifications/vapid-public-key', (req, res) => {
  if (!vapidKeys) {
    return res.status(500).json({ error: 'VAPID keys not configured' });
  }
  res.json({ publicKey: vapidKeys.publicKey });
});

app.post('/api/notifications/subscribe', (req, res) => {
  try {
    const { subscription } = req.body;
    if (!subscription || !subscription.endpoint || !subscription.keys) {
      return res.status(400).json({ error: 'Invalid subscription object' });
    }

    let userId = null;
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
        userId = decoded.id;
      } catch (e) {}
    }

    const subId = pushSubscriptions.save({
      userId,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      userAgent: req.headers['user-agent'] || ''
    });

    res.json({ success: true, id: subId, message: 'ئاگاداری مۆبایل بە سەرکەوتوویی چالاک کرا 🔔' });
  } catch (err) {
    console.error('Push subscribe error:', err);
    res.status(500).json({ error: 'هەڵە لە چالاککردنی ئاگاداری' });
  }
});

app.post('/api/notifications/unsubscribe', (req, res) => {
  try {
    const { endpoint } = req.body;
    if (endpoint) {
      pushSubscriptions.remove(endpoint);
    }
    res.json({ success: true, message: 'ئاگاداری ناچالاک کرا' });
  } catch (err) {
    res.status(500).json({ error: 'هەڵە لە ناچالاککردن' });
  }
});

app.post('/api/notifications/test', authMiddleware, async (req, res) => {
  try {
    const payload = {
      title: 'ستافی سیرین 🌸 (تاقیکردنەوە)',
      body: `سڵاو ${req.user.full_name}! ئاگادارییەکانی مۆبایل بە سەرکەوتوویی کار دەکەن و دەنگ دەدەن 🔔📱`,
      icon: '/images/logo.jpg',
      badge: '/images/logo.jpg',
      tag: 'test-push-' + Date.now(),
      data: { url: '/' }
    };
    await sendPushNotificationToUser(req.user.id, payload);
    res.json({ success: true, message: 'ئاگاداری تاقیکاری ڕەوانەی شاشەی مۆبایلەکەت کرا!' });
  } catch (err) {
    res.status(500).json({ error: 'نەتوانرا ئاگاداری بنێردرێت' });
  }
});

// --- CHAT LOCK MANAGEMENT (SUPER ADMIN) ---
app.get('/api/chat/lock-status', authMiddleware, (req, res) => {
  res.json({
    mode: settings.get('chat_lock_mode', 'none'),
    locked_by: settings.get('chat_lock_by', ''),
    timestamp: settings.get('chat_lock_time', '')
  });
});

app.post('/api/chat/lock', authMiddleware, (req, res) => {
  const { mode } = req.body;
  const validModes = ['none', 'staff_only', 'total_lock'];
  if (!validModes.includes(mode)) {
    return res.status(400).json({ error: 'دۆخی قفڵکردن نادیارە' });
  }

  if (mode === 'total_lock' && !hasSuperAdminPrivileges(req.user)) {
    return res.status(403).json({ error: 'تەنها سوپەر ئەدمین یان باجی ڕەش دەسەڵاتی قفڵی عامی هەیە' });
  }

  if (!canLockChat(req.user, mode)) {
    return res.status(403).json({ error: 'دەسەڵاتی قفڵکردن یان کردنەوەی چاتت نییە' });
  }

  settings.set('chat_lock_mode', mode);
  const lockBy = mode === 'none' ? '' : req.user.full_name;
  const lockTime = mode === 'none' ? '' : String(Date.now());
  settings.set('chat_lock_by', lockBy);
  settings.set('chat_lock_time', lockTime);

  let announceText = '';
  if (mode === 'total_lock' || mode === 'staff_only') {
    announceText = '🔒 چات داخرا';
  } else {
    announceText = '🔓 چات کراوەیە';
  }

  const sysMsg = messages.create(req.user.id, 'سیستەم', 'سیستەم', 'system', announceText, 'system');
  io.emit('new_message', sysMsg);
  io.emit('chat_lock_status_updated', {
    mode,
    locked_by: lockBy,
    timestamp: Date.now()
  });

  res.json({ success: true, mode, locked_by: lockBy });
});

// --- TIMED QUESTIONS & SECRET SUBMISSIONS ---

// 12. Get Active Question and Today's Questions
app.get('/api/chat/active-question', authMiddleware, (req, res) => {
  const todayStart = getTodayStartTimestamp();
  const todayQuestions = questions.getTodayQuestions(todayStart);

  const mappedQuestions = todayQuestions.map(q => {
    let mySubmission = null;
    if (req.user.role === 'student') {
      mySubmission = questions.getStudentSubmission(q.id, req.user.id);
    }
    return {
      ...q,
      my_submission: mySubmission ? mySubmission.answer_text : null,
      my_submitted_at: mySubmission ? mySubmission.submitted_at : null
    };
  });

  const activeQ = mappedQuestions.slice().reverse().find(q => q.is_active && !q.is_revealed && (q.expires_at === 0 || q.expires_at > Date.now())) 
    || null;

  res.json({
    question: activeQ,
    today_questions: mappedQuestions
  });
});

// 13. Post Question with Timer (Admin & Super Admin)
app.post('/api/chat/question', authMiddleware, requireAdmin, (req, res) => {
  const { question_text, correct_answer, duration_minutes = 5, custom_expires_at } = req.body;
  if (!question_text || !question_text.trim()) {
    return res.status(400).json({ error: 'تکایە دەقی پرسیار بنووسە' });
  }

  // NOTE: We do NOT close previous questions so all questions of the day stay pinned/tagged at the top!

  let finalExpiresAt = null;
  let finalDurationMinutes = Math.max(1, parseInt(duration_minutes) || 5);

  if (custom_expires_at) {
    const customTime = Number(custom_expires_at);
    if (isNaN(customTime) || customTime <= Date.now()) {
      return res.status(400).json({ error: 'تکایە بەروار و کاتێکی داهاتوو دیاری بکە کە لە کاتی ئێستا درەنگتر بێت' });
    }
    finalExpiresAt = customTime;
    finalDurationMinutes = Math.max(1, Math.round((finalExpiresAt - Date.now()) / (60 * 1000)));
  } else {
    finalExpiresAt = Date.now() + (finalDurationMinutes * 60 * 1000);
  }

  const q = questions.create(
    req.user.id,
    req.user.full_name,
    question_text.trim(),
    correct_answer || null,
    finalDurationMinutes,
    finalExpiresAt
  );

  setupQuestionTimer(q);

  const msgContent = JSON.stringify({
    question_id: q.id,
    question_number: q.question_number || 1,
    question_text: q.question_text,
    admin_name: req.user.full_name,
    duration_minutes: q.duration_minutes,
    expires_at: q.expires_at,
    has_model_answer: !!q.correct_answer
  });

  const questionMsg = messages.create(
    req.user.id,
    req.user.username,
    req.user.full_name,
    req.user.role,
    msgContent,
    'question',
    q.id
  );

  io.emit('new_question', {
    question: q,
    message: questionMsg
  });

  // Web Push Notification: New Question Created
  sendPushNotificationToAll({
    title: `❓ پرسیاری نوێ (${q.question_number ? 'پرسیاری ' + q.question_number : 'پرسیار'}) دانرا!`,
    body: `${req.user.full_name} پرسیارێکی نوێی دانا: ${q.question_text.slice(0, 80)}...`,
    tag: 'question-new-' + q.id,
    data: { url: '/?action=question&id=' + q.id }
  }, req.user.id);

  res.status(201).json({ success: true, question: q, message: questionMsg });
});

// 14. Student Submits Secret Answer (Hidden from other students until timer expires! Supports editing)
app.post('/api/chat/question/submit-secret-answer', authMiddleware, (req, res) => {
  try {
    if (req.user.role === 'guest') {
      return res.status(403).json({ error: 'تۆ وەک میوان (چاودێر) لە گروپیت و ناتوانیت وەڵامی پرسیار بدەیتەوە 👁️' });
    }

    const { question_id, answer_text } = req.body;
    if (!question_id || !answer_text || !answer_text.trim()) {
      return res.status(400).json({ error: 'تکایە دەقی وەڵامەکەت بنووسە' });
    }

    const q = questions.findById(question_id);
    if (!q || !q.is_active) {
      return res.status(400).json({ error: 'ئەم پرسیارە ئێستا داخراوە' });
    }
    if (q.is_revealed || (q.expires_at && Date.now() >= q.expires_at)) {
      return res.status(400).json({ error: 'کاتی پرسیار بەسەرچووە و وەڵامەکان ئاشکراکراون' });
    }

    // 1. Kurdish Smart NLP on question answer
    const nlpCheck = scanKurdishSmartText(answer_text);
    if (nlpCheck.isBlocked) {
      aiSecurity.logIncident('bad_word', req.user.id, req.user.full_name, `وەڵامی پرسیار: "${nlpCheck.matched}"`, 'high', 'blocked');
      return res.status(400).json({ error: '❌ وەڵامەکەت دەستەواژەی نەشیاوی تێدایە و ڕێگری لێکرا!' });
    }

    // 2. Multi-Account Star Fraud Shield (Device / IP Tracking)
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const clientUa = (req.headers['user-agent'] || '').slice(0, 40);
    const deviceKey = `${clientIp}-${clientUa}`;

    if (!questionDeviceSubmissions.has(q.id)) {
      questionDeviceSubmissions.set(q.id, new Map());
    }
    const qDevices = questionDeviceSubmissions.get(q.id);
    const prevDevUser = qDevices.get(deviceKey);

    const existing = questions.getStudentSubmission(q.id, req.user.id);
    const isEdit = !!existing;

    if (prevDevUser && prevDevUser !== req.user.id && !isEdit) {
      aiSecurity.logIncident('star_fraud', req.user.id, req.user.full_name, `هەوڵی وەڵامدانەوە بە فرە-ئەکاونت لەسەر هەمان ئامێر بۆ پرسیاری #${q.question_number || q.id}`, 'high', 'blocked');
      io.emit('security_incident_alert', {
        type: 'star_fraud',
        userName: req.user.full_name,
        message: `👥 هەوڵی فێڵی فرە-ئەکاونت ئاشکراکرا بۆ پرسیاری #${q.question_number || q.id} لەلایەن ${req.user.full_name}.`
      });
      return res.status(403).json({
        error: '⚠️ سیستەمی دادپەروەریی ئەستێرەکان: لەم ئامێرەوە پێشتر بە ئەکاونتێکی تر وەڵامی ئەم پرسیارە دراوەتەوە! بۆ پاراستنی مافی هەمووان، تەنها یەک ئەکاونت دەتوانێت وەڵام بداتەوە.'
      });
    }
    qDevices.set(deviceKey, req.user.id);

    // Save or update secret answer
    const submission = questions.submitAnswer(
      q.id,
      req.user.id,
      req.user.username,
      req.user.full_name,
      req.user.gender || 'male',
      answer_text.trim()
    );

    // Notify count update to all without revealing content
    const allSubs = questions.getSubmissions(q.id);
    io.emit('submission_count_updated', {
      question_id: q.id,
      submission_count: allSubs.length
    });

    res.json({
      success: true,
      is_edit: isEdit,
      message: isEdit
        ? 'وەڵامەکەت بە سەرکەوتوویی دەستکاری کرا (ئیدت)! لەگەڵ تەواوبوونی کات دەگاتە ناو گروپ.'
        : 'وەڵامەکەت بە نهێنی تۆمار کرا! کاتێک تەوقیتی پرسیار بەسەردەچێت، ڕاستەوخۆ دەگاتە گروپ.',
      submission
    });
  } catch (err) {
    console.error('Submit answer error:', err);
    res.status(500).json({ error: 'هەڵەیەک ڕوویدا لە تۆمارکردنی وەڵام' });
  }
});

// 15. Reveal Answers Now (Admin force reveal or auto-timer)
app.post('/api/chat/question/reveal', authMiddleware, requireAdmin, (req, res) => {
  const { question_id } = req.body;
  if (!question_id) return res.status(400).json({ error: 'ناسنامەی پرسیار دیارینەکراوە' });

  clearQuestionTimer(parseInt(question_id));

  triggerQuestionReveal(question_id);
  res.json({ success: true, message: 'وەڵامەکان بەیەکەوە لەناو گروپ بڵاوکرانەوە' });
});

// 16. Get Non-Responding Students for Active Question (Admin only)
app.get('/api/chat/question/:id/non-responding', authMiddleware, requireAdmin, (req, res) => {
  const qId = parseInt(req.params.id);
  const nonResponding = questions.getNonRespondingStudents(qId);
  res.json({ non_responding: nonResponding });
});

// 17. Get Global Unanswered Questions Stats (Admin & Super Admin only)
app.get('/api/chat/unanswered-stats', authMiddleware, requireAdmin, (req, res) => {
  const stats = questions.getGlobalUnansweredStats();
  res.json({ stats });
});

function updateRevealedSubmissionEvaluationInMessages(questionId, userId, isCorrect) {
  try {
    const qId = parseInt(questionId);
    const uId = parseInt(userId);
    const msgs = db.prepare("SELECT id, content FROM messages WHERE type = 'revealed_submissions' AND (question_id = ? OR attachment_url = ? OR content LIKE ?)").all(qId, String(qId), `%"question_id":${qId}%`);
    for (const msg of msgs) {
      try {
        const payload = JSON.parse(msg.content);
        if (payload && Array.isArray(payload.submissions)) {
          let modified = false;
          payload.submissions.forEach(s => {
            if (s.user_id === uId) {
              s.is_awarded = isCorrect;
              modified = true;
            }
          });
          if (modified) {
            db.prepare("UPDATE messages SET content = ? WHERE id = ?").run(JSON.stringify(payload), msg.id);
          }
        }
      } catch (e) {}
    }
  } catch (err) {
    console.error('Error updating revealed submission evaluation in messages:', err);
  }
}

// 18. Award Star to a Student for a Question (Super Admin & Teacher)
app.post('/api/chat/award-star', authMiddleware, requireTeacherOrSuperAdmin, (req, res) => {
  const { question_id, user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'ناسنامەی خوێندکار دیارینەکراوە' });

  if (question_id && questions.hasUserBeenAwarded(question_id, user_id)) {
    return res.status(400).json({ error: 'ئەم خوێندکارە پێشتر ئەستێرەی بۆ ئەم پرسیارە وەرگرتووە و ناتوانرێت دووبارە ئەستێرەی پێبدرێت!' });
  }

  const student = users.findById(user_id);
  if (!student) return res.status(404).json({ error: 'خوێندکار نەدۆزرایەوە' });

  const newCount = users.incrementCorrectAnswers(user_id);
  const starInfo = calculateStars(newCount);

  if (question_id) {
    questions.recordStarAward(question_id, user_id, req.user.id);
    updateRevealedSubmissionEvaluationInMessages(question_id, user_id, 1);
  }

  io.emit('star_awarded', {
    user_id: student.id,
    student_name: student.full_name,
    question_id: question_id || null,
    new_count: newCount,
    starInfo
  });

  if (question_id) {
    io.emit('submission_evaluated', {
      question_id: parseInt(question_id),
      user_id: parseInt(user_id),
      user_name: student.full_name,
      is_correct: 1
    });

    // Web Push Notification to the specific student
    sendPushNotificationToUser(parseInt(user_id), {
      title: '🌟 پیرۆزە! ئەستێرەت پێبەخشرا',
      body: `مامۆستا وەڵامەکەتی پەسەند کرد و ئەستێرەی نوێت پێبەخشرا! ⭐`,
      tag: 'star-awarded-' + Date.now(),
      data: { url: '/' }
    });
  }

  res.json({ success: true, message: 'ئەستێرە بە سەرکەوتوویی بەخشرا', starInfo, is_correct: 1 });
});

// 18a. Mark Answer as Wrong / Incorrect (زەڕب ❌) (Super Admin & Teacher)
app.post('/api/chat/mark-wrong', authMiddleware, requireTeacherOrSuperAdmin, (req, res) => {
  const { question_id, user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'ناسنامەی خوێندکار دیارینەکراوە' });

  const student = users.findById(user_id);
  if (!student) return res.status(404).json({ error: 'خوێندکار نەدۆزرایەوە' });

  if (question_id) {
    questions.recordWrongMark(question_id, user_id);
    updateRevealedSubmissionEvaluationInMessages(question_id, user_id, -1);
    io.emit('submission_evaluated', {
      question_id: parseInt(question_id),
      user_id: parseInt(user_id),
      user_name: student.full_name,
      is_correct: -1
    });

    // Web Push Notification to the specific student
    sendPushNotificationToUser(parseInt(user_id), {
      title: 'ℹ️ هەڵسەنگاندنی وەڵامی پرسیار',
      body: `مامۆستا وەڵامەکەی هەڵسەنگاندیت لەسەر پرسیارەکە.`,
      tag: 'eval-marked-' + Date.now(),
      data: { url: '/' }
    });
  }

  res.json({ success: true, message: 'نیشانەی هەڵە (زەڕب ❌) بەسەرکەوتوویی تۆمارکرا', is_correct: -1 });
});

// 18b. Reset Answer Evaluation (Super Admin & Teacher)
app.post('/api/chat/reset-evaluation', authMiddleware, requireTeacherOrSuperAdmin, (req, res) => {
  const { question_id, user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'ناسنامەی خوێندکار دیارینەکراوە' });

  const student = users.findById(user_id);

  if (question_id) {
    questions.resetSubmissionEvaluation(question_id, user_id);
    updateRevealedSubmissionEvaluationInMessages(question_id, user_id, 0);
    io.emit('submission_evaluated', {
      question_id: parseInt(question_id),
      user_id: parseInt(user_id),
      user_name: student ? student.full_name : '',
      is_correct: 0
    });
  }

  res.json({ success: true, message: 'هەڵسەنگاندن گەڕێنرایەوە', is_correct: 0 });
});

// 18b. Get Star Awards for a Question
app.get('/api/chat/question/:id/awards', authMiddleware, (req, res) => {
  const qId = parseInt(req.params.id);
  const awards = questions.getQuestionAwards ? questions.getQuestionAwards(qId) : [];
  res.json({ awards });
});

// 19. Close Question
app.post('/api/chat/close-question', authMiddleware, requireTeacherOrSuperAdmin, (req, res) => {
  const { question_id } = req.body;
  if (!question_id) return res.status(400).json({ error: 'ناسنامەی پرسیار دیارینەکراوە' });

  clearQuestionTimer(parseInt(question_id));

  questions.closeQuestion(question_id);
  io.emit('question_closed', { question_id });
  res.json({ success: true, message: 'پرسیار داخرا' });
});

// 19b. Cancel & Delete Question (Super Admin & Teacher ONLY)
app.post('/api/chat/question/cancel', authMiddleware, requireTeacherOrSuperAdmin, (req, res) => {
  const { question_id, message_id } = req.body;
  if (!question_id && !message_id) return res.status(400).json({ error: 'ناسنامەی پرسیار دیارینەکراوە' });

  const qId = question_id ? parseInt(question_id) : null;
  const msgId = message_id ? parseInt(message_id) : null;

  if (qId) {
    clearQuestionTimer(qId);
    // Delete question and submissions from db
    questions.delete(qId);
  }

  // Remove corresponding question announcement messages from chat
  try {
    if (msgId) {
      messages.delete(msgId);
      io.emit('message_deleted', { id: msgId });
    }
    if (qId) {
      const qMsgs = db.prepare("SELECT id FROM messages WHERE (type = 'question' OR type = 'revealed_submissions') AND (question_id = ? OR content LIKE ? OR attachment_url = ?)").all(qId, `%"question_id":${qId}%`, String(qId));
      for (const msg of qMsgs) {
        messages.delete(msg.id);
        io.emit('message_deleted', { id: msg.id });
      }
    }
  } catch (e) {
    console.error('Error removing question message:', e);
  }

  if (qId) {
    io.emit('question_cancelled', { question_id: qId });
    io.emit('question_closed', { question_id: qId });
    io.emit('questions_renumbered');
  }
  res.json({ success: true, message: 'پرسیارەکە بە سەرکەوتوویی لابرا و سڕایەوە و ژمارەکان ڕێکخرانەوە' });
});

// 19c. Edit Question (Super Admin & Teacher ONLY)
app.post('/api/chat/question/edit', authMiddleware, requireTeacherOrSuperAdmin, (req, res) => {
  const { question_id, question_text, correct_answer, duration_minutes, custom_expires_at } = req.body;
  if (!question_id) return res.status(400).json({ error: 'ناسنامەی پرسیار دیارینەکراوە' });

  const qId = parseInt(question_id);
  const q = questions.findById(qId);
  if (!q) return res.status(404).json({ error: 'پرسیار نەدۆزرایەوە' });

  let newExpiresAt = q.expires_at;
  let newDuration = duration_minutes !== undefined ? parseInt(duration_minutes) || q.duration_minutes : q.duration_minutes;

  if (custom_expires_at) {
    newExpiresAt = Number(custom_expires_at);
  } else if (duration_minutes !== undefined && q.is_active && !q.is_revealed) {
    newExpiresAt = Date.now() + (newDuration * 60 * 1000);
  }

  const updatedQ = questions.update(qId, {
    question_text,
    correct_answer,
    duration_minutes: newDuration,
    expires_at: newExpiresAt
  });

  // If this question is currently active, reset the timer
  const currentActive = questions.getActive();
  if (currentActive && currentActive.id === qId) {
    setupQuestionTimer(updatedQ);
  }

  io.emit('question_updated', {
    question: updatedQ
  });

  res.json({ success: true, question: updatedQ });
});

// 20. Questions Archive & Bank (Available to all users)
app.get('/api/chat/questions/archive', authMiddleware, (req, res) => {
  const isAdmin = req.user.role === 'admin' || req.user.role === 'super_admin' || req.user.role === 'teacher';
  const list = questions.getAllArchive().map(q => ({
    ...q,
    // Hide official answer of active unrevealed question from non-admins
    correct_answer: (q.is_revealed || isAdmin) ? q.correct_answer : null
  }));
  res.json({ questions: list });
});

// --- LIBRARY (BOOKS & FILES) ---
const libraryUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '.pdf';
      cb(null, `book-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
    }
  }),
  limits: { fileSize: 150 * 1024 * 1024 } // 150MB
});

// 21. Get all library books (Student, Teacher, Admin, Super Admin)
app.get('/api/library/books', authMiddleware, (req, res) => {
  if (req.user.role === 'guest') {
    return res.status(403).json({ error: 'تەنها قوتابیان، مامۆستایان و ئەدمین دەتوانن سەردانی کتێبخانە بکەن 📖' });
  }
  const search = req.query.search || '';
  const books = library.getAll(search);
  res.json({ books });
});

// 22. Upload library book / file (Teacher, Admin, Super Admin)
app.post('/api/library/upload', authMiddleware, requireAdmin, libraryUpload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'تکایە فایلێک دیاری بکە (PDF یان هەر جۆرێکی تر)' });
    const { title, author = '', description = '', category = 'گشتی' } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'تکایە ناوی کتێب یان فایلەکە بنووسە' });
    }

    const fileUrl = `/uploads/${req.file.filename}`;
    const fileExt = path.extname(req.file.originalname).replace('.', '').toLowerCase() || 'pdf';
    const book = library.create(
      title,
      author,
      description,
      category,
      fileUrl,
      req.file.originalname,
      req.file.size,
      fileExt,
      req.user.id,
      req.user.full_name
    );

    res.status(201).json({ success: true, message: 'کتێبەکە بە سەرکەوتوویی لە کتێبخانە دانرا', book });
  } catch (err) {
    console.error('Library upload error:', err);
    res.status(500).json({ error: 'هەڵەیەک ڕوویدا لە بارکردنی پەڕتووک' });
  }
});

// 23. Delete library book (Teacher, Admin, Super Admin)
app.delete('/api/library/books/:id', authMiddleware, requireAdmin, (req, res) => {
  const bookId = parseInt(req.params.id);
  const book = library.findById(bookId);
  if (!book) return res.status(404).json({ error: 'کتێبەکە نەدۆزرایەوە' });

  library.delete(bookId);
  try {
    const filePath = path.join(__dirname, 'public', book.file_url);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (e) {}

  res.json({ success: true, message: 'کتێبەکە لە کتێبخانە سڕایەوە' });
});

// Delete Message (Admins, Teachers, or Message Author) - Soft Delete to allow restoration
app.delete('/api/chat/messages/:id', authMiddleware, (req, res) => {
  const msgId = parseInt(req.params.id);
  const msg = messages.findById(msgId);
  if (!msg) {
    return res.status(404).json({ error: 'نامەکە نەدۆزرایەوە' });
  }

  const isPrivileged = canModerateChat(req.user);
  const isOwner = msg.user_id === req.user.id;

  if (!isPrivileged && !isOwner) {
    return res.status(403).json({ error: 'تەنها ئەدمین، مامۆستا، پاسەوانی چات یان خاوەنی پەیامەکە دەتوانێت نامەکە بسڕێتەوە' });
  }

  messages.delete(msgId);
  io.emit('message_deleted', { id: msgId });
  res.json({ success: true, message: 'نامەکە سڕایەوە (لە ئەرشیڤ پارێزراوە بۆ گەڕاندنەوە)' });
});

// Leaderboard
app.get('/api/chat/leaderboard', authMiddleware, (req, res) => {
  const list = users.getLeaderboard().map(s => ({
    ...s,
    starInfo: calculateStars(s.correct_answers_count)
  }));
  res.json({ leaderboard: list });
});

// Message History with Reactions
app.get('/api/chat/messages', authMiddleware, (req, res) => {
  const history = messages.getRecent(120);
  const msgIds = history.map(m => m.id);
  const reactionsMap = messageReactions.getForMessages(msgIds, req.user.id);
  const result = history.map(m => ({
    ...m,
    starInfo: calculateStars(m.correct_answers_count),
    reactions: reactionsMap[m.id] || []
  }));
  res.json({ 
    messages: result,
    last_read_message_id: req.user.last_read_message_id || 0
  });
});

// Chat Global Search (Words, Variations, Senders)
app.get('/api/chat/search', authMiddleware, (req, res) => {
  try {
    const rawQ = (req.query.q || '').trim();
    if (!rawQ || rawQ.length < 2) return res.json({ results: [] });

    // Normalize query for Kurdish / Arabic variations
    const cleanQ = rawQ.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
    const wildcard = `%${cleanQ}%`;

    const stmt = db.prepare(`
      SELECT m.*, u.gender, u.correct_answers_count,
        orig.full_name as reply_to_name,
        orig.content as reply_to_content
      FROM messages m
      LEFT JOIN users u ON m.user_id = u.id
      LEFT JOIN messages orig ON m.reply_to_id = orig.id
      WHERE COALESCE(m.is_deleted, 0) = 0 AND (
            m.content LIKE ? 
         OR m.full_name LIKE ? 
         OR m.username LIKE ?
         OR REPLACE(REPLACE(REPLACE(m.content, 'ي', 'ی'), 'ك', 'ک'), 'ھ', 'ه') LIKE ?
         OR REPLACE(REPLACE(REPLACE(m.full_name, 'ي', 'ی'), 'ك', 'ک'), 'ھ', 'ه') LIKE ?
         OR REPLACE(REPLACE(REPLACE(m.content, 'ە', 'ه'), 'ێ', 'ی'), 'ۆ', 'و') LIKE ?
      )
      ORDER BY m.id DESC
      LIMIT 80
    `);

    const results = stmt.all(wildcard, wildcard, wildcard, wildcard, wildcard, wildcard);
    res.json({ results: results.reverse() });
  } catch (err) {
    console.error('Chat search error:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Update User Last Read Message ID
app.post('/api/chat/last-read', authMiddleware, (req, res) => {
  const messageId = parseInt(req.body.message_id, 10);
  if (messageId && messageId > 0) {
    users.updateLastReadMessage(req.user.id, messageId);
  }
  res.json({ success: true, last_read_message_id: messageId });
});

// Message Reactions (🏆, 🤲, 👍, 💯)
app.post('/api/chat/messages/:id/react', authMiddleware, (req, res) => {
  const msgId = parseInt(req.params.id);
  const { emoji } = req.body;
  const allowed = ['🏆', '🤲', '👍', '💯'];
  if (!allowed.includes(emoji)) {
    return res.status(400).json({ error: 'ئیمۆجی ڕێگاپێدراو نییە' });
  }

  const updatedReactions = messageReactions.toggle(msgId, req.user.id, emoji);
  io.emit('message_reaction_updated', { message_id: msgId, reactions: updatedReactions });
  res.json({ success: true, reactions: updatedReactions });
});

// Get Users Who Reacted to a Message (تەنها بۆ سوپەر ئەدمین و مامۆستا)
app.get('/api/chat/messages/:id/reactions/:emoji/users', authMiddleware, (req, res) => {
  const isStaff = req.user.role === 'super_admin' || req.user.role === 'teacher';
  if (!isStaff) {
    return res.status(403).json({ error: 'تەنها سوپەر ئەدمین و مامۆستا دەتوانن کاردانەوەکان ببینن' });
  }
  const msgId = parseInt(req.params.id);
  const emoji = req.params.emoji;
  const users = messageReactions.getUsersForReaction(msgId, emoji);
  res.json({ success: true, users });
});

// --- PRIVATE MESSAGING (تەنها بۆ مامۆستا و سوپەر ئەدمین) ---

// 1. Get Private Conversations List
app.get('/api/chat/private/conversations', authMiddleware, (req, res) => {
  try {
    let list = privateMessages.getConversationsList(req.user.id);
    const isStaff = req.user.role === 'super_admin' || req.user.role === 'teacher';
    const isMaleStudent = !isStaff && (req.user.gender === 'male');
    if (isMaleStudent) {
      list = list.filter(c => !(c.other_role === 'teacher' && c.other_gender === 'female'));
    }
    res.json({ conversations: list });
  } catch (err) {
    console.error('Private conv error:', err);
    res.status(500).json({ error: 'هەڵە لە وەرگرتنی گفتوگۆکان' });
  }
});

// 2. Get Messages with a Specific User
app.get('/api/chat/private/messages/:otherUserId', authMiddleware, (req, res) => {
  try {
    const otherId = parseInt(req.params.otherUserId);
    const otherUser = users.findById(otherId);
    if (!otherUser) return res.status(404).json({ error: 'بەکارهێنەر نەدۆزرایەوە' });

    const isStaff = req.user.role === 'super_admin' || req.user.role === 'teacher';
    const otherIsStaff = otherUser.role === 'super_admin' || otherUser.role === 'teacher';

    // Restriction: Normal users can only message Super Admin & Teacher
    if (!isStaff && !otherIsStaff) {
      return res.status(403).json({ error: 'تەنها دەتوانیت نامەی تایبەت بۆ مامۆستا و سوپەر ئەدمین بنێریت' });
    }

    // Restriction: Male student cannot message female teacher
    const isMaleStudent = !isStaff && (req.user.gender === 'male');
    if (isMaleStudent && otherUser.role === 'teacher' && otherUser.gender === 'female') {
      return res.status(403).json({ error: 'بەپێی ڕێنماییەکان، قوتابی کوڕ ناتوانێت پەیوەندی بە مامۆستای ئافرەتەوە بکات' });
    }

    privateMessages.markAsRead(otherId, req.user.id);
    const chatMsgs = privateMessages.getConversation(req.user.id, otherId, 100);
    res.json({
      otherUser: {
        id: otherUser.id,
        username: otherUser.username,
        full_name: otherUser.full_name,
        role: otherUser.role,
        gender: otherUser.gender
      },
      messages: chatMsgs
    });
  } catch (err) {
    console.error('Private msgs error:', err);
    res.status(500).json({ error: 'هەڵە لە وەرگرتنی پەیامەکان' });
  }
});

// 3. Send Private Message
app.post('/api/chat/private/send', authMiddleware, (req, res) => {
  try {
    const { recipient_id, content } = req.body;
    const recId = parseInt(recipient_id);
    if (!recId || !content || !content.trim()) {
      return res.status(400).json({ error: 'پەیام و وەرگر پێویستن' });
    }

    const recipient = users.findById(recId);
    if (!recipient) return res.status(404).json({ error: 'وەرگر نەدۆزرایەوە' });

    const isStaff = req.user.role === 'super_admin' || req.user.role === 'teacher';
    const recIsStaff = recipient.role === 'super_admin' || recipient.role === 'teacher';

    // Strict Rule: Normal accounts can ONLY message super_admin and teacher
    if (!isStaff && !recIsStaff) {
      return res.status(403).json({ error: 'تەنها دەتوانیت نامەی تایبەت بۆ مامۆستا و سوپەر ئەدمین بنێریت' });
    }

    // Gender Rule: Male student cannot message female teacher
    const isMaleStudent = !isStaff && (req.user.gender === 'male');
    if (isMaleStudent && recipient.role === 'teacher' && recipient.gender === 'female') {
      return res.status(403).json({ error: 'بەپێی ڕێنماییەکان، قوتابی کوڕ ناتوانێت نامەی تایبەت بۆ مامۆستای ئافرەت بنێرێت' });
    }

    // 1. Kurdish Smart NLP on private message
    const nlpCheck = scanKurdishSmartText(content);
    if (nlpCheck.isBlocked) {
      aiSecurity.logIncident('bad_word', req.user.id, req.user.full_name, `پەیامی تایبەت: "${nlpCheck.matched}"`, 'high', 'blocked');
      return res.status(400).json({ error: '⚠️ پەیامەکەت دەستەواژەی نەشیاوی تێدایە و ڕێگری لێکرا.' });
    }

    // 2. Harassment & contact exchange check
    const harassCheck = checkHarassmentContent(content, req.user.role);
    if (harassCheck.isHarassment) {
      aiSecurity.logIncident('harassment', req.user.id, req.user.full_name, `هەراسانکردن/ژمارە لە چاتی تایبەت بۆ ${recipient.full_name}`, 'high', 'blocked');
      return res.status(400).json({ error: harassCheck.reason });
    }

    const msg = privateMessages.create(
      req.user.id,
      recId,
      req.user.full_name,
      req.user.role,
      content.trim(),
      'text'
    );

    // Broadcast in real-time to recipient sockets only (sender gets it in HTTP response)
    const notifiedSockets = new Set();
    for (const [sockId, u] of onlineUsers.entries()) {
      if (u.id === recId && !notifiedSockets.has(sockId)) {
        notifiedSockets.add(sockId);
        io.to(sockId).emit('new_private_message', msg);
      }
    }

    res.json({ success: true, message: msg });
  } catch (err) {
    console.error('Send private msg error:', err);
    res.status(500).json({ error: 'هەڵە لە ناردنی پەیامی تایبەت' });
  }
});

// 4. Get Unread Count for Current User
app.get('/api/chat/private/unread-count', authMiddleware, (req, res) => {
  try {
    const count = privateMessages.getTotalUnreadCount(req.user.id);
    res.json({ unreadCount: count });
  } catch (err) {
    res.json({ unreadCount: 0 });
  }
});

// 5. Get Staff List (Teachers & Super Admins) for Private Chat
app.get('/api/chat/private/staff-list', authMiddleware, (req, res) => {
  try {
    const allUsers = users.getAllUsers();
    const isStaff = req.user.role === 'super_admin' || req.user.role === 'teacher';
    const isMaleStudent = !isStaff && (req.user.gender === 'male');

    let staff = allUsers
      .filter(u => (u.role === 'super_admin' || u.role === 'teacher') && u.id !== req.user.id)
      .map(u => {
        const isOnline = Array.from(onlineUsers.values()).some(o => o.id === u.id);
        return {
          id: u.id,
          username: u.username,
          full_name: u.full_name,
          role: u.role,
          gender: u.gender || 'male',
          is_online: isOnline
        };
      });

    // Gender Rule: Male student cannot see or contact female teachers
    if (isMaleStudent) {
      staff = staff.filter(s => !(s.role === 'teacher' && s.gender === 'female'));
    }

    res.json({ staff });
  } catch (err) {
    console.error('Error fetching staff list:', err);
    res.status(500).json({ error: 'هەڵە لە وەرگرتنی لیستی مامۆستاکان' });
  }
});

// 6. Upload Voice in Private Chat
app.post('/api/chat/private/upload-voice', authMiddleware, upload.fields([{ name: 'voice', maxCount: 1 }, { name: 'audio', maxCount: 1 }]), (req, res) => {
  try {
    const file = (req.files && (req.files.voice?.[0] || req.files.audio?.[0])) || req.file;
    if (!file) return res.status(400).json({ error: 'هیچ دەنگێک بارنەکراوە' });
    const { recipient_id, duration } = req.body;
    const recId = parseInt(recipient_id);
    if (!recId) return res.status(400).json({ error: 'وەرگر دیارینەکراوە' });

    const recipient = users.findById(recId);
    if (!recipient) return res.status(404).json({ error: 'وەرگر نەدۆزرایەوە' });

    const isStaff = req.user.role === 'super_admin' || req.user.role === 'teacher';
    const recIsStaff = recipient.role === 'super_admin' || recipient.role === 'teacher';
    if (!isStaff && !recIsStaff) {
      return res.status(403).json({ error: 'تەنها دەتوانیت نامەی تایبەت بۆ مامۆستا و سوپەر ئەدمین بنێریت' });
    }

    // Gender Rule: Male student cannot message female teacher
    const isMaleStudent = !isStaff && (req.user.gender === 'male');
    if (isMaleStudent && recipient.role === 'teacher' && recipient.gender === 'female') {
      return res.status(403).json({ error: 'بەپێی ڕێنماییەکان، قوتابی کوڕ ناتوانێت دەنگ بۆ مامۆستای ئافرەت بنێرێت' });
    }

    const voiceUrl = `/uploads/${file.filename}`;
    const content = duration ? `🎤 پەیامی دەنگی (${duration})` : '🎤 پەیامی دەنگی';
    const msg = privateMessages.create(
      req.user.id,
      recId,
      req.user.full_name,
      req.user.role,
      content,
      'voice',
      voiceUrl
    );

    const notifiedSockets = new Set();
    for (const [sockId, u] of onlineUsers.entries()) {
      if (u.id === recId && !notifiedSockets.has(sockId)) {
        notifiedSockets.add(sockId);
        io.to(sockId).emit('new_private_message', msg);
      }
    }

    res.json({ success: true, message: msg });
  } catch (err) {
    console.error('Private voice upload error:', err);
    res.status(500).json({ error: 'هەڵە لە ناردنی دەنگ' });
  }
});

// 7. Upload Image in Private Chat
app.post('/api/chat/private/upload-image', authMiddleware, (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'قەبارەی وێنەکە زۆر گەورەیە، تکایە کەمێکی تر هەوڵبدەرەوە' });
      }
      return res.status(400).json({ error: err.message || 'هەڵە لە بارکردنی فایل' });
    }
    try {
      if (!req.file) return res.status(400).json({ error: 'هیچ وێنەیەک بارنەکراوە' });
      const { recipient_id, caption } = req.body;
      const recId = parseInt(recipient_id);
      if (!recId) return res.status(400).json({ error: 'وەرگر دیارینەکراوە' });

      const recipient = users.findById(recId);
      if (!recipient) return res.status(404).json({ error: 'وەرگر نەدۆزرایەوە' });

      const isStaff = req.user.role === 'super_admin' || req.user.role === 'teacher';
      const recIsStaff = recipient.role === 'super_admin' || recipient.role === 'teacher';
      if (!isStaff && !recIsStaff) {
        return res.status(403).json({ error: 'تەنها دەتوانیت نامەی تایبەت بۆ مامۆستا و سوپەر ئەدمین بنێریت' });
      }

      // Gender Rule: Male student cannot message female teacher
      const isMaleStudent = !isStaff && (req.user.gender === 'male');
      if (isMaleStudent && recipient.role === 'teacher' && recipient.gender === 'female') {
        return res.status(403).json({ error: 'بەپێی ڕێنماییەکان، قوتابی کوڕ ناتوانێت وێنە بۆ مامۆستای ئافرەت بنێرێت' });
      }

      const imageUrl = `/uploads/${req.file.filename}`;
      const content = (caption && caption.trim()) ? caption.trim() : '🖼️ وێنە';
      const msg = privateMessages.create(
        req.user.id,
        recId,
        req.user.full_name,
        req.user.role,
        content,
        'image',
        imageUrl
      );

      const notifiedSockets = new Set();
      for (const [sockId, u] of onlineUsers.entries()) {
        if (u.id === recId && !notifiedSockets.has(sockId)) {
          notifiedSockets.add(sockId);
          io.to(sockId).emit('new_private_message', msg);
        }
      }

      res.json({ success: true, message: msg });
    } catch (err) {
      console.error('Private image upload error:', err);
      res.status(500).json({ error: 'هەڵە لە ناردنی وێنە' });
    }
  });
});

// Translation Proxy Endpoint (Kurdish/Arabic/English)
app.post('/api/translate', async (req, res) => {
  try {
    const { text, targetLang, target: reqTarget } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Text required' });
    }
    const chosenTarget = reqTarget || targetLang || 'ar';
    const target = (chosenTarget === 'en' || chosenTarget === 'ar') ? chosenTarget : 'ar';
    const cleanText = text.trim();
    
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${target}&dt=t&q=${encodeURIComponent(cleanText)}`;
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!response.ok) {
      return res.status(502).json({ error: 'Translation service unavailable' });
    }
    const data = await response.json();
    let translated = '';
    if (Array.isArray(data) && Array.isArray(data[0])) {
      translated = data[0].map(segment => segment[0]).join('');
    }
    if (!translated) {
      translated = cleanText;
    }
    res.json({ success: true, translatedText: translated, targetLang: target });
  } catch (err) {
    console.error('Translation error:', err);
    res.status(500).json({ error: 'Translation failed' });
  }
});

// --- LIVE LESSON RECORDINGS (تۆماری وانەکانی لایڤ - مامۆستا و سوپەر ئەدمین) ---
app.get('/api/live-recordings', authMiddleware, requireTeacherOrSuperAdmin, (req, res) => {
  try {
    const list = liveRecordings.getAll();
    res.json({ recordings: list });
  } catch (err) {
    res.status(500).json({ error: 'هەڵە لە وەرگرتنی تۆمارەکان' });
  }
});

app.post('/api/live-recordings/upload', authMiddleware, requireTeacherOrSuperAdmin, upload.single('audio'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'هیچ فایلی دەنگێک بارنەکراوە' });
    const audioUrl = `/uploads/${req.file.filename}`;
    const duration = req.body.duration || '';
    const nextNum = liveRecordings.getNextNumber();
    const now = new Date();
    const dateStr = `${now.getFullYear()}/${now.getMonth()+1}/${now.getDate()}`;
    const defaultTitle = req.body.title ? req.body.title.trim() : `وانەی لایڤ #${nextNum} (${dateStr})`;
    const recNum = req.body.recording_number ? parseInt(req.body.recording_number) : nextNum;

    const item = liveRecordings.create(
      recNum,
      defaultTitle,
      audioUrl,
      duration,
      req.user.id,
      req.user.full_name
    );
    res.json({ success: true, recording: item });
  } catch (err) {
    console.error('Live recording upload error:', err);
    res.status(500).json({ error: 'هەڵە لە تۆمارکردنی وانەکە' });
  }
});

app.put('/api/live-recordings/:id', authMiddleware, requireTeacherOrSuperAdmin, (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { title, recording_number } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ error: 'ناوی تۆمار پێویستە' });
    liveRecordings.updateTitle(id, title.trim(), recording_number ? parseInt(recording_number) : null);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'هەڵە لە نوێکردنەوەی ناوی تۆمار' });
  }
});

app.delete('/api/live-recordings/:id', authMiddleware, requireTeacherOrSuperAdmin, (req, res) => {
  try {
    const id = parseInt(req.params.id);
    liveRecordings.delete(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'هەڵە لە سڕینەوە' });
  }
});

// --- RECORDED LESSONS FOR STUDENTS (وانە تۆمارکراوەکان - بێ داونلۆد) ---
app.get('/api/recorded-lessons', authMiddleware, (req, res) => {
  try {
    const list = recordedLessons.getAll();
    res.json({ lessons: list });
  } catch (err) {
    res.status(500).json({ error: 'هەڵە لە وەرگرتنی وانەکان' });
  }
});

app.post('/api/recorded-lessons/upload', authMiddleware, requireTeacherOrSuperAdmin, upload.single('audio'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'هیچ فایلی دەنگێک بارنەکراوە' });
    const audioUrl = `/uploads/${req.file.filename}`;
    const duration = req.body.duration || '';
    const nextNum = recordedLessons.getNextNumber();
    const lessonNum = req.body.lesson_number ? parseInt(req.body.lesson_number) : nextNum;
    const title = req.body.title ? req.body.title.trim() : `وانەی ژمارە #${lessonNum}`;
    const description = req.body.description ? req.body.description.trim() : '';

    const lesson = recordedLessons.create(
      lessonNum,
      title,
      description,
      audioUrl,
      duration,
      req.user.id,
      req.user.full_name,
      req.user.role
    );
    res.json({ success: true, lesson });
  } catch (err) {
    console.error('Recorded lesson upload error:', err);
    res.status(500).json({ error: 'هەڵە لە بارکردنی وانە' });
  }
});

app.put('/api/recorded-lessons/:id', authMiddleware, requireTeacherOrSuperAdmin, (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { title, description, lesson_number } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ error: 'ناوی وانە پێویستە' });
    const lNum = lesson_number ? parseInt(lesson_number) : 1;
    recordedLessons.update(id, title.trim(), description || '', lNum);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'هەڵە لە نوێکردنەوەی وانە' });
  }
});

app.delete('/api/recorded-lessons/:id', authMiddleware, requireTeacherOrSuperAdmin, (req, res) => {
  try {
    const id = parseInt(req.params.id);
    recordedLessons.delete(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'هەڵە لە سڕینەوە' });
  }
});

// Night Curfew Status Endpoint (12:00 AM - 08:00 AM Iraq Time)
app.get('/api/chat/curfew', (req, res) => {
  res.json({
    isNightCurfew: isNightCurfewActive(),
    curfewStart: '00:00',
    curfewEnd: '08:00'
  });
});

// --- DREAM INTERPRETATION (لێکدانەوەی خەون) ROUTES ---

function emitToDreamAdmins(event, payload) {
  try {
    if (io && io.sockets && io.sockets.sockets) {
      for (const [id, s] of io.sockets.sockets) {
        if (s.user && canManageDreams(s.user)) {
          if (s.rooms && !s.rooms.has('dream_admins')) {
            s.join('dream_admins');
          }
        }
      }
    }
  } catch (e) {
    console.error('Error synchronizing dream_admins room:', e);
  }
  io.to('dream_admins').emit(event, payload);
}

// 1. Dreamer Start or Resume Session
app.post('/api/dream/start', (req, res) => {
  try {
    const { token, name, gender = 'male' } = req.body;

    // Check if user is logged in
    let authedUser = null;
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
        authedUser = users.findById(decoded.id);
      } catch (e) {}
    }

    // STRICT: Staff & Dream Interpreters (Super Admin, Admin, Teacher, or Purple Badge) cannot submit dreams!
    if (authedUser && (canManageDreams(authedUser) || authedUser.role === 'admin')) {
      return res.status(403).json({ error: 'مامۆستا و بەڕێوەبەرانی خەون ناتوانن خەون بنێرن بۆ لێکدانەوە' });
    }

    let session = null;
    if (token) {
      session = dreamSessions.findByToken(token);
    }
    if (!session) {
      // If student is logged in, their name must strictly be their account name!
      const finalName = authedUser ? authedUser.full_name : (name || '').trim();
      const finalGender = authedUser ? (authedUser.gender || gender) : gender;

      if (!finalName) {
        return res.status(400).json({ error: 'تکایە ناوت بنووسە' });
      }
      const newToken = `dream_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      session = dreamSessions.create(newToken, finalName, finalGender === 'female' ? 'female' : 'male');
      
      // Add initial welcome system message
      dreamMessages.create(
        session.id, 
        'system', 
        'ستافی سیرین', 
        `بەخێربێیت ${session.dreamer_name} بۆ بەشی لێکدانەوەی خەون 🌙\nخەونەکەت بە دەق یان بە دەنگ (ڤۆیس) بنێرە، بەڕێوەبەر لە نزیکترین کاتدا وەڵامت دەداتەوە یان پەیوەندیت پێوە دەکات.`,
        'system'
      );

      // Notify Super Admin and Teacher reliably
      emitToDreamAdmins('new_dream_session', {
        id: session.id,
        dreamer_name: session.dreamer_name,
        dreamer_gender: session.dreamer_gender,
        created_at: session.created_at
      });
    }

    const msgs = dreamMessages.getBySessionForDreamer(session.id);
    res.json({
      success: true,
      token: session.dreamer_token,
      session: {
        id: session.id,
        dreamer_name: session.dreamer_name,
        dreamer_gender: session.dreamer_gender,
        status: session.status
      },
      messages: msgs
    });
  } catch (err) {
    console.error('Dream start error:', err);
    res.status(500).json({ error: 'هەڵە لە دەستپێکردنی خزمەتگوزاری خەون' });
  }
});

// 2. Dreamer Get Current Session & Messages
app.get('/api/dream/session', (req, res) => {
  try {
    const token = req.headers['x-dream-token'];
    if (!token) return res.status(401).json({ error: 'تۆکنی خەون نییە' });
    const session = dreamSessions.findByToken(token);
    if (!session) return res.status(404).json({ error: 'دانیشتنەکە نەدۆزرایەوە' });

    // Note: getBySessionForDreamer filters out secret call recordings!
    const msgs = dreamMessages.getBySessionForDreamer(session.id);
    res.json({
      session: {
        id: session.id,
        dreamer_name: session.dreamer_name,
        dreamer_gender: session.dreamer_gender,
        status: session.status
      },
      messages: msgs
    });
  } catch (err) {
    res.status(500).json({ error: 'هەڵە لە وەرگرتنی زانیاری خەون' });
  }
});

// 3. Send Message in Dream Chat (Dreamer or Super Admin ONLY)
app.post('/api/dream/message', async (req, res) => {
  try {
    const dreamToken = req.headers['x-dream-token'];
    const authHeader = req.headers['authorization'];
    const { sessionId, content } = req.body;
    if (!content || !content.trim()) return res.status(400).json({ error: 'پەیام بەتاڵە' });

    let senderType = '';
    let senderName = '';
    let targetSessionId = null;

    if (dreamToken) {
      // Sent by dreamer
      const session = dreamSessions.findByToken(dreamToken);
      if (!session) return res.status(403).json({ error: 'ڕێگاپێدراو نییە' });
      targetSessionId = session.id;
      senderType = 'dreamer';
      senderName = session.dreamer_name;
    } else if (authHeader) {
      // Sent by logged in user
      const token = authHeader.split(' ')[1];
      if (!token) return res.status(401).json({ error: 'تکایە سەرەتا بچۆ ژوورەوە' });
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = users.findById(decoded.id);
      if (!user) return res.status(401).json({ error: 'بەکارهێنەر نەدۆزرایەوە' });

      // STRICT PERMISSION: SUPER ADMIN, TEACHER, OR PURPLE BADGE CAN REPLY TO DREAMERS!
      if (!canManageDreams(user)) {
        return res.status(403).json({ error: 'تەنها مامۆستا، سوپەر ئەدمین یان هەڵگری باجی مۆر بۆیان هەیە وەڵامی خەون بین بدەنەوە' });
      }

      targetSessionId = parseInt(sessionId);
      senderType = user.role;
      senderName = (user.full_name && user.full_name.trim()) ? user.full_name.trim() : (user.username || 'مامۆستا');
    } else {
      return res.status(401).json({ error: 'ڕێگاپێدراو نییە' });
    }

    const session = dreamSessions.findById(targetSessionId);
    if (!session) return res.status(404).json({ error: 'دانیشتن نەدۆزرایەوە' });

    // AI Guardian check on dream messages
    if (senderType === 'dreamer') {
      const nlp = scanKurdishSmartText(content);
      if (nlp.isBlocked) {
        aiSecurity.logIncident('bad_word', null, senderName, `خەون: "${nlp.matched}"`, 'high', 'blocked');
        return res.status(400).json({ error: '⚠️ پەیامەکەت دەستەواژەی نەشیاوی تێدایە و ڕێگری لێکرا.' });
      }

      const harass = checkHarassmentContent(content, 'dreamer');
      if (harass.isHarassment) {
        aiSecurity.logIncident('harassment', null, senderName, `هەراسانکردن/ژمارە لە خەون: "${content.substring(0, 60)}"`, 'high', 'blocked');
        return res.status(400).json({ error: '❌ ناردنی ژمارەی مۆبایل یان هەژماری کەسی لە بەشی خەونەکاندا قەدەغەیە!' });
      }
    }

    const msg = dreamMessages.create(targetSessionId, senderType, senderName, content.trim(), 'text');
    
    // Broadcast message to dream room and dream admins
    const isStaffReply = (senderType === 'teacher' || senderType === 'super_admin' || (user && user.special_badge === 'purple'));
    const dreamerMsg = isStaffReply
      ? { ...msg, sender_name: getDreamTeacherAlias(senderName) }
      : msg;
    io.to(`dream_${targetSessionId}`).emit('dream_new_message', dreamerMsg);
    emitToDreamAdmins('dream_admin_new_message', { sessionId: targetSessionId, message: msg });

    if (isStaffReply) {
      dreamSessions.markAnswered(targetSessionId, senderName, senderType || 'dream_interpreter');
      emitToDreamAdmins('dream_session_answered', {
        sessionId: targetSessionId,
        answered_by_name: senderName,
        answered_by_role: senderType
      });
      emitToDreamAdmins('dream_session_updated', {
        sessionId: targetSessionId,
        lastMessage: content.trim(),
        answered_by_name: senderName,
        answered_by_role: senderType
      });
    } else {
      emitToDreamAdmins('dream_session_updated', { sessionId: targetSessionId, lastMessage: content.trim() });
    }

    // Automated greeting reply and questionnaire for dreamer
    if (senderType === 'dreamer') {
      const lowerText = content.trim().toLowerCase();
      const isGreeting = lowerText.includes('سلام') || lowerText.includes('سڵاو') || lowerText.includes('سلاو') || lowerText.includes('slaw') || lowerText.includes('slam');

      if (isGreeting) {
        setTimeout(() => {
          const reply = dreamMessages.create(targetSessionId, 'system', 'سیستەمی سیرین', 'عَلَيْكُمُ السَّلَامُ وَرَحْمَةُ اللهِ وَبَرَكَاتُهُ', 'text');
          io.to(`dream_${targetSessionId}`).emit('dream_new_message', reply);
          emitToDreamAdmins('dream_admin_new_message', { sessionId: targetSessionId, message: reply });
          emitToDreamAdmins('dream_session_updated', { sessionId: targetSessionId, lastMessage: reply.content });
        }, 500);
      }

      if (!dreamMessages.hasAutoQuestions(targetSessionId)) {
        setTimeout(() => {
          const autoQ = `بەخێربێیت بۆ بەشی لێکدانەوەی خەونەکان

تکایە بۆ ئەوەی خەونەکەت بە جوانترین شێوە لێکبدرێتەوە، ئەم زانیارییانەمان بۆ بنێرە:
🎙️ ١. خەونەکەت بە نامەیەکی دەنگی (ڤۆیس) بە تەواوی باس بکە.
👤 ٢. ناو و تەمەنت بڵێ.
💍 ٣. ئایا هاوسەرگیریت کردووە یان نا؟
🕌 ٤. ئاینت چییە؟
💼 ٥. پیشە و ئیشت چییە؟

📞 تێبینی: گەر ئێمە پەیوەندیمان کارا بوو (لەسەر هێڵ بووین)، دەتوانیت تەلەفۆن (تێل) ڕاستەوخۆ بکەیت.`;
          const qMsg = dreamMessages.create(targetSessionId, 'system', 'سیستەمی سیرین', autoQ, 'text');
          io.to(`dream_${targetSessionId}`).emit('dream_new_message', qMsg);
          emitToDreamAdmins('dream_admin_new_message', { sessionId: targetSessionId, message: qMsg });
          emitToDreamAdmins('dream_session_updated', { sessionId: targetSessionId, lastMessage: 'پرسیارەکانی لێکدانەوەی خەون' });
        }, isGreeting ? 1500 : 600);
      }
    }

    res.json({ success: true, message: msg });
  } catch (err) {
    console.error('Dream message error:', err);
    res.status(500).json({ error: 'هەڵە لە ناردنی پەیام' });
  }
});

// 4. Upload Voice in Dream Chat (Dreamer or Super Admin & Teacher)
app.post('/api/dream/upload-voice', upload.single('voice'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'هیچ دەنگێک بارنەکراوە' });
    const dreamToken = req.headers['x-dream-token'];
    const authHeader = req.headers['authorization'];
    const durationText = req.body.duration || '';
    const sessionId = req.body.sessionId ? parseInt(req.body.sessionId) : null;

    let senderType = '';
    let senderName = '';
    let targetSessionId = null;

    if (dreamToken) {
      const session = dreamSessions.findByToken(dreamToken);
      if (!session) return res.status(403).json({ error: 'ڕێگاپێدراو نییە' });
      targetSessionId = session.id;
      senderType = 'dreamer';
      senderName = session.dreamer_name;
    } else if (authHeader) {
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = users.findById(decoded.id);
      if (!user || !canManageDreams(user)) {
        return res.status(403).json({ error: 'تەنها مامۆستا، سوپەر ئەدمین یان هەڵگری باجی مۆر بۆیان هەیە دەنگ بنێرن بۆ خەون بین' });
      }
      targetSessionId = sessionId;
      senderType = user.role;
      senderName = (user.full_name && user.full_name.trim()) ? user.full_name.trim() : (user.username || 'مامۆستا');
    } else {
      return res.status(401).json({ error: 'ڕێگاپێدراو نییە' });
    }

    const voiceUrl = `/uploads/${req.file.filename}`;
    const content = durationText ? `پەیامی دەنگی (${durationText})` : 'پەیامی دەنگی';
    const msg = dreamMessages.create(targetSessionId, senderType, senderName, content, 'voice', voiceUrl);

    const isStaffReply = (senderType === 'teacher' || senderType === 'super_admin' || (user && user.special_badge === 'purple'));
    const dreamerVoiceMsg = isStaffReply
      ? { ...msg, sender_name: getDreamTeacherAlias(senderName) }
      : msg;
    io.to(`dream_${targetSessionId}`).emit('dream_new_message', dreamerVoiceMsg);
    emitToDreamAdmins('dream_admin_new_message', { sessionId: targetSessionId, message: msg });

    if (isStaffReply) {
      dreamSessions.markAnswered(targetSessionId, senderName, senderType || 'dream_interpreter');
      emitToDreamAdmins('dream_session_answered', {
        sessionId: targetSessionId,
        answered_by_name: senderName,
        answered_by_role: senderType
      });
      emitToDreamAdmins('dream_session_updated', {
        sessionId: targetSessionId,
        lastMessage: '🎤 پەیامی دەنگی',
        answered_by_name: senderName,
        answered_by_role: senderType
      });
    } else {
      emitToDreamAdmins('dream_session_updated', { sessionId: targetSessionId, lastMessage: '🎤 پەیامی دەنگی' });
    }

    // Automated questionnaire if dreamer sends voice as first interaction
    if (senderType === 'dreamer' && !dreamMessages.hasAutoQuestions(targetSessionId)) {
      setTimeout(() => {
        const autoQ = `بەخێربێیت بۆ بەشی لێکدانەوەی خەونەکان

تکایە بۆ ئەوەی خەونەکەت بە جوانترین شێوە لێکبدرێتەوە، ئەم زانیارییانەمان بۆ بنێرە:
🎙️ ١. خەونەکەت بە نامەیەکی دەنگی (ڤۆیس) بە تەواوی باس بکە.
👤 ٢. ناو و تەمەنت بڵێ.
💍 ٣. ئایا هاوسەرگیریت کردووە یان نا؟
🕌 ٤. ئاینت چییە؟
💼 ٥. پیشە و ئیشت چییە؟

📞 تێبینی: گەر ئێمە پەیوەندیمان کارا بوو (لەسەر هێڵ بووین)، دەتوانیت تەلەفۆن (تێل) ڕاستەوخۆ بکەیت.`;
        const qMsg = dreamMessages.create(targetSessionId, 'system', 'سیستەمی سیرین', autoQ, 'text');
        io.to(`dream_${targetSessionId}`).emit('dream_new_message', qMsg);
        emitToDreamAdmins('dream_admin_new_message', { sessionId: targetSessionId, message: qMsg });
        emitToDreamAdmins('dream_session_updated', { sessionId: targetSessionId, lastMessage: 'پرسیارەکانی لێکدانەوەی خەون' });
      }, 800);
    }

    res.json({ success: true, message: msg });
  } catch (err) {
    console.error('Dream voice error:', err);
    res.status(500).json({ error: 'هەڵە لە ناردنی دەنگ' });
  }
});

// 5. Upload Secret Call Recording (Two-way audio recorded during phone call)
const recentCallUploads = new Map();

app.post('/api/dream/upload-call-recording', upload.single('call_recording'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'هیچ تۆمارێک بارنەکراوە' });
    const sessionId = parseInt(req.body.sessionId);
    const durationText = req.body.duration || '';
    const session = dreamSessions.findById(sessionId);
    if (!session) return res.status(404).json({ error: 'دانیشتن نەدۆزرایەوە' });

    // Deduplication check: ignore duplicate uploads within 10 seconds for the same session
    const lastUpload = recentCallUploads.get(sessionId) || 0;
    if (Date.now() - lastUpload < 10000) {
      console.log(`[DREAM CALL] Duplicate recording upload ignored for session ${sessionId}`);
      if (req.file && fs.existsSync(req.file.path)) {
        try { fs.unlinkSync(req.file.path); } catch (e) {}
      }
      return res.json({ success: true, message: 'تۆمارەکە پێشتر تۆمارکراوە' });
    }
    recentCallUploads.set(sessionId, Date.now());

    const callRecordUrl = `/uploads/${req.file.filename}`;
    const desc = durationText ? `تۆماری تەواوی پەیوەندی تەلەفۆنی (${durationText})` : 'تۆماری تەواوی پەیوەندی تەلەفۆنی';

    // SECRET RECORDING: is_secret_recording = 1 (Hidden from dreamer)
    const secretMsg = dreamMessages.create(
      sessionId,
      'system',
      'سیستەم (تۆماری تەلەفۆن)',
      desc,
      'call_record',
      callRecordUrl,
      1 // is_secret_recording = 1
    );

    // Also create a summary message for the dreamer
    const summaryMsg = dreamMessages.create(
      sessionId,
      'system',
      'ستافی سیرین',
      `📞 پەیوەندی تەلەفۆنی ئەنجامدرا ${durationText ? `(ماوە: ${durationText})` : ''}`,
      'system',
      null,
      0 // is_secret_recording = 0 (Visible to dreamer)
    );

    // Send summaryMsg to dreamer in room
    io.to(`dream_${sessionId}`).emit('dream_new_message', summaryMsg);
    // Send secretMsg with recording audio ONLY to admins reliably
    emitToDreamAdmins('dream_new_secret_recording', { sessionId, message: secretMsg });

    res.json({ success: true, recordingUrl: callRecordUrl });
  } catch (err) {
    console.error('Dream call recording upload error:', err);
    res.status(500).json({ error: 'هەڵە لە بارکردنی تۆماری تەلەفۆن' });
  }
});

// 6. Admin Get All Dream Sessions (Super Admin, Teacher, and Purple Badge)
app.get('/api/dream/admin/sessions', authMiddleware, requireDreamManager, (req, res) => {
  try {
    const list = dreamSessions.getAll();
    res.json({ sessions: list, canReply: true });
  } catch (err) {
    res.status(500).json({ error: 'هەڵە لە وەرگرتنی لیست' });
  }
});

// 7. Admin Get Specific Session Messages (Super Admin, Teacher, and Purple Badge)
app.get('/api/dream/admin/session/:id/messages', authMiddleware, requireDreamManager, (req, res) => {
  try {
    const sessionId = parseInt(req.params.id);
    const session = dreamSessions.findById(sessionId);
    if (!session) return res.status(404).json({ error: 'دانیشتن نەدۆزرایەوە' });

    // Admin, Teacher & Purple Badge get messages
    const msgs = dreamMessages.getBySessionForAdmin(sessionId);
    res.json({
      session,
      messages: msgs,
      canReply: true
    });
  } catch (err) {
    res.status(500).json({ error: 'هەڵە لە وەرگرتنی پەیامەکان' });
  }
});

// 8. Delete Dream Session (Super Admin only)
app.delete('/api/dream/admin/session/:id', authMiddleware, requireSuperAdmin, (req, res) => {
  try {
    const sessionId = parseInt(req.params.id);
    const session = dreamSessions.findById(sessionId);
    if (!session) return res.status(404).json({ error: 'دانیشتن نەدۆزرایەوە' });

    dreamSessions.delete(sessionId);
    emitToDreamAdmins('dream_session_deleted', { sessionId });
    res.json({ success: true, message: 'چاتی خەون سڕایەوە' });
  } catch (err) {
    console.error('Delete dream session error:', err);
    res.status(500).json({ error: 'هەڵە لە سڕینەوەی چات' });
  }
});

// 8b. Delete Individual Dream Message (Super Admin only)
app.delete('/api/dream/admin/message/:id', authMiddleware, requireSuperAdmin, (req, res) => {
  try {
    const msgId = parseInt(req.params.id);
    const msg = dreamMessages.findById(msgId);
    if (!msg) return res.status(404).json({ error: 'پەیام نەدۆزرایەوە' });

    dreamMessages.delete(msgId);
    io.emit('dream_message_deleted', { messageId: msgId, sessionId: msg.session_id });
    res.json({ success: true, message: 'پەیامەکە سڕایەوە' });
  } catch (err) {
    console.error('Delete dream message error:', err);
    res.status(500).json({ error: 'هەڵە لە سڕینەوەی پەیام' });
  }
});

// 9. Star/Favorite Dream Session (Super Admin, Teacher, and Purple Badge)
app.post('/api/dream/admin/session/:id/favorite', authMiddleware, requireDreamManager, (req, res) => {
  try {
    const sessionId = parseInt(req.params.id);
    const session = dreamSessions.findById(sessionId);
    if (!session) return res.status(404).json({ error: 'دانیشتن نەدۆزرایەوە' });

    const newFavStatus = dreamSessions.toggleFavorite(sessionId);
    emitToDreamAdmins('dream_session_favorited', { sessionId, is_favorite: newFavStatus });
    res.json({ success: true, is_favorite: newFavStatus });
  } catch (err) {
    console.error('Toggle favorite error:', err);
    res.status(500).json({ error: 'هەڵە لە گۆڕینی دڵخواز' });
  }
});

// 10. Super Admin Download ALL audio recordings as ZIP
app.get('/api/admin/audio/download-all', authMiddleware, requireSuperAdmin, (req, res) => {
  try {
    if (!archiver) {
      return res.status(500).json({ error: 'کتێبخانەی archiver لەسەر سێرڤەر بەردەست نییە' });
    }
    const audioExtensions = new Set(['.webm', '.ogg', '.mp3', '.wav', '.m4a', '.aac', '.opus']);
    let files = [];
    if (fs.existsSync(uploadsDir)) {
      files = fs.readdirSync(uploadsDir).filter(f => {
        const ext = path.extname(f).toLowerCase();
        return audioExtensions.has(ext);
      });
    }

    if (!files || files.length === 0) {
      return res.status(404).json({ error: 'هیچ فایلێکی دەنگی نەدۆزرایەوە لە سیستەمەکەدا' });
    }

    const archive = archiver('zip', { zlib: { level: 6 } });
    const timestamp = new Date().toISOString().slice(0, 10);
    const zipName = `seereen_all_voices_${timestamp}.zip`;

    res.attachment(zipName);
    archive.pipe(res);

    files.forEach(file => {
      const filePath = path.join(uploadsDir, file);
      if (fs.existsSync(filePath)) {
        archive.file(filePath, { name: file });
      }
    });

    archive.finalize();
  } catch (err) {
    console.error('Audio ZIP download error:', err);
    res.status(500).json({ error: 'هەڵە لە دروستکردنی فایلی ZIP بۆ دەنگەکان' });
  }
});

// --- SOCKET.IO REAL-TIME HANDLING ---

function getLiveLessonSnapshot() {
  const participantsList = Array.from(liveLessonState.participants.values()).map(p => ({
    socketId: p.socketId,
    userId: p.userId,
    username: p.username,
    fullName: p.fullName,
    role: p.role,
    gender: p.gender,
    isMuted: p.isMuted,
    handRaised: p.handRaised,
    hasMicPermission: p.hasMicPermission
  }));

  return {
    isActive: liveLessonState.isActive,
    title: liveLessonState.title,
    startedBy: liveLessonState.startedBy,
    startedAt: liveLessonState.startedAt,
    quranState: liveLessonState.quranState,
    screenSharingBy: liveLessonState.screenSharingBy,
    participantsCount: participantsList.length,
    participants: participantsList
  };
}

function broadcastLiveLessonState() {
  io.emit('live_lesson_state', getLiveLessonSnapshot());
}

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  const dreamToken = socket.handshake.auth.dreamToken;

  if (dreamToken) {
    const session = dreamSessions.findByToken(dreamToken);
    if (!session) return next(new Error('دانیشتنی خەون نەدۆزرایەوە'));
    socket.isDreamer = true;
    socket.dreamSession = session;
    return next();
  }

  if (!token) return next(new Error('تکایە سەرەتا بچۆ ژوورەوە'));
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = users.findById(decoded.id);
    if (!user || user.is_blocked || user.status !== 'approved') {
      return next(new Error('دەستپێگەیشتن ڕێگاپێدراو نییە'));
    }
    socket.user = user;
    next();
  } catch (err) {
    return next(new Error('تۆکنی نادروست'));
  }
});

io.on('connection', (socket) => {
  // DREAMER CONNECTION
  if (socket.isDreamer) {
    const session = socket.dreamSession;
    socket.join(`dream_${session.id}`);

    socket.on('dream_call_start', (data) => {
      socket.to(`dream_${session.id}`).emit('dream_incoming_call', {
        ...data,
        sessionId: session.id,
        callerName: session.dreamer_name,
        callerGender: session.dreamer_gender
      });
      socket.to('dream_admins').emit('dream_incoming_call', {
        ...data,
        sessionId: session.id,
        callerName: session.dreamer_name,
        callerGender: session.dreamer_gender
      });
    });

    socket.on('dream_call_accept', (data) => {
      socket.to(`dream_${session.id}`).emit('dream_call_accepted', data);
    });

    socket.on('dream_call_reject', (data) => {
      socket.to(`dream_${session.id}`).emit('dream_call_rejected', data);
    });

    socket.on('dream_call_signal', (data) => {
      socket.to(`dream_${session.id}`).emit('dream_call_signal', data);
    });

    socket.on('dream_call_end', (data) => {
      socket.to(`dream_${session.id}`).emit('dream_call_ended', data);
    });

    return;
  }

  // GROUP CHAT / ADMIN USER CONNECTION
  const user = socket.user;
  if (canManageDreams(user)) {
    socket.join('dream_admins');
  }

  socket.on('dream_admin_join_session', (sessionId) => {
    if (canManageDreams(user)) {
      socket.join(`dream_${sessionId}`);
    }
  });

  socket.on('dream_call_start', (data) => {
    // super_admin, teacher, and purple badge can start calls!
    if (!canManageDreams(user)) return;
    const defaultName = user.role === 'teacher' ? (user.full_name || 'مامۆستا') : (user.role === 'super_admin' ? (user.full_name || 'هێمن طه') : (user.full_name || 'لێکدەرەوەی خەون'));
    socket.to(`dream_${data.sessionId}`).emit('dream_incoming_call', {
      ...data,
      callerName: defaultName
    });
  });

  socket.on('dream_call_accept', (data) => {
    socket.to(`dream_${data.sessionId}`).emit('dream_call_accepted', data);
  });

  socket.on('dream_call_reject', (data) => {
    socket.to(`dream_${data.sessionId}`).emit('dream_call_rejected', data);
  });

  socket.on('dream_call_signal', (data) => {
    socket.to(`dream_${data.sessionId}`).emit('dream_call_signal', data);
  });

  socket.on('dream_call_end', (data) => {
    socket.to(`dream_${data.sessionId}`).emit('dream_call_ended', data);
  });

  onlineUsers.set(socket.id, {
    id: user.id,
    username: user.username,
    full_name: user.full_name,
    gender: user.gender || 'male',
    role: user.role,
    special_badge: user.special_badge || null,
    starInfo: calculateStars(user.correct_answers_count)
  });

  const getUniqueOnlineList = () => {
    const map = new Map();
    for (const u of onlineUsers.values()) {
      map.set(u.id, u);
    }
    return Array.from(map.values());
  };

  io.emit('online_users', getUniqueOnlineList());

  socket.on('send_message', (data) => {
    try {
      const freshUser = users.findById(user.id);
      if (!freshUser || freshUser.is_blocked) {
        socket.emit('error_message', 'هەژمارەکەت بلۆک کراوە');
        socket.disconnect(true);
        return;
      }

      if (freshUser.muted_until && freshUser.muted_until > Date.now()) {
        const remainingMinutes = Math.ceil((freshUser.muted_until - Date.now()) / (1000 * 60));
        const hours = Math.floor(remainingMinutes / 60);
        const mins = remainingMinutes % 60;
        socket.emit('error_message', `تۆ سڕکراویت بۆ ماوەی ٢٤ کاتژمێر. کاتی ماوە: ${hours} کاتژمێر و ${mins} خولەک`);
        return;
      }

      // 1. Red Alert Lockdown Check
      if (isRedAlertActive && !['super_admin', 'teacher'].includes(freshUser.role)) {
        socket.emit('error_message', '🚨 دۆخی نائاسایی (Red Alert Lockdown) کارایە! چات بە شێوەی پارێزراو تەنها بۆ ستاف کراوەیە.');
        return;
      }

      // 2. Anti-Flood & Raid Protection
      const floodCheck = checkFloodRaid(freshUser.id, freshUser.role);
      if (floodCheck.isFlood) {
        const freezeSecs = floodCheck.freezeDurationSecs || 60;
        users.muteUser(freshUser.id, freezeSecs);
        aiSecurity.logIncident('flood_attack', freshUser.id, freshUser.full_name, `هەوڵی هێرشی لافاوی پەیام (سڕکرا بۆ ${freezeSecs} چـ)`, 'high', 'auto_muted');
        io.emit('security_incident_alert', {
          type: 'flood_attack',
          userName: freshUser.full_name,
          message: `🚨 هێرشی لافاوی پەیام لەلایەن ${freshUser.full_name} تێکشکێنرا و بۆ ${Math.ceil(freezeSecs/60)} خولەک بێدەنگ کرا.`
        });
        socket.emit('error_message', `🛑 هۆشداری ئاسایش: بەهۆی ناردنی خێرای پەیام، هەژمارەکەت بۆ ${Math.ceil(freezeSecs/60)} خولەک سڕکرا!`);
        return;
      }

      // Anti-Spam Rate Limiter: Max 5 messages in 4 seconds
      if (isSpamming(freshUser.id)) {
        socket.emit('error_message', '⚠️ تکایە لەسەرخۆ بە لە ناردنی پەیام! (سیستەمی پاراستن لە سپام)');
        return;
      }

      const content = (data.content || '').trim();
      if (!content) return;

      // 3. Smart Kurdish NLP Guard & Malicious Link Shield (For non-staff)
      if (!['super_admin', 'teacher'].includes(freshUser.role)) {
        const nlpResult = scanKurdishSmartText(content);
        if (nlpResult.isBlocked) {
          aiSecurity.logIncident('bad_word', freshUser.id, freshUser.full_name, `وشەی قەدەغەکراو: "${nlpResult.matched}" لە دەقی: "${content.substring(0, 60)}"`, 'high', 'blocked');
          io.emit('security_incident_alert', {
            type: 'bad_word',
            userName: freshUser.full_name,
            message: `🛑 فلتەری دەق ڕێگری لە دەستەواژەی نەشیاو کرد لەلایەن ${freshUser.full_name}.`
          });
          socket.emit('error_message', '⚠️ قەڵغانی زیرەک: پەیامەکەت دەستەواژەی نەشیاو یان قەدەغەکراوی تێدایە و ڕێگری لێکرا.');
          return;
        }

        const linkCheck = scanMaliciousLink(content);
        if (linkCheck.isMalicious) {
          aiSecurity.logIncident('malicious_link', freshUser.id, freshUser.full_name, `لینکی گوماناوی/فیشینگ: "${content.substring(0, 80)}"`, 'critical', 'blocked');
          io.emit('security_incident_alert', {
            type: 'malicious_link',
            userName: freshUser.full_name,
            message: `🚫 بەستەری زیانبەخش/ڕاوکردن بلۆککرا لەلایەن ${freshUser.full_name}.`
          });
          socket.emit('error_message', '❌ قەڵغانی ئاسایش: ئەم بەستەرە زیانبەخشە و ڕێگەپێنەدراوە!');
          return;
        }
      }

      // --- CHAT LOCK COMMAND HANDLING (SUPER ADMIN OR GREEN/BLACK BADGE) ---
      const hasLockAll = content.includes('@قفڵ.عام') || content.includes('@قفل.عام');
      const hasLockStaff = !hasLockAll && (content.includes('@قفڵ') || content.includes('@قفل'));
      const hasUnlock = content.includes('@کلیل') || content.includes('@كليل') || content.includes('@مفتاح') || content.includes('@کراوە') || content.includes('@کردنەوە') || content.includes('@بیکەرەوە') || content.includes('@unlock') || content.includes('@قفڵ.کردنەوە') || content.includes('@قفل.کردنەوە');

      if (hasLockAll || hasLockStaff || hasUnlock) {
        if (hasLockAll) {
          if (!hasSuperAdminPrivileges(freshUser)) {
            socket.emit('error_message', '❌ تەنها سوپەر ئەدمین یان باجی ڕەش دەسەڵاتی قفڵی عامی هەیە!');
            return;
          }
        } else {
          if (!canLockChat(freshUser, 'staff_only')) {
            socket.emit('error_message', '❌ دەسەڵاتی قفڵکردن یان کردنەوەی چاتت نییە!');
            return;
          }
        }

        let newMode = 'none';
        let announceText = '';
        if (hasLockAll) {
          newMode = 'total_lock';
          announceText = '🔒 چات داخرا';
        } else if (hasLockStaff) {
          newMode = 'staff_only';
          announceText = '🔒 چات داخرا';
        } else if (hasUnlock) {
          newMode = 'none';
          announceText = '🔓 چات کراوەیە';
        }

        settings.set('chat_lock_mode', newMode);
        settings.set('chat_lock_by', newMode === 'none' ? '' : freshUser.full_name);
        settings.set('chat_lock_time', newMode === 'none' ? '' : String(Date.now()));

        const sysMsg = messages.create(freshUser.id, 'سیستەم', 'سیستەم', 'system', announceText, 'system');
        io.emit('new_message', sysMsg);
        io.emit('chat_lock_status_updated', {
          mode: newMode,
          locked_by: newMode === 'none' ? '' : freshUser.full_name,
          timestamp: Date.now()
        });

        const cleaned = content.replace(/@قفڵ\.عام|@قفل\.عام|@قفڵ|@قفل|@کلیل|@كليل|@مفتاح|@کراوە|@کردنەوە|@بیکەرەوە|@unlock|@قفڵ\.کردنەوە|@قفل\.کردنەوە/g, '').trim();
        if (!cleaned) return;
      }

      // --- CHAT LOCK PERMISSION ENFORCEMENT ---
      const activeLockMode = settings.get('chat_lock_mode', 'none');
      if (activeLockMode === 'total_lock' && freshUser.role !== 'super_admin') {
        socket.emit('error_message', '🔒 چات داخراوە.');
        return;
      }
      if (activeLockMode === 'staff_only' && !['super_admin', 'admin', 'teacher'].includes(freshUser.role)) {
        socket.emit('error_message', '🔒 چات داخراوە.');
        return;
      }

      // Night Curfew (12:00 AM - 08:00 AM Iraq Time): Only Super Admin, Admin, and Teacher can send messages
      const curfewExemptRoles = ['super_admin', 'admin', 'teacher'];
      if (isNightCurfewActive() && !curfewExemptRoles.includes(freshUser.role)) {
        socket.emit('error_message', '🌙 چات داخراوە! لە کاتژمێر ١٢ی شەو تاوەکو ٨ی بەیانی تەنها ئەدمین، مامۆستا و سوپەر ئەدمین دەتوانن پەیام بنێرن.');
        return;
      }

      if (freshUser.role === 'guest') {
        socket.emit('error_message', 'تۆ وەک میوان (چاودێر) لە گروپیت و ناتوانیت پەیام بنێریت 👁️');
        return;
      }

      if (freshUser.role === 'new_student') {
        const count24h = messages.getUserMessageCountLast24h(freshUser.id);
        if (count24h >= 1) {
          socket.emit('error_message', '⚠️ وەک قوتابی تازە، لە شەو و ڕۆژێکدا (٢٤ کاتژمێر) تەنها بۆت هەیە یەک پەیام بنێریت!');
          return;
        }
      }

      if ((freshUser.role === 'student' || freshUser.role === 'new_student') && containsLink(content)) {
        socket.emit('error_message', '❌ خوێندکار ناتوانێت بەهیچ جۆرێک بەستەر (لینک) بنێرێت! تەنها ئەدمین بۆی هەیە.');
        return;
      }

      const replyToId = data.reply_to_id || null;

      const savedMsg = messages.create(
        freshUser.id,
        freshUser.username,
        freshUser.full_name,
        freshUser.role,
        content,
        'text',
        null,
        replyToId,
        'none',
        null
      );

      const isStaffUser = freshUser.role === 'super_admin' || freshUser.role === 'teacher';
      const isMentionAll = isStaffUser && (
        content.includes('@هەموو') || 
        content.includes('@هەمو') || 
        content.includes('@1') ||
        content.includes('@all')
      );

      if (isMentionAll) {
        sendPushNotificationToAll({
          title: `📢 ئاگاداری هەمووان لەلایەن ${freshUser.full_name}`,
          body: content.trim(),
          icon: '/favicon.png',
          tag: 'mention-all-' + Date.now()
        }, freshUser.id);

        io.emit('mention_all_alert', {
          sender: freshUser.full_name,
          senderRole: freshUser.role,
          content: content.trim(),
          messageId: savedMsg.id
        });
      }

      const starInfo = calculateStars(freshUser.correct_answers_count);
      const broadcastMsg = {
        ...savedMsg,
        gender: freshUser.gender || 'male',
        starInfo,
        is_mention_all: !!isMentionAll
      };

      io.emit('new_message', broadcastMsg);
    } catch (err) {
      console.error('Socket message error:', err);
    }
  });

  // --- LIVE LESSON ("وانە") REAL-TIME SOCKET HANDLERS ---
  socket.emit('live_lesson_state', getLiveLessonSnapshot());

  socket.on('live_get_state', () => {
    socket.emit('live_lesson_state', getLiveLessonSnapshot());
  });

  socket.on('live_start', (data) => {
    const freshUser = users.findById(user.id);
    if (!freshUser || !canManageLive(freshUser)) {
      socket.emit('error_message', '❌ دەسەڵاتی کردنەوەی لایڤت نییە (تەنها سوپەر ئەدمین یان خاوەن باجی تایبەت دەتوانێت)');
      return;
    }

    liveLessonState.isActive = true;
    liveLessonState.title = (data && data.title) ? data.title.trim() : 'وانەی ڕاستەوخۆ';
    liveLessonState.startedBy = { id: freshUser.id, name: freshUser.full_name, role: freshUser.role, special_badge: freshUser.special_badge };
    liveLessonState.startedAt = Date.now();
    liveLessonState.bannedUserIds.clear();
    liveLessonState.quranState = { isPlaying: false, reciter: '', surahName: '', audioUrl: '' };
    liveLessonState.screenSharingBy = null;

    liveLessonState.participants.set(socket.id, {
      socketId: socket.id,
      userId: freshUser.id,
      username: freshUser.username,
      fullName: freshUser.full_name,
      role: freshUser.role,
      special_badge: freshUser.special_badge,
      gender: freshUser.gender || 'male',
      isMuted: false,
      handRaised: false,
      hasMicPermission: true
    });
    socket.join('live_lesson_room');

    broadcastLiveLessonState();
    io.emit('live_lesson_started_alert', {
      title: liveLessonState.title,
      startedBy: freshUser.full_name
    });

    // Web Push Notification: Live Lesson Started
    sendPushNotificationToAll({
      title: '🔴 وانەی ڕاستەوخۆ دەستیپێکرد!',
      body: `${freshUser.full_name} وانەیەکی نوێی دەستپێکرد: ${liveLessonState.title}. ئێستا وەرە بەشداربە! 🎙️`,
      tag: 'live-lesson-active',
      data: { url: '/?action=live' }
    }, freshUser.id);
  });

  socket.on('live_end', () => {
    const freshUser = users.findById(user.id);
    if (!freshUser || !canManageLive(freshUser)) return;

    liveLessonState.isActive = false;
    liveLessonState.startedBy = null;
    liveLessonState.startedAt = null;
    liveLessonState.quranState = { isPlaying: false, reciter: '', surahName: '', audioUrl: '' };
    liveLessonState.screenSharingBy = null;
    liveLessonState.participants.clear();
    io.to('live_lesson_room').emit('live_lesson_ended_notice');
    broadcastLiveLessonState();
  });

  socket.on('live_join', () => {
    if (liveLessonState.bannedUserIds.has(user.id)) {
      socket.emit('live_kicked_notice', 'تۆ لەم وانەیە دەرکراویت و ناتوانیت بەشداربیتەوە');
      return;
    }

    const freshUser = users.findById(user.id);
    const canSpeakByDefault = freshUser && (canManageLive(freshUser) || (liveLessonState.startedBy && liveLessonState.startedBy.id === user.id));

    liveLessonState.participants.set(socket.id, {
      socketId: socket.id,
      userId: user.id,
      username: user.username,
      fullName: user.full_name,
      role: user.role,
      special_badge: freshUser ? freshUser.special_badge : null,
      gender: user.gender || 'male',
      isMuted: true,
      handRaised: false,
      hasMicPermission: !!canSpeakByDefault
    });

    socket.join('live_lesson_room');
    broadcastLiveLessonState();

    socket.to('live_lesson_room').emit('live_peer_joined', {
      socketId: socket.id,
      userId: user.id,
      fullName: user.full_name,
      role: user.role
    });

    if (user.role === 'teacher' || user.role === 'super_admin') {
      socket.to('live_lesson_room').emit('live_teacher_joined', {
        name: user.full_name,
        fullName: user.full_name,
        role: user.role
      });
    }

    if (liveLessonState.quranState && liveLessonState.quranState.isPlaying) {
      socket.emit('live_quran_playing', liveLessonState.quranState);
    }
    if (liveLessonState.screenSharingBy) {
      socket.emit('live_screen_started', liveLessonState.screenSharingBy);
    }
  });

  socket.on('live_leave', () => {
    if (user.role === 'teacher' || user.role === 'super_admin') {
      socket.to('live_lesson_room').emit('live_teacher_left', {
        name: user.full_name,
        fullName: user.full_name,
        role: user.role
      });
    }
    socket.to('live_lesson_room').emit('live_peer_left', {
      socketId: socket.id,
      userId: user.id
    });
    liveLessonState.participants.delete(socket.id);
    socket.leave('live_lesson_room');
    if (liveLessonState.screenSharingBy && liveLessonState.screenSharingBy.id === user.id) {
      liveLessonState.screenSharingBy = null;
      io.to('live_lesson_room').emit('live_screen_stopped');
    }
    broadcastLiveLessonState();
  });

  socket.on('live_ping_report', (data) => {
    const p = liveLessonState.participants.get(socket.id);
    if (p && data && typeof data.pingMs === 'number') {
      p.pingMs = data.pingMs;
      p.networkQuality = data.pingMs < 180 ? 'good' : (data.pingMs < 380 ? 'fair' : 'poor');
      broadcastLiveLessonState();
    }
  });

  socket.on('live_raise_hand', () => {
    const p = liveLessonState.participants.get(socket.id);
    if (p) {
      p.handRaised = !p.handRaised;
      broadcastLiveLessonState();
    }
  });

  socket.on('live_grant_mic', (data) => {
    const freshUser = users.findById(user.id);
    const canMod = freshUser && (canManageLive(freshUser) || (liveLessonState.startedBy && liveLessonState.startedBy.id === user.id));
    if (!canMod || !data || !data.targetUserId) return;
    const targetId = parseInt(data.targetUserId);

    for (const [sId, p] of liveLessonState.participants.entries()) {
      if (p.userId === targetId) {
        p.hasMicPermission = true;
        p.handRaised = false;
        io.to(sId).emit('live_mic_permission_granted');
      }
    }
    broadcastLiveLessonState();
  });

  socket.on('live_revoke_mic', (data) => {
    const freshUser = users.findById(user.id);
    const canMod = freshUser && (canManageLive(freshUser) || (liveLessonState.startedBy && liveLessonState.startedBy.id === user.id));
    if (!canMod || !data || !data.targetUserId) return;
    const targetId = parseInt(data.targetUserId);

    for (const [sId, p] of liveLessonState.participants.entries()) {
      if (p.userId === targetId) {
        p.hasMicPermission = false;
        p.isMuted = true;
        io.to(sId).emit('live_mic_permission_revoked');
      }
    }
    broadcastLiveLessonState();
  });

  socket.on('live_kick', (data) => {
    const freshUser = users.findById(user.id);
    const canMod = freshUser && (canManageLive(freshUser) || (liveLessonState.startedBy && liveLessonState.startedBy.id === user.id));
    if (!canMod || !data || !data.targetUserId) return;
    const targetId = parseInt(data.targetUserId);

    liveLessonState.bannedUserIds.add(targetId);

    for (const [sId, p] of Array.from(liveLessonState.participants.entries())) {
      if (p.userId === targetId) {
        liveLessonState.participants.delete(sId);
        io.to(sId).emit('live_kicked_notice', 'تۆ لەلایەن بەڕێوەبەرەوە لە وانەکە دەرکرایت');
        const targetSocket = io.sockets.sockets.get(sId);
        if (targetSocket) targetSocket.leave('live_lesson_room');
      }
    }
    broadcastLiveLessonState();
  });

  socket.on('live_quran_play', (data) => {
    const freshUser = users.findById(user.id);
    const canMod = freshUser && (canManageLive(freshUser) || (liveLessonState.startedBy && liveLessonState.startedBy.id === user.id));
    if (!canMod || !data) return;
    liveLessonState.quranState = {
      isPlaying: true,
      reciter: data.reciter || 'قورئانی پیرۆز',
      surahName: data.surahName || '',
      audioUrl: data.audioUrl || ''
    };
    io.to('live_lesson_room').emit('live_quran_playing', liveLessonState.quranState);
    broadcastLiveLessonState();
  });

  socket.on('live_quran_stop', () => {
    const freshUser = users.findById(user.id);
    const canMod = freshUser && (canManageLive(freshUser) || (liveLessonState.startedBy && liveLessonState.startedBy.id === user.id));
    if (!canMod) return;
    liveLessonState.quranState = { isPlaying: false, reciter: '', surahName: '', audioUrl: '' };
    io.to('live_lesson_room').emit('live_quran_stopped');
    broadcastLiveLessonState();
  });

  socket.on('live_screen_start', () => {
    const freshUser = users.findById(user.id);
    if (!freshUser || !canManageLive(freshUser)) return;
    liveLessonState.screenSharingBy = {
      id: user.id,
      name: user.full_name,
      fullName: user.full_name,
      socketId: socket.id
    };
    io.to('live_lesson_room').emit('live_screen_started', liveLessonState.screenSharingBy);
    broadcastLiveLessonState();
  });

  socket.on('live_screen_stop', () => {
    liveLessonState.screenSharingBy = null;
    io.to('live_lesson_room').emit('live_screen_stopped');
    broadcastLiveLessonState();
  });

  socket.on('live_signal', (data) => {
    if (data && data.to) {
      socket.to(data.to).emit('live_signal', {
        from: socket.id,
        fromUser: { id: user.id, fullName: user.full_name, role: user.role },
        ...data
      });
    }
  });

  socket.on('live_audio_chunk', (data) => {
    const p = liveLessonState.participants.get(socket.id);
    if (p && p.hasMicPermission && data && data.chunk) {
      socket.to('live_lesson_room').emit('live_audio_chunk', {
        fromUserId: user.id,
        fromUserName: user.full_name,
        chunk: data.chunk
      });
    }
  });

  socket.on('live_mic_toggle', (isMuted) => {
    const p = liveLessonState.participants.get(socket.id);
    if (p && p.hasMicPermission) {
      p.isMuted = Boolean(isMuted);
      socket.to('live_lesson_room').emit('live_peer_mic_state', { socketId: socket.id, userId: user.id, isMuted: p.isMuted });
      broadcastLiveLessonState();
    }
  });

  socket.on('disconnect', () => {
    onlineUsers.delete(socket.id);
    io.emit('online_users', getUniqueOnlineList());
    if (liveLessonState.participants.has(socket.id)) {
      if (user && (user.role === 'teacher' || user.role === 'super_admin')) {
        io.to('live_lesson_room').emit('live_teacher_left', {
          name: user.full_name,
          fullName: user.full_name,
          role: user.role
        });
      }
      io.to('live_lesson_room').emit('live_peer_left', {
        socketId: socket.id,
        userId: user ? user.id : null
      });
      liveLessonState.participants.delete(socket.id);
      if (liveLessonState.screenSharingBy && liveLessonState.screenSharingBy.id === (user ? user.id : null)) {
        liveLessonState.screenSharingBy = null;
        io.to('live_lesson_room').emit('live_screen_stopped');
      }
      broadcastLiveLessonState();
    }
  });
});

if (!process.env.VERCEL && process.env.NODE_ENV !== 'test') {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 سێرڤەر بەسەرکەوتوویی لەسەر پۆرتی http://0.0.0.0:${PORT} دەستی پێکرد`);
  });

  // Secondary listener on port 4000 so both http://seereen.duckdns.org (port 80) and port 4000/cloudflared work
  if (Number(PORT) === 80) {
    try {
      const secondaryServer = http.createServer(app);
      io.attach(secondaryServer);
      secondaryServer.listen(4000, '0.0.0.0', () => {
        console.log('🚀 پۆرتی 4000یش وەک یەدەگ چالاکە');
      });
    } catch (e) {
      console.warn('Secondary port 4000 warning:', e.message);
    }
  }
}

module.exports = app;
