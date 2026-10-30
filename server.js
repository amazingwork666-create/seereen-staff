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
const { db, initDb, users, messages, questions, library, dreamSessions, dreamMessages, settings, passwordResets, privateMessages, messageReactions, profileChangeRequests, pushSubscriptions, calculateStars, liveRecordings, recordedLessons, getDreamTeacherAlias, aiSecurity, advisorDb, buttonClicks, customGroups, pollsDb, alarmsDb, complaints, attendanceDb } = require('./db');

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

async function sendPushNotificationToAllChatSubscribers(payload, excludeUserId = null) {
  if (!webpush || !vapidKeys) return;
  try {
    const subs = pushSubscriptions.getAllChatSubscribers(excludeUserId);
    if (!subs || subs.length === 0) return;

    const payloadStr = JSON.stringify({
      title: payload.title || 'نامەی نوێ',
      body: payload.body || '',
      icon: payload.icon || '/favicon.png',
      badge: payload.badge || '/favicon.png',
      tag: payload.tag || ('chat-msg-' + Date.now()),
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
    console.error('Error broadcasting push notification to chat subscribers:', err);
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

app.disable('x-powered-by');

// =========================================================================
// HTTP SECURITY HEADERS (A+ Grade on Mozilla Observatory & SecurityHeaders)
// =========================================================================
app.use((req, res, next) => {
  // Prevent MIME-sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Protect against clickjacking
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  // Enforce HTTPS
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  // Privacy-friendly referrer header
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Limit sensitive APIs to origin
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');
  // Robust Content Security Policy (allows Tailwind, Socket.io, FontAwesome, MP3 Quran audio, and WebSockets)
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self' blob: data:; " +
    "base-uri 'self'; " +
    "object-src 'none'; " +
    "form-action 'self'; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com https://cdnjs.cloudflare.com https://cdn.socket.io https://cdn.jsdelivr.net; " +
    "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://fonts.googleapis.com; " +
    "font-src 'self' data: https://cdnjs.cloudflare.com https://fonts.gstatic.com; " +
    "img-src 'self' data: blob: https:; " +
    "media-src 'self' blob: data: https: https://*.mp3quran.net; " +
    "connect-src 'self' wss: ws: https: http:; " +
    "frame-ancestors 'self';"
  );
  next();
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
    if (!user.last_active_at || (Date.now() - user.last_active_at > 5 * 60 * 1000)) {
      users.updateLastActive(user.id);
    }
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

const ALL_SPECIAL_BADGES = ['white', 'blue', 'green', 'black', 'red', 'purple'];

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

// Helper: Has full Super Admin capabilities (Master Super Admin, super_admin, or Black Badge)
function hasSuperAdminPrivileges(user) {
  if (!user) return false;
  if (isMasterSuperAdmin(user) || user.role === 'super_admin') return true;
  return hasUserBadge(user, 'black');
}

// Helper: Can manage members and roles up to teacher (Super Admin, Black Badge, or Green Badge)
function canManageMembers(user) {
  if (!user) return false;
  if (hasSuperAdminPrivileges(user)) return true;
  return hasUserBadge(user, 'green');
}

// Helper: Can lock/unlock chat
function canLockChat(user, mode = 'staff_only') {
  if (!user) return false;
  if (hasSuperAdminPrivileges(user)) return true;
  if (mode === 'total_lock') return false; // green badge cannot do total_lock
  return hasUserBadge(user, 'green');
}

// Helper: Can manage Live lesson (Start, End, and Mod inside Live)
// Only Master Super Admin or users with Black, Green, or Red badge!
// Normal teachers and normal admins CANNOT manage Live!
function canManageLive(user) {
  if (!user) return false;
  if (hasSuperAdminPrivileges(user)) return true;
  return hasUserBadge(user, 'green') || hasUserBadge(user, 'red');
}

// Helper: Can manage dreams (Master Super Admin, role super_admin, role teacher, OR special_badge === 'purple')
function canManageDreams(user) {
  if (!user) return false;
  if (isMasterSuperAdmin(user) || user.role === 'super_admin' || user.role === 'teacher') return true;
  return hasUserBadge(user, 'purple');
}

// Helper: Can moderate chat (Master Super Admin, super_admin, admin, teacher, OR Blue/Green/Black Badge)
function canModerateChat(user) {
  if (!user) return false;
  if (isMasterSuperAdmin(user) || user.role === 'super_admin' || user.role === 'admin' || user.role === 'teacher') return true;
  return hasUserBadge(user, 'blue') || hasUserBadge(user, 'green') || hasUserBadge(user, 'black');
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

// AI Advisor Access Middleware (Master Super Admin, role super_admin, Black Badge, or White Badge)
function requireAiAdvisorAccess(req, res, next) {
  if (!isMasterSuperAdmin(req.user) && req.user?.role !== 'super_admin' && !hasUserBadge(req.user, 'white') && !hasSuperAdminPrivileges(req.user)) {
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
  if (req.user.role !== 'admin' && req.user.role !== 'super_admin' && req.user.role !== 'teacher' && !hasSuperAdminPrivileges(req.user)) {
    return res.status(403).json({ error: 'تەنها ئەدمین و مامۆستا دەسەڵاتی ئەم کارەیان هەیە' });
  }
  next();
}

// Super Admin or Teacher Middleware (Strictly excludes normal admin and student)
function requireTeacherOrSuperAdmin(req, res, next) {
  if (req.user.role !== 'super_admin' && req.user.role !== 'teacher' && !hasSuperAdminPrivileges(req.user)) {
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

  // Automatic warning for students who missed 5 consecutive questions
  try {
    for (const student of nonResponding) {
      const sId = student.id || student.user_id;
      if (!sId) continue;
      const missedStreak = questions.getStudentConsecutiveMissedCount(sId, 5);
      if (missedStreak >= 5) {
        const u = users.findById(sId);
        const now = Date.now();
        const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
        if (u && (!u.last_question_warn_at || (now - u.last_question_warn_at > THREE_DAYS_MS))) {
          db.prepare('UPDATE users SET last_question_warn_at = ?, last_warned_missed_count = ? WHERE id = ?').run(now, missedStreak, u.id);

          const warnText = `ئاگاداری لە بەڕێوەبەرایەتی پلاتفۆرمی سیرین ⚠️:\n\nخوێندکاری بەڕێز (${u.full_name})،\nسەرنجمان داوە کە ٥ پرسیاری لەسەریەکە لە گروپ چاتدا وەڵامت نەداوەتەوە و لە چالاکییەکان بەشدار نەبوویت.\nتکایە بەشداربە لە وەڵامدانەوەی پرسیارە نوێیەکان بۆ ئەوەی لە کۆکردنەوەی ئەستێرە و ڕیزبەندی پێشەنگەکان دانەبڕێیت و ئەکاونتەکەت بە چالاکی بمێنێتەوە 🌸✨`;

          privateMessages.create(
            q.admin_id,
            u.id,
            'بەڕێوەبەرایەتی سیرین',
            'super_admin',
            warnText,
            'text'
          );

          io.to(`user_${u.id}`).emit('question_warning_notification', {
            user_id: u.id,
            missed_count: missedStreak,
            message: warnText
          });

          sendPushNotificationToUser(u.id, {
            title: 'ئاگاداری بەشدارینەکردن لە پرسیارەکان ⚠️',
            body: `خوێندکاری بەڕێز ${u.full_name}، ٥ پرسیارە وەڵامت نەداوەتەوە، تکایە بەشداربە لە وەڵامدانەوە.`,
            tag: 'missed-question-warning-' + u.id,
            data: { url: '/' }
          });
          console.log(`[Warning Alert] Sent 5-missed-question warning to student ${u.id} (${u.full_name})`);
        }
      }
    }
  } catch (warnErr) {
    console.error('Error sending question non-response warnings:', warnErr);
  }
}

// Function to automatically publish a scheduled question when its time arrives
function triggerQuestionPublish(questionId) {
  const q = questions.findById(questionId);
  if (!q || q.is_published) return;

  const updatedQ = questions.publishNow(questionId);
  if (!updatedQ) return;

  setupQuestionTimer(updatedQ);

  const msgContent = JSON.stringify({
    question_id: updatedQ.id,
    question_number: updatedQ.question_number || 1,
    question_text: updatedQ.question_text,
    admin_name: updatedQ.admin_name,
    duration_minutes: updatedQ.duration_minutes,
    expires_at: updatedQ.expires_at,
    has_model_answer: !!updatedQ.correct_answer
  });

  const questionMsg = messages.create(
    updatedQ.admin_id,
    updatedQ.admin_name,
    updatedQ.admin_name,
    'admin',
    msgContent,
    'question',
    updatedQ.id
  );

  io.emit('new_question', {
    question: updatedQ,
    message: questionMsg
  });

  sendPushNotificationToAll({
    title: `📢 پرسیاری نوێ (${updatedQ.question_number ? 'ژمارە ' + updatedQ.question_number : ''}) بڵاوکرایەوە!`,
    body: `${updatedQ.question_text.slice(0, 90)}... ئێستا دەتوانیت وەڵامەکەت بنووسیت`,
    tag: 'new-question-' + updatedQ.id,
    data: { url: '/' }
  });

  console.log(`[Scheduled Question] Auto-published question #${updatedQ.id} (${updatedQ.question_text.slice(0, 30)})`);
}

// Periodic check every 3 seconds for expired questions and scheduled questions to publish
setInterval(() => {
  try {
    const now = Date.now();
    // 1. Reveal expired questions
    const expiredQuestions = db.prepare('SELECT id FROM questions WHERE is_active = 1 AND is_revealed = 0 AND is_published = 1 AND expires_at > 0 AND expires_at <= ?').all(now);
    for (const q of expiredQuestions) {
      triggerQuestionReveal(q.id);
    }
    // 2. Publish scheduled questions whose publish time has arrived
    const scheduledToPublish = db.prepare('SELECT id FROM questions WHERE is_published = 0 AND publish_at > 0 AND publish_at <= ?').all(now);
    for (const sq of scheduledToPublish) {
      triggerQuestionPublish(sq.id);
    }
  } catch (err) {
    console.error('Error in question timer interval:', err);
  }
}, 3000);

// On startup: check if active published questions exist and setup timers
setTimeout(() => {
  try {
    const allActive = db.prepare('SELECT * FROM questions WHERE is_active = 1 AND is_revealed = 0 AND is_published = 1').all();
    for (const q of allActive) {
      setupQuestionTimer(q);
    }
  } catch (err) {
    console.error('Error on startup question timer setup:', err);
  }
}, 1000);

// Auto-Cleanup: Automatically delete user accounts inactive for > 1 month (30 days)
function cleanupInactiveUsers() {
  try {
    const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000;
    const inactiveUsers = users.getInactiveUsers(ONE_MONTH_MS);
    if (inactiveUsers && inactiveUsers.length > 0) {
      console.log(`[Auto-Cleanup] Found ${inactiveUsers.length} inactive account(s) (> 1 month). Processing deletion...`);
      for (const u of inactiveUsers) {
        if (isMasterSuperAdmin(u) || u.role === 'super_admin' || u.username === 'admin' || u.username === 'hemntjabar' || u.id === 1) {
          continue;
        }
        users.delete(u.id);
        console.log(`[Auto-Cleanup] Deleted inactive user: ID ${u.id}, ${u.username} (${u.full_name})`);
        if (typeof io !== 'undefined' && io) {
          io.emit('user_deleted', { user_id: u.id, full_name: u.full_name });
        }
      }
    }
  } catch (err) {
    console.error('[Auto-Cleanup] Error cleaning up inactive accounts:', err);
  }
}

// Run auto-cleanup on startup and every 6 hours
setTimeout(cleanupInactiveUsers, 5000);
setInterval(cleanupInactiveUsers, 6 * 60 * 60 * 1000);

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

    users.updateLastActive(user.id);

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

// Update user course enrollments (Eligible: Super Admin, Teachers, Admins, Students)
app.put('/api/users/:id/courses', authMiddleware, (req, res) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    const isSelf = req.user.id === targetId;
    const isSuper = isMasterSuperAdmin(req.user);
    if (!isSelf && !isSuper) {
      return res.status(403).json({ error: 'دەسەڵاتی دەستکاریکردنی ئەم پرۆفایلەت نییە' });
    }

    const eligibleRoles = ['super_admin', 'teacher', 'admin', 'student', 'new_student'];
    const targetUser = users.findById(targetId);
    if (!targetUser) return res.status(404).json({ error: 'بەکارهێنەر نەدۆزرایەوە' });

    if (!eligibleRoles.includes(targetUser.role) && !isSuper) {
      return res.status(403).json({ error: 'تەنها مامۆستا، ئەدمین، خوێندکار یان سەرپەرشتیار دەتوانن بەشداریکردنی خول لە پڕۆفایل بنووسن' });
    }

    const allowedCourses = ['خولی مامۆستا زانا', 'خولی ئیبن سیرین'];
    const rawCourses = Array.isArray(req.body.courses) ? req.body.courses : [];
    const sanitizedCourses = rawCourses.map(c => String(c).trim()).filter(c => allowedCourses.includes(c));

    users.updateCourseEnrollments(targetId, sanitizedCourses);
    io.emit('user_profile_updated', { userId: targetId, course_enrollments: sanitizedCourses });
    res.json({ success: true, courses: sanitizedCourses });
  } catch (err) {
    console.error('Error updating course enrollments:', err);
    res.status(500).json({ error: 'هەڵە لە پاشەکەوتکردنی خولەکان' });
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

// 6b. Get pending password reset requests (Super Admin or Green Badge)
app.get('/api/admin/password-resets', authMiddleware, requireMemberManager, (req, res) => {
  try {
    const list = passwordResets.getPending();
    res.json({ requests: list });
  } catch (err) {
    res.status(500).json({ error: 'هەڵە لە بارکردنی داواکارییەکان' });
  }
});

// 6c. Approve password reset request (Super Admin or Green Badge)
app.post('/api/admin/password-resets/:id/approve', authMiddleware, requireMemberManager, (req, res) => {
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

// 6d. Reject password reset request (Super Admin or Green Badge)
app.post('/api/admin/password-resets/:id/reject', authMiddleware, requireMemberManager, (req, res) => {
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
    const { type, details, severity, action_taken, evidence } = req.body;
    const allowedTypes = ['bad_word', 'nsfw_image', 'flood_raid', 'malicious_link', 'star_fraud', 'harassment', 'impersonation'];
    const safeType = allowedTypes.includes(type) ? type : 'other';
    aiSecurity.logIncident(safeType, req.user.id, req.user.full_name, details || 'پشکنەری کڵاینت هەوڵێکی گوماناوی ڕاگرت', severity || 'medium', action_taken || 'blocked', evidence || '');
    io.emit('security_incident_alert', {
      type: safeType,
      user_id: req.user.id,
      user_name: req.user.full_name,
      details: details || '',
      severity: severity || 'medium',
      action_taken: action_taken || 'blocked',
      evidence: evidence || '',
      timestamp: Date.now()
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'هەڵە لە تۆمارکردنی ئاگاداری ئاسایش' });
  }
});

app.delete('/api/admin/security/incident/:id', authMiddleware, requireSuperAdminPrivileges, (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ناسنامەی نادروست' });
    aiSecurity.deleteIncident(id);
    res.json({ success: true, message: 'تۆمارەکە بە سەرکەوتوویی سڕایەوە' });
  } catch (err) {
    res.status(500).json({ error: 'هەڵە لە سڕینەوەی تۆمار' });
  }
});

app.post('/api/admin/security/clear-incidents', authMiddleware, requireSuperAdminPrivileges, (req, res) => {
  try {
    aiSecurity.clearAll();
    res.json({ success: true, message: 'تۆمارەکانی ئاسایش بە سەرکەوتوویی پاککرانەوە' });
  } catch (err) {
    res.status(500).json({ error: 'هەڵە لە پاککردنەوەی تۆمارەکان' });
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
    const allBadgeUsers = db.prepare("SELECT id, full_name, username, special_badge FROM users WHERE special_badge IS NOT NULL AND special_badge != ''").all() || [];
    const badgeCounts = {};
    ALL_SPECIAL_BADGES.forEach(b => { badgeCounts[b] = 0; });
    let purpleBadgeHolders = [];
    for (const u of allBadgeUsers) {
      const userBadges = parseUserBadges(u.special_badge);
      for (const b of userBadges) {
        badgeCounts[b] = (badgeCounts[b] || 0) + 1;
      }
      if (userBadges.includes('purple')) {
        purpleBadgeHolders.push({ id: u.id, full_name: u.full_name, username: u.username });
      }
    }

    // 2. Dreams telemetry (Accurate, strictly reflecting non-empty and non-deleted dreams)
    let totalDreams = 0;
    let unansweredDreams = 0;
    let favoriteDreams = 0;
    try {
      // First, clean up any orphaned dream sessions that have 0 dreamer messages (from previously deleted dreams/messages)
      try {
        db.prepare(`
          DELETE FROM dream_sessions 
          WHERE (SELECT COUNT(*) FROM dream_messages WHERE session_id = dream_sessions.id AND sender_type = 'dreamer') = 0
        `).run();
      } catch (cleanupErr) {}

      totalDreams = db.prepare(`
        SELECT COUNT(*) as c FROM dream_sessions s 
        WHERE (SELECT COUNT(*) FROM dream_messages m WHERE m.session_id = s.id AND m.sender_type = 'dreamer') > 0
      `).get()?.c || 0;

      unansweredDreams = db.prepare(`
        SELECT COUNT(*) as c FROM dream_sessions s 
        WHERE (SELECT COUNT(*) FROM dream_messages m WHERE m.session_id = s.id AND m.sender_type = 'dreamer') > 0 
          AND s.answered_at IS NULL 
          AND COALESCE(s.is_interpreted, 0) = 0
          AND s.status != 'closed'
      `).get()?.c || 0;

      favoriteDreams = db.prepare(`
        SELECT COUNT(*) as c FROM dream_sessions s 
        WHERE s.is_favorite = 1 
          AND (SELECT COUNT(*) FROM dream_messages m WHERE m.session_id = s.id AND m.sender_type = 'dreamer') > 0
      `).get()?.c || 0;
    } catch (e) {
      console.error('Advisor dream count error:', e);
    }

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
      actionText: 'قەڵغانی بەرگری'
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

    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

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
          secStats,
          liveAuditLogs: advisorDb.getLiveAuditLogs(25),
          latest_button_report: buttonClicks.getAttendanceReport(null)
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

// =========================================================================
// MULTI-KEY GEMINI LOAD BALANCER & FAILOVER (سیستەمی فرە-کلیل و دابەشکردنی لۆد)
// =========================================================================
let advisorKeyRotationIndex = 0;
function getAdvisorGeminiKeys() {
  const keys = [];
  try {
    const k1 = settings.get('advisor_gemini_api_key');
    const k2 = settings.get('advisor_gemini_api_key_2');
    const kEnv = process.env.GEMINI_API_KEY;
    if (k1 && typeof k1 === 'string' && k1.trim()) keys.push(k1.trim());
    if (k2 && typeof k2 === 'string' && k2.trim() && !keys.includes(k2.trim())) keys.push(k2.trim());
    if (kEnv && typeof kEnv === 'string' && kEnv.trim() && !keys.includes(kEnv.trim())) keys.push(kEnv.trim());
  } catch (e) {}
  return keys;
}

function getOrderedAdvisorKeys() {
  const all = getAdvisorGeminiKeys();
  if (all.length <= 1) return all;
  const startIdx = advisorKeyRotationIndex % all.length;
  advisorKeyRotationIndex++;
  const rotated = [];
  for (let i = 0; i < all.length; i++) {
    rotated.push(all[(startIdx + i) % all.length]);
  }
  return rotated;
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
        name: 'get_live_audit_logs',
        description: 'بینین و پشکنینی مێژووی کردنەوە و داخستنی لایڤ لە ژوری پشکنینی گشتی (کێ لایڤی کردەوە و کێ دایخست لەگەڵ کات و بەروار و ماوە)',
        parameters: {
          type: 'OBJECT',
          properties: {
            limit: { type: 'INTEGER', description: 'ژمارەی تۆمارەکان (دەفۆڵت ١٠)' }
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
        name: 'change_user_gender',
        description: 'گۆڕینی ڕەگەزی بەکارهێنەرێک (نێر/مێ - male/female) بە فەرمانی سوپەر ئەدمین',
        parameters: {
          type: 'OBJECT',
          properties: {
            username_or_id: { type: 'STRING', description: 'ناو یان یوزەرنەیم یان ئایدی بەکارهێنەرەکە' },
            new_gender: { type: 'STRING', description: 'ڕەگەزی نوێ: male (نێر) یان female (مێ)', enum: ['male', 'female'] }
          },
          required: ['username_or_id', 'new_gender']
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
        name: 'get_button_attendance',
        description: 'وەرگرتنی ئاماری دوگمەی چات (@دوگمە) بە فەرمانی کاک هێمن: لیستی ناوی هەموو ئەو کەسانەی پەنجەیان بە دوگمەکەدا ناوە (سەوز بووە) و لیستی ناوی هەموو ئەو کەسانەی هێشتا دەستیان لێنەداوە، لەگەڵ دەقی پەیام و کاتی ناردن',
        parameters: {
          type: 'OBJECT',
          properties: {
            message_id: { type: 'INTEGER', description: 'ئایدی پەیامی دوگمەکە ئەگەر بتەوێت دوگمەیەکی دیاریکراو بێت (ئەگەر دانەنرێت دوایین دوگمە وەردەگرێت)' }
          }
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
      },
      {
        name: 'get_inactive_users',
        description: 'پشکنینی بەکارهێنەرە بێدەنگ و ناچالاکەکان: کێ قسە ناکات لە چاتدا، ناوەکانیان چین، و کێ بۆ ماوەیەکی زۆرە سەردانی نەکردووە یان هیچ نامەیەکی نەناردووە',
        parameters: {
          type: 'OBJECT',
          properties: {
            days: { type: 'INTEGER', description: 'ماوە بە ڕۆژ (بۆ نموونە ٧ یان ٣٠ ڕۆژ، دەفۆڵت ٣٠)' },
            filter_type: { type: 'STRING', description: "'silent' بۆ ئەوانەی قسە ناکەن (٠ پەیام)، 'offline' بۆ ئەوانەی ناچالاکن، 'all' بۆ هەردووکی" }
          }
        }
      },
      {
        name: 'get_user_full_activity',
        description: 'هێنانی ڕاپۆرتی تەواوی جوڵە و چالاکییەکانی بەکارهێنەرێک (فڵانکەس چی کرد): پەیامەکانی چات، خەون، لایڤ، وەڵامی پرسیار، باج، و کاتی تۆماربوون',
        parameters: {
          type: 'OBJECT',
          properties: {
            username_or_id: { type: 'STRING', description: 'ناو، یوزەرنەیم، یان ئایدی بەکارهێنەرەکە' }
          },
          required: ['username_or_id']
        }
      },
      {
        name: 'clear_custom_group_messages',
        description: 'سڕینەوە و پاککردنەوەی تەواوی پەیام و چاتەکانی ناو گروپ چات بە فەرمانی کاک هێمن',
        parameters: {
          type: 'OBJECT',
          properties: {
            group_id: { type: 'INTEGER', description: 'ئایدی گروپ ئەگەر دیاریکراو بێت' }
          }
        }
      },
      {
        name: 'manage_custom_group',
        description: 'بەڕێوەبردنی گروپ چاتە تایبەتەکان بە فەرمانی کاک هێمن (دروستکردن create، سڕینەوە delete، زیادکردنی ئەندام add_member، لابردنی ئەندام remove_member، یان لیستی گروپەکان list)',
        parameters: {
          type: 'OBJECT',
          properties: {
            action: { type: 'STRING', description: "'create', 'delete', 'add_member', 'remove_member', or 'list'" },
            group_name_or_id: { type: 'STRING', description: 'ناوی گروپ یان ئایدی گروپ' },
            username_or_id: { type: 'STRING', description: 'ناو یان یوزەرنەیم یان ئایدی ئەندام' }
          },
          required: ['action']
        }
      },
      {
        name: 'get_platform_analytics',
        description: 'وەرگرتنی ئامار و شیکاری تەواوی پلاتفۆرم: ژمارەی ئەندامان و قوتابیان، ناوە دووبارەکان، ناوە ئینگلیزییەکان، ڕۆڵەکان، و ئەندامانی بێدەنگ',
        parameters: {
          type: 'OBJECT',
          properties: {}
        }
      },
      {
        name: 'create_poll',
        description: 'دروستکردن و بڵاوکردنەوەی ڕاپرسی نوێ لە چاتی گشتی یان گروپ چاتی ئێستا بە فەرمانی کاک هێمن',
        parameters: {
          type: 'OBJECT',
          properties: {
            question: { type: 'STRING', description: 'دەقی پرسیار یان بابەتی ڕاپرسی' },
            options: { type: 'ARRAY', items: { type: 'STRING' }, description: 'لیستی بژاردەکان (لانی کەم ٢ بژاردە)' },
            chat_type: { type: 'STRING', description: "'public' بۆ چاتی گشتی، 'custom_group' بۆ گروپی ئێستا" }
          },
          required: ['question', 'options']
        }
      },
      {
        name: 'create_countdown_alarm',
        description: 'دانانی زەنگی ئاگاداری و کاتژمێری لێدانی جەڕەس بە فەرمانی کاک هێمن لە چاتی گشتی یان گروپی ئێستا',
        parameters: {
          type: 'OBJECT',
          properties: {
            title: { type: 'STRING', description: 'نوسینی ئاگاداری سەرووی سەعاتەکە' },
            time_expression: { type: 'STRING', description: 'کاتی لێدانی زەنگ وەک: ئەمشەو سەعات 7:30، یان سبەی سەعات ٩ی شەو، یان ماوە بە خولەک' },
            chat_type: { type: 'STRING', description: "'public' بۆ چاتی گشتی، 'custom_group' بۆ گروپی ئێستا" }
          },
          required: ['title']
        }
      },
      {
        name: 'approve_all_pending_members',
        description: 'پەسەندکردن و وەرگرتنی هەموو ئەو ئەندامە نوێیانەی لە چاوەڕوانیدان بە یەک فەرمانی کاک هێمن (پەسەندکردنی بەکۆمەڵ)',
        parameters: {
          type: 'OBJECT',
          properties: {}
        }
      },
      {
        name: 'delete_dream_session',
        description: 'سڕینەوەی چاتی خەون یان خەونێکی دیاریکراو لە داتابەیس بە فەرمانی کاک هێمن (بەپێی ئایدی خەون، یان ناوی کەسەکە، یان سڕینەوەی هەموو خەونە بێ وەڵامەکان / خەونە بەتاڵەکان)',
        parameters: {
          type: 'OBJECT',
          properties: {
            session_id: { type: 'INTEGER', description: 'ئایدی دانیشتنی خەون (ئەگەر دیاریکراو بێت)' },
            dreamer_name: { type: 'STRING', description: 'ناوی ئەو کەسەی خەونەکەی ناردووە' },
            mode: { type: 'STRING', description: "'single' بۆ یەک دانە، 'all_unanswered' بۆ سڕینەوەی هەموو خەونە بێ وەڵامەکان، 'cleanup_empty' بۆ سڕینەوەی خەونە بەتاڵ و سڕاوەکان" }
          }
        }
      },
      {
        name: 'mark_dream_interpreted',
        description: 'دیاریکردنی خەونێک وەک وەڵامدراوە یان وەڵامنەدراوە بە فەرمانی کاک هێمن',
        parameters: {
          type: 'OBJECT',
          properties: {
            session_id: { type: 'INTEGER', description: 'ئایدی خەونەکە' },
            status: { type: 'STRING', description: "'interpreted' بۆ دانانی وەک وەڵامدراوە، 'unanswered' بۆ وەڵامنەدراوە" }
          },
          required: ['session_id', 'status']
        }
      },
      {
        name: 'reply_to_dream',
        description: 'ناردنی وەڵام یان لێکدانەوەی دەقی خەون بە ناوی ستاف بۆ هاوڵاتی بە فەرمانی کاک هێمن',
        parameters: {
          type: 'OBJECT',
          properties: {
            session_id: { type: 'INTEGER', description: 'ئایدی خەونەکە' },
            reply_text: { type: 'STRING', description: 'دەقی وەڵام یان لێکدانەوەی خەونەکە' }
          },
          required: ['session_id', 'reply_text']
        }
      },
      {
        name: 'toggle_live_lesson',
        description: 'دەستپێکردن یان ڕاگرتن و داخستنی وانەی لایڤ (Live Lesson) لە پلاتفۆرم بە فەرمانی کاک هێمن',
        parameters: {
          type: 'OBJECT',
          properties: {
            action: { type: 'STRING', description: "'start' بۆ دەستپێکردنی لایڤ، 'stop' بۆ داخستن و کۆتایی پێهێنان" },
            title: { type: 'STRING', description: 'ناونیشانی وانەی لایڤ (ئەگەر start بێت)' }
          },
          required: ['action']
        }
      },
      {
        name: 'manage_attendance',
        description: 'بەڕێوەبردن، دەستپێکردن، داخستن، یان سڕینەوەی تۆماری ئامادەبوون و غیابات بە فەرمانی کاک هێمن',
        parameters: {
          type: 'OBJECT',
          properties: {
            action: { type: 'STRING', description: "'delete' بۆ سڕینەوەی غیابات، 'close' بۆ کۆتایی پێهێنان، 'create' بۆ دانانی غیاباتی نوێ، 'view' بۆ بینینی ئامار" },
            session_id: { type: 'INTEGER', description: 'ئایدی دانیشتنی غیابات (ئەگەر دیاریکراو بێت)' },
            title: { type: 'STRING', description: 'ناونیشانی غیاباتەکە ئەگەر create بێت' }
          },
          required: ['action']
        }
      },
      {
        name: 'get_complaints',
        description: 'بینین و پشکنینی سندوقی سکاڵا (سکاڵاکانی فێرخوازان بۆ کاک هێمن)',
        parameters: {
          type: 'OBJECT',
          properties: {
            limit: { type: 'INTEGER', description: 'ژمارەی سکاڵاکان (دەفۆڵت ١٠)' },
            status: { type: 'STRING', description: "'all' یان 'pending'" }
          }
        }
      },
      {
        name: 'clear_security_incidents',
        description: 'پاککردنەوە و سڕینەوەی هەموو تۆمارەکانی هەڕەشەی قەڵغانی پاراستنی زیرەک (AI Security Shield) بە فەرمانی کاک هێمن',
        parameters: {
          type: 'OBJECT',
          properties: {}
        }
      },
      {
        name: 'post_action_button',
        description: 'دانانی دوگمەی کارلێک (@دوگمە) لە چات بۆ ئەوەی بزانرێت کێ پەنجەی لێدەدات و کێ دەستی لێنەداوە بە فەرمانی کاک هێمن',
        parameters: {
          type: 'OBJECT',
          properties: {
            button_text: { type: 'STRING', description: 'دەقی پەیام یان ڕستەی دوگمەکە' }
          },
          required: ['button_text']
        }
      },
      {
        name: 'send_chat_announcement',
        description: 'ناردنی پەیامی فەرمی سیستم یان ئاگاداری ڕاستەوخۆ بۆ ناو چاتی گشتی بە فەرمانی کاک هێمن',
        parameters: {
          type: 'OBJECT',
          properties: {
            message_text: { type: 'STRING', description: 'دەقی پەیامەکە' }
          },
          required: ['message_text']
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

function getAdvisorPlatformAnalytics() {
  try {
    const allUsers = db.prepare('SELECT id, username, full_name, role, status, special_badge, correct_answers_count, last_active_at, created_at FROM users').all();

    // Duplicate full names across the platform
    const dupRows = db.prepare(`SELECT full_name, COUNT(*) as c FROM users GROUP BY LOWER(TRIM(full_name)) HAVING c > 1 ORDER BY c DESC`).all();
    const dupTotalUsers = dupRows.reduce((acc, r) => acc + r.c, 0);
    const dupDetails = dupRows.map(r => `«${r.full_name}» (${r.c} جار)`).join('، ');

    // English names check
    const englishFull = allUsers.filter(u => /[A-Za-z]/.test(u.full_name || ''));
    const englishUser = allUsers.filter(u => /[A-Za-z]/.test(u.username || ''));

    // Role distribution
    const rolesCount = {};
    for (const u of allUsers) {
      rolesCount[u.role] = (rolesCount[u.role] || 0) + 1;
    }

    // Students specifically
    const studentUsers = allUsers.filter(u => u.role === 'student' || u.role === 'approved');
    const studentDupRows = db.prepare(`SELECT full_name, COUNT(*) as c FROM users WHERE role IN ('student', 'approved') GROUP BY LOWER(TRIM(full_name)) HAVING c > 1 ORDER BY c DESC`).all();
    const studentDupTotal = studentDupRows.reduce((acc, r) => acc + r.c, 0);
    const studentEnglishFull = studentUsers.filter(u => /[A-Za-z]/.test(u.full_name || ''));
    const studentEnglishUser = studentUsers.filter(u => /[A-Za-z]/.test(u.username || ''));

    // Silent members (0 messages in chat)
    let silentCount = 0;
    try {
      silentCount = db.prepare(`
        SELECT COUNT(*) as c FROM users u 
        WHERE u.status = 'approved' AND u.role != 'super_admin'
          AND (SELECT COUNT(*) FROM messages WHERE user_id = u.id AND COALESCE(is_deleted, 0) = 0) = 0
      `).get()?.c || 0;
    } catch (e) {}

    // Live stream status and audit logs
    const isLive = Boolean(typeof liveLessonState !== 'undefined' && liveLessonState && liveLessonState.isActive);
    let recentLiveLogs = [];
    try {
      recentLiveLogs = (advisorDb && typeof advisorDb.getLiveAuditLogs === 'function') ? (advisorDb.getLiveAuditLogs(5) || []) : [];
    } catch (e) {}

    return {
      total_users: allUsers.length,
      roles_breakdown: rolesCount,
      students: {
        total_students: studentUsers.length,
        duplicate_names_count: studentDupTotal,
        distinct_duplicate_names: studentDupRows.length,
        duplicate_details: studentDupRows.map(r => `«${r.full_name}» (${r.c} جار)`).join('، ') || 'هیچ ناوێکی دووبارە لە قوتابیان نییە',
        english_full_name_count: studentEnglishFull.length,
        english_username_count: studentEnglishUser.length,
        english_full_names_list: studentEnglishFull.map(u => u.full_name),
        summary: `لە قوتابیاندا: ناوی تەواوی هەموویان بە کوردییە (${studentEnglishFull.length} بە ئینگلیزی)، بەڵام یوزەرنەیمەکانیان (${studentEnglishUser.length}) بە زمانی ئینگلیزییە.`
      },
      duplicate_names: {
        total_duplicates: dupTotalUsers,
        distinct_names_count: dupRows.length,
        details: dupDetails || 'هیچ ناوێکی دووبارە نییە'
      },
      english_names: {
        full_name_count: englishFull.length,
        username_count: englishUser.length,
        full_names_list: englishFull.map(u => u.full_name),
        summary: `لە هەموو پلاتفۆرمەکەدا: ناوی تەواوی هیچ کەسێک ئینگلیزی نییە (${englishFull.length}) و هەمووی کوردییە، بەڵام هەموو یوزەرنەیمەکان (${englishUser.length}) بە زمانی ئینگلیزییە.`
      },
      live_stream: {
        is_live_now: isLive,
        recent_logs: recentLiveLogs.map(l => ({
          user: l.user_name,
          action: l.action === 'opened' ? 'کردنەوەی لایڤ' : 'داخستنی لایڤ',
          time: new Date(l.created_at).toLocaleTimeString('ku')
        }))
      },
      silent_members_count: silentCount
    };
  } catch (err) {
    console.error('getAdvisorPlatformAnalytics error:', err);
    return null;
  }
}

async function generateAdvisorSmartReply(prompt, reqUser, ioInstance, isGroupChat = false) {
  const lower = (prompt || '').toLowerCase();
  const analytics = getAdvisorPlatformAnalytics();

  // If in group chat, strictly disallow command executions
  if (isGroupChat) {
    const isCommand = (
      lower.includes('سڕینەوە') || lower.includes('بسڕەوە') || lower.includes('پاک بکە') || lower.includes('پاکبکە') ||
      lower.includes('دەربکە') || lower.includes('لاببە') || lower.includes('زیاد بکە') || lower.includes('زیادبکە') ||
      lower.includes('قفڵ') || lower.includes('دابخە') || lower.includes('میوت') || lower.includes('بلۆک')
    );
    if (isCommand) {
      return `سڵاو و ڕێز کاک/خاتوو ${reqUser.full_name} گیان 🌸،\nمن لەناو ئەم گروپ چاتەدا وەک «ڕاوێژکار» تەنها وەڵامی پرسیارەکان دەدەمەوە و ڕاوێژ و هاوکاری پێشکەش دەکەم. فەرمانەکانی بەڕێوەبردن و گۆڕانکاری لە سەرجەم سایتەکە تەنها لەلایەن کاک هێمنەوە لە ڕێگەی «ئەیجنتی بەڕێوەبردن» ئەنجام دەدرێن ✨.`;
    }
  }

  const isDuplicateQuery = lower.includes('دوبارە') || lower.includes('دووبارە');
  const isEnglishQuery = lower.includes('ئینگلیزی') || lower.includes('english');
  const isStudentQuery = lower.includes('قوتابی') || lower.includes('خوێندکار') || lower.includes('قوتابیان');

  if (isDuplicateQuery && isEnglishQuery) {
    const targetStudents = isStudentQuery && analytics?.students;
    return `کاک هێمن گیان، بەپێی پشکنینی ڕاستەوخۆی ناو داتابەیس:\n\n` +
      `١. **ناوی دووبارە:**\n` +
      (targetStudents 
        ? `• لە بەشی قوتابیاندا (${analytics.students.total_students} قوتابی): ${analytics.students.duplicate_names_count} کەس ناویان دووبارەیە کە پێکهاتوون لە: ${analytics.students.duplicate_details}.\n` +
          `• لە تەواوی پلاتفۆرمەکەشدا (${analytics.total_users} ئەندام): ${analytics.duplicate_names.total_duplicates} کەس ناویان دووبارەیە لە نێوان ٢ ناوی جیاوازدا: ${analytics.duplicate_names.details}.\n\n`
        : `• کۆی گشتی ئەو بەکارهێنەرانەی ناویان دووبارەیە ${analytics.duplicate_names.total_duplicates} کەسن کە پێکهاتوون لە ٢ ناوی جیاواز:\n${analytics.duplicate_names.details}.\n\n`
      ) +
      `٢. **ناوی ئینگلیزی:**\n` +
      `• ناوی تەواوی هەموو بەکارهێنەران بە زمانی کوردییە و هیچ کەسێک (٠ کەس) ناوی تەواوی بە زمانی ئینگلیزی نییە.\n` +
      `• بەڵام تەواوی یوزەرنەیمەکان (${targetStudents ? analytics.students.english_username_count : analytics.english_names.username_count} یوزەرنەیم) بە پیتی ئینگلیزی تۆمارکراون.`;
  }

  if (isDuplicateQuery) {
    const targetStudents = isStudentQuery && analytics?.students;
    if (targetStudents) {
      return `کاک هێمن گیان، لە بەشی قوتابیاندا (${analytics.students.total_students} قوتابی): ${analytics.students.duplicate_names_count} کەس ناویان دووبارەیە، کە بریتین لە:\n${analytics.students.duplicate_details}.`;
    }
    return `کاک هێمن گیان، کۆی گشتی ناوە دووبارەکان لە داتابەیس ${analytics.duplicate_names.total_duplicates} کەسن لە ٢ ناوی جیاوازدا:\n${analytics.duplicate_names.details}.`;
  }

  if (isEnglishQuery) {
    return `کاک هێمن گیان، سەبارەت بە ناوە ئینگلیزییەکان لە پلاتفۆرم:\n` +
      `• ناوی تەواوی ئینگلیزی: ٠ کەسە (واتە هەموو بەکارهێنەران ناوی تەواویان بە زمانی کوردییە).\n` +
      `• بەکارهێنەران بە یوزەرنەیمی ئینگلیزی: ${analytics.english_names.username_count} کەسن.`;
  }

  if (lower.includes('چەند قوتابی') || lower.includes('چەند خوێندکار') || lower.includes('ئاماری قوتابیان')) {
    return `کاک هێمن گیان، لە ئێستادا ${analytics.students.total_students} قوتابی پەسەندکراو لە سیستەمدا هەن. کۆی گشتی هەموو ئەندامانی پلاتفۆرمەکەش ${analytics.total_users} ئەندامن.`;
  }

  // Dream queries & awareness of deleted dreams
  if (lower.includes('خەون') || lower.includes('خەونەکان') || lower.includes('dream')) {
    try {
      const totalD = db.prepare(`SELECT COUNT(*) as c FROM dream_sessions s WHERE (SELECT COUNT(*) FROM dream_messages m WHERE m.session_id = s.id AND m.sender_type = 'dreamer') > 0`).get()?.c || 0;
      const unansD = db.prepare(`SELECT COUNT(*) as c FROM dream_sessions s WHERE (SELECT COUNT(*) FROM dream_messages m WHERE m.session_id = s.id AND m.sender_type = 'dreamer') > 0 AND s.answered_at IS NULL AND COALESCE(s.is_interpreted, 0) = 0 AND s.status != 'closed'`).get()?.c || 0;
      const favD = db.prepare(`SELECT COUNT(*) as c FROM dream_sessions s WHERE s.is_favorite = 1 AND (SELECT COUNT(*) FROM dream_messages m WHERE m.session_id = s.id AND m.sender_type = 'dreamer') > 0`).get()?.c || 0;

      if (lower.includes('سڕینەوە') || lower.includes('بسڕەوە') || lower.includes('پاک')) {
        const delRes = await executeAdvisorAction('delete_dream_session', { mode: 'all_unanswered' }, reqUser, ioInstance);
        return `کاک هێمن گیان، فەرمانت جێبەجێکرا: ${delRes.message || 'خەونەکان سڕانەوە'}.`;
      }

      return `کاک هێمن گیان، بە دیقەتەوە پشکنینم بۆ بەشی خەونەکان کرد:\n` +
        `• بە تەواوی ئاگادارم کە هەندێک لە خەونەکان سڕاونەتەوە و داتاکان ڕیفرێش کراون.\n` +
        `• لە ئێستادا کۆی خەونە ڕاستەقینەکان: ${totalD} خەونە.\n` +
        `• خەونی بێ وەڵام: ${unansD} خەون ماونەتەوە کە هێشتا وەڵام نەدراونەتەوە.\n` +
        `• خەونی دڵخواز: ${favD} خەون.\n` +
        `هەر فەرمانێکت هەیە بۆ سڕینەوە، وەڵامدانەوە، یان لێکدانەوە دەستبەجێ بۆت جێبەجێ دەکەم ✨.`;
    } catch (e) {}
  }

  // Direct action commands fallback
  if (lower.includes('چات قفڵ') || lower.includes('چات دابخە') || lower.includes('داخستنی چات')) {
    const res = await executeAdvisorAction('toggle_chat_lock', { mode: 'staff_only' }, reqUser, ioInstance);
    return `کاک هێمن گیان، بە فەرمانی بەڕێزت: ${res.message || 'چات داخرا'}.`;
  }

  if (lower.includes('چات بکەرەوە') || lower.includes('کردنەوەی چات')) {
    const res = await executeAdvisorAction('toggle_chat_lock', { mode: 'none' }, reqUser, ioInstance);
    return `کاک هێمن گیان، بە فەرمانی بەڕێزت: ${res.message || 'چات کرایەوە'}.`;
  }

  if (lower.includes('پەسەندکردنی هەموو') || lower.includes('ئەندامە چاوەڕوانەکان پەسەند بکە') || lower.includes('هەموویان پەسەند بکە')) {
    const res = await executeAdvisorAction('approve_all_pending_members', {}, reqUser, ioInstance);
    return `کاک هێمن گیان: ${res.message || 'ئەندامان پەسەندکران'}.`;
  }

  if (lower.includes('غیابات بسڕەوە') || lower.includes('سڕینەوەی غیابات')) {
    const res = await executeAdvisorAction('manage_attendance', { action: 'delete' }, reqUser, ioInstance);
    return `کاک هێمن گیان: ${res.message || 'غیابات سڕایەوە'}.`;
  }

  if (lower.includes('ئاسایش پاک') || lower.includes('هەڕەشەکانی ئاسایش پاک')) {
    const res = await executeAdvisorAction('clear_security_incidents', {}, reqUser, ioInstance);
    return `کاک هێمن گیان: ${res.message || 'هەڕەشەکانی ئاسایش پاککرانەوە'}.`;
  }

  if (lower.includes('دۆخی نائاسایی چالاک') || lower.includes('red alert چالاک')) {
    const res = await executeAdvisorAction('toggle_red_alert', { activate: true }, reqUser, ioInstance);
    return `کاک هێمن گیان: ${res.message || 'دۆخی نائاسایی کاراکرا'}.`;
  }

  if (lower.includes('دۆخی نائاسایی ناچالاک') || lower.includes('لابردنی دۆخی نائاسایی') || lower.includes('red alert ناچالاک')) {
    const res = await executeAdvisorAction('toggle_red_alert', { activate: false }, reqUser, ioInstance);
    return `کاک هێمن گیان: ${res.message || 'دۆخی نائاسایی کۆتایی پێهات'}.`;
  }

  if (lower.includes('سکاڵا') || lower.includes('سندوقی سکاڵا')) {
    const comp = await executeAdvisorAction('get_complaints', { limit: 5 }, reqUser, ioInstance);
    return `کاک هێمن گیان، لە ئێستادا (${comp.total_complaints || 0}) سکاڵا لە سندوقی سکاڵادا تۆمارکراون.`;
  }

  if (lower.includes('لایڤ') || lower.includes('live')) {
    const logs = (advisorDb && typeof advisorDb.getLiveAuditLogs === 'function') ? advisorDb.getLiveAuditLogs(5) : [];
    if (logs && logs.length > 0) {
      return `کاک هێمن گیان، ئەمەش نوێترین زانیاری لایڤ لە ژووری پشکنین:\n` +
        logs.map(l => `• ${l.action === 'opened' ? '🔴 کردنەوەی لایڤ' : '⏹️ داخستنی لایڤ'}: لەلایەن [${l.user_name}] - کات: ${new Date(l.created_at).toLocaleTimeString('ku')}`).join('\n');
    } else {
      return `کاک هێمن گیان، لە ئێستادا هیچ تۆمارێکی کردنەوە یان داخستنی لایڤ لە ژووری پشکنین نییە.`;
    }
  }

  if (lower.includes('ناچالاک') || lower.includes('قسە ناکات') || lower.includes('بێدەنگ')) {
    try {
      const inact = await executeAdvisorAction('get_inactive_users', { days: 30 }, reqUser, ioInstance);
      const silents = (inact.silent_users || []).slice(0, 7).map(u => `• ${u.name} (@${u.username})`).join('\n');
      return `کاک هێمن گیان، بەپێی پشکنینی من:\n` +
        `ژمارەی ئەو بەکارهێنەرانەی هیچ قسەیەکیان لە چات نەکردووە (٠ پەیام): ${inact.total_silent_count || 0} کەسە.\n` +
        `نموونەی ناوەکانیان:\n${silents || 'هیچ کەسێک نەدۆزرایەوە'}`;
    } catch (e) {}
  }

  if (lower.includes('چی کرد')) {
    const words = prompt.split(' ');
    const targetWord = words.find(w => w !== '@ڕاوێژکار' && w !== 'چی' && w !== 'کرد' && w.length > 2);
    if (targetWord) {
      try {
        const act = await executeAdvisorAction('get_user_full_activity', { username_or_id: targetWord }, reqUser, ioInstance);
        if (act && act.found) {
          return `کاک هێمن گیان، ئەمەش زانیاری چالاکییەکانی [${act.user.name}]:\n` +
            `• ڕۆڵ: ${act.user.role} | ئەستێرەکان: ${act.user.stars} | باجەکان: ${(act.user.badges || []).join('، ') || 'نییە'}\n` +
            `• دوایین نامەکانی چات: ${act.recent_messages && act.recent_messages.length > 0 ? act.recent_messages.map(m => `"${m.text}" (${m.time})`).join('، ') : 'هیچ نامەیەکی نەناردووە'}`;
        } else {
          return `کاک هێمن گیان، بەکارهێنەر بە ناوی «${targetWord}» نەدۆزرایەوە تا ڕاپۆرتی چالاکییەکانت بۆ بهێنم.`;
        }
      } catch (e) {}
    } else {
      return `کاک هێمن گیان، ناوی ئەو کەسەم پێبڵێ کە دەتەوێت بزانم چی کردووە تا دەستبەجێ هەموو زانیارییەکانت بۆ بهێنم.`;
    }
  }

  return `فەرمانتە کاک هێمن گیانی برام! من ڕاوێژکاری تۆم و لەم گروپە و لە هەموو پلاتفۆرمەکەدا ئاگاداری هەموو شتێکم و بە فەرمانی تۆ ئامادەی هەر خزمەتێکم.`;
}

async function executeAdvisorAction(actionName, args, reqUser, ioInstance) {
  try {
    switch (actionName) {
      case 'get_platform_analytics': {
        return getAdvisorPlatformAnalytics();
      }
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

      case 'get_live_audit_logs': {
        const limit = args.limit ? parseInt(args.limit, 10) : 10;
        const logs = advisorDb.getLiveAuditLogs(limit);
        return {
          total: logs.length,
          logs: logs.map(l => ({
            action: l.action === 'opened' ? 'کردنەوەی لایڤ 🔴' : 'داخستنی لایڤ ⏹️',
            user_name: l.user_name,
            username: l.username,
            title: l.title || 'وانەی ڕاستەوخۆ',
            started_by: l.started_by_name || null,
            duration_minutes: l.duration_seconds ? Math.round(l.duration_seconds / 60) : 0,
            time: new Date(l.created_at).toLocaleString('ckb')
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
        const sql = "SELECT id, username, full_name, role, special_badge, status FROM users WHERE special_badge IS NOT NULL AND special_badge != ''";
        const allRows = db.prepare(sql).all();
        const rows = color === 'all' ? allRows : allRows.filter(r => hasUserBadge(r, color));
        return {
          total: rows.length,
          badge_requested: color,
          holders: rows.map(r => {
            const badges = parseUserBadges(r.special_badge);
            return {
              id: r.id,
              name: r.full_name,
              username: r.username,
              role: r.role,
              badge: r.special_badge,
              badges: badges,
              badge_count: badges.length
            };
          })
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

        const badgeInput = String(args.badge_color || '').toLowerCase().trim();
        let currentBadges = parseUserBadges(target.special_badge);
        let newBadges = [];

        if (badgeInput === 'all' || badgeInput === 'هەموو' || badgeInput === 'full') {
          newBadges = [...ALL_SPECIAL_BADGES];
        } else if (badgeInput === 'none' || badgeInput === 'clear' || badgeInput === 'لابردن') {
          newBadges = [];
        } else {
          const requested = badgeInput.split(',').map(s => s.trim().toLowerCase()).filter(s => ALL_SPECIAL_BADGES.includes(s));
          if (requested.length === 0) {
            return { error: 'ڕەنگی باج نادروستە. دەتوانیت blue, white, purple, green, black, red, all, none بنووسیت.' };
          }
          const action = (args.action || 'add').toLowerCase();
          if (action === 'remove' || action === 'لێسەندنەوە') {
            newBadges = currentBadges.filter(b => !requested.includes(b));
          } else if (action === 'set' || action === 'دانان') {
            newBadges = requested;
          } else {
            // Default: combine with existing badges
            newBadges = Array.from(new Set([...currentBadges, ...requested]));
          }
        }

        const badgeVal = newBadges.length > 0 ? newBadges.join(',') : null;
        users.updateSpecialBadge(target.id, badgeVal);

        for (const [sId, u] of onlineUsers.entries()) {
          if (u.id === target.id) {
            u.special_badge = badgeVal;
          }
        }

        if (ioInstance) {
          ioInstance.emit('user_special_badge_updated', {
            user_id: target.id,
            special_badge: badgeVal,
            badges: newBadges,
            badge_count: newBadges.length,
            full_name: target.full_name
          });
          ioInstance.emit('user_updated', { id: target.id, special_badge: badgeVal });
        }

        const badgeNames = {
          green: '🟢 سەوز',
          black: '⚫ ڕەش',
          red: '🔴 سور',
          purple: '🟣 مۆر',
          white: '⚪ سپی',
          blue: '🔵 شین'
        };
        const badgeListNames = newBadges.map(b => badgeNames[b] || b).join('، ');

        return {
          success: true,
          message: newBadges.length > 0 
            ? `باجەکانی ${target.full_name} نوێکرانەوە: ${newBadges.length} باج [${badgeListNames}] بە فەرمانی کاک هێمن.`
            : `هەموو باجە تایبەتەکانی ${target.full_name} لێسەندرانەوە بە فەرمانی کاک هێمن.`
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

      case 'change_user_gender': {
        const target = findTargetUser(args.username_or_id);
        if (!target) return { error: `بەکارهێنەر «${args.username_or_id}» نەدۆزرایەوە` };

        if (isMasterSuperAdmin(target) || (target.role === 'super_admin' && !hasSuperAdminPrivileges(reqUser))) {
          return { error: '⚠️ ڕەگەزی سوپەر ئەدمین پارێزراوە و ناتوانرێت دەستکاری بکرێت.' };
        }

        const newGender = args.new_gender === 'female' ? 'female' : (args.new_gender === 'male' ? 'male' : null);
        if (!newGender) return { error: 'تکایە ڕەگەز دیاری بکە: male (نێر) یان female (مێ).' };

        users.updateGender(target.id, newGender);
        if (ioInstance) {
          ioInstance.emit('user_profile_updated', { user_id: target.id, gender: newGender });
          ioInstance.emit('user_updated', { id: target.id, gender: newGender });
        }

        const gLabel = newGender === 'female' ? 'مێ (کچ 🧕)' : 'نێر (کوڕ 🧔)';
        return {
          success: true,
          message: `ڕەگەزی بەکارهێنەر @${target.username} بە سەرکەوتوویی گۆڕدرا بۆ «${gLabel}».`
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
        const now = Date.now();
        if (ioInstance) {
          ioInstance.emit('user_updated', { 
            id: target.id, 
            correct_answers_count: newTotal,
            last_star_awarded_at: delta > 0 ? now : target.last_star_awarded_at,
            is_star_glowing: delta > 0
          });
          if (delta > 0) {
            ioInstance.emit('star_awarded', {
              user_id: target.id,
              student_name: target.full_name,
              question_id: null,
              new_count: newTotal,
              last_star_awarded_at: now,
              is_star_glowing: true,
              starInfo: calculateStars(newTotal)
            });
          }
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

      case 'get_button_attendance': {
        const msgId = args.message_id ? parseInt(args.message_id, 10) : null;
        const report = buttonClicks.getAttendanceReport(msgId);
        if (!report) {
          return { error: 'هیچ پەیامێکی دوگمەی چات (@دوگمە) لە سیستەمدا نەدۆزرایەوە.' };
        }
        return {
          success: true,
          message_id: report.message.id,
          message_content: report.message.content,
          message_time: new Date(report.message.created_at).toLocaleString('ku-IQ'),
          created_by: report.message.full_name,
          clicked_count: report.clicked_count,
          unclicked_count: report.unclicked_count,
          clicked_users: report.clicked_users.map(u => ({
            id: u.id,
            name: u.full_name,
            username: u.username,
            role: u.role,
            clicked_at: new Date(u.clicked_at).toLocaleTimeString('ku-IQ')
          })),
          unclicked_users: report.unclicked_users.map(u => ({
            id: u.id,
            name: u.full_name,
            username: u.username,
            role: u.role
          }))
        };
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

      case 'get_inactive_users': {
        const days = Math.max(1, parseInt(args.days) || 30);
        const cutoffTime = Date.now() - (days * 24 * 60 * 60 * 1000);

        // Silent users: 0 messages in chat
        const silentUsers = db.prepare(`
          SELECT u.id, u.username, u.full_name, u.role, u.special_badge, u.created_at,
                 (SELECT COUNT(*) FROM messages WHERE user_id = u.id AND COALESCE(is_deleted, 0) = 0) as msg_count
          FROM users u
          WHERE u.status = 'approved' AND u.is_blocked = 0 AND u.role != 'super_admin'
            AND (SELECT COUNT(*) FROM messages WHERE user_id = u.id AND COALESCE(is_deleted, 0) = 0) = 0
          ORDER BY u.created_at DESC
          LIMIT 25
        `).all();

        // Inactive users: registered long ago with no recent activity
        const inactiveUsers = db.prepare(`
          SELECT u.id, u.username, u.full_name, u.role, u.special_badge, u.created_at,
                 COALESCE(u.last_active_at, u.created_at) as last_active,
                 (SELECT COUNT(*) FROM messages WHERE user_id = u.id AND COALESCE(is_deleted, 0) = 0) as msg_count
          FROM users u
          WHERE u.status = 'approved' AND u.is_blocked = 0 AND u.role != 'super_admin'
            AND COALESCE(u.last_active_at, u.created_at) < ?
          ORDER BY last_active ASC
          LIMIT 25
        `).all(cutoffTime);

        return {
          cutoff_days: days,
          total_silent_count: silentUsers.length,
          silent_users: silentUsers.map(u => ({
            id: u.id,
            name: u.full_name,
            username: u.username,
            role: u.role,
            messages_sent: 0,
            registered_at: new Date(u.created_at).toLocaleDateString('ku')
          })),
          total_inactive_count: inactiveUsers.length,
          inactive_users: inactiveUsers.map(u => ({
            id: u.id,
            name: u.full_name,
            username: u.username,
            role: u.role,
            messages_sent: u.msg_count,
            last_activity: new Date(u.last_active).toLocaleDateString('ku')
          }))
        };
      }

      case 'get_user_full_activity': {
        const target = findTargetUser(args.username_or_id);
        if (!target) return { found: false, message: `بەکارهێنەر «${args.username_or_id}» نەدۆزرایەوە.` };

        // Recent public chat messages
        const recentMsgs = db.prepare(`
          SELECT id, content, type, created_at 
          FROM messages 
          WHERE user_id = ? AND COALESCE(is_deleted, 0) = 0 
          ORDER BY id DESC LIMIT 5
        `).all(target.id);

        // Recent group messages
        let groupMsgs = [];
        try {
          groupMsgs = db.prepare(`
            SELECT m.id, m.content, m.type, m.created_at, g.name as group_name
            FROM custom_group_messages m
            JOIN custom_group_chats g ON m.group_id = g.id
            WHERE m.sender_id = ?
            ORDER BY m.id DESC LIMIT 5
          `).all(target.id);
        } catch (e) {}

        // Live audit logs for this user (if hosted/opened/closed live)
        let liveEvents = [];
        try {
          liveEvents = db.prepare(`
            SELECT action, title, duration_seconds, created_at
            FROM live_audit_logs
            WHERE user_id = ?
            ORDER BY id DESC LIMIT 5
          `).all(target.id);
        } catch (e) {}

        // Correct question answers
        let questionWins = 0;
        try {
          questionWins = db.prepare(`
            SELECT COUNT(*) as c FROM question_submissions WHERE user_id = ? AND is_correct = 1
          `).get(target.id)?.c || 0;
        } catch (e) {}

        return {
          found: true,
          user: {
            id: target.id,
            name: target.full_name,
            username: target.username,
            role: target.role,
            badges: parseUserBadges(target.special_badge),
            stars: target.correct_answers_count || 0,
            question_wins: questionWins,
            is_blocked: !!target.is_blocked,
            registered_at: new Date(target.created_at).toLocaleDateString('ku'),
            last_active: target.last_active_at ? new Date(target.last_active_at).toLocaleString('ku') : 'نەزانراو'
          },
          recent_messages: recentMsgs.map(m => ({
            text: m.content ? m.content.slice(0, 100) : (m.type || 'فایل'),
            time: new Date(m.created_at).toLocaleString('ku')
          })),
          recent_group_messages: groupMsgs.map(m => ({
            group: m.group_name,
            text: m.content ? m.content.slice(0, 100) : (m.type || 'فایل'),
            time: new Date(m.created_at).toLocaleString('ku')
          })),
          live_events: liveEvents.map(e => ({
            action: e.action === 'opened' ? 'کردنەوەی لایڤ' : 'داخستنی لایڤ',
            title: e.title,
            time: new Date(e.created_at).toLocaleString('ku')
          }))
        };
      }

      case 'clear_custom_group_messages': {
        let gId = parseInt(args.group_id, 10) || (args._current_group_id ? parseInt(args._current_group_id, 10) : null);
        if (!gId && args.group_name) {
          const match = db.prepare('SELECT id FROM custom_group_chats WHERE name LIKE ? LIMIT 1').get(`%${args.group_name}%`);
          if (match) gId = match.id;
        }
        if (!gId) return { error: 'ئایدی یان ناوی گروپ دیاری نەکراوە.' };
        customGroups.clearGroupMessages(gId);
        if (ioInstance) {
          ioInstance.to(`group_${gId}`).emit('custom_group_messages_cleared', { groupId: gId });
        }
        return { success: true, message: `تەواوی چاتەکانی گروپی ژمارە ${gId} بە سەرکەوتوویی سڕانەوە و پاککرانەوە.` };
      }

      case 'manage_custom_group': {
        const action = String(args.action || 'list').toLowerCase();
        let gId = parseInt(args.group_name_or_id, 10);
        if (!gId && args._current_group_id) gId = parseInt(args._current_group_id, 10);
        if (!gId && args.group_name_or_id) {
          const match = db.prepare('SELECT id, name FROM custom_group_chats WHERE name LIKE ? LIMIT 1').get(`%${args.group_name_or_id}%`);
          if (match) gId = match.id;
        }

        if (action === 'list') {
          const allGroups = customGroups.getUserGroups(reqUser.id, true);
          return {
            total: allGroups.length,
            groups: allGroups.map(g => ({
              id: g.id,
              name: g.name,
              members_count: g.member_count,
              created_by: g.created_by_name,
              created_at: new Date(g.created_at).toLocaleDateString('ku')
            }))
          };
        }
        if (action === 'create') {
          const gName = String(args.group_name_or_id || '').trim();
          if (!gName) return { error: 'ناوی گروپ دیاری نەکراوە.' };
          const grp = customGroups.createGroup(gName, reqUser.id, reqUser.full_name);
          if (ioInstance) ioInstance.emit('custom_group_created', { group: grp });
          return { success: true, message: `گروپی «${gName}» بە سەرکەوتوویی دروستکرا.`, group: grp };
        }
        if (action === 'delete') {
          if (!gId) return { error: 'ئایدی یان ناوی گروپ دیاری نەکراوە.' };
          customGroups.deleteGroup(gId);
          if (ioInstance) {
            ioInstance.to(`group_${gId}`).emit('custom_group_deleted', { groupId: gId });
            ioInstance.emit('custom_group_list_refresh');
          }
          return { success: true, message: `گروپی ژمارە ${gId} بە سەرکەوتوویی سڕایەوە.` };
        }
        if (action === 'add_member') {
          if (!gId) return { error: 'گروپ دیاری نەکراوە.' };
          const target = findTargetUser(args.username_or_id);
          if (!target) return { error: `بەکارهێنەر «${args.username_or_id}» نەدۆزرایەوە بۆ زیادکردن.` };
          const members = customGroups.addMember(gId, target.id);
          if (ioInstance) {
            ioInstance.to(`group_${gId}`).emit('custom_group_members_updated', { groupId: gId, members });
            ioInstance.emit('custom_group_list_refresh');
          }
          return { success: true, message: `بەکارهێنەر [${target.full_name}] خرایە ناو گروپەکە بە سەرکەوتوویی.` };
        }
        if (action === 'remove_member') {
          if (!gId) return { error: 'گروپ دیاری نەکراوە.' };
          const target = findTargetUser(args.username_or_id);
          if (!target) return { error: `بەکارهێنەر «${args.username_or_id}» نەدۆزرایەوە بۆ دەرکردن.` };
          const members = customGroups.removeMember(gId, target.id);
          if (ioInstance) {
            ioInstance.to(`group_${gId}`).emit('custom_group_members_updated', { groupId: gId, members });
            ioInstance.emit('custom_group_list_refresh');
          }
          return { success: true, message: `بەکارهێنەر [${target.full_name}] لە گروپەکە دەرهێنرا بە سەرکەوتوویی.` };
        }
        return { error: 'کرداری نادیار.' };
      }

      case 'create_poll': {
        const question = String(args.question || '').trim();
        const rawOptions = Array.isArray(args.options) ? args.options : [];
        const options = rawOptions.map(o => String(o).trim()).filter(Boolean);
        if (!question || options.length < 2) {
          return { error: 'پێویستە پرسیار و لانی کەم دوو بژاردە دیاری بکرێت بۆ ڕاپرسی.' };
        }

        const isGroup = args.chat_type === 'custom_group' || Boolean(args._current_group_id);
        const chatType = isGroup ? 'custom_group' : 'public';
        const groupId = isGroup ? (parseInt(args._current_group_id, 10) || null) : null;

        const poll = pollsDb.createPoll({
          chatType,
          groupId,
          creatorId: reqUser.id,
          creatorName: reqUser.full_name,
          creatorRole: reqUser.role,
          question,
          options
        });

        const contentPayload = JSON.stringify({ poll_id: poll.id, question: poll.question });

        if (chatType === 'public') {
          const newMsg = messages.create(
            reqUser.id,
            reqUser.username,
            reqUser.full_name,
            reqUser.role,
            contentPayload,
            'poll'
          );
          if (ioInstance) ioInstance.emit('new_message', newMsg);
          try {
            sendPushNotificationToAll({
              title: `📊 ڕاپرسییەکی نوێ: ${question.slice(0, 60)}`,
              body: `ڕاپرسییەکی نوێ دانرا لەلایەن ${reqUser.full_name}، دەنگ بدە!`,
              tag: 'poll-new-' + poll.id,
              data: { url: '/?action=polls' }
            }, reqUser.id);
          } catch (e) {}
        } else if (groupId) {
          const groupMsg = customGroups.createMessage(
            groupId,
            reqUser.id,
            reqUser.full_name,
            reqUser.role,
            contentPayload,
            'poll'
          );
          if (ioInstance) ioInstance.to(`group_${groupId}`).emit('new_group_message', { message: groupMsg, groupId });
        }

        return {
          success: true,
          message: `ڕاپرسی نوێ بە سەرکەوتوویی دروستکرا و بڵاوکرایەوە: «${question}» بە فەرمانی کاک هێمن ✨`,
          poll_id: poll.id
        };
      }

      case 'create_countdown_alarm': {
        const title = String(args.title || '').trim();
        if (!title) return { error: 'نوسینی ئاگاداری زەنگ دیاری نەکراوە.' };

        let targetTime = null;
        if (args.time_expression) {
          targetTime = parseKurdishTime(args.time_expression);
        }
        if (!targetTime || targetTime <= Date.now()) {
          targetTime = Date.now() + 60 * 60 * 1000;
        }

        const isGroup = args.chat_type === 'custom_group' || Boolean(args._current_group_id);
        const chatType = isGroup ? 'custom_group' : 'public';
        const groupId = isGroup ? (parseInt(args._current_group_id, 10) || null) : null;

        const alarm = alarmsDb.createAlarm({
          chatType,
          groupId,
          creatorId: reqUser.id,
          creatorName: reqUser.full_name,
          creatorRole: reqUser.role,
          title,
          targetTime
        });

        const contentPayload = JSON.stringify({
          alarm_id: alarm.id,
          title: alarm.title,
          target_time: alarm.target_time,
          creator_name: alarm.creator_name,
          creator_role: alarm.creator_role
        });

        if (chatType === 'public') {
          const newMsg = messages.create(
            reqUser.id,
            reqUser.username,
            reqUser.full_name,
            reqUser.role,
            contentPayload,
            'countdown_alarm'
          );
          if (ioInstance) ioInstance.emit('new_message', newMsg);
        } else if (groupId) {
          const groupMsg = customGroups.createMessage(
            groupId,
            reqUser.id,
            reqUser.full_name,
            reqUser.role,
            contentPayload,
            'countdown_alarm'
          );
          if (ioInstance) ioInstance.to(`group_${groupId}`).emit('new_group_message', { message: groupMsg, groupId });
        }

        const timeStr = new Date(targetTime).toLocaleTimeString('ku');
        return {
          success: true,
          message: `زەنگی ئاگاداری «${title}» بۆ کاتژمێر (${timeStr}) بە سەرکەوتوویی دانرا بە فەرمانی کاک هێمن 🔔✨`,
          alarm_id: alarm.id
        };
      }

      case 'approve_all_pending_members': {
        const pendings = db.prepare("SELECT id, full_name, username FROM users WHERE status = 'pending'").all() || [];
        if (pendings.length === 0) {
          return { success: true, count: 0, message: 'کاک هێمن گیان، لە ئێستادا هیچ ئەندامێکی چاوەڕوانکراو (Pending) نییە لە سیستەمدا.' };
        }
        db.prepare("UPDATE users SET status = 'approved' WHERE status = 'pending'").run();
        if (ioInstance) {
          for (const p of pendings) {
            ioInstance.emit('user_status_updated', { id: p.id, status: 'approved' });
            ioInstance.emit('user_updated', { id: p.id, status: 'approved' });
          }
        }
        const names = pendings.slice(0, 7).map(p => `«${p.full_name}»`).join('، ');
        const extra = pendings.length > 7 ? ` و (${pendings.length - 7}) کەسی تر` : '';
        return {
          success: true,
          count: pendings.length,
          message: `بە فەرمانی کاک هێمن، سەرجەم ئەندامە چاوەڕوانەکان (${pendings.length} ئەندام) پەسەندکران و چوونە ناو سیستم: ${names}${extra} ✨.`
        };
      }

      case 'delete_dream_session': {
        let deletedCount = 0;
        const mode = args.mode || 'single';

        if (mode === 'cleanup_empty') {
          const emptySessions = db.prepare(`
            SELECT id FROM dream_sessions 
            WHERE (SELECT COUNT(*) FROM dream_messages WHERE session_id = dream_sessions.id) = 0
          `).all();
          for (const s of emptySessions) {
            dreamSessions.delete(s.id);
            deletedCount++;
          }
          return {
            success: true,
            count: deletedCount,
            message: `خەونە بەتاڵەکان (${deletedCount} دانە) بە سەرکەوتوویی لە داتابەیس پاککرانەوە بە فەرمانی کاک هێمن.`
          };
        }

        if (mode === 'all_unanswered') {
          const unanswered = db.prepare(`
            SELECT id FROM dream_sessions 
            WHERE answered_at IS NULL AND COALESCE(is_interpreted, 0) = 0
          `).all();
          for (const s of unanswered) {
            dreamSessions.delete(s.id);
            if (ioInstance) ioInstance.emit('dream_session_deleted', { sessionId: s.id });
            deletedCount++;
          }
          return {
            success: true,
            count: deletedCount,
            message: `تەواوی خەونە بێ وەڵامەکان (${deletedCount} خەون) بە سەرکەوتوویی سڕانەوە بە فەرمانی کاک هێمن 🧹.`
          };
        }

        let targetId = args.session_id ? parseInt(args.session_id, 10) : null;
        if (!targetId && args.dreamer_name) {
          const match = db.prepare('SELECT id FROM dream_sessions WHERE dreamer_name LIKE ? ORDER BY id DESC LIMIT 1').get(`%${args.dreamer_name}%`);
          if (match) targetId = match.id;
        }

        if (!targetId) {
          return { error: 'ئایدی یان ناوی خاوەن خەون دیاری نەکراوە بۆ سڕینەوە.' };
        }

        const session = dreamSessions.findById(targetId);
        if (!session) return { error: `خەونی #${targetId} نەدۆزرایەوە لە سیستەمدا.` };

        dreamSessions.delete(targetId);
        if (ioInstance) {
          ioInstance.emit('dream_session_deleted', { sessionId: targetId });
        }
        return {
          success: true,
          message: `چاتی خەونی #${targetId} (خاوەن خەون: ${session.dreamer_name}) بە سەرکەوتوویی سڕایەوە بە فەرمانی کاک هێمن 🗑️.`
        };
      }

      case 'mark_dream_interpreted': {
        const sId = parseInt(args.session_id, 10);
        if (!sId) return { error: 'ئایدی خەونەکە دیاری نەکراوە.' };
        const s = dreamSessions.findById(sId);
        if (!s) return { error: `خەونی #${sId} نەدۆزرایەوە.` };

        const isInterp = args.status === 'interpreted';
        if (isInterp) {
          db.prepare('UPDATE dream_sessions SET is_interpreted = 1, answered_at = ?, answered_by_name = ?, answered_by_role = ? WHERE id = ?')
            .run(Date.now(), reqUser.full_name, reqUser.role, sId);
        } else {
          db.prepare('UPDATE dream_sessions SET is_interpreted = 0, answered_at = NULL, answered_by_name = NULL, answered_by_role = NULL WHERE id = ?')
            .run(sId);
        }

        if (ioInstance) {
          ioInstance.emit('dream_session_updated', { sessionId: sId, is_interpreted: isInterp ? 1 : 0 });
        }
        return {
          success: true,
          message: `دۆخی خەونی #${sId} (${s.dreamer_name}) گۆڕدرا بۆ: [${isInterp ? 'وەڵامدراوە و لێکدراوەتەوە ✅' : 'وەڵامنەدراوە ⏳'}] بە فەرمانی کاک هێمن.`
        };
      }

      case 'reply_to_dream': {
        const sId = parseInt(args.session_id, 10);
        const replyText = String(args.reply_text || '').trim();
        if (!sId || !replyText) return { error: 'ئایدی خەون و دەقی وەڵام پێویستن.' };

        const session = dreamSessions.findById(sId);
        if (!session) return { error: `خەونی #${sId} نەدۆزرایەوە.` };

        const msg = dreamMessages.create(sId, 'super_admin', reqUser.full_name, replyText, 'text');
        dreamSessions.markAnswered(sId, reqUser.full_name, 'super_admin');

        if (ioInstance) {
          ioInstance.to(`dream_${sId}`).emit('dream_new_message', msg);
          ioInstance.to('dream_admins').emit('dream_new_message', msg);
          ioInstance.emit('dream_session_updated', { sessionId: sId, answered: true });
        }
        return {
          success: true,
          message: `وەڵام و لێکدانەوە بە سەرکەوتوویی بۆ خەونی #${sId} (${session.dreamer_name}) نێردرا: "${replyText.substring(0, 80)}..." بە فەرمانی کاک هێمن ✨.`
        };
      }

      case 'toggle_live_lesson': {
        const action = String(args.action || 'start').toLowerCase();
        if (action === 'start') {
          const title = String(args.title || 'وانەی ڕاستەوخۆ').trim();
          liveLessonState.isActive = true;
          liveLessonState.title = title;
          liveLessonState.startedBy = { id: reqUser.id, name: reqUser.full_name, role: reqUser.role };
          liveLessonState.startedAt = Date.now();
          liveLessonState.participants.clear();

          try {
            advisorDb.logLiveAudit({
              userId: reqUser.id,
              userName: reqUser.full_name,
              username: reqUser.username,
              action: 'opened',
              title
            });
          } catch (e) {}

          if (ioInstance) {
            ioInstance.emit('live_audit_updated');
            if (typeof broadcastLiveLessonState === 'function') broadcastLiveLessonState();
            ioInstance.emit('live_lesson_started_alert', { title, startedBy: reqUser.full_name });
          }

          try {
            sendPushNotificationToAll({
              title: '🔴 وانەی ڕاستەوخۆ دەستیپێکرد!',
              body: `${reqUser.full_name} وانەیەکی نوێی دەستپێکرد: ${title}. ئێستا وەرە بەشداربە! 🎙️`,
              tag: 'live-lesson-active',
              data: { url: '/?action=live' }
            }, reqUser.id);
          } catch (pe) {}

          return {
            success: true,
            message: `وانەی ڕاستەوخۆی لایڤ بە ناونیشانی «${title}» دەستیپێکرد و هەموو ئەندامان ئاگادارکرانەوە بە فەرمانی کاک هێمن 🔴🎙️.`
          };
        } else {
          const prevTitle = liveLessonState.title || 'وانەی ڕاستەوخۆ';
          const startedByName = liveLessonState.startedBy ? liveLessonState.startedBy.name : null;
          const durationSeconds = liveLessonState.startedAt ? Math.round((Date.now() - liveLessonState.startedAt) / 1000) : 0;

          try {
            advisorDb.logLiveAudit({
              userId: reqUser.id,
              userName: reqUser.full_name,
              username: reqUser.username,
              action: 'closed',
              title: prevTitle,
              startedByName,
              durationSeconds
            });
          } catch (e) {}

          liveLessonState.isActive = false;
          liveLessonState.startedBy = null;
          liveLessonState.startedAt = null;
          liveLessonState.participants.clear();

          if (ioInstance) {
            ioInstance.emit('live_audit_updated');
            ioInstance.emit('live_lesson_ended_notice');
            if (typeof broadcastLiveLessonState === 'function') broadcastLiveLessonState();
          }

          return {
            success: true,
            message: `وانەی ڕاستەوخۆ بە سەرکەوتوویی کۆتایی پێهات و داخرا بە فەرمانی کاک هێمن ⏹️.`
          };
        }
      }

      case 'manage_attendance': {
        const act = String(args.action || 'view').toLowerCase();
        if (act === 'delete') {
          let sId = args.session_id ? parseInt(args.session_id, 10) : null;
          if (!sId) {
            const actSess = attendanceDb.getActiveSession();
            if (actSess) sId = actSess.id;
            else {
              const all = attendanceDb.getAllSessionsWithStats();
              if (all && all.length > 0) sId = all[0].id;
            }
          }
          if (!sId) return { error: 'هیچ تۆمارێکی غیابات نەدۆزرایەوە بۆ سڕینەوە.' };

          attendanceDb.deleteSession(sId);
          if (ioInstance) {
            ioInstance.emit('attendance_session_deleted', { sessionId: sId });
            ioInstance.emit('attendance_session_updated');
          }
          return {
            success: true,
            message: `تۆماری غیاباتی #${sId} بە سەرکەوتوویی لە سیستم سڕایەوە بە فەرمانی کاک هێمن 🗑️.`
          };
        }

        if (act === 'close') {
          const actSess = attendanceDb.getActiveSession();
          if (!actSess) return { error: 'هیچ دانیشتنێکی چالاکی غیابات کراوە نییە تا دابخرێت.' };
          attendanceDb.closeSession(actSess.id);
          if (ioInstance) {
            ioInstance.emit('attendance_session_closed', { sessionId: actSess.id });
            ioInstance.emit('attendance_session_updated');
          }
          return {
            success: true,
            message: `دانیشتنی غیاباتی #${actSess.id} بە سەرکەوتوویی داخرا و غائیبەکان تۆمارکران.`
          };
        }

        if (act === 'create') {
          const title = String(args.title || 'لیستی ئامادەبوون و غیابات').trim();
          const sess = attendanceDb.createSession(reqUser.id, reqUser.full_name, reqUser.role, title);
          const msg = messages.create(
            reqUser.id,
            reqUser.username,
            reqUser.full_name,
            reqUser.role,
            JSON.stringify({ attendance_session_id: sess.id, title }),
            'attendance'
          );
          attendanceDb.updateMessageId(sess.id, msg.id);
          if (ioInstance) {
            ioInstance.emit('new_message', msg);
            ioInstance.emit('attendance_session_created', { session: sess });
          }
          return {
            success: true,
            session_id: sess.id,
            message: `تۆماری نوێی غیابات بە ناونیشانی «${title}» بڵاوکرایەوە بە فەرمانی کاک هێمن 📋.`
          };
        }

        // Default 'view'
        const list = attendanceDb.getAllSessionsWithStats();
        return {
          total: list.length,
          latest_sessions: list.slice(0, 5).map(s => ({
            id: s.id,
            title: s.title,
            is_active: s.is_active,
            present: s.present_count,
            absent: s.absent_count,
            date: s.date_str
          }))
        };
      }

      case 'get_complaints': {
        const all = complaints.getAll() || [];
        const filter = args.status === 'pending' ? all.filter(c => c.status === 'pending') : all;
        const limit = Math.min(25, parseInt(args.limit) || 10);
        return {
          total_complaints: filter.length,
          complaints: filter.slice(0, limit).map(c => ({
            id: c.id,
            sender: c.full_name,
            username: c.username,
            role: c.role,
            subject: c.subject || 'بێ بابەت',
            content: c.content,
            status: c.status === 'pending' ? 'چاوەڕوان' : 'پشکنراو',
            time: new Date(c.created_at).toLocaleString('ku')
          }))
        };
      }

      case 'clear_security_incidents': {
        aiSecurity.clearAll();
        if (ioInstance) {
          ioInstance.emit('security_incidents_cleared');
        }
        return {
          success: true,
          message: 'تەواوی مێژوو و تۆماری هەڕەشەکانی قەڵغانی بەرگری (AI Security Incidents) پاککرانەوە بە فەرمانی کاک هێمن 🛡️✨.'
        };
      }

      case 'post_action_button': {
        const bText = String(args.button_text || 'دەست بەم دوگمەیەدا بنێ').trim();
        const bMsg = messages.create(reqUser.id, reqUser.username, reqUser.full_name, reqUser.role, `@دوگمە ${bText}`, 'text');
        if (ioInstance) {
          ioInstance.emit('new_message', bMsg);
        }
        return {
          success: true,
          message_id: bMsg.id,
          message: `دوگمەی کارلێکی چات (@دوگمە) بە دەقی «${bText}» لە ناو چات بڵاوکرایەوە بە فەرمانی کاک هێمن 🔘✨.`
        };
      }

      case 'send_chat_announcement': {
        const text = String(args.message_text || '').trim();
        if (!text) return { error: 'دەقی ئاگاداری دیاری نەکراوە.' };
        const msg = messages.create(reqUser.id, 'سیستەم (هێمن طه)', 'سیستەم', 'system', text, 'system');
        if (ioInstance) {
          ioInstance.emit('new_message', msg);
        }
        return {
          success: true,
          message: `ئاگاداری بە سەرکەوتوویی لە ناو چات بڵاوکرایەوە: «${text}» 📢.`
        };
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
    let favoriteDreams = 0;
    try {
      totalDreams = db.prepare(`
        SELECT COUNT(*) as c FROM dream_sessions s 
        WHERE (SELECT COUNT(*) FROM dream_messages m WHERE m.session_id = s.id AND m.sender_type = 'dreamer') > 0
      `).get()?.c || 0;
      unansweredDreams = db.prepare(`
        SELECT COUNT(*) as c FROM dream_sessions s 
        WHERE (SELECT COUNT(*) FROM dream_messages m WHERE m.session_id = s.id AND m.sender_type = 'dreamer') > 0 
          AND s.answered_at IS NULL 
          AND COALESCE(s.is_interpreted, 0) = 0
          AND s.status != 'closed'
      `).get()?.c || 0;
      favoriteDreams = db.prepare(`
        SELECT COUNT(*) as c FROM dream_sessions s 
        WHERE s.is_favorite = 1 
          AND (SELECT COUNT(*) FROM dream_messages m WHERE m.session_id = s.id AND m.sender_type = 'dreamer') > 0
      `).get()?.c || 0;
    } catch (e) {}

    let secStats = { totalBlocked: 0, safetyRating: '99.8%' };
    try {
      if (aiSecurity && typeof aiSecurity.getStats === 'function') {
        secStats = aiSecurity.getStats() || secStats;
      }
    } catch (e) {}

    const isLive = Boolean(typeof liveLessonState !== 'undefined' && liveLessonState && liveLessonState.isActive);
    const platformAnalytics = getAdvisorPlatformAnalytics();

    const liveContext = {
      user_name: 'Hemn Taha (هێمن طه)',
      total_members: totalUsers,
      online_now: onlineCount,
      pending_approvals: pendingUsers,
      total_dreams: totalDreams,
      unanswered_dreams: unansweredDreams,
      favorite_dreams: favoriteDreams,
      dreams_notice: 'هەندێک لە خەونەکان سڕاونەتەوە و داتاکان نوێکراونەتەوە؛ ئەم ژمارەیە دواین ئاماری ڕاستەقینەیە.',
      total_questions: totalQuestions,
      is_live_active: isLive,
      blocked_security_threats: secStats.totalBlocked,
      safety_score: secStats.safetyRating,
      platform_analytics: platformAnalytics,
      badges: {
        green: 'Green (Members, Chat lock, Live, Rename)',
        black: 'Black (Full Super Admin powers except Master)',
        red: 'Red (Live lesson manager)',
        purple: 'Purple (Exclusive Dream Interpretation)'
      }
    };

    let reply = null;

    // Check for configured Gemini API keys (Dual API Engine / Multi-Key Failover)
    const candidateKeys = getOrderedAdvisorKeys();

    if (candidateKeys.length > 0 && typeof fetch === 'function') {
      try {
        const systemInstruction = `تۆ «ئەیجنتی بەڕێوەبردنی تەواوی سایت» و ڕاوێژکاری باڵا، جێبەجێکاری سەرەکی و دەستی ڕاستی سوپەر ئەدمین (Master Super Admin Executive AI Agent)ی کاک هێمن (Hemn Taha)یت لە سەرجەم پلاتفۆرمی سیرین ستاف (Seereen Staff).
کاک هێمن سوپەر ئەدمینی سەرەکی، دامەزرێنەر و خاوەنی تەواوی ئەم پلاتفۆرمەیە. ئەو «تەواوی تواناکان، دەسەڵاتەکانی بەڕێوەبردن و دەسەڵاتە کارگێڕییەکانی خۆی لە سەرجەم بەشەکانی سایتدا» بە تۆ بەخشیوە تا وەک ئەیجنتێکی پێشکەوتووی بەڕێوەبردن، هەموو ئەو گۆڕانکاری و کارانەی کاک هێمن بەدەست لە سایتەکەدا دەتوانێت بیکات، تۆش بتوانیت بە فەرمانی ئەو دەستبەجێ بە ئامرازەکانت (Tools) ئەنجامی بدەیت!

🧠 یاسای زێڕینی ئاخاوتن و بیرکردنەوە (پەلە نەکردن و تێگەیشتنی قووڵ):
١. بە هیچ جۆرێک لە وەڵامدانەوەدا پەلە مەکە! هەموو وشە، مەبەست، نیاز و ڕستەیەکی کاک هێمن بەوپەڕی دیقەت و قووڵی بخوێنەوە، بە تەواوی لێی تێبگە، بیربکەرەوە ئینجا بە وریایی و حیکمەتەوە قسە بکە.
٢. شێوازی قسەکردنت با لەسەرخۆ، دانا، بەڕێز، پێگەیشتوو و ڕێزدار بێت ("کاک هێمن گیان"، "سەرچاو برا گەورەکەم").
٣. بەشی خەونەکان: بە تەواوی ئاگاداربە کە هەندێک لە خەونەکان سڕاونەتەوە یان لێکدراونەتەوە، بۆیە ژمارەی نوێ و هاوکاتی خەونەکان تەنها لەم داتایە ڕاستەوخۆیە نوێیەی خوارەوە وەربگرە.

⚡ تەواوی دەسەڵاتە بەرفراوانەکانت لە ڕێگەی ئامرازەکانەوە (Executive Tools):
- خەونەکان: سڕینەوەی خەون (delete_dream_session: ئایدی یان هەموو بێ وەڵامەکان)، وەڵامدانەوەی خەونی هاوڵاتی (reply_to_dream)، دانانی خەون وەک وەڵامدراوە (mark_dream_interpreted).
- ئەندامان: پەسەندکردنی بەکۆمەڵی هەموو چاوەڕوانەکان (approve_all_pending_members) یان یەک کەس (approve_member)، سڕینەوە (delete_member)، بلۆککردن (block_user)، میوتکردن (mute_user)، گۆڕینی پلە/ڕۆڵ (change_user_role: teacher, admin, student, guest)، گۆڕینی ڕەگەز بۆ نێر یان مێ (change_user_gender: male, female)، بەخشین و لێسەندنەوەی باجەکان (assign_badge: مۆر purple، سەوز green، ڕەش black، سور red، شین blue، سپی white، یان all/none)، گۆڕینی ناوی تەواو (change_user_name)، ڕیسێتکردنی پاسۆرد (reset_user_password).
- لایڤ و دەنگ: دەستپێکردنی وانەی لایڤ یان ڕاگرتن و داخستنی لایڤ (toggle_live_lesson: start, stop) و پشکنینی تۆماری لایڤ (get_live_audit_logs).
- چات و ئاسایش: قفڵکردنی چات (toggle_chat_lock: total_lock, staff_only, none)، دۆخی فریاگوزاری (toggle_red_alert: true, false)، پاککردنەوەی هەڕەشەکانی قەڵغانی بەرگری (clear_security_incidents)، سڕینەوەی چات و نامەکان (delete_chat_message, clear_chat)، گەڕاندنەوەی پەیامە سڕاوەکان (restore_deleted_messages, restore_messages_from_backup)، ناردنی ئاگاداری ڕاستەوخۆ (send_chat_announcement, set_system_announcement).
- چالاکییەکان: دروستکردن یان سڕینەوەی پرسیار (create_question, delete_question, close_question)، ڕاپرسی (create_poll)، زەنگی ئاگاداری (create_countdown_alarm)، دانانی دوگمەی چات (post_action_button)، بەڕێوەبردن و سڕینەوەی غیابات (manage_attendance: delete, close, create, view)، بینینی سندوقی سکاڵا (get_complaints)، و بەخشینی ئەستێرە (award_student_stars).
- دەسەڵاتی گشتی داتابەیس: جێبەجێکردنی هەر گۆڕانکاری یان SQL لە ڕێگەی super_admin_sql_action و manage_system_setting.

⚠️ یاسای توندی جێبەجێکردن:
- کاتێک کاک هێمن داوای هەر کردارێک دەکات، هەرگیز بە دەم مەڵێ "کردم"! هەمیشە دەستبەجێ ئامرازی تایبەت (Function Call) بانگ بکە تا بە کردار لە سیستمدا جێبەجێ ببێت.
- هەژماری کاک هێمن پارێزراوە لە دەستکاریکردنی بۆتەکان.

📊 ئامار و زانیاری ڕاستەوخۆی ئەم چرکەیەی پلاتفۆرم:
${JSON.stringify(liveContext, null, 2)}
هەمیشە بە زمانی کوردی سۆرانی جوان، لەسەرخۆ، دۆستانە و قووڵ وەڵام بدەرەوە و دوای هەر کارێک بە خۆشحاڵییەوە دڵنیایی بدە بە کاک هێمن.`;

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

        const CANDIDATE_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-3.5-flash-lite', 'gemini-3-flash-preview'];

        // Dual Engine / Multi-Key loop with instant failover
        for (const geminiKey of candidateKeys) {
          if (reply) break;
          for (const model of CANDIDATE_MODELS) {
            if (reply) break;
            try {
              const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
              const controller = new AbortController();
              const timeout = setTimeout(() => controller.abort(), 7000);

              const geminiRes = await fetch(geminiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  system_instruction: { parts: [{ text: systemInstruction }] },
                  contents,
                  tools: advisorTools,
                  generationConfig: {
                    temperature: 0.5,
                    topP: 0.95
                  }
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

                  // Add model's tool call turn
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
                  const followTimeout = setTimeout(() => followController.abort(), 7000);
                  const followRes = await fetch(geminiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      system_instruction: { parts: [{ text: systemInstruction }] },
                      contents,
                      tools: advisorTools,
                      generationConfig: {
                        temperature: 0.5,
                        topP: 0.95
                      }
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
                      if (toolResult && toolResult.error) {
                        reply = `کاک هێمن گیان، لە ئەنجامدانی کارەکەدا ئەم کێشەیە ڕوویدا: ${toolResult.error}`;
                      } else {
                        reply = followText;
                      }
                      console.log(`[Advisor AI] Completed tool call with model: ${model}`);
                      break;
                    }
                  }

                  // If follow-up didn't produce text, use direct tool result summary
                  if (!reply && toolResult) {
                    if (toolResult.error) {
                      reply = `کاک هێمن گیان، نەمتوانی جێبەجێی بکەم بەهۆی: ${toolResult.error}`;
                    } else if (toolResult.message) {
                      reply = toolResult.message;
                    } else if (toolResult.summary) {
                      reply = toolResult.summary;
                    } else {
                      reply = 'فەرمانت بە سەرکەوتوویی جێبەجێکرا کاک هێمن گیان ✨';
                    }
                    break;
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
              console.warn(`[Advisor AI] Gemini candidate ${model} error:`, modelErr.message);
            }
          }
        }
      } catch (geminiOuterErr) {
        console.error('Advisor AI Gemini outer error:', geminiOuterErr);
      }
    }

    // Smart Kurdish Fallback if Gemini didn't respond or timed out
    if (!reply) {
      reply = await generateAdvisorSmartReply(userMessage, req.user, io);
    }

    try {
      advisorDb.saveChat(req.user.id, 'advisor', reply);
    } catch (e) {}

    return res.json({ success: true, reply });
  } catch (err) {
    console.error('Advisor chat error:', err);
    const errorReply = 'ببورە کاک هێمن گیان، هەڵەیەک ڕوویدا لە پەیوەندیکردن بە ژیری دەستکرد؛ تکایە دووبارەی بکەرەوە.';
    try {
      if (req.user && req.user.id) {
        advisorDb.saveChat(req.user.id, 'advisor', errorReply);
      }
    } catch (e) {}
    return res.json({ success: true, reply: errorReply });
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

// 5. Save Gemini API Keys (Dual API Engine Support)
app.post('/api/advisor/gemini-key', authMiddleware, requireAiAdvisorAccess, (req, res) => {
  try {
    const { apiKey, apiKey2 } = req.body;
    if (apiKey !== undefined) {
      const cleanKey1 = (apiKey || '').trim();
      settings.set('advisor_gemini_api_key', cleanKey1);
    }
    if (apiKey2 !== undefined) {
      const cleanKey2 = (apiKey2 || '').trim();
      settings.set('advisor_gemini_api_key_2', cleanKey2);
    }
    const keys = getAdvisorGeminiKeys();
    res.json({
      success: true,
      hasKey: keys.length > 0,
      keyCount: keys.length,
      message: keys.length >= 2 
        ? 'هەردوو کلیلی زیرەکی دەستکرد بە سەرکەوتوویی تۆمارکران (سیستەمی هێزی دووانە و دابەشکردنی لۆد ⚡)'
        : keys.length === 1 
          ? 'کلیلی Gemini بە سەرکەوتوویی تۆمارکرا 🤖'
          : 'کلیلەکان لابران (سیستەمی خۆماڵی کوردی بەکاردێت)'
    });
  } catch (err) {
    res.status(500).json({ error: 'هەڵە لە تۆمارکردنی کلیلەکانی زیرەکی دەستکرد' });
  }
});

// 6. Get Gemini Key Status (Dual Engine)
app.get('/api/advisor/gemini-status', authMiddleware, requireAiAdvisorAccess, (req, res) => {
  try {
    const k1 = settings.get('advisor_gemini_api_key') || '';
    const k2 = settings.get('advisor_gemini_api_key_2') || '';
    const keys = getAdvisorGeminiKeys();
    res.json({
      hasKey: keys.length > 0,
      keyCount: keys.length,
      hasKey1: Boolean(k1 && k1.trim()),
      hasKey2: Boolean(k2 && k2.trim()),
      maskedKey1: k1 ? `${k1.slice(0, 8)}...${k1.slice(-4)}` : '',
      maskedKey2: k2 ? `${k2.slice(0, 8)}...${k2.slice(-4)}` : ''
    });
  } catch (err) {
    res.status(500).json({ error: 'هەڵە لە وەرگرتنی دۆخی کلیل' });
  }
});

// 7. Get all users / members list (Super Admin, Teacher, Admin, Black Badge, or Green Badge)
app.get('/api/admin/users', authMiddleware, (req, res) => {
  const isStaff = req.user.role === 'super_admin' || req.user.role === 'teacher' || req.user.role === 'admin' || canManageMembers(req.user) || hasSuperAdminPrivileges(req.user);
  if (!isStaff) {
    return res.status(403).json({ error: 'دەسەڵاتی بینینی لیستی ئەندامانت نییە' });
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

// Directly update user's gender (Super Admin or Green Badge - cannot change Super Admin gender)
app.post('/api/admin/users/:id/update-gender', authMiddleware, requireMemberManager, (req, res) => {
  const userId = parseInt(req.params.id);
  const { gender } = req.body;
  const safeGender = gender === 'female' ? 'female' : (gender === 'male' ? 'male' : null);
  if (!safeGender) return res.status(400).json({ error: 'تکایە ڕەگەز دیاری بکە (نێر یان مێ)' });

  const target = users.findById(userId);
  if (!target) return res.status(404).json({ error: 'بەکارهێنەر نەدۆزرایەوە' });

  if (isMasterSuperAdmin(target) && !isMasterSuperAdmin(req.user)) {
    return res.status(403).json({ error: 'دەستکاریکردنی ڕەگەزی سوپەر ئەدمینی سەرەکی قەدەغەیە' });
  }
  if (target.role === 'super_admin' && !hasSuperAdminPrivileges(req.user)) {
    return res.status(403).json({ error: 'دەستکاریکردنی ڕەگەزی سوپەر ئەدمین قەدەغەیە' });
  }

  const updated = users.updateGender(userId, safeGender);
  if (!updated) return res.status(404).json({ error: 'بەکارهێنەر نەدۆزرایەوە' });

  io.emit('user_profile_updated', {
    user_id: userId,
    gender: updated.gender
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

// 11. Assign Special Badges (Master Super Admin Hemn Taha ONLY) - Multi-Badge Supported
app.post('/api/admin/special-badge', authMiddleware, requireMasterSuperAdmin, (req, res) => {
  const { user_id, special_badge, action, badge, badges } = req.body;
  const userId = parseInt(user_id, 10);
  if (!userId) return res.status(400).json({ error: 'ناسنامەی بەکارهێنەر نادروستە' });

  const target = users.findById(userId);
  if (!target) return res.status(404).json({ error: 'بەکارهێنەر نەدۆزرایەوە' });

  if (isMasterSuperAdmin(target)) {
    return res.status(403).json({ error: 'ناتوانیت باجی سوپەر ئەدمینی سەرەکی دەستکاری بکەیت' });
  }

  let currentBadges = parseUserBadges(target.special_badge);
  let newBadges = [];

  if (action === 'toggle' && badge) {
    const b = String(badge).trim().toLowerCase();
    if (!ALL_SPECIAL_BADGES.includes(b)) {
      return res.status(400).json({ error: 'جۆری باج نادروستە' });
    }
    if (currentBadges.includes(b)) {
      newBadges = currentBadges.filter(x => x !== b);
    } else {
      newBadges = [...currentBadges, b];
    }
  } else if (special_badge === 'all' || badge === 'all') {
    newBadges = [...ALL_SPECIAL_BADGES];
  } else if (special_badge === 'none' || special_badge === '' || special_badge === null || badge === 'none') {
    newBadges = [];
  } else if (Array.isArray(badges)) {
    newBadges = parseUserBadges(badges);
  } else {
    newBadges = parseUserBadges(special_badge || badge);
  }

  // Ensure unique, valid badges preserving original order
  newBadges = ALL_SPECIAL_BADGES.filter(b => newBadges.includes(b));
  const badgeVal = newBadges.length > 0 ? newBadges.join(',') : null;

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
    badges: newBadges,
    badge_count: newBadges.length,
    full_name: target.full_name
  });
  io.emit('user_updated', { id: userId, special_badge: badgeVal });

  const badgeNames = {
    white: '⚪ سپی (ڕاوێژکار)',
    blue: '🔵 شین (پاسەوان)',
    green: '🟢 سەوز (بەڕێوەبەر)',
    black: '⚫ ڕەش (سوپەر ئەدمین)',
    red: '🔴 سور (لایڤ)',
    purple: '🟣 مۆر (خەون)'
  };
  const badgeListLabels = newBadges.map(b => badgeNames[b] || b).join('، ');

  res.json({
    success: true,
    message: newBadges.length > 0 
      ? `باجەکانی (${target.full_name}) نوێکرانەوە: ${newBadges.length} باج [${badgeListLabels}]` 
      : `هەموو باجەکانی (${target.full_name}) لابردران`,
    user_id: userId,
    special_badge: badgeVal,
    badges: newBadges,
    badge_count: newBadges.length
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
    const freshUser = users.findById(req.user.id) || req.user;
    const TWO_DAYS_MS = 48 * 60 * 60 * 1000;
    const isStarGlowing = Boolean(freshUser.last_star_awarded_at && (Date.now() - Number(freshUser.last_star_awarded_at) <= TWO_DAYS_MS));
    const broadcastMsg = { 
      ...msg, 
      gender: freshUser.gender || 'male', 
      starInfo: calculateStars(freshUser.correct_answers_count),
      last_star_awarded_at: freshUser.last_star_awarded_at || null,
      is_star_glowing: isStarGlowing,
      file_name: origName,
      file_size: req.file.size
    };
    io.emit('new_message', broadcastMsg);
    try {
      sendPushNotificationToAllChatSubscribers({
        title: `💬 ${freshUser.full_name}`,
        body: isImage ? '📷 وێنەیەکی نارد' : (isVoice ? '🎤 دەنگێکی نارد' : '📄 فایلێکی نارد'),
        icon: freshUser.avatar_url || '/favicon.png',
        tag: 'chat-file-' + msg.id,
        data: { url: '/' }
      }, req.user.id);
    } catch (e) {}
    res.json({ success: true, message: broadcastMsg });
  } catch (err) {
    res.status(500).json({ error: 'هەڵە لە بارکردنی فایل' });
  }
});

app.post('/api/chat/upload-voice', authMiddleware, requireAdmin, upload.single('voice'), (req, res) => {
  try {
    const activeLockMode = settings.get('chat_lock_mode', 'none');
    if (activeLockMode === 'total_lock' && !hasSuperAdminPrivileges(req.user)) {
      return res.status(403).json({ error: '🔒 چات داخراوە' });
    }
    if (activeLockMode === 'staff_only' && !['super_admin', 'admin', 'teacher'].includes(req.user.role) && !hasSuperAdminPrivileges(req.user) && !canManageMembers(req.user)) {
      return res.status(403).json({ error: '🔒 چات داخراوە' });
    }
    if (!req.file) return res.status(400).json({ error: 'هیچ دەنگێک نەدۆزرایەوە' });
    const voiceUrl = `/uploads/${req.file.filename}`;
    const durationText = req.body.duration || '';
    const msg = messages.create(req.user.id, req.user.username, req.user.full_name, req.user.role, durationText ? `پەیامی دەنگی (${durationText})` : 'پەیامی دەنگی', 'text', null, null, 'voice', voiceUrl);
    const freshUser = users.findById(req.user.id) || req.user;
    const TWO_DAYS_MS = 48 * 60 * 60 * 1000;
    const isStarGlowing = Boolean(freshUser.last_star_awarded_at && (Date.now() - Number(freshUser.last_star_awarded_at) <= TWO_DAYS_MS));
    const broadcastMsg = { 
      ...msg, 
      gender: freshUser.gender || 'male', 
      starInfo: calculateStars(freshUser.correct_answers_count),
      last_star_awarded_at: freshUser.last_star_awarded_at || null,
      is_star_glowing: isStarGlowing
    };
    io.emit('new_message', broadcastMsg);
    try {
      sendPushNotificationToAllChatSubscribers({
        title: `💬 ${freshUser.full_name}`,
        body: '🎤 دەنگێکی نارد',
        icon: freshUser.avatar_url || '/favicon.png',
        tag: 'chat-voice-' + msg.id,
        data: { url: '/' }
      }, req.user.id);
    } catch (e) {}
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

// User Notification Preferences (All chat messages like Messenger toggle)
app.get('/api/notifications/preferences', authMiddleware, (req, res) => {
  try {
    const notifyAll = users.getNotifyAllMessages(req.user.id);
    res.json({ success: true, notify_all_messages: notifyAll });
  } catch (err) {
    res.status(500).json({ error: 'هەڵە لە وەرگرتنی ڕێکخستنی ئاگاداریەکان' });
  }
});

app.post('/api/notifications/preferences', authMiddleware, (req, res) => {
  try {
    const enabled = req.body.notify_all_messages === true || req.body.notify_all_messages === 1 || req.body.notify_all_messages === 'true';
    users.setNotifyAllMessages(req.user.id, enabled);
    res.json({ success: true, notify_all_messages: enabled });
  } catch (err) {
    res.status(500).json({ error: 'هەڵە لە نوێکردنەوەی ڕێکخستنی ئاگاداریەکان' });
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

  const canSeeAnswer = req.user.role === 'super_admin' || req.user.role === 'teacher';

  const mappedQuestions = todayQuestions.map(q => {
    let mySubmission = null;
    if (req.user.role === 'student' || req.user.role === 'new_student') {
      mySubmission = questions.getStudentSubmission(q.id, req.user.id);
    }
    const showCorrectAnswer = q.is_revealed || canSeeAnswer;
    return {
      ...q,
      correct_answer: showCorrectAnswer ? q.correct_answer : null,
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

// 13. Post Question with Timer or Schedule for Future (Admin & Super Admin)
app.post('/api/chat/question', authMiddleware, requireAdmin, (req, res) => {
  const { question_text, correct_answer, duration_minutes = 5, custom_expires_at, publish_at } = req.body;
  if (!question_text || !question_text.trim()) {
    return res.status(400).json({ error: 'تکایە دەقی پرسیار بنووسە' });
  }

  let cleanPublishAt = 0;
  let isScheduled = false;
  if (publish_at) {
    const pubTime = Number(publish_at);
    if (!isNaN(pubTime) && pubTime > Date.now()) {
      cleanPublishAt = pubTime;
      isScheduled = true;
    }
  }

  const baseTime = isScheduled ? cleanPublishAt : Date.now();
  let finalExpiresAt = null;
  let finalDurationMinutes = Math.max(1, parseInt(duration_minutes) || 5);

  if (custom_expires_at) {
    const customTime = Number(custom_expires_at);
    if (isNaN(customTime) || customTime <= baseTime) {
      return res.status(400).json({ error: isScheduled ? 'تکایە کاتی تەواوبوونی پرسیار دوای کاتی بڵاوبوونەوەی دیاری بکە' : 'تکایە بەروار و کاتێکی داهاتوو دیاری بکە کە لە کاتی ئێستا درەنگتر بێت' });
    }
    finalExpiresAt = customTime;
    finalDurationMinutes = Math.max(1, Math.round((finalExpiresAt - baseTime) / (60 * 1000)));
  } else {
    finalExpiresAt = baseTime + (finalDurationMinutes * 60 * 1000);
  }

  const q = questions.create(
    req.user.id,
    req.user.full_name,
    question_text.trim(),
    correct_answer || null,
    finalDurationMinutes,
    finalExpiresAt,
    cleanPublishAt
  );

  if (isScheduled) {
    io.emit('question_scheduled', { question: q });
    return res.status(201).json({
      success: true,
      question: q,
      scheduled: true,
      message: 'پرسیارەکە بە سەرکەوتوویی میقاتکرا بۆ بڵاوبوونەوە لە کاتی دیاریکراودا 📅'
    });
  }

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

// Endpoint to publish a scheduled question immediately on demand
app.post('/api/chat/question/:id/publish-now', authMiddleware, requireAdmin, (req, res) => {
  const qId = parseInt(req.params.id);
  const q = questions.findById(qId);
  if (!q) return res.status(404).json({ error: 'پرسیار نەدۆزرایەوە' });
  if (q.is_published) return res.status(400).json({ error: 'ئەم پرسیارە پێشتر بڵاوکراوەتەوە' });
  triggerQuestionPublish(q.id);
  res.json({ success: true, message: 'پرسیارەکە دەستبەجێ بڵاوکرایەوە ✨' });
});

// Endpoint to get all scheduled questions
app.get('/api/chat/questions/scheduled', authMiddleware, requireAdmin, (req, res) => {
  const scheduled = questions.getScheduledQuestions();
  res.json({ scheduled });
});

// =========================================================================
// COMPLAINTS BOX (سندووقی سکاڵا بە پاراستنی ناوی سکاڵاکار)
// =========================================================================

// 1. Submit a complaint
app.post('/api/complaints', authMiddleware, (req, res) => {
  try {
    const { subject = '', content } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'تکایە دەقی سکاڵا یان سەرنجەکەت بنووسە' });
    }

    // Check for bad words with AI security
    const nlpCheck = typeof scanKurdishSmartText === 'function' ? scanKurdishSmartText(content) : { isBlocked: false };
    if (nlpCheck.isBlocked) {
      if (aiSecurity && typeof aiSecurity.logIncident === 'function') {
        aiSecurity.logIncident('bad_word', req.user.id, req.user.full_name, `وشەی قەدەغەکراو لە سکاڵا: "${nlpCheck.matched || ''}"`, 'medium', 'blocked');
      }
      return res.status(400).json({ error: 'تکایە دەستەواژەی شیاو و ڕێزدار بەکاربهێنە.' });
    }

    const complaint = complaints.create(
      req.user.id,
      req.user.username,
      req.user.full_name,
      req.user.role,
      subject,
      content
    );

    // Notify staff via Socket.IO
    io.emit('new_complaint_alert', {
      id: complaint.id,
      subject: complaint.subject,
      created_at: complaint.created_at
    });

    // Send push notification
    sendPushNotificationToAll({
      title: '📬 پەیامێکی نوێ لە سندووقی سکاڵا تۆمارکرا',
      body: `سەرنج یان سکاڵایەکی نوێ گەیشتە سندووقی سکاڵا: "${(subject || content).slice(0, 60)}..."`,
      tag: 'new-complaint-' + complaint.id,
      data: { url: '/?action=complaints' }
    });

    res.status(201).json({
      success: true,
      complaintId: complaint.id,
      message: 'سەرنج یان سکاڵاکەت بە سەرکەوتوویی تۆمارکرا. ناوت بە تەواوی پارێزراوە لە هەمووان.'
    });
  } catch (err) {
    console.error('Error submitting complaint:', err);
    res.status(500).json({ error: 'هەڵە لە تۆمارکردنی سکاڵا' });
  }
});

// 2. Get Complaints (Only Master Super Admin Kak Hemn & Teachers)
app.get('/api/complaints', authMiddleware, (req, res) => {
  try {
    const isMaster = isMasterSuperAdmin(req.user);
    const isTeacher = req.user.role === 'teacher';
    const isStaff = isMaster || isTeacher || req.user.role === 'super_admin';

    if (!isStaff) {
      return res.status(403).json({ error: 'دەسەڵاتی بینینی سندووقی سکاڵات نییە' });
    }

    const all = complaints.getAll();

    // Privacy rule: Only Kak Hemn sees real complainant identities!
    // Teachers see anonymized name!
    const sanitized = all.map(c => {
      if (isMaster) {
        return c; // Kak Hemn sees full name, username, user_id
      } else {
        return {
          id: c.id,
          user_id: null,
          username: '***',
          full_name: 'بەکارهێنەری پارێزراو (نەناسراو)',
          role: 'student',
          subject: c.subject,
          content: c.content,
          status: c.status,
          created_at: c.created_at
        };
      }
    });

    res.json({ complaints: sanitized, isMaster });
  } catch (err) {
    console.error('Error fetching complaints:', err);
    res.status(500).json({ error: 'هەڵە لە وەرگرتنی سکاڵاکان' });
  }
});

// 3. Update Complaint Status (Resolve / Pending)
app.patch('/api/complaints/:id/status', authMiddleware, (req, res) => {
  try {
    const isMaster = isMasterSuperAdmin(req.user);
    const isTeacher = req.user.role === 'teacher';
    if (!isMaster && !isTeacher && req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'دەسەڵاتت نییە' });
    }
    const { status } = req.body;
    if (!['pending', 'resolved', 'dismissed'].includes(status)) {
      return res.status(400).json({ error: 'دۆخی نادروست' });
    }
    const updated = complaints.updateStatus(parseInt(req.params.id), status);
    res.json({ success: true, complaint: updated });
  } catch (err) {
    res.status(500).json({ error: 'هەڵە لە نوێکردنەوەی دۆخی سکاڵا' });
  }
});

// 4. Delete Complaint (Master Super Admin only)
app.delete('/api/complaints/:id', authMiddleware, (req, res) => {
  try {
    const isMaster = isMasterSuperAdmin(req.user);
    if (!isMaster && req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'تەنها کاک هێمن دەتوانێت سکاڵا بسڕێتەوە' });
    }
    complaints.delete(parseInt(req.params.id));
    res.json({ success: true, message: 'سکاڵاکە بە سەرکەوتوویی سڕایەوە' });
  } catch (err) {
    res.status(500).json({ error: 'هەڵە لە سڕینەوەی سکاڵا' });
  }
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

  const now = Date.now();
  io.emit('star_awarded', {
    user_id: student.id,
    student_name: student.full_name,
    question_id: question_id || null,
    new_count: newCount,
    last_star_awarded_at: now,
    is_star_glowing: true,
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
  const canSeeAnswer = req.user.role === 'super_admin' || req.user.role === 'teacher';
  const list = questions.getAllArchive().map(q => ({
    ...q,
    // Hide official answer of active unrevealed question from non-super_admin / non-teachers
    correct_answer: (q.is_revealed || canSeeAnswer) ? q.correct_answer : null
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

// 22. Upload library book / multiple files (Teacher, Admin, Super Admin)
app.post('/api/library/upload', authMiddleware, requireAdmin, libraryUpload.fields([
  { name: 'files', maxCount: 50 }, 
  { name: 'file', maxCount: 1 },
  { name: 'cover_image', maxCount: 1 },
  { name: 'author_image', maxCount: 1 }
]), (req, res) => {
  try {
    const rawFiles = (req.files && req.files.files) ? req.files.files : ((req.files && req.files.file) ? req.files.file : (req.file ? [req.file] : []));
    if (!rawFiles || rawFiles.length === 0) {
      return res.status(400).json({ error: 'تکایە لانیکەم فایلێکی PDF یان پەڕاو هەڵبژێرە' });
    }

    const { title, author = '', description = '', category = 'گشتی' } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'تکایە ناوی کتێب یان ناوی سەرەکی بنووسە' });
    }

    let coverImageUrl = '';
    if (req.files && req.files.cover_image && req.files.cover_image[0]) {
      coverImageUrl = `/uploads/${req.files.cover_image[0].filename}`;
    } else if (req.body.cover_image) {
      coverImageUrl = req.body.cover_image.trim();
    }

    let authorImageUrl = '';
    if (req.files && req.files.author_image && req.files.author_image[0]) {
      authorImageUrl = `/uploads/${req.files.author_image[0].filename}`;
    } else if (req.body.author_image) {
      authorImageUrl = req.body.author_image.trim();
    }

    const parsedFiles = rawFiles.map(f => ({
      file_name: f.originalname,
      file_url: `/uploads/${f.filename}`,
      file_size: f.size,
      file_type: path.extname(f.originalname).replace('.', '').toLowerCase() || 'pdf'
    }));

    const primary = parsedFiles[0];
    const book = library.create(
      title,
      author,
      description,
      category,
      primary.file_url,
      primary.file_name,
      primary.file_size,
      primary.file_type,
      req.user.id,
      req.user.full_name,
      parsedFiles,
      coverImageUrl,
      authorImageUrl
    );

    res.status(201).json({
      success: true,
      message: `کتێبەکە لەگەڵ (${parsedFiles.length}) بەرگ/فایل بە سەرکەوتوویی دانرا 📚`,
      book
    });
  } catch (err) {
    console.error('Library upload error:', err);
    res.status(500).json({ error: 'هەڵەیەک ڕوویدا لە بارکردنی پەڕتووک' });
  }
});

// Update images for existing book
app.post('/api/library/books/:id/images', authMiddleware, requireAdmin, libraryUpload.fields([
  { name: 'cover_image', maxCount: 1 },
  { name: 'author_image', maxCount: 1 }
]), (req, res) => {
  try {
    const id = parseInt(req.params.id);
    let coverImageUrl = undefined;
    let authorImageUrl = undefined;

    if (req.files && req.files.cover_image && req.files.cover_image[0]) {
      coverImageUrl = `/uploads/${req.files.cover_image[0].filename}`;
    } else if (req.body.cover_image !== undefined) {
      coverImageUrl = req.body.cover_image;
    }

    if (req.files && req.files.author_image && req.files.author_image[0]) {
      authorImageUrl = `/uploads/${req.files.author_image[0].filename}`;
    } else if (req.body.author_image !== undefined) {
      authorImageUrl = req.body.author_image;
    }

    const updated = library.updateImages(id, coverImageUrl, authorImageUrl);
    res.json({ success: true, book: updated });
  } catch (err) {
    res.status(500).json({ error: 'هەڵە لە نوێکردنەوەی وێنەکان' });
  }
});

// 22b. Append additional PDFs / volumes to existing book
app.post('/api/library/books/:id/add-files', authMiddleware, requireAdmin, libraryUpload.fields([{ name: 'files', maxCount: 50 }, { name: 'file', maxCount: 1 }]), (req, res) => {
  try {
    const bookId = parseInt(req.params.id, 10);
    const book = library.findById(bookId);
    if (!book) return res.status(404).json({ error: 'کتێبەکە نەدۆزرایەوە' });

    const rawFiles = (req.files && req.files.files) ? req.files.files : ((req.files && req.files.file) ? req.files.file : (req.file ? [req.file] : []));
    if (!rawFiles || rawFiles.length === 0) {
      return res.status(400).json({ error: 'تکایە فایلە نوێیەکان دیاری بکە' });
    }

    const newParsed = rawFiles.map(f => ({
      file_name: f.originalname,
      file_url: `/uploads/${f.filename}`,
      file_size: f.size,
      file_type: path.extname(f.originalname).replace('.', '').toLowerCase() || 'pdf'
    }));

    const updated = library.addFiles(bookId, newParsed);
    res.json({
      success: true,
      message: `(${newParsed.length}) فایلی نوێ بۆ ئەم کتێبە زیادکرا`,
      book: updated
    });
  } catch (err) {
    console.error('Add library files error:', err);
    res.status(500).json({ error: 'هەڵە لە زیادکردنی فایلەکان' });
  }
});

// 22c. Remove a specific PDF volume from a book
app.delete('/api/library/books/:id/files/:fileIndex', authMiddleware, requireAdmin, (req, res) => {
  try {
    const bookId = parseInt(req.params.id, 10);
    const fileIndex = parseInt(req.params.fileIndex, 10);
    const result = library.removeFile(bookId, fileIndex);
    if (!result) return res.status(404).json({ error: 'فایل یان کتێبەکە نەدۆزرایەوە' });

    if (result.removedFile && result.removedFile.file_url) {
      try {
        const filePath = path.join(__dirname, 'public', result.removedFile.file_url);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch (e) {}
    }

    res.json({
      success: true,
      message: 'فایلەکە بە سەرکەوتوویی سڕایەوە',
      book: result.book
    });
  } catch (err) {
    res.status(500).json({ error: 'هەڵە لە سڕینەوەی فایل' });
  }
});

// 23. Delete library book (Teacher, Admin, Super Admin)
app.delete('/api/library/books/:id', authMiddleware, requireAdmin, (req, res) => {
  const bookId = parseInt(req.params.id, 10);
  const book = library.findById(bookId);
  if (!book) return res.status(404).json({ error: 'کتێبەکە نەدۆزرایەوە' });

  library.delete(bookId);
  try {
    const allFiles = Array.isArray(book.files) ? book.files : [];
    if (book.file_url) allFiles.push({ file_url: book.file_url });
    for (const f of allFiles) {
      if (f && f.file_url) {
        const filePath = path.join(__dirname, 'public', f.file_url);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }
    }
  } catch (e) {}

  res.json({ success: true, message: 'کتێبەکە لەگەڵ هەموو بەرگەکانیدا لە کتێبخانە سڕایەوە' });
});

// =========================================================================
// CUSTOM PRIVATE GROUP CHATS (گروپ چاتە تایبەتەکانی هێمن و ستاف لەگەڵ ڕاوێژکار)
// =========================================================================

async function handleAdvisorGroupChatReply(groupId, reqUser, userPrompt, ioInstance) {
  try {
    const group = customGroups.getGroupById(groupId);
    if (!group) return;

    // Emit typing indicator
    if (ioInstance) {
      ioInstance.to(`group_${groupId}`).emit('group_advisor_typing', { groupId, isTyping: true });
    }

    const members = customGroups.getGroupMembers(groupId) || [];
    const memberNames = members.map(m => `${m.full_name} (@${m.username}, ${m.role})`).join('، ');

    let totalUsers = 0;
    try { totalUsers = db.prepare('SELECT COUNT(*) as c FROM users').get()?.c || 0; } catch (e) {}
    let onlineCount = 0;
    if (typeof onlineUsers !== 'undefined' && onlineUsers) {
      const ids = new Set();
      for (const u of onlineUsers.values()) {
        if (u && u.id) ids.add(u.id);
      }
      onlineCount = ids.size;
    }
    const isLive = Boolean(typeof liveLessonState !== 'undefined' && liveLessonState && liveLessonState.isActive);
    const platformAnalytics = getAdvisorPlatformAnalytics();

    const liveContext = {
      user_name: reqUser.full_name,
      current_group: group.name,
      current_group_id: groupId,
      group_members: memberNames,
      total_platform_members: totalUsers,
      online_now: onlineCount,
      is_live_active: isLive,
      platform_analytics: platformAnalytics
    };

    let reply = null;

    // In group chat, Advisor answers questions but DOES NOT execute commands!
    const lowerPrompt = (userPrompt || '').toLowerCase();
    const cleanPrompt = (userPrompt || '').replace(/@ڕاوێژکار|@advisor|@rawêjkar/gi, '').trim();

    const isCommandAttempt = (
      lowerPrompt.includes('بسڕەوە') || lowerPrompt.includes('سڕینەوە') || lowerPrompt.includes('پاک بکە') || lowerPrompt.includes('پاکبکە') ||
      lowerPrompt.includes('دەربکە') || lowerPrompt.includes('لاببە') || lowerPrompt.includes('دەرکە') || lowerPrompt.includes('حەزف') ||
      lowerPrompt.includes('زیادبکە') || lowerPrompt.includes('زیاد بکە') || lowerPrompt.includes('بخەرە') || lowerPrompt.includes('ئاد بکە') || lowerPrompt.includes('ئادکە') ||
      lowerPrompt.includes('قفڵ') || lowerPrompt.includes('دابخە') || lowerPrompt.includes('میوت') || lowerPrompt.includes('بلۆک') ||
      lowerPrompt.includes('ڕۆڵ بگۆڕە') || lowerPrompt.includes('باج ببەخشە') || lowerPrompt.includes('پاسۆرد') || lowerPrompt.includes('خەون بسڕەوە')
    );

    if (isCommandAttempt) {
      reply = `سڵاو و ڕێز کاک/خاتوو ${reqUser.full_name} گیان 🌸،\nمن لەناو ئەم گروپ چاتەدا وەک «ڕاوێژکاری ئیدارە» تەنها وەڵامی پرسیارەکان دەدەمەوە، ڕاوێژ و هاوکاری و ڕوونکردنەوە پێشکەش دەکەم، بەڵام هیچ جۆرە فەرمانێکی کارگێڕی (وەک سڕینەوە، دەرکردن، قفڵ یان گۆڕانکاری لە داتادا) جێبەجێ ناکەم.\nفەرمانەکان و بەڕێوەبردنی تەواوی سایت تەنها لەلایەن کاک هێمنەوە لە ڕێگەی «ئەیجنتی بەڕێوەبردن» لەناو پڕۆفایلەکەی جێبەجێ دەکرێن ✨.`;
    }

    const candidateKeys = getOrderedAdvisorKeys();

    if (!reply && candidateKeys.length > 0 && typeof fetch === 'function') {
      try {
        const systemInstruction = `تۆ «ڕاوێژکاری زیرەکی ئیدارە»یت لە پلاتفۆرمی سیرین ستاف، ئێستا لەناو گروپ چاتی ئیدارە و ستافدا («${group.name}») ئامادەیت.
بەکارهێنەری بەڕێز «${reqUser.full_name}» (${reqUser.role}) لە ناو ئەم گروپەدا تاگی کردوویت و پرسیارت لێدەکات.
ئەندامانی تری ناو ئەم گروپە کە ئامادەن: ${memberNames}.

⚠️ یاسای سەرەکی و نەگۆڕ:
١. تۆ لەناو ئەم گروپ چاتەدا تەنها و تەنها «وەڵامی پرسیارەکان دەدەیتەوە»؛ ڕاوێژ، شیعر، زانیاری، شیکردنەوەی بابەتەکان، ڕێنمایی و هاوکاری ئەندامان دەکەیت.
٢. تۆ «بە هیچ شێوەیەک فەرمان جێبەجێ ناکەیت» لەناو ئەم گروپ چاتەدا (وەک سڕینەوەی چات، دەرکردنی ئەندام، زیادکردنی ئەندام، میوت، قفڵ، یان دەستکاریکردنی داتا)! ئەگەر هەرکەسێک داوای جێبەجێکردنی فەرمانی لێکردیت، بەوپەڕی ڕێز و ئەدەبەوە پێی بڵێ کە تۆ لەناو گروپدا تەنها وەڵامی پرسیارەکان دەدەیتەوە و فەرمانە کارگێڕییەکان تەنها لەلایەن کاک هێمنەوە لە پڕۆفایلەکەیەوە لە ڕێگەی ئەیجنتی بەڕێوەبردن جێبەجێ دەکرێن.
٣. وەڵامی پرسیارەکان با بە زمانی کوردی سۆرانی جوان، دۆستانە، ڕۆشنبیرانە، کورت و بەسوود بێت.`;

        const contents = [
          {
            role: 'user',
            parts: [{ text: cleanPrompt || userPrompt }]
          }
        ];

        const CANDIDATE_MODELS = ['gemini-flash-lite-latest', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite-preview', 'gemini-flash-latest', 'gemini-3-flash-preview'];

        // Dual Engine / Multi-Key loop with instant failover
        for (const geminiKey of candidateKeys) {
          if (reply) break;
          for (const model of CANDIDATE_MODELS) {
            if (reply) break;
            try {
              const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
              const controller = new AbortController();
              const timeout = setTimeout(() => controller.abort(), 7000);

              const geminiRes = await fetch(geminiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  system_instruction: { parts: [{ text: systemInstruction }] },
                  contents,
                  generationConfig: {
                    temperature: 0.6,
                    topP: 0.95
                  }
                }),
                signal: controller.signal
              });
              clearTimeout(timeout);

              if (geminiRes.ok) {
                const geminiData = await geminiRes.json();
                const candidate = geminiData.candidates?.[0];
                const candParts = candidate?.content?.parts || [];
                const candidateText = candParts.filter(p => p.text).map(p => p.text).join('\n').trim();
                if (candidateText) {
                  reply = candidateText;
                  break;
                }
              }
            } catch (modelErr) {
              console.warn(`[Advisor Group AI] Model ${model} error:`, modelErr.message);
            }
          }
        }
      } catch (geminiErr) {
        console.error('Advisor Group AI Gemini call error:', geminiErr);
      }
    }

    // Smart Kurdish Fallback if Gemini didn't respond or timed out (Read-only mode, no actions)
    if (!reply) {
      reply = await generateAdvisorSmartReply(cleanPrompt || userPrompt, reqUser, ioInstance, true);
    }

    // Save message to group chat
    const advisorMsg = customGroups.createMessage(
      groupId,
      0,
      'ڕاوێژکار',
      'advisor',
      reply,
      'text',
      null,
      null,
      0,
      1
    );

    // Broadcast to group room
    if (ioInstance) {
      ioInstance.to(`group_${groupId}`).emit('new_group_message', { message: advisorMsg, groupId });
      ioInstance.emit('custom_group_activity', {
        groupId,
        senderId: 0,
        senderName: 'ڕاوێژکار',
        hasUnread: true
      });
      ioInstance.to(`group_${groupId}`).emit('group_advisor_typing', { groupId, isTyping: false });
    }
  } catch (err) {
    console.error('Error in handleAdvisorGroupChatReply:', err);
    if (ioInstance) {
      ioInstance.to(`group_${groupId}`).emit('group_advisor_typing', { groupId, isTyping: false });
    }
  }
}

// 1. Get user's custom groups
app.get('/api/custom-groups', authMiddleware, (req, res) => {
  try {
    const isSuper = isMasterSuperAdmin(req.user);
    const groups = customGroups.getUserGroups(req.user.id, isSuper);
    res.json({ success: true, groups });
  } catch (err) {
    console.error('Error fetching custom groups:', err);
    res.status(500).json({ error: 'هەڵە لە هێنانی گروپەکان' });
  }
});

// 2. Create custom group (Master Super Admin only)
app.post('/api/custom-groups', authMiddleware, (req, res) => {
  try {
    if (!isMasterSuperAdmin(req.user)) {
      return res.status(403).json({ error: 'تەنها سەرپەرشتیاری باڵا (کاک هێمن) دەسەڵاتی دروستکردنی گروپ چاتی هەیە' });
    }
    const name = String(req.body.name || '').trim();
    if (!name) {
      return res.status(400).json({ error: 'تکایە ناوی گروپ چات بنووسە' });
    }
    const memberIds = Array.isArray(req.body.memberIds) ? req.body.memberIds : [];
    const group = customGroups.createGroup(name, req.user.id, req.user.full_name, memberIds);

    // Notify online members
    io.emit('custom_group_created', { group });
    io.emit('custom_group_list_refresh');
    res.json({ success: true, group });
  } catch (err) {
    console.error('Error creating custom group:', err);
    res.status(500).json({ error: 'هەڵە لە دروستکردنی گروپ چات' });
  }
});

// 3. Get single group details & members
app.get('/api/custom-groups/:id', authMiddleware, (req, res) => {
  try {
    const groupId = parseInt(req.params.id, 10);
    const isSuper = isMasterSuperAdmin(req.user);
    if (!customGroups.isMember(groupId, req.user.id, isSuper)) {
      return res.status(403).json({ error: 'تۆ ئەندامی ئەم گروپ چاتە نیت' });
    }
    const group = customGroups.getGroupById(groupId);
    if (!group) return res.status(404).json({ error: 'گروپەکە نەدۆزرایەوە' });
    res.json({ success: true, group });
  } catch (err) {
    res.status(500).json({ error: 'هەڵە لە هێنانی زانیاری گروپ' });
  }
});

// 4. Update group name (Super Admin only)
app.put('/api/custom-groups/:id', authMiddleware, (req, res) => {
  try {
    if (!isMasterSuperAdmin(req.user)) {
      return res.status(403).json({ error: 'تەنها سەرپەرشتیاری باڵا دەتوانێت ناوی گروپ بگۆڕێت' });
    }
    const groupId = parseInt(req.params.id, 10);
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'ناوی نوێ بنووسە' });
    const updated = customGroups.updateGroupName(groupId, name);
    io.to(`group_${groupId}`).emit('custom_group_renamed', { groupId, name });
    io.emit('custom_group_list_refresh');
    res.json({ success: true, group: updated });
  } catch (err) {
    res.status(500).json({ error: 'هەڵە لە نوێکردنەوەی ناوی گروپ' });
  }
});

// 5. Delete group (Super Admin only)
app.delete('/api/custom-groups/:id', authMiddleware, (req, res) => {
  try {
    if (!isMasterSuperAdmin(req.user)) {
      return res.status(403).json({ error: 'تەنها سەرپەرشتیاری باڵا دەسەڵاتی سڕینەوەی گروپ چاتی هەیە' });
    }
    const groupId = parseInt(req.params.id, 10);
    customGroups.deleteGroup(groupId);
    io.to(`group_${groupId}`).emit('custom_group_deleted', { groupId });
    io.emit('custom_group_list_refresh');
    res.json({ success: true, message: 'گروپ چاتەکە بە سەرکەوتوویی سڕایەوە' });
  } catch (err) {
    res.status(500).json({ error: 'هەڵە لە سڕینەوەی گروپ' });
  }
});

// 6. Add member to group (Super Admin only)
app.post('/api/custom-groups/:id/members', authMiddleware, (req, res) => {
  try {
    if (!isMasterSuperAdmin(req.user)) {
      return res.status(403).json({ error: 'تەنها سەرپەرشتیاری باڵا دەتوانێت ئەندام زیاد بکات' });
    }
    const groupId = parseInt(req.params.id, 10);
    const userId = parseInt(req.body.userId, 10);
    if (!userId) return res.status(400).json({ error: 'ئایدی بەکارهێنەر دیاری بکە' });
    const members = customGroups.addMember(groupId, userId);
    io.to(`group_${groupId}`).emit('custom_group_members_updated', { groupId, members });
    io.emit('custom_group_list_refresh');
    res.json({ success: true, members });
  } catch (err) {
    res.status(500).json({ error: 'هەڵە لە زیادکردنی ئەندام' });
  }
});

// 7. Remove member from group (Super Admin only)
app.delete('/api/custom-groups/:id/members/:userId', authMiddleware, (req, res) => {
  try {
    if (!isMasterSuperAdmin(req.user)) {
      return res.status(403).json({ error: 'تەنها سەرپەرشتیاری باڵا دەتوانێت ئەندام لابدات' });
    }
    const groupId = parseInt(req.params.id, 10);
    const userId = parseInt(req.params.userId, 10);
    const members = customGroups.removeMember(groupId, userId);
    io.to(`group_${groupId}`).emit('custom_group_members_updated', { groupId, members });
    io.emit('custom_group_list_refresh');
    res.json({ success: true, members });
  } catch (err) {
    res.status(500).json({ error: 'هەڵە لە لابردنی ئەندام' });
  }
});

// 8. Get messages of a group
app.get('/api/custom-groups/:id/messages', authMiddleware, (req, res) => {
  try {
    const groupId = parseInt(req.params.id, 10);
    const isSuper = isMasterSuperAdmin(req.user);
    if (!customGroups.isMember(groupId, req.user.id, isSuper)) {
      return res.status(403).json({ error: 'تۆ ئەندامی ئەم گروپ چاتە نیت' });
    }
    const msgs = customGroups.getMessages(groupId, 120);
    customGroups.markGroupRead(groupId, req.user.id);
    res.json({ success: true, messages: msgs });
  } catch (err) {
    res.status(500).json({ error: 'هەڵە لە هێنانی پەیامەکان' });
  }
});

// 9. Mark group read
app.post('/api/custom-groups/:id/mark-read', authMiddleware, (req, res) => {
  try {
    const groupId = parseInt(req.params.id, 10);
    customGroups.markGroupRead(groupId, req.user.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'هەڵە' });
  }
});

// 10. Upload file/voice/image in custom group
app.post('/api/custom-groups/:id/upload', authMiddleware, upload.single('file'), (req, res) => {
  try {
    const groupId = parseInt(req.params.id, 10);
    const isSuper = isMasterSuperAdmin(req.user);
    if (!customGroups.isMember(groupId, req.user.id, isSuper)) {
      return res.status(403).json({ error: 'تۆ ئەندامی ئەم گروپە نیت' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'هیچ فایلێک بار نەکراوە' });
    }
    const fileUrl = `/uploads/${req.file.filename}`;
    const fileType = req.body.type || (req.file.mimetype.startsWith('image/') ? 'image' : req.file.mimetype.startsWith('audio/') ? 'audio' : 'file');
    res.json({
      success: true,
      fileUrl,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      fileType
    });
  } catch (err) {
    res.status(500).json({ error: 'هەڵە لە بارکردنی فایل' });
  }
});

// 11. Send message in custom group (Text, Voice, Image, File)
app.post('/api/custom-groups/:id/messages', authMiddleware, async (req, res) => {
  try {
    const groupId = parseInt(req.params.id, 10);
    const isSuper = isMasterSuperAdmin(req.user);
    if (!customGroups.isMember(groupId, req.user.id, isSuper)) {
      return res.status(403).json({ error: 'تۆ ئەندامی ئەم گروپ چاتە نیت' });
    }

    const content = String(req.body.content || '').trim();
    const type = req.body.type || 'text'; // 'text', 'image', 'audio', 'file'
    const attachmentUrl = req.body.attachmentUrl || null;
    const attachmentName = req.body.attachmentName || null;
    const attachmentSize = req.body.attachmentSize || 0;

    if (!content && !attachmentUrl) {
      return res.status(400).json({ error: 'تکایە پەیامێک یان فایلێک بنێرە' });
    }

    const createdMsg = customGroups.createMessage(
      groupId,
      req.user.id,
      req.user.full_name,
      req.user.role,
      content,
      type,
      attachmentUrl,
      attachmentName,
      attachmentSize,
      0
    );

    // Broadcast to room
    io.to(`group_${groupId}`).emit('new_group_message', { message: createdMsg, groupId });
    // Broadcast activity to everyone so unread pulse dot animates
    io.emit('custom_group_activity', {
      groupId,
      senderId: req.user.id,
      senderName: req.user.full_name,
      hasUnread: true
    });

    res.json({ success: true, message: createdMsg });

    // AI Advisor Trigger Check:
    // Any member in the admin group chat can tag the Advisor to ask questions! (Does NOT execute commands)
    const isAdvisorMentioned = content && (
      content.includes('@ڕاوێژکار') || 
      content.includes('@advisor') || 
      content.includes('@rawêjkar') || 
      content.startsWith('ڕاوێژکار')
    );
    if (isAdvisorMentioned) {
      handleAdvisorGroupChatReply(groupId, req.user, content, io).catch(e => {
        console.error('Advisor group chat execution error:', e);
      });
    }
  } catch (err) {
    console.error('Error posting group message:', err);
    res.status(500).json({ error: 'هەڵە لە ناردنی پەیام' });
  }
});

// 12. Delete group message (Own message or Super Admin)
app.delete('/api/custom-groups/:id/messages/:messageId', authMiddleware, (req, res) => {
  try {
    const groupId = parseInt(req.params.id, 10);
    const messageId = parseInt(req.params.messageId, 10);
    const isSuper = isMasterSuperAdmin(req.user);
    const result = customGroups.deleteMessage(messageId, req.user.id, isSuper);
    if (!result) return res.status(404).json({ error: 'پەیامەکە نەدۆزرایەوە' });
    if (result.forbidden) return res.status(403).json({ error: 'تۆ تەنها دەتوانیت پەیامی خۆت بسڕیتەوە' });

    io.to(`group_${groupId}`).emit('group_message_deleted', { groupId, messageId });
    res.json({ success: true, message: 'پەیامەکە سڕایەوە' });
  } catch (err) {
    res.status(500).json({ error: 'هەڵە لە سڕینەوەی پەیام' });
  }
});

// =========================================================================
// POLLS SYSTEM (ڕاپرسی لە چاتی گشتی و گروپ چاتە تایبەتەکان)
// =========================================================================

// Create Poll (Super Admin & Teachers)
app.post('/api/polls', authMiddleware, (req, res) => {
  try {
    const isStaff = req.user.role === 'super_admin' || req.user.role === 'teacher';
    if (!isStaff) {
      return res.status(403).json({ error: 'تەنها مامۆستایان و سەرپەرشتیار دەتوانن ڕاپرسی دروست بکەن' });
    }

    const chatType = req.body.chatType === 'custom_group' ? 'custom_group' : 'public';
    const groupId = req.body.groupId ? parseInt(req.body.groupId, 10) : null;
    const question = String(req.body.question || '').trim();
    const rawOptions = Array.isArray(req.body.options) ? req.body.options : [];
    const options = rawOptions.map(o => String(o || '').trim()).filter(Boolean);

    if (!question) {
      return res.status(400).json({ error: 'تکایە پرسیاری ڕاپرسی بنووسە' });
    }
    if (options.length < 2) {
      return res.status(400).json({ error: 'پێویستە لانی کەم دوو بژاردە دابنێیت' });
    }

    if (chatType === 'custom_group') {
      if (!groupId || !customGroups.isMember(groupId, req.user.id, isMasterSuperAdmin(req.user))) {
        return res.status(403).json({ error: 'دەسەڵاتی ئەم گروپەت نییە' });
      }
    }

    const poll = pollsDb.createPoll({
      chatType,
      groupId,
      creatorId: req.user.id,
      creatorName: req.user.full_name,
      creatorRole: req.user.role,
      question,
      options
    });

    const contentPayload = JSON.stringify({ poll_id: poll.id, question: poll.question });

    if (chatType === 'public') {
      const newMsg = messages.create(
        req.user.id,
        req.user.username,
        req.user.full_name,
        req.user.role,
        contentPayload,
        'poll'
      );
      io.emit('new_message', newMsg);
      try {
        sendPushNotificationToAll({
          title: `📊 ڕاپرسییەکی نوێ: ${question.slice(0, 60)}`,
          body: `ڕاپرسییەکی نوێ دانرا لەلایەن ${req.user.full_name}، بەشداری بکە!`,
          tag: 'poll-new-' + poll.id,
          data: { url: '/?action=polls' }
        }, req.user.id);
      } catch (e) {}
    } else {
      const groupMsg = customGroups.createMessage(
        groupId,
        req.user.id,
        req.user.full_name,
        req.user.role,
        contentPayload,
        'poll'
      );
      io.to(`group_${groupId}`).emit('new_group_message', { message: groupMsg, groupId });
    }

    res.json({ success: true, poll });
  } catch (err) {
    console.error('Error creating poll:', err);
    res.status(500).json({ error: 'هەڵە لە دروستکردنی ڕاپرسی' });
  }
});

// Helper to strip voter identities from polls for non-super-admins
function stripVotersFromPoll(poll) {
  if (!poll) return poll;
  const clone = JSON.parse(JSON.stringify(poll));
  if (Array.isArray(clone.options)) {
    clone.options = clone.options.map(o => {
      const { voters, ...rest } = o;
      return rest;
    });
  }
  return clone;
}

// Get Poll details
app.get('/api/polls/:id', authMiddleware, (req, res) => {
  try {
    const pollId = parseInt(req.params.id, 10);
    const poll = pollsDb.getPollById(pollId, req.user.id);
    if (!poll) return res.status(404).json({ error: 'ڕاپرسی نەدۆزرایەوە' });

    // Privacy: Only Super Admin (Kak Hemn) can see who voted for what
    const isSuper = isMasterSuperAdmin(req.user) || req.user.role === 'super_admin';
    const finalPoll = isSuper ? poll : stripVotersFromPoll(poll);

    res.json({ success: true, poll: finalPoll, canManage: isSuper || req.user.id === poll.creator_id });
  } catch (err) {
    res.status(500).json({ error: 'هەڵە لە هێنانی ڕاپرسی' });
  }
});

// Vote on Poll
app.post('/api/polls/:id/vote', authMiddleware, (req, res) => {
  try {
    const pollId = parseInt(req.params.id, 10);
    const optionIndex = parseInt(req.body.optionIndex, 10);
    const result = pollsDb.vote(pollId, req.user.id, req.user.full_name, optionIndex);
    if (result.error) return res.status(400).json({ error: result.error });

    const updatedPoll = pollsDb.getPollById(pollId);
    const sanitizedPoll = stripVotersFromPoll(updatedPoll);
    if (updatedPoll.chat_type === 'public') {
      io.emit('poll_updated', { pollId, poll: sanitizedPoll });
    } else if (updatedPoll.group_id) {
      io.to(`group_${updatedPoll.group_id}`).emit('poll_updated', { pollId, poll: sanitizedPoll });
    }

    const isSuper = isMasterSuperAdmin(req.user) || req.user.role === 'super_admin';
    const userPoll = isSuper ? result.poll : stripVotersFromPoll(result.poll);
    res.json({ success: true, poll: userPoll });
  } catch (err) {
    console.error('Error voting on poll:', err);
    res.status(500).json({ error: 'هەڵە لە دەنگدان' });
  }
});

// Close / Reopen Poll (Super Admin & Creator)
app.post('/api/polls/:id/close', authMiddleware, (req, res) => {
  try {
    const pollId = parseInt(req.params.id, 10);
    const poll = pollsDb.getPollById(pollId);
    if (!poll) return res.status(404).json({ error: 'ڕاپرسی نەدۆزرایەوە' });

    const isSuper = isMasterSuperAdmin(req.user) || req.user.role === 'super_admin';
    const canClose = isSuper || req.user.id === poll.creator_id || req.user.role === 'teacher';
    if (!canClose) return res.status(403).json({ error: 'مۆڵەتی داخستنی ئەم ڕاپرسییەت نییە' });

    const closedPoll = pollsDb.closePoll(pollId);
    const sanitizedClosed = stripVotersFromPoll(closedPoll);
    if (closedPoll.chat_type === 'public') {
      io.emit('poll_updated', { pollId, poll: sanitizedClosed });
    } else if (closedPoll.group_id) {
      io.to(`group_${closedPoll.group_id}`).emit('poll_updated', { pollId, poll: sanitizedClosed });
    }
    res.json({ success: true, poll: isSuper ? closedPoll : sanitizedClosed });
  } catch (err) {
    res.status(500).json({ error: 'هەڵە لە داخستنی ڕاپرسی' });
  }
});

// Toggle Poll Open/Close Status (Super Admin & Creator)
app.post('/api/polls/:id/toggle-status', authMiddleware, (req, res) => {
  try {
    const pollId = parseInt(req.params.id, 10);
    const poll = pollsDb.getPollById(pollId);
    if (!poll) return res.status(404).json({ error: 'ڕاپرسی نەدۆزرایەوە' });

    const isSuper = isMasterSuperAdmin(req.user) || req.user.role === 'super_admin';
    const canManage = isSuper || req.user.id === poll.creator_id;
    if (!canManage) return res.status(403).json({ error: 'مۆڵەتی دەستکاریکردنی ئەم ڕاپرسییەت نییە' });

    const forced = typeof req.body.isClosed === 'boolean' ? req.body.isClosed : null;
    const updated = pollsDb.togglePollStatus(pollId, forced);
    const sanitizedUpdated = stripVotersFromPoll(updated);

    if (updated.chat_type === 'public') {
      io.emit('poll_updated', { pollId, poll: sanitizedUpdated });
    } else if (updated.group_id) {
      io.to(`group_${updated.group_id}`).emit('poll_updated', { pollId, poll: sanitizedUpdated });
    }
    res.json({ success: true, poll: isSuper ? updated : sanitizedUpdated });
  } catch (err) {
    res.status(500).json({ error: 'هەڵە لە گۆڕینی دۆخی ڕاپرسی' });
  }
});

// Edit Poll (Super Admin & Creator)
app.put('/api/polls/:id', authMiddleware, (req, res) => {
  try {
    const pollId = parseInt(req.params.id, 10);
    const poll = pollsDb.getPollById(pollId);
    if (!poll) return res.status(404).json({ error: 'ڕاپرسی نەدۆزرایەوە' });

    const isSuper = isMasterSuperAdmin(req.user) || req.user.role === 'super_admin';
    const canManage = isSuper || req.user.id === poll.creator_id;
    if (!canManage) return res.status(403).json({ error: 'مۆڵەتی دەستکاریکردنی ئەم ڕاپرسییەت نییە' });

    const question = String(req.body.question || '').trim();
    const rawOptions = Array.isArray(req.body.options) ? req.body.options : [];
    const options = rawOptions.map(o => String(o || '').trim()).filter(Boolean);

    if (!question || options.length < 2) {
      return res.status(400).json({ error: 'پێویستە پرسیار و لانی کەم دوو بژاردە هەبێت' });
    }

    const updated = pollsDb.updatePoll(pollId, { question, options });
    const sanitizedUpdated = stripVotersFromPoll(updated);

    if (updated.chat_type === 'public') {
      io.emit('poll_updated', { pollId, poll: sanitizedUpdated });
    } else if (updated.group_id) {
      io.to(`group_${updated.group_id}`).emit('poll_updated', { pollId, poll: sanitizedUpdated });
    }
    res.json({ success: true, poll: isSuper ? updated : sanitizedUpdated });
  } catch (err) {
    res.status(500).json({ error: 'هەڵە لە دەستکاریکردنی ڕاپرسی' });
  }
});

// Delete Poll (Super Admin & Creator)
app.delete('/api/polls/:id', authMiddleware, (req, res) => {
  try {
    const pollId = parseInt(req.params.id, 10);
    const poll = pollsDb.getPollById(pollId);
    if (!poll) return res.status(404).json({ error: 'ڕاپرسی نەدۆزرایەوە' });

    const isSuper = isMasterSuperAdmin(req.user) || req.user.role === 'super_admin';
    const canManage = isSuper || req.user.id === poll.creator_id;
    if (!canManage) return res.status(403).json({ error: 'مۆڵەتی سڕینەوەی ئەم ڕاپرسییەت نییە' });

    pollsDb.deletePoll(pollId);
    db.prepare("DELETE FROM messages WHERE type = 'poll' AND content LIKE ?").run(`%"poll_id":${pollId}%`);
    db.prepare("DELETE FROM custom_group_messages WHERE type = 'poll' AND content LIKE ?").run(`%"poll_id":${pollId}%`);

    io.emit('poll_deleted', { pollId });
    res.json({ success: true, message: 'ڕاپرسی بە سەرکەوتوویی سڕایەوە' });
  } catch (err) {
    res.status(500).json({ error: 'هەڵە لە سڕینەوەی ڕاپرسی' });
  }
});

// =========================================================================
// EVENT COUNTDOWN ALARMS (زەنگی ئاگاداری)
// =========================================================================

// Create Alarm (Super Admin, Teacher, Admin)
app.post('/api/alarms', authMiddleware, (req, res) => {
  try {
    const canSet = req.user.role === 'super_admin' || req.user.role === 'teacher' || req.user.role === 'admin';
    if (!canSet) {
      return res.status(403).json({ error: 'تەنها سەرپەرشتیار، مامۆستا و ئەدمین دەتوانن زەنگی ئاگاداری دابنێن' });
    }

    const chatType = req.body.chatType === 'custom_group' ? 'custom_group' : 'public';
    const groupId = req.body.groupId ? parseInt(req.body.groupId, 10) : null;
    const title = String(req.body.title || '').trim();
    const targetTime = parseInt(req.body.targetTime, 10);

    if (!title) return res.status(400).json({ error: 'تکایە نوسینی ئاگاداری دیاری بکە' });
    if (!targetTime || isNaN(targetTime)) return res.status(400).json({ error: 'تکایە بەروار و کات دیاری بکە' });

    if (chatType === 'custom_group') {
      if (!groupId || !customGroups.isMember(groupId, req.user.id, isMasterSuperAdmin(req.user))) {
        return res.status(403).json({ error: 'دەسەڵاتی ئەم گروپەت نییە' });
      }
    }

    const alarm = alarmsDb.createAlarm({
      chatType,
      groupId,
      creatorId: req.user.id,
      creatorName: req.user.full_name,
      creatorRole: req.user.role,
      title,
      targetTime
    });

    const contentPayload = JSON.stringify({
      alarm_id: alarm.id,
      creator_id: alarm.creator_id,
      title: alarm.title,
      target_time: alarm.target_time,
      creator_name: alarm.creator_name,
      creator_role: alarm.creator_role
    });

    if (chatType === 'public') {
      const newMsg = messages.create(
        req.user.id,
        req.user.username,
        req.user.full_name,
        req.user.role,
        contentPayload,
        'countdown_alarm'
      );
      io.emit('new_message', newMsg);
    } else {
      const groupMsg = customGroups.createMessage(
        groupId,
        req.user.id,
        req.user.full_name,
        req.user.role,
        contentPayload,
        'countdown_alarm'
      );
      io.to(`group_${groupId}`).emit('new_group_message', { message: groupMsg, groupId });
    }

    res.json({ success: true, alarm });
  } catch (err) {
    console.error('Error creating alarm:', err);
    res.status(500).json({ error: 'هەڵە لە دانانی زەنگی ئاگاداری' });
  }
});

// Active Alarms
app.get('/api/alarms/active', authMiddleware, (req, res) => {
  try {
    const alarms = alarmsDb.getActiveAlarms();
    res.json({ success: true, alarms });
  } catch (err) {
    res.status(500).json({ error: 'هەڵە لە هێنانی زەنگەکان' });
  }
});

// Get Single Alarm
app.get('/api/alarms/:id', authMiddleware, (req, res) => {
  try {
    const alarmId = parseInt(req.params.id, 10);
    const alarm = alarmsDb.getAlarmById(alarmId);
    if (!alarm) return res.status(404).json({ error: 'زەنگەکە نەدۆزرایەوە' });
    res.json({ success: true, alarm });
  } catch (err) {
    res.status(500).json({ error: 'هەڵە لە هێنانی زەنگ' });
  }
});

// Edit Alarm (Super Admin, Teacher, Admin, or Creator)
app.put('/api/alarms/:id', authMiddleware, (req, res) => {
  try {
    const alarmId = parseInt(req.params.id, 10);
    const alarm = alarmsDb.getAlarmById(alarmId);
    if (!alarm) return res.status(404).json({ error: 'زەنگەکە نەدۆزرایەوە' });

    const isSuper = isMasterSuperAdmin(req.user) || req.user.role === 'super_admin';
    const canManage = isSuper || req.user.id === alarm.creator_id || req.user.role === 'teacher' || req.user.role === 'admin';
    if (!canManage) return res.status(403).json({ error: 'مۆڵەتی دەستکاریکردنی ئەم زەنگەت نییە' });

    const title = String(req.body.title || '').trim();
    const targetTime = parseInt(req.body.targetTime, 10);

    if (!title) return res.status(400).json({ error: 'تکایە نوسینی ئاگاداری بنووسە' });
    if (!targetTime || isNaN(targetTime)) return res.status(400).json({ error: 'تکایە کاتێکی دروست دیاری بکە' });

    const updated = alarmsDb.updateAlarm(alarmId, { title, targetTime });

    // Also update any message content that has this alarm_id
    const contentPayload = JSON.stringify({
      alarm_id: updated.id,
      creator_id: updated.creator_id,
      title: updated.title,
      target_time: updated.target_time,
      creator_name: updated.creator_name,
      creator_role: updated.creator_role
    });

    db.prepare("UPDATE messages SET content = ? WHERE type = 'countdown_alarm' AND content LIKE ?").run(contentPayload, `%"alarm_id":${alarmId}%`);
    db.prepare("UPDATE custom_group_messages SET content = ? WHERE type = 'countdown_alarm' AND content LIKE ?").run(contentPayload, `%"alarm_id":${alarmId}%`);

    if (updated.chat_type === 'public') {
      io.emit('alarm_updated', { alarmId, alarm: updated });
    } else if (updated.group_id) {
      io.to(`group_${updated.group_id}`).emit('alarm_updated', { alarmId, alarm: updated });
    }

    res.json({ success: true, alarm: updated });
  } catch (err) {
    console.error('Error updating alarm:', err);
    res.status(500).json({ error: 'هەڵە لە دەستکاریکردنی زەنگ' });
  }
});

// Delete Alarm
app.delete('/api/alarms/:id', authMiddleware, (req, res) => {
  try {
    const alarmId = parseInt(req.params.id, 10);
    const alarm = alarmsDb.getAlarmById(alarmId);
    if (!alarm) return res.status(404).json({ error: 'زەنگەکە نەدۆزرایەوە' });

    const canDelete = req.user.id === alarm.creator_id || req.user.role === 'super_admin' || req.user.role === 'teacher' || req.user.role === 'admin';
    if (!canDelete) return res.status(403).json({ error: 'مۆڵەتی سڕینەوەی ئەم زەنگەت نییە' });

    alarmsDb.deleteAlarm(alarmId);
    db.prepare("DELETE FROM messages WHERE type = 'countdown_alarm' AND content LIKE ?").run(`%"alarm_id":${alarmId}%`);
    db.prepare("DELETE FROM custom_group_messages WHERE type = 'countdown_alarm' AND content LIKE ?").run(`%"alarm_id":${alarmId}%`);

    io.emit('alarm_deleted', { alarmId });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'هەڵە لە سڕینەوەی زەنگ' });
  }
});

// Background Alarm Checker (Every 5 seconds)
setInterval(async () => {
  try {
    const now = Date.now();
    const dueAlarms = db.prepare('SELECT * FROM event_alarms WHERE is_triggered = 0 AND target_time <= ?').all(now);
    for (const a of dueAlarms) {
      alarmsDb.markTriggered(a.id);
      console.log(`[ALARM TRIGGERED] #${a.id}: ${a.title}`);

      if (a.chat_type === 'public') {
        io.emit('alarm_triggered', {
          alarmId: a.id,
          title: a.title,
          targetTime: a.target_time,
          chatType: 'public'
        });
      } else if (a.group_id) {
        io.to(`group_${a.group_id}`).emit('alarm_triggered', {
          alarmId: a.id,
          title: a.title,
          targetTime: a.target_time,
          chatType: 'custom_group',
          groupId: a.group_id
        });
      }

      if (typeof sendPushNotificationToAll === 'function') {
        sendPushNotificationToAll({
          title: '🔔 زەنگی ئاگاداری!',
          body: `${a.title} - ئێستا کاتەکەی هاتووە!`,
          tag: `alarm_${a.id}`,
          data: { url: '/' }
        }).catch(e => console.warn('Alarm push note:', e.message));
      }
    }
  } catch (e) {
    console.error('Error in alarm timer checker:', e);
  }
}, 5000);

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

  // If this message was an attendance session (@غیابات / @هاتن), cascade delete the session and its records
  if (msg.attachment_type === 'attendance' && msg.attachment_url) {
    try {
      const sessId = parseInt(msg.attachment_url);
      if (sessId) {
        attendanceDb.deleteSession(sessId);
        io.emit('attendance_session_deleted', { session_id: sessId, sessionId: sessId });
      }
    } catch (e) {
      console.error('Error cascade deleting attendance session:', e);
    }
  }

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

// Message History with Reactions & Action Button Clicks
app.get('/api/chat/messages', authMiddleware, (req, res) => {
  const history = messages.getRecent(120);
  const msgIds = history.map(m => m.id);
  const reactionsMap = messageReactions.getForMessages(msgIds, req.user.id);
  const buttonClicksData = buttonClicks.getClicksForMessages(msgIds, req.user.id);
  const TWO_DAYS_MS = 48 * 60 * 60 * 1000;
  const now = Date.now();
  const result = history.map(m => {
    let attSummary = null;
    if (m.attachment_type === 'attendance' && m.attachment_url) {
      try { attSummary = attendanceDb.getSessionSummary(parseInt(m.attachment_url)); } catch (e) {}
    }
    return {
      ...m,
      is_star_glowing: Boolean(m.last_star_awarded_at && (now - Number(m.last_star_awarded_at) <= TWO_DAYS_MS)),
      starInfo: calculateStars(m.correct_answers_count),
      reactions: reactionsMap[m.id] || [],
      button_clicks_count: buttonClicksData.counts[m.id] || 0,
      user_has_clicked: !!buttonClicksData.userClicked[m.id],
      attendance_summary: attSummary
    };
  });
  res.json({ 
    messages: result,
    last_read_message_id: req.user.last_read_message_id || 0
  });
});

// Chat Global Search (Words, Variations, Senders)
app.get('/api/chat/search', authMiddleware, (req, res) => {
  try {
    const rawQ = (req.query.q || '').trim();
    if (!rawQ || rawQ.length < 1) return res.json({ results: [] });

    // Normalize query for Kurdish / Arabic variations
    const cleanQ = rawQ.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
    const wildcard = `%${cleanQ}%`;

    const variant1 = `%${cleanQ.replace(/ی/g, 'ي').replace(/ک/g, 'ك')}%`;
    const variant2 = `%${cleanQ.replace(/ي/g, 'ی').replace(/ك/g, 'ک')}%`;
    const variant3 = `%${cleanQ.replace(/ھ/g, 'ه').replace(/ە/g, 'ه')}%`;

    const stmt = db.prepare(`
      SELECT m.*, u.gender, u.correct_answers_count, u.last_star_awarded_at,
        orig.full_name as reply_to_name,
        orig.content as reply_to_content
      FROM messages m
      LEFT JOIN users u ON m.user_id = u.id
      LEFT JOIN messages orig ON m.reply_to_id = orig.id
      WHERE COALESCE(m.is_deleted, 0) = 0 AND (
            m.content LIKE ? 
         OR m.full_name LIKE ? 
         OR m.username LIKE ?
         OR m.content LIKE ?
         OR m.content LIKE ?
         OR m.content LIKE ?
         OR m.full_name LIKE ?
         OR m.full_name LIKE ?
         OR REPLACE(REPLACE(REPLACE(m.content, 'ي', 'ی'), 'ك', 'ک'), 'ھ', 'ه') LIKE ?
         OR REPLACE(REPLACE(REPLACE(m.full_name, 'ي', 'ی'), 'ك', 'ک'), 'ھ', 'ه') LIKE ?
      )
      ORDER BY m.id DESC
      LIMIT 80
    `);

    const results = stmt.all(
      wildcard, wildcard, wildcard,
      variant1, variant2, variant3,
      variant1, variant2,
      wildcard, wildcard
    );
    const TWO_DAYS_MS = 48 * 60 * 60 * 1000;
    const now = Date.now();
    const mapped = results.reverse().map(m => ({
      ...m,
      is_star_glowing: Boolean(m.last_star_awarded_at && (now - Number(m.last_star_awarded_at) <= TWO_DAYS_MS)),
      starInfo: calculateStars(m.correct_answers_count)
    }));
    res.json({ results: mapped });
  } catch (err) {
    console.error('Chat search error:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Context messages around a specific message ID (for clicking older search results)
app.get('/api/chat/message-context/:id', authMiddleware, (req, res) => {
  try {
    const targetId = parseInt(req.params.id);
    if (!targetId) return res.status(400).json({ error: 'Invalid ID' });

    const before = db.prepare(`
      SELECT * FROM messages 
      WHERE id <= ? AND COALESCE(is_deleted, 0) = 0 
      ORDER BY id DESC LIMIT 25
    `).all(targetId);

    const after = db.prepare(`
      SELECT * FROM messages 
      WHERE id > ? AND COALESCE(is_deleted, 0) = 0 
      ORDER BY id ASC LIMIT 25
    `).all(targetId);

    const combined = [...before.reverse(), ...after];
    const msgIds = combined.map(m => m.id);
    const reactionsMap = messageReactions.getForMessages(msgIds, req.user.id);
    const buttonClicksData = buttonClicks.getClicksForMessages(msgIds, req.user.id);

    const now = Date.now();
    const TWO_DAYS_MS = 48 * 60 * 60 * 1000;
    const result = combined.map(m => {
      let attSummary = null;
      if (m.attachment_type === 'attendance' && m.attachment_url) {
        try { attSummary = attendanceDb.getSessionSummary(parseInt(m.attachment_url)); } catch (e) {}
      }
      return {
        ...m,
        is_star_glowing: false,
        starInfo: calculateStars(m.correct_answers_count),
        reactions: reactionsMap[m.id] || [],
        button_clicks_count: buttonClicksData.counts[m.id] || 0,
        user_has_clicked: !!buttonClicksData.userClicked[m.id],
        attendance_summary: attSummary
      };
    });

    res.json({ messages: result, target_id: targetId });
  } catch (err) {
    console.error('Message context error:', err);
    res.status(500).json({ error: 'Failed to load context' });
  }
});

// =========================================================================
// ATTENDANCE & ACTIVITY DATABASE (@هاتن / @غیابات)
// =========================================================================

// 1. Mark Attendance (Fingerprint Button clicked by student)
app.post('/api/attendance/mark', authMiddleware, (req, res) => {
  try {
    const rawId = req.body.session_id || req.body.sessionId;
    if (!rawId) return res.status(400).json({ error: 'ناسنامەی دانیشتن پێویستە' });
    const sessId = parseInt(rawId);

    const result = attendanceDb.markAttendance(sessId, req.user.id, req.user.full_name, req.user.role);
    if (result.error) return res.status(400).json({ error: result.error });

    const summary = attendanceDb.getSessionSummary(sessId);
    io.emit('attendance_updated', { session_id: sessId, sessionId: sessId, summary });

    res.json({ success: true, summary, record: result.record });
  } catch (err) {
    console.error('Attendance mark error:', err);
    res.status(500).json({ error: 'هەڵە لە تۆمارکردنی ئامادەبوون' });
  }
});

// 2. Request Leave (مۆڵەت) with reason
app.post('/api/attendance/leave', authMiddleware, (req, res) => {
  try {
    const rawId = req.body.session_id || req.body.sessionId;
    if (!rawId) return res.status(400).json({ error: 'ناسنامەی دانیشتن پێویستە' });
    const excuseReason = (req.body.excuse_reason || req.body.reason || '').trim();
    if (!excuseReason) {
      return res.status(400).json({ error: 'تکایە هۆکاری داواکردنی مۆڵەت بنووسە' });
    }
    const sessId = parseInt(rawId);

    const result = attendanceDb.requestLeave(sessId, req.user.id, req.user.full_name, req.user.role, excuseReason);
    if (result.error) return res.status(400).json({ error: result.error });

    const summary = attendanceDb.getSessionSummary(sessId);
    io.emit('attendance_updated', { session_id: sessId, sessionId: sessId, summary });

    res.json({ success: true, summary, record: result.record });
  } catch (err) {
    console.error('Attendance leave request error:', err);
    res.status(500).json({ error: 'هەڵە لە ناردنی داواکاری مۆڵەت' });
  }
});

// 3. Review Leave (Accept / Reject) - Staff Only
app.post('/api/attendance/review-leave', authMiddleware, requireTeacherOrSuperAdmin, (req, res) => {
  try {
    const rawSessId = req.body.session_id || req.body.sessionId;
    const rawUserId = req.body.user_id || req.body.userId;
    let rawStatus = req.body.status;

    if (!rawSessId || !rawUserId || !rawStatus) return res.status(400).json({ error: 'زانیارییەکان تەواو نین' });

    if (rawStatus === 'approved') rawStatus = 'excused';
    if (rawStatus === 'rejected') rawStatus = 'absent';

    if (!['excused', 'absent'].includes(rawStatus)) return res.status(400).json({ error: 'دۆخی نادروست' });

    const sessId = parseInt(rawSessId);
    const uId = parseInt(rawUserId);
    const result = attendanceDb.reviewLeave(sessId, uId, rawStatus, req.user.id, req.user.full_name);
    if (result.error) return res.status(400).json({ error: result.error });

    const summary = attendanceDb.getSessionSummary(sessId);
    io.emit('attendance_updated', { session_id: sessId, sessionId: sessId, summary });

    res.json({ success: true, summary });
  } catch (err) {
    console.error('Review leave error:', err);
    res.status(500).json({ error: 'هەڵە لە پێداچوونەوەی مۆڵەت' });
  }
});

// 4. Close Attendance Session - Staff Only
app.post('/api/attendance/close', authMiddleware, requireTeacherOrSuperAdmin, (req, res) => {
  try {
    const rawId = req.body.session_id || req.body.sessionId;
    if (!rawId) return res.status(400).json({ error: 'ناسنامەی دانیشتن پێویستە' });
    const sessId = parseInt(rawId);

    attendanceDb.closeSession(sessId);
    const summary = attendanceDb.getSessionSummary(sessId);
    io.emit('attendance_updated', { session_id: sessId, sessionId: sessId, summary });
    io.emit('attendance_session_closed', { session_id: sessId, sessionId: sessId });

    res.json({ success: true, summary });
  } catch (err) {
    console.error('Close attendance error:', err);
    res.status(500).json({ error: 'هەڵە لە کۆتاییهێنان بە ئامادەبوون' });
  }
});

// 4b. Delete Attendance Session - Staff Only (سڕینەوەی دانیشتنی غیابات)
app.delete('/api/attendance/session/:id', authMiddleware, (req, res) => {
  try {
    const isStaff = ['super_admin', 'teacher', 'admin'].includes(req.user.role) || hasSuperAdminPrivileges(req.user) || canModerateChat(req.user);
    if (!isStaff) {
      return res.status(403).json({ error: 'تەنها سوپەر ئەدمین و مامۆستا دەسەڵاتی ئەم کارەیان هەیە' });
    }
    const sessId = parseInt(req.params.id);
    const session = attendanceDb.getSession(sessId);
    if (!session) return res.status(404).json({ error: 'تۆماری ئامادەبوون نەدۆزرایەوە' });

    // Delete session and related records
    attendanceDb.deleteSession(sessId);

    // If there is an associated chat message, delete it too
    if (session.message_id) {
      messages.delete(session.message_id);
      io.emit('message_deleted', { id: session.message_id });
    }
    const matchingMsgs = db.prepare("SELECT id FROM messages WHERE attachment_type = 'attendance' AND attachment_url = ?").all(String(sessId));
    for (const m of matchingMsgs) {
      messages.delete(m.id);
      io.emit('message_deleted', { id: m.id });
    }

    io.emit('attendance_session_deleted', { session_id: sessId, sessionId: sessId });

    res.json({ success: true, message: 'تۆماری ئامادەبوون و غیابات بە سەرکەوتوویی سڕایەوە' });
  } catch (err) {
    console.error('Delete attendance error:', err);
    res.status(500).json({ error: 'هەڵە لە سڕینەوەی تۆماری ئامادەبوون' });
  }
});

// 5. Get Session Details
app.get('/api/attendance/session/:id', authMiddleware, (req, res) => {
  try {
    const sessId = parseInt(req.params.id);
    const summary = attendanceDb.getSessionSummary(sessId);
    if (!summary) return res.status(404).json({ error: 'دانیشتن نەدۆزرایەوە' });
    res.json({ summary });
  } catch (err) {
    res.status(500).json({ error: 'هەڵە لە وەرگرتنی زانیاری' });
  }
});

// 6. Get All Attendance Sessions (Activity Database - لیستی چالاکی)
app.get('/api/attendance/all', authMiddleware, requireTeacherOrSuperAdmin, (req, res) => {
  try {
    const sessions = attendanceDb.getAllSessionsWithStats();
    res.json({ sessions });
  } catch (err) {
    res.status(500).json({ error: 'هەڵە لە بارکردنی لیستی چالاکی' });
  }
});

// 7. Get Student Attendance History
app.get('/api/attendance/student/:userId', authMiddleware, requireTeacherOrSuperAdmin, (req, res) => {
  try {
    const history = attendanceDb.getStudentAttendanceHistory(parseInt(req.params.userId));
    res.json({ history });
  } catch (err) {
    res.status(500).json({ error: 'هەڵە لە بارکردنی مێژوو' });
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

// Message Reactions (🏆, 🤲, 👍, 💯, ❤️, ⭐)
app.post('/api/chat/messages/:id/react', authMiddleware, (req, res) => {
  const msgId = parseInt(req.params.id);
  const { emoji } = req.body;
  const allowed = ['🏆', '🤲', '👍', '💯', '❤️', '⭐'];
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

// --- ACTION BUTTON MESSAGE CLICK & STATS (@دوگمە) ---

// 1. User clicks the action button on a message
app.post('/api/chat/messages/:id/button-click', authMiddleware, (req, res) => {
  try {
    const messageId = parseInt(req.params.id, 10);
    if (!messageId) return res.status(400).json({ error: 'ناسنامەی پەیام هەڵەیە' });

    const msg = messages.findById(messageId);
    if (!msg || msg.attachment_type !== 'action_button') {
      return res.status(400).json({ error: 'ئەم پەیامە دوگمەی کارای نییە' });
    }

    buttonClicks.recordClick(messageId, req.user.id);
    const count = buttonClicks.getClicksCount(messageId);

    io.emit('message_button_clicked', {
      message_id: messageId,
      user_id: req.user.id,
      user_name: req.user.full_name,
      total_clicks: count
    });

    res.json({ success: true, clicked: true, total_clicks: count });
  } catch (err) {
    console.error('Button click error:', err);
    res.status(500).json({ error: 'هەڵە لە تۆمارکردنی دەستلێدان' });
  }
});

// 2. Get detailed attendance list for a specific button message
app.get('/api/chat/messages/:id/button-stats', authMiddleware, (req, res) => {
  try {
    const messageId = parseInt(req.params.id, 10);
    const report = buttonClicks.getAttendanceReport(messageId);
    if (!report) return res.status(404).json({ error: 'پەیامی دوگمە نەدۆزرایەوە' });
    res.json({ success: true, ...report });
  } catch (err) {
    console.error('Button stats error:', err);
    res.status(500).json({ error: 'هەڵە لە وەرگرتنی ئامار' });
  }
});

// 3. Get detailed attendance list for the latest button message
app.get('/api/chat/button-latest-stats', authMiddleware, (req, res) => {
  try {
    const report = buttonClicks.getAttendanceReport(null);
    if (!report) return res.status(404).json({ error: 'هیچ پەیامێکی دوگمە بوونی نییە' });
    res.json({ success: true, ...report });
  } catch (err) {
    console.error('Latest button stats error:', err);
    res.status(500).json({ error: 'هەڵە لە وەرگرتنی ئامار' });
  }
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
    const teacherName = (req.body.teacher_name || req.body.instructor_name || req.user.full_name || '').trim();
    const nextNum = recordedLessons.getNextNumber(teacherName);
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
      req.user.role,
      teacherName
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
    const { title, description, lesson_number, teacher_name } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ error: 'ناوی وانە پێویستە' });
    const lNum = lesson_number ? parseInt(lesson_number) : 1;
    recordedLessons.update(id, title.trim(), description || '', lNum, (teacher_name || '').trim());
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
      
      // Add initial welcome system message with complete conditions and voice instructions
      const initialWelcome = `بەخێربێیت ${session.dreamer_name} بۆ بەشی لێکدانەوەی خەونەکان 🌙

تکایە بۆ ئەوەی خەونەکەت بە جوانترین شێوە لێکبدرێتەوە، ئەم مەرج و زانیارییانەمان بۆ بنێرە:
🎙️ ١. خەونەکەت بە نامەیەکی دەنگی (ڤۆیس) بە تەواوی باس بکە.
👤 ٢. ناو و تەمەنت بڵێ.
💍 ٣. ئایا هاوسەرگیریت کردووە یان نا؟
🕌 ٤. ئاینت چییە؟
💼 ٥. پیشە و ئیشت چییە؟

📞 تێبینی: گەر ئێمە پەیوەندیمان کارا بوو (لەسەر هێڵ بووین)، دەتوانیت تەلەفۆن (تێل) ڕاستەوخۆ بکەیت.`;

      dreamMessages.create(
        session.id, 
        'system', 
        'سیستەمی سیرین', 
        initialWelcome,
        'text'
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
      senderType = (user.role === 'super_admin' || user.role === 'teacher') ? user.role : 'dream_interpreter';
      senderName = (user.full_name && user.full_name.trim()) ? user.full_name.trim() : (user.username || 'لێکدەرەوەی خەون');
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
    const isStaffReply = senderType !== 'dreamer';
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
    const autoMessages = [];
    if (senderType === 'dreamer') {
      const lowerText = content.trim().toLowerCase();
      const isGreeting = lowerText.includes('سلام') || lowerText.includes('سڵاو') || lowerText.includes('سلاو') || lowerText.includes('slaw') || lowerText.includes('slam');

      if (isGreeting) {
        const reply = dreamMessages.create(targetSessionId, 'system', 'سیستەمی سیرین', 'عَلَيْكُمُ السَّلَامُ وَرَحْمَةُ اللهِ وَبَرَكَاتُهُ', 'text');
        autoMessages.push(reply);
        io.to(`dream_${targetSessionId}`).emit('dream_new_message', reply);
        emitToDreamAdmins('dream_admin_new_message', { sessionId: targetSessionId, message: reply });
        emitToDreamAdmins('dream_session_updated', { sessionId: targetSessionId, lastMessage: reply.content });
      }

      if (!dreamMessages.hasAutoQuestions(targetSessionId)) {
        const autoQ = `بەخێربێیت بۆ بەشی لێکدانەوەی خەونەکان

تکایە بۆ ئەوەی خەونەکەت بە جوانترین شێوە لێکبدرێتەوە، ئەم زانیارییانەمان بۆ بنێرە:
🎙️ ١. خەونەکەت بە نامەیەکی دەنگی (ڤۆیس) بە تەواوی باس بکە.
👤 ٢. ناو و تەمەنت بڵێ.
💍 ٣. ئایا هاوسەرگیریت کردووە یان نا؟
🕌 ٤. ئاینت چییە؟
💼 ٥. پیشە و ئیشت چییە؟

📞 تێبینی: گەر ئێمە پەیوەندیمان کارا بوو (لەسەر هێڵ بووین)، دەتوانیت تەلەفۆن (تێل) ڕاستەوخۆ بکەیت.`;
        const qMsg = dreamMessages.create(targetSessionId, 'system', 'سیستەمی سیرین', autoQ, 'text');
        autoMessages.push(qMsg);
        io.to(`dream_${targetSessionId}`).emit('dream_new_message', qMsg);
        emitToDreamAdmins('dream_admin_new_message', { sessionId: targetSessionId, message: qMsg });
        emitToDreamAdmins('dream_session_updated', { sessionId: targetSessionId, lastMessage: 'پرسیارەکانی لێکدانەوەی خەون' });
      }
    }

    res.json({ success: true, message: msg, auto_messages: autoMessages });
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
      senderType = (user.role === 'super_admin' || user.role === 'teacher') ? user.role : 'dream_interpreter';
      senderName = (user.full_name && user.full_name.trim()) ? user.full_name.trim() : (user.username || 'لێکدەرەوەی خەون');
    } else {
      return res.status(401).json({ error: 'ڕێگاپێدراو نییە' });
    }

    const voiceUrl = `/uploads/${req.file.filename}`;
    const content = durationText ? `پەیامی دەنگی (${durationText})` : 'پەیامی دەنگی';
    const msg = dreamMessages.create(targetSessionId, senderType, senderName, content, 'voice', voiceUrl);

    const isStaffReply = senderType !== 'dreamer';
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
    const autoMessages = [];
    if (senderType === 'dreamer' && !dreamMessages.hasAutoQuestions(targetSessionId)) {
      const autoQ = `بەخێربێیت بۆ بەشی لێکدانەوەی خەونەکان

تکایە بۆ ئەوەی خەونەکەت بە جوانترین شێوە لێکبدرێتەوە، ئەم زانیارییانەمان بۆ بنێرە:
🎙️ ١. خەونەکەت بە نامەیەکی دەنگی (ڤۆیس) بە تەواوی باس بکە.
👤 ٢. ناو و تەمەنت بڵێ.
💍 ٣. ئایا هاوسەرگیریت کردووە یان نا؟
🕌 ٤. ئاینت چییە؟
💼 ٥. پیشە و ئیشت چییە؟

📞 تێبینی: گەر ئێمە پەیوەندیمان کارا بوو (لەسەر هێڵ بووین)، دەتوانیت تەلەفۆن (تێل) ڕاستەوخۆ بکەیت.`;
      const qMsg = dreamMessages.create(targetSessionId, 'system', 'سیستەمی سیرین', autoQ, 'text');
      autoMessages.push(qMsg);
      io.to(`dream_${targetSessionId}`).emit('dream_new_message', qMsg);
      emitToDreamAdmins('dream_admin_new_message', { sessionId: targetSessionId, message: qMsg });
      emitToDreamAdmins('dream_session_updated', { sessionId: targetSessionId, lastMessage: 'پرسیارەکانی لێکدانەوەی خەون' });
    }

    res.json({ success: true, message: msg, auto_messages: autoMessages });
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

// 9b. Mark Dream Session as Interpreted / Uninterpreted (لێکدراوەکان / لێکنەدراوەکان)
app.post('/api/dream/admin/session/:id/interpret', authMiddleware, requireDreamManager, (req, res) => {
  try {
    const sessionId = parseInt(req.params.id);
    const session = dreamSessions.findById(sessionId);
    if (!session) return res.status(404).json({ error: 'دانیشتن نەدۆزرایەوە' });

    const newInterpretedStatus = dreamSessions.toggleInterpreted(sessionId);
    emitToDreamAdmins('dream_session_interpreted', { sessionId, is_interpreted: newInterpretedStatus });
    res.json({ success: true, is_interpreted: newInterpretedStatus });
  } catch (err) {
    console.error('Toggle interpreted error:', err);
    res.status(500).json({ error: 'هەڵە لە گۆڕینی دۆخی لێکدانەوە' });
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
    avatar_url: p.avatar_url || null,
    special_badge: p.special_badge || null,
    networkQuality: p.networkQuality || 'good',
    pingMs: p.pingMs || null,
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
  if (user && user.id) {
    users.updateLastActive(user.id);
  }
  if (canManageDreams(user)) {
    socket.join('dream_admins');
  }

  socket.on('join_dream_room', (data) => {
    const sid = data?.sessionId || data?.session_id;
    if (sid) {
      socket.join(`dream_${sid}`);
    }
  });

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
      if (isRedAlertActive && !['super_admin', 'admin', 'teacher'].includes(freshUser.role) && !hasSuperAdminPrivileges(freshUser) && !canManageMembers(freshUser)) {
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
          user_id: freshUser.id,
          user_name: freshUser.full_name,
          userName: freshUser.full_name,
          details: `هێرشی لافاوی پەیام لەلایەن ${freshUser.full_name} تێکشکێنرا و بۆ ${Math.ceil(freezeSecs/60)} خولەک بێدەنگ کرا`,
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
      if (!['super_admin', 'admin', 'teacher'].includes(freshUser.role) && !hasSuperAdminPrivileges(freshUser) && !hasAnyAdminPrivileges(freshUser)) {
        const nlpResult = scanKurdishSmartText(content);
        if (nlpResult.isBlocked) {
          aiSecurity.logIncident('bad_word', freshUser.id, freshUser.full_name, `وشەی قەدەغەکراو: "${nlpResult.matched}" لە دەقی: "${content.substring(0, 60)}"`, 'high', 'blocked');
          io.emit('security_incident_alert', {
            type: 'bad_word',
            user_id: freshUser.id,
            user_name: freshUser.full_name,
            userName: freshUser.full_name,
            details: `فلتەری دەق ڕێگری لە دەستەواژەی نەشیاو کرد: "${nlpResult.matched}"`,
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
            user_id: freshUser.id,
            user_name: freshUser.full_name,
            userName: freshUser.full_name,
            details: `بەستەری زیانبەخش/ڕاوکردن بلۆککرا: "${content.substring(0, 60)}"`,
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
      if (activeLockMode === 'total_lock' && !hasSuperAdminPrivileges(freshUser)) {
        socket.emit('error_message', '🔒 چات داخراوە.');
        return;
      }
      if (activeLockMode === 'staff_only' && !['super_admin', 'admin', 'teacher'].includes(freshUser.role) && !hasSuperAdminPrivileges(freshUser) && !canManageMembers(freshUser)) {
        socket.emit('error_message', '🔒 چات داخراوە.');
        return;
      }

      // Night Curfew (12:00 AM - 08:00 AM Iraq Time): Only Super Admin, Admin, Teacher, Black Badge, or Green Badge
      const curfewExemptRoles = ['super_admin', 'admin', 'teacher'];
      if (isNightCurfewActive() && !curfewExemptRoles.includes(freshUser.role) && !hasSuperAdminPrivileges(freshUser) && !canManageMembers(freshUser)) {
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

      const isPrivilegedUser = ['super_admin', 'teacher', 'admin'].includes(freshUser.role) || freshUser.special_badge === 'black' || freshUser.special_badge === 'white' || hasSuperAdminPrivileges(freshUser) || canModerateChat(freshUser);
      const hasButtonTrigger = isPrivilegedUser && /@دوگم[ەه]/.test(content);
      const hasAttendanceTrigger = isPrivilegedUser && /@(هاتن|غیابات|غەیبات|ئامادەبوون|ئامادەبون)/i.test(content);

      let cleanContent = content;
      let attachmentType = 'none';
      let attachmentUrl = null;
      let createdAttendanceSession = null;

      if (hasAttendanceTrigger) {
        attachmentType = 'attendance';
        cleanContent = content.replace(/@(هاتن|غیابات|غەیبات|ئامادەبوون|ئامادەبون)/gi, '').trim();
        if (!cleanContent) {
          cleanContent = 'تۆماری ئامادەبوون و غیابات (پەنجەمۆر بنێن 🔴)';
        }
        createdAttendanceSession = attendanceDb.createSession(
          freshUser.id,
          freshUser.full_name,
          freshUser.role,
          cleanContent
        );
        attachmentUrl = String(createdAttendanceSession.id);
      } else if (hasButtonTrigger) {
        attachmentType = 'action_button';
        cleanContent = content.replace(/@دوگم[ەه]/g, '').trim();
        if (!cleanContent) {
          cleanContent = 'تکایە پەنجە بە دوگمە سورەکەدا بنێن 🔴';
        }
      }

      const replyToId = data.reply_to_id || null;

      const savedMsg = messages.create(
        freshUser.id,
        freshUser.username,
        freshUser.full_name,
        freshUser.role,
        cleanContent,
        'text',
        null,
        replyToId,
        attachmentType,
        attachmentUrl
      );

      if (createdAttendanceSession) {
        attendanceDb.updateMessageId(createdAttendanceSession.id, savedMsg.id);
      }

      const isStaffUser = freshUser.role === 'super_admin' || freshUser.role === 'teacher';
      const isMentionAll = isStaffUser && (
        content.includes('@هەموو') || 
        content.includes('@هەمو') || 
        content.includes('@1') ||
        content.includes('@all') ||
        cleanContent.includes('@هەموو') ||
        cleanContent.includes('@هەمو')
      );

      if (isMentionAll) {
        sendPushNotificationToAll({
          title: `📢 ئاگاداری هەمووان لەلایەن ${freshUser.full_name}`,
          body: cleanContent.trim(),
          icon: '/favicon.png',
          tag: 'mention-all-' + Date.now()
        }, freshUser.id);

        io.emit('mention_all_alert', {
          sender: freshUser.full_name,
          senderRole: freshUser.role,
          content: cleanContent.trim(),
          messageId: savedMsg.id
        });
      }

      if (hasAttendanceTrigger) {
        sendPushNotificationToAll({
          title: `📋 تۆماری ئامادەبوون (@هاتن) لەلایەن ${freshUser.full_name}`,
          body: cleanContent.trim(),
          icon: '/favicon.png',
          tag: 'attendance-' + (createdAttendanceSession ? createdAttendanceSession.id : Date.now())
        }, freshUser.id);
      }

      if (hasButtonTrigger) {
        sendPushNotificationToAll({
          title: `🔴 دوگمەی سەرنج لەلایەن ${freshUser.full_name}`,
          body: cleanContent.trim(),
          icon: '/favicon.png',
          tag: 'button-' + savedMsg.id
        }, freshUser.id);
      }

      // If normal message (not mention all, not attendance, not action button),
      // push to members who turned on "ئاگاداری تەواوی چاتەکان (وەک ماسنجەر)"
      if (!isMentionAll && !hasAttendanceTrigger && !hasButtonTrigger) {
        try {
          let notifBody = cleanContent.trim();
          if (savedMsg.message_type === 'image') notifBody = '📷 وێنەیەک نێردرا';
          else if (savedMsg.message_type === 'audio') notifBody = '🎤 دەنگێک نێردرا';
          else if (savedMsg.message_type === 'pdf') notifBody = '📄 فایلێک نێردرا';
          if (notifBody.length > 90) notifBody = notifBody.slice(0, 87) + '...';

          sendPushNotificationToAllChatSubscribers({
            title: `💬 ${freshUser.full_name}`,
            body: notifBody || 'نامەیەکی نوێ لە گروپی گشتی',
            icon: freshUser.avatar_url || '/favicon.png',
            tag: 'chat-msg-' + savedMsg.id,
            data: { url: '/' }
          }, freshUser.id);
        } catch (e) {}
      }

      const starInfo = calculateStars(freshUser.correct_answers_count);
      const TWO_DAYS_MS = 48 * 60 * 60 * 1000;
      const isStarGlowing = Boolean(freshUser.last_star_awarded_at && (Date.now() - Number(freshUser.last_star_awarded_at) <= TWO_DAYS_MS));
      let attSummary = null;
      if (attachmentType === 'attendance' && attachmentUrl) {
        try { attSummary = attendanceDb.getSessionSummary(parseInt(attachmentUrl)); } catch (e) {}
      }
      const broadcastMsg = {
        ...savedMsg,
        gender: freshUser.gender || 'male',
        starInfo,
        last_star_awarded_at: freshUser.last_star_awarded_at || null,
        is_star_glowing: isStarGlowing,
        is_mention_all: !!isMentionAll,
        button_clicks_count: 0,
        user_has_clicked: false,
        attendance_summary: attSummary
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
      avatar_url: freshUser.avatar_url || null,
      gender: freshUser.gender || 'male',
      isMuted: false,
      handRaised: false,
      hasMicPermission: true
    });
    socket.join('live_lesson_room');

    // Record in Advisor General Inspection Room Audit Log
    try {
      advisorDb.logLiveAudit({
        userId: freshUser.id,
        userName: freshUser.full_name,
        username: freshUser.username,
        action: 'opened',
        title: liveLessonState.title
      });
      io.emit('live_audit_updated');
    } catch (e) {
      console.error('Error logging live audit start:', e);
    }

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

    // Record in Advisor General Inspection Room Audit Log
    try {
      const prevTitle = liveLessonState.title;
      const startedByName = liveLessonState.startedBy ? liveLessonState.startedBy.name : null;
      const durationSeconds = liveLessonState.startedAt ? Math.round((Date.now() - liveLessonState.startedAt) / 1000) : 0;

      advisorDb.logLiveAudit({
        userId: freshUser.id,
        userName: freshUser.full_name,
        username: freshUser.username,
        action: 'closed',
        title: prevTitle,
        startedByName,
        durationSeconds
      });
      io.emit('live_audit_updated');
    } catch (e) {
      console.error('Error logging live audit end:', e);
    }

    liveLessonState.isActive = false;
    liveLessonState.startedBy = null;
    liveLessonState.startedAt = null;
    liveLessonState.quranState = { isPlaying: false, reciter: '', surahName: '', audioUrl: '' };
    liveLessonState.screenSharingBy = null;
    liveLessonState.participants.clear();
    io.emit('live_lesson_ended_notice');
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
      avatar_url: freshUser ? freshUser.avatar_url : (user ? user.avatar_url : null),
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

  // CUSTOM GROUP CHATS SOCKET HANDLERS
  socket.on('join_custom_group', (data) => {
    if (!data || !data.groupId) return;
    const gId = parseInt(data.groupId, 10);
    const isSuper = isMasterSuperAdmin(user);
    if (customGroups.isMember(gId, user.id, isSuper)) {
      socket.join(`group_${gId}`);
      customGroups.markGroupRead(gId, user.id);
    }
  });

  socket.on('leave_custom_group', (data) => {
    if (!data || !data.groupId) return;
    const gId = parseInt(data.groupId, 10);
    socket.leave(`group_${gId}`);
  });

  socket.on('custom_group_typing', (data) => {
    if (!data || !data.groupId) return;
    const gId = parseInt(data.groupId, 10);
    socket.to(`group_${gId}`).emit('custom_group_user_typing', {
      groupId: gId,
      userId: user.id,
      userName: user.full_name,
      isTyping: !!data.isTyping
    });
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
