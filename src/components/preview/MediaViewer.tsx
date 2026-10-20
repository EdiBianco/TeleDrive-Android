import { useCallback, useEffect, useRef, useState } from "react";
import { X, MoreVertical, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Loader2, Music } from "lucide-react";
import type { TeleFile } from "@/lib/types";
import { loadForViewer } from "@/lib/files/viewerCache";
import ThumbImage from "@/components/files/ThumbImage";

const PRELOAD_MAX_BYTES = 20 * 1024 * 1024;
const MAX_SCALE = 5;

export function isViewable(file: Pick<TeleFile, "mime" | "name">): boolean {
  const mime = (file.mime || "").toLowerCase();
  if (mime === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg")) return false;
  return mime.startsWith("image/") || mime.startsWith("video/") || mime.startsWith("audio/");
}

interface Props {
  files: TeleFile[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
  onMenu: (file: TeleFile) => void;
}

interface View {
  scale: number;
  x: number;
  y: number;
}

const RESET: View = { scale: 1, x: 0, y: 0 };

export function MediaViewer({ files, index, onIndex, onClose, onMenu }: Props) {
  const file = files[index];
  const kind = file.mime.startsWith("video/") ? "video" : file.mime.startsWith("audio/") ? "audio" : "image";

  const [url, setUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [chrome, setChrome] = useState(true);
  const [view, setView] = useState<View>(RESET);
  const [drag, setDrag] = useState({ x: 0, y: 0 });

  const viewRef = useRef(view);
  viewRef.current = view;
  const touch = useRef({
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    pinchDist: 0,
    pinchScale: 1,
    moved: false,
    multi: false,
    lastTap: 0,
  });

  const go = useCallback(
    (target: number) => {
      const next = Math.min(Math.max(target, 0), files.length - 1);
      if (next !== index) onIndex(next);
    },
    [files.length, index, onIndex]
  );

  // Load the current file; once it is ready, warm the neighbouring images.
  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    setError(null);
    setProgress(0);
    setView(RESET);
    setDrag({ x: 0, y: 0 });
    setChrome(true);
    loadForViewer(file, (pct) => !cancelled && setProgress(pct), () => cancelled)
      .then((found) => {
        if (cancelled || !found) return;
        setUrl(found);
        for (const neighbour of [files[index + 1], files[index - 1]]) {
          if (neighbour && neighbour.mime.startsWith("image/") && neighbour.size <= PRELOAD_MAX_BYTES) {
            loadForViewer(neighbour, () => {}, () => cancelled).catch(() => {});
          }
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
    // Reload only when the shown file changes, not when the list object is rebuilt.
  }, [file.id, file.messageId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") go(index - 1);
      else if (e.key === "ArrowRight") go(index + 1);
      else if (e.key === "Home") go(0);
      else if (e.key === "End") go(files.length - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, index, files.length, onClose]);

  // ── Image gestures: pinch, pan, double-tap zoom, swipe to navigate or close ──
  const clamp = (v: View): View => {
    if (v.scale <= 1) return RESET;
    const limitX = (window.innerWidth * (v.scale - 1)) / 2;
    const limitY = (window.innerHeight * (v.scale - 1)) / 2;
    return { scale: v.scale, x: Math.min(Math.max(v.x, -limitX), limitX), y: Math.min(Math.max(v.y, -limitY), limitY) };
  };

  const onTouchStart = (e: React.TouchEvent) => {
    const t = touch.current;
    if (e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]];
      t.pinchDist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      t.pinchScale = viewRef.current.scale;
      t.multi = true;
    } else {
      t.startX = t.lastX = e.touches[0].clientX;
      t.startY = t.lastY = e.touches[0].clientY;
      t.moved = false;
      t.multi = false;
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const t = touch.current;
    if (e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const scale = Math.min(Math.max((t.pinchScale * dist) / (t.pinchDist || dist), 1), MAX_SCALE);
      setView((v) => clamp({ ...v, scale }));
      t.moved = true;
      return;
    }
    if (t.multi) return;
    const x = e.touches[0].clientX;
    const y = e.touches[0].clientY;
    if (Math.abs(x - t.startX) + Math.abs(y - t.startY) > 8) t.moved = true;
    if (viewRef.current.scale > 1) {
      const dx = x - t.lastX;
      const dy = y - t.lastY;
      setView((v) => clamp({ ...v, x: v.x + dx, y: v.y + dy }));
    } else {
      setDrag({ x: x - t.startX, y: y - t.startY });
    }
    t.lastX = x;
    t.lastY = y;
  };

  const onTouchEnd = () => {
    const t = touch.current;
    if (t.multi) {
      if (!viewRef.current || viewRef.current.scale <= 1.02) setView(RESET);
      return;
    }
    if (!t.moved) {
      const now = Date.now();
      if (now - t.lastTap < 300) {
        setView((v) => (v.scale > 1 ? RESET : { scale: 2.5, x: 0, y: 0 }));
        t.lastTap = 0;
      } else {
        t.lastTap = now;
      }
      setChrome((c) => !c);
      return;
    }
    if (viewRef.current.scale === 1) {
      const { x, y } = drag;
      if (Math.abs(x) > 70 && Math.abs(x) > Math.abs(y)) go(x < 0 ? index + 1 : index - 1);
      else if (y > 110) onClose();
    }
    setDrag({ x: 0, y: 0 });
  };

  const onWheel = (e: React.WheelEvent) => {
    const scale = Math.min(Math.max(viewRef.current.scale * (e.deltaY < 0 ? 1.15 : 0.87), 1), MAX_SCALE);
    setView((v) => clamp({ ...v, scale }));
  };

  const barBtn =
    "flex items-center justify-center h-11 w-11 rounded-full text-white bg-white/10 active:bg-white/25 disabled:opacity-30 border-0 cursor-pointer";
  const showBars = chrome || kind !== "image";
  const atFirst = index === 0;
  const atLast = index === files.length - 1;

  return (
    <div className="fixed inset-0 z-50 bg-black text-white select-none overflow-hidden animate-in fade-in duration-150">
      {/* Stage */}
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={kind === "image" ? { touchAction: "none" } : undefined}
        onTouchStart={kind === "image" ? onTouchStart : undefined}
        onTouchMove={kind === "image" ? onTouchMove : undefined}
        onTouchEnd={kind === "image" ? onTouchEnd : undefined}
        onWheel={kind === "image" ? onWheel : undefined}
        onClick={kind === "image" ? () => window.matchMedia("(pointer: fine)").matches && setChrome((c) => !c) : undefined}
      >
        {kind === "image" && (
          <>
            {/* Thumbnail first, sharp image on top once it is on disk. */}
            <div className="absolute inset-0" style={{ opacity: url ? 0 : 1, transition: "opacity 150ms" }}>
              <ThumbImage file={file} large contain>
                <span />
              </ThumbImage>
            </div>
            {url && (
              <img
                key={url}
                src={url}
                alt={file.name}
                draggable={false}
                className="max-w-full max-h-full object-contain"
                style={{
                  transform: `translate(${view.x + (view.scale === 1 ? drag.x : 0)}px, ${view.y + (view.scale === 1 ? drag.y : 0)}px) scale(${view.scale})`,
                  transition: touch.current.moved ? "none" : "transform 150ms",
                }}
              />
            )}
          </>
        )}
        {kind === "video" && url && (
          <video
            key={url}
            src={url}
            controls
            autoPlay
            playsInline
            className="max-w-full max-h-full pt-[calc(3.5rem+env(safe-area-inset-top))] pb-[calc(5rem+env(safe-area-inset-bottom))]"
          />
        )}
        {kind === "audio" && (
          <div className="flex flex-col items-center gap-6 px-8 w-full max-w-md">
            <div className="h-40 w-40 rounded-3xl bg-white/10 flex items-center justify-center">
              <Music className="h-16 w-16 text-white/70" />
            </div>
            <p className="text-center text-base font-semibold break-words">{file.name}</p>
            {url && (
              <audio
                key={url}
                src={url}
                controls
                autoPlay
                className="w-full"
                onEnded={() => !atLast && go(index + 1)}
              />
            )}
          </div>
        )}

        {!url && !error && (
          <div className="absolute inset-x-0 bottom-28 flex flex-col items-center gap-2 pointer-events-none">
            <Loader2 className="h-6 w-6 animate-spin" />
            <div className="h-1 w-40 rounded-full bg-white/20 overflow-hidden">
              <div className="h-full bg-white transition-all" style={{ width: `${progress}%` }} />
            </div>
            <span className="text-xs text-white/70">{progress}%</span>
          </div>
        )}
        {error && (
          <div className="absolute inset-x-6 bottom-28 text-center text-sm text-red-300">{error}</div>
        )}
      </div>

      {/* Top bar */}
      <div
        className="absolute top-0 inset-x-0 flex items-center gap-2 px-3 pb-2 bg-gradient-to-b from-black/70 to-transparent transition-opacity duration-150 pt-[calc(0.5rem+env(safe-area-inset-top))]"
        style={{ opacity: showBars ? 1 : 0, pointerEvents: showBars ? "auto" : "none" }}
        onClick={(e) => e.stopPropagation()}
      >
        <button className={barBtn} onClick={onClose} aria-label="Close">
          <X className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate">{file.name}</p>
          <p className="text-[11px] text-white/70">
            {index + 1} / {files.length}
          </p>
        </div>
        <button className={barBtn} onClick={() => onMenu(file)} aria-label="Actions">
          <MoreVertical className="h-5 w-5" />
        </button>
      </div>

      {/* Navigation bar */}
      <div
        className="absolute bottom-0 inset-x-0 flex items-center justify-center gap-3 pt-2 bg-gradient-to-t from-black/70 to-transparent transition-opacity duration-150 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
        style={{ opacity: showBars ? 1 : 0, pointerEvents: showBars ? "auto" : "none" }}
        onClick={(e) => e.stopPropagation()}
      >
        <button className={barBtn} disabled={atFirst} onClick={() => go(0)} aria-label="First">
          <ChevronsLeft className="h-5 w-5" />
        </button>
        <button className={barBtn} disabled={atFirst} onClick={() => go(index - 1)} aria-label="Previous">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <button className={barBtn} disabled={atLast} onClick={() => go(index + 1)} aria-label="Next">
          <ChevronRight className="h-5 w-5" />
        </button>
        <button className={barBtn} disabled={atLast} onClick={() => go(files.length - 1)} aria-label="Last">
          <ChevronsRight className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
