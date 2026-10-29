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
      last_star_awarded_at INTEGER DEFAULT NULL,
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
      is_deleted INTEGER DEFAULT 0,
      deleted_at INTEGER DEFAULT NULL,
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

    CREATE TABLE IF NOT EXISTS live_recordings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recording_number INTEGER NOT NULL,
      title TEXT NOT NULL,
      audio_url TEXT NOT NULL,
      duration TEXT DEFAULT '',
      recorded_by_id INTEGER NOT NULL,
      recorded_by_name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS recorded_lessons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lesson_number INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      audio_url TEXT NOT NULL,
      duration TEXT DEFAULT '',
      uploaded_by_id INTEGER NOT NULL,
      uploaded_by_name TEXT NOT NULL,
      uploaded_by_role TEXT NOT NULL,
      teacher_name TEXT DEFAULT '',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_security_incidents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      incident_type TEXT NOT NULL,
      user_id INTEGER,
      user_name TEXT,
      details TEXT,
      severity TEXT DEFAULT 'medium',
      action_taken TEXT DEFAULT 'blocked',
      evidence TEXT DEFAULT '',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_advisor_chats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      sender TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS message_button_clicks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      clicked_at INTEGER NOT NULL,
      UNIQUE(message_id, user_id),
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS complaints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL,
      subject TEXT DEFAULT '',
      content TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  try {
    db.prepare("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('dream_status', 'online')").run();
    db.prepare("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('dream_away_message', 'ئێستا کاتی پشووە، بەڕێوەبەر لە زووترین کاتدا وەڵامت دەداتەوە')").run();
  } catch (e) {}

  // Migrations for existing database
  try { db.exec("ALTER TABLE users ADD COLUMN gender TEXT DEFAULT 'male'"); } catch (e) {}
  try { db.exec("ALTER TABLE users ADD COLUMN avatar_url TEXT DEFAULT NULL"); } catch (e) {}
  try { db.exec("ALTER TABLE users ADD COLUMN special_badge TEXT DEFAULT NULL"); } catch (e) {}
  try { db.exec("ALTER TABLE users ADD COLUMN last_read_message_id INTEGER DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE users ADD COLUMN last_star_awarded_at INTEGER DEFAULT NULL"); } catch (e) {}
  try { db.exec("ALTER TABLE users ADD COLUMN last_active_at INTEGER DEFAULT NULL"); } catch (e) {}
  try { db.exec("ALTER TABLE users ADD COLUMN last_question_warn_at INTEGER DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE users ADD COLUMN last_warned_missed_count INTEGER DEFAULT 0"); } catch (e) {}
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS live_audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        user_name TEXT NOT NULL,
        username TEXT NOT NULL,
        action TEXT NOT NULL,
        title TEXT,
        started_by_name TEXT,
        duration_seconds INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_live_audit_logs_created ON live_audit_logs(created_at DESC);
    `);
  } catch (e) {}
  try {
    db.exec(`
      UPDATE users 
      SET last_star_awarded_at = (
        SELECT MAX(created_at) FROM star_awards WHERE star_awards.user_id = users.id
      )
      WHERE last_star_awarded_at IS NULL AND EXISTS (
        SELECT 1 FROM star_awards WHERE star_awards.user_id = users.id
      )
    `);
  } catch (e) {}
  try { db.exec("ALTER TABLE messages ADD COLUMN attachment_type TEXT DEFAULT 'none'"); } catch (e) {}
  try { db.exec("ALTER TABLE messages ADD COLUMN attachment_url TEXT DEFAULT NULL"); } catch (e) {}
  try { db.exec("ALTER TABLE messages ADD COLUMN is_deleted INTEGER DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE messages ADD COLUMN deleted_at INTEGER DEFAULT NULL"); } catch (e) {}
  try { db.exec("ALTER TABLE library_books ADD COLUMN files TEXT DEFAULT '[]'"); } catch (e) {}
  try { db.exec("ALTER TABLE ai_security_incidents ADD COLUMN evidence TEXT DEFAULT ''"); } catch (e) {}
  
  // --- CUSTOM PRIVATE GROUP CHATS ---
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS custom_group_chats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        created_by_id INTEGER NOT NULL,
        created_by_name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS custom_group_members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        added_at INTEGER NOT NULL,
        last_read_at INTEGER DEFAULT 0,
        UNIQUE(group_id, user_id),
        FOREIGN KEY (group_id) REFERENCES custom_group_chats(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS custom_group_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id INTEGER NOT NULL,
        sender_id INTEGER NOT NULL,
        sender_name TEXT NOT NULL,
        sender_role TEXT NOT NULL,
        content TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'text',
        attachment_url TEXT DEFAULT NULL,
        attachment_name TEXT DEFAULT NULL,
        attachment_size INTEGER DEFAULT 0,
        is_advisor INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (group_id) REFERENCES custom_group_chats(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_cgm_group ON custom_group_messages(group_id, created_at ASC);
      CREATE INDEX IF NOT EXISTS idx_cgmem_user ON custom_group_members(user_id);
    `);
  } catch (e) {
    console.error('Error creating custom_group_chats tables:', e);
  }
  try { db.exec("ALTER TABLE questions ADD COLUMN duration_minutes INTEGER DEFAULT 5"); } catch (e) {}
  try { db.exec("ALTER TABLE questions ADD COLUMN expires_at INTEGER DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE questions ADD COLUMN is_revealed INTEGER DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE questions ADD COLUMN question_number INTEGER DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE questions ADD COLUMN publish_at INTEGER DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE questions ADD COLUMN is_published INTEGER DEFAULT 1"); } catch (e) {}
  try { db.exec("ALTER TABLE question_submissions ADD COLUMN is_correct INTEGER DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE dream_sessions ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE dream_sessions ADD COLUMN answered_by_name TEXT DEFAULT NULL"); } catch (e) {}
  try { db.exec("ALTER TABLE dream_sessions ADD COLUMN answered_by_role TEXT DEFAULT NULL"); } catch (e) {}
  try { db.exec("ALTER TABLE dream_sessions ADD COLUMN answered_at INTEGER DEFAULT NULL"); } catch (e) {}
  try {
    db.exec(`
      UPDATE dream_sessions 
      SET 
        answered_by_name = (
          SELECT sender_name FROM dream_messages m 
          WHERE m.session_id = dream_sessions.id 
            AND (m.sender_type = 'teacher' OR m.sender_type = 'super_admin') 
            AND m.content NOT LIKE '%🌸 بەخێربێیت%' 
            AND m.content NOT LIKE '%عَلَيْكُمُ السَّلَامُ%' 
          ORDER BY m.created_at DESC LIMIT 1
        ),
        answered_by_role = (
          SELECT sender_type FROM dream_messages m 
          WHERE m.session_id = dream_sessions.id 
            AND (m.sender_type = 'teacher' OR m.sender_type = 'super_admin') 
            AND m.content NOT LIKE '%🌸 بەخێربێیت%' 
            AND m.content NOT LIKE '%عَلَيْكُمُ السَّلَامُ%' 
          ORDER BY m.created_at DESC LIMIT 1
        )
      WHERE answered_by_name IS NULL
    `);
  } catch (e) {}
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS live_recordings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recording_number INTEGER NOT NULL,
        title TEXT NOT NULL,
        audio_url TEXT NOT NULL,
        duration TEXT DEFAULT '',
        recorded_by_id INTEGER NOT NULL,
        recorded_by_name TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS recorded_lessons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lesson_number INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT DEFAULT '',
        audio_url TEXT NOT NULL,
        duration TEXT DEFAULT '',
        uploaded_by_id INTEGER NOT NULL,
        uploaded_by_name TEXT NOT NULL,
        uploaded_by_role TEXT NOT NULL,
        teacher_name TEXT DEFAULT '',
        created_at INTEGER NOT NULL
      );
    `);
  } catch (e) {}

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS message_button_clicks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        clicked_at INTEGER NOT NULL,
        UNIQUE(message_id, user_id),
        FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);
  } catch (e) {}

  // Course enrollments migration
  try { db.exec("ALTER TABLE users ADD COLUMN course_enrollments TEXT DEFAULT '[]'"); } catch (e) {}

  // Polls & Event Alarms tables
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS polls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_type TEXT NOT NULL,
        group_id INTEGER DEFAULT NULL,
        creator_id INTEGER NOT NULL,
        creator_name TEXT NOT NULL,
        creator_role TEXT NOT NULL,
        question TEXT NOT NULL,
        options TEXT NOT NULL,
        is_closed INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS poll_votes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        poll_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        user_name TEXT NOT NULL,
        option_index INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(poll_id, user_id),
        FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS event_alarms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_type TEXT NOT NULL,
        group_id INTEGER DEFAULT NULL,
        creator_id INTEGER NOT NULL,
        creator_name TEXT NOT NULL,
        creator_role TEXT NOT NULL,
        title TEXT NOT NULL,
        target_time INTEGER NOT NULL,
        is_triggered INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_alarms_target ON event_alarms(target_time ASC);

      -- ATTENDANCE & LEAVE TABLES (@هاتن / @غیابات)
      CREATE TABLE IF NOT EXISTS attendance_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id INTEGER DEFAULT NULL,
        creator_id INTEGER NOT NULL,
        creator_name TEXT NOT NULL,
        creator_role TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT 'تۆماری ئامادەبوون و غیابات',
        status TEXT NOT NULL DEFAULT 'active',
        created_at INTEGER NOT NULL,
        closed_at INTEGER DEFAULT NULL
      );

      CREATE TABLE IF NOT EXISTS attendance_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        user_name TEXT NOT NULL,
        user_role TEXT DEFAULT 'student',
        status TEXT NOT NULL,
        excuse_reason TEXT DEFAULT '',
        reviewed_by_id INTEGER DEFAULT NULL,
        reviewed_by_name TEXT DEFAULT NULL,
        recorded_at INTEGER NOT NULL,
        UNIQUE(session_id, user_id),
        FOREIGN KEY (session_id) REFERENCES attendance_sessions(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_att_sess ON attendance_records(session_id);
      CREATE INDEX IF NOT EXISTS idx_att_user ON attendance_records(user_id);
    `);
  } catch (e) {
    console.error('Error creating polls, alarms, or attendance tables:', e);
  }

  // Enforce 1 reaction per user per message (Deduplicate & Unique Index)
  try {
    db.prepare(`
      DELETE FROM message_reactions 
      WHERE id NOT IN (
        SELECT MAX(id) FROM message_reactions GROUP BY message_id, user_id
      )
    `).run();
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_msg_reactions_user_msg ON message_reactions(message_id, user_id)').run();
  } catch (e) {}

  // Migrations for Dream Interpretation, Library, and Recorded Lessons
  try { db.exec("ALTER TABLE dream_sessions ADD COLUMN is_interpreted INTEGER NOT NULL DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE library_books ADD COLUMN cover_image TEXT DEFAULT ''"); } catch (e) {}
  try { db.exec("ALTER TABLE library_books ADD COLUMN author_image TEXT DEFAULT ''"); } catch (e) {}
  try { db.exec("ALTER TABLE recorded_lessons ADD COLUMN teacher_name TEXT DEFAULT ''"); } catch (e) {}

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
    db.prepare("UPDATE users SET username = 'hemntjabar', full_name = 'هێمن طه', role = 'super_admin', status = 'approved', is_blocked = 0, password_hash = ? WHERE id = ?").run(adminHash, existingAdmin.id);
  } else {
    const insertAdmin = db.prepare(`
      INSERT INTO users (username, password_hash, full_name, gender, role, status, is_blocked, muted_until, correct_answers_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertAdmin.run(
      'hemntjabar',
      adminHash,
      'هێمن طه',
      'male',
      'super_admin',
      'approved',
      0,
      0,
      0,
      Date.now()
    );
  }
  try {
    db.prepare("UPDATE users SET full_name = 'هێمن طه' WHERE role = 'super_admin' OR username = 'hemntjabar'").run();
  } catch (e) {}
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
      clean === 'هێمن طه' ||
      clean === 'هێمن' ||
      clean === 'هێمن ته‌ها' ||
      clean.replace(/\s+/g, '') === 'هێمنتەها' ||
      clean.replace(/\s+/g, '') === 'هێمنطه'
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
  findByUsernameOrName(identifier) {
    return this.findByUsername(identifier);
  },
  searchUsers(query, limit = 10) {
    if (!query) return [];
    const clean = String(query).trim();
    return db.prepare(`
      SELECT id, username, full_name, role, status, is_blocked, special_badge, correct_answers_count, created_at 
      FROM users 
      WHERE username LIKE ? OR full_name LIKE ?
      LIMIT ?
    `).all(`%${clean}%`, `%${clean}%`, limit);
  },
  create(username, passwordHash, fullName, gender = 'male', role = 'student', status = 'pending') {
    const now = Date.now();
    const stmt = db.prepare(`
      INSERT INTO users (username, password_hash, full_name, gender, role, status, is_blocked, muted_until, correct_answers_count, created_at, last_active_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?)
    `);
    const result = stmt.run(username, passwordHash, fullName, gender, role, status, now, now);
    return result.lastInsertRowid;
  },
  updateLastActive(id) {
    try {
      return db.prepare('UPDATE users SET last_active_at = ? WHERE id = ?').run(Date.now(), id);
    } catch (e) {
      return null;
    }
  },
  getInactiveUsers(thresholdMs) {
    try {
      const cutoff = Date.now() - thresholdMs;
      return db.prepare(`
        SELECT id, username, full_name, role, special_badge, created_at, last_active_at
        FROM users
        WHERE role != 'super_admin'
          AND username != 'admin'
          AND username != 'hemntjabar'
          AND id != 1
          AND COALESCE(last_active_at, created_at) < ?
      `).all(cutoff);
    } catch (e) {
      console.error('Error fetching inactive users:', e);
      return [];
    }
  },
  getPendingUsers() {
    const stmt = db.prepare("SELECT id, username, full_name, gender, role, status, created_at FROM users WHERE status = 'pending' ORDER BY created_at ASC");
    return stmt.all();
  },
  getAllUsers() {
    const stmt = db.prepare("SELECT id, username, full_name, gender, role, status, is_blocked, muted_until, correct_answers_count, last_star_awarded_at, avatar_url, special_badge, created_at, last_active_at FROM users ORDER BY role = 'super_admin' DESC, role = 'admin' DESC, role = 'teacher' DESC, role = 'student' DESC, role = 'new_student' DESC, role = 'guest' DESC, correct_answers_count DESC, created_at DESC");
    return stmt.all();
  },
  getAll() {
    return this.getAllUsers();
  },
  updateAvatar(id, avatarUrl) {
    const stmt = db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?');
    return stmt.run(avatarUrl, id);
  },
  updateSpecialBadge(id, specialBadge) {
    let val = specialBadge;
    if (Array.isArray(val)) {
      val = val.filter(Boolean).map(b => String(b).trim().toLowerCase()).join(',');
    }
    val = val ? String(val).trim().toLowerCase() : null;
    if (val === '' || val === 'none') val = null;
    const stmt = db.prepare('UPDATE users SET special_badge = ? WHERE id = ?');
    return stmt.run(val, id);
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
  updateLastReadMessage(id, messageId) {
    if (!id || !messageId) return;
    const stmt = db.prepare('UPDATE users SET last_read_message_id = ? WHERE id = ?');
    return stmt.run(messageId, id);
  },
  getLastReadMessage(id) {
    if (!id) return 0;
    const row = db.prepare('SELECT last_read_message_id FROM users WHERE id = ?').get(id);
    return row ? (row.last_read_message_id || 0) : 0;
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
      avatar_url: user.avatar_url || null,
      special_badge: user.special_badge || null,
      is_blocked: user.is_blocked,
      muted_until: user.muted_until,
      correct_answers_count: user.correct_answers_count,
      last_star_awarded_at: user.last_star_awarded_at || null,
      is_star_glowing: Boolean(user.last_star_awarded_at && (Date.now() - Number(user.last_star_awarded_at) <= 48 * 60 * 60 * 1000)),
      created_at: user.created_at,
      starInfo,
      roleHistory: history,
      promotionsCount: history.filter(h => h.new_role === 'admin').length,
      answeredQuestions: answered,
      course_enrollments: (() => {
        try { return JSON.parse(user.course_enrollments || '[]'); } catch(e) { return []; }
      })()
    };
  },
  updateCourseEnrollments(id, courses) {
    const json = JSON.stringify(Array.isArray(courses) ? courses : []);
    return db.prepare('UPDATE users SET course_enrollments = ? WHERE id = ?').run(json, id);
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
    const now = Date.now();
    const stmt = db.prepare('UPDATE users SET correct_answers_count = correct_answers_count + 1, last_star_awarded_at = ? WHERE id = ?');
    stmt.run(now, id);
    const updated = db.prepare('SELECT correct_answers_count FROM users WHERE id = ?').get(id);
    return updated ? updated.correct_answers_count : 0;
  },
  adjustStars(id, delta) {
    const deltaNum = Number(delta) || 0;
    if (deltaNum > 0) {
      db.prepare('UPDATE users SET correct_answers_count = MAX(0, correct_answers_count + ?), last_star_awarded_at = ? WHERE id = ?').run(deltaNum, Date.now(), id);
    } else {
      db.prepare('UPDATE users SET correct_answers_count = MAX(0, correct_answers_count + ?) WHERE id = ?').run(deltaNum, id);
    }
    const updated = db.prepare('SELECT correct_answers_count FROM users WHERE id = ?').get(id);
    return updated ? updated.correct_answers_count : 0;
  },
  recordStarAward(id, timestamp = Date.now()) {
    db.prepare('UPDATE users SET last_star_awarded_at = ? WHERE id = ?').run(timestamp, id);
  },
  updateFullName(id, newName) {
    db.prepare('UPDATE users SET full_name = ? WHERE id = ?').run(newName.trim(), id);
    return this.findById(id);
  },
  updateGender(id, gender) {
    const safeGender = gender === 'female' ? 'female' : 'male';
    db.prepare('UPDATE users SET gender = ? WHERE id = ?').run(safeGender, id);
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
    if (typeof userId === 'object' && userId !== null) {
      const obj = userId;
      userId = obj.user_id ?? obj.userId;
      username = obj.username;
      fullName = obj.full_name ?? obj.fullName;
      role = obj.role;
      content = obj.content;
      type = obj.type || 'text';
      questionId = obj.question_id ?? obj.questionId ?? null;
      replyToId = obj.reply_to_id ?? obj.replyToId ?? null;
      attachmentType = obj.attachment_type ?? obj.attachmentType ?? 'none';
      attachmentUrl = obj.attachment_url ?? obj.attachmentUrl ?? null;
    }
    const stmt = db.prepare(`
      INSERT INTO messages (user_id, username, full_name, role, content, type, question_id, reply_to_id, attachment_type, attachment_url, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(userId, username, fullName, role, content, type, questionId, replyToId, attachmentType, attachmentUrl, Date.now());
    return this.findById(result.lastInsertRowid);
  },
  findById(id) {
    const stmt = db.prepare(`
      SELECT m.*, u.gender, u.correct_answers_count, u.last_star_awarded_at,
        orig.full_name as reply_to_name,
        orig.content as reply_to_content,
        orig.attachment_type as reply_to_attachment_type
      FROM messages m
      LEFT JOIN users u ON m.user_id = u.id
      LEFT JOIN messages orig ON m.reply_to_id = orig.id
      WHERE m.id = ?
    `);
    return stmt.get(id);
  },
  getRecent(limit = 120) {
    const stmt = db.prepare(`
      SELECT m.*, u.gender, u.correct_answers_count, u.last_star_awarded_at,
        orig.full_name as reply_to_name,
        orig.content as reply_to_content,
        orig.attachment_type as reply_to_attachment_type
      FROM messages m
      LEFT JOIN users u ON m.user_id = u.id
      LEFT JOIN messages orig ON m.reply_to_id = orig.id
      WHERE COALESCE(m.is_deleted, 0) = 0
      ORDER BY m.id DESC
      LIMIT ?
    `);
    const rows = stmt.all(limit);
    return rows.reverse();
  },
  getUserMessageCountLast24h(userId) {
    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
    const stmt = db.prepare("SELECT COUNT(*) as count FROM messages WHERE user_id = ? AND type = 'text' AND created_at >= ? AND COALESCE(is_deleted, 0) = 0");
    const row = stmt.get(userId, oneDayAgo);
    return row ? row.count : 0;
  },
  delete(id) {
    const stmt = db.prepare('UPDATE messages SET is_deleted = 1, deleted_at = ? WHERE id = ?');
    return stmt.run(Date.now(), id);
  },
  hardDelete(id) {
    const stmt = db.prepare('DELETE FROM messages WHERE id = ?');
    return stmt.run(id);
  },
  clearAll() {
    const now = Date.now();
    return db.prepare('UPDATE messages SET is_deleted = 1, deleted_at = ? WHERE COALESCE(is_deleted, 0) = 0').run(now);
  },
  getDeleted(options = {}) {
    const { userId = null, limit = 50 } = options;
    let sql = `
      SELECT m.*, u.gender, u.correct_answers_count, u.last_star_awarded_at,
        orig.full_name as reply_to_name,
        orig.content as reply_to_content
      FROM messages m
      LEFT JOIN users u ON m.user_id = u.id
      LEFT JOIN messages orig ON m.reply_to_id = orig.id
      WHERE m.is_deleted = 1
    `;
    const params = [];
    if (userId) {
      sql += ' AND m.user_id = ?';
      params.push(userId);
    }
    sql += ' ORDER BY COALESCE(m.deleted_at, m.id) DESC, m.id DESC LIMIT ?';
    params.push(Number(limit) || 50);
    return db.prepare(sql).all(...params);
  },
  restore(options = {}) {
    const { messageIds = null, userId = null, limit = null } = options;
    if (Array.isArray(messageIds) && messageIds.length > 0) {
      const placeholders = messageIds.map(() => '?').join(',');
      db.prepare(`UPDATE messages SET is_deleted = 0, deleted_at = NULL WHERE id IN (${placeholders})`).run(...messageIds);
      return db.prepare(`
        SELECT m.*, u.gender, u.correct_answers_count, u.last_star_awarded_at,
          orig.full_name as reply_to_name,
          orig.content as reply_to_content,
          orig.attachment_type as reply_to_attachment_type
        FROM messages m
        LEFT JOIN users u ON m.user_id = u.id
        LEFT JOIN messages orig ON m.reply_to_id = orig.id
        WHERE m.id IN (${placeholders})
        ORDER BY m.id ASC
      `).all(...messageIds);
    }

    let findSql = 'SELECT id FROM messages WHERE is_deleted = 1';
    const params = [];
    if (userId) {
      findSql += ' AND user_id = ?';
      params.push(userId);
    }
    findSql += ' ORDER BY COALESCE(deleted_at, id) DESC, id DESC';
    if (limit && Number(limit) > 0) {
      findSql += ' LIMIT ?';
      params.push(Number(limit));
    }

    const targets = db.prepare(findSql).all(...params);
    if (!targets || targets.length === 0) return [];

    const ids = targets.map(t => t.id);
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(`UPDATE messages SET is_deleted = 0, deleted_at = NULL WHERE id IN (${placeholders})`).run(...ids);

    return db.prepare(`
      SELECT m.*, u.gender, u.correct_answers_count, u.last_star_awarded_at,
        orig.full_name as reply_to_name,
        orig.content as reply_to_content,
        orig.attachment_type as reply_to_attachment_type
      FROM messages m
      LEFT JOIN users u ON m.user_id = u.id
      LEFT JOIN messages orig ON m.reply_to_id = orig.id
      WHERE m.id IN (${placeholders})
      ORDER BY m.id ASC
    `).all(...ids);
  }
};

// Question helper methods
const questions = {
  create(adminId, adminName, questionText, correctAnswer = null, durationMinutes = 5, customExpiresAt = null, publishAt = 0) {
    const isScheduled = publishAt && Number(publishAt) > Date.now();
    const cleanPublishAt = isScheduled ? Number(publishAt) : 0;
    const isPublished = isScheduled ? 0 : 1;
    const isActive = isScheduled ? 0 : 1;

    let expiresAt = 0;
    let finalDurationMinutes = durationMinutes;

    if (customExpiresAt) {
      expiresAt = Number(customExpiresAt);
      const baseTime = isScheduled ? cleanPublishAt : Date.now();
      finalDurationMinutes = Math.max(1, Math.round((expiresAt - baseTime) / 60000));
    } else {
      const baseTime = isScheduled ? cleanPublishAt : Date.now();
      expiresAt = baseTime + (durationMinutes * 60 * 1000);
      finalDurationMinutes = durationMinutes;
    }
    
    const countRow = db.prepare('SELECT COUNT(*) as total FROM questions').get();
    const questionNumber = (countRow ? countRow.total : 0) + 1;

    const stmt = db.prepare(`
      INSERT INTO questions (admin_id, admin_name, question_text, correct_answer, duration_minutes, expires_at, is_revealed, is_active, question_number, publish_at, is_published, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(adminId, adminName, questionText, correctAnswer ? correctAnswer.trim() : null, finalDurationMinutes, expiresAt, isActive, questionNumber, cleanPublishAt, isPublished, Date.now());
    this.renumberQuestions();
    return this.findById(result.lastInsertRowid);
  },
  getAll() {
    return this.getAllArchive();
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
  getScheduledQuestions() {
    const stmt = db.prepare(`
      SELECT q.*, 0 as submissions_count, 0 as awards_count
      FROM questions q
      WHERE q.is_published = 0
      ORDER BY q.publish_at ASC
    `);
    return stmt.all();
  },
  publishNow(id) {
    const q = this.findById(id);
    if (!q) return null;
    const now = Date.now();
    let expiresAt = q.expires_at;
    if (!expiresAt || expiresAt <= now) {
      expiresAt = now + ((q.duration_minutes || 5) * 60 * 1000);
    }
    db.prepare('UPDATE questions SET is_published = 1, is_active = 1, publish_at = ?, expires_at = ? WHERE id = ?').run(now, expiresAt, id);
    return this.findById(id);
  },
  findById(id) {
    const stmt = db.prepare('SELECT * FROM questions WHERE id = ?');
    return stmt.get(id);
  },
  getActive() {
    const stmt = db.prepare('SELECT * FROM questions WHERE is_active = 1 AND is_revealed = 0 AND is_published = 1 AND (expires_at = 0 OR expires_at > ?) ORDER BY created_at DESC LIMIT 1');
    return stmt.get(Date.now());
  },
  getTodayQuestions(todayStart) {
    const now = Date.now();
    const stmt = db.prepare(`
      SELECT q.*, 
        (SELECT COUNT(*) FROM question_submissions WHERE question_id = q.id) as submission_count
      FROM questions q 
      WHERE q.is_published = 1 AND (q.created_at >= ? OR (q.is_active = 1 AND q.is_revealed = 0 AND (q.expires_at = 0 OR q.expires_at > ?)))
      ORDER BY q.created_at ASC
    `);
    return stmt.all(todayStart, now);
  },
  getStudentConsecutiveMissedCount(userId, checkLimit = 5) {
    const recentRevealed = db.prepare("SELECT id FROM questions WHERE is_revealed = 1 ORDER BY id DESC LIMIT ?").all(checkLimit);
    if (!recentRevealed || recentRevealed.length < checkLimit) return 0;
    
    let consecutiveMissed = 0;
    for (const q of recentRevealed) {
      const hasAnswered = db.prepare("SELECT 1 FROM question_submissions WHERE question_id = ? AND user_id = ? LIMIT 1").get(q.id, userId);
      if (!hasAnswered) {
        consecutiveMissed++;
      } else {
        break;
      }
    }
    return consecutiveMissed;
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
      const qNumberMap = new Map();
      allQ.forEach((q, idx) => {
        const newNum = idx + 1;
        updateQ.run(newNum, q.id);
        qNumberMap.set(q.id, newNum);
      });

      // Also update messages in chat for questions and revealed submissions
      const allMsgs = db.prepare("SELECT id, content, question_id FROM messages WHERE type = 'question' OR type = 'revealed_submissions'").all();
      const updateMsg = db.prepare('UPDATE messages SET content = ? WHERE id = ?');
      for (const m of allMsgs) {
        try {
          const parsed = JSON.parse(m.content);
          const qId = m.question_id || parsed.question_id || parsed.id;
          if (qId && qNumberMap.has(qId)) {
            const newNum = qNumberMap.get(qId);
            if (parsed.question_number !== newNum) {
              parsed.question_number = newNum;
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
      const qMsgs = db.prepare("SELECT id, content FROM messages WHERE type = 'question'").all();
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
    const now = Date.now();
    try {
      db.prepare('UPDATE question_submissions SET is_correct = 1 WHERE question_id = ? AND user_id = ?').run(questionId, userId);
    } catch (e) {}
    try {
      db.prepare('UPDATE users SET last_star_awarded_at = ? WHERE id = ?').run(now, userId);
    } catch (e) {}
    return stmt.run(questionId, userId, awardedBy, now);
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

function parseBookFiles(book) {
  if (!book) return null;
  let files = [];
  try {
    if (book.files && typeof book.files === 'string') {
      files = JSON.parse(book.files);
    } else if (Array.isArray(book.files)) {
      files = book.files;
    }
  } catch (e) {
    files = [];
  }
  if (!Array.isArray(files) || files.length === 0) {
    if (book.file_url) {
      files = [{
        file_name: book.file_name || 'فایلی سەرەکی',
        file_url: book.file_url,
        file_size: book.file_size || 0,
        file_type: book.file_type || 'pdf'
      }];
    }
  }
  return {
    ...book,
    files
  };
}

// Library helper methods (Books, PDFs, Multi-File Collections)
const library = {
  create(title, author, description, category, fileUrl, fileName, fileSize, fileType, uploaderId, uploaderName, files = [], coverImage = '', authorImage = '') {
    let fileList = Array.isArray(files) && files.length > 0 ? files : [];
    if (fileList.length === 0 && fileUrl) {
      fileList.push({
        file_name: fileName || 'فایلی سەرەکی',
        file_url: fileUrl,
        file_size: fileSize || 0,
        file_type: fileType || 'pdf'
      });
    }
    const primaryFile = fileList[0] || { file_url: fileUrl || '', file_name: fileName || '', file_size: fileSize || 0, file_type: fileType || 'pdf' };
    const filesJson = JSON.stringify(fileList);

    const stmt = db.prepare(`
      INSERT INTO library_books (title, author, description, category, file_url, file_name, file_size, file_type, uploader_id, uploader_name, files, cover_image, author_image, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      title.trim(),
      author ? author.trim() : '',
      description ? description.trim() : '',
      category ? category.trim() : 'گشتی',
      primaryFile.file_url,
      primaryFile.file_name,
      primaryFile.file_size || 0,
      primaryFile.file_type || 'pdf',
      uploaderId,
      uploaderName,
      filesJson,
      coverImage || '',
      authorImage || '',
      Date.now()
    );
    return this.findById(result.lastInsertRowid);
  },
  updateImages(id, coverImage, authorImage) {
    if (coverImage !== undefined && authorImage !== undefined) {
      db.prepare('UPDATE library_books SET cover_image = ?, author_image = ? WHERE id = ?').run(coverImage || '', authorImage || '', id);
    } else if (coverImage !== undefined) {
      db.prepare('UPDATE library_books SET cover_image = ? WHERE id = ?').run(coverImage || '', id);
    } else if (authorImage !== undefined) {
      db.prepare('UPDATE library_books SET author_image = ? WHERE id = ?').run(authorImage || '', id);
    }
    return this.findById(id);
  },
  findById(id) {
    const stmt = db.prepare('SELECT * FROM library_books WHERE id = ?');
    const row = stmt.get(id);
    return parseBookFiles(row);
  },
  getAll(search = '') {
    let rows = [];
    if (search && search.trim()) {
      const q = `%${search.trim().toLowerCase()}%`;
      const stmt = db.prepare(`
        SELECT * FROM library_books 
        WHERE LOWER(title) LIKE ? OR LOWER(author) LIKE ? OR LOWER(description) LIKE ? OR LOWER(category) LIKE ? OR LOWER(files) LIKE ?
        ORDER BY created_at DESC
      `);
      rows = stmt.all(q, q, q, q, q);
    } else {
      const stmt = db.prepare('SELECT * FROM library_books ORDER BY created_at DESC');
      rows = stmt.all();
    }
    return rows.map(parseBookFiles);
  },
  addFiles(id, newFiles = []) {
    const book = this.findById(id);
    if (!book) return null;
    const currentFiles = book.files || [];
    const updatedFiles = [...currentFiles, ...newFiles];
    db.prepare('UPDATE library_books SET files = ? WHERE id = ?').run(JSON.stringify(updatedFiles), id);
    return this.findById(id);
  },
  removeFile(id, fileIndex) {
    const book = this.findById(id);
    if (!book || !book.files || fileIndex < 0 || fileIndex >= book.files.length) return null;
    const removed = book.files[fileIndex];
    const updatedFiles = book.files.filter((_, idx) => idx !== fileIndex);

    const primary = updatedFiles[0] || { file_url: '', file_name: '', file_size: 0, file_type: 'pdf' };
    db.prepare('UPDATE library_books SET files = ?, file_url = ?, file_name = ?, file_size = ?, file_type = ? WHERE id = ?').run(
      JSON.stringify(updatedFiles),
      primary.file_url,
      primary.file_name,
      primary.file_size,
      primary.file_type,
      id
    );
    return { book: this.findById(id), removedFile: removed };
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
        COALESCE(s.answered_by_name, (SELECT sender_name FROM dream_messages m WHERE m.session_id = s.id AND (m.sender_type = 'teacher' OR m.sender_type = 'super_admin') AND m.content NOT LIKE '%🌸 بەخێربێیت%' AND m.content NOT LIKE '%عَلَيْكُمُ السَّلَامُ%' ORDER BY m.created_at DESC LIMIT 1)) as answered_by_name,
        COALESCE(s.answered_by_role, (SELECT sender_type FROM dream_messages m WHERE m.session_id = s.id AND (m.sender_type = 'teacher' OR m.sender_type = 'super_admin') AND m.content NOT LIKE '%🌸 بەخێربێیت%' AND m.content NOT LIKE '%عَلَيْكُمُ السَّلَامُ%' ORDER BY m.created_at DESC LIMIT 1)) as answered_by_role,
        (SELECT COUNT(*) FROM dream_messages m WHERE m.session_id = s.id) as message_count,
        (SELECT COUNT(*) FROM dream_messages m WHERE m.session_id = s.id AND (m.type = 'voice' OR (m.attachment_url IS NOT NULL AND (m.attachment_url LIKE '%.webm%' OR m.attachment_url LIKE '%.ogg%' OR m.attachment_url LIKE '%.mp3%' OR m.attachment_url LIKE '%.m4a%')) OR m.content LIKE '%.webm%' OR m.content LIKE '%.ogg%' OR m.content LIKE '%.mp3%' OR m.content LIKE '%.m4a%') AND m.sender_type = 'dreamer') as has_voice,
        (SELECT content FROM dream_messages m WHERE m.session_id = s.id ORDER BY m.created_at DESC LIMIT 1) as last_message_content,
        (SELECT type FROM dream_messages m WHERE m.session_id = s.id ORDER BY m.created_at DESC LIMIT 1) as last_message_type
      FROM dream_sessions s 
      WHERE (SELECT COUNT(*) FROM dream_messages m WHERE m.session_id = s.id AND m.sender_type = 'dreamer') > 0
      ORDER BY s.last_activity DESC
    `);
    return stmt.all();
  },
  markAnswered(sessionId, staffName, staffRole) {
    const stmt = db.prepare('UPDATE dream_sessions SET answered_by_name = ?, answered_by_role = ?, answered_at = ?, last_activity = ? WHERE id = ?');
    return stmt.run(staffName, staffRole, Date.now(), Date.now(), sessionId);
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
  toggleInterpreted(sessionId) {
    const s = this.findById(sessionId);
    if (!s) return null;
    const newStatus = s.is_interpreted ? 0 : 1;
    db.prepare('UPDATE dream_sessions SET is_interpreted = ? WHERE id = ?').run(newStatus, sessionId);
    return newStatus;
  },
  delete(sessionId) {
    db.prepare('DELETE FROM dream_messages WHERE session_id = ?').run(sessionId);
    return db.prepare('DELETE FROM dream_sessions WHERE id = ?').run(sessionId);
  }
};

const dreamTeacherAliasMap = new Map();
dreamTeacherAliasMap.set('hemn taha', 'مامۆستا ١');
dreamTeacherAliasMap.set('hemntjabar', 'مامۆستا ١');
dreamTeacherAliasMap.set('هێمن طه', 'مامۆستا ١');
dreamTeacherAliasMap.set('هێمن تەها', 'مامۆستا ١');
dreamTeacherAliasMap.set('ڕاستی', 'مامۆستا ٢');
dreamTeacherAliasMap.set('مامۆستا ڕاستی', 'مامۆستا ٢');

let nextDynamicTeacherIndex = 3;

function toKurdishNumber(n) {
  const digits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  return String(n).replace(/\d/g, d => digits[d]);
}

function getDreamTeacherAlias(senderName) {
  if (!senderName) return 'مامۆستا ١';
  const clean = senderName.trim();
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
  if (dreamTeacherAliasMap.has(clean)) {
    return dreamTeacherAliasMap.get(clean);
  }
  const alias = `مامۆستا ${toKurdishNumber(nextDynamicTeacherIndex++)}`;
  dreamTeacherAliasMap.set(clean, alias);
  return alias;
}

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
      const stmt = db.prepare(`SELECT COUNT(*) as count FROM dream_messages WHERE session_id = ? AND (content LIKE '%خەونەکەت بە نامەی دەنگی%' OR content LIKE '%خەونەکەت بە نامەیەکی دەنگی%' OR content LIKE '%بەخێربێیت بۆ بەشی لێکدانەوەی خەونەکان%')`);
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
    const msgs = stmt.all(sessionId);
    return msgs.map(m => {
      if (m.sender_type === 'super_admin' || m.sender_type === 'teacher' || m.sender_type === 'dream_interpreter') {
        return { ...m, sender_name: getDreamTeacherAlias(m.sender_name) };
      }
      return m;
    });
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
        u.id as other_id,
        u.id as other_user_id,
        u.username,
        u.full_name as other_name,
        u.full_name,
        u.role as other_role,
        u.role,
        u.gender as other_gender,
        u.gender,
        (
          SELECT content FROM private_messages 
          WHERE (sender_id = u.id AND recipient_id = ?) OR (sender_id = ? AND recipient_id = u.id)
          ORDER BY id DESC LIMIT 1
        ) as last_message,
        (
          SELECT type FROM private_messages 
          WHERE (sender_id = u.id AND recipient_id = ?) OR (sender_id = ? AND recipient_id = u.id)
          ORDER BY id DESC LIMIT 1
        ) as last_message_type,
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
    return stmt.all(userId, userId, userId, userId, userId, userId, userId, userId, userId, userId);
  },
  getTotalUnreadCount(userId) {
    const row = db.prepare('SELECT COUNT(*) as count FROM private_messages WHERE recipient_id = ? AND is_read = 0').get(userId);
    return row ? row.count : 0;
  }
};

// Message Reactions (🏆, 🤲, 👍, 💯, ❤️, ⭐)
const messageReactions = {
  toggle(messageId, userId, emoji) {
    const existingSame = db.prepare('SELECT id FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').get(messageId, userId, emoji);
    if (existingSame) {
      // User tapped their existing reaction again -> remove it (toggle off)
      db.prepare('DELETE FROM message_reactions WHERE id = ?').run(existingSame.id);
    } else {
      // User tapped a new/different emoji: remove ANY previous reaction this user gave on this message (enforcing max 1 reaction per user)
      db.prepare('DELETE FROM message_reactions WHERE message_id = ? AND user_id = ?').run(messageId, userId);
      // Insert the new reaction
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
      ORDER BY count DESC, emoji ASC
    `).all(messageId);

    return rows.map(r => {
      const uids = (r.user_ids || '').split(',').filter(Boolean).map(Number);
      const isMine = currentUserId ? uids.includes(Number(currentUserId)) : false;
      return {
        emoji: r.emoji,
        count: r.count,
        user_ids: uids,
        reactedByMe: isMine,
        userReacted: isMine
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
      ORDER BY count DESC, emoji ASC
    `).all(...messageIds);

    const map = {};
    for (const id of messageIds) {
      map[id] = [];
    }
    for (const r of rows) {
      const uids = (r.user_ids || '').split(',').filter(Boolean).map(Number);
      const isMine = currentUserId ? uids.includes(Number(currentUserId)) : false;
      if (!map[r.message_id]) map[r.message_id] = [];
      map[r.message_id].push({
        emoji: r.emoji,
        count: r.count,
        user_ids: uids,
        reactedByMe: isMine,
        userReacted: isMine
      });
    }
    return map;
  },
  getUsersForReaction(messageId, emoji) {
    return db.prepare(`
      SELECT u.id, u.full_name, u.username, u.role, u.gender, u.avatar_url, mr.created_at
      FROM message_reactions mr
      JOIN users u ON mr.user_id = u.id
      WHERE mr.message_id = ? AND mr.emoji = ?
      ORDER BY mr.created_at ASC
    `).all(messageId, emoji);
  }
};

// Calculate star level & progress
// Level progression requested by user:
// 0 - 9: Level 0 (Yellow star ⭐) - restarts at 0 after reaching 10
// 10 - 19: Level 1 (Green star ⭐/green) - restarts at 0
// 20 - 29: Level 2 (Purple star ⭐/purple) - restarts at 0
// 30+: Level 3+ (Trophy 🏆)
function calculateStars(correctCount) {
  const count = Number(correctCount) || 0;
  const currentPoints = count % 10;
  const level = Math.floor(count / 10);
  
  let starType = 'yellow';
  let icon = '⭐';
  let badgeColor = 'text-amber-400 border-amber-500/30 bg-amber-500/10';
  let levelName = 'ئاستی یەکەم (زەرد)';
  
  if (level === 1) {
    starType = 'green';
    icon = '⭐';
    badgeColor = 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10';
    levelName = 'ئاستی دووەم (سەوز)';
  } else if (level === 2) {
    starType = 'purple';
    icon = '⭐';
    badgeColor = 'text-purple-400 border-purple-500/30 bg-purple-500/10';
    levelName = 'ئاستی سێیەم (مۆر)';
  } else if (level >= 3) {
    starType = 'trophy';
    icon = '🏆';
    badgeColor = 'text-amber-300 border-amber-500/40 bg-amber-500/20';
    levelName = 'ئاستی قارەمان (کاس)';
  }

  return {
    stars: level + 1,
    level,
    points: currentPoints,
    total: count,
    starType,
    starIcons: icon,
    badgeColor,
    levelName,
    badgeText: `${icon} ${currentPoints}`
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

// Live Lesson Recordings Archive (Admin / Teacher only)
const liveRecordings = {
  create(recordingNumber, title, audioUrl, duration, recordedById, recordedByName) {
    const stmt = db.prepare(`
      INSERT INTO live_recordings (recording_number, title, audio_url, duration, recorded_by_id, recorded_by_name, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const res = stmt.run(recordingNumber, title, audioUrl, duration || '', recordedById, recordedByName, Date.now());
    return this.findById(res.lastInsertRowid);
  },
  findById(id) {
    return db.prepare('SELECT * FROM live_recordings WHERE id = ?').get(id);
  },
  getAll() {
    return db.prepare('SELECT * FROM live_recordings ORDER BY recording_number DESC, created_at DESC').all();
  },
  getNextNumber() {
    const row = db.prepare('SELECT MAX(recording_number) as max_num FROM live_recordings').get();
    return (row && row.max_num) ? row.max_num + 1 : 1;
  },
  updateTitle(id, title, recordingNumber) {
    if (recordingNumber) {
      return db.prepare('UPDATE live_recordings SET title = ?, recording_number = ? WHERE id = ?').run(title.trim(), recordingNumber, id);
    }
    return db.prepare('UPDATE live_recordings SET title = ? WHERE id = ?').run(title.trim(), id);
  },
  delete(id) {
    return db.prepare('DELETE FROM live_recordings WHERE id = ?').run(id);
  }
};

// Recorded Lessons for Students (Uploaded by Teacher/Admin, No Download Allowed)
const recordedLessons = {
  create(lessonNumber, title, description, audioUrl, duration, uploadedById, uploadedByName, uploadedByRole, teacherName = '') {
    const safeTeacher = (teacherName && teacherName.trim()) ? teacherName.trim() : (uploadedByName || 'مامۆستا');
    const stmt = db.prepare(`
      INSERT INTO recorded_lessons (lesson_number, title, description, audio_url, duration, uploaded_by_id, uploaded_by_name, uploaded_by_role, teacher_name, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const res = stmt.run(lessonNumber, title, description || '', audioUrl, duration || '', uploadedById, uploadedByName, uploadedByRole, safeTeacher, Date.now());
    return this.findById(res.lastInsertRowid);
  },
  findById(id) {
    return db.prepare(`
      SELECT id, lesson_number, title, description, audio_url, duration, 
             uploaded_by_id, uploaded_by_name, uploaded_by_role, created_at,
             COALESCE(NULLIF(teacher_name, ''), uploaded_by_name, 'مامۆستا') as teacher_name,
             COALESCE(NULLIF(teacher_name, ''), uploaded_by_name, 'مامۆستا') as instructor_name
      FROM recorded_lessons 
      WHERE id = ?
    `).get(id);
  },
  getAll() {
    return db.prepare(`
      SELECT id, lesson_number, title, description, audio_url, duration, 
             uploaded_by_id, uploaded_by_name, uploaded_by_role, created_at,
             COALESCE(NULLIF(teacher_name, ''), uploaded_by_name, 'مامۆستا') as teacher_name,
             COALESCE(NULLIF(teacher_name, ''), uploaded_by_name, 'مامۆستا') as instructor_name
      FROM recorded_lessons 
      ORDER BY lesson_number ASC, created_at DESC
    `).all();
  },
  getNextNumber(teacherName = '') {
    if (teacherName && teacherName.trim()) {
      const row = db.prepare(`
        SELECT MAX(lesson_number) as max_num 
        FROM recorded_lessons 
        WHERE teacher_name = ? OR uploaded_by_name = ?
      `).get(teacherName.trim(), teacherName.trim());
      return (row && row.max_num) ? row.max_num + 1 : 1;
    }
    const row = db.prepare('SELECT MAX(lesson_number) as max_num FROM recorded_lessons').get();
    return (row && row.max_num) ? row.max_num + 1 : 1;
  },
  update(id, title, description, lessonNumber, teacherName = '') {
    if (teacherName && teacherName.trim()) {
      return db.prepare('UPDATE recorded_lessons SET title = ?, description = ?, lesson_number = ?, teacher_name = ? WHERE id = ?')
        .run(title.trim(), description ? description.trim() : '', lessonNumber, teacherName.trim(), id);
    }
    return db.prepare('UPDATE recorded_lessons SET title = ?, description = ?, lesson_number = ? WHERE id = ?')
      .run(title.trim(), description ? description.trim() : '', lessonNumber, id);
  },
  delete(id) {
    return db.prepare('DELETE FROM recorded_lessons WHERE id = ?').run(id);
  }
};

// AI Security Incidents Helper Methods
const aiSecurity = {
  logIncident(type, userId, userName, details, severity = 'medium', actionTaken = 'blocked', evidence = '') {
    try {
      const stmt = db.prepare(`
        INSERT INTO ai_security_incidents (incident_type, user_id, user_name, details, severity, action_taken, evidence, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      return stmt.run(type, userId || null, userName || 'نەزانراو', String(details).substring(0, 1000), severity, actionTaken, evidence || '', Date.now());
    } catch (e) {
      try {
        const stmt = db.prepare(`
          INSERT INTO ai_security_incidents (incident_type, user_id, user_name, details, severity, action_taken, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        return stmt.run(type, userId || null, userName || 'نەزانراو', String(details).substring(0, 1000), severity, actionTaken, Date.now());
      } catch (e2) {
        console.error('Error logging security incident:', e2);
        return null;
      }
    }
  },
  getRecentIncidents(limit = 60) {
    try {
      const stmt = db.prepare(`
        SELECT 
          i.*,
          u.full_name as user_full_name,
          u.username,
          u.phone,
          u.role as user_role,
          u.gender as user_gender,
          u.avatar_url as user_avatar,
          u.is_banned,
          u.is_muted
        FROM ai_security_incidents i
        LEFT JOIN users u ON i.user_id = u.id
        ORDER BY i.created_at DESC LIMIT ?
      `);
      return stmt.all(limit);
    } catch (e) {
      try {
        return db.prepare(`SELECT * FROM ai_security_incidents ORDER BY created_at DESC LIMIT ?`).all(limit);
      } catch (err) {
        return [];
      }
    }
  },
  deleteIncident(id) {
    try {
      return db.prepare(`DELETE FROM ai_security_incidents WHERE id = ?`).run(id);
    } catch (e) {
      console.error('Error deleting incident:', e);
      return null;
    }
  },
  getStats() {
    try {
      const total = db.prepare(`SELECT COUNT(*) as c FROM ai_security_incidents`).get().c || 0;
      const badWords = db.prepare(`SELECT COUNT(*) as c FROM ai_security_incidents WHERE incident_type = 'bad_word'`).get().c || 0;
      const nsfw = db.prepare(`SELECT COUNT(*) as c FROM ai_security_incidents WHERE incident_type = 'nsfw_image'`).get().c || 0;
      const flood = db.prepare(`SELECT COUNT(*) as c FROM ai_security_incidents WHERE incident_type IN ('flood_attack', 'flood_raid')`).get().c || 0;
      const links = db.prepare(`SELECT COUNT(*) as c FROM ai_security_incidents WHERE incident_type = 'malicious_link'`).get().c || 0;
      const impersonation = db.prepare(`SELECT COUNT(*) as c FROM ai_security_incidents WHERE incident_type = 'impersonation'`).get().c || 0;
      const starFraud = db.prepare(`SELECT COUNT(*) as c FROM ai_security_incidents WHERE incident_type = 'star_fraud'`).get().c || 0;
      const harassment = db.prepare(`SELECT COUNT(*) as c FROM ai_security_incidents WHERE incident_type = 'harassment'`).get().c || 0;

      const dynamicSafetyRating = total === 0 ? '100%' : `${Math.max(94.5, 100 - (total * 0.15)).toFixed(1)}%`;

      return {
        totalBlocked: total,
        total_incidents: total,
        badWords,
        bad_words: badWords,
        nsfw,
        nsfw_images: nsfw,
        flood,
        flood_raids: flood,
        links,
        malicious_links: links,
        impersonation,
        impersonations: impersonation,
        starFraud,
        star_frauds: starFraud,
        harassment,
        harassments: harassment,
        safetyRating: dynamicSafetyRating
      };
    } catch (e) {
      return { totalBlocked: 0, total_incidents: 0, badWords: 0, bad_words: 0, nsfw: 0, nsfw_images: 0, flood: 0, flood_raids: 0, links: 0, malicious_links: 0, impersonation: 0, starFraud: 0, star_frauds: 0, harassment: 0, harassments: 0, safetyRating: '100%' };
    }
  },
  clearOld(days = 30) {
    try {
      const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
      db.prepare(`DELETE FROM ai_security_incidents WHERE created_at < ?`).run(cutoff);
    } catch (e) {}
  },
  clearAll() {
    try {
      db.prepare(`DELETE FROM ai_security_incidents`).run();
      return true;
    } catch (e) {
      console.error('Error clearing security incidents:', e);
      return false;
    }
  }
};

const advisorDb = {
  getRecentChats(limit = 50) {
    try {
      const rows = db.prepare('SELECT * FROM ai_advisor_chats ORDER BY id DESC LIMIT ?').all(limit);
      return rows.reverse();
    } catch (e) {
      return [];
    }
  },
  saveChat(userId, sender, message) {
    try {
      return db.prepare('INSERT INTO ai_advisor_chats (user_id, sender, message, created_at) VALUES (?, ?, ?, ?)').run(userId, sender, message, Date.now());
    } catch (e) {
      return null;
    }
  },
  clearHistory() {
    try {
      return db.prepare('DELETE FROM ai_advisor_chats').run();
    } catch (e) {
      return null;
    }
  },
  logLiveAudit({ userId, userName, username, action, title = null, startedByName = null, durationSeconds = 0 }) {
    try {
      const stmt = db.prepare(`
        INSERT INTO live_audit_logs (user_id, user_name, username, action, title, started_by_name, duration_seconds, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      return stmt.run(userId, userName, username, action, title, startedByName, durationSeconds, Date.now());
    } catch (e) {
      console.error('Error logging live audit:', e);
      return null;
    }
  },
  getLiveAuditLogs(limit = 30) {
    try {
      return db.prepare('SELECT * FROM live_audit_logs ORDER BY id DESC LIMIT ?').all(limit);
    } catch (e) {
      console.error('Error getting live audit logs:', e);
      return [];
    }
  }
};

// Interactive Chat Button Clicks (@دوگمە)
const buttonClicks = {
  recordClick(messageId, userId) {
    try {
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO message_button_clicks (message_id, user_id, clicked_at)
        VALUES (?, ?, ?)
      `);
      const res = stmt.run(messageId, userId, Date.now());
      return res.changes > 0;
    } catch (e) {
      return false;
    }
  },
  hasUserClicked(messageId, userId) {
    try {
      const row = db.prepare('SELECT id FROM message_button_clicks WHERE message_id = ? AND user_id = ?').get(messageId, userId);
      return Boolean(row);
    } catch (e) {
      return false;
    }
  },
  getClicksCount(messageId) {
    try {
      const row = db.prepare('SELECT COUNT(*) as count FROM message_button_clicks WHERE message_id = ?').get(messageId);
      return row ? row.count : 0;
    } catch (e) {
      return 0;
    }
  },
  getClicksForMessages(messageIds, userId = null) {
    if (!messageIds || messageIds.length === 0) return { counts: {}, userClicked: {} };
    try {
      const placeholders = messageIds.map(() => '?').join(',');
      const rows = db.prepare(`SELECT message_id, user_id FROM message_button_clicks WHERE message_id IN (${placeholders})`).all(...messageIds);
      const counts = {};
      const userClicked = {};
      rows.forEach(r => {
        counts[r.message_id] = (counts[r.message_id] || 0) + 1;
        if (userId && r.user_id === userId) {
          userClicked[r.message_id] = true;
        }
      });
      return { counts, userClicked };
    } catch (e) {
      return { counts: {}, userClicked: {} };
    }
  },
  getAttendanceReport(messageId = null) {
    try {
      let targetMsgId = messageId;
      if (!targetMsgId) {
        const latestMsg = db.prepare(`
          SELECT id, content, created_at, user_id, full_name 
          FROM messages 
          WHERE attachment_type = 'action_button' AND COALESCE(is_deleted, 0) = 0
          ORDER BY id DESC LIMIT 1
        `).get();
        if (!latestMsg) return null;
        targetMsgId = latestMsg.id;
      }

      const msg = db.prepare('SELECT id, content, created_at, user_id, full_name FROM messages WHERE id = ?').get(targetMsgId);
      if (!msg) return null;

      // Clicked users
      const clickedUsers = db.prepare(`
        SELECT u.id, u.full_name, u.username, u.role, u.gender, u.special_badge, u.avatar_url, c.clicked_at
        FROM message_button_clicks c
        JOIN users u ON c.user_id = u.id
        WHERE c.message_id = ?
        ORDER BY c.clicked_at ASC
      `).all(targetMsgId);

      // Unclicked users: all active approved members who have not clicked (excluding message sender and super_admin Hemn)
      const unclickedUsers = db.prepare(`
        SELECT u.id, u.full_name, u.username, u.role, u.gender, u.special_badge, u.avatar_url
        FROM users u
        WHERE u.status = 'approved' AND u.is_blocked = 0 
          AND u.id != ?
          AND u.role != 'super_admin'
          AND u.id NOT IN (SELECT user_id FROM message_button_clicks WHERE message_id = ?)
        ORDER BY (CASE WHEN u.role = 'student' OR u.role = 'new_student' THEN 0 ELSE 1 END), u.full_name ASC
      `).all(msg.user_id, targetMsgId);

      return {
        message: msg,
        clicked_count: clickedUsers.length,
        unclicked_count: unclickedUsers.length,
        clicked_users: clickedUsers,
        unclicked_users: unclickedUsers
      };
    } catch (e) {
      console.error('Error getting button attendance report:', e);
      return null;
    }
  }
};

const customGroups = {
  createGroup(name, creatorId, creatorName, initialMemberIds = []) {
    const now = Date.now();
    const stmt = db.prepare('INSERT INTO custom_group_chats (name, created_by_id, created_by_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
    const res = stmt.run(name.trim(), creatorId, creatorName, now, now);
    const groupId = res.lastInsertRowid;

    // Always add creator
    const addMemberStmt = db.prepare('INSERT OR IGNORE INTO custom_group_members (group_id, user_id, added_at, last_read_at) VALUES (?, ?, ?, ?)');
    addMemberStmt.run(groupId, creatorId, now, now);

    // Add selected initial members
    if (Array.isArray(initialMemberIds)) {
      for (const uId of initialMemberIds) {
        if (Number(uId) && Number(uId) !== Number(creatorId)) {
          addMemberStmt.run(groupId, Number(uId), now, 0);
        }
      }
    }
    return this.getGroupById(groupId);
  },

  getGroupById(groupId) {
    const row = db.prepare('SELECT * FROM custom_group_chats WHERE id = ?').get(groupId);
    if (!row) return null;
    return {
      ...row,
      members: this.getGroupMembers(groupId)
    };
  },

  updateGroupName(groupId, newName) {
    db.prepare('UPDATE custom_group_chats SET name = ?, updated_at = ? WHERE id = ?').run(newName.trim(), Date.now(), groupId);
    return this.getGroupById(groupId);
  },

  deleteGroup(groupId) {
    db.prepare('DELETE FROM custom_group_messages WHERE group_id = ?').run(groupId);
    db.prepare('DELETE FROM custom_group_members WHERE group_id = ?').run(groupId);
    return db.prepare('DELETE FROM custom_group_chats WHERE id = ?').run(groupId);
  },

  clearGroupMessages(groupId) {
    return db.prepare('DELETE FROM custom_group_messages WHERE group_id = ?').run(groupId);
  },

  addMember(groupId, userId) {
    const now = Date.now();
    db.prepare('INSERT OR IGNORE INTO custom_group_members (group_id, user_id, added_at, last_read_at) VALUES (?, ?, ?, ?)').run(groupId, Number(userId), now, 0);
    return this.getGroupMembers(groupId);
  },

  removeMember(groupId, userId) {
    db.prepare('DELETE FROM custom_group_members WHERE group_id = ? AND user_id = ?').run(groupId, Number(userId));
    return this.getGroupMembers(groupId);
  },

  getGroupMembers(groupId) {
    const rows = db.prepare(`
      SELECT u.id, u.username, u.full_name, u.role, u.special_badge, u.avatar_url, m.added_at, m.last_read_at
      FROM custom_group_members m
      JOIN users u ON m.user_id = u.id
      WHERE m.group_id = ?
      ORDER BY (CASE WHEN u.role = 'super_admin' THEN 0 WHEN u.role = 'admin' THEN 1 WHEN u.role = 'teacher' THEN 2 ELSE 3 END), u.full_name ASC
    `).all(groupId);
    return rows;
  },

  isMember(groupId, userId, isSuperAdmin = false) {
    if (isSuperAdmin) return true;
    const row = db.prepare('SELECT 1 FROM custom_group_members WHERE group_id = ? AND user_id = ?').get(groupId, userId);
    return !!row;
  },

  getUserGroups(userId, isSuperAdmin = false) {
    let rows = [];
    if (isSuperAdmin) {
      rows = db.prepare('SELECT * FROM custom_group_chats ORDER BY updated_at DESC, id DESC').all();
    } else {
      rows = db.prepare(`
        SELECT g.* 
        FROM custom_group_chats g
        JOIN custom_group_members m ON g.id = m.group_id
        WHERE m.user_id = ?
        ORDER BY g.updated_at DESC, g.id DESC
      `).all(userId);
    }

    return rows.map(g => {
      const memberCount = db.prepare('SELECT COUNT(*) as c FROM custom_group_members WHERE group_id = ?').get(g.id)?.c || 0;
      const memRow = db.prepare('SELECT last_read_at FROM custom_group_members WHERE group_id = ? AND user_id = ?').get(g.id, userId);
      const lastRead = memRow ? (memRow.last_read_at || 0) : 0;
      
      const unreadRow = db.prepare(`
        SELECT COUNT(*) as c FROM custom_group_messages 
        WHERE group_id = ? AND created_at > ? AND sender_id != ?
      `).get(g.id, lastRead, userId);
      const unreadCount = unreadRow ? unreadRow.c : 0;

      const lastMsg = db.prepare(`
        SELECT sender_name, content, type, created_at, is_advisor 
        FROM custom_group_messages 
        WHERE group_id = ? 
        ORDER BY id DESC LIMIT 1
      `).get(g.id);

      return {
        ...g,
        member_count: memberCount,
        unread_count: unreadCount,
        last_message: lastMsg || null
      };
    });
  },

  markGroupRead(groupId, userId) {
    return db.prepare('UPDATE custom_group_members SET last_read_at = ? WHERE group_id = ? AND user_id = ?').run(Date.now(), groupId, userId);
  },

  createMessage(groupId, senderId, senderName, senderRole, content, type = 'text', attachmentUrl = null, attachmentName = null, attachmentSize = 0, isAdvisor = 0) {
    const now = Date.now();
    const stmt = db.prepare(`
      INSERT INTO custom_group_messages (group_id, sender_id, sender_name, sender_role, content, type, attachment_url, attachment_name, attachment_size, is_advisor, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const res = stmt.run(groupId, senderId, senderName, senderRole, content, type, attachmentUrl, attachmentName, attachmentSize || 0, isAdvisor || 0, now);
    db.prepare('UPDATE custom_group_chats SET updated_at = ? WHERE id = ?').run(now, groupId);
    return this.getMessageById(res.lastInsertRowid);
  },

  getMessageById(messageId) {
    return db.prepare('SELECT * FROM custom_group_messages WHERE id = ?').get(messageId);
  },

  getMessages(groupId, limit = 100) {
    return db.prepare('SELECT * FROM custom_group_messages WHERE group_id = ? ORDER BY id ASC LIMIT ?').all(groupId, limit);
  },

  deleteMessage(messageId, requesterId, isSuperAdmin = false) {
    const msg = this.getMessageById(messageId);
    if (!msg) return null;
    if (!isSuperAdmin && Number(msg.sender_id) !== Number(requesterId)) {
      return { forbidden: true };
    }
    db.prepare('DELETE FROM custom_group_messages WHERE id = ?').run(messageId);
    return { success: true, deletedMessage: msg };
  }
};

const pollsDb = {
  createPoll({ chatType, groupId, creatorId, creatorName, creatorRole, question, options }) {
    const now = Date.now();
    const optsJson = JSON.stringify(options);
    const stmt = db.prepare(`
      INSERT INTO polls (chat_type, group_id, creator_id, creator_name, creator_role, question, options, is_closed, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
    `);
    const res = stmt.run(chatType, groupId || null, creatorId, creatorName, creatorRole, question.trim(), optsJson, now);
    return this.getPollById(res.lastInsertRowid, creatorId);
  },

  getPollById(pollId, currentUserId = null) {
    const poll = db.prepare('SELECT * FROM polls WHERE id = ?').get(pollId);
    if (!poll) return null;
    let options = [];
    try { options = JSON.parse(poll.options); } catch (e) { options = []; }

    const votes = db.prepare('SELECT option_index, user_id, user_name FROM poll_votes WHERE poll_id = ?').all(pollId);
    const totalVotes = votes.length;

    let myVote = null;
    if (currentUserId) {
      const v = votes.find(v => Number(v.user_id) === Number(currentUserId));
      if (v) myVote = v.option_index;
    }

    const optionsWithStats = options.map((optText, idx) => {
      const optVotes = votes.filter(v => v.option_index === idx);
      const count = optVotes.length;
      const percentage = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
      return {
        index: idx,
        text: optText,
        count,
        percentage,
        voters: optVotes.map(v => v.user_name)
      };
    });

    return {
      ...poll,
      options: optionsWithStats,
      total_votes: totalVotes,
      my_vote: myVote
    };
  },

  vote(pollId, userId, userName, optionIndex) {
    const poll = db.prepare('SELECT * FROM polls WHERE id = ?').get(pollId);
    if (!poll || poll.is_closed) return { error: 'ڕاپرسی داخراوە یان بوونی نییە' };

    let options = [];
    try { options = JSON.parse(poll.options); } catch (e) {}
    if (optionIndex < 0 || optionIndex >= options.length) {
      return { error: 'بژاردەی هەڵە دیاریکراوە' };
    }

    const now = Date.now();
    db.prepare(`
      INSERT INTO poll_votes (poll_id, user_id, user_name, option_index, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(poll_id, user_id) DO UPDATE SET option_index = excluded.option_index, created_at = excluded.created_at
    `).run(pollId, userId, userName, optionIndex, now);

    return { success: true, poll: this.getPollById(pollId, userId) };
  },

  closePoll(pollId) {
    db.prepare('UPDATE polls SET is_closed = 1 WHERE id = ?').run(pollId);
    return this.getPollById(pollId);
  },

  togglePollStatus(pollId, forcedClosed = null) {
    const poll = db.prepare('SELECT is_closed FROM polls WHERE id = ?').get(pollId);
    if (!poll) return null;
    const newStatus = forcedClosed !== null ? (forcedClosed ? 1 : 0) : (poll.is_closed ? 0 : 1);
    db.prepare('UPDATE polls SET is_closed = ? WHERE id = ?').run(newStatus, pollId);
    return this.getPollById(pollId);
  },

  updatePoll(pollId, { question, options }) {
    const optsJson = JSON.stringify(options);
    db.prepare('UPDATE polls SET question = ?, options = ? WHERE id = ?').run(question.trim(), optsJson, pollId);
    return this.getPollById(pollId);
  },

  deletePoll(pollId) {
    db.prepare('DELETE FROM poll_votes WHERE poll_id = ?').run(pollId);
    return db.prepare('DELETE FROM polls WHERE id = ?').run(pollId);
  }
};

const alarmsDb = {
  createAlarm({ chatType, groupId, creatorId, creatorName, creatorRole, title, targetTime }) {
    const now = Date.now();
    const stmt = db.prepare(`
      INSERT INTO event_alarms (chat_type, group_id, creator_id, creator_name, creator_role, title, target_time, is_triggered, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
    `);
    const res = stmt.run(chatType, groupId || null, creatorId, creatorName, creatorRole, title.trim(), targetTime, now);
    return this.getAlarmById(res.lastInsertRowid);
  },

  getAlarmById(alarmId) {
    return db.prepare('SELECT * FROM event_alarms WHERE id = ?').get(alarmId);
  },

  getActiveAlarms() {
    return db.prepare('SELECT * FROM event_alarms WHERE is_triggered = 0 ORDER BY target_time ASC').all();
  },

  markTriggered(alarmId) {
    return db.prepare('UPDATE event_alarms SET is_triggered = 1 WHERE id = ?').run(alarmId);
  },

  updateAlarm(alarmId, { title, targetTime }) {
    db.prepare('UPDATE event_alarms SET title = ?, target_time = ? WHERE id = ?').run(title.trim(), targetTime, alarmId);
    return this.getAlarmById(alarmId);
  },

  deleteAlarm(alarmId) {
    return db.prepare('DELETE FROM event_alarms WHERE id = ?').run(alarmId);
  }
};

// Attendance & Absence Helper (@هاتن / @غیابات)
const attendanceDb = {
  createSession(creatorId, creatorName, creatorRole, title = 'تۆماری ئامادەبوون و غیابات', messageId = null) {
    const stmt = db.prepare(`
      INSERT INTO attendance_sessions (message_id, creator_id, creator_name, creator_role, title, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?)
    `);
    const now = Date.now();
    const res = stmt.run(messageId, creatorId, creatorName, creatorRole, title, now);
    return this.getSession(res.lastInsertRowid);
  },

  updateMessageId(sessionId, messageId) {
    db.prepare('UPDATE attendance_sessions SET message_id = ? WHERE id = ?').run(messageId, sessionId);
  },

  getSession(id) {
    return db.prepare('SELECT * FROM attendance_sessions WHERE id = ?').get(id);
  },

  getActiveSession() {
    return db.prepare("SELECT * FROM attendance_sessions WHERE status = 'active' ORDER BY created_at DESC LIMIT 1").get();
  },

  closeSession(id) {
    const now = Date.now();
    db.prepare("UPDATE attendance_sessions SET status = 'closed', closed_at = ? WHERE id = ?").run(now, id);

    // Automatically record all active students who didn't respond as 'absent'
    try {
      const studentUsers = db.prepare("SELECT id, full_name, role FROM users WHERE role IN ('student', 'new_student') AND status = 'approved' AND is_blocked = 0").all();
      const existingRecords = db.prepare('SELECT user_id FROM attendance_records WHERE session_id = ?').all(id);
      const existingUserIds = new Set(existingRecords.map(r => r.user_id));

      const insertAbsentStmt = db.prepare(`
        INSERT INTO attendance_records (session_id, user_id, user_name, user_role, status, excuse_reason, recorded_at)
        VALUES (?, ?, ?, ?, 'absent', '', ?)
      `);

      for (const stu of studentUsers) {
        if (!existingUserIds.has(stu.id)) {
          insertAbsentStmt.run(id, stu.id, stu.full_name, stu.role || 'student', now);
        }
      }
    } catch (e) {
      console.error('Error auto-marking absent students:', e);
    }

    return this.getSession(id);
  },

  markAttendance(sessionId, userId, userName, userRole) {
    const session = this.getSession(sessionId);
    if (!session || session.status !== 'active') return { error: 'ئەم دانیشتنەی ئامادەبوون داخراوە' };

    const existing = db.prepare('SELECT * FROM attendance_records WHERE session_id = ? AND user_id = ?').get(sessionId, userId);
    if (existing) {
      if (existing.status === 'attended') {
        return { success: true, already: true, record: existing };
      }
      db.prepare("UPDATE attendance_records SET status = 'attended', recorded_at = ? WHERE id = ?").run(Date.now(), existing.id);
      return { success: true, updated: true, record: this.getRecord(existing.id) };
    }

    const stmt = db.prepare(`
      INSERT INTO attendance_records (session_id, user_id, user_name, user_role, status, recorded_at)
      VALUES (?, ?, ?, ?, 'attended', ?)
    `);
    const now = Date.now();
    const res = stmt.run(sessionId, userId, userName, userRole || 'student', now);
    return { success: true, record: this.getRecord(res.lastInsertRowid) };
  },

  requestLeave(sessionId, userId, userName, userRole, excuseReason) {
    const session = this.getSession(sessionId);
    if (!session || session.status !== 'active') return { error: 'ئەم دانیشتنەی ئامادەبوون داخراوە' };
    if (!excuseReason || !excuseReason.trim()) return { error: 'پێویستە هۆکاری داواکردنی مۆڵەت بنووسیت' };

    const existing = db.prepare('SELECT * FROM attendance_records WHERE session_id = ? AND user_id = ?').get(sessionId, userId);
    const now = Date.now();
    if (existing) {
      db.prepare("UPDATE attendance_records SET status = 'leave_pending', excuse_reason = ?, recorded_at = ? WHERE id = ?").run(excuseReason.trim(), now, existing.id);
      return { success: true, record: this.getRecord(existing.id) };
    }

    const stmt = db.prepare(`
      INSERT INTO attendance_records (session_id, user_id, user_name, user_role, status, excuse_reason, recorded_at)
      VALUES (?, ?, ?, ?, 'leave_pending', ?, ?)
    `);
    const res = stmt.run(sessionId, userId, userName, userRole || 'student', excuseReason.trim(), now);
    return { success: true, record: this.getRecord(res.lastInsertRowid) };
  },

  reviewLeave(sessionId, userId, newStatus, reviewerId, reviewerName) {
    const record = db.prepare('SELECT * FROM attendance_records WHERE session_id = ? AND user_id = ?').get(sessionId, userId);
    if (!record) return { error: 'داواکاری مۆڵەت نەدۆزرایەوە' };
    db.prepare(`
      UPDATE attendance_records 
      SET status = ?, reviewed_by_id = ?, reviewed_by_name = ?, recorded_at = ?
      WHERE id = ?
    `).run(newStatus, reviewerId, reviewerName, Date.now(), record.id);
    return { success: true, record: this.getRecord(record.id) };
  },

  getRecord(id) {
    return db.prepare('SELECT * FROM attendance_records WHERE id = ?').get(id);
  },

  getSessionRecords(sessionId) {
    return db.prepare('SELECT * FROM attendance_records WHERE session_id = ? ORDER BY recorded_at ASC').all(sessionId);
  },

  getSessionSummary(sessionId) {
    const session = this.getSession(sessionId);
    if (!session) return null;
    const records = this.getSessionRecords(sessionId);

    const allStudents = db.prepare("SELECT id, full_name, role FROM users WHERE role IN ('student', 'new_student') AND status = 'approved' AND is_blocked = 0").all();
    const recordedMap = new Map();
    records.forEach(r => recordedMap.set(r.user_id, r));

    const attended = records.filter(r => r.status === 'attended');
    const excused = records.filter(r => r.status === 'excused');
    const leavePending = records.filter(r => r.status === 'leave_pending');
    const explicitAbsent = records.filter(r => r.status === 'absent');

    const unresponded = session.status === 'active' 
      ? allStudents.filter(s => !recordedMap.has(s.id)).map(s => ({
          user_id: s.id,
          user_name: s.full_name,
          user_role: s.role,
          status: 'unresponded'
        }))
      : [];

    // While session is active, unresponded students are NOT marked as absent yet; they are waiting/pending.
    // Only explicit absent records (or all unresponded once closed) count as absent.
    const absentList = session.status === 'closed' ? explicitAbsent : explicitAbsent;
    const isActive = session.status === 'active';

    return {
      session: {
        ...session,
        is_active: isActive
      },
      creator_name: session.creator_name,
      is_active: isActive,
      present_count: attended.length,
      excused_count: excused.length,
      absent_count: absentList.length,
      unresponded_count: unresponded.length,
      pending_leaves: leavePending,
      attended,
      excused,
      leavePending,
      absent: absentList,
      unresponded,
      stats: {
        total_students: allStudents.length,
        attended_count: attended.length,
        excused_count: excused.length,
        leave_pending_count: leavePending.length,
        absent_count: absentList.length,
        unresponded_count: unresponded.length
      }
    };
  },

  getAllSessionsWithStats() {
    const sessions = db.prepare('SELECT * FROM attendance_sessions ORDER BY created_at DESC').all();
    const kurdishDays = ['یەکشەممە', 'دووشەممە', 'سێشەممە', 'چوارشەممە', 'پێنجشەممە', 'هەینی', 'شەممە'];
    const allStudents = db.prepare("SELECT id, full_name, role FROM users WHERE role IN ('student', 'new_student') AND status = 'approved' AND is_blocked = 0").all();

    return sessions.map(s => {
      const records = db.prepare('SELECT * FROM attendance_records WHERE session_id = ? ORDER BY recorded_at ASC').all(s.id);
      const recordedMap = new Map();
      records.forEach(r => recordedMap.set(r.user_id, r));

      const attended = records.filter(r => r.status === 'attended');
      const excused = records.filter(r => r.status === 'excused');
      const leavePending = records.filter(r => r.status === 'leave_pending');
      const explicitAbsent = records.filter(r => r.status === 'absent');

      const unresponded = s.status === 'active'
        ? allStudents.filter(stu => !recordedMap.has(stu.id)).map(stu => ({
            user_id: stu.id,
            full_name: stu.full_name,
            user_role: stu.role,
            status: 'unresponded'
          }))
        : [];

      const absentList = s.status === 'closed'
        ? explicitAbsent.map(r => ({ user_id: r.user_id, full_name: r.user_name }))
        : explicitAbsent.map(r => ({ user_id: r.user_id, full_name: r.user_name }));

      const d = new Date(s.created_at);
      const dayName = kurdishDays[d.getDay()] || '';
      const dateStr = d.toLocaleDateString('ku-IQ') || `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}`;
      const isAct = s.status === 'active';

      return {
        ...s,
        is_active: isAct,
        day_name: dayName,
        date_str: dateStr,
        present_count: attended.length,
        excused_count: excused.length,
        absent_count: absentList.length,
        unresponded_count: unresponded.length,
        present_list: attended.map(r => ({ user_id: r.user_id, full_name: r.user_name })),
        excused_list: excused.map(r => ({ user_id: r.user_id, full_name: r.user_name, leave_reason: r.excuse_reason })),
        absent_list: absentList,
        unresponded_list: unresponded,
        stats: {
          attended: attended.length,
          excused: excused.length,
          leave_pending: leavePending.length,
          absent: absentList.length,
          unresponded: unresponded.length
        }
      };
    });
  },

  deleteSession(sessionId) {
    db.prepare('DELETE FROM attendance_records WHERE session_id = ?').run(sessionId);
    return db.prepare('DELETE FROM attendance_sessions WHERE id = ?').run(sessionId);
  },

  getStudentAttendanceHistory(userId) {
    return db.prepare(`
      SELECT r.*, s.title as session_title, s.created_at as session_date, s.creator_name
      FROM attendance_records r
      JOIN attendance_sessions s ON r.session_id = s.id
      WHERE r.user_id = ?
      ORDER BY s.created_at DESC
    `).all(userId);
  }
};

// Complaints Box Helper (سندووقی سکاڵا)
const complaints = {
  create(userId, username, fullName, role, subject, content) {
    const stmt = db.prepare(`
      INSERT INTO complaints (user_id, username, full_name, role, subject, content, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
    `);
    const res = stmt.run(userId, username, fullName, role, (subject || '').trim(), content.trim(), Date.now());
    return this.findById(res.lastInsertRowid);
  },
  findById(id) {
    return db.prepare('SELECT * FROM complaints WHERE id = ?').get(id);
  },
  getAll() {
    return db.prepare('SELECT * FROM complaints ORDER BY created_at DESC').all();
  },
  getForUser(userId) {
    return db.prepare('SELECT * FROM complaints WHERE user_id = ? ORDER BY created_at DESC').all(userId);
  },
  updateStatus(id, status) {
    db.prepare('UPDATE complaints SET status = ? WHERE id = ?').run(status, id);
    return this.findById(id);
  },
  delete(id) {
    return db.prepare('DELETE FROM complaints WHERE id = ?').run(id);
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
  calculateStars,
  liveRecordings,
  recordedLessons,
  getDreamTeacherAlias,
  aiSecurity,
  advisorDb,
  buttonClicks,
  customGroups,
  pollsDb,
  alarmsDb,
  complaints,
  attendanceDb
};
