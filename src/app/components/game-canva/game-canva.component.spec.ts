import { ComponentFixture, TestBed } from '@angular/core/testing';

import { GameCanvaComponent } from './game-canva.component';

describe('GameCanvaComponent', () => {
  let component: GameCanvaComponent;
  let fixture: ComponentFixture<GameCanvaComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GameCanvaComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(GameCanvaComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
