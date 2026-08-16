import { EXPLORERS } from "@/lib/stellar/network";
import { ChainIcon, SearchIcon } from "./icons";

const icons = {
  expert: SearchIcon,
  chain: ChainIcon,
} as const;

/**
 * One link per explorer for a given transaction. Two rather than one because
 * they show different things, and because an explorer being down should not
 * leave a hash with nowhere to go.
 *
 * Links rather than buttons, and dressed as links: nothing happens on this page
 * when they are pressed. A pill beside a real control read as a second thing
 * the step could do, when it is a way out of the page.
 */
export function ExplorerLinks({ hash }: { hash: string }) {
  return (
    <span className="explorer-links">
      {EXPLORERS.map((explorer) => {
        const Icon = icons[explorer.id];
        return (
          <a
            key={explorer.id}
            href={explorer.txUrl(hash)}
            target="_blank"
            rel="noreferrer"
            className="explorer-link"
          >
            <Icon />
            {/* Underlined on the words only. Carried across the icon as well,
                the rule ran under a symbol that is not part of the phrase. */}
            <span>
              {/* The explorer's name alone read as a label for the row rather
                  than as somewhere to go. Saying what following it does is the
                  whole difference. */}
              View on {explorer.name}
            </span>
          </a>
        );
      })}
    </span>
  );
}
