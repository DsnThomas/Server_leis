const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const Database = require('better-sqlite3');
const cors = require('cors');
const he = require('he');

const app = express();
app.use(cors());

const db = new Database('./laws.db');

db.prepare(`
  CREATE TABLE IF NOT EXISTS laws (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    law_type TEXT UNIQUE,
    content TEXT,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).run();

// Função para buscar e processar dados diretamente
async function fetchAndParseData(url) {
  try {
    const { data } = await axios.get(url, { timeout: 10000 });

    return parseHTML(data);
  } catch (error) {
    console.error(`Erro ao buscar dados de ${url}:`, error.message);
    return null;
  }
}

// Processa e limpa o HTML
function parseHTML(html) {
  const $ = cheerio.load(html);

  $('img, script, style').remove();
  $('a').removeAttr('href');

  return he.decode($.html());
}

// Salva ou atualiza o conteúdo no banco de dados
async function updateLaw(lawType, url) {
  const content = await fetchAndParseData(url);
  if (content) {
    db.prepare(`
      INSERT INTO laws (law_type, content, last_updated) 
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(law_type) DO UPDATE 
      SET content = excluded.content, last_updated = CURRENT_TIMESTAMP
    `).run(lawType, content);

    console.log(`Lei ${lawType} atualizada no banco de dados.`);
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

// Atualiza todas as leis ao iniciar
async function scheduleLawUpdates() {
  for (const law of lawsToUpdate) {
    await updateLaw(law.type, law.url);
  }
}

scheduleLawUpdates();

// Atualiza a cada 24 horas
setInterval(scheduleLawUpdates, 24 * 60 * 60 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
