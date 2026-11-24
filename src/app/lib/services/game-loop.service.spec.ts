import { TestBed } from '@angular/core/testing';

import { GameLoopService } from './game-loop.service';

describe('GameLoopService', () => {
  let service: GameLoopService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(GameLoopService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('holds simulation for the requested milliseconds across unequal frame durations', () => {
    const tick = jasmine.createSpy('update');
    service.onUpdate(tick);
    service.start();
    service.freeze(55);
    service.update(16);
    service.update(29);
    expect(tick).not.toHaveBeenCalled();
    service.update(18);
    expect(tick).toHaveBeenCalledOnceWith(0.008);
    service.stop();
  });
});
