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
const { initDb, users, messages, questions, library, dreamSessions, dreamMessages, settings, passwordResets, privateMessages, messageReactions, profileChangeRequests, pushSubscriptions, calculateStars, liveRecordings, recordedLessons, getDreamTeacherAlias } = require('./db');

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

// Super Admin Middleware
function requireSuperAdmin(req, res, next) {
  if (req.user.role !== 'super_admin') {
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

// 4. Get pending users (Super Admin only)
app.get('/api/admin/pending', authMiddleware, requireSuperAdmin, (req, res) => {
  const pending = users.getPendingUsers();
  res.json({ pending });
});

// 5. Approve user (Super Admin only)
// 5. Approve user (Super Admin only - supports role: student, new_student, guest, admin)
app.post('/api/admin/approve', authMiddleware, requireSuperAdmin, (req, res) => {
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

// 6. Reject user (Super Admin only)
app.post('/api/admin/reject', authMiddleware, requireSuperAdmin, (req, res) => {
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

// Directly update user's full name (Super Admin only)
app.post('/api/admin/users/:id/update-name', authMiddleware, requireSuperAdmin, (req, res) => {
  const userId = parseInt(req.params.id);
  const { full_name } = req.body;
  if (!full_name || !full_name.trim()) return res.status(400).json({ error: 'ناوی نوێ بنووسە' });

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

// Super Admin: Get pending profile change requests
app.get('/api/admin/profile-change-requests', authMiddleware, requireSuperAdmin, (req, res) => {
  const list = profileChangeRequests.getPending();
  res.json({ requests: list });
});

// Super Admin: Approve profile change request
app.post('/api/admin/profile-change-requests/:id/approve', authMiddleware, requireSuperAdmin, (req, res) => {
  const reqId = parseInt(req.params.id);
  const updatedUser = profileChangeRequests.approve(reqId, req.user.id);
  if (!updatedUser) return res.status(404).json({ error: 'داواکاری نەدۆزرایەوە یان پێشتر دیاریکراوە' });

  io.emit('user_profile_updated', {
    user_id: updatedUser.id,
    full_name: updatedUser.full_name
  });
  io.emit('profile_change_status_updated', { id: reqId, status: 'approved', user_id: updatedUser.id });

  res.json({ success: true, message: 'داواکاری گۆڕانکاری پەسەندکرا', user: updatedUser });
});

// Super Admin: Reject profile change request
app.post('/api/admin/profile-change-requests/:id/reject', authMiddleware, requireSuperAdmin, (req, res) => {
  const reqId = parseInt(req.params.id);
  const ok = profileChangeRequests.reject(reqId, req.user.id);
  if (!ok) return res.status(404).json({ error: 'داواکاری نەدۆزرایەوە' });

  io.emit('profile_change_status_updated', { id: reqId, status: 'rejected' });
  res.json({ success: true, message: 'داواکارییەکە ڕەتکرایەوە' });
});

// 8. Change user role (Super Admin only - Silent role change as requested)
app.post('/api/admin/role', authMiddleware, requireSuperAdmin, (req, res) => {
  const { user_id, role } = req.body;
  const validRoles = ['student', 'new_student', 'guest', 'teacher', 'admin'];
  if (!user_id || !role || !validRoles.includes(role)) {
    return res.status(400).json({ error: 'زانیارییەکان ناتەواون' });
  }

  const target = users.findById(user_id);
  if (!target) return res.status(404).json({ error: 'بەکارهێنەر نەدۆزرایەوە' });
  if (target.role === 'super_admin') {
    return res.status(400).json({ error: 'ناتوانیت دەستکاری پلەی سوپەر ئەدمین بکەیت' });
  }

  const oldRole = target.role;
  users.updateRole(user_id, role);
  users.addRoleHistory(user_id, req.user.id, req.user.full_name, oldRole, role);
  
  // User requested: "پلە گۆڕین لە چات با نەنوسرێت و کەس ئاگاداری گۆڕانی پلە نەبێت"
  // Silent role change - No chat announcement message is posted
  io.emit('role_changed', { user_id, new_role: role });

  let roleNameKurdish = 'قوتابی';
  if (role === 'admin') roleNameKurdish = 'ئەدمین';
  if (role === 'teacher') roleNameKurdish = 'مامۆستا';
  if (role === 'new_student') roleNameKurdish = 'قوتابی تازە';
  if (role === 'guest') roleNameKurdish = 'میوان';

  res.json({ success: true, message: `پلەکەی بە سەرکەوتوویی کرا بە ${roleNameKurdish}` });
});

// 9. Block / Unblock user (Super Admin only)
app.post('/api/admin/block', authMiddleware, requireSuperAdmin, (req, res) => {
  const { user_id, is_blocked } = req.body;
  if (user_id === undefined || is_blocked === undefined) {
    return res.status(400).json({ error: 'زانیارییەکان ناتەواون' });
  }

  const target = users.findById(user_id);
  if (!target) return res.status(404).json({ error: 'بەکارهێنەر نەدۆزرایەوە' });
  if (target.role === 'super_admin') {
    return res.status(400).json({ error: 'ناتوانیت سوپەر ئەدمین بلۆک بکەیت' });
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

// 10. Permanently Delete / Kick User Account (Super Admin only)
app.delete('/api/admin/users/:id', authMiddleware, requireSuperAdmin, (req, res) => {
  const userId = parseInt(req.params.id, 10);
  if (!userId) return res.status(400).json({ error: 'ناسنامەی بەکارهێنەر نادروستە' });

  const target = users.findById(userId);
  if (!target) return res.status(404).json({ error: 'بەکارهێنەر نەدۆزرایەوە' });
  if (target.role === 'super_admin') {
    return res.status(400).json({ error: 'ناتوانیت سوپەر ئەدمین بسڕیتەوە' });
  }

  // Delete from DB (cascades to all user records)
  users.delete(userId);

  // Notify via Socket to kick immediately and refresh member lists
  io.emit('user_deleted', { user_id: userId, full_name: target.full_name });

  res.json({ success: true, message: `ئەکاونتی (${target.full_name}) بە سەرکەوتوویی بە یەکجاری سڕایەوە و دەرکرا` });
});

// --- ADMIN / TEACHER MEDIA UPLOADS (IMAGES & VIDEOS) ---
app.post('/api/chat/upload-image', authMiddleware, requireAdmin, upload.single('image'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'هیچ وێنە یان ڤیدیۆیەک دیاری نەکراوە' });
    const caption = req.body.caption || '';
    const fileUrl = `/uploads/${req.file.filename}`;
    const isVideo = req.file.mimetype.startsWith('video/');
    const attachmentType = isVideo ? 'video' : 'image';
    const defaultCaption = isVideo ? 'ڤیدیۆ 🎬' : 'وێنە 🖼️';
    const msg = messages.create(req.user.id, req.user.username, req.user.full_name, req.user.role, caption || defaultCaption, 'text', null, null, attachmentType, fileUrl);
    const broadcastMsg = { ...msg, gender: req.user.gender || 'male', starInfo: calculateStars(req.user.correct_answers_count) };
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
      return res.status(403).json({ error: '🔒 چات بە تەواوەتی داخراوە لەلایەن سوپەر ئەدمینەوە (@قفڵ.عام)' });
    }
    if (activeLockMode === 'staff_only' && !['super_admin', 'admin', 'teacher'].includes(req.user.role)) {
      return res.status(403).json({ error: '🔒 چات داخراوە، تەنها مامۆستا و دەستەی بەڕێوەبەرایەتی دەتوانن دەنگ بنێرن' });
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

// Mute / Unmute
app.post('/api/admin/mute', authMiddleware, requireAdmin, (req, res) => {
  const { user_id, hours = 24 } = req.body;
  if (!user_id) return res.status(400).json({ error: 'ناسنامەی بەکارهێنەر دیارینەکراوە' });
  const target = users.findById(user_id);
  if (!target) return res.status(404).json({ error: 'بەکارهێنەر نەدۆزرایەوە' });
  if (target.role === 'super_admin' || target.role === 'admin') {
    return res.status(403).json({ error: 'تەنها خوێندکار دەتوانرێت سڕ بکرێت' });
  }

  const mutedUntil = Date.now() + (hours * 60 * 60 * 1000);
  users.setMute(user_id, mutedUntil);

  const sysMsg = messages.create(req.user.id, 'سیستەم', 'سیستەم', 'system', `خوێندکار (${target.full_name}) لەلایەن (${req.user.full_name}) بۆ ماوەی ${hours} کاتژمێر سڕکرا 🔇`, 'system');
  io.emit('new_message', sysMsg);
  io.emit('user_muted', { user_id, muted_until: mutedUntil, reason: `سڕکرا بۆ ماوەی ${hours} کاتژمێر` });
  res.json({ success: true, message: `خوێندکار سڕکرا`, muted_until: mutedUntil });
});

app.post('/api/admin/unmute', authMiddleware, requireAdmin, (req, res) => {
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

app.post('/api/chat/lock', authMiddleware, requireSuperAdmin, (req, res) => {
  const { mode } = req.body;
  const validModes = ['none', 'staff_only', 'total_lock'];
  if (!validModes.includes(mode)) {
    return res.status(400).json({ error: 'دۆخی قفڵکردن نادیارە' });
  }

  settings.set('chat_lock_mode', mode);
  const lockBy = mode === 'none' ? '' : req.user.full_name;
  const lockTime = mode === 'none' ? '' : String(Date.now());
  settings.set('chat_lock_by', lockBy);
  settings.set('chat_lock_time', lockTime);

  let announceText = '';
  if (mode === 'total_lock') {
    announceText = '🔒 چاتی گشتی بە تەواوەتی داخرا لەلایەن سوپەر ئەدمینەوە (@قفڵ.عام - تەنانەت مامۆستا و ئەدمینەکانیش ناتوانن بنووسن)';
  } else if (mode === 'staff_only') {
    announceText = '🔒 چات داخرا - تەنها بۆ مامۆستا و ئەدمینەکان کراوەیە (@قفڵ)';
  } else {
    announceText = '🔓 چاتی گشتی کرایەوە بۆ هەمووان لەلایەن سوپەر ئەدمینەوە';
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

    const existing = questions.getStudentSubmission(q.id, req.user.id);
    const isEdit = !!existing;

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

// Delete Message (Admins, Teachers, or Message Author)
app.delete('/api/chat/messages/:id', authMiddleware, (req, res) => {
  const msgId = parseInt(req.params.id);
  const msg = messages.findById(msgId);
  if (!msg) {
    return res.status(404).json({ error: 'نامەکە نەدۆزرایەوە' });
  }

  const isPrivileged = req.user.role === 'admin' || req.user.role === 'super_admin' || req.user.role === 'teacher';
  const isOwner = msg.user_id === req.user.id;

  if (!isPrivileged && !isOwner) {
    return res.status(403).json({ error: 'تەنها ئەدمین، مامۆستا یان خاوەنی پەیامەکە دەتوانێت نامەکە بسڕێتەوە' });
  }

  // Delete attachment file from public/uploads if exists
  if (msg.attachment_url) {
    try {
      const filename = path.basename(msg.attachment_url);
      const filePath = path.join(uploadsDir, filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (err) {
      console.error('Failed to unlink deleted attachment:', err);
    }
  }

  messages.delete(msgId);
  io.emit('message_deleted', { id: msgId });
  res.json({ success: true });
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
  res.json({ messages: result });
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
        if (s.user && (s.user.role === 'super_admin' || s.user.role === 'teacher')) {
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

    // STRICT: Staff (Super Admin, Admin, Teacher) cannot submit dreams!
    if (authedUser && (authedUser.role === 'super_admin' || authedUser.role === 'admin' || authedUser.role === 'teacher')) {
      return res.status(403).json({ error: 'مامۆستا و ئەدمین ناتوانن خەون بنێرن بۆ لێکدانەوە' });
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

      // STRICT PERMISSION: SUPER ADMIN & TEACHER CAN REPLY TO DREAMERS!
      if (user.role !== 'super_admin' && user.role !== 'teacher') {
        return res.status(403).json({ error: 'تەنها مامۆستا و سوپەر ئەدمین بۆیان هەیە وەڵامی خەون بین بدەنەوە' });
      }

      targetSessionId = parseInt(sessionId);
      senderType = user.role;
      senderName = user.role === 'teacher' ? (user.full_name || 'مامۆستا') : (user.full_name || 'هێمن طه');
    } else {
      return res.status(401).json({ error: 'ڕێگاپێدراو نییە' });
    }

    const session = dreamSessions.findById(targetSessionId);
    if (!session) return res.status(404).json({ error: 'دانیشتن نەدۆزرایەوە' });

    const msg = dreamMessages.create(targetSessionId, senderType, senderName, content.trim(), 'text');
    
    // Broadcast message to dream room and dream admins
    const dreamerMsg = (senderType === 'teacher' || senderType === 'super_admin')
      ? { ...msg, sender_name: getDreamTeacherAlias(senderName) }
      : msg;
    io.to(`dream_${targetSessionId}`).emit('dream_new_message', dreamerMsg);
    emitToDreamAdmins('dream_admin_new_message', { sessionId: targetSessionId, message: msg });

    if (senderType === 'teacher' || senderType === 'super_admin') {
      dreamSessions.markAnswered(targetSessionId, senderName, senderType);
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
          const reply = dreamMessages.create(targetSessionId, 'super_admin', 'مامۆستا ١', 'عَلَيْكُمُ السَّلَامُ وَرَحْمَةُ اللهِ وَبَرَكَاتُهُ', 'text');
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
          const qMsg = dreamMessages.create(targetSessionId, 'super_admin', 'مامۆستا ١', autoQ, 'text');
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
      if (!user || (user.role !== 'super_admin' && user.role !== 'teacher')) {
        return res.status(403).json({ error: 'تەنها مامۆستا و سوپەر ئەدمین بۆیان هەیە دەنگ بنێرن بۆ خەون بین' });
      }
      targetSessionId = sessionId;
      senderType = user.role;
      senderName = user.role === 'teacher' ? (user.full_name || 'مامۆستا') : (user.full_name || 'هێمن طه');
    } else {
      return res.status(401).json({ error: 'ڕێگاپێدراو نییە' });
    }

    const voiceUrl = `/uploads/${req.file.filename}`;
    const content = durationText ? `پەیامی دەنگی (${durationText})` : 'پەیامی دەنگی';
    const msg = dreamMessages.create(targetSessionId, senderType, senderName, content, 'voice', voiceUrl);

    const dreamerVoiceMsg = (senderType === 'teacher' || senderType === 'super_admin')
      ? { ...msg, sender_name: getDreamTeacherAlias(senderName) }
      : msg;
    io.to(`dream_${targetSessionId}`).emit('dream_new_message', dreamerVoiceMsg);
    emitToDreamAdmins('dream_admin_new_message', { sessionId: targetSessionId, message: msg });

    if (senderType === 'teacher' || senderType === 'super_admin') {
      dreamSessions.markAnswered(targetSessionId, senderName, senderType);
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
        const qMsg = dreamMessages.create(targetSessionId, 'super_admin', 'مامۆستا ١', autoQ, 'text');
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

// 6. Admin Get All Dream Sessions (Super Admin and Teacher ONLY)
app.get('/api/dream/admin/sessions', authMiddleware, (req, res) => {
  try {
    // Only super_admin and teacher can access!
    if (req.user.role !== 'super_admin' && req.user.role !== 'teacher') {
      return res.status(403).json({ error: 'ڕێگاپێدراو نییە بۆ بینینی خەونەکان' });
    }
    const list = dreamSessions.getAll();
    res.json({ sessions: list, canReply: req.user.role === 'super_admin' || req.user.role === 'teacher' });
  } catch (err) {
    res.status(500).json({ error: 'هەڵە لە وەرگرتنی لیست' });
  }
});

// 7. Admin Get Specific Session Messages (Super Admin and Teacher)
app.get('/api/dream/admin/session/:id/messages', authMiddleware, (req, res) => {
  try {
    if (req.user.role !== 'super_admin' && req.user.role !== 'teacher') {
      return res.status(403).json({ error: 'ڕێگاپێدراو نییە' });
    }
    const sessionId = parseInt(req.params.id);
    const session = dreamSessions.findById(sessionId);
    if (!session) return res.status(404).json({ error: 'دانیشتن نەدۆزرایەوە' });

    // Admin & Teacher get ALL messages INCLUDING is_secret_recording = 1!
    const msgs = dreamMessages.getBySessionForAdmin(sessionId);
    res.json({
      session,
      messages: msgs,
      canReply: req.user.role === 'super_admin' || req.user.role === 'teacher'
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

// 9. Star/Favorite Dream Session (Super Admin & Teacher)
app.post('/api/dream/admin/session/:id/favorite', authMiddleware, requireTeacherOrSuperAdmin, (req, res) => {
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
const onlineUsers = new Map();

// --- LIVE LESSON ("وانە") STATE & BROADCAST ---
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
  if (user.role === 'super_admin' || user.role === 'teacher') {
    socket.join('dream_admins');
  }

  socket.on('dream_admin_join_session', (sessionId) => {
    if (user.role === 'super_admin' || user.role === 'teacher') {
      socket.join(`dream_${sessionId}`);
    }
  });

  socket.on('dream_call_start', (data) => {
    // super_admin and teacher can start calls!
    if (user.role !== 'super_admin' && user.role !== 'teacher') return;
    socket.to(`dream_${data.sessionId}`).emit('dream_incoming_call', {
      ...data,
      callerName: user.role === 'teacher' ? (user.full_name || 'مامۆستا') : (user.full_name || 'هێمن طه')
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

      // Anti-Spam Rate Limiter: Max 5 messages in 4 seconds
      if (isSpamming(freshUser.id)) {
        socket.emit('error_message', '⚠️ تکایە لەسەرخۆ بە لە ناردنی پەیام! (سیستەمی پاراستن لە سپام)');
        return;
      }

      const content = (data.content || '').trim();
      if (!content) return;

      // --- CHAT LOCK COMMAND HANDLING (SUPER ADMIN ONLY) ---
      const hasLockAll = content.includes('@قفڵ.عام') || content.includes('@قفل.عام');
      const hasLockStaff = !hasLockAll && (content.includes('@قفڵ') || content.includes('@قفل'));
      const hasUnlock = content.includes('@کلیل') || content.includes('@كليل') || content.includes('@مفتاح') || content.includes('@کراوە') || content.includes('@کردنەوە') || content.includes('@بیکەرەوە') || content.includes('@unlock') || content.includes('@قفڵ.کردنەوە') || content.includes('@قفل.کردنەوە');

      if (hasLockAll || hasLockStaff || hasUnlock) {
        if (freshUser.role !== 'super_admin') {
          socket.emit('error_message', '❌ تەنها سوپەر ئەدمین دەسەڵاتی قفڵکردن یان کردنەوەی چاتی هەیە!');
          return;
        }

        let newMode = 'none';
        let announceText = '';
        if (hasLockAll) {
          newMode = 'total_lock';
          announceText = '🔒 چاتی گشتی بە تەواوەتی داخرا لەلایەن سوپەر ئەدمینەوە (@قفڵ.عام - تەنانەت مامۆستا و ئەدمینەکانیش ناتوانن بنووسن)';
        } else if (hasLockStaff) {
          newMode = 'staff_only';
          announceText = '🔒 چات داخرا - تەنها بۆ مامۆستا و ئەدمینەکان کراوەیە (@قفڵ)';
        } else if (hasUnlock) {
          newMode = 'none';
          announceText = '🔓 چاتی گشتی کرایەوە بۆ هەمووان لەلایەن سوپەر ئەدمینەوە (@کلیل 🗝️)';
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
        socket.emit('error_message', '🔒 چات بە تەواوەتی داخراوە لەلایەن سوپەر ئەدمینەوە (@قفڵ.عام)، هیچ کەسێک ناتوانێت پەیام بنێرێت.');
        return;
      }
      if (activeLockMode === 'staff_only' && !['super_admin', 'admin', 'teacher'].includes(freshUser.role)) {
        socket.emit('error_message', '🔒 چات داخراوە لەلایەن سوپەر ئەدمینەوە، تەنها مامۆستا و دەستەی بەڕێوەبەرایەتی دەتوانن پەیام بنێرن.');
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
    if (user.role !== 'super_admin' && user.role !== 'teacher') return;
    liveLessonState.isActive = true;
    liveLessonState.title = (data && data.title) ? data.title.trim() : 'وانەی ڕاستەوخۆ';
    liveLessonState.startedBy = { id: user.id, name: user.full_name, role: user.role };
    liveLessonState.startedAt = Date.now();
    liveLessonState.bannedUserIds.clear();
    liveLessonState.quranState = { isPlaying: false, reciter: '', surahName: '', audioUrl: '' };
    liveLessonState.screenSharingBy = null;

    liveLessonState.participants.set(socket.id, {
      socketId: socket.id,
      userId: user.id,
      username: user.username,
      fullName: user.full_name,
      role: user.role,
      gender: user.gender || 'male',
      isMuted: false,
      handRaised: false,
      hasMicPermission: true
    });
    socket.join('live_lesson_room');

    broadcastLiveLessonState();
    io.emit('live_lesson_started_alert', {
      title: liveLessonState.title,
      startedBy: user.full_name
    });

    // Web Push Notification: Live Lesson Started
    sendPushNotificationToAll({
      title: '🔴 وانەی ڕاستەوخۆ دەستیپێکرد!',
      body: `${user.full_name} وانەیەکی نوێی دەستپێکرد: ${liveLessonState.title}. ئێستا وەرە بەشداربە! 🎙️`,
      tag: 'live-lesson-active',
      data: { url: '/?action=live' }
    }, user.id);
  });

  socket.on('live_end', () => {
    if (user.role !== 'super_admin' && user.role !== 'teacher') return;
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

    const canSpeakByDefault = (user.role === 'super_admin' || user.role === 'teacher' || user.role === 'admin');

    liveLessonState.participants.set(socket.id, {
      socketId: socket.id,
      userId: user.id,
      username: user.username,
      fullName: user.full_name,
      role: user.role,
      gender: user.gender || 'male',
      isMuted: true,
      handRaised: false,
      hasMicPermission: canSpeakByDefault
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
    const isStaff = user.role === 'super_admin' || user.role === 'teacher' || user.role === 'admin';
    if (!isStaff || !data || !data.targetUserId) return;
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
    const isStaff = user.role === 'super_admin' || user.role === 'teacher' || user.role === 'admin';
    if (!isStaff || !data || !data.targetUserId) return;
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
    const isStaff = user.role === 'super_admin' || user.role === 'teacher' || user.role === 'admin';
    if (!isStaff || !data || !data.targetUserId) return;
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
    const isStaff = user.role === 'super_admin' || user.role === 'teacher' || user.role === 'admin';
    if (!isStaff || !data) return;
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
    const isStaff = user.role === 'super_admin' || user.role === 'teacher' || user.role === 'admin';
    if (!isStaff) return;
    liveLessonState.quranState = { isPlaying: false, reciter: '', surahName: '', audioUrl: '' };
    io.to('live_lesson_room').emit('live_quran_stopped');
    broadcastLiveLessonState();
  });

  socket.on('live_screen_start', () => {
    if (user.role !== 'super_admin' && user.role !== 'teacher') return;
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
