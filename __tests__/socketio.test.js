const { createServer } = require('http');
const { Server } = require('socket.io');
const Client = require('socket.io-client');
const express = require('express');
const registerHandlers = require('../sockets');
const { createPollManager } = require('../pollManager');

function waitFor(emitter, event) {
  return new Promise((resolve) => emitter.once(event, resolve));
}

describe('socket.io flows', () => {
  let io, httpServer, addr, url;

  beforeAll((done) => {
    const app = express();
    httpServer = createServer(app);
    io = new Server(httpServer, { cors: { origin: '*' } });
    const pm = createPollManager(io);
    io.on('connection', (socket) => registerHandlers(io, socket, pm));
    httpServer.listen(() => {
      addr = httpServer.address();
      url = `http://localhost:${addr.port}`;
      done();
    });
  });

  afterAll((done) => {
    io.close();
    httpServer.close(done);
  });

  test('teacher asks, students join and answer', async () => {
    const teacher = Client(url, { transports: ['websocket'] });
    await waitFor(teacher, 'connect');
    teacher.emit('teacher:join');
    await waitFor(teacher, 'poll:state');

    const s1 = Client(url, { transports: ['websocket'] });
    const s2 = Client(url, { transports: ['websocket'] });
    await Promise.all([waitFor(s1, 'connect'), waitFor(s2, 'connect')]);
    s1.emit('student:join', 'A');
    s2.emit('student:join', 'B');
    await Promise.all([waitFor(s1, 'poll:state'), waitFor(s2, 'poll:state')]);

    teacher.emit('teacher:ask', { text: 'Q', options: ['a', 'b'], timeLimitSec: 60 });
    await waitFor(teacher, 'poll:state');

    s1.emit('student:answer', 0);
    await waitFor(teacher, 'poll:state');
    s2.emit('student:answer', 1);
    const finalState = await waitFor(teacher, 'poll:state');

    expect(finalState.hasQuestion).toBe(false);

    teacher.close();
    s1.close();
    s2.close();
  }, 15000);
});


