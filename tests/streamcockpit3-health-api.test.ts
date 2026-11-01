import {expect, it, vi} from 'vitest';
import type {Request, Response} from 'express';
import {createHealthRouter} from '../apps/server/src/streamcockpit-health/index.js';

it('read-only router gates cache access, excludes secrets, and sanitizes failures without sockets', async () => {
  const readSnapshot = vi.fn((): unknown => ({hostId:'fixe', secret:'never-export', observations:{}}));
  const canRead = vi.fn((r: Request) => r.headers.authorization === 'fixture');
  const router = createHealthRouter({canRead, readSnapshot, now:() => 100000});
  const request = (method = 'GET', authorized = true) => new Promise<{status:number; body:unknown; headers:Record<string,string>}>((resolve, reject) => {
    let status = 200;
    const headers: Record<string,string> = {};
    const response = {
      setHeader(key:string, value:string) { headers[key] = value; },
      status(value:number) { status = value; return response; },
      json(body:unknown) { resolve({status, body, headers}); }
    };
    router({method, url:'/', headers:authorized ? {authorization:'fixture'} : {}} as Request,
      response as unknown as Response, error => reject(error ?? Error('Unexpected fallthrough')));
  });
  expect((await request('GET', false)).status).toBe(403); expect(readSnapshot).not.toHaveBeenCalled();
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) expect((await request(method)).status).toBe(405);
  expect(readSnapshot).not.toHaveBeenCalled();
  const response = await request();
  expect(response.headers['Cache-Control']).toBe('no-store'); expect(response.status).toBe(200);
  expect(JSON.stringify(response.body)).not.toContain('never-export'); expect(response.body).toMatchObject({status:'unknown'});
  expect((await request('HEAD')).status).toBe(200);
  readSnapshot.mockImplementation(() => {throw Error('private details');});
  const failed = await request(); expect(failed.status).toBe(503); expect(JSON.stringify(failed.body)).not.toContain('private details');
  canRead.mockImplementation(() => {throw Error('auth details');});
  expect((await request()).status).toBe(403);
});
