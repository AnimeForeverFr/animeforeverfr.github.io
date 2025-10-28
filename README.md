```markdown
# Anime Forever

Site simple pour gérer séries et épisodes, avec upload réel via un serveur Node.js.

Fonctionnalités
- Inscription / Connexion (mot de passe haché, JWT)
- Création de séries
- Ajout d’épisodes (URL ou upload de fichier)
- Modifier l'image d'une série
- Suppression d'épisodes / séries réservée à l'admin (vérifié côté serveur)
- Uploads servis depuis /uploads

Configuration
- Copier le projet
- Installer : `npm install`
- Variables d'environnement (optionnel) :
  - `JWT_SECRET` : secret JWT (par défaut `change_me_very_secret`)
  - `ADMIN_USERNAME` : pseudo admin autorisé à supprimer (par défaut `AnimeForever-admin`)
  - `PORT` : port (par défaut 3000)

Lancer en local
- npm run dev  (ou `npm start`)

Déploiement
- Tu peux déployer sur Railway / Render / Heroku facilement (push du repo, définir les env vars JWT_SECRET et ADMIN_USERNAME).
- Si tu veux utiliser S3 pour stocker les fichiers, remplace l’upload endpoint pour renvoyer une URL S3 (ou presigned upload).

Données
- stockées dans /data (users.json, series.json).
- uploads dans /uploads.

Sécurité
- Ce prototype est prêt pour développement. Pour production : stocker séries/Users dans base de données (Postgres/Mongo), utiliser S3 pour fichiers, limiter taille des fichiers et vérifier types MIME, activer HTTPS, configurer CORS uniquement pour ton domaine, harden JWT secret.
```
