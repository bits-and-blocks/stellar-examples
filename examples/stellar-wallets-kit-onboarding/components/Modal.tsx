"use client";

import { useEffect, useRef, type ReactNode } from "react";

type Props = {
  open: boolean;
  /** Every way out arrives here: a button, Escape, or a click on the backdrop. */
  onClose: () => void;
  title: string;
  /** Sits before the title, e.g. a warning mark. */
  icon?: ReactNode;
  /** Colours the icon. "danger" for something that cannot be undone. */
  tone?: "danger" | "info";
  /** A wider panel, for a picture rather than a paragraph. */
  wide?: boolean;
  children: ReactNode;
};

/**
 * The dialog every modal on this page is built from.
 *
 * Native `<dialog>` rather than a div with a high z-index: the top layer, the
 * focus trap, the backdrop and Escape all come with it, and all four are things
 * a hand-rolled overlay gets wrong.
 */
export function Modal({
  open,
  onClose,
  title,
  icon,
  tone,
  wide,
  children,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={[
        "modal",
        tone ? `modal-${tone}` : "",
        wide ? "modal-wide" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      // Escape closes the dialog itself, which would leave the state that
      // opened it saying otherwise. Sending it through the same path as the
      // button keeps the two in step.
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      // The dialog element is the backdrop as far as clicks go: anything
      // landing on it rather than on the panel inside was a click outside.
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="modal-panel">
        <h2 className="modal-title">
          {icon}
          {title}
        </h2>
        {children}
      </div>
    </dialog>
  );
}
