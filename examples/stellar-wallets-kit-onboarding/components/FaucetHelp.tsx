"use client";

import { useState } from "react";
import Image from "next/image";
import { InfoIcon } from "./icons";
import { Modal } from "./Modal";

/**
 * What the Circle faucet asks for, shown rather than described.
 *
 * The recording is the point of this, but it is not the whole of it: it is
 * silent, it is someone else's website that will be redesigned eventually, and
 * a screen reader gets nothing from it at all. So the steps are written out
 * beside it, and they are the part kept true — the clip illustrates them.
 *
 * Opened by pressing, not by hovering. Hover is not available to a touch screen
 * or a keyboard, and a recording large enough to read is far too large to hang
 * off a tooltip.
 */
export function FaucetHelp({ code }: { code: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="info-button"
        onClick={() => setOpen(true)}
        aria-label="What the Circle faucet asks for"
        title="What the Circle faucet asks for"
      >
        <InfoIcon size={16} />
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Claiming ${code} from the Circle faucet`}
        icon={<InfoIcon size={15} />}
        tone="info"
        wide
      >
        <div className="modal-how">
          <div className="modal-body">
            <ol className="modal-steps">
              <li>
                Leave <strong>{code}</strong> selected — it is the first of the
                three tokens, and the one this walkthrough uses.
              </li>
              <li>
                Open <strong>Network</strong> and choose{" "}
                <strong>Stellar Testnet</strong>. It opens on a different chain,
                and sending to that one is the mistake this is here to prevent.
              </li>
              <li>
                Paste your address into <strong>Send to</strong>. It is the one
                in the bar at the top of this page, and the copy button beside
                it puts it on your clipboard.
              </li>
              <li>
                Press <strong>Send 20 {code}</strong>, then come back here. The
                faucet allows one claim per address every two hours.
              </li>
            </ol>
          </div>

          <Image
            // Animated, so it goes to the browser as it is. Next's optimiser
            // would return a still frame of it.
            unoptimized
            src="/circle-faucet-stellar.gif"
            alt={`A recording of the Circle faucet: ${code} is selected, the network is switched to Stellar Testnet, an address is pasted into Send to, and the tokens are sent.`}
            width={600}
            height={650}
            className="modal-figure"
          />
        </div>

        <div className="modal-actions">
          <button
            type="button"
            className="btn"
            autoFocus
            onClick={() => setOpen(false)}
          >
            Close
          </button>
        </div>
      </Modal>
    </>
  );
}
