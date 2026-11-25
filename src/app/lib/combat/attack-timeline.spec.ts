import { AttackEventTracker, attackFrame } from './attack-timeline';

describe('attack timeline', () => {
  const attack = { damage: 10, staminaCost: 5, duration: 300, range: 1, windup: 100, active: 50, chain: 200 };

  it('cuts the attack into windup, active and recover windows', () => {
    expect(attackFrame(attack, 50)).toEqual({ segment: 'windup', t: 0.5, hitbox: false, canChain: false });
    expect(attackFrame(attack, 125)).toEqual({ segment: 'active', t: 0.5, hitbox: true, canChain: false });
    const recover = attackFrame(attack, 225);
    expect(recover.segment).toBe('recover');
    expect(recover.hitbox).toBeFalse();
    expect(recover.canChain).toBeTrue();
  });

  it('emits each event once, in order', () => {
    const tracker = new AttackEventTracker();
    const seen: string[] = [];
    for (const t of [0, 60, 110, 140, 160, 290]) seen.push(...tracker.update('light1', attackFrame(attack, t)));
    seen.push(...tracker.update(null, null));
    expect(seen).toEqual(['windup-start', 'active-start', 'active-end', 'end']);
  });

  it('still fires active-start when a frame skips the whole active window', () => {
    const tracker = new AttackEventTracker();
    const seen = [...tracker.update('heavy', attackFrame(attack, 90)), ...tracker.update('heavy', attackFrame(attack, 160))];
    expect(seen).toEqual(['windup-start', 'active-start', 'active-end']);
  });
});
