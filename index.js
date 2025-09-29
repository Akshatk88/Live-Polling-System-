require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { kv } = require('@vercel/kv');

const app = express();
const corsOrigin = process.env.CORS_ORIGIN || 'https://live-polling-system-frontend-pearl.vercel.app';

app.use(cors({ origin: corsOrigin }));
app.use(express.json());

// Helper functions for state persistence
const STATE_KEY = 'pollState';

async function loadState() {
  try {
    const storedState = await kv.get(STATE_KEY);
    if (!storedState) {
      return {
        teacherSocketId: null,
        students: {},
        studentNames: new Set(), // In-memory Set
        currentQuestion: null,
        answers: {},
        submissions: {},
        history: []
      };
    }
    // Reconstruct Set from stored array
    return {
      ...storedState,
      studentNames: new Set(storedState.studentNames || [])
    };
  } catch (error) {
    console.error('Error loading state:', error);
    // Fallback to default on error
    return {
      teacherSocketId: null,
      students: {},
      studentNames: new Set(),
      currentQuestion: null,
      answers: {},
      submissions: {},
      history: []
    };
  }
}

async function saveState(state) {
  try {
    // Convert Set to Array for JSON storage
    const serializableState = {
      ...state,
      studentNames: Array.from(state.studentNames)
    };
    await kv.set(STATE_KEY, serializableState);
  } catch (error) {
    console.error('Error saving state:', error);
    // Don't throw—let the request continue, but log for debugging
  }
}

// Health check endpoint
app.get('/health', async (_req, res) => {
  try {
    await loadState(); // Test KV connection
    res.json({ ok: true, usesKV: true });
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Root endpoint
app.get('/', async (_req, res) => {
  try {
    const state = await loadState();
    res.json({ 
      message: 'Live Polling System Backend',
      status: 'running',
      corsOrigin: corsOrigin,
      usesKV: true,
      note: 'State persisted via Vercel KV (serverless-friendly). For real-time, consider polling /api/poll/state.'
    });
  } catch (error) {
    console.error('Root endpoint error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Teacher endpoints
app.post('/api/teacher/join', async (req, res) => {
  try {
    let pollState = await loadState();
    const { teacherId } = req.body;
    if (!teacherId) {
      return res.status(400).json({ error: 'teacherId is required' });
    }
    pollState.teacherSocketId = String(teacherId).trim();
    await saveState(pollState);
    res.json({ success: true, message: 'Teacher joined' });
  } catch (error) {
    console.error('Teacher join error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/teacher/ask', async (req, res) => {
  try {
    let pollState = await loadState();
    const { teacherId, text, options, timeLimitSec } = req.body;
    
    if (pollState.teacherSocketId !== teacherId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    if (!text || !options || !Array.isArray(options) || options.length < 2) {
      return res.status(400).json({ error: 'Invalid question data' });
    }
    
    const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    pollState.currentQuestion = {
      id,
      text: String(text).trim().slice(0, 200),
      options: options.map(opt => String(opt).trim()).filter(opt => opt.length > 0),
      timeLimitSec: Math.min(Math.max(Number(timeLimitSec) || 60, 5), 300),
      startedAtMs: Date.now()
    };
    
    if (pollState.currentQuestion.options.length < 2) {
      return res.status(400).json({ error: 'At least 2 options required' });
    }
    
    const qid = pollState.currentQuestion.id;
    pollState.answers[qid] = {};
    pollState.submissions[qid] = {};
    
    // Reset student flags
    Object.keys(pollState.students).forEach(sid => {
      if (pollState.students[sid]) {
        pollState.students[sid].hasAnswered = false;
      }
    });
    
    await saveState(pollState);
    res.json({ success: true, questionId: id });
  } catch (error) {
    console.error('Teacher ask error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/teacher/end', async (req, res) => {
  try {
    let pollState = await loadState();
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
    // Clean up answers/submissions for this question to save space
    delete pollState.answers[qid];
    delete pollState.submissions[qid];
    
    await saveState(pollState);
    res.json({ success: true });
  } catch (error) {
    console.error('Teacher end error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Student endpoints
app.post('/api/student/join', async (req, res) => {
  try {
    let pollState = await loadState();
    const { studentId, name } = req.body;
    
    if (!studentId || !name || !String(name).trim()) {
      return res.status(400).json({ error: 'studentId and name are required' });
    }
    
    const safeName = String(name).trim().slice(0, 40);
    
    if (pollState.studentNames.has(safeName)) {
      return res.status(400).json({ error: 'Name already taken' });
    }
    
    pollState.studentNames.add(safeName);
    pollState.students[String(studentId).trim()] = { name: safeName, hasAnswered: false };
    
    await saveState(pollState);
    res.json({ success: true, studentName: safeName });
  } catch (error) {
    console.error('Student join error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/student/answer', async (req, res) => {
  try {
    let pollState = await loadState();
    const { studentId, optionIndex } = req.body;
    
    if (!pollState.currentQuestion) {
      return res.status(400).json({ error: 'No active question' });
    }
    
    const qid = pollState.currentQuestion.id;
    
    if (pollState.submissions[qid][String(studentId)] !== undefined) {
      return res.status(400).json({ error: 'Already answered' });
    }
    
    const idx = Number(optionIndex);
    if (Number.isNaN(idx) || idx < 0 || idx >= pollState.currentQuestion.options.length) {
      return res.status(400).json({ error: 'Invalid option' });
    }
    
    pollState.submissions[qid][String(studentId)] = idx;
    pollState.answers[qid][idx] = (pollState.answers[qid][idx] || 0) + 1;
    
    if (pollState.students[String(studentId)]) {
      pollState.students[String(studentId)].hasAnswered = true;
    }
    
    await saveState(pollState);
    res.json({ success: true });
  } catch (error) {
    console.error('Student answer error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get poll state
app.get('/api/poll/state', async (req, res) => {
  try {
    const pollState = await loadState();
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
  } catch (error) {
    console.error('Poll state error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Reset poll
app.post('/api/poll/reset', async (req, res) => {
  try {
    let pollState = await loadState();
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
    
    await saveState(pollState);
    res.json({ success: true });
  } catch (error) {
    console.error('Poll reset error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Catch-all route
app.get('*', (_req, res) => {
  res.status(404).json({ 
    error: 'Not Found',
    message: 'This is a REST API server for the Live Polling System',
    availableEndpoints: [
      '/', 
      '/health', 
      '/api/teacher/join', 
      '/api/teacher/ask', 
      '/api/teacher/end', 
      '/api/student/join', 
      '/api/student/answer', 
      '/api/poll/state', 
      '/api/poll/reset'
    ]
  });
});

module.exports = app;
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 
