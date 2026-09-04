import {
  ChangeDetectorRef,
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Output,
  inject,
  signal,
  effect,
  input,
} from '@angular/core';
import { OrgNode } from '../../models/org.types';
import { OrgTreeService } from '../../core/org-tree.service';
import { CsvParserService } from '../../core/csv-parser.service';

export interface CsvProcessingProgress {
  readonly label: string;
  readonly value: number;
}

/**
 * "CSV" tab: paste/edit CSV (user, manager, title, department, details) and
 * rebuild the tree with full validation (header detection, cycle detection,
 * duplicate-name detection, single-root enforcement).
 */
@Component({
  selector: 'app-csv-editor-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let err = error();
    @let warningMessages = warnings();
    <div class="editor">
      <label class="editor-label">Structure Data (CSV)</label>
      <p class="editor-hint">
        Only <code>user</code> and <code>manager</code> are required. Leave
        <code>manager</code> empty (or <code>null</code>) for a top-level group.
      </p>
      <p class="editor-hint">
        Leaf employees (who manage nobody) need no special handling — just
        include them as normal rows with a manager.
      </p>
      <p class="editor-hint">
        Managers without their own row are added automatically. Separate
        top-level groups are connected under a generated organization root.
      </p>
      <p class="editor-hint">
        Empty values are allowed for <code>title</code>/<code>department</code>/<code>details</code>.
        <code>user</code> must be filled.
      </p>
      <p class="editor-hint">
        Example: <code>Jane Doe,,CEO,Executive,"Leads the company"</code>
      </p>
      <textarea
        class="editor-textarea editor-textarea--csv"
        [value]="csvInput()"
        (input)="csvInput.set($any($event.target).value)"
        spellcheck="false"
        placeholder='\nuser,manager,title,department,details\nJane Doe,,CEO,Executive,"Leads the company"\nJohn Smith,Jane Doe,Engineering Manager,Engineering,"Runs the platform team"'
      ></textarea>
      <button
        type="button"
        class="update-btn"
        [disabled]="isProcessing()"
        (click)="handleUpdate()"
      >
        Update Visualization
      </button>
    </div>
    @if (err) {
      <div class="error-box">
        <strong>Error:</strong> {{ err }}
      </div>
    }
    @if (warningMessages.length > 0) {
      <div class="warning-box">
        <strong>Import warnings:</strong>
        <ul>
          @for (message of warningMessages; track $index) {
            <li>{{ message }}</li>
          }
        </ul>
      </div>
    }
  `,
  styleUrls: ['./input-panel-shared.scss'],
})
export class CsvEditorTabComponent {
  @Output() dataChange = new EventEmitter<OrgNode>();
  @Output() processingProgress = new EventEmitter<CsvProcessingProgress>();
  @Output() processingAbort = new EventEmitter<void>();

  private readonly treeService = inject(OrgTreeService);
  private readonly csv = inject(CsvParserService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  readonly currentData = input<OrgNode | null>(null);

  readonly csvInput = signal('');
  readonly error = signal<string | null>(null);
  readonly warnings = signal<readonly string[]>([]);
  readonly isProcessing = signal(false);

  constructor() {
    // Sync CSV text when the chart updates (e.g. from generator).
    effect(() => {
      const data = this.currentData();
      if (data) {
        const flat = this.treeService.flattenTree(data);
        this.csvInput.set(this.csv.flatNodesToCsv(flat));
      }
    });
  }

  async handleUpdate(): Promise<void> {
    if (this.isProcessing()) return;
    this.isProcessing.set(true);
    this.updateProgress('Preparing CSV...', 10);

    try {
      await this.waitForPaint();

      this.updateProgress('Validating CSV...', 30);
      await this.waitForPaint();
      const flatNodes = this.csv.buildFlatNodesFromCsv(this.csvInput());

      this.updateProgress('Building hierarchy...', 50);
      await this.waitForPaint();
      const { root: newRoot, warnings: treeWarnings } = this.treeService.buildTree(flatNodes);
      if (newRoot) {
        this.updateProgress('Computing and rendering chart...', 70);
        await this.waitForPaint();
        this.dataChange.emit(newRoot);
        this.error.set(null);
        this.warnings.set([...this.csv.warnings, ...treeWarnings]);
      } else {
        this.processingAbort.emit();
        this.warnings.set([...this.csv.warnings, ...treeWarnings]);
        this.error.set(
          'Could not build tree from CSV. Ensure exactly one row has an empty manager (the root).',
        );
      }
    } catch (e: any) {
      this.processingAbort.emit();
      this.warnings.set([]);
      this.error.set(e?.message ? String(e.message) : 'Invalid CSV format.');
    } finally {
      this.isProcessing.set(false);
    }
  }

  private waitForAnimationFrame(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  private async waitForPaint(): Promise<void> {
    await this.waitForAnimationFrame();
    await this.waitForAnimationFrame();
  }

  private updateProgress(label: string, value: number): void {
    this.processingProgress.emit({ label, value });
    this.changeDetector.markForCheck();
  }
}
