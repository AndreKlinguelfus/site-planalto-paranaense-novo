/* =======================================
 * Rotas de Administração (Protegidas)
 * ======================================= */
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

// [MUDANÇA] Importar APENAS o DeleteObjectCommand
const { DeleteObjectCommand } = require('@aws-sdk/client-s3');

// [MUDANÇA] A INICIALIZAÇÃO DUPLICADA DO S3 FOI REMOVIDA DAQUI

// Função auxiliar para apagar do S3
// [MUDANÇA] Esta função agora recebe 's3' como argumento
async function deleteS3Image(s3, imageUrl) {
    if (!imageUrl) return;

    try {
        const bucketName = process.env.AWS_BUCKET_NAME;
        // Extrai a 'key' (nome do ficheiro) do URL completo
        const key = new URL(imageUrl).pathname.substring(1); 

        const command = new DeleteObjectCommand({
            Bucket: bucketName,
            Key: key,
        });

        await s3.send(command); // Usa o 's3' que veio como argumento
        console.log(`Imagem ${key} apagada com sucesso do S3.`);
    } catch (err) {
        console.warn(`Não foi possível apagar a imagem ${imageUrl} do S3:`, err.message);
    }
}
// --- Fim da Mudança ---

// [MUDANÇA] Aceitar 's3' como novo argumento
module.exports = (pool, s3, upload, loginLimiter, checkAuth, validationTools) => {

    const { body, validationResult, purify } = validationTools;

    // ===============================================
    // [CÓDIGO NOVO] ROTAS DE LOGIN E LOGOUT EM FALTA
    // ===============================================

    /** Rota GET /login (Página de Login) **/
    router.get('/login', loginLimiter, (req, res) => {
        if (req.session.userId) {
            return res.redirect('/admin/dashboard'); // Já está logado
        }
        res.render('login', { 
            pageTitle: 'Login - Admin',
            csrfToken: req.csrfToken() 
        });
    });

    /** Rota POST /login (Processar o Login) **/
    router.post('/login', loginLimiter, async (req, res, next) => {
        const { username, password } = req.body;
        console.log(`Tentativa de login para o utilizador: ${username}`);
        try {
            // Hash da senha para o admin (substitua pelo seu hash real!)
            // O utilizador é 'admin', a senha é '#Blshhebgatsjt12@090087'
            const adminHash = '$2b$10$E24HUmn58ZoKqWkVOzCvRu4.LZVyx820um0nFsR0T7j4P1P53aMBq';
            
            if (username === 'admin' && await bcrypt.compare(password, adminHash)) {
                console.log('Login bem-sucedido!');
                req.session.userId = 1; // Define o ID do admin na sessão
                res.redirect('/admin/dashboard');
            } else {
                console.warn('Falha no login: credenciais inválidas.');
                res.render('login', {
                    pageTitle: 'Login - Admin',
                    error: 'Utilizador ou senha inválidos.',
                    csrfToken: req.csrfToken()
                });
            }
        } catch (error) {
            console.error('ERRO GRAVE NO PROCESSAMENTO DO LOGIN:', error);
            next(error);
        }
    });

    /** Rota GET /logout **/
    router.get('/logout', (req, res, next) => {
        req.session.destroy((err) => {
            if (err) {
                return next(err);
            }
            res.redirect('/login');
        });
    });

    // ===============================================
    // (O seu código de rotas de admin continua aqui)
    // ===============================================

    /** Rota Salvar Artigo (/admin/salvar) **/
    router.post('/admin/salvar', 
        checkAuth, 
        upload.single('image'), 
        [ /* validação... */ ], 
        async (req, res, next) => {
            // (código de salvar...)
            const imageUrl = req.file ? req.file.location : null;
            console.log('Recebi um POST para /admin/salvar com a imagem:', imageUrl);

            try {
                const { title, author, content, category } = req.body;
                const sql = 'INSERT INTO articles (title, author, content, category, image_url) VALUES ($1, $2, $3, $4, $5)';
                const values = [title, author || 'Redação', content, category, imageUrl];
                await pool.query(sql, values);
                console.log('Artigo salvo com sucesso!');
                res.redirect('/admin/dashboard');
            } catch (error) {
                if (imageUrl) {
                    // [MUDANÇA] Passar o 's3' para a função de apagar
                    await deleteS3Image(s3, imageUrl);
                }
                console.error('ERRO GRAVE AO SALVAR NOVO ARTIGO:', error);
                next(error); 
            }
        }
    );

    /** Rota Apagar Artigo (/admin/apagar/:id) **/
    router.get('/admin/apagar/:id', checkAuth, async (req, res, next) => {
        const articleId = req.params.id;
        console.log(`Recebi um pedido para APAGAR o artigo ID: ${articleId}`);

        let client;
        try {
            client = await pool.connect();
            await client.query('BEGIN');

            const selectResult = await client.query('SELECT image_url FROM articles WHERE id = $1', [articleId]);
            let imageUrl = null;
            if (selectResult.rows.length > 0) {
                imageUrl = selectResult.rows[0].image_url;
            }

            await client.query('DELETE FROM articles WHERE id = $1', [articleId]);
            console.log('Artigo apagado com sucesso da BD.');

            if (imageUrl) {
                // [MUDANÇA] Passar o 's3' para a função de apagar
                await deleteS3Image(s3, imageUrl);
            }

            await client.query('COMMIT');
            res.redirect('/admin/dashboard');

        } catch (error) {
            await client.query('ROLLBACK');
            console.error('ERRO GRAVE AO APAGAR ARTIGO:', error);
            next(error);
        } finally {
            if (client) {
                client.release();
            }
        }
    });

    /** Rota Editar Artigo GET (/admin/editar/:id) **/
    router.get('/admin/editar/:id', checkAuth, async (req, res, next) => {
        // (código de editar GET...)
        const articleId = req.params.id;
        try {
            const result = await pool.query('SELECT * FROM articles WHERE id = $1', [articleId]);
            if (result.rows.length > 0) {
                res.render('admin-editar', {
                    pageTitle: `Editando: ${result.rows[0].title}`,
                    article: result.rows[0],
                    csrfToken: req.csrfToken()
                });
            } else {
                next(); // 404
            }
        } catch (error) {
            next(error); // 500
        }
    });

    /** Rota Salvar Edição (/admin/salvar-edicao/:id) **/
    router.post('/admin/salvar-edicao/:id',
        checkAuth,
        upload.single('image'), 
        [ /* validação... */ ],
        async (req, res, next) => {
            // (código de salvar edição...)
            const articleId = req.params.id;
            const { title, author, content, category, old_image_url } = req.body;
            let imageUrl = req.file ? req.file.location : old_image_url;

            if (req.file && old_image_url) {
                // [MUDANÇA] Passar o 's3' para a função de apagar
                await deleteS3Image(s3, old_image_url);
            }

            try {
                const sql = 'UPDATE articles SET title = $1, author = $2, content = $3, category = $4, image_url = $5 WHERE id = $6';
                const values = [title, author || 'Redação', content, category, imageUrl, articleId];

                await pool.query(sql, values);
                console.log('Artigo ATUALIZADO com sucesso!');
                res.redirect('/admin/dashboard');
            } catch (error) {
                if (req.file) {
                    // [MUDANÇA] Passar o 's3' para a função de apagar
                    await deleteS3Image(s3, req.file.location);
                }
                console.error('ERRO GRAVE AO ATUALIZAR ARTIGO:', error);
                next(error);
            }
        }
    );

    // [CÓDIGO NOVO] Rota /admin/dashboard que estava em falta
    /** Rota GET /admin/dashboard (Painel de Controle) **/
    router.get('/admin/dashboard', checkAuth, async (req, res, next) => {
        try {
            const result = await pool.query('SELECT id, title, author, category FROM articles ORDER BY created_at DESC');
            res.render('admin-dashboard', {
                pageTitle: 'Painel de Controle',
                articles: result.rows
            });
        } catch (error) {
            console.error('ERRO GRAVE AO BUSCAR ARTIGOS PARA O DASHBOARD:', error);
            next(error);
        }
    });

    // [CÓDIGO NOVO] Rota /admin/novo que estava em falta
    /** Rota GET /admin/novo (Escrever Novo Artigo) **/
    router.get('/admin/novo', checkAuth, (req, res) => {
        res.render('admin-novo', {
            pageTitle: 'Escrever Novo Artigo',
            csrfToken: req.csrfToken()
        });
    });

    return router;
};