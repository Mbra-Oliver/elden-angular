import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { resolve } from 'node:path';
import express from 'express';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { DuelRoom } from './duel-room';

const port = Number(process.env.PORT ?? 3001);
const dist = resolve(process.cwd(), 'dist/elden-angular/browser');

/** Adresses IPv4 du réseau local (Wi-Fi, Ethernet) : celles que l'autre appareil peut joindre. */
function lanAddresses(): string[] {
  const found: string[] = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) found.push(entry.address);
    }
  }
  // Les réseaux domestiques (192.168.x, 10.x) d'abord, les ponts virtuels ensuite.
  return found.sort((a, b) => Number(!a.startsWith('192.168.')) - Number(!b.startsWith('192.168.')));
}

const app = express();

app.get('/duel-info', (_request, response) => {
  response.set('Cache-Control', 'no-store');
  response.json({ port, addresses: lanAddresses().map((address) => `http://${address}:${port}`) });
});

app.use(express.static(dist, { index: false }));
app.use((request, response) => {
  if (request.method !== 'GET') {
    response.status(404).end();
    return;
  }
  // index.html jamais mis en cache : un nouveau build est pris dès le rechargement.
  response.set('Cache-Control', 'no-store');
  response.sendFile(resolve(dist, 'index.html'));
});

// Le transport WebSocket se branche sur le serveur HTTP d'Express : une seule
// adresse sert le jeu, la mise en relation (/matchmake) et les WebSockets.
const gameServer = new Server({
  transport: new WebSocketTransport({ server: createServer(app) }),
  greet: false,
});

gameServer.define('duel', DuelRoom).filterBy(['mode', 'code']);

void gameServer.listen(port, '0.0.0.0').then(() => {
  const lines = [
    '',
    "  Duel d'Honneur : serveur prêt",
    '',
    `  Sur cet ordinateur :   http://localhost:${port}`,
    ...lanAddresses().map((address) => `  Sur le même Wi-Fi :    http://${address}:${port}`),
    '',
  ];
  if (!existsSync(resolve(dist, 'index.html'))) {
    lines.push('  ⚠ Jeu non compilé : lance « npm run start:duel » (build + serveur).', '');
  }
  lines.push('  Ctrl+C pour arrêter.', '');
  process.stdout.write(lines.join('\n'));
});
