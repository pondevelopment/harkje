import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Output,
  input,
  signal,
} from '@angular/core';
import { LucideAngularModule, Wand, FileJson, Sheet, Layers } from 'lucide-angular';
import { OrgNode } from '../../models/org.types';
import { GeneratorTabComponent } from './generator-tab.component';
import { JsonEditorTabComponent } from './json-editor-tab.component';
import {
  CsvEditorTabComponent,
  CsvProcessingProgress,
} from './csv-editor-tab.component';

type Tab = 'ai' | 'json' | 'csv';

/**
 * Sidebar panel: hosts the Generator / List Editor / CSV tabs and the footer.
 * Receives the current tree data and emits a new root when the user generates
 * or edits a structure.
 */
@Component({
  selector: 'app-input-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="panel">
      <header class="panel-header">
        <h1>
          <lucide-icon [img]="Layers" [size]="24" />
          Harkje
        </h1>
        <p>Visualize your team structure effortlessly.</p>
      </header>

      <nav class="tabs">
        <button
          type="button"
          class="tab"
          [class.tab--active]="activeTab() === 'ai'"
          (click)="activeTab.set('ai')"
        >
          <lucide-icon [img]="Wand" [size]="16" />
          Generator
        </button>
        <button
          type="button"
          class="tab"
          [class.tab--active]="activeTab() === 'json'"
          (click)="activeTab.set('json')"
        >
          <lucide-icon [img]="FileJson" [size]="16" />
          List Editor
        </button>
        <button
          type="button"
          class="tab"
          [class.tab--active]="activeTab() === 'csv'"
          (click)="activeTab.set('csv')"
        >
          <lucide-icon [img]="Sheet" [size]="16" />
          CSV
        </button>
      </nav>

      <div class="panel-body">
        @if (activeTab() === 'ai') {
          <app-generator-tab (dataChange)="dataChange.emit($event)" />
        } @else if (activeTab() === 'json') {
          <app-json-editor-tab
            [currentData]="currentData()"
            (dataChange)="dataChange.emit($event)"
          />
        } @else {
          <app-csv-editor-tab
            [currentData]="currentData()"
            (dataChange)="csvDataChange.emit($event)"
            (processingProgress)="csvProcessingProgress.emit($event)"
            (processingAbort)="csvProcessingAbort.emit()"
          />
        }
      </div>

      <footer class="panel-footer">
        <p>
          Powered by random generation &amp; D3.js •
          <a
            href="https://github.com/pondevelopment/harkje/"
            target="_blank"
            rel="noreferrer"
            >Source</a
          >
        </p>
      </footer>
    </div>
  `,
  imports: [LucideAngularModule, GeneratorTabComponent, JsonEditorTabComponent, CsvEditorTabComponent],
  styleUrls: ['./input-panel.component.scss'],
})
export class InputPanelComponent {
  @Output() dataChange = new EventEmitter<OrgNode>();
  @Output() csvDataChange = new EventEmitter<OrgNode>();
  @Output() csvProcessingProgress = new EventEmitter<CsvProcessingProgress>();
  @Output() csvProcessingAbort = new EventEmitter<void>();
  readonly currentData = input<OrgNode | null>(null);
  readonly activeTab = signal<Tab>('ai');

  // Icon data exposed to the template for [img] bindings.
  readonly Layers = Layers;
  readonly Wand = Wand;
  readonly FileJson = FileJson;
  readonly Sheet = Sheet;
}
