"use client";

import type { ReactNode } from "react";
import { AlertIcon } from "./icons";
import { Modal } from "./Modal";

type Props = {
  open: boolean;
  title: string;
  children: ReactNode;
  /** What going ahead is called, stated as the thing it does. */
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * Asks before something that cannot be undone.
 *
 * Cancel is what the keyboard lands on and what Escape does. The dangerous
 * answer is available in one press but never the default one.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
}: Props) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      icon={<AlertIcon size={15} />}
      tone="danger"
    >
      <div className="modal-body">{children}</div>
      <div className="modal-actions">
        <button type="button" className="btn" autoFocus onClick={onCancel}>
          {cancelLabel}
        </button>
        <button type="button" className="btn btn-danger" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
