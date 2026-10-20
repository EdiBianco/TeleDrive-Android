import { useEffect, useRef, useState, type ReactNode } from "react";
import type { TeleFile } from "@/lib/types";
import { requestThumbnail, type ThumbRequest } from "@/lib/telegram/thumbnails";

/**
 * Shows a thumbnail for images and videos while the card is on screen. It asks for Telegram's
 * small thumbnail first and, when `large` is set (big cards), upgrades to a sharper one.
 * Requests for cards that scroll away are dropped. Otherwise shows `children`.
 */
export default function ThumbImage({
  file,
  large = false,
  contain = false,
  children,
}: {
  file: TeleFile;
  large?: boolean;
  contain?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const isImage = file.mime.startsWith("image/");
  const eligible = isImage || file.mime.startsWith("video/");
  const wantLarge = large && isImage;

  useEffect(() => {
    if (!eligible || !ref.current) return;
    let cancelled = false;
    let pending: ThumbRequest[] = [];
    const ask = (tier: "small" | "large") => {
      const request = requestThumbnail(file.channelId, file.messageId, file.mime, tier);
      pending.push(request);
      void request.promise.then((found) => {
        if (!cancelled && found) setUrl(found);
      });
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          if (pending.length === 0) {
            ask("small");
            if (wantLarge) ask("large");
          }
        } else {
          // Scrolled away: drop anything that has not started.
          pending.forEach((request) => request.cancel());
          pending = [];
        }
      },
      { rootMargin: "300px" },
    );
    observer.observe(ref.current);
    return () => {
      cancelled = true;
      observer.disconnect();
      pending.forEach((request) => request.cancel());
    };
  }, [file.channelId, file.messageId, file.mime, eligible, wantLarge]);

  return (
    <div ref={ref} className="w-full h-full flex items-center justify-center">
      {url ? <img src={url} alt={file.name} loading="lazy" className={`w-full h-full ${contain ? "object-contain" : "object-cover"}`} /> : children}
    </div>
  );
}
