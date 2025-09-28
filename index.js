require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const corsOrigin = process.env.CORS_ORIGIN || 'https://live-polling-system-frontend-pearl.vercel.app';

app.use(cors({ origin: corsOrigin }));
app.use(express.json());

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// Root endpoint
app.get('/', (_req, res) => {
  res.json({ 
    message: 'Live Polling System Backend',
    status: 'running',
    corsOrigin: corsOrigin,
    note: 'Socket.IO functionality requires a persistent server (not serverless)'
  });
});

// API endpoints for polling (REST API approach)
let pollState = {
  teacherSocketId: null,
  students: {},
  studentNames: new Set(),
  currentQuestion: null,
  answers: {},
  submissions: {},
  history: []
};

// Teacher endpoints
app.post('/api/teacher/join', (req, res) => {
  const { teacherId } = req.body;
  pollState.teacherSocketId = teacherId;
  res.json({ success: true, message: 'Teacher joined' });
});

app.post('/api/teacher/ask', (req, res) => {
  const { teacherId, text, options, timeLimitSec } = req.body;
  
  if (pollState.teacherSocketId !== teacherId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  if (!text || !options || options.length < 2) {
    return res.status(400).json({ error: 'Invalid question data' });
  }
  
  const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  pollState.currentQuestion = {
    id,
    text: text.slice(0, 200),
    options: options.map(opt => String(opt).trim()).filter(opt => opt.length > 0),
    timeLimitSec: Math.min(Math.max(timeLimitSec || 60, 5), 300),
    startedAtMs: Date.now()
  };
  
  pollState.answers[id] = {};
  pollState.submissions[id] = {};
  
  // Reset student flags
  Object.keys(pollState.students).forEach(sid => {
    pollState.students[sid].hasAnswered = false;
  });
  
  res.json({ success: true, questionId: id });
});

app.post('/api/teacher/end', (req, res) => {
  const { teacherId } = req.body;
  
  if (pollState.teacherSocketId !== teacherId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  if (!pollState.currentQuestion) {
    return res.status(400).json({ error: 'No active question' });
  }
  
  // Move to history
  const q = pollState.currentQuestion;
  const qid = q.id;
  const counts = q.options.map((_, idx) => (pollState.answers[qid]?.[idx] || 0));
  
  pollState.history.unshift({
    id: qid,
    text: q.text,
    options: q.options,
    results: counts,
    startedAtMs: q.startedAtMs,
    timeLimitSec: q.timeLimitSec
  });
  
  if (pollState.history.length > 10) pollState.history.pop();
  
  pollState.currentQuestion = null;
  res.json({ success: true });
});

// Student endpoints
app.post('/api/student/join', (req, res) => {
  const { studentId, name } = req.body;
  
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }
  
  const safeName = String(name).trim().slice(0, 40);
  
  if (pollState.studentNames.has(safeName)) {
    return res.status(400).json({ error: 'Name already taken' });
  }
  
  pollState.studentNames.add(safeName);
  pollState.students[studentId] = { name: safeName, hasAnswered: false };
  
  res.json({ success: true, studentName: safeName });
});

app.post('/api/student/answer', (req, res) => {
  const { studentId, optionIndex } = req.body;
  
  if (!pollState.currentQuestion) {
    return res.status(400).json({ error: 'No active question' });
  }
  
  const qid = pollState.currentQuestion.id;
  
  if (pollState.submissions[qid][studentId] !== undefined) {
    return res.status(400).json({ error: 'Already answered' });
  }
  
  const idx = Number(optionIndex);
  if (Number.isNaN(idx) || idx < 0 || idx >= pollState.currentQuestion.options.length) {
    return res.status(400).json({ error: 'Invalid option' });
  }
  
  pollState.submissions[qid][studentId] = idx;
  pollState.answers[qid][idx] = (pollState.answers[qid][idx] || 0) + 1;
  
  if (pollState.students[studentId]) {
    pollState.students[studentId].hasAnswered = true;
  }
  
  res.json({ success: true });
});

// Get poll state
app.get('/api/poll/state', (req, res) => {
  let results = null;
  const hasQuestion = !!pollState.currentQuestion;
  
  if (hasQuestion) {
    const qid = pollState.currentQuestion.id;
    const counts = pollState.answers[qid] || {};
    const totals = pollState.currentQuestion.options.map((_, idx) => counts[idx] || 0);
    const totalVotes = totals.reduce((a, b) => a + b, 0);
    results = { totals, totalVotes };
  }
  
  res.json({
    hasQuestion,
    currentQuestion: hasQuestion ? {
      id: pollState.currentQuestion.id,
      text: pollState.currentQuestion.text,
      options: pollState.currentQuestion.options,
      timeLimitSec: pollState.currentQuestion.timeLimitSec,
      startedAtMs: pollState.currentQuestion.startedAtMs
    } : null,
    results,
    studentCount: Object.keys(pollState.students).length,
    history: pollState.history.slice(0, 10)
  });
});

// Reset poll
app.post('/api/poll/reset', (req, res) => {
  const { teacherId } = req.body;
  
  if (pollState.teacherSocketId !== teacherId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  pollState = {
    teacherSocketId: null,
    students: {},
    studentNames: new Set(),
    currentQuestion: null,
    answers: {},
    submissions: {},
    history: []
  };
  
  res.json({ success: true });
});

// Catch-all route
app.get('*', (_req, res) => {
  res.status(404).json({ 
    error: 'Not Found',
    message: 'This is a REST API server for the Live Polling System',
    availableEndpoints: ['/', '/health', '/api/poll/state']
  });
});

module.exports = app;