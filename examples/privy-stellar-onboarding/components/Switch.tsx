"use client";

import { SpinnerIcon } from "./icons";

type Props = {
  checked: boolean;
  /** Called with the state being asked for, not the one currently shown. */
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** True while the transaction that would move it is in flight. */
  pending?: boolean;
  /** What the switch controls, read out with its state. */
  label: string;
};

/**
 * A switch whose state lives on the chain rather than in this component.
 *
 * It shows what the network says is true, never what was just clicked: the
 * click starts a transaction that has to be signed and accepted, and one that
 * is refused must leave the switch where it was. So the knob moves when the
 * balance says the trustline moved, and in between the switch is busy rather
 * than optimistic.
 */
export function Switch({ checked, onChange, disabled, pending, label }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-busy={pending}
      disabled={disabled || pending}
      onClick={() => onChange(!checked)}
      className={`switch${checked ? " on" : ""}`}
    >
      <span className="switch-track" aria-hidden>
        <span className="switch-knob">{pending && <SpinnerIcon size={11} />}</span>
      </span>
      {label}
    </button>
  );
}
