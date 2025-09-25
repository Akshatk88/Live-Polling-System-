const { createPollManager } = require('../pollManager');

function createFakeIo() {
  return { emit: jest.fn() };
}

describe('pollManager', () => {
  let io, pm;
  beforeEach(() => {
    io = createFakeIo();
    pm = createPollManager(io);
  });

  test('registers students and updates state', () => {
    pm.registerStudent('s1', 'Alice');
    const s = pm.getPublicState();
    expect(s.studentCount).toBe(1);
  });

  test('askQuestion requires at least 2 options', () => {
    expect(() => pm.askQuestion({ text: 'Q', options: ['one'], timeLimitSec: 10 })).toThrow();
  });

  test('askQuestion starts timer and broadcasts', () => {
    pm.registerStudent('s1', 'A');
    pm.askQuestion({ text: 'Q', options: ['a', 'b'], timeLimitSec: 5 });
    const st = pm.getPublicState();
    expect(st.hasQuestion).toBe(true);
    expect(io.emit).toHaveBeenCalledWith('poll:state', expect.any(Object));
  });

  test('submitAnswer tallies and can end when all answered', () => {
    pm.registerStudent('s1', 'A');
    pm.registerStudent('s2', 'B');
    pm.askQuestion({ text: 'Q', options: ['a', 'b'], timeLimitSec: 60 });
    pm.submitAnswer('s1', 0);
    let st = pm.getPublicState();
    expect(st.results.totalVotes).toBe(1);
    pm.submitAnswer('s2', 1);
    st = pm.getPublicState();
    expect(st.hasQuestion).toBe(false);
  });

  test('resetAll clears state', () => {
    pm.registerStudent('s1', 'A');
    pm.resetAll();
    const st = pm.getPublicState();
    expect(st.studentCount).toBe(0);
  });
});


