const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Storage Paths ─────────────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const ATTENDANCE_FILE = path.join(DATA_DIR, 'attendance.json');

[DATA_DIR, UPLOAD_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ─── In-memory state ────────────────────────────────────────────────────────
let sessions = loadJSON(SESSIONS_FILE, {});        // { sessionId: { name, excelPath, students: [...], createdAt } }
let attendance = loadJSON(ATTENDANCE_FILE, {});    // { sessionId: { studentId: { markedAt, device } } }
let activeSession = null;

function loadJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}
function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ─── Multer (Excel upload) ───────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.xlsx', '.xls'].includes(ext)) cb(null, true);
    else cb(new Error('Only Excel files (.xlsx, .xls) are allowed'));
  }
});

// ─── Middleware ──────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Helper: parse Excel → student list ─────────────────────────────────────
function parseExcel(filePath) {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

  // Auto-detect columns (id, name) – look for common column names
  const idKeys   = ['id', 'student_id', 'studentid', 'matric', 'reg_no', 'regno', 'roll'];
  const nameKeys = ['name', 'fullname', 'full_name', 'student_name', 'studentname'];

  if (rows.length === 0) return [];

  const headers = Object.keys(rows[0]).map(k => k.toLowerCase().trim());
  const idCol   = Object.keys(rows[0]).find(k => idKeys.includes(k.toLowerCase().trim()))   || Object.keys(rows[0])[0];
  const nameCol = Object.keys(rows[0]).find(k => nameKeys.includes(k.toLowerCase().trim())) || Object.keys(rows[0])[1] || idCol;

  return rows.map((row, i) => ({
    id:   String(row[idCol] || `STU-${i + 1}`).trim(),
    name: String(row[nameCol] || 'Unknown').trim(),
    raw:  row
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
//  DASHBOARD API ROUTES
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/sessions – list all sessions
app.get('/api/sessions', (req, res) => {
  const list = Object.entries(sessions).map(([id, s]) => ({
    id,
    name: s.name,
    studentCount: s.students.length,
    createdAt: s.createdAt,
    isActive: id === activeSession,
    attendanceCount: attendance[id] ? Object.keys(attendance[id]).length : 0
  }));
  res.json({ sessions: list.sort((a, b) => b.createdAt - a.createdAt), activeSession });
});

// POST /api/sessions/upload – upload Excel & create session
app.post('/api/sessions/upload', upload.single('excel'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const students = parseExcel(req.file.path);
    if (students.length === 0) return res.status(400).json({ error: 'No student records found in the Excel file' });

    const sessionId = uuidv4().slice(0, 8).toUpperCase();
    const sessionName = req.body.name || `Session ${new Date().toLocaleDateString()}`;

    sessions[sessionId] = {
      name: sessionName,
      excelPath: req.file.path,
      originalName: req.file.originalname,
      students,
      createdAt: Date.now()
    };
    attendance[sessionId] = {};

    saveJSON(SESSIONS_FILE, sessions);
    saveJSON(ATTENDANCE_FILE, attendance);

    res.json({ success: true, sessionId, sessionName, studentCount: students.length, students: students.slice(0, 5) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sessions/:id/activate – set active session
app.post('/api/sessions/:id/activate', (req, res) => {
  const { id } = req.params;
  if (!sessions[id]) return res.status(404).json({ error: 'Session not found' });
  activeSession = id;
  res.json({ success: true, activeSession });
});

// DELETE /api/sessions/:id – delete session
app.delete('/api/sessions/:id', (req, res) => {
  const { id } = req.params;
  if (!sessions[id]) return res.status(404).json({ error: 'Session not found' });
  if (activeSession === id) activeSession = null;
  if (sessions[id].excelPath && fs.existsSync(sessions[id].excelPath)) {
    fs.unlinkSync(sessions[id].excelPath);
  }
  delete sessions[id];
  delete attendance[id];
  saveJSON(SESSIONS_FILE, sessions);
  saveJSON(ATTENDANCE_FILE, attendance);
  res.json({ success: true });
});

// GET /api/sessions/:id/attendance – get full attendance list
app.get('/api/sessions/:id/attendance', (req, res) => {
  const { id } = req.params;
  if (!sessions[id]) return res.status(404).json({ error: 'Session not found' });

  const session = sessions[id];
  const rec = attendance[id] || {};

  const list = session.students.map(s => ({
    ...s,
    attended: !!rec[s.id],
    markedAt: rec[s.id]?.markedAt || null,
    device:   rec[s.id]?.device || null
  }));

  res.json({
    sessionId: id,
    sessionName: session.name,
    total: list.length,
    present: list.filter(s => s.attended).length,
    absent: list.filter(s => !s.attended).length,
    students: list
  });
});

// GET /api/sessions/:id/export – export attendance as Excel
app.get('/api/sessions/:id/export', (req, res) => {
  const { id } = req.params;
  if (!sessions[id]) return res.status(404).json({ error: 'Session not found' });

  const session = sessions[id];
  const rec = attendance[id] || {};

  const rows = session.students.map(s => ({
    'Student ID': s.id,
    'Name': s.name,
    'Status': rec[s.id] ? 'Present' : 'Absent',
    'Marked At': rec[s.id]?.markedAt ? new Date(rec[s.id].markedAt).toLocaleString() : '',
    'Device': rec[s.id]?.device || ''
  }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Attendance');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Disposition', `attachment; filename="${session.name}-attendance.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// POST /api/sessions/:id/reset – clear attendance for session
app.post('/api/sessions/:id/reset', (req, res) => {
  const { id } = req.params;
  if (!sessions[id]) return res.status(404).json({ error: 'Session not found' });
  attendance[id] = {};
  saveJSON(ATTENDANCE_FILE, attendance);
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════
//  ANDROID APP API ROUTES
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/app/session – get active session info (for the app to load)
app.get('/api/app/session', (req, res) => {
  if (!activeSession || !sessions[activeSession]) {
    return res.status(404).json({ error: 'No active session. Ask admin to activate a session.' });
  }
  const session = sessions[activeSession];
  const rec = attendance[activeSession] || {};
  res.json({
    sessionId: activeSession,
    sessionName: session.name,
    studentCount: session.students.length,
    presentCount: Object.keys(rec).length
  });
});

// GET /api/app/students – get all students in active session
app.get('/api/app/students', (req, res) => {
  if (!activeSession || !sessions[activeSession]) {
    return res.status(404).json({ error: 'No active session' });
  }
  const session = sessions[activeSession];
  const rec = attendance[activeSession] || {};
  const students = session.students.map(s => ({
    id: s.id,
    name: s.name,
    attended: !!rec[s.id]
  }));
  res.json({ students });
});

// POST /api/app/mark – mark a student present (DUPLICATE-SAFE)
app.post('/api/app/mark', (req, res) => {
  const { studentId, device } = req.body;

  if (!activeSession || !sessions[activeSession]) {
    return res.status(404).json({ error: 'No active session' });
  }
  if (!studentId) {
    return res.status(400).json({ error: 'studentId is required' });
  }

  const session = sessions[activeSession];
  const student = session.students.find(s => s.id === studentId);

  if (!student) {
    return res.status(404).json({ error: `Student "${studentId}" not found in this session` });
  }

  if (!attendance[activeSession]) attendance[activeSession] = {};

  // ── DUPLICATE CHECK ──
  if (attendance[activeSession][studentId]) {
    const prev = attendance[activeSession][studentId];
    return res.status(409).json({
      error: 'duplicate',
      message: `${student.name} already marked present`,
      markedAt: prev.markedAt,
      device: prev.device
    });
  }

  // ── MARK ATTENDANCE ──
  attendance[activeSession][studentId] = {
    markedAt: Date.now(),
    device: device || 'unknown'
  };
  saveJSON(ATTENDANCE_FILE, attendance);

  res.json({
    success: true,
    message: `Attendance marked for ${student.name}`,
    student: { id: student.id, name: student.name },
    markedAt: attendance[activeSession][studentId].markedAt
  });
});

// GET /api/app/check/:studentId – check if student already marked
app.get('/api/app/check/:studentId', (req, res) => {
  const { studentId } = req.params;

  if (!activeSession || !sessions[activeSession]) {
    return res.status(404).json({ error: 'No active session' });
  }

  const session = sessions[activeSession];
  const student = session.students.find(s => s.id === studentId);
  if (!student) return res.status(404).json({ error: 'Student not found' });

  const rec = attendance[activeSession]?.[studentId];
  res.json({
    studentId,
    name: student.name,
    attended: !!rec,
    markedAt: rec?.markedAt || null
  });
});

// ─── Start server ────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅ Attendance Server running at http://localhost:${PORT}`);
  console.log(`   Dashboard: http://localhost:${PORT}`);
  console.log(`   App API:   http://localhost:${PORT}/api/app/\n`);
});
