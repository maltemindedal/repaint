/**
 * Whole-window drag-and-drop for `.glb` / `.gltf` files, plus a `.json` path so
 * you can drop an exported settings file back in.
 *
 * Uses a counter rather than dragenter/dragleave pairs because leaving a child
 * element fires `dragleave` on the parent and would flicker the overlay.
 */
export class DropZone {
  private depth = 0;

  constructor(
    private overlay: HTMLElement,
    private onFile: (file: File) => void,
  ) {
    window.addEventListener('dragenter', this.onDragEnter);
    window.addEventListener('dragover', this.onDragOver);
    window.addEventListener('dragleave', this.onDragLeave);
    window.addEventListener('drop', this.onDrop);
  }

  private onDragEnter = (event: DragEvent): void => {
    if (!hasFiles(event)) return;
    this.depth++;
    this.overlay.classList.add('visible');
  };

  private onDragOver = (event: DragEvent): void => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  };

  private onDragLeave = (event: DragEvent): void => {
    if (!hasFiles(event)) return;
    this.depth = Math.max(0, this.depth - 1);
    if (this.depth === 0) this.overlay.classList.remove('visible');
  };

  private onDrop = (event: DragEvent): void => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    this.depth = 0;
    this.overlay.classList.remove('visible');
    const file = event.dataTransfer?.files?.[0];
    if (file) this.onFile(file);
  };
}

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}
