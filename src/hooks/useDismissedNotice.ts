import { useState } from "react";

const PREFIX = "teledrive_dismissed_notice:";

function isStored(id: string): boolean {
  try {
    return localStorage.getItem(PREFIX + id) === "1";
  } catch {
    return false;
  }
}

/**
 * Remembers that a notice was closed with its X button, so it stops showing (and stops taking
 * space). Each id is separate: a notice with new text can use a new id and show again.
 */
export function useDismissedNotice(id: string): { dismissed: boolean; dismiss: () => void } {
  const [, setVersion] = useState(0);
  const dismiss = () => {
    try {
      localStorage.setItem(PREFIX + id, "1");
    } catch {
      // Storage unavailable: the notice is hidden for this session only.
    }
    setVersion((v) => v + 1);
  };
  return { dismissed: isStored(id), dismiss };
}
