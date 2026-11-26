import { TargetLock, type LockEnemy, type LockView } from './target-lock';

const view: LockView = { px: 0, py: 0, heading: 0 };
const enemy = (id: number, x: number, y: number, extra: Partial<LockEnemy> = {}): LockEnemy => ({
  id, kind: 'lancier', x, y, state: 'chase', engaged: true, move: null, aimX: 0, aimY: 1, ...extra,
});

describe('TargetLock', () => {
  it('préfère un ennemi qui attaque dans le dos à un ennemi passif en face', () => {
    const lock = new TargetLock();
    const front = enemy(0, 0, 120);
    const behind = enemy(1, 0, -60, { state: 'windup', move: 'spear' });
    expect(lock.acquire([front, behind], view)).toBeTrue();
    expect(lock.id).toBe(1);
  });

  it('verrouille l’agresseur au coup reçu', () => {
    const lock = new TargetLock();
    const front = enemy(0, 0, 80);
    const shooter = enemy(1, 300, -250, { kind: 'tireur' });
    lock.noteHit(1);
    lock.acquireAttacker([front, shooter], view);
    expect(lock.id).toBe(1);
  });

  it('passe à la menace suivante quand la cible meurt', () => {
    const lock = new TargetLock();
    const a = enemy(0, 0, 80);
    const b = enemy(1, 60, 100);
    lock.acquire([a, b], view);
    a.state = 'dead';
    expect(lock.update(0.016, [a, b], view)?.id).toBe(1);
  });

  it('lâche la cible hors de portée après un court délai', () => {
    const lock = new TargetLock();
    const a = enemy(0, 0, 80);
    lock.acquire([a], view);
    a.y = 600;
    expect(lock.update(0.1, [a], view)).not.toBeNull();
    for (let i = 0; i < 5; i++) lock.update(0.1, [a], view);
    expect(lock.id).toBeNull();
  });

  it('se tourne vers un coup qui se prépare dans le dos si la cible ne fait rien', () => {
    const lock = new TargetLock();
    const far = enemy(0, 0, 200);
    const back = enemy(1, 0, -50);
    lock.acquire([far, back], view);
    expect(lock.id).toBe(0);
    for (let i = 0; i < 120; i++) lock.update(0.016, [far, back], view); // fin du répit manuel
    back.state = 'windup';
    back.move = 'spear';
    expect(lock.update(0.016, [far, back], view)?.id).toBe(1);
  });

  it('ne quitte pas une cible qui attaque', () => {
    const lock = new TargetLock();
    const a = enemy(0, 0, 60, { state: 'windup', move: 'spear' });
    const b = enemy(1, 0, -40, { state: 'windup', move: 'slash', kind: 'pilleur' });
    lock.id = 0;
    expect(lock.update(2, [a, b], view)?.id).toBe(0);
  });

  it('change de côté avec retour en bout de file', () => {
    const lock = new TargetLock();
    const mid = enemy(0, 0, 100);
    const left = enemy(1, 80, 100);
    const right = enemy(2, -80, 100);
    lock.id = 0;
    lock.cycle(1, [mid, left, right], view);
    expect(lock.id).toBe(2);
    lock.cycle(1, [mid, left, right], view);
    expect(lock.id).toBe(1);
  });
});
