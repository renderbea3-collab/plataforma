import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();
const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json());

const DB_FILE = path.join(process.cwd(), 'db.json');

// ===== Funções do "Banco de Dados" (JSON) =====
function lerBanco() {
  const data = fs.readFileSync(DB_FILE, 'utf-8');
  return JSON.parse(data);
}

async function salvarNoGitHub(conteudo) {
  if (!process.env.GITHUB_TOKEN) {
    console.log('GITHUB_TOKEN não configurado. Salvando apenas localmente.');
    return;
  }
  const url = `https://api.github.com/repos/${process.env.GITHUB_REPO}/contents/db.json`;
  const token = process.env.GITHUB_TOKEN;
  const branch = process.env.GITHUB_BRANCH || 'main';

  try {
    const { data: current } = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` },
      params: { ref: branch }
    });

    await axios.put(url, {
      message: 'Atualização automática do banco de dados',
      content: Buffer.from(JSON.stringify(conteudo, null, 2)).toString('base64'),
      sha: current.sha,
      branch
    }, {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log('Banco de dados salvo no GitHub com sucesso!');
  } catch (err) {
    console.error('Erro ao salvar no GitHub:', err.response?.data || err.message);
  }
}

// ===== Rotas Públicas =====

// Listar Atividades ATIVAS (para os cards)
app.get('/api/activities', (req, res) => {
  const db = lerBanco();
  const list = db.activities
    .filter(a => a.active !== false) // Mostra se for true ou se a chave não existir
    .map(a => ({ slug: a.slug, title: a.title, description: a.description }));
  res.json(list);
});

// Pegar uma atividade específica
app.get('/api/activities/:slug', (req, res) => {
  const db = lerBanco();
  const activity = db.activities.find(a => a.slug === req.params.slug);
  if (!activity) return res.status(404).json({ error: 'Atividade não encontrada' });
  if (activity.active === false) return res.status(403).json({ error: 'Esta atividade está desativada.' });

  const safe = { ...activity };
  safe.questions = activity.questions.map(({ correctIndex, ...q }) => q);
  res.json(safe);
});

// Enviar respostas
app.post('/api/results/:slug', async (req, res) => {
  const { studentName, answers } = req.body;
  const db = lerBanco();
  const activity = db.activities.find(a => a.slug === req.params.slug);
  if (!activity) return res.status(404).json({ error: 'Atividade não encontrada' });
  if (activity.active === false) return res.status(403).json({ error: 'Esta atividade está desativada.' });

  if (!db.results) db.results = [];
  const tentativas = db.results.filter(
    r => r.activitySlug === req.params.slug && r.studentName.toLowerCase() === studentName.toLowerCase()
  ).length;

  if (tentativas >= 3) return res.status(403).json({ error: 'Você já atingiu o limite de 3 tentativas para esta atividade.' });

  let score = 0;
  activity.questions.forEach((q, i) => {
    if (answers[i] === q.correctIndex) score++;
  });

  const novoResultado = {
    id: Date.now(),
    activitySlug: req.params.slug,
    studentName,
    score,
    total: activity.questions.length,
    answers,
    tentativa: tentativas + 1,
    createdAt: new Date().toISOString()
  };

  db.results.push(novoResultado);
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  salvarNoGitHub(db);

  res.status(201).json({ score, total: activity.questions.length, tentativa: tentativas + 1 });
});

// ===== Rotas Admin =====
const adminAuth = (req, res, next) => {
  if (req.headers['x-admin-token'] !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Não autorizado' });
  }
  next();
};

app.post('/api/admin/login', (req, res) => {
  if (req.body.password === process.env.ADMIN_PASSWORD) return res.json({ ok: true });
  return res.status(401).json({ error: 'Senha inválida' });
});

// Listar todas as atividades (incluindo inativas) para o Admin
app.get('/api/admin/activities', adminAuth, (req, res) => {
  const db = lerBanco();
  res.json(db.activities.map(a => ({ slug: a.slug, title: a.title, active: a.active !== false })));
});

// Ligar/Desligar uma atividade
app.patch('/api/admin/activities/:slug/toggle', adminAuth, async (req, res) => {
  const db = lerBanco();
  const activity = db.activities.find(a => a.slug === req.params.slug);
  if (!activity) return res.status(404).json({ error: 'Atividade não encontrada' });

  activity.active = !activity.active;
  
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  salvarNoGitHub(db);
  
  res.json({ slug: activity.slug, active: activity.active });
});

app.get('/api/admin/results', adminAuth, (req, res) => {
  const db = lerBanco();
  res.json(db.results || []);
});

// Iniciar servidor
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
