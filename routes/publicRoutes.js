/* =======================================
 * Rotas Públicas (Visíveis a todos)
 * ======================================= */
const express = require('express');
const router = express.Router();

// Esta função recebe o 'pool' da BD do index.js
module.exports = (pool) => {

    /** Rota da Página Inicial (/) **/
    router.get('/', async (req, res, next) => {
        console.log('Recebi um pedido para a página inicial!');
        try {
            const queryTodos = 'SELECT * FROM articles ORDER BY created_at DESC';
            const queryOpiniao = 'SELECT * FROM articles WHERE category = $1 ORDER BY created_at DESC LIMIT 5';
            const queryPolitica = 'SELECT * FROM articles WHERE category = $1 ORDER BY created_at DESC LIMIT 5';
            
            const [todosResult, opiniaoResult, politicaResult] = await Promise.all([
                pool.query(queryTodos),
                pool.query(queryOpiniao, ['Opinião']),
                pool.query(queryPolitica, ['Política'])
            ]);
            
            const todosArticles = todosResult.rows;
            const opiniaoArticles = opiniaoResult.rows;
            const politicaArticles = politicaResult.rows;
            
            console.log(`Sucesso! Encontrei:\n - ${todosArticles.length} artigos no total\n - ${opiniaoArticles.length} artigos de Opinião\n - ${politicaArticles.length} artigos de Política`);
            
            res.render('index', {
                articles: todosArticles,
                opiniaoArticles: opiniaoArticles,
                politicaArticles: politicaArticles,
                pageTitle: 'Início - Planalto Paranaense'
            });
        } catch (error) {
            console.error('ERRO GRAVE AO BUSCAR NOTÍCIAS PARA A HOMEPAGE:', error);
            next(error); // Passa o erro para o handler 500
        }
    });

    /** Rota Artigo Individual (/artigo/:id) **/
    router.get('/artigo/:id', async (req, res, next) => {
        const articleId = req.params.id;
        console.log(`Recebi um pedido para o artigo com ID: ${articleId}`);
        try {
            const articleResult = await pool.query('SELECT * FROM articles WHERE id = $1', [articleId]);
            
            if (articleResult.rows.length > 0) {
                const foundArticle = articleResult.rows[0];
                const mainId = foundArticle.id;
                const mainCategory = foundArticle.category;
                
                console.log(`A buscar até 3 sugestões para o artigo ID: ${mainId}, Categoria: ${mainCategory}`);
                let suggestions = [];
                let excludeIds = [mainId];

                // 1. Tenta buscar 1 relacionado da mesma categoria
                const relatedResult = await pool.query('SELECT * FROM articles WHERE category = $1 AND id != $2 ORDER BY RANDOM() LIMIT 1', [mainCategory, mainId]);
                if (relatedResult.rows.length > 0) {
                    suggestions.push(relatedResult.rows[0]);
                    excludeIds.push(relatedResult.rows[0].id);
                }
                
                // 2. Completa com artigos aleatórios (se necessário)
                const needed = 3 - suggestions.length;
                if (needed > 0) {
                    const placeholders = excludeIds.map((_, i) => `$${i + 1}`).join(',');
                    const randomResult = await pool.query(`SELECT * FROM articles WHERE id NOT IN (${placeholders}) ORDER BY RANDOM() LIMIT $${excludeIds.length + 1}`, [...excludeIds, needed]);
                    
                    if (randomResult.rows.length > 0) {
                        suggestions = [...suggestions, ...randomResult.rows];
                    }
                }
                
                console.log(`Total de sugestões finais: ${suggestions.length}`);
                res.render('artigo', {
                    article: foundArticle,
                    suggestions: suggestions,
                    pageTitle: foundArticle.title
                });
            } else {
                // Artigo não encontrado, passa para o handler 404
                next(); 
            }
        } catch (error) {
            console.error('ERRO GRAVE AO BUSCAR ARTIGO INDIVIDUAL E SUGESTÕES:', error);
            next(error); // Passa o erro para o handler 500
        }
    });

    /** Rota Categoria (/categoria/:categoryName) **/
    router.get('/categoria/:categoryName', async (req, res, next) => {
        const categoryNameParam = decodeURIComponent(req.params.categoryName);
        let categoryName;
        
        if (categoryNameParam === 'eleicoes-2026') {
            categoryName = 'Eleições 2026';
        } else {
            // Capitaliza o nome da categoria
            categoryName = categoryNameParam.charAt(0).toUpperCase() + categoryNameParam.slice(1);
        }
        
        console.log(`Recebi um pedido para a categoria: ${categoryName}`);
        try {
            const result = await pool.query('SELECT * FROM articles WHERE category = $1 ORDER BY created_at DESC', [categoryName]);
            console.log(`Encontrei ${result.rows.length} artigos para a categoria ${categoryName}.`);
            
            res.render('category', {
                articles: result.rows,
                categoryName: categoryName,
                pageTitle: `Notícias de ${categoryName} - Planalto Paranaense`
            });
        } catch (error) {
            console.error('ERRO GRAVE AO BUSCAR ARTIGOS POR CATEGORIA:', error);
            next(error); // Passa o erro para o handler 500
        }
    });

    /** Rota Todos Artigos (/todos-artigos) **/
    router.get('/todos-artigos', async (req, res, next) => {
        console.log(`Recebi um pedido para a página de Todos os Artigos.`);
        try {
            const result = await pool.query('SELECT * FROM articles ORDER BY created_at DESC');
            console.log(`Encontrei ${result.rows.length} artigos no total.`);
            
            res.render('todos-artigos', {
                articles: result.rows,
                pageTitle: 'Todos os Artigos - Planalto Paranaense'
            });
        } catch (error) {
            console.error('ERRO GRAVE AO BUSCAR TODOS OS ARTIGOS:', error);
            next(error); // Passa o erro para o handler 500
        }
    });

    /** Rota Pesquisa (/pesquisa) **/
    router.get('/pesquisa', async (req, res, next) => {
        const searchTerm = req.query.q || '';
        console.log(`Recebi um pedido de pesquisa para o termo: "${searchTerm}"`);
        
        if (!searchTerm.trim()) {
            console.log("Termo de pesquisa vazio, redirecionando para a home.");
            return res.redirect('/');
        }
        
        try {
            const sql = `SELECT * FROM articles WHERE title ILIKE $1 OR content ILIKE $1 ORDER BY created_at DESC`;
            const searchTermLike = `%${searchTerm}%`;
            
            const result = await pool.query(sql, [searchTermLike]);
            
            console.log(`Encontrados ${result.rows.length} artigos para o termo "${searchTerm}".`);
            res.render('pesquisa', {
                articles: result.rows,
                searchTerm: searchTerm,
                pageTitle: `Resultados para "${searchTerm}" - Planalto Paranaense`
            });
        } catch (error) {
            console.error('ERRO GRAVE AO REALIZAR PESQUISA:', error);
            next(error); // Passa o erro para o handler 500
        }
    });

    /** Rota Contato (/contato) **/
    router.get('/contato', (req, res) => {
        console.log('Recebi um pedido para a página de contato.');
        res.render('contato', { 
            pageTitle: 'Contato - Planalto Paranaense',
            // MUDANÇA: Lê do .env (com um fallback caso não exista)
            contactEmail: process.env.CONTACT_EMAIL || 'email@exemplo.com',
            contactPhone: process.env.CONTACT_PHONE || '(00) 00000-0000'
        });
    });

    return router; // Retorna o router configurado
};