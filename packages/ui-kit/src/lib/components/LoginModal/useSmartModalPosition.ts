import { useEffect, useRef, useState } from 'react';
import { usePushWalletContext } from '../../hooks/usePushWallet';
import { PushUI } from '../../constants';

type Position = { top: number; left: number };

export function useSmartModalPosition(
  triggerId: string | null,
  triggerRefs: React.MutableRefObject<Record<string, HTMLDivElement | null>>,
  modalWidth = 450,
  modalHeight = 675,
  uid?: string,
): Position {
  const [position, setPosition] = useState<Position>({ top: 0, left: 0 });
  const rafRef = useRef<number | null>(null);

  const { isWalletMinimised, universalAccount, config } = usePushWalletContext(uid);

  useEffect(() => {
    const calculatePosition = () => {
      if (!triggerId || !triggerRefs.current[triggerId]) return;

      const triggerRef = triggerRefs.current[triggerId];

      if (config.modal?.connectedLayout === PushUI.CONSTANTS.CONNECTED.LAYOUT.FULL) {
        setPosition({ top: 0, left: 0 });
        return;
      }

      const triggerRect = triggerRef.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;

      const spaceBelow = viewportHeight - triggerRect.bottom;
      const spaceAbove = triggerRect.top;
      const spaceRight = viewportWidth - triggerRect.right;
      const spaceLeft = triggerRect.left;

      let top;
      let left;

      if (spaceBelow >= modalHeight) {
        top = triggerRect.bottom;
      } else if (spaceAbove >= modalHeight) {
        top = triggerRect.top - modalHeight;
      } else {
        top = Math.max(viewportHeight - modalHeight, 0) / 2;
      }

      // Horizontal
      if ((spaceRight + triggerRect.width) >= modalWidth) {
        left = triggerRect.left - 35;
      } else if (spaceLeft >= modalWidth) {
        left = triggerRect.right - modalWidth + 35;
      } else {
        // Not enough room on either side of the trigger (e.g. viewport was
        // narrowed by a docked browser side panel). Clamp to the trigger's
        // edge instead of centering in the viewport, so the modal stays
        // visually attached to the button rather than jumping away from it.
        left = Math.min(
          Math.max(triggerRect.left - 35, 8),
          Math.max(viewportWidth - modalWidth - 8, 8),
        );
      }

      setPosition({ top, left });
    };

    const scheduleCalculatePosition = () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        calculatePosition();
      });
    };

    if (!isWalletMinimised && universalAccount) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }

    calculatePosition();
    window.addEventListener('resize', scheduleCalculatePosition);

    const triggerEl = triggerId ? triggerRefs.current[triggerId] : null;
    let resizeObserver: ResizeObserver | undefined;
    if (triggerEl && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(scheduleCalculatePosition);
      resizeObserver.observe(triggerEl);
    }

    return () => {
      window.removeEventListener('resize', scheduleCalculatePosition);
      resizeObserver?.disconnect();
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      document.body.style.overflow = '';
    };
  }, [triggerId, triggerRefs, modalWidth, modalHeight, isWalletMinimised, config, uid]);

  useEffect(() => {
    if (!universalAccount) {
        setPosition({top: 0, left: 0});
    }
  }, [universalAccount])

  return position;
}
