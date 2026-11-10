import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

// ===== Conexão com o banco =====
async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('MongoDB conectado');
  } catch (err) {
    console.error('Erro ao conectar MongoDB:', err.message);
    process.exit(1);
  }
}

// ===== Modelos =====
const questionSchema = new mongoose.Schema({
  id: Number,
  question: String,
  options: [String],
  correctIndex: Number
});

const Activity = mongoose.model('Activity', new mongoose.Schema({
  slug: { type: String, unique: true, required: true },
  title: String,
  description: String,
  questions: [questionSchema]
}));

const Result = mongoose.model('Result', new mongoose.Schema({
  activitySlug: { type: String, required: true },
  studentName: { type: String, required: true },
  score: { type: Number, required: true },
  total: { type: Number, required: true },
  answers: [Number],
  createdAt: { type: Date, default: Date.now }
}));

// ===== App =====
const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json());

app.get('/', (_, res) => res.json({ ok: true }));

// --- Middleware de admin ---
const adminAuth = (req, res, next) => {
  if (req.headers['x-admin-token'] !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Não autorizado' });
  }
  next();
};

// --- Rotas de atividades ---
app.get('/api/activities', async (_, res) => {
  try {
    const list = await Activity.find({}, 'slug title description');
    res.json(list);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/activities/:slug', async (req, res) => {
  try {
    const activity = await Activity.findOne({ slug: req.params.slug });
    if (!activity) return res.status(404).json({ error: 'Atividade não encontrada' });
    const safe = activity.toObject();
    safe.questions = safe.questions.map(({ correctIndex, ...q }) => q);
    res.json(safe);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Rota de respostas ---
app.post('/api/results/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const { studentName, answers } = req.body;

    const activity = await Activity.findOne({ slug });
    if (!activity) return res.status(404).json({ error: 'Atividade não encontrada' });

    let score = 0;
    activity.questions.forEach((q, i) => {
      if (answers[i] === q.correctIndex) score++;
    });

    const saved = await Result.create({
      activitySlug: slug,
      studentName,
      score,
      total: activity.questions.length,
      answers
    });

    res.status(201).json({ score, total: activity.questions.length, id: saved._id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Rotas de admin ---
app.post('/api/admin/login', (req, res) => {
  if (req.body.password === process.env.ADMIN_PASSWORD) return res.json({ ok: true });
  return res.status(401).json({ error: 'Senha inválida' });
});

app.get('/api/admin/results', adminAuth, async (_, res) => {
  try {
    const list = await Result.find().sort({ createdAt: -1 });
    res.json(list);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/seed', adminAuth, async (req, res) => {
  try {
    await Activity.deleteMany({});
    const created = await Activity.insertMany(req.body.activities);
    res.json({ inserted: created.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== Start =====
const PORT = process.env.PORT || 5000;
connectDB().then(() => {
  app.listen(PORT, () => console.log(`Servidor na porta ${PORT}`));
});