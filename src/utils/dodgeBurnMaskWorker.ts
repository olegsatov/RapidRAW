// Web Worker: encodes a dodge/burn mask from raw grayscale pixels to a WebP data URL.
// WebP quality 0.7 is enough for a soft mask and keeps the persisted payload small.
// Keeping the heavy canvas work off the main thread prevents the cursor from
// stuttering after the mouse is released.

export interface EncodeMaskRequest {
  requestId: number;
  pixels: Uint8Array;
  width: number;
  height: number;
  targetWidth: number;
  targetHeight: number;
}

export interface EncodeMaskResponse {
  requestId: number;
  dataUrl: string | null;
  error?: string;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function tryEncode(
  canvas: OffscreenCanvas,
  type: string,
  quality?: number,
): Promise<{ dataUrl: string; size: number; type: string } | null> {
  try {
    const blob = await canvas.convertToBlob({ type, quality });
    if (!blob || blob.size === 0) return null;
    const dataUrl = await blobToDataUrl(blob);
    return { dataUrl, size: blob.size, type: blob.type || type };
  } catch {
    return null;
  }
}

function encodeMask(request: EncodeMaskRequest): Promise<EncodeMaskResponse> {
  const { requestId, pixels, width, height, targetWidth, targetHeight } = request;

  const sourceCanvas = new OffscreenCanvas(width, height);
  const sourceCtx = sourceCanvas.getContext('2d');
  if (!sourceCtx) {
    return Promise.resolve({ requestId, dataUrl: null, error: 'Failed to create source 2D context' });
  }

  const imageData = sourceCtx.createImageData(width, height);
  const data = imageData.data;
  for (let y = 0; y < height; y++) {
    const srcY = height - 1 - y;
    for (let x = 0; x < width; x++) {
      const srcIndex = srcY * width + x;
      const dstIndex = (y * width + x) * 4;
      const value = pixels[srcIndex];
      data[dstIndex] = value;
      data[dstIndex + 1] = value;
      data[dstIndex + 2] = value;
      data[dstIndex + 3] = 255;
    }
  }
  sourceCtx.putImageData(imageData, 0, 0);

  const outputCanvas = new OffscreenCanvas(targetWidth, targetHeight);
  const outputCtx = outputCanvas.getContext('2d');
  if (!outputCtx) {
    return Promise.resolve({ requestId, dataUrl: null, error: 'Failed to create output 2D context' });
  }
  if (targetWidth !== width || targetHeight !== height) {
    outputCtx.imageSmoothingEnabled = true;
    outputCtx.imageSmoothingQuality = 'high';
  }
  outputCtx.drawImage(sourceCanvas, 0, 0, targetWidth, targetHeight);

  return new Promise((resolve) => {
    const run = async () => {
      // Try WebP first as the preferred compact format.
      const webp = await tryEncode(outputCanvas, 'image/webp', 0.7);
      console.log('[mask-worker] webp attempt:', webp ? `${webp.type} ${webp.size}` : 'failed');

      const isValidWebp = webp && webp.type === 'image/webp' && webp.size > 0;
      if (isValidWebp) {
        return resolve({ requestId, dataUrl: webp.dataUrl });
      }

      // WebP is unsupported or broken on this engine; fall back to JPEG.
      const jpeg = await tryEncode(outputCanvas, 'image/jpeg', 0.7);
      console.log('[mask-worker] jpeg attempt:', jpeg ? `${jpeg.type} ${jpeg.size}` : 'failed');

      if (jpeg && jpeg.size > 0) {
        return resolve({ requestId, dataUrl: jpeg.dataUrl });
      }

      // Last resort: lossless PNG.
      const png = await tryEncode(outputCanvas, 'image/png');
      console.log('[mask-worker] png attempt:', png ? `${png.type} ${png.size}` : 'failed');

      if (png && png.size > 0) {
        return resolve({ requestId, dataUrl: png.dataUrl });
      }

      resolve({ requestId, dataUrl: null, error: 'Failed to encode mask blob' });
    };
    run();
  });
}

self.onmessage = async (event: MessageEvent<EncodeMaskRequest>) => {
  const result = await encodeMask(event.data);
  self.postMessage(result);
};
