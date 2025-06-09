const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const Database = require('better-sqlite3');
const cors = require('cors');
const he = require('he');
const iconv = require('iconv-lite');
const { default: axiosRetry } = require('axios-retry');

const app = express();
app.use(cors());

axiosRetry(axios, {
  retries: 3, // Tenta a requisição até 4 vezes (1 principal + 3 retentativas)
  retryDelay: (retryCount) => {
    console.log(`Falha na requisição. Tentativa de retry #${retryCount}. Aguardando ${retryCount * 2} segundos...`);
    return retryCount * 2000; // Aguarda 2s, 4s, 6s entre as tentativas
  },
  retryCondition: (error) => {
    // Tenta novamente se for um erro de rede ou o erro específico ECONNRESET
    return axiosRetry.isNetworkOrIdempotentRequestError(error) || error.code === 'ECONNRESET';
  },
});

const db = new Database('./laws.db');

db.prepare(`
  CREATE TABLE IF NOT EXISTS laws (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    law_type TEXT UNIQUE,
    content TEXT,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).run();

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchAndParseData(url) {
  try {
    const { data } = await axios.get(url, {
      timeout: 20000, // Timeout um pouco maior para mais tolerância
      responseType: 'arraybuffer', // Essencial para decodificação manual de caracteres
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
      },
    });

    // Decodifica o conteúdo usando o padrão correto para sites do governo
    const decodedHtml = iconv.decode(data, 'windows-1252');
    return parseHTML(decodedHtml);

  } catch (error) {
    // Este log agora só aparecerá se todas as retentativas falharem
    console.error(`ERRO FINAL ao buscar dados de ${url}:`, error.message);
    return null;
  }
}

// Processa e limpa o HTML
function parseHTML(html) {
  const $ = cheerio.load(html);
  $('img, script, style, link').remove(); // Removendo também <link> para tirar CSS externo
  $('a').removeAttr('href');
  return he.decode($.html());
}

// Salva ou atualiza o conteúdo no banco de dados
async function updateLaw(lawType, url) {
  console.log(`Buscando ${lawType}...`);
  const content = await fetchAndParseData(url);

  if (content) {
    db.prepare(`
      INSERT INTO laws (law_type, content, last_updated) 
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(law_type) DO UPDATE 
      SET content = excluded.content, last_updated = CURRENT_TIMESTAMP
    `).run(lawType, content);
    console.log(`✅ Lei ${lawType} atualizada no banco de dados.`);
  } else {
    console.log(`❌ Falha ao obter conteúdo para ${lawType} após todas as tentativas.`);
  }
}

// Endpoint para obter conteúdo de leis
app.get('/laws/:lawType', (req, res) => {
  const lawType = req.params.lawType;
  const row = db.prepare(`
    SELECT content FROM laws 
    WHERE law_type = ? 
    ORDER BY last_updated DESC 
    LIMIT 1
  `).get(lawType);

  if (row) {
    res.send(row.content);
  } else {
    res.status(404).json({ error: 'Lei não encontrada' });
  }
});

// Leis a serem atualizadas periodicamente
const lawsToUpdate = [
    { type: 'codigo-civil', url: 'https://www.planalto.gov.br/ccivil_03/Leis/2002/L10406compilada.htm' },
    { type: 'processo-civil', url: 'https://www.planalto.gov.br/ccivil_03/decreto-lei/1937-1946/del1608.htm' },
    { type: 'eleitoral', url: 'https://www.planalto.gov.br/ccivil_03/Leis/L4737compilado.htm' },
    { type: 'codigo-comercial', url: 'https://www.planalto.gov.br/ccivil_03/leis/lim/LIM556compilado.htm' },
    { type: 'codigo-penal', url: 'https://www.planalto.gov.br/ccivil_03/decreto-lei/del2848compilado.htm' },
    { type: 'constituicao-federal', url: 'https://www.planalto.gov.br/ccivil_03/constituicao/ConstituicaoCompilado.htm' },
    { type: 'codigo-tributario', url: 'https://www.planalto.gov.br/ccivil_03/leis/L5172Compilado.htm' },
    { type: 'leis-trabalho', url: 'https://www.planalto.gov.br/ccivil_03/decreto-lei/Del5452compilado.htm' },
    { type: 'defesa-consumidor', url: 'https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm' },
    { type: 'advocacia', url: 'https://www.planalto.gov.br/ccivil_03/leis/l8906.htm' },
    { type: 'estatuto-deficiencia', url: 'https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2015/lei/l13146.htm' },
];

// <<< MUDANÇA: Agendador com pausa entre as requisições
async function scheduleLawUpdates() {
  console.log('Iniciando rotina de atualização de leis...');
  for (const law of lawsToUpdate) {
    await updateLaw(law.type, law.url);
    // Pausa de 2 segundos para não sobrecarregar o servidor
    console.log('...pausa de 2 segundos...');
    await delay(2000); 
  }
  console.log('--- Rotina de atualização concluída. Próxima em 24 horas. ---');
}

// Inicia a primeira atualização e agenda as próximas
scheduleLawUpdates();
setInterval(scheduleLawUpdates, 24 * 60 * 60 * 1000); // 24 horas

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});