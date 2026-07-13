import {
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
    <div class="editor">
      <label class="editor-label">Structure Data (CSV)</label>
      <p class="editor-hint">
        Only <code>user</code> and <code>manager</code> are required. Leave
        <code>manager</code> empty (or <code>null</code>) for the single root.
      </p>
      <p class="editor-hint">
        Leaf employees (who manage nobody) need no special handling — just
        include them as normal rows with a manager.
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
      <button type="button" class="update-btn" (click)="handleUpdate()">
        Update Visualization
      </button>
    </div>
    @if (err) {
      <div class="error-box">
        <strong>Error:</strong> {{ err }}
      </div>
    }
  `,
  styleUrls: ['./input-panel-shared.scss'],
})
export class CsvEditorTabComponent {
  @Output() dataChange = new EventEmitter<OrgNode>();

  private readonly treeService = inject(OrgTreeService);
  private readonly csv = inject(CsvParserService);
  readonly currentData = input<OrgNode | null>(null);

  readonly csvInput = signal('');
  readonly error = signal<string | null>(null);

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

  handleUpdate(): void {
    try {
      const flatNodes = this.csv.buildFlatNodesFromCsv(this.csvInput());
      const newRoot = this.treeService.buildTree(flatNodes);
      if (newRoot) {
        this.dataChange.emit(newRoot);
        this.error.set(null);
      } else {
        this.error.set(
          'Could not build tree from CSV. Ensure exactly one row has an empty manager (the root).',
        );
      }
    } catch (e: any) {
      this.error.set(e?.message ? String(e.message) : 'Invalid CSV format.');
    }
  }
}
