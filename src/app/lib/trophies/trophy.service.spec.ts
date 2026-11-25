import { TrophyService } from './trophy.service';

describe('TrophyService', () => {
  beforeEach(() => localStorage.removeItem('trophees'));

  it('unlocks a trophy once, announces it and keeps it on the device', () => {
    const trophies = new TrophyService();
    expect(trophies.unlock('eternel')).toBeTrue();
    expect(trophies.toast()?.name).toBe('L’Éternel');
    expect(trophies.unlock('eternel')).toBeFalse();
    expect(new TrophyService().has('eternel')).toBeTrue();
  });
});
