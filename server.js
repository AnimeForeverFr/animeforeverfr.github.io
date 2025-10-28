const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const SECRET = 'votre_secret_jwt_changez_moi';

// Créer les dossiers nécessaires
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configuration de multer pour l'upload de fichiers
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    // Créer un nom unique pour éviter les collisions
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'video-' + uniqueSuffix + ext);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 500 * 1024 * 1024 // Limite à 500 MB par fichier
  },
  fileFilter: (req, file, cb) => {
    // Accepter seulement les vidéos
    const allowedTypes = /mp4|mkv|avi|webm|mov/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Seuls les fichiers vidéo sont acceptés (mp4, mkv, avi, webm, mov)'));
    }
  }
});

// Middleware
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static(uploadsDir)); // Servir les fichiers uploadés

// Base de données en mémoire (remplacer par une vraie DB en production)
let users = [
  { username: 'admin', password: bcrypt.hashSync('admin', 8), isAdmin: true }
];
let series = [];
let nextSeriesId = 1;

// Middleware d'authentification
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'Token manquant' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token invalide' });
  }
}

// Middleware admin
function adminMiddleware(req, res, next) {
  if (!req.user.isAdmin) {
    return res.status(403).json({ error: 'Accès refusé - Admin uniquement' });
  }
  next();
}

// Routes d'authentification
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username et password requis' });
    }

    if (username.length < 3) {
      return res.status(400).json({ error: 'Le pseudo doit contenir au moins 3 caractères' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères' });
    }

    if (users.find(u => u.username === username)) {
      return res.status(400).json({ error: 'Ce pseudo est déjà pris' });
    }

    const hashedPassword = await bcrypt.hash(password, 8);
    const newUser = { username, password: hashedPassword, isAdmin: false };
    users.push(newUser);

    const token = jwt.sign({ username, isAdmin: false }, SECRET, { expiresIn: '7d' });
    res.json({ token, user: { username, isAdmin: false } });
  } catch (error) {
    console.error('Erreur register:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username et password requis' });
    }

    const user = users.find(u => u.username === username);
    if (!user) {
      return res.status(401).json({ error: 'Identifiants incorrects' });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Identifiants incorrects' });
    }

    const token = jwt.sign({ username: user.username, isAdmin: user.isAdmin }, SECRET, { expiresIn: '7d' });
    res.json({ token, user: { username: user.username, isAdmin: user.isAdmin } });
  } catch (error) {
    console.error('Erreur login:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/api/me', authMiddleware, (req, res) => {
  res.json({ username: req.user.username, isAdmin: req.user.isAdmin });
});

// Routes pour les séries
app.get('/api/series', (req, res) => {
  res.json(series);
});

app.get('/api/series/:id', (req, res) => {
  const s = series.find(x => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: 'Série introuvable' });
  res.json(s);
});

// Créer une série avec upload de fichiers
app.post('/api/series', authMiddleware, upload.any(), async (req, res) => {
  try {
    const { pseudo, name, desc, image, episodes } = req.body;

    if (!pseudo || !name) {
      // Nettoyer les fichiers uploadés si erreur
      if (req.files) {
        req.files.forEach(file => fs.unlinkSync(file.path));
      }
      return res.status(400).json({ error: 'Pseudo et nom requis' });
    }

    let episodesData = [];
    try {
      episodesData = JSON.parse(episodes || '[]');
    } catch (e) {
      if (req.files) {
        req.files.forEach(file => fs.unlinkSync(file.path));
      }
      return res.status(400).json({ error: 'Format d\'épisodes invalide' });
    }

    if (episodesData.length === 0) {
      if (req.files) {
        req.files.forEach(file => fs.unlinkSync(file.path));
      }
      return res.status(400).json({ error: 'Au moins un épisode est requis' });
    }

    // Construire la liste des épisodes avec les fichiers uploadés
    const finalEpisodes = episodesData.map((ep, idx) => {
      if (ep.hasFile) {
        // Trouver le fichier correspondant
        const file = req.files.find(f => f.fieldname === `episode_${ep.index}`);
        if (!file) {
          throw new Error(`Fichier manquant pour l'épisode ${idx + 1}`);
        }
        return {
          id: `${nextSeriesId}-${idx + 1}`,
          title: ep.title,
          src: `/uploads/${file.filename}`, // URL relative vers le fichier
          pseudo: pseudo
        };
      } else {
        return {
          id: `${nextSeriesId}-${idx + 1}`,
          title: ep.title,
          src: ep.src, // URL externe
          pseudo: pseudo
        };
      }
    });

    const newSeries = {
      id: String(nextSeriesId++),
      name,
      desc: desc || '',
      image: image || '',
      pseudo: pseudo,
      episodes: finalEpisodes
    };

    series.push(newSeries);
    res.json(newSeries);
  } catch (error) {
    console.error('Erreur création série:', error);
    // Nettoyer les fichiers en cas d'erreur
    if (req.files) {
      req.files.forEach(file => {
        try {
          fs.unlinkSync(file.path);
        } catch (e) {
          console.error('Erreur suppression fichier:', e);
        }
      });
    }
    res.status(500).json({ error: error.message || 'Erreur serveur' });
  }
});

// Supprimer une série (admin uniquement)
app.delete('/api/series/:id', authMiddleware, adminMiddleware, (req, res) => {
  const idx = series.findIndex(s => s.id === req.params.id);
  if (idx === -1) {
    return res.status(404).json({ error: 'Série introuvable' });
  }

  // Supprimer les fichiers vidéo associés
  const seriesToDelete = series[idx];
  seriesToDelete.episodes.forEach(ep => {
    if (ep.src.startsWith('/uploads/')) {
      const filePath = path.join(__dirname, ep.src);
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log('Fichier supprimé:', filePath);
        }
      } catch (error) {
        console.error('Erreur suppression fichier:', error);
      }
    }
  });

  series.splice(idx, 1);
  res.json({ success: true });
});

// Ajouter un épisode à une série existante
app.post('/api/series/:id/episodes', authMiddleware, upload.single('video'), (req, res) => {
  try {
    const seriesObj = series.find(s => s.id === req.params.id);
    if (!seriesObj) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'Série introuvable' });
    }

    const { title, url, pseudo } = req.body;
    const epNumber = seriesObj.episodes.length + 1;

    let src;
    if (req.file) {
      src = `/uploads/${req.file.filename}`;
    } else if (url) {
      src = url;
    } else {
      return res.status(400).json({ error: 'Fichier ou URL requis' });
    }

    const newEpisode = {
      id: `${seriesObj.id}-${epNumber}`,
      title: title || `Épisode ${epNumber}`,
      src: src,
      pseudo: pseudo || req.user.username
    };

    seriesObj.episodes.push(newEpisode);
    res.json(newEpisode);
  } catch (error) {
    console.error('Erreur ajout épisode:', error);
    if (req.file) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (e) {
        console.error('Erreur suppression fichier:', e);
      }
    }
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Supprimer un épisode (admin uniquement)
app.delete('/api/series/:seriesId/episodes/:episodeId', authMiddleware, adminMiddleware, (req, res) => {
  const seriesObj = series.find(s => s.id === req.params.seriesId);
  if (!seriesObj) {
    return res.status(404).json({ error: 'Série introuvable' });
  }

  const epIdx = seriesObj.episodes.findIndex(ep => ep.id === req.params.episodeId);
  if (epIdx === -1) {
    return res.status(404).json({ error: 'Épisode introuvable' });
  }

  const episode = seriesObj.episodes[epIdx];
  
  // Supprimer le fichier si c'est un upload local
  if (episode.src.startsWith('/uploads/')) {
    const filePath = path.join(__dirname, episode.src);
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log('Fichier supprimé:', filePath);
      }
    } catch (error) {
      console.error('Erreur suppression fichier:', error);
    }
  }

  seriesObj.episodes.splice(epIdx, 1);
  res.json({ success: true });
});

// Démarrer le serveur
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Serveur démarré sur http://localhost:${PORT}`);
  console.log(`📁 Dossier uploads: ${uploadsDir}`);
  console.log(`👤 Compte admin: admin / admin`);
});
