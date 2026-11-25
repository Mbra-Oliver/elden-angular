import { Component, HostListener, OnDestroy, inject, signal } from '@angular/core';
import { AudioEngineService } from '../../lib/audio/audio-engine.service';
import { SignatureSfx } from '../../lib/audio/signature-sfx';

const KEY = 'terre-rouge.epigraph.v1';

@Component({
  selector: 'app-epigraph',
  templateUrl: './epigraph.component.html',
  styleUrl: './epigraph.component.css',
})
export class EpigraphComponent implements OnDestroy {
  private readonly audio = inject(AudioEngineService);
  private readonly signature = inject(SignatureSfx);
  readonly visible = signal(!seen());
  private timer = 0;

  constructor() {
    if (this.visible()) this.timer = window.setTimeout(() => this.dismiss(), 15000);
  }

  ngOnDestroy() {
    window.clearTimeout(this.timer);
  }

  @HostListener('click')
  @HostListener('keydown')
  dismiss() {
    if (!this.visible()) return;
    window.clearTimeout(this.timer);
    this.audio.unlock();
    this.signature.epigraph();
    try { localStorage.setItem(KEY, '1'); } catch { return; }
    this.visible.set(false);
  }
}

function seen() {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}
