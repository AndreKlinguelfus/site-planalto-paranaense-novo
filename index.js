require('dotenv').config(); 

// Secção 1: Importações
const express = require('express');
const { Pool } = require('pg');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
//const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const { JSDOM } = require('jsdom');
const DOMPurify = require('dompurify');
const cookieParser = require('cookie-parser');
const csrf = require('csurf');
const fs = require('fs');

// --- MUDANÇA: Importações da AWS ---
const { S3Client } = require('@aws-sdk/client-s3'); // SDK v3
const multerS3 = require('multer-s3');
// --- Fim da Mudança ---

const publicRoutes = require('./routes/publicRoutes');
const adminRoutes = require('./routes/adminRoutes');

const window = new JSDOM('').window;
const purify = DOMPurify(window);

/* =======================================
 * Secção 2: Configurações Iniciais
 * ======================================= */
const app = express();
app.set('trust proxy', 1);

// Configuração de Segurança (HELMET) com Políticas de Conteúdo (CSP)
/*app.use(
  helmet.contentSecurityPolicy({
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      "script-src": [
        "'self'", 
        "https://cdn.jsdelivr.net", 
        "https://cdnjs.cloudflare.com",
        "https://cdn.tiny.cloud"
      ],
      "style-src": [
        "'self'", 
        "'unsafe-inline'", 
        "https://cdn.jsdelivr.net", 
        "https://cdnjs.cloudflare.com", 
        "https://fonts.googleapis.com"
      ],
      "connect-src": [
        "'self'", 
        "https://cdn.tiny.cloud"
      ],
      "font-src": [
        "'self'", 
        "https://fonts.gstatic.com", 
        "https://cdnjs.cloudflare.com"
      ],
      "img-src": [
        "'self'", 
        "data:", 
        `https://${process.env.AWS_BUCKET_NAME}.s3.amazonaws.com`,
        `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com`
      ],
      "frame-src": ["'self'", "https://cdn.tiny.cloud"]
    },
  })
);*/

const port = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', './views');

app.use(express.static(path.join(__dirname, 'public')));
// Não precisamos mais da pasta de uploads estática
// app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* =======================================
 * Secção 3: Configuração da Base de Dados
 * ======================================= */
const dbConfig = {
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 5432,

  // O Render exige SSL, mas o seu .env local provavelmente não.
  // Esta linha ativa o SSL apenas em 'production'.
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
};
const pool = new Pool(dbConfig);

async function startApp() {

  // --- CÓDIGO NOVO: Garante que a tabela de sessão existe ---
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS "session" (
        "sid" varchar NOT NULL COLLATE "default",
        "sess" json NOT NULL,
        "expire" timestamp(6) NOT NULL,
        CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
      );
    `);
    // Também criamos o índice (se não existir)
    await client.query(`
      CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
    `);
    console.log('Tabela "session" (sessão) verificada/criada com sucesso.');
  } catch (err) {
    console.error('ERRO AO CRIAR A TABELA DE SESSÃO:', err);
    process.exit(1); // Falha se não conseguir criar a tabela
  } finally {
    client.release();
  }
/* =======================================
 * Secção 4: Middlewares (Sessão, CSRF, Multer)
 * ======================================= */

const sessionStore = new pgSession({ pool : pool, tableName : 'session' });
app.use(session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 24
    }
}));

app.use(cookieParser());
const csrfProtection = csrf({ cookie: true });
app.use(csrfProtection);
app.use((req, res, next) => {
    res.locals.csrfToken = req.csrfToken();
    next();
});

// --- MUDANÇA: Configuração do Multer para S3 ---
// Configura o S3 Client (v3)
const s3 = new S3Client({}); //

const imageFileFilter = (req, file, cb) => {
    const allowedExtensions = /jpeg|jpg|png|gif|webp/;
    const allowedMimeTypes = /image\/jpeg|image\/png|image\/gif|image\/webp/;
    const extname = allowedExtensions.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedMimeTypes.test(file.mimetype);
    if (mimetype && extname) { cb(null, true); }
    else { cb(new Error('Apenas ficheiros de imagem (JPEG, PNG, GIF, WEBP) são permitidos!'), false); }
}; //

const upload = multer({
    storage: multerS3({
        s3: s3,
        bucket: process.env.AWS_BUCKET_NAME, //
        acl: 'public-read', //
        metadata: function (req, file, cb) {
            cb(null, { fieldName: file.fieldname });
        }, //
        key: function (req, file, cb) {
             const safeOriginalName = file.originalname.replace(/[^a-zA-Z0-9.]/g, '_');
             const uniqueName = Date.now() + '-' + safeOriginalName;
             cb(null, uniqueName);
        } //
    }),
    fileFilter: imageFileFilter,
    limits: { fileSize: 5 * 1024 * 1024 } //
});
// Esta função foi movida para cima
// const imageFileFilter = (req, file, cb) => { ... };
// --- Fim da Mudança ---

const handleMulterError = (err, req, res, next) => { /* ... (o teu código de erro) ... */ };
app.post('/admin/salvar', handleMulterError);
app.post('/admin/salvar-edicao/:id', handleMulterError);

const loginLimiter = rateLimit({ /* ... (o teu código) ... */ });

function checkAuth(req, res, next) { /* ... (o teu código) ... */ }

const categoriesList = [ 'Região', 'Gastronomia', 'Política', 'Esportes', 'Cultura', 'Opinião', 'Lazer', 'História', 'Eleições 2026'];
app.locals.categories = categoriesList;

/* =======================================
 * Secção 6: Definição das Rotas
 * ======================================= */
app.use('/', publicRoutes(pool));
app.use('/', adminRoutes(pool, s3, upload, loginLimiter, checkAuth, { body, validationResult, purify }));

/* =======================================
 * Secção 7: Gestão de Erros (404 e 500)
 * ======================================= */
app.use((err, req, res, next) => { /* ... (o teu handler CSRF) ... */ });
app.use((req, res, next) => { /* ... (o teu handler 404) ... */ });
app.use((err, req, res, next) => { /* ... (o teu handler 500) ... */ });

/* =======================================
 * Secção 8: Abrir o Restaurante
 * ======================================= */

} // <-- ADICIONE ESTA CHAVETA. Ela fecha a função startApp()

// Agora, chame a função para iniciar tudo
startApp();