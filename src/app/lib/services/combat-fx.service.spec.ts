import { TestBed } from '@angular/core/testing';
import { CombatFxService, type FxEvent } from './combat-fx.service';

describe('CombatFxService', () => {
  let service: CombatFxService;
  const drain = () => {
    const events: FxEvent[] = [];
    service.drain((event) => events.push(event));
    return events;
  };

  beforeEach(() => {
    service = TestBed.inject(CombatFxService);
    service.reset();
  });

  it('secoue horizontalement sur une taille et verticalement sur un estoc', () => {
    const base = { x: 0, y: 0, height: 20, dirX: 1, dirY: 0, material: 'flesh' as const, strength: 1, target: 'boss' as const };
    service.hit({ ...base, style: 'slash' });
    service.hit({ ...base, style: 'thrust' });
    const shakes = drain().filter((e) => e.type === 'shake');
    expect(shakes.map((e) => e.type === 'shake' && e.axis)).toEqual(['horizontal', 'vertical']);
  });

  it('vide la file après lecture et la borne sans vue 3D', () => {
    for (let i = 0; i < 200; i++) service.mark(i, 0, 10, 'crack');
    expect(drain().length).toBeLessThanOrEqual(48);
    expect(drain().length).toBe(0);
  });

  it('reste muet tant que le moteur audio n’est pas déverrouillé', () => {
    expect(() => service.parry(0, 0)).not.toThrow();
  });
});
