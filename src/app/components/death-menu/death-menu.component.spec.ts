import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DeathMenuComponent } from './death-menu.component';

describe('DeathMenuComponent', () => {
  let component: DeathMenuComponent;
  let fixture: ComponentFixture<DeathMenuComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DeathMenuComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(DeathMenuComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
