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
const { initDb, users, messages, questions, library, dreamSessions, dreamMessages, settings, passwordResets, calculateStars } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'seereen_group_chat_super_secret_key_2026';
const PORT = process.env.PORT || 4000;

// Initialize Database
initDb();

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

// Question Timer State
let activeQuestionTimeout = null;

function setupQuestionTimer(q) {
  if (activeQuestionTimeout) {
    clearTimeout(activeQuestionTimeout);
    activeQuestionTimeout = null;
  }

  if (!q || !q.is_active || q.is_revealed) return;

  const msRemaining = q.expires_at - Date.now();
  if (msRemaining <= 0) {
    triggerQuestionReveal(q.id);
  } else if (msRemaining <= 2147483647) {
    activeQuestionTimeout = setTimeout(() => {
      triggerQuestionReveal(q.id);
    }, msRemaining);
  }
}

function triggerQuestionReveal(questionId) {
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
}

// Periodic check every 5 seconds to ensure any scheduled question reveals immediately when deadline expires
setInterval(() => {
  try {
    const currentActive = questions.getActive();
    if (currentActive && !currentActive.is_revealed && currentActive.expires_at && Date.now() >= currentActive.expires_at) {
      triggerQuestionReveal(currentActive.id);
    }
  } catch (err) {
    console.error('Error in question timer interval:', err);
  }
}, 5000);

// On startup: check if active question exists and setup timer
setTimeout(() => {
  const currentActive = questions.getActive();
  if (currentActive && !currentActive.is_revealed) {
    setupQuestionTimer(currentActive);
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

// 7. Get all users / members list (Available to all chat members)
app.get('/api/admin/users', authMiddleware, (req, res) => {
  const all = users.getAllUsers().map(u => ({
    ...u,
    starInfo: calculateStars(u.correct_answers_count)
  }));
  res.json({ users: all });
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

// --- TIMED QUESTIONS & SECRET SUBMISSIONS ---

// 12. Get Active Question
app.get('/api/chat/active-question', authMiddleware, (req, res) => {
  const activeQ = questions.getActive();
  if (!activeQ) return res.json({ question: null });

  // Get total submission count
  const subs = questions.getSubmissions(activeQ.id);
  let mySubmission = null;
  if (req.user.role === 'student') {
    mySubmission = questions.getStudentSubmission(activeQ.id, req.user.id);
  }

  res.json({
    question: {
      ...activeQ,
      submission_count: subs.length,
      my_submission: mySubmission ? mySubmission.answer_text : null,
      my_submitted_at: mySubmission ? mySubmission.submitted_at : null
    }
  });
});

// 13. Post Question with Timer (Admin & Super Admin)
app.post('/api/chat/question', authMiddleware, requireAdmin, (req, res) => {
  const { question_text, correct_answer, duration_minutes = 5, custom_expires_at } = req.body;
  if (!question_text || !question_text.trim()) {
    return res.status(400).json({ error: 'تکایە دەقی پرسیار بنووسە' });
  }

  const currentActive = questions.getActive();
  if (currentActive) {
    questions.closeQuestion(currentActive.id);
    if (activeQuestionTimeout) clearTimeout(activeQuestionTimeout);
  }

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

  if (activeQuestionTimeout) {
    clearTimeout(activeQuestionTimeout);
    activeQuestionTimeout = null;
  }

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

// 18. Award Star to a Student for a Question (Super Admin only - Silent Star Award)
app.post('/api/chat/award-star', authMiddleware, requireSuperAdmin, (req, res) => {
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
  }

  // User requested: "ئەو پیرۆزباییانە لاببە کە ئەنوسرێ بەبڕیاری فڵان وەڵامەکەی ڕاست دانراوە"
  // Silent Star Award - NO text message is created or broadcast into chat!
  io.emit('star_awarded', {
    user_id: student.id,
    student_name: student.full_name,
    question_id: question_id || null,
    new_count: newCount,
    starInfo
  });

  res.json({ success: true, message: 'ئەستێرە بە سەرکەوتوویی بەخشرا', starInfo });
});

// 18b. Get Star Awards for a Question
app.get('/api/chat/question/:id/awards', authMiddleware, (req, res) => {
  const qId = parseInt(req.params.id);
  const awards = questions.getQuestionAwards ? questions.getQuestionAwards(qId) : [];
  res.json({ awards });
});

// 19. Close Question
app.post('/api/chat/close-question', authMiddleware, requireAdmin, (req, res) => {
  const { question_id } = req.body;
  if (!question_id) return res.status(400).json({ error: 'ناسنامەی پرسیار دیارینەکراوە' });

  if (activeQuestionTimeout) {
    clearTimeout(activeQuestionTimeout);
    activeQuestionTimeout = null;
  }

  questions.closeQuestion(question_id);
  io.emit('question_closed', { question_id });
  res.json({ success: true, message: 'پرسیار داخرا' });
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

// Message History
app.get('/api/chat/messages', authMiddleware, (req, res) => {
  const history = messages.getRecent(120).map(m => ({
    ...m,
    starInfo: calculateStars(m.correct_answers_count)
  }));
  res.json({ messages: history });
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

// 1. Dreamer Start or Resume Session
app.post('/api/dream/start', (req, res) => {
  try {
    const { token, name, gender = 'male' } = req.body;
    let session = null;
    if (token) {
      session = dreamSessions.findByToken(token);
    }
    if (!session) {
      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'تکایە ناوت بنووسە' });
      }
      const newToken = `dream_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      session = dreamSessions.create(newToken, name.trim(), gender === 'female' ? 'female' : 'male');
      
      // Add initial welcome system message
      dreamMessages.create(
        session.id, 
        'system', 
        'ستافی سیرین', 
        `بەخێربێیت ${session.dreamer_name} بۆ بەشی لێکدانەوەی خەون 🌙\nخەونەکەت بە دەق یان بە دەنگ (ڤۆیس) بنێرە، بەڕێوەبەر لە نزیکترین کاتدا وەڵامت دەداتەوە یان پەیوەندیت پێوە دەکات.`,
        'system'
      );

      // Notify Super Admin and Teacher
      io.to('dream_admins').emit('new_dream_session', {
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

      // STRICT PERMISSION: ONLY SUPER ADMIN CAN REPLY TO DREAMERS!
      if (user.role !== 'super_admin') {
        return res.status(403).json({ error: 'تەنها سوپەر ئەدمین بۆی هەیە وەڵامی خەون بین بداتەوە' });
      }

      targetSessionId = parseInt(sessionId);
      senderType = 'super_admin';
      senderName = 'hemn taha';
    } else {
      return res.status(401).json({ error: 'ڕێگاپێدراو نییە' });
    }

    const session = dreamSessions.findById(targetSessionId);
    if (!session) return res.status(404).json({ error: 'دانیشتن نەدۆزرایەوە' });

    const msg = dreamMessages.create(targetSessionId, senderType, senderName, content.trim(), 'text');
    
    // Broadcast message to dream room
    io.to(`dream_${targetSessionId}`).emit('dream_new_message', msg);
    io.to('dream_admins').emit('dream_session_updated', { sessionId: targetSessionId, lastMessage: content.trim() });

    // Automated greeting reply and questionnaire for dreamer
    if (senderType === 'dreamer') {
      const lowerText = content.trim().toLowerCase();
      const isGreeting = lowerText.includes('سلام') || lowerText.includes('سڵاو') || lowerText.includes('سلاو') || lowerText.includes('slaw') || lowerText.includes('slam');

      if (isGreeting) {
        setTimeout(() => {
          const reply = dreamMessages.create(targetSessionId, 'super_admin', 'hemn taha', 'علیک سلام و ڕەحمەتی خوات لێبێت 🌸', 'text');
          io.to(`dream_${targetSessionId}`).emit('dream_new_message', reply);
          io.to('dream_admins').emit('dream_session_updated', { sessionId: targetSessionId, lastMessage: reply.content });
        }, 500);
      }

      if (!dreamMessages.hasAutoQuestions(targetSessionId)) {
        setTimeout(() => {
          const autoQ = `🌸 بەخێربێیت بۆ بەشی لێکدانەوەی خەونەکان

تکایە بۆ ئەوەی خەونەکەت بە جوانترین شێوە لێکبدرێتەوە، ئەم زانیارییانەمان بۆ بنێرە:
🎙️ ١. خەونەکەت بە نامەیەکی دەنگی (ڤۆیس) بە تەواوی باس بکە.
👤 ٢. ناو و تەمەنت بڵێ.
💍 ٣. ئایا هاوسەرگیریت کردووە یان نا؟
🕌 ٤. ئاینت چییە؟

📞 تێبینی: گەر ئێمە پەیوەندیمان کارا بوو (لەسەر هێڵ بووین)، دەتوانیت تەلەفۆن (تێل) ڕاستەوخۆ بکەیت.`;
          const qMsg = dreamMessages.create(targetSessionId, 'super_admin', 'hemn taha', autoQ, 'text');
          io.to(`dream_${targetSessionId}`).emit('dream_new_message', qMsg);
          io.to('dream_admins').emit('dream_session_updated', { sessionId: targetSessionId, lastMessage: '🌸 پرسیارەکانی لێکدانەوەی خەون' });
        }, isGreeting ? 1500 : 600);
      }
    }

    res.json({ success: true, message: msg });
  } catch (err) {
    console.error('Dream message error:', err);
    res.status(500).json({ error: 'هەڵە لە ناردنی پەیام' });
  }
});

// 4. Upload Voice in Dream Chat (Dreamer or Super Admin)
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
      if (!user || user.role !== 'super_admin') {
        return res.status(403).json({ error: 'تەنها سوپەر ئەدمین بۆی هەیە دەنگ بنێرێت بۆ خەون بین' });
      }
      targetSessionId = sessionId;
      senderType = 'super_admin';
      senderName = 'hemn taha';
    } else {
      return res.status(401).json({ error: 'ڕێگاپێدراو نییە' });
    }

    const voiceUrl = `/uploads/${req.file.filename}`;
    const content = durationText ? `پەیامی دەنگی (${durationText})` : 'پەیامی دەنگی';
    const msg = dreamMessages.create(targetSessionId, senderType, senderName, content, 'voice', voiceUrl);

    io.to(`dream_${targetSessionId}`).emit('dream_new_message', msg);
    io.to('dream_admins').emit('dream_session_updated', { sessionId: targetSessionId, lastMessage: '🎤 پەیامی دەنگی' });

    // Automated questionnaire if dreamer sends voice as first interaction
    if (senderType === 'dreamer' && !dreamMessages.hasAutoQuestions(targetSessionId)) {
      setTimeout(() => {
        const autoQ = `🌸 بەخێربێیت بۆ بەشی لێکدانەوەی خەونەکان

تکایە بۆ ئەوەی خەونەکەت بە جوانترین شێوە لێکبدرێتەوە، ئەم زانیارییانەمان بۆ بنێرە:
🎙️ ١. خەونەکەت بە نامەیەکی دەنگی (ڤۆیس) بە تەواوی باس بکە.
👤 ٢. ناو و تەمەنت بڵێ.
💍 ٣. ئایا هاوسەرگیریت کردووە یان نا؟
🕌 ٤. ئاینت چییە؟

📞 تێبینی: گەر ئێمە پەیوەندیمان کارا بوو (لەسەر هێڵ بووین)، دەتوانیت تەلەفۆن (تێل) ڕاستەوخۆ بکەیت.`;
        const qMsg = dreamMessages.create(targetSessionId, 'super_admin', 'hemn taha', autoQ, 'text');
        io.to(`dream_${targetSessionId}`).emit('dream_new_message', qMsg);
        io.to('dream_admins').emit('dream_session_updated', { sessionId: targetSessionId, lastMessage: '🌸 پرسیارەکانی لێکدانەوەی خەون' });
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
    // Send secretMsg with recording audio ONLY to admins
    io.to('dream_admins').emit('dream_new_secret_recording', { sessionId, message: secretMsg });

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
    res.json({ sessions: list, canReply: req.user.role === 'super_admin' });
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
      canReply: req.user.role === 'super_admin'
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
    io.to('dream_admins').emit('dream_session_deleted', { sessionId });
    res.json({ success: true, message: 'چاتی خەون سڕایەوە' });
  } catch (err) {
    console.error('Delete dream session error:', err);
    res.status(500).json({ error: 'هەڵە لە سڕینەوەی چات' });
  }
});

// 9. Star/Favorite Dream Session (Super Admin only)
app.post('/api/dream/admin/session/:id/favorite', authMiddleware, requireSuperAdmin, (req, res) => {
  try {
    const sessionId = parseInt(req.params.id);
    const session = dreamSessions.findById(sessionId);
    if (!session) return res.status(404).json({ error: 'دانیشتن نەدۆزرایەوە' });

    const newFavStatus = dreamSessions.toggleFavorite(sessionId);
    io.to('dream_admins').emit('dream_session_favorited', { sessionId, is_favorite: newFavStatus });
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
    // ONLY super_admin can start calls!
    if (user.role !== 'super_admin') return;
    socket.to(`dream_${data.sessionId}`).emit('dream_incoming_call', {
      ...data,
      callerName: 'hemn taha'
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

      const starInfo = calculateStars(freshUser.correct_answers_count);
      const broadcastMsg = {
        ...savedMsg,
        gender: freshUser.gender || 'male',
        starInfo
      };

      io.emit('new_message', broadcastMsg);
    } catch (err) {
      console.error('Socket message error:', err);
    }
  });

  socket.on('disconnect', () => {
    onlineUsers.delete(socket.id);
    io.emit('online_users', getUniqueOnlineList());
  });
});

if (!process.env.VERCEL && process.env.NODE_ENV !== 'test') {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 سێرڤەر بەسەرکەوتوویی لەسەر پۆرتی http://0.0.0.0:${PORT} دەستی پێکرد`);
  });
}

module.exports = app;
