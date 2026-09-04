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
import { FlatNode, OrgNode } from '../../models/org.types';
import { OrgTreeService } from '../../core/org-tree.service';

/**
 * "List Editor" tab: pastes/edits the flat JSON array and rebuilds the tree.
 */
@Component({
  selector: 'app-json-editor-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let err = error();
    @let warningMessages = warnings();
    <div class="editor">
      <label class="editor-label">Structure Data (Flat Array)</label>
      <p class="editor-hint">
        Edit the array below. Use <code>"parentId": "null"</code> for the root node.
      </p>
      <textarea
        class="editor-textarea editor-textarea--json"
        [value]="jsonInput()"
        (input)="jsonInput.set($any($event.target).value)"
        spellcheck="false"
        placeholder='[{"id": "1", "parentId": "null", "name": "CEO", ...}]'
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
export class JsonEditorTabComponent {
  @Output() dataChange = new EventEmitter<OrgNode>();

  private readonly treeService = inject(OrgTreeService);
  readonly currentData = input<OrgNode | null>(null);

  readonly jsonInput = signal('');
  readonly error = signal<string | null>(null);
  readonly warnings = signal<readonly string[]>([]);

  constructor() {
    // Sync JSON editor when the chart updates (e.g. from generator).
    effect(() => {
      const data = this.currentData();
      if (data) {
        const flat = this.treeService.flattenTree(data);
        this.jsonInput.set(JSON.stringify(flat, null, 2));
      }
    });
  }

  handleUpdate(): void {
    try {
      const parsed = JSON.parse(this.jsonInput()) as FlatNode[];
      if (!Array.isArray(parsed)) {
        throw new Error('Input must be an array of employees.');
      }
      const { root: newRoot, warnings: treeWarnings } = this.treeService.buildTree(parsed);
      if (newRoot) {
        this.dataChange.emit(newRoot);
        this.error.set(null);
        this.warnings.set(treeWarnings);
      } else {
        this.error.set(
          'Could not build tree. Ensure exactly one node has parentId: null (the CEO/Root).',
        );
        this.warnings.set(treeWarnings);
      }
    } catch (e: any) {
      this.error.set('Invalid JSON format: ' + e.message);
      this.warnings.set([]);
    }
  }
}
