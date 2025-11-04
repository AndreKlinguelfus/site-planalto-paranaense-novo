/*
 * Este é um ficheiro de ajuda. Não faz parte do nosso site.
 * O seu único objetivo é usar a biblioteca bcryptjs para
 * criar um novo hash para nós.
 */
const bcrypt = require('bcryptjs');

// 1. Define a senha que queres usar
const senhaOriginal = '#Blshhebgatsjt12@090087';

// 2. Define a "força" do hash (10 é o padrão)
const saltRounds = 10;

console.log(`A gerar hash para a senha: "${senhaOriginal}"...`);

// 3. Gera o hash
bcrypt.hash(senhaOriginal, saltRounds, (err, hashGerado) => {
    if (err) {
        console.error('ERRO ao gerar o hash:', err);
        return;
    }

    // 4. Mostra o hash no terminal
    console.log('============================================================');
    console.log('HASH GERADO COM SUCESSO!');
    console.log('COPIA O TEXTO COMPLETO DA LINHA ABAIXO:');
    console.log(hashGerado);
    console.log('============================================================');
});