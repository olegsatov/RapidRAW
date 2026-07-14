import { useState, useLayoutEffect } from 'react';

export interface ImageDimensions {
  height: number;
  width: number;
}

export interface RenderSize {
  height: number;
  offsetX: number;
  offsetY: number;
  scale: number;
  width: number;
}

const DEFAULT_SIZE: RenderSize = { width: 0, height: 0, scale: 1, offsetX: 0, offsetY: 0 };

const computeRenderSize = (container: HTMLElement, imgWidth: number, imgHeight: number, margin: number): RenderSize => {
  const { clientWidth: rawWidth, clientHeight: rawHeight } = container;
  const marginPx = Math.max(0, margin);
  const availableWidth = Math.max(0, rawWidth - marginPx * 2);
  const availableHeight = Math.max(0, rawHeight - marginPx * 2);
  const imageAspectRatio = imgWidth / imgHeight;
  const containerAspectRatio = availableWidth / availableHeight;

  let width: number;
  let height: number;
  if (imageAspectRatio > containerAspectRatio) {
    width = availableWidth;
    height = availableWidth / imageAspectRatio;
  } else {
    height = availableHeight;
    width = availableHeight * imageAspectRatio;
  }

  const offsetX = (rawWidth - width) / 2;
  const offsetY = (rawHeight - height) / 2;

  return { width, height, scale: width / imgWidth, offsetX, offsetY };
};

export const useImageRenderSize = (
  containerRef: React.RefObject<HTMLElement>,
  imageDimensions: ImageDimensions | null,
  margin: number = 0,
) => {
  const imgWidth = imageDimensions?.width;
  const imgHeight = imageDimensions?.height;

  const [renderSize, setRenderSize] = useState<RenderSize>(() => {
    const container = containerRef.current;
    if (!container || !imgWidth || !imgHeight) return DEFAULT_SIZE;
    return computeRenderSize(container, imgWidth, imgHeight, margin);
  });

  useLayoutEffect(() => {
    const container = containerRef.current;

    if (!container || !imgWidth || !imgHeight) {
      setRenderSize(DEFAULT_SIZE);
      return;
    }

    const updateSize = () => setRenderSize(computeRenderSize(container, imgWidth, imgHeight, margin));

    updateSize();

    const resizeObserver = new ResizeObserver(() => {
      updateSize();
    });

    resizeObserver.observe(container);

    return () => resizeObserver.disconnect();
  }, [containerRef, imgWidth, imgHeight, margin]);

  return renderSize;
};
