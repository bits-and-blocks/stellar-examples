"use client";

import { useEffect, useState } from "react";

/** Day-first dates and a 24-hour clock, to match the English the app is
 *  written in. See the note in formatWhen. */
const LOCALE = "en-GB";

/**
 * When something happened, in the words a person would use for it.
 *
 * Recent entries read as a distance from now, which is what someone who has
 * just made one is looking for. Older ones read as a date, because "19 hours
 * ago" is arithmetic the reader has to do and "Yesterday at 21:14" is not.
 *
 * `now` is passed in rather than read here so every row in a list agrees on
 * what time it is, and so the caller decides how often the answer changes.
 */
export function formatWhen(at: number, now: number): string {
  // A clock that has drifted backwards, or an entry written a moment ago in a
  // millisecond that has not caught up yet. Neither is "in 3 seconds".
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return "Just now";

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;

  const then = new Date(at);
  const today = new Date(now);

  // A fixed locale, unlike the activity log's bare clock column: these parts
  // are set in an English sentence, and "9 août at 21:30" is worse than a date
  // that matches the words around it. The exact timestamp behind the tooltip
  // is the reader's own format, since it stands on its own.
  const time = then.toLocaleTimeString(LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
  });

  // Calendar days, not elapsed hours: something logged at 23:50 is "yesterday"
  // by 00:10, however few hours have passed.
  const days = dayNumber(today) - dayNumber(then);
  if (days === 0) return `Today at ${time}`;
  if (days === 1) return `Yesterday at ${time}`;

  const date = then.toLocaleDateString(LOCALE, {
    day: "numeric",
    month: "short",
    // The year is only worth the space once it is not the current one.
    year: then.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
  return `${date} at ${time}`;
}

/** The full timestamp, for the tooltip behind the sentence above. */
export function formatExact(at: number): string {
  return new Date(at).toLocaleString();
}

/** Days since the epoch in local time, which is what makes the comparison above
 *  a calendar one rather than a 24-hour one. */
function dayNumber(date: Date): number {
  return Math.floor(
    (date.getTime() - date.getTimezoneOffset() * 60_000) / 86_400_000,
  );
}

/**
 * A clock, so "Just now" becomes "2 minutes ago" without the reader having to
 * reload.
 *
 * Half a minute is fine as a rate: the coarsest thing this drives is a count of
 * whole minutes, so nothing on screen can be more than one tick out of date. It
 * ticks whether or not anything is currently using the answer, which costs one
 * timer and means the answer is never stale the moment something starts.
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const id = setInterval(tick, intervalMs);
    // A tab in the background has its timers throttled, so the clock catches
    // up when someone looks at it again rather than on the schedule it was
    // left running at.
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [intervalMs]);

  return now;
}
