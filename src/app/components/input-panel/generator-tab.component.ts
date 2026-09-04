import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Output,
  computed,
  inject,
  signal,
} from '@angular/core';
import { LucideAngularModule, Loader, Wand, Dices } from 'lucide-angular';
import { OrgNode } from '../../models/org.types';
import {
  ORG_SIZE_RANGES,
  ORG_SIZES,
  OrgGeneratorService,
  OrgSize,
} from '../../core/org-generator.service';
import { OrgTreeService } from '../../core/org-tree.service';

/**
 * "Generator" tab: one-click random org generation by size.
 * Deterministic per (size, theme, runId) via OrgGeneratorService.
 */
@Component({
  selector: 'app-generator-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let loading = isLoading();
    <div class="howto">
      <h2>How to use Harkje</h2>
      <ul>
        <li>Use <strong>Generator</strong> to create a quick example org by size.</li>
        <li>
          Use <strong>List Editor</strong> (JSON) or <strong>CSV</strong> to
          paste/edit your own org data.
        </li>
        <li>
          In the chart: scroll to zoom, drag to pan, click a manager to
          collapse/expand their team.
        </li>
        <li>
          Use <strong>Aspect Ratio</strong> to influence how wide vs. tall the
          layout tries to be (lower = taller/narrower, higher = wider/flatter).
        </li>
        <li>
          Use <strong>Download image</strong> (top-right) to export a PNG for
          slides.
        </li>
      </ul>
      <p class="privacy">Privacy: no data is uploaded — everything stays local in your browser.</p>
    </div>

    <div class="generator">
      <div class="generator-header">
        <div class="generator-icon"><lucide-icon [img]="Dices" [size]="16" /></div>
        <h2>Generator</h2>
      </div>

      <div class="generator-body">
        <div>
          <label class="field-label">Organization Size</label>
          <div class="size-grid">
            @for (s of sizes; track s) {
              <button
                type="button"
                class="size-btn"
                [class.size-btn--active]="quickSize() === s"
                (click)="quickSize.set(s)"
              >
                {{ s }}
              </button>
            }
          </div>
          <p class="size-hint">
            ~{{ selectedSizeRange().min }}–{{ selectedSizeRange().max }} nodes
          </p>
        </div>

        <button
          type="button"
          class="generate-btn"
          [disabled]="loading"
          (click)="handleGenerate()"
        >
          @if (loading) {
            <lucide-icon [img]="Loader" [size]="20" class="spin" />
          } @else {
            <lucide-icon [img]="Wand" [size]="20" />
          }
          Generate Random Org
        </button>
      </div>
    </div>
  `,
  imports: [LucideAngularModule],
  styleUrls: ['./generator-tab.component.scss'],
})
export class GeneratorTabComponent {
  @Output() dataChange = new EventEmitter<OrgNode>();

  // Icon data exposed to the template for [img] bindings.
  readonly Dices = Dices;
  readonly Loader = Loader;
  readonly Wand = Wand;

  private readonly generator = inject(OrgGeneratorService);
  private readonly treeService = inject(OrgTreeService);

  readonly isLoading = signal(false);
  readonly quickSize = signal<OrgSize>('M');
  readonly sizes = ORG_SIZES;
  readonly selectedSizeRange = computed(() => ORG_SIZE_RANGES[this.quickSize()]);

  private runId = 0;

  async handleGenerate(): Promise<void> {
    this.isLoading.set(true);
    try {
      const flatNodes = await this.generator.generateRandomOrgStructure(
        this.quickSize(),
        'Default',
        ++this.runId,
      );
      if (!Array.isArray(flatNodes) || flatNodes.length === 0) {
        throw new Error('Generator returned empty or invalid data structure.');
      }
      const { root: newRoot } = this.treeService.buildTree(flatNodes);
      if (newRoot) {
        this.dataChange.emit(newRoot);
      }
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error(err);
    } finally {
      this.isLoading.set(false);
    }
  }
}
