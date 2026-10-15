import { useEffect, useRef, useState, type ReactNode } from "react";
import type { TeleFile } from "@/lib/types";
import { loadThumbnail } from "@/lib/telegram/thumbnails";

/** Shows a Telegram thumbnail for images and videos once the card scrolls into view; otherwise `children`. */
export default function ThumbImage({ file, children }: { file: TeleFile; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const eligible = file.mime.startsWith("image/") || file.mime.startsWith("video/");

  useEffect(() => {
    if (!eligible || !ref.current) return;
    let cancelled = false;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        void loadThumbnail(file.channelId, file.messageId).then((found) => {
          if (!cancelled && found) setUrl(found);
        });
      },
      { rootMargin: "200px" },
    );
    observer.observe(ref.current);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [file.channelId, file.messageId, eligible]);

  return (
    <div ref={ref} className="w-full h-full flex items-center justify-center">
      {url ? <img src={url} alt={file.name} loading="lazy" className="w-full h-full object-cover" /> : children}
    </div>
  );
}
