import { canvasToBlob, createCanvas, decodeBitmap } from '@/capture/canvas';

export type DrawTool = 'select' | 'blur' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'text';

export interface DrawShape {
  id: string;
  tool: DrawTool;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  strokeWidth: number;
  fillColor?: string;
  text?: string;
  fontSize?: number;
}

export interface DrawState {
  shapes: DrawShape[];
  tool: DrawTool;
  color: string;
  strokeWidth: number;
  fillColor: string;
  fontSize: number;
  canUndo: boolean;
  canRedo: boolean;
}

export class DrawManager {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private shapes: DrawShape[] = [];
  private undoStack: DrawShape[][] = [];
  private redoStack: DrawShape[][] = [];
  private currentTool: DrawTool = 'rect';
  private currentColor = '#22c55e';
  private currentFill = 'transparent';
  private currentStrokeWidth = 3;
  private currentFontSize = 20;
  private drawing = false;
  private enabled = true;
  private startX = 0;
  private startY = 0;
  private textInput: HTMLInputElement | null = null;
  private imageWidth: number;
  private imageHeight: number;
  private imageSource: HTMLImageElement | null;
  private onChange: (state: DrawState) => void;

  constructor(
    container: HTMLElement,
    imageWidth: number,
    imageHeight: number,
    onChange: (state: DrawState) => void,
    imageSource?: HTMLImageElement | null,
  ) {
    this.imageSource = imageSource ?? null;
    this.imageWidth = imageWidth;
    this.imageHeight = imageHeight;
    this.onChange = onChange;

    this.canvas = document.createElement('canvas');
    this.canvas.width = imageWidth;
    this.canvas.height = imageHeight;
    this.canvas.style.cssText = `
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      cursor: crosshair;
      z-index: 10;
    `;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.ctx = ctx;
    container.style.position = 'relative';
    container.appendChild(this.canvas);

    this.wireEvents();
    this.emitChange();
  }

  setTool(tool: DrawTool): void {
    this.currentTool = tool;
    this.canvas.style.cursor = this.enabled ? this.cursorForTool(tool) : 'default';
    this.emitChange();
  }

  setColor(color: string): void {
    this.currentColor = color;
    this.emitChange();
  }

  setStrokeWidth(w: number): void {
    this.currentStrokeWidth = w;
    this.emitChange();
  }

  setFillColor(color: string): void {
    this.currentFill = color;
    this.emitChange();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.canvas.style.pointerEvents = enabled ? 'auto' : 'none';
    this.canvas.style.cursor = enabled ? this.cursorForTool(this.currentTool) : 'default';
    if (!enabled) this.textInput?.blur();
  }

  getShapes(): DrawShape[] {
    return this.shapes.map((shape) => ({ ...shape }));
  }

  undo(): void {
    if (this.undoStack.length === 0) return;
    this.redoStack.push(this.getShapes());
    this.shapes = this.undoStack.pop() ?? [];
    this.redraw();
    this.emitChange();
  }

  redo(): void {
    if (this.redoStack.length === 0) return;
    this.undoStack.push(this.getShapes());
    this.shapes = this.redoStack.pop() ?? [];
    this.redraw();
    this.emitChange();
  }

  clearAll(): void {
    this.pushUndo();
    this.shapes = [];
    this.redraw();
    this.emitChange();
  }

  hasAnnotations(): boolean {
    return this.shapes.length > 0;
  }

  async flatten(sourceBlob: Blob): Promise<{ blob: Blob; width: number; height: number }> {
    const bmp = await decodeBitmap(sourceBlob);
    try {
      const { canvas, ctx } = createCanvas(this.imageWidth, this.imageHeight);
      ctx.drawImage(bmp, 0, 0);
      this.renderShapesToContext(ctx, this.shapes, { includeBlurPreview: false });
      const blob = await canvasToBlob(canvas, 'image/png');
      return { blob, width: this.imageWidth, height: this.imageHeight };
    } finally {
      bmp.close?.();
    }
  }

  destroy(): void {
    this.textInput?.remove();
    this.textInput = null;
    this.canvas.remove();
  }

  private cursorForTool(tool: DrawTool): string {
    return tool === 'select' ? 'default' : tool === 'text' ? 'text' : 'crosshair';
  }

  private pushUndo(): void {
    this.undoStack.push(this.getShapes());
    if (this.undoStack.length > 50) this.undoStack.shift();
    this.redoStack = [];
  }

  private emitChange(): void {
    this.onChange({
      shapes: this.getShapes(),
      tool: this.currentTool,
      color: this.currentColor,
      strokeWidth: this.currentStrokeWidth,
      fillColor: this.currentFill,
      fontSize: this.currentFontSize,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
    });
  }

  private toImageCoords(e: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.imageWidth / rect.width;
    const scaleY = this.imageHeight / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  private wireEvents(): void {
    this.canvas.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      if (this.currentTool === 'text') {
        this.startTextInput(e);
        return;
      }
      if (this.currentTool === 'select') return;
      const { x, y } = this.toImageCoords(e);
      this.startX = x;
      this.startY = y;
      this.drawing = true;
      this.canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.enabled || !this.drawing) return;
      const { x, y } = this.toImageCoords(e);
      this.redraw();
      this.drawPreview(this.startX, this.startY, x, y);
    });

    this.canvas.addEventListener('pointerup', (e) => {
      if (!this.drawing) return;
      this.drawing = false;
      const { x, y } = this.toImageCoords(e);
      try {
        this.canvas.releasePointerCapture(e.pointerId);
      } catch {
        // noop
      }
      const minDist = 5;
      if (Math.abs(x - this.startX) < minDist && Math.abs(y - this.startY) < minDist) {
        this.redraw();
        return;
      }
      this.pushUndo();
      this.shapes.push({
        id: Math.random().toString(36).slice(2),
        tool: this.currentTool,
        x1: this.startX,
        y1: this.startY,
        x2: x,
        y2: y,
        color: this.currentColor,
        strokeWidth: this.currentStrokeWidth,
        fillColor: this.currentFill,
      });
      this.redraw();
      this.emitChange();
    });
  }

  private startTextInput(e: PointerEvent): void {
    const { x, y } = this.toImageCoords(e);
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = rect.width / this.imageWidth;
    const scaleY = rect.height / this.imageHeight;

    this.textInput?.remove();
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Type here…';
    input.style.cssText = `
      position: absolute;
      left: ${x * scaleX + this.canvas.offsetLeft}px;
      top: ${y * scaleY + this.canvas.offsetTop}px;
      z-index: 20;
      background: rgba(0,0,0,0.7);
      color: ${this.currentColor};
      font: bold ${this.currentFontSize * Math.max(scaleX, scaleY)}px sans-serif;
      border: 1px dashed ${this.currentColor};
      border-radius: 2px;
      padding: 2px 4px;
      outline: none;
      min-width: 80px;
    `;
    this.textInput = input;
    (this.canvas.parentElement ?? document.body).appendChild(input);
    input.focus();

    let committed = false;
    const finish = (save: boolean) => {
      if (committed) return;
      committed = true;
      const text = input.value.trim();
      if (save && text) {
        this.pushUndo();
        this.shapes.push({
          id: Math.random().toString(36).slice(2),
          tool: 'text',
          x1: x,
          y1: y,
          x2: x,
          y2: y,
          color: this.currentColor,
          strokeWidth: this.currentStrokeWidth,
          text,
          fontSize: this.currentFontSize,
        });
        this.redraw();
        this.emitChange();
      }
      input.remove();
      if (this.textInput === input) this.textInput = null;
    };

    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') finish(true);
      if (ev.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true), { once: true });
  }

  private redraw(): void {
    this.ctx.clearRect(0, 0, this.imageWidth, this.imageHeight);
    this.renderShapesToContext(this.ctx, this.shapes);
  }

  private drawPreview(x1: number, y1: number, x2: number, y2: number): void {
    this.ctx.save();
    this.ctx.globalAlpha = 0.7;
    this.renderShape(this.ctx, {
      id: '__preview__',
      tool: this.currentTool,
      x1,
      y1,
      x2,
      y2,
      color: this.currentColor,
      strokeWidth: this.currentStrokeWidth,
      fillColor: this.currentFill,
    });
    this.ctx.restore();
  }

  private renderShapesToContext(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    shapes: DrawShape[],
    options: { includeBlurPreview?: boolean } = {},
  ): void {
    const includeBlurPreview = options.includeBlurPreview ?? true;
    for (const shape of shapes) {
      if (shape.tool === 'blur' && !includeBlurPreview) continue;
      this.renderShape(ctx, shape);
    }
  }

  private renderShape(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    shape: DrawShape,
  ): void {
    ctx.save();
    ctx.strokeStyle = shape.color;
    ctx.fillStyle = shape.fillColor ?? 'transparent';
    ctx.lineWidth = shape.strokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const x = Math.min(shape.x1, shape.x2);
    const y = Math.min(shape.y1, shape.y2);
    const w = Math.abs(shape.x2 - shape.x1);
    const h = Math.abs(shape.y2 - shape.y1);

    switch (shape.tool) {
      case 'blur': {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.clip();
        if (this.imageSource && ctx instanceof CanvasRenderingContext2D) {
          // Draw blurred preview using the actual source image
          const pad = 24;
          ctx.filter = 'blur(14px)';
          ctx.drawImage(
            this.imageSource,
            Math.max(0, x - pad),
            Math.max(0, y - pad),
            w + pad * 2,
            h + pad * 2,
            Math.max(0, x - pad),
            Math.max(0, y - pad),
            w + pad * 2,
            h + pad * 2,
          );
          ctx.filter = 'none';
        } else {
          // Fallback frosted-glass indicator when no image source available
          ctx.fillStyle = 'rgba(20, 83, 45, 0.35)';
          ctx.fillRect(x, y, w, h);
        }
        ctx.restore();
        // Dashed green border to mark the region
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = 'rgba(74, 222, 128, 0.9)';
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
        ctx.setLineDash([]);
        break;
      }
      case 'rect':
        if (shape.fillColor && shape.fillColor !== 'transparent') ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
        break;
      case 'ellipse':
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        if (shape.fillColor && shape.fillColor !== 'transparent') ctx.fill();
        ctx.stroke();
        break;
      case 'line':
        ctx.beginPath();
        ctx.moveTo(shape.x1, shape.y1);
        ctx.lineTo(shape.x2, shape.y2);
        ctx.stroke();
        break;
      case 'arrow': {
        const dx = shape.x2 - shape.x1;
        const dy = shape.y2 - shape.y1;
        const arrowLength = Math.hypot(dx, dy);
        const angle = Math.atan2(dy, dx);
        const headLen = Math.min(Math.max(18, shape.strokeWidth * 5.5), arrowLength * 0.75);
        // Stop the rounded shaft inside the filled head so it cannot protrude
        // through the arrow tip, while retaining enough overlap to avoid a seam.
        const shaftInset = Math.min(headLen * 0.6, arrowLength * 0.5);
        ctx.beginPath();
        ctx.moveTo(shape.x1, shape.y1);
        ctx.lineTo(
          shape.x2 - shaftInset * Math.cos(angle),
          shape.y2 - shaftInset * Math.sin(angle),
        );
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(shape.x2, shape.y2);
        ctx.lineTo(
          shape.x2 - headLen * Math.cos(angle - Math.PI / 6),
          shape.y2 - headLen * Math.sin(angle - Math.PI / 6),
        );
        ctx.lineTo(
          shape.x2 - headLen * Math.cos(angle + Math.PI / 6),
          shape.y2 - headLen * Math.sin(angle + Math.PI / 6),
        );
        ctx.closePath();
        ctx.fillStyle = shape.color;
        ctx.fill();
        break;
      }
      case 'text':
        ctx.font = `bold ${shape.fontSize ?? 20}px -apple-system, BlinkMacSystemFont, sans-serif`;
        ctx.fillStyle = shape.color;
        ctx.textBaseline = 'top';
        ctx.fillText(shape.text ?? '', shape.x1, shape.y1);
        break;
      case 'select':
        break;
    }
    ctx.restore();
  }
}

export async function applyBlurRegions(
  master: Blob,
  shapes: DrawShape[],
  imageWidth: number,
  imageHeight: number,
): Promise<Blob> {
  const blurShapes = shapes.filter((shape) => shape.tool === 'blur');
  if (blurShapes.length === 0) return master;

  const bmp = await decodeBitmap(master);
  try {
    const { canvas, ctx } = createCanvas(imageWidth, imageHeight);
    ctx.drawImage(bmp, 0, 0);

    for (const shape of blurShapes) {
      const x = Math.max(0, Math.min(shape.x1, shape.x2));
      const y = Math.max(0, Math.min(shape.y1, shape.y2));
      const w = Math.max(1, Math.round(Math.abs(shape.x2 - shape.x1)));
      const h = Math.max(1, Math.round(Math.abs(shape.y2 - shape.y1)));

      const tmp = document.createElement('canvas');
      tmp.width = w;
      tmp.height = h;
      const tc = tmp.getContext('2d');
      if (!tc) continue;
      tc.filter = 'blur(12px)';
      tc.drawImage(canvas as CanvasImageSource, x, y, w, h, 0, 0, w, h);
      ctx.drawImage(tmp, x, y);
    }

    return canvasToBlob(canvas, 'image/png');
  } finally {
    bmp.close?.();
  }
}
