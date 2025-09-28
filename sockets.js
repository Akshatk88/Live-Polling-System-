module.exports = function registerSocketHandlers(io, socket, pollManager) {
  console.log(`Socket connected: ${socket.id}`);

  socket.on('teacher:join', () => {
    try {
      pollManager.registerTeacher(socket.id);
      socket.emit('poll:state', pollManager.getPublicState());
      console.log('Teacher joined successfully');
    } catch (e) {
      socket.emit('error:message', e.message);
      console.error('Teacher join error:', e.message);
    }
  });

  socket.on('student:join', (name) => {
    try {
      const safeName = String(name || '').trim().slice(0, 40) || 'Student';
      pollManager.registerStudent(socket.id, safeName);
      socket.emit('poll:state', pollManager.getPublicState());
    } catch (e) {
      socket.emit('error:message', e.message);
      console.error('Student join error:', e.message);
    }
  });

  socket.on('teacher:ask', ({ text, options, timeLimitSec }) => {
    try {
      pollManager.askQuestion(socket.id, { text, options, timeLimitSec });
      socket.emit('success:ask', { message: 'Question asked successfully' });
    } catch (e) {
      socket.emit('error:message', e.message);
      console.error('Ask question error:', e.message);
    }
  });

  socket.on('student:answer', (optionIndex) => {
    try {
      pollManager.submitAnswer(socket.id, optionIndex);
      socket.emit('success:answer', { message: 'Answer submitted' });
    } catch (e) {
      socket.emit('error:message', e.message);
      console.error('Submit answer error:', e.message);
    }
  });

  socket.on('teacher:end', () => {
    try {
      pollManager.endCurrentQuestion(socket.id);
      socket.emit('success:end', { message: 'Question ended' });
    } catch (e) {
      socket.emit('error:message', e.message);
      console.error('End question error:', e.message);
    }
  });

  
  socket.on('teacher:remove', (targetSocketId) => {
    try {
      pollManager.removeStudent(socket.id, targetSocketId);
      socket.emit('success:remove', { socketId: targetSocketId, message: 'Student removed' });
      // Notify removed student (optional)
      io.to(targetSocketId).emit('error:message', 'You were removed from the poll');
    } catch (e) {
      socket.emit('error:message', e.message);
      console.error('Remove student error:', e.message);
    }
  });

  socket.on('teacher:reset', () => {
    try {
      pollManager.resetAll(socket.id);
      socket.emit('success:reset', { message: 'Poll reset' });
    } catch (e) {
      socket.emit('error:message', e.message);
      console.error('Reset error:', e.message);
    }
  });

  // Bonus - Chat functionality
  socket.on('chat:message', ({ message, isTeacher = false }) => {
    try {
      const safeMessage = String(message || '').trim().slice(0, 500);
      if (!safeMessage) return;
      const sender = isTeacher ? 'Teacher' : (pollManager.students?.[socket.id]?.name || 'Unknown');
      io.emit('chat:new', { from: sender, message: safeMessage, timestamp: Date.now() });
      console.log(`Chat: ${sender}: ${safeMessage}`);
    } catch (e) {
      socket.emit('error:message', 'Invalid chat message');
      console.error('Chat error:', e.message);
    }
  });

  socket.on('disconnect', () => {
    try {
      // Try to unregister as teacher first
      pollManager.unregisterTeacher(socket.id);
      // Also try to unregister as student (in case it was both somehow)
      pollManager.unregisterStudent(socket.id);
      console.log(`Socket disconnected: ${socket.id}`);
    } catch (e) {
      console.error('Disconnect error:', e.message);
    }
  });

  // Handle client errors
  socket.on('error', (err) => {
    console.error('Client error:', err);
    socket.emit('error:message', 'Server error occurred');
  });
};