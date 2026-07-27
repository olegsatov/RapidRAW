// Web Worker: encodes a dodge/burn mask from raw grayscale pixels to a JPEG data URL.
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
    const tryToBlob = (type: string, quality?: number) => {
      outputCanvas
        .convertToBlob({ type, quality })
        .then((blob) => {
          if (blob && blob.size > 0) {
            const reader = new FileReader();
            reader.onload = () => resolve({ requestId, dataUrl: reader.result as string });
            reader.onerror = () => resolve({ requestId, dataUrl: null, error: 'FileReader failed' });
            reader.readAsDataURL(blob);
          } else if (type === 'image/jpeg') {
            tryToBlob('image/webp', 0.7);
          } else if (type === 'image/webp') {
            tryToBlob('image/png');
          } else {
            resolve({ requestId, dataUrl: null, error: 'Failed to encode mask blob' });
          }
        })
        .catch(() => {
          if (type === 'image/jpeg') {
            tryToBlob('image/webp', 0.7);
          } else if (type === 'image/webp') {
            tryToBlob('image/png');
          } else {
            resolve({ requestId, dataUrl: null, error: 'Failed to encode mask blob' });
          }
        });
    };
    tryToBlob('image/jpeg', 0.9);
  });
}

self.onmessage = async (event: MessageEvent<EncodeMaskRequest>) => {
  const result = await encodeMask(event.data);
  self.postMessage(result);
};
