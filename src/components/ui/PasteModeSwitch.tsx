import { useState, useEffect, useRef, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { PasteMode } from '../../utils/adjustments';

interface PasteModeSwitchProps {
  selectedMode: PasteMode;
  onModeChange: (mode: PasteMode) => void;
  isVisible?: boolean;
}

const PasteModeSwitch = ({ selectedMode, onModeChange, isVisible = true }: PasteModeSwitchProps) => {
  const { t } = useTranslation();
  const [buttonRefs, setButtonRefs] = useState<Map<string, HTMLButtonElement>>(new Map());
  const [bubbleStyle, setBubbleStyle] = useState({});
  const containerRef = useRef<HTMLDivElement>(null);
  const isInitialAnimation = useRef(true);

  const pasteModeOptions = useMemo(
    () => [
      { id: PasteMode.Merge, label: t('modals.copyPaste.modeMerge') },
      { id: PasteMode.Replace, label: t('modals.copyPaste.modeReplace') },
    ],
    [t],
  );

  useEffect(() => {
    const selectedButton = buttonRefs.get(selectedMode);

    if (!isVisible || !selectedButton || !containerRef.current) {
      return;
    }

    const targetStyle = {
      x: selectedButton.offsetLeft,
      width: selectedButton.offsetWidth,
    };

    if (isInitialAnimation.current && containerRef.current.offsetWidth > 0) {
      let initialX;
      if (selectedMode === PasteMode.Replace) {
        initialX = containerRef.current.offsetWidth;
      } else {
        initialX = -targetStyle.width;
      }

      setBubbleStyle({
        x: [initialX, targetStyle.x],
        width: targetStyle.width,
      });
      isInitialAnimation.current = false;
    } else {
      setBubbleStyle(targetStyle);
    }
  }, [selectedMode, buttonRefs, isVisible]);

  useEffect(() => {
    if (!isVisible) {
      isInitialAnimation.current = true;
    }
  }, [isVisible]);

  return (
    <div ref={containerRef} className="relative flex w-full gap-1 bg-bg-primary p-1 rounded-md">
      <motion.div
        className="absolute top-1 bottom-1 z-0 bg-accent shadow-xs"
        style={{ borderRadius: 6 }}
        animate={bubbleStyle}
        transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
      />
      {pasteModeOptions.map((option) => (
        <button
          key={option.id}
          ref={(el) => {
            if (el) {
              const newRefs = new Map(buttonRefs);
              if (newRefs.get(option.id) !== el) {
                newRefs.set(option.id, el);
                setButtonRefs(newRefs);
              }
            }
          }}
          onClick={() => onModeChange(option.id)}
          className={clsx(
            'relative flex-1 flex items-center justify-center gap-2 py-1.5 text-sm rounded-md transition-colors',
            {
              'text-text-primary hover:bg-surface': selectedMode !== option.id,
              'text-button-text': selectedMode === option.id,
            },
          )}
          style={{ WebkitTapHighlightColor: 'transparent' }}
        >
          <span className="relative z-10 flex items-center">{option.label}</span>
        </button>
      ))}
    </div>
  );
};

export default PasteModeSwitch;
