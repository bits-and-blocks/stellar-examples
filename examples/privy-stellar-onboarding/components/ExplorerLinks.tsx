import { EXPLORERS } from "@/lib/stellar/network";
import { ChainIcon, SearchIcon } from "./icons";

const icons = {
  expert: SearchIcon,
  chain: ChainIcon,
} as const;

/**
 * One button per explorer for a given transaction. Two rather than one because
 * they show different things, and because an explorer being down should not
 * leave a hash with nowhere to go.
 */
export function ExplorerLinks({
  hash,
  compact,
  /**
   * "sm" is a pill sitting inside a result line or a list row. "md" is for
   * links standing on a row of their own, where they line up with the button
   * beside them rather than floating at half its height.
   */
  size = "sm",
}: {
  hash: string;
  compact?: boolean;
  size?: "sm" | "md";
}) {
  return (
    <span className="row" style={{ gap: "8px" }}>
      {EXPLORERS.map((explorer) => {
        const Icon = icons[explorer.id];
        return (
          <a
            key={explorer.id}
            href={explorer.txUrl(hash)}
            target="_blank"
            rel="noreferrer"
            className={`btn ${size === "md" ? "btn-quiet" : "btn-sm"}`}
            title={`View on ${explorer.name}`}
          >
            <Icon />
            {compact ? explorer.name.replace("Stellar", "").trim() : explorer.name}
          </a>
        );
      })}
    </span>
  );
}
