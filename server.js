// server.js
// Simple Node/Express backend for Anime Forever
// - Auth: register/login with bcrypt + JWT
// - Upload: multer stores files in /uploads and returns /uploads/<file>
// - Series & episodes stored in /data/series.json (simple, file-based)
// - Admin checks via process.env.ADMIN_USERNAME or default "AnimeForever-admin"
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SERIES_FILE = path.join(DATA_DIR, 'series.json');

const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

const JWT_SECRET = process.env.JWT_SECRET || 'change_me_very_secret';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'AnimeForever-admin';

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8') || 'null') || fallback;
  } catch (e) {
    return fallback;
  }
}
function writeJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
}
if (!fs.existsSync(USERS_FILE)) writeJson(USERS_FILE, []);
if (!fs.existsSync(SERIES_FILE)) writeJson(SERIES_FILE, []);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    const name = Date.now() + '-' + Math.round(Math.random()*1e9) + ext;
    cb(null, name);
  }
});
const upload = multer({ storage, limits: { fileSize: 2_000_000_000 } }); // limit ~2GB (adjust)

const app = express();
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(UPLOAD_DIR));
app.use('/', express.static(path.join(__dirname, 'public')));

// Helpers
function generateToken(user) {
  return jwt.sign({ username: user.username }, JWT_SECRET, { expiresIn: '7d' });
}
function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'No token' });
  const parts = auth.split(' ');
  if (parts.length !== 2) return res.status(401).json({ error: 'Bad token' });
  const token = parts[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}
function isAdmin(req) {
  return req.user && req.user.username === ADMIN_USERNAME;
}

// Auth endpoints
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
  const users = readJson(USERS_FILE, []);
  if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
    return res.status(400).json({ error: 'User exists' });
  }
  const hash = await bcrypt.hash(password, 10);
  users.push({ username, passwordHash: hash });
  writeJson(USERS_FILE, users);
  const token = generateToken({ username });
  res.json({ token, username });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
  const users = readJson(USERS_FILE, []);
  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user) return res.status(400).json({ error: 'Invalid credentials' });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(400).json({ error: 'Invalid credentials' });
  const token = generateToken({ username: user.username });
  res.json({ token, username: user.username });
});

app.get('/api/me', authMiddleware, (req, res) => {
  res.json({ username: req.user.username, isAdmin: req.user.username === ADMIN_USERNAME });
});

// Upload endpoint
app.post('/api/upload', authMiddleware, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  // Return public URL relative to server (frontend can prepend origin)
  const url = `/uploads/${req.file.filename}`;
  res.json({ url });
});

// Series endpoints (file-based persistence)
app.get('/api/series', (req, res) => {
  const series = readJson(SERIES_FILE, []);
  res.json(series);
});

app.post('/api/series', authMiddleware, (req, res) => {
  const { name, desc, image } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Missing series name' });
  const series = readJson(SERIES_FILE, []);
  const exists = series.find(s => s.name.toLowerCase() === name.toLowerCase());
  if (exists) return res.status(400).json({ error: 'Series already exists' });
  const newSeries = {
    id: Date.now() + '-' + Math.round(Math.random()*1e9),
    name,
    desc: desc || '',
    image: image || '',
    pseudo: req.user.username,
    episodes: []
  };
  series.push(newSeries);
  writeJson(SERIES_FILE, series);
  res.json(newSeries);
});

// Add episode (JSON or multipart form)
// - JSON: { title, type, src, pseudo }
// - multipart/form-data: file field 'file', title, pseudo
app.post('/api/series/:id/episodes', authMiddleware, upload.single('file'), (req, res) => {
  const { id } = req.params;
  const series = readJson(SERIES_FILE, []);
  const s = series.find(x => x.id === id);
  if (!s) return res.status(404).json({ error: 'Series not found' });

  if (req.file) {
    // file uploaded
    const url = `/uploads/${req.file.filename}`;
    const title = req.body.title || `Épisode ${s.episodes.length+1}`;
    s.episodes.push({ id: Date.now()+'-'+Math.round(Math.random()*1e9), title, type: 'url', src: url, pseudo: req.user.username, fileName: req.file.originalname });
    writeJson(SERIES_FILE, series);
    return res.json({ success: true, series: s });
  } else {
    // JSON body expected
    const { title, type, src } = req.body || {};
    if (!src) return res.status(400).json({ error: 'Missing src' });
    s.episodes.push({ id: Date.now()+'-'+Math.round(Math.random()*1e9), title: title || `Épisode ${s.episodes.length+1}`, type: type || 'url', src, pseudo: req.user.username });
    writeJson(SERIES_FILE, series);
    return res.json({ success: true, series: s });
  }
});

// Update series image
app.put('/api/series/:id/image', authMiddleware, (req, res) => {
  const { id } = req.params;
  const { image } = req.body || {};
  const series = readJson(SERIES_FILE, []);
  const s = series.find(x => x.id === id);
  if (!s) return res.status(404).json({ error: 'Series not found' });
  s.image = image || '';
  writeJson(SERIES_FILE, series);
  res.json({ success: true, series: s });
});

// Delete episode (admin only)
app.delete('/api/series/:id/episodes/:epId', authMiddleware, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  const { id, epId } = req.params;
  const series = readJson(SERIES_FILE, []);
  const s = series.find(x => x.id === id);
  if (!s) return res.status(404).json({ error: 'Series not found' });
  const idx = s.episodes.findIndex(e => e.id === epId);
  if (idx === -1) return res.status(404).json({ error: 'Episode not found' });
  s.episodes.splice(idx, 1);
  writeJson(SERIES_FILE, series);
  res.json({ success: true });
});

// Delete series (admin only)
app.delete('/api/series/:id', authMiddleware, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  const { id } = req.params;
  const series = readJson(SERIES_FILE, []);
  const idx = series.findIndex(x => x.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Series not found' });
  series.splice(idx, 1);
  writeJson(SERIES_FILE, series);
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}, admin: ${ADMIN_USERNAME}`);
});