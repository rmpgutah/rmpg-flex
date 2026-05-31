import { Hono } from 'hono';
import type { Env } from '../types';

const clients = new Hono<Env>();

clients.get('/', (c) => c.json([]));
clients.get('/:id', (c) => c.json({}));
clients.post('/', (c) => c.json({ id: 0 }, 201));
clients.put('/:id', (c) => c.json({}));
clients.delete('/:id', (c) => c.json({}));

export default clients;
