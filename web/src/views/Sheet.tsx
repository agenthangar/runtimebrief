import { useEffect, useRef, type ReactNode } from "react";

export interface SheetProps {
  title: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  onDismiss: () => void;
  dismissDisabled?: boolean;
  plain?: boolean;
  testId?: string;
}

/** Modal presentation that behaves like a SwiftUI `.sheet` with a NavigationStack inside. */
export function Sheet({
  title,
  leading,
  trailing,
  footer,
  children,
  onDismiss,
  dismissDisabled = false,
  plain = false,
  testId,
}: SheetProps) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !dismissDisabled) onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [onDismiss, dismissDisabled]);

  return (
    <div
      className="sheet-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !dismissDisabled) onDismiss();
      }}
    >
      <div
        className={`sheet ${plain ? "plain" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={panel}
        tabIndex={-1}
        data-testid={testId}
      >
        <div className="sheet-nav">
          <div className="nav-bar-side">{leading}</div>
          <div className="sheet-title">{title}</div>
          <div className="nav-bar-side trailing">{trailing}</div>
        </div>
        <div className="sheet-body">{children}</div>
        {footer ? <div className="sheet-footer">{footer}</div> : null}
      </div>
    </div>
  );
}
