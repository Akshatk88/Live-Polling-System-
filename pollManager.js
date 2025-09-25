function createEmptyState() {
  return {
    teacherSocketId: null,
    // students: socketId -> { name, hasAnswered }
    students: {},
    // Track unique names globally
    studentNames: new Set(),
    // currentQuestion: { id, text, options: string[], timeLimitSec, startedAtMs }
    currentQuestion: null,
    // answers: questionId -> { optionIndex -> count }
    answers: {},
    // submissions: questionId -> { socketId -> optionIndex }
    submissions: {},
    // history for bonus (limited to last 10)
    history: []
  };
}

function createPollManager(io) {
  let state = createEmptyState();
  let questionTimer = null;

  function broadcastState() {
    const payload = getPublicState();
    io.emit('poll:state', payload);
  }

  function getPublicState() {
    let results = null;
    const hasQuestion = !!state.currentQuestion;
    if (hasQuestion) {
      const qid = state.currentQuestion.id;
      const counts = state.answers[qid] || {};
      const totals = state.currentQuestion.options.map((_, idx) => counts[idx] || 0);
      const totalVotes = totals.reduce((a, b) => a + b, 0);
      results = { totals, totalVotes };
    }
    return {
      hasQuestion,
      currentQuestion: hasQuestion ? {
        id: state.currentQuestion.id,
        text: state.currentQuestion.text,
        options: state.currentQuestion.options,
        timeLimitSec: state.currentQuestion.timeLimitSec,
        startedAtMs: state.currentQuestion.startedAtMs
      } : null,
      results,
      studentCount: Object.keys(state.students).length,
      history: state.history.slice(0, 10) // Limit to last 10 for memory
    };
  }

  function registerTeacher(socketId) {
    if (state.teacherSocketId && state.teacherSocketId !== socketId) {
      throw new Error('Teacher already registered'); // Only one teacher
    }
    state.teacherSocketId = socketId;
    console.log('Teacher registered:', socketId);
  }

  function unregisterTeacher(socketId) {
    if (state.teacherSocketId === socketId) {
      state.teacherSocketId = null;
      console.log('Teacher unregistered');
    }
  }

  function registerStudent(socketId, name) {
    // Enforce unique names
    if (state.studentNames.has(name)) {
      throw new Error('Name already taken by another student');
    }
    state.studentNames.add(name);
    state.students[socketId] = { name, hasAnswered: false };
    broadcastState();
    console.log(`Student joined: ${name} (socket: ${socketId}). Total: ${Object.keys(state.students).length}`);
  }

  function unregisterStudent(socketId) {
    const student = state.students[socketId];
    if (student) {
      state.studentNames.delete(student.name); // Remove unique name
      delete state.students[socketId];
      console.log(`Student left: ${student.name} (socket: ${socketId})`);
    }
    broadcastState();
  }

  function canAskNewQuestion() {
    if (!state.currentQuestion) return true;
    // Only allow if all current students have answered
    const qid = state.currentQuestion.id;
    const subs = state.submissions[qid] || {};
    const totalStudents = Object.keys(state.students).length;
    const totalAnswers = Object.keys(subs).length;
    return totalStudents === 0 || totalAnswers >= totalStudents; // Allow if no students
  }

  function clearTimer() {
    if (questionTimer) {
      clearTimeout(questionTimer);
      questionTimer = null;
    }
  }

  function endCurrentQuestion(teacherSocketId = null) {
    // Protect with teacher check if provided
    if (teacherSocketId && state.teacherSocketId !== teacherSocketId) {
      throw new Error('Unauthorized: Only teacher can end question');
    }
    clearTimer();
    if (!state.currentQuestion) return;
    // Push to history (unshift for recent-first, limit to 10)
    const q = state.currentQuestion;
    const qid = q.id;
    const counts = q.options.map((_, idx) => (state.answers[qid]?.[idx] || 0));
    state.history.unshift({
      id: qid,
      text: q.text,
      options: q.options,
      results: counts,
      startedAtMs: q.startedAtMs,
      timeLimitSec: q.timeLimitSec
    });
    if (state.history.length > 10) state.history.pop(); // Limit size
    state.currentQuestion = null;
    broadcastState();
    console.log('Question ended:', qid);
  }

  function askQuestion(teacherSocketId, { text, options, timeLimitSec }) {
    // Protect teacher-only action
    if (state.teacherSocketId !== teacherSocketId) {
      throw new Error('Unauthorized: Only teacher can ask questions');
    }
    if (!canAskNewQuestion()) {
      throw new Error('Cannot ask a new question yet (wait for all to answer or timeout)');
    }
    // Sanitize inputs
    const sanitizedText = String(text || '').trim().slice(0, 200);
    if (!sanitizedText) throw new Error('Question text is required');
    const sanitizedOptions = (options || []).map(opt => String(opt).trim()).filter(opt => opt.length > 0);
    if (sanitizedOptions.length < 2) {
      throw new Error('Need at least 2 non-empty options');
    }
    const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`; // Unique ID
    const clampedTime = Math.min(Math.max(timeLimitSec || 60, 5), 300); // 5-300s
    state.currentQuestion = {
      id,
      text: sanitizedText,
      options: sanitizedOptions,
      timeLimitSec: clampedTime,
      startedAtMs: Date.now()
    };
    state.answers[id] = {};
    state.submissions[id] = {};
    // Reset student flags
    Object.keys(state.students).forEach((sid) => {
      state.students[sid].hasAnswered = false;
    });

    clearTimer();
    questionTimer = setTimeout(() => {
      endCurrentQuestion();
    }, clampedTime * 1000);

    broadcastState();
    console.log(`Question asked by teacher: ${id} (${sanitizedText})`);
    // Optional: Periodic timer broadcast (uncomment if frontend needs server ticks)
    // const timerInterval = setInterval(() => {
    //   if (state.currentQuestion) io.emit('timer:tick', { timeLeft: Math.max(0, clampedTime - (Date.now() - state.currentQuestion.startedAtMs) / 1000) });
    // }, 1000);
    // clearInterval(timerInterval); // Clear on end (implement in endCurrentQuestion)
  }

  function submitAnswer(socketId, optionIndex) {
    if (!state.currentQuestion) {
      console.log('Submit ignored: No active question');
      return;
    }
    const qid = state.currentQuestion.id;
    if (state.submissions[qid][socketId] !== undefined) {
      console.log('Submit ignored: Already answered');
      return; // Ignore duplicates
    }
    const idx = Number(optionIndex);
    if (Number.isNaN(idx) || idx < 0 || idx >= state.currentQuestion.options.length) {
      console.log('Submit ignored: Invalid option index');
      return;
    }

    state.submissions[qid][socketId] = idx;
    state.answers[qid][idx] = (state.answers[qid][idx] || 0) + 1;
    if (state.students[socketId]) {
      state.students[socketId].hasAnswered = true;
    }
    console.log(`Answer submitted: socket ${socketId} chose option ${idx}`);

    // If all answered, end immediately
    if (canAskNewQuestion()) {
      endCurrentQuestion();
    } else {
      broadcastState();
    }
  }

  // Good-to-Have - Teacher removes a student
  function removeStudent(teacherSocketId, targetSocketId) {
    if (state.teacherSocketId !== teacherSocketId) {
      throw new Error('Unauthorized: Only teacher can remove students');
    }
    if (!state.students[targetSocketId]) {
      throw new Error('Student not found');
    }
    unregisterStudent(targetSocketId);
    // Optionally disconnect the socket: io.to(targetSocketId).disconnect(true);
    console.log(`Student removed by teacher: ${targetSocketId}`);
  }

  function resetAll(teacherSocketId) {
    // Protect teacher-only
    if (state.teacherSocketId !== teacherSocketId) {
      throw new Error('Unauthorized: Only teacher can reset');
    }
    clearTimer();
    state.studentNames.clear(); // Clear unique names
    state = createEmptyState();
    broadcastState();
    console.log('Full poll reset by teacher');
  }

  return {
    registerTeacher,
    unregisterTeacher,
    registerStudent,
    unregisterStudent,
    askQuestion, // Now takes teacherSocketId as first param
    submitAnswer,
    canAskNewQuestion,
    getPublicState,
    endCurrentQuestion, // Now takes optional teacherSocketId
    resetAll, // Now takes teacherSocketId
    removeStudent // Good-to-Have
  };
}

module.exports = { createPollManager };