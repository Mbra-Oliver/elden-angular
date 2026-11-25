import { resolve } from 'node:path';
import express from 'express';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { DuelRoom } from './duel-room';

const port = Number(process.env.PORT ?? 3001);
const app = express();
const dist = resolve(process.cwd(), 'dist/elden-angular/browser');

app.use(express.static(dist));
app.use((request, response) => {
  if (request.method !== 'GET') {
    response.status(404).end();
    return;
  }
  response.sendFile(resolve(dist, 'index.html'));
});

const gameServer = new Server({
  transport: new WebSocketTransport(),
  express: (application) => {
    application.use(express.static(dist));
    application.use((request, response) => {
      if (request.method !== 'GET') {
        response.status(404).end();
        return;
      }
      response.sendFile(resolve(dist, 'index.html'));
    });
  },
});

gameServer.define('duel', DuelRoom).filterBy(['mode', 'code']);
gameServer.listen(port);

process.stdout.write(`Duel d'Honneur : http://localhost:${port}\n`);
