import request from 'supertest';
import { app } from '..';

test('GET /health returns ok:true', async () => {
  const res = await request(app).get('/health');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ ok: true });
});


