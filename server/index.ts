import express from 'express';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { db } from './db.js';

if (!process.env.APP_ORIGIN) throw new Error('請設定 APP_ORIGIN');
const app = createApp();
const clientRoot = fileURLToPath(new URL('../client/', import.meta.url));
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(clientRoot, { index: false }));
  app.get('/{*path}', (_req, res) => res.sendFile('index.html', { root: clientRoot }));
}
const server = app.listen(Number(process.env.PORT ?? 3001), '0.0.0.0', () =>
  console.log(`Sincey API：http://localhost:${process.env.PORT ?? 3001}`),
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () =>
    server.close(() => {
      void db.$disconnect().finally(() => process.exit(0));
    }),
  );
