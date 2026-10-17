const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

let DatabaseSync;
try {
  DatabaseSync = require('node:sqlite').DatabaseSync;
} catch (e) {
  try {
    DatabaseSync = require('sqlite3');
  } catch (err) {}
}

let dbPath = path.join(__dirname, 'chat_data.db');
if (process.env.VERCEL) {
  const tmpDb = path.join('/tmp', 'chat_data.db');
  if (!fs.existsSync(tmpDb) && fs.existsSync(dbPath)) {
    try {
      fs.copyFileSync(dbPath, tmpDb);
    } catch (e) {}
  }
  dbPath = tmpDb;
}
const db = DatabaseSync ? new DatabaseSync(dbPath) : { exec: () => {}, prepare: () => ({ all: () => [], get: () => null, run: () => ({ changes: 0 }) }) };

// Initialize Tables
function initDb() {
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      gender TEXT NOT NULL DEFAULT 'male',
      role TEXT NOT NULL DEFAULT 'student',
      status TEXT NOT NULL DEFAULT 'pending',
      is_blocked INTEGER NOT NULL DEFAULT 0,
      muted_until INTEGER DEFAULT 0,
      correct_answers_count INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id INTEGER NOT NULL,
      admin_name TEXT NOT NULL,
      question_text TEXT NOT NULL,
      correct_answer TEXT,
      duration_minutes INTEGER DEFAULT 5,
      expires_at INTEGER DEFAULT 0,
      is_revealed INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      winner_id INTEGER DEFAULT NULL,
      winner_name TEXT DEFAULT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS question_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      full_name TEXT NOT NULL,
      gender TEXT NOT NULL DEFAULT 'male',
      answer_text TEXT NOT NULL,
      submitted_at INTEGER NOT NULL,
      is_correct INTEGER DEFAULT 0,
      FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(question_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'text',
      question_id INTEGER DEFAULT NULL,
      reply_to_id INTEGER DEFAULT NULL,
      attachment_type TEXT DEFAULT 'none',
      attachment_url TEXT DEFAULT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS star_awards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      awarded_by INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS role_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      changed_by_id INTEGER NOT NULL,
      changed_by_name TEXT NOT NULL,
      old_role TEXT NOT NULL,
      new_role TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS library_books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      author TEXT DEFAULT '',
      description TEXT DEFAULT '',
      category TEXT DEFAULT 'گشتی',
      file_url TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_size INTEGER DEFAULT 0,
      file_type TEXT DEFAULT 'pdf',
      uploader_id INTEGER NOT NULL,
      uploader_name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (uploader_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS dream_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dreamer_token TEXT UNIQUE NOT NULL,
      dreamer_name TEXT NOT NULL,
      dreamer_gender TEXT NOT NULL DEFAULT 'male',
      status TEXT NOT NULL DEFAULT 'open',
      created_at INTEGER NOT NULL,
      last_activity INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dream_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      sender_type TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      content TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'text',
      attachment_url TEXT DEFAULT NULL,
      is_secret_recording INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES dream_sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS password_reset_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      full_name TEXT NOT NULL,
      new_password_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS private_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      recipient_id INTEGER NOT NULL,
      sender_name TEXT NOT NULL,
      sender_role TEXT NOT NULL,
      content TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'text',
      attachment_url TEXT DEFAULT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS message_reactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      emoji TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(message_id, user_id, emoji),
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS profile_change_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      requested_name TEXT,
      requested_password TEXT,
      current_name TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      reviewed_by INTEGER,
      reviewed_at INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      endpoint TEXT UNIQUE NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      user_agent TEXT,
      created_at INTEGER NOT NULL
    );
  `);

  try {
    db.prepare("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('dream_status', 'online')").run();
    db.prepare("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('dream_away_message', 'ئێستا کاتی پشووە، بەڕێوەبەر لە زووترین کاتدا وەڵامت دەداتەوە')").run();
  } catch (e) {}

  // Migrations for existing database
  try { db.exec("ALTER TABLE users ADD COLUMN gender TEXT DEFAULT 'male'"); } catch (e) {}
  try { db.exec("ALTER TABLE messages ADD COLUMN attachment_type TEXT DEFAULT 'none'"); } catch (e) {}
  try { db.exec("ALTER TABLE messages ADD COLUMN attachment_url TEXT DEFAULT NULL"); } catch (e) {}
  try { db.exec("ALTER TABLE questions ADD COLUMN duration_minutes INTEGER DEFAULT 5"); } catch (e) {}
  try { db.exec("ALTER TABLE questions ADD COLUMN expires_at INTEGER DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE questions ADD COLUMN is_revealed INTEGER DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE questions ADD COLUMN question_number INTEGER DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE question_submissions ADD COLUMN is_correct INTEGER DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE dream_sessions ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0"); } catch (e) {}

  // Backfill question_number sequentially for any unnumbered questions
  try {
    const unnumbered = db.prepare('SELECT id FROM questions WHERE question_number = 0 OR question_number IS NULL ORDER BY created_at ASC').all();
    unnumbered.forEach((row, idx) => {
      db.prepare('UPDATE questions SET question_number = ? WHERE id = ?').run(idx + 1, row.id);
    });
  } catch (e) {}

  // Update or Seed default super admin
  const checkAdmin = db.prepare('SELECT id, full_name, username FROM users WHERE role = ? LIMIT 1');
  const existingAdmin = checkAdmin.get('super_admin');
  const adminHash = bcrypt.hashSync('851314taha3', 10);
  if (existingAdmin) {
    db.prepare("UPDATE users SET username = 'hemntjabar', full_name = 'hemn taha', role = 'super_admin', status = 'approved', is_blocked = 0, password_hash = ? WHERE id = ?").run(adminHash, existingAdmin.id);
  } else {
    const insertAdmin = db.prepare(`
      INSERT INTO users (username, password_hash, full_name, gender, role, status, is_blocked, muted_until, correct_answers_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertAdmin.run(
      'hemntjabar',
      adminHash,
      'hemn taha',
      'male',
      'super_admin',
      'approved',
      0,
      0,
      0,
      Date.now()
    );
  }
}

// User helper methods
const users = {
  findByUsername(identifier) {
    if (!identifier) return null;
    const clean = identifier.trim();
    const cleanLower = clean.toLowerCase();

    // Direct super admin alias match (English & Kurdish)
    if (
      cleanLower === 'hemntjabar' ||
      cleanLower === 'admin' ||
      cleanLower === 'hemn' ||
      cleanLower === 'hemn taha' ||
      cleanLower === 'hemntaha' ||
      cleanLower === 'hemn_taha' ||
      clean === 'هێمن تەها' ||
      clean === 'هێمن' ||
      clean === 'هێمن ته‌ها' ||
      clean.replace(/\s+/g, '') === 'هێمنتەها'
    ) {
      const superAdmin = db.prepare("SELECT * FROM users WHERE role = 'super_admin' LIMIT 1").get();
      if (superAdmin) return superAdmin;
    }

    // Match by username or full_name
    const stmt = db.prepare(`
      SELECT * FROM users 
      WHERE username = ? COLLATE NOCASE 
         OR full_name = ? COLLATE NOCASE
         OR REPLACE(LOWER(username), ' ', '') = REPLACE(LOWER(?), ' ', '')
         OR REPLACE(LOWER(full_name), ' ', '') = REPLACE(LOWER(?), ' ', '')
      LIMIT 1
    `);
    const found = stmt.get(clean, clean, clean, clean);
    if (found) return found;

    // Partial match on full_name or username
    const partialStmt = db.prepare(`
      SELECT * FROM users 
      WHERE full_name LIKE ? OR username LIKE ?
      LIMIT 1
    `);
    return partialStmt.get(`%${clean}%`, `%${clean}%`);
  },
  findById(id) {
    const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
    return stmt.get(id);
  },
  create(username, passwordHash, fullName, gender = 'male', role = 'student', status = 'pending') {
    const stmt = db.prepare(`
      INSERT INTO users (username, password_hash, full_name, gender, role, status, is_blocked, muted_until, correct_answers_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, ?)
    `);
    const result = stmt.run(username, passwordHash, fullName, gender, role, status, Date.now());
    return result.lastInsertRowid;
  },
  getPendingUsers() {
    const stmt = db.prepare("SELECT id, username, full_name, gender, role, status, created_at FROM users WHERE status = 'pending' ORDER BY created_at ASC");
    return stmt.all();
  },
  getAllUsers() {
    const stmt = db.prepare("SELECT id, username, full_name, gender, role, status, is_blocked, muted_until, correct_answers_count, created_at FROM users ORDER BY role = 'super_admin' DESC, role = 'admin' DESC, role = 'teacher' DESC, role = 'student' DESC, role = 'new_student' DESC, role = 'guest' DESC, correct_answers_count DESC, created_at DESC");
    return stmt.all();
  },
  updateStatus(id, status) {
    const stmt = db.prepare('UPDATE users SET status = ? WHERE id = ?');
    return stmt.run(status, id);
  },
  updateRole(id, role) {
    const stmt = db.prepare('UPDATE users SET role = ? WHERE id = ?');
    return stmt.run(role, id);
  },
  updatePassword(id, passwordHash) {
    const stmt = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?');
    return stmt.run(passwordHash, id);
  },
  addRoleHistory(userId, changedById, changedByName, oldRole, newRole) {
    const stmt = db.prepare(`
      INSERT INTO role_history (user_id, changed_by_id, changed_by_name, old_role, new_role, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(userId, changedById, changedByName, oldRole, newRole, Date.now());
  },
  getRoleHistory(userId) {
    const stmt = db.prepare(`
      SELECT * FROM role_history WHERE user_id = ? ORDER BY created_at DESC
    `);
    return stmt.all(userId);
  },
  getAnsweredQuestions(userId) {
    const stmt = db.prepare(`
      SELECT sa.id as award_id, sa.question_id, q.question_text, sa.created_at as awarded_at
      FROM star_awards sa
      LEFT JOIN questions q ON sa.question_id = q.id
      WHERE sa.user_id = ?
      ORDER BY sa.created_at DESC
    `);
    return stmt.all(userId);
  },
  getUserProfile(userId) {
    const user = this.findById(userId);
    if (!user) return null;
    const history = this.getRoleHistory(userId);
    const answered = this.getAnsweredQuestions(userId);
    const starInfo = calculateStars(user.correct_answers_count);
    return {
      id: user.id,
      username: user.username,
      full_name: user.full_name,
      gender: user.gender || 'male',
      role: user.role,
      status: user.status,
      is_blocked: user.is_blocked,
      muted_until: user.muted_until,
      correct_answers_count: user.correct_answers_count,
      created_at: user.created_at,
      starInfo,
      roleHistory: history,
      promotionsCount: history.filter(h => h.new_role === 'admin').length,
      answeredQuestions: answered
    };
  },
  setBlocked(id, isBlocked) {
    const stmt = db.prepare('UPDATE users SET is_blocked = ? WHERE id = ?');
    return stmt.run(isBlocked ? 1 : 0, id);
  },
  setMute(id, mutedUntil) {
    const stmt = db.prepare('UPDATE users SET muted_until = ? WHERE id = ?');
    return stmt.run(mutedUntil, id);
  },
  incrementCorrectAnswers(id) {
    const stmt = db.prepare('UPDATE users SET correct_answers_count = correct_answers_count + 1 WHERE id = ?');
    stmt.run(id);
    const updated = db.prepare('SELECT correct_answers_count FROM users WHERE id = ?').get(id);
    return updated ? updated.correct_answers_count : 0;
  },
  adjustStars(id, delta) {
    db.prepare('UPDATE users SET correct_answers_count = MAX(0, correct_answers_count + ?) WHERE id = ?').run(Number(delta) || 0, id);
    const updated = db.prepare('SELECT correct_answers_count FROM users WHERE id = ?').get(id);
    return updated ? updated.correct_answers_count : 0;
  },
  updateFullName(id, newName) {
    db.prepare('UPDATE users SET full_name = ? WHERE id = ?').run(newName.trim(), id);
    return this.findById(id);
  },
  updatePassword(id, passwordHash) {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, id);
    return true;
  },
  getLeaderboard() {
    const stmt = db.prepare(`
      SELECT id, username, full_name, gender, role, correct_answers_count 
      FROM users 
      WHERE status = 'approved' AND is_blocked = 0 AND (role = 'student' OR role = 'new_student')
      ORDER BY correct_answers_count DESC, created_at ASC
      LIMIT 20
    `);
    return stmt.all();
  },
  getStudentOfTheMonth() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    
    try {
      const monthlyStmt = db.prepare(`
        SELECT u.id, u.username, u.full_name, u.gender, u.role, COUNT(sa.id) as monthly_stars, u.correct_answers_count as total_stars
        FROM users u
        JOIN star_awards sa ON u.id = sa.user_id
        WHERE sa.created_at >= ? AND (u.role = 'student' OR u.role = 'new_student')
        GROUP BY u.id
        ORDER BY monthly_stars DESC, total_stars DESC
        LIMIT 5
      `);
      let topStudents = monthlyStmt.all(startOfMonth);
      
      if (!topStudents || topStudents.length === 0) {
        const allTimeStmt = db.prepare(`
          SELECT id, username, full_name, gender, role, correct_answers_count as monthly_stars, correct_answers_count as total_stars
          FROM users
          WHERE (role = 'student' OR role = 'new_student') AND correct_answers_count > 0
          ORDER BY correct_answers_count DESC
          LIMIT 5
        `);
        topStudents = allTimeStmt.all();
      }
      
      return topStudents.map(s => ({
        ...s,
        starInfo: calculateStars(s.total_stars)
      }));
    } catch (e) {
      return [];
    }
  },
  delete(id) {
    try {
      const stmt = db.prepare('DELETE FROM users WHERE id = ?');
      return stmt.run(id);
    } catch (e) {
      console.error('Error deleting user:', e);
      return false;
    }
  }
};

// System settings helper methods
const settings = {
  get(key, defaultValue = null) {
    try {
      const row = db.prepare('SELECT value FROM system_settings WHERE key = ?').get(key);
      return row ? row.value : defaultValue;
    } catch (e) {
      return defaultValue;
    }
  },
  set(key, value) {
    try {
      db.prepare('INSERT INTO system_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
      return true;
    } catch (e) {
      return false;
    }
  }
};

// Password reset requests helper methods
const passwordResets = {
  create(userId, username, fullName, newPasswordHash) {
    db.prepare('DELETE FROM password_reset_requests WHERE user_id = ?').run(userId);
    const stmt = db.prepare(`
      INSERT INTO password_reset_requests (user_id, username, full_name, new_password_hash, status, created_at)
      VALUES (?, ?, ?, ?, 'pending', ?)
    `);
    return stmt.run(userId, username, fullName, newPasswordHash, Date.now());
  },
  getPending() {
    try {
      return db.prepare(`
        SELECT r.id, r.user_id, r.username, r.full_name, r.created_at, u.role, u.gender
        FROM password_reset_requests r
        JOIN users u ON r.user_id = u.id
        WHERE r.status = 'pending'
        ORDER BY r.created_at DESC
      `).all();
    } catch (e) {
      return [];
    }
  },
  findById(id) {
    try {
      return db.prepare('SELECT * FROM password_reset_requests WHERE id = ?').get(id);
    } catch (e) {
      return null;
    }
  },
  approve(id) {
    const req = this.findById(id);
    if (!req) return false;
    users.updatePassword(req.user_id, req.new_password_hash);
    db.prepare('DELETE FROM password_reset_requests WHERE id = ?').run(id);
    return req;
  },
  reject(id) {
    try {
      return db.prepare('DELETE FROM password_reset_requests WHERE id = ?').run(id);
    } catch (e) {
      return false;
    }
  }
};

// Message helper methods
const messages = {
  create(userId, username, fullName, role, content, type = 'text', questionId = null, replyToId = null, attachmentType = 'none', attachmentUrl = null) {
    const stmt = db.prepare(`
      INSERT INTO messages (user_id, username, full_name, role, content, type, question_id, reply_to_id, attachment_type, attachment_url, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(userId, username, fullName, role, content, type, questionId, replyToId, attachmentType, attachmentUrl, Date.now());
    return this.findById(result.lastInsertRowid);
  },
  findById(id) {
    const stmt = db.prepare(`
      SELECT m.*, u.gender, u.correct_answers_count 
      FROM messages m
      LEFT JOIN users u ON m.user_id = u.id
      WHERE m.id = ?
    `);
    return stmt.get(id);
  },
  getRecent(limit = 120) {
    const stmt = db.prepare(`
      SELECT m.*, u.gender, u.correct_answers_count 
      FROM messages m
      LEFT JOIN users u ON m.user_id = u.id
      ORDER BY m.id DESC
      LIMIT ?
    `);
    const rows = stmt.all(limit);
    return rows.reverse();
  },
  getUserMessageCountLast24h(userId) {
    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
    const stmt = db.prepare("SELECT COUNT(*) as count FROM messages WHERE user_id = ? AND type = 'text' AND created_at >= ?");
    const row = stmt.get(userId, oneDayAgo);
    return row ? row.count : 0;
  },
  delete(id) {
    const stmt = db.prepare('DELETE FROM messages WHERE id = ?');
    return stmt.run(id);
  },
  clearAll() {
    return db.prepare('DELETE FROM messages').run();
  }
};

// Question helper methods
const questions = {
  create(adminId, adminName, questionText, correctAnswer = null, durationMinutes = 5, customExpiresAt = null) {
    const expiresAt = customExpiresAt ? Number(customExpiresAt) : (Date.now() + (durationMinutes * 60 * 1000));
    const finalDurationMinutes = customExpiresAt ? Math.max(1, Math.round((expiresAt - Date.now()) / 60000)) : durationMinutes;
    
    const nextNumRow = db.prepare('SELECT COALESCE(MAX(question_number), 0) + 1 as next_num FROM questions').get();
    const questionNumber = nextNumRow ? nextNumRow.next_num : 1;

    const stmt = db.prepare(`
      INSERT INTO questions (admin_id, admin_name, question_text, correct_answer, duration_minutes, expires_at, is_revealed, is_active, question_number, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?, ?)
    `);
    const result = stmt.run(adminId, adminName, questionText, correctAnswer ? correctAnswer.trim() : null, finalDurationMinutes, expiresAt, questionNumber, Date.now());
    return this.findById(result.lastInsertRowid);
  },
  getAllArchive() {
    const stmt = db.prepare(`
      SELECT q.*, 
        (SELECT COUNT(*) FROM question_submissions WHERE question_id = q.id) as submissions_count,
        (SELECT COUNT(*) FROM star_awards WHERE question_id = q.id) as awards_count
      FROM questions q
      ORDER BY q.question_number ASC, q.created_at ASC
    `);
    return stmt.all();
  },
  findById(id) {
    const stmt = db.prepare('SELECT * FROM questions WHERE id = ?');
    return stmt.get(id);
  },
  getActive() {
    const stmt = db.prepare('SELECT * FROM questions WHERE is_active = 1 AND is_revealed = 0 AND (expires_at = 0 OR expires_at > ?) ORDER BY created_at DESC LIMIT 1');
    return stmt.get(Date.now());
  },
  submitAnswer(questionId, userId, username, fullName, gender, answerText) {
    const stmt = db.prepare(`
      INSERT INTO question_submissions (question_id, user_id, username, full_name, gender, answer_text, submitted_at, is_correct)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0)
      ON CONFLICT(question_id, user_id) DO UPDATE SET
        answer_text = excluded.answer_text,
        submitted_at = excluded.submitted_at
    `);
    stmt.run(questionId, userId, username, fullName, gender, answerText.trim(), Date.now());
    return this.getStudentSubmission(questionId, userId);
  },
  getStudentSubmission(questionId, userId) {
    const stmt = db.prepare('SELECT * FROM question_submissions WHERE question_id = ? AND user_id = ?');
    return stmt.get(questionId, userId);
  },
  getSubmissions(questionId) {
    const stmt = db.prepare(`
      SELECT qs.*, u.correct_answers_count,
        (CASE WHEN sa.id IS NOT NULL OR qs.is_correct = 1 THEN 1 
              WHEN qs.is_correct = -1 THEN -1 
              ELSE 0 END) as is_awarded
      FROM question_submissions qs
      LEFT JOIN users u ON qs.user_id = u.id
      LEFT JOIN star_awards sa ON qs.question_id = sa.question_id AND qs.user_id = sa.user_id
      WHERE qs.question_id = ?
      ORDER BY qs.submitted_at ASC
    `);
    return stmt.all(questionId);
  },
  revealSubmissions(questionId) {
    db.prepare('UPDATE questions SET is_revealed = 1, is_active = 0 WHERE id = ?').run(questionId);
    return this.getSubmissions(questionId);
  },
  getNonRespondingStudents(questionId) {
    const stmt = db.prepare(`
      SELECT u.id, u.username, u.full_name, u.gender, u.correct_answers_count
      FROM users u
      WHERE u.status = 'approved' AND u.role = 'student' AND u.is_blocked = 0
      AND u.id NOT IN (
        SELECT user_id FROM question_submissions WHERE question_id = ?
      )
      ORDER BY u.full_name ASC
    `);
    return stmt.all(questionId);
  },
  getGlobalUnansweredStats() {
    const totalRow = db.prepare("SELECT COUNT(*) as total FROM questions").get();
    const totalQuestions = totalRow ? totalRow.total : 0;
    const stmt = db.prepare(`
      SELECT u.id, u.username, u.full_name, u.gender, u.role, u.correct_answers_count,
        COUNT(qs.id) as answered_questions_count
      FROM users u
      LEFT JOIN question_submissions qs ON u.id = qs.user_id
      WHERE u.status = 'approved' AND u.role = 'student' AND u.is_blocked = 0
      GROUP BY u.id
      ORDER BY (COUNT(qs.id)) ASC, u.created_at ASC
    `);
    const rows = stmt.all();
    return rows.map(r => {
      const missed = Math.max(0, totalQuestions - r.answered_questions_count);
      return {
        ...r,
        total_questions: totalQuestions,
        missed_questions_count: missed,
        starInfo: calculateStars(r.correct_answers_count)
      };
    });
  },
  closeQuestion(questionId, winnerId = null, winnerName = null) {
    const stmt = db.prepare('UPDATE questions SET is_active = 0, winner_id = ?, winner_name = ? WHERE id = ?');
    return stmt.run(winnerId, winnerName, questionId);
  },
  renumberQuestions() {
    try {
      const allQ = db.prepare('SELECT id FROM questions ORDER BY created_at ASC, id ASC').all();
      const updateQ = db.prepare('UPDATE questions SET question_number = ? WHERE id = ?');
      allQ.forEach((q, idx) => {
        const newNum = idx + 1;
        updateQ.run(newNum, q.id);
      });

      // Also update messages in chat for questions and revealed submissions
      const allMsgs = db.prepare("SELECT id, content FROM messages WHERE message_type = 'question' OR message_type = 'revealed_submissions'").all();
      const updateMsg = db.prepare('UPDATE messages SET content = ? WHERE id = ?');
      for (const m of allMsgs) {
        try {
          const parsed = JSON.parse(m.content);
          const qId = parsed.id || parsed.question_id;
          if (qId) {
            const currentQ = db.prepare('SELECT question_number FROM questions WHERE id = ?').get(qId);
            if (currentQ) {
              parsed.question_number = currentQ.question_number;
              updateMsg.run(JSON.stringify(parsed), m.id);
            }
          }
        } catch (e) {}
      }
    } catch (err) {
      console.error('Error renumbering questions:', err);
    }
  },
  update(questionId, data) {
    const q = this.findById(questionId);
    if (!q) return null;
    const text = data.question_text !== undefined ? data.question_text.trim() : q.question_text;
    const ans = data.correct_answer !== undefined ? (data.correct_answer ? data.correct_answer.trim() : null) : q.correct_answer;
    const duration = data.duration_minutes !== undefined ? parseInt(data.duration_minutes) || q.duration_minutes : q.duration_minutes;
    const expiresAt = data.expires_at !== undefined ? Number(data.expires_at) : q.expires_at;

    db.prepare(`
      UPDATE questions 
      SET question_text = ?, correct_answer = ?, duration_minutes = ?, expires_at = ?
      WHERE id = ?
    `).run(text, ans, duration, expiresAt, questionId);

    // Update active question message in messages table
    try {
      const qMsgs = db.prepare("SELECT id, content FROM messages WHERE message_type = 'question'").all();
      const updateMsg = db.prepare('UPDATE messages SET content = ? WHERE id = ?');
      for (const m of qMsgs) {
        try {
          const parsed = JSON.parse(m.content);
          if (parsed.id === questionId || parsed.question_id === questionId) {
            parsed.question_text = text;
            parsed.duration_minutes = duration;
            parsed.expires_at = expiresAt;
            updateMsg.run(JSON.stringify(parsed), m.id);
          }
        } catch (e) {}
      }
    } catch (e) {}

    return this.findById(questionId);
  },
  delete(questionId) {
    db.prepare('DELETE FROM star_awards WHERE question_id = ?').run(questionId);
    db.prepare('DELETE FROM question_submissions WHERE question_id = ?').run(questionId);
    const stmt = db.prepare('DELETE FROM questions WHERE id = ?');
    const res = stmt.run(questionId);
    this.renumberQuestions();
    return res;
  },
  hasUserBeenAwarded(questionId, userId) {
    const stmt = db.prepare('SELECT COUNT(*) as count FROM star_awards WHERE question_id = ? AND user_id = ?');
    const row = stmt.get(questionId, userId);
    return row && row.count > 0;
  },
  recordStarAward(questionId, userId, awardedBy) {
    const stmt = db.prepare(`
      INSERT INTO star_awards (question_id, user_id, awarded_by, created_at)
      VALUES (?, ?, ?, ?)
    `);
    try {
      db.prepare('UPDATE question_submissions SET is_correct = 1 WHERE question_id = ? AND user_id = ?').run(questionId, userId);
    } catch (e) {}
    return stmt.run(questionId, userId, awardedBy, Date.now());
  },
  recordWrongMark(questionId, userId) {
    const wasAwarded = db.prepare('SELECT id FROM star_awards WHERE question_id = ? AND user_id = ?').get(questionId, userId);
    if (wasAwarded) {
      db.prepare('DELETE FROM star_awards WHERE question_id = ? AND user_id = ?').run(questionId, userId);
      try {
        db.prepare('UPDATE users SET correct_answers_count = MAX(0, correct_answers_count - 1) WHERE id = ?').run(userId);
      } catch (e) {}
    }
    return db.prepare('UPDATE question_submissions SET is_correct = -1 WHERE question_id = ? AND user_id = ?').run(questionId, userId);
  },
  resetSubmissionEvaluation(questionId, userId) {
    const wasAwarded = db.prepare('SELECT id FROM star_awards WHERE question_id = ? AND user_id = ?').get(questionId, userId);
    if (wasAwarded) {
      db.prepare('DELETE FROM star_awards WHERE question_id = ? AND user_id = ?').run(questionId, userId);
      try {
        db.prepare('UPDATE users SET correct_answers_count = MAX(0, correct_answers_count - 1) WHERE id = ?').run(userId);
      } catch (e) {}
    }
    return db.prepare('UPDATE question_submissions SET is_correct = 0 WHERE question_id = ? AND user_id = ?').run(questionId, userId);
  },
  getQuestionAwards(questionId) {
    const stmt = db.prepare('SELECT user_id FROM star_awards WHERE question_id = ?');
    return stmt.all(questionId).map(r => r.user_id);
  }
};

// Library helper methods (Books, PDFs, Files)
const library = {
  create(title, author, description, category, fileUrl, fileName, fileSize, fileType, uploaderId, uploaderName) {
    const stmt = db.prepare(`
      INSERT INTO library_books (title, author, description, category, file_url, file_name, file_size, file_type, uploader_id, uploader_name, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      title.trim(),
      author ? author.trim() : '',
      description ? description.trim() : '',
      category ? category.trim() : 'گشتی',
      fileUrl,
      fileName,
      fileSize || 0,
      fileType || 'pdf',
      uploaderId,
      uploaderName,
      Date.now()
    );
    return this.findById(result.lastInsertRowid);
  },
  findById(id) {
    const stmt = db.prepare('SELECT * FROM library_books WHERE id = ?');
    return stmt.get(id);
  },
  getAll(search = '') {
    if (search && search.trim()) {
      const q = `%${search.trim().toLowerCase()}%`;
      const stmt = db.prepare(`
        SELECT * FROM library_books 
        WHERE LOWER(title) LIKE ? OR LOWER(author) LIKE ? OR LOWER(description) LIKE ? OR LOWER(category) LIKE ?
        ORDER BY created_at DESC
      `);
      return stmt.all(q, q, q, q);
    }
    const stmt = db.prepare('SELECT * FROM library_books ORDER BY created_at DESC');
    return stmt.all();
  },
  delete(id) {
    const stmt = db.prepare('DELETE FROM library_books WHERE id = ?');
    return stmt.run(id);
  }
};

const dreamSessions = {
  create(token, name, gender = 'male') {
    const now = Date.now();
    const stmt = db.prepare(`
      INSERT INTO dream_sessions (dreamer_token, dreamer_name, dreamer_gender, status, created_at, last_activity)
      VALUES (?, ?, ?, 'open', ?, ?)
    `);
    const res = stmt.run(token, name, gender, now, now);
    return this.findById(res.lastInsertRowid);
  },
  findByToken(token) {
    if (!token) return null;
    const stmt = db.prepare('SELECT * FROM dream_sessions WHERE dreamer_token = ?');
    return stmt.get(token);
  },
  findById(id) {
    const stmt = db.prepare('SELECT * FROM dream_sessions WHERE id = ?');
    return stmt.get(id);
  },
  getAll() {
    const stmt = db.prepare(`
      SELECT s.*, 
        (SELECT COUNT(*) FROM dream_messages m WHERE m.session_id = s.id) as message_count,
        (SELECT content FROM dream_messages m WHERE m.session_id = s.id ORDER BY m.created_at DESC LIMIT 1) as last_message_content,
        (SELECT type FROM dream_messages m WHERE m.session_id = s.id ORDER BY m.created_at DESC LIMIT 1) as last_message_type
      FROM dream_sessions s 
      ORDER BY s.last_activity DESC
    `);
    return stmt.all();
  },
  updateActivity(sessionId) {
    const stmt = db.prepare('UPDATE dream_sessions SET last_activity = ? WHERE id = ?');
    return stmt.run(Date.now(), sessionId);
  },
  updateStatus(sessionId, status) {
    const stmt = db.prepare('UPDATE dream_sessions SET status = ?, last_activity = ? WHERE id = ?');
    return stmt.run(status, Date.now(), sessionId);
  },
  toggleFavorite(sessionId) {
    const s = this.findById(sessionId);
    if (!s) return null;
    const newFav = s.is_favorite ? 0 : 1;
    db.prepare('UPDATE dream_sessions SET is_favorite = ? WHERE id = ?').run(newFav, sessionId);
    return newFav;
  },
  delete(sessionId) {
    db.prepare('DELETE FROM dream_messages WHERE session_id = ?').run(sessionId);
    return db.prepare('DELETE FROM dream_sessions WHERE id = ?').run(sessionId);
  }
};

const dreamMessages = {
  create(sessionId, senderType, senderName, content, type = 'text', attachmentUrl = null, isSecretRecording = 0) {
    const now = Date.now();
    const stmt = db.prepare(`
      INSERT INTO dream_messages (session_id, sender_type, sender_name, content, type, attachment_url, is_secret_recording, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const res = stmt.run(sessionId, senderType, senderName, content, type, attachmentUrl, isSecretRecording, now);
    dreamSessions.updateActivity(sessionId);
    return {
      id: Number(res.lastInsertRowid),
      session_id: sessionId,
      sender_type: senderType,
      sender_name: senderName,
      content,
      type,
      attachment_url: attachmentUrl,
      is_secret_recording: isSecretRecording,
      created_at: now
    };
  },
  hasAutoQuestions(sessionId) {
    try {
      const stmt = db.prepare(`SELECT COUNT(*) as count FROM dream_messages WHERE session_id = ? AND sender_type = 'super_admin' AND (content LIKE '%خەونەکەت بە نامەی دەنگی%' OR content LIKE '%بەخێربێیت بۆ بەشی لێکدانەوەی خەونەکان%')`);
      const row = stmt.get(sessionId);
      return row && row.count > 0;
    } catch (e) {
      return false;
    }
  },
  getBySessionForAdmin(sessionId) {
    // Admin / Teacher sees ALL messages including secret call recordings
    const stmt = db.prepare('SELECT * FROM dream_messages WHERE session_id = ? ORDER BY created_at ASC');
    return stmt.all(sessionId);
  },
  getBySessionForDreamer(sessionId) {
    // Dreamer NEVER gets secret recordings!
    const stmt = db.prepare('SELECT * FROM dream_messages WHERE session_id = ? AND is_secret_recording = 0 ORDER BY created_at ASC');
    return stmt.all(sessionId);
  },
  findById(id) {
    try {
      return db.prepare('SELECT * FROM dream_messages WHERE id = ?').get(id);
    } catch (e) {
      return null;
    }
  },
  delete(id) {
    try {
      db.prepare('DELETE FROM dream_messages WHERE id = ?').run(id);
      return true;
    } catch (e) {
      return false;
    }
  }
};

// Private Messages (تایبەت بۆ مامۆستا و سوپەر ئەدمین)
const privateMessages = {
  create(senderId, recipientId, senderName, senderRole, content, type = 'text', attachmentUrl = null) {
    const stmt = db.prepare(`
      INSERT INTO private_messages (sender_id, recipient_id, sender_name, sender_role, content, type, attachment_url, is_read, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
    `);
    const res = stmt.run(senderId, recipientId, senderName, senderRole, content, type, attachmentUrl, Date.now());
    return this.findById(res.lastInsertRowid);
  },
  findById(id) {
    return db.prepare('SELECT * FROM private_messages WHERE id = ?').get(id);
  },
  getConversation(userId1, userId2, limit = 100) {
    const stmt = db.prepare(`
      SELECT * FROM private_messages 
      WHERE (sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?)
      ORDER BY id ASC
      LIMIT ?
    `);
    return stmt.all(userId1, userId2, userId2, userId1, limit);
  },
  markAsRead(senderId, recipientId) {
    return db.prepare(`
      UPDATE private_messages SET is_read = 1 
      WHERE sender_id = ? AND recipient_id = ? AND is_read = 0
    `).run(senderId, recipientId);
  },
  getConversationsList(userId) {
    const stmt = db.prepare(`
      SELECT 
        u.id as other_user_id,
        u.username,
        u.full_name,
        u.role,
        u.gender,
        (
          SELECT content FROM private_messages 
          WHERE (sender_id = u.id AND recipient_id = ?) OR (sender_id = ? AND recipient_id = u.id)
          ORDER BY id DESC LIMIT 1
        ) as last_message,
        (
          SELECT created_at FROM private_messages 
          WHERE (sender_id = u.id AND recipient_id = ?) OR (sender_id = ? AND recipient_id = u.id)
          ORDER BY id DESC LIMIT 1
        ) as last_activity,
        (
          SELECT COUNT(*) FROM private_messages 
          WHERE sender_id = u.id AND recipient_id = ? AND is_read = 0
        ) as unread_count
      FROM users u
      WHERE u.id != ? AND EXISTS (
        SELECT 1 FROM private_messages 
        WHERE (sender_id = u.id AND recipient_id = ?) OR (sender_id = ? AND recipient_id = u.id)
      )
      ORDER BY last_activity DESC
    `);
    return stmt.all(userId, userId, userId, userId, userId, userId, userId, userId);
  },
  getTotalUnreadCount(userId) {
    const row = db.prepare('SELECT COUNT(*) as count FROM private_messages WHERE recipient_id = ? AND is_read = 0').get(userId);
    return row ? row.count : 0;
  }
};

// Message Reactions (🏆, 🤲, 👍, 💯)
const messageReactions = {
  toggle(messageId, userId, emoji) {
    const existing = db.prepare('SELECT id FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').get(messageId, userId, emoji);
    if (existing) {
      db.prepare('DELETE FROM message_reactions WHERE id = ?').run(existing.id);
    } else {
      db.prepare('INSERT INTO message_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)').run(messageId, userId, emoji, Date.now());
    }
    return this.getForMessage(messageId, userId);
  },
  getForMessage(messageId, currentUserId = null) {
    const rows = db.prepare(`
      SELECT emoji, COUNT(*) as count,
        GROUP_CONCAT(user_id) as user_ids
      FROM message_reactions
      WHERE message_id = ?
      GROUP BY emoji
    `).all(messageId);

    return rows.map(r => {
      const uids = (r.user_ids || '').split(',').map(Number);
      return {
        emoji: r.emoji,
        count: r.count,
        reactedByMe: currentUserId ? uids.includes(Number(currentUserId)) : false
      };
    });
  },
  getForMessages(messageIds, currentUserId = null) {
    if (!messageIds || messageIds.length === 0) return {};
    const placeholders = messageIds.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT message_id, emoji, COUNT(*) as count,
        GROUP_CONCAT(user_id) as user_ids
      FROM message_reactions
      WHERE message_id IN (${placeholders})
      GROUP BY message_id, emoji
    `).all(...messageIds);

    const map = {};
    for (const id of messageIds) {
      map[id] = [];
    }
    for (const r of rows) {
      const uids = (r.user_ids || '').split(',').map(Number);
      if (!map[r.message_id]) map[r.message_id] = [];
      map[r.message_id].push({
        emoji: r.emoji,
        count: r.count,
        reactedByMe: currentUserId ? uids.includes(Number(currentUserId)) : false
      });
    }
    return map;
  }
};

// Calculate star level & progress
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

// Profile Change Requests (Name & Password changes requiring Super Admin approval)
const profileChangeRequests = {
  create(userId, requestedName, requestedPasswordHash, currentName) {
    const stmt = db.prepare(`
      INSERT INTO profile_change_requests (user_id, requested_name, requested_password, current_name, status, created_at)
      VALUES (?, ?, ?, ?, 'pending', ?)
    `);
    const res = stmt.run(userId, requestedName ? requestedName.trim() : null, requestedPasswordHash || null, currentName, Date.now());
    return this.getById(res.lastInsertRowid);
  },
  getPending() {
    const stmt = db.prepare(`
      SELECT pcr.*, u.username, u.role, u.gender
      FROM profile_change_requests pcr
      JOIN users u ON pcr.user_id = u.id
      WHERE pcr.status = 'pending'
      ORDER BY pcr.created_at ASC
    `);
    return stmt.all();
  },
  getById(id) {
    const stmt = db.prepare('SELECT * FROM profile_change_requests WHERE id = ?');
    return stmt.get(id);
  },
  getPendingCount() {
    const row = db.prepare("SELECT COUNT(*) as count FROM profile_change_requests WHERE status = 'pending'").get();
    return row ? row.count : 0;
  },
  hasPending(userId) {
    const row = db.prepare("SELECT COUNT(*) as count FROM profile_change_requests WHERE user_id = ? AND status = 'pending'").get();
    return row && row.count > 0;
  },
  approve(id, reviewerId) {
    const req = this.getById(id);
    if (!req || req.status !== 'pending') return null;

    if (req.requested_name) {
      users.updateFullName(req.user_id, req.requested_name);
    }
    if (req.requested_password) {
      users.updatePassword(req.user_id, req.requested_password);
    }

    db.prepare(`
      UPDATE profile_change_requests 
      SET status = 'approved', reviewed_by = ?, reviewed_at = ?
      WHERE id = ?
    `).run(reviewerId, Date.now(), id);

    return users.findById(req.user_id);
  },
  reject(id, reviewerId) {
    const req = this.getById(id);
    if (!req || req.status !== 'pending') return null;

    db.prepare(`
      UPDATE profile_change_requests 
      SET status = 'rejected', reviewed_by = ?, reviewed_at = ?
      WHERE id = ?
    `).run(reviewerId, Date.now(), id);

    return true;
  }
};

const pushSubscriptions = {
  save({ userId, endpoint, p256dh, auth, userAgent }) {
    try {
      const existing = db.prepare('SELECT id FROM push_subscriptions WHERE endpoint = ?').get(endpoint);
      if (existing) {
        db.prepare(`
          UPDATE push_subscriptions 
          SET user_id = ?, p256dh = ?, auth = ?, user_agent = ?, created_at = ?
          WHERE endpoint = ?
        `).run(userId || null, p256dh, auth, userAgent || '', Date.now(), endpoint);
        return existing.id;
      } else {
        const info = db.prepare(`
          INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(userId || null, endpoint, p256dh, auth, userAgent || '', Date.now());
        return info.lastInsertRowid;
      }
    } catch (err) {
      console.error('Error saving push subscription:', err);
      return null;
    }
  },
  remove(endpoint) {
    try {
      db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
    } catch (err) {
      console.error('Error removing push subscription:', err);
    }
  },
  getAll(excludeUserId = null) {
    try {
      if (excludeUserId) {
        return db.prepare('SELECT * FROM push_subscriptions WHERE user_id IS NULL OR user_id != ?').all(excludeUserId);
      }
      return db.prepare('SELECT * FROM push_subscriptions').all();
    } catch (err) {
      console.error('Error getting push subscriptions:', err);
      return [];
    }
  },
  getByUserId(userId) {
    try {
      return db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(userId);
    } catch (err) {
      console.error('Error getting user push subscriptions:', err);
      return [];
    }
  }
};

module.exports = {
  db,
  initDb,
  users,
  messages,
  questions,
  library,
  dreamSessions,
  dreamMessages,
  settings,
  passwordResets,
  privateMessages,
  messageReactions,
  profileChangeRequests,
  pushSubscriptions,
  calculateStars
};
