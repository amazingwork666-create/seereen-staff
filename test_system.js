const { initDb, users, messages, questions, calculateStars } = require('./db');
const bcrypt = require('bcryptjs');

async function runTests() {
  console.log('🧪 Starting System Verification Tests...\n');

  // Test 1: DB Initialization & Super Admin Seeding
  initDb();
  const superAdmin = users.findByUsername('admin');
  if (!superAdmin || superAdmin.role !== 'super_admin' || superAdmin.status !== 'approved') {
    throw new Error('❌ Test 1 Failed: Super Admin not properly seeded');
  }
  console.log('✅ Test 1 Passed: Super Admin seeded successfully with role "super_admin"');

  // Test 2: Star & Level Calculation Algorithm
  console.log('\n--- Testing Star Progression (10 questions = 2 stars, sub-count restarts from 1) ---');
  const testCases = [
    { count: 0, expectedStars: 1, expectedPoints: 0 },
    { count: 1, expectedStars: 1, expectedPoints: 1 },
    { count: 5, expectedStars: 1, expectedPoints: 5 },
    { count: 9, expectedStars: 1, expectedPoints: 9 },
    { count: 10, expectedStars: 2, expectedPoints: 0 },
    { count: 11, expectedStars: 2, expectedPoints: 1 },
    { count: 19, expectedStars: 2, expectedPoints: 9 },
    { count: 20, expectedStars: 3, expectedPoints: 0 },
    { count: 21, expectedStars: 3, expectedPoints: 1 }
  ];

  for (const tc of testCases) {
    const starRes = calculateStars(tc.count);
    if (starRes.stars !== tc.expectedStars || starRes.points !== tc.expectedPoints) {
      throw new Error(`❌ Star calculation error for count=${tc.count}: expected stars=${tc.expectedStars}, points=${tc.expectedPoints}, got stars=${starRes.stars}, points=${starRes.points}`);
    }
    console.log(`   Count ${tc.count} => ${starRes.starIcons} Level ${starRes.stars} (Points: ${starRes.points}/10)`);
  }
  console.log('✅ Test 2 Passed: Star progression calculation matches user specifications accurately');

  // Test 3: User Registration Flow & Pending State
  const hash = bcrypt.hashSync('pass123', 10);
  const testStudentUsername = 'test_student_' + Date.now();
  const studentId = users.create(testStudentUsername, hash, 'قوتابی تاقیکاری', 'student', 'pending');
  const registeredStudent = users.findById(studentId);

  if (registeredStudent.status !== 'pending' || registeredStudent.role !== 'student') {
    throw new Error('❌ Test 3 Failed: Registered student not in pending state');
  }
  console.log('✅ Test 3 Passed: Student registered with status="pending" and role="student"');

  // Test 4: Super Admin Approval
  const pendingBefore = users.getPendingUsers();
  const isFoundInPending = pendingBefore.some(u => u.id === studentId);
  if (!isFoundInPending) {
    throw new Error('❌ Test 4 Failed: Student not found in pending list');
  }

  users.updateStatus(studentId, 'approved');
  const approvedStudent = users.findById(studentId);
  if (approvedStudent.status !== 'approved') {
    throw new Error('❌ Test 4 Failed: Student approval failed');
  }
  console.log('✅ Test 4 Passed: Super Admin can approve pending registrations');

  // Test 5: Role Promotion (Student -> Admin)
  users.updateRole(studentId, 'admin');
  const promotedUser = users.findById(studentId);
  if (promotedUser.role !== 'admin') {
    throw new Error('❌ Test 5 Failed: Role promotion to admin failed');
  }
  console.log('✅ Test 5 Passed: Super Admin promoted user to "admin"');

  // Test 6: Question Creation
  const newQuestion = questions.create(promotedUser.id, promotedUser.full_name, 'پایتەختی کوردستان کوێیە؟', 'هەولێر');
  if (!newQuestion || newQuestion.is_active !== 1 || newQuestion.correct_answer !== 'هەولێر') {
    throw new Error('❌ Test 6 Failed: Question creation failed');
  }
  console.log('✅ Test 6 Passed: Admin created active educational question with answer key');

  // Test 7: Answering Question & Awarding Star
  const anotherStudentUsername = 'student_winner_' + Date.now();
  const winnerId = users.create(anotherStudentUsername, hash, 'شنۆ عەلی', 'student', 'approved');
  
  const updatedCount = users.incrementCorrectAnswers(winnerId);
  questions.closeQuestion(newQuestion.id, winnerId, 'شنۆ عەلی');
  questions.recordStarAward(newQuestion.id, winnerId, promotedUser.id);

  const winner = users.findById(winnerId);
  if (winner.correct_answers_count !== 1) {
    throw new Error('❌ Test 7 Failed: Star award increment failed');
  }
  const closedQ = questions.findById(newQuestion.id);
  if (closedQ.is_active !== 0 || closedQ.winner_id !== winnerId) {
    throw new Error('❌ Test 7 Failed: Question was not closed properly upon star award');
  }
  console.log('✅ Test 7 Passed: Star awarded to student, question closed, winner recorded');

  // Test 8: Muting Student for 24 Hours
  const muteDurationMs = 24 * 60 * 60 * 1000;
  const mutedUntil = Date.now() + muteDurationMs;
  users.setMute(winnerId, mutedUntil);
  const mutedStudent = users.findById(winnerId);
  if (mutedStudent.muted_until <= Date.now()) {
    throw new Error('❌ Test 8 Failed: Mute timestamp not set properly');
  }
  const remainingHours = Math.round((mutedStudent.muted_until - Date.now()) / (3600 * 1000));
  if (remainingHours !== 24) {
    throw new Error(`❌ Test 8 Failed: Expected 24h mute, got ${remainingHours}h`);
  }
  console.log(`✅ Test 8 Passed: Student muted for 24 hours (remaining: ${remainingHours} hours)`);

  // Test 9: Super Admin Blocking User
  users.setBlocked(winnerId, 1);
  const blockedStudent = users.findById(winnerId);
  if (blockedStudent.is_blocked !== 1) {
    throw new Error('❌ Test 9 Failed: Block user failed');
  }
  console.log('✅ Test 9 Passed: Super Admin can block user');

  console.log('\n🎉 ALL 9 SYSTEM TESTS PASSED SUCCESSFULLY! 🚀');
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
