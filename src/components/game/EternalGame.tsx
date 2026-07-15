"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GameEngine, OPPONENTS, ROUNDS_TO_WIN } from "@/lib/game/engine";
import { render, VIRTUAL_H, VIRTUAL_W } from "@/lib/game/render";
import { GameAudio } from "@/lib/game/audio";
import { PostFX } from "@/lib/game/postfx";
import { coverScale } from "@/lib/game/canvas-utils";
import type { BackgroundId, InputState, Phase } from "@/lib/game/types";
import DestructionEnding from "./DestructionEnding";
import AIInsightsPanel from "./AIInsightsPanel";
import DirectorPanel from "./DirectorPanel";
import DirectorNarration from "./DirectorNarration";
import AIGenomeHud from "./AIGenomeHud";
import AIDecisionTicker from "./AIDecisionTicker";
import MatchDebriefPanel from "./MatchDebriefPanel";
import DirectorChipStrip from "./DirectorChipStrip";
import DirectorNotification from "./DirectorNotification";
import LiveAIDirector from "./LiveAIDirector";
import {
  createDirectorWatcher,
  watchDirector,
  resetDirectorJournal,
} from "@/lib/game/directorJournal";

interface Snapshot {
  phase: Phase;
  php: number;
  pmax: number;
  ehp: number;
  emax: number;
  pWins: number;
  eWins: number;
  roundNo: number;
  roundTimer: number;
  oppIndex: number;
  announce: { main: string; sub?: string; big?: boolean } | null;
  combo: number;
  maxCombo: number;
  pRage: number;
  eRage: number;
  twoPlayer: boolean;
}

function snapFrom(e: GameEngine): Snapshot {
  return {
    phase: e.phase,
    php: e.player.hp,
    pmax: e.player.maxHp,
    ehp: e.enemy.hp,
    emax: e.enemy.maxHp,
    pWins: e.playerWins,
    eWins: e.enemyWins,
    roundNo: e.roundNo,
    roundTimer: e.roundTimer,
    oppIndex: e.opponentIndex,
    announce: e.announce
      ? { main: e.announce.main, sub: e.announce.sub, big: e.announce.big }
      : null,
    combo: e.playerCombo,
    maxCombo: e.maxCombo,
    pRage: e.player.rageMeter,
    eRage: e.enemy.rageMeter,
    twoPlayer: e.twoPlayer,
  };
}

const KEY_MAP: Record<string, keyof InputState> = {
  KeyA: "left", KeyD: "right", KeyW: "up", Space: "up", KeyS: "down",
  KeyJ: "punch", KeyZ: "punch", KeyK: "kick", KeyX: "kick",
  KeyI: "roundhouse", KeyU: "roundhouse", KeyE: "roll", KeyO: "roll",
  KeyL: "block", KeyC: "block", ShiftLeft: "block", ShiftRight: "block",
  KeyQ: "super",
  KeyF: "throw", KeyT: "throw",
};
const P2_KEY_MAP: Record<string, keyof InputState> = {
  ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down",
  Comma: "punch", Period: "kick", Slash: "roundhouse",
  Semicolon: "roll", Quote: "block", BracketRight: "super",
  BracketLeft: "throw",
};
const P1_ARROW_MAP: Record<string, keyof InputState> = {
  ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down",
};

const SETTINGS_KEY = "eternal_settings_v1";
const PROGRESS_KEY = "eternal_progress_v1";


function loadSettings(): {
  volume: number;
  muted: boolean;
  showAiChrome: boolean;
  photosensitive: boolean;
} {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { volume: 0.55, muted: false, showAiChrome: true, photosensitive: false };
    const p = JSON.parse(raw) as Partial<{
      volume: number;
      muted: boolean;
      showAiChrome: boolean;
      photosensitive: boolean;
    }>;
    return {
      volume: typeof p.volume === "number" ? p.volume : 0.55,
      muted: !!p.muted,
      showAiChrome: p.showAiChrome !== false,
      photosensitive: !!p.photosensitive,
    };
  } catch {
    return { volume: 0.55, muted: false, showAiChrome: true, photosensitive: false };
  }
}

function emptyInput(): InputState {
  return {
    left: false,
    right: false,
    up: false,
    down: false,
    punch: false,
    kick: false,
    roundhouse: false,
    roll: false,
    block: false,
    super: false,
    throw: false,
  };
}

export default function EternalGame() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fxCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const postFXRef = useRef<PostFX | null>(null);
  const [eng] = useState(() => new GameEngine());
  const [audio] = useState(() => new GameAudio());
  useEffect(() => {
    // Enforce a single soundtrack owner when transitioning from the story.
    window.dispatchEvent(new Event("eternal:game-audio-start"));
  }, []);
  const initialSettings = useState(() => loadSettings())[0];
  const [muted, setMuted] = useState(initialSettings.muted);
  const [volume, setVolume] = useState(initialSettings.volume);
  const [showAiChrome, setShowAiChrome] = useState(initialSettings.showAiChrome);
  const [photosensitive, setPhotosensitive] = useState(initialSettings.photosensitive);
  const [showSettings, setShowSettings] = useState(false);
  const [view, setView] = useState<"menu" | "select">("menu");
  const [selOpp, setSelOpp] = useState(0);
  const [selScene, setSelScene] = useState<BackgroundId | "auto">("auto");
  const [storyCard, setStoryCard] = useState<{ name: string; title: string; story: string; seals: number } | null>(null);
  const [showTutorial, setShowTutorial] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);
  const [isNarrow, setIsNarrow] = useState(false);

  const keysRef = useRef<InputState>(emptyInput());
  const p2KeysRef = useRef<InputState>(emptyInput());

  const [snap, setSnap] = useState<Snapshot>(() => snapFrom(eng));
  const [started, setStarted] = useState(false);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  // AI transparency modal panels + the GA champion toggle. These are
  // open from the in-fight toolbar so the player can inspect the
  // Director, the genome HUD, and the AI insights on demand.
  const [showDirector, setShowDirector] = useState(false);
  const [showAIInsights, setShowAIInsights] = useState(false);
  const [useChampion, setUseChampion] = useState(true);
  const [championLoaded, setChampionLoaded] = useState(false);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  // Persist settings + apply engine/audio knobs
  useEffect(() => {
    audio.setVolume(muted ? 0 : volume);
    eng.photosensitive = photosensitive;
    try {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({ volume, muted, showAiChrome, photosensitive }),
      );
    } catch { /* private mode */ }
  }, [audio, eng, volume, muted, showAiChrome, photosensitive]);

  useEffect(() => {
    const check = () => setIsNarrow(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // ---- pause: ESC or P during intro or fight ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.code === "Escape" || e.code === "KeyP") &&
        started &&
        (snap.phase === "fight" || snap.phase === "intro")
      ) {
        e.preventDefault();
        setPaused((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [started, snap.phase]);

  // ---- load the evolved champion genome (GA artifact) ----
  // The champion is the AI brain produced by the Genetic Algorithm.
  // Toggling the GA button overlays it onto the current enemy AI.
  // The /api/ai/champion route returns { ok, ..., genome: { ...genes } }
  // so we extract the inner genome payload before handing it to the
  // engine — otherwise genes would be buried under .genome and crash.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/ai/champion")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (!data || typeof data !== "object") return;
        // accept either a bare genome payload OR the API envelope
        const payload = "genome" in data && data.genome ? data.genome : data;
        if (
          payload &&
          typeof payload === "object" &&
          payload.genes &&
          typeof payload.genes === "object"
        ) {
          eng.setChampionOverride(payload);
          setChampionLoaded(true);
        }
      })
      .catch(() => {
        // endpoint may be unavailable in some environments — silently
        // disable the GA toggle rather than throwing on mount.
      });
    return () => {
      cancelled = true;
    };
  }, [eng]);

  // keep the engine's GA toggle in sync with the button
  useEffect(() => {
    eng.setUseChampionGenome(useChampion);
  }, [eng, useChampion]);
  // Persistent Director watcher — survives remounts; reset explicitly on
  // match start (nextMatch/retry/etc.).
  // Qwen is NEVER called during gameplay — only after a match (MatchDebriefPanel)
  // for analysis + next-genome selection. Combat uses Classic Director only.
  const directorWatchRef = useRef(createDirectorWatcher());
  const directorAccRef = useRef(0);

  /** Instant Classic Director for the upcoming fight (no Qwen, no intro hold). */
  const applyClassicDirectorForFight = useCallback(() => {
    if (eng.twoPlayer) return;
    eng.applyOfflineDirector("Classic Director — combat plan.");
  }, [eng]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    let last = performance.now();
    let snapAcc = 0;

    const resize = () => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      // Fill the entire viewport (cover), letterboxing nothing.
      const vw = wrap.clientWidth;
      const vh = wrap.clientHeight;
      // scale so the 960x540 virtual stage covers the viewport
      const scale = coverScale(vw, vh, VIRTUAL_W, VIRTUAL_H);
      const w = VIRTUAL_W * scale;
      const h = VIRTUAL_H * scale;
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      canvas.style.position = "absolute";
      canvas.style.left = (vw - w) / 2 + "px";
      canvas.style.top = (vh - h) / 2 + "px";
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    };
    resize();

    // initialize WebGL post-processing
    const fxCanvas = fxCanvasRef.current;
    if (fxCanvas && !postFXRef.current) {
      postFXRef.current = new PostFX(fxCanvas);
    }

    // resize both canvases together
    const resizeAll = () => {
      resize();
      if (fxCanvas) {
        fxCanvas.style.width = canvas.style.width;
        fxCanvas.style.height = canvas.style.height;
        fxCanvas.style.position = "absolute";
        fxCanvas.style.left = canvas.style.left;
        fxCanvas.style.top = canvas.style.top;
        fxCanvas.style.pointerEvents = "none";
        fxCanvas.width = canvas.width;
        fxCanvas.height = canvas.height;
      }
    };
    resizeAll();
    const ro = new ResizeObserver(resizeAll);
    ro.observe(wrapRef.current!);

    const loop = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;

      // feed input
      eng.input = { ...keysRef.current };
      eng.p2Input = { ...p2KeysRef.current };

      // skip game simulation when paused (but keep rendering)
      if (!pausedRef.current) {
        eng.update(dt);
      }

      // drain VFX events -> fire audio stingers + combat intensity
      for (const ev of eng.events) {
        const audioKind: "punch" | "kick" | "roundhouse" | "throw" =
          ev.hitType === "kick"
            ? "kick"
            : ev.hitType === "punch"
              ? "punch"
              : ev.hitType === "throw"
                ? "throw"
                : "roundhouse";
        if (ev.kind === "ko") {
          audio.hit("ko");
        } else if (ev.kind === "heavy") {
          audio.hit(audioKind);
        } else if (ev.kind === "hit") {
          audio.hit(audioKind);
        } else if (ev.kind === "block") {
          audio.hit("block");
        }
      }
      if (eng.events.length) eng.events.length = 0;
      // render
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const baseScale = coverScale(canvas.width, canvas.height, VIRTUAL_W, VIRTUAL_H); // cover: canvas is at least virtual size
      // punch-zoom around center
      const z = 1 + eng.zoom * 0.07;
      const ox = (canvas.width - VIRTUAL_W * baseScale) / 2;
      const oy = (canvas.height - VIRTUAL_H * baseScale) / 2;
      const tx = ox + baseScale * (VIRTUAL_W * (1 - z)) / 2;
      const ty = oy + baseScale * (VIRTUAL_H * (1 - z)) / 2;
      ctx.setTransform(baseScale * z, 0, 0, baseScale * z, tx, ty);
      // screen shake
      if (eng.shake > 0) {
        const s = eng.shake;
        ctx.translate(
          (Math.random() - 0.5) * s,
          (Math.random() - 0.5) * s,
        );
      }
      ctx.save();
      render(ctx, eng);
      ctx.restore();

      // colored impact flash
      if (eng.flash > 0) {
        ctx.globalAlpha = Math.min(1, eng.flash * 1.6);
        ctx.fillStyle = eng.flashColor || "#ffffff";
        ctx.fillRect(-2000, -2000, canvas.width + 4000, canvas.height + 4000);
        ctx.globalAlpha = 1;
      }

      // WebGL post-processing: bloom + chromatic aberration + vignette
      const fx = postFXRef.current;
      if (fx && fx.isAvailable) {
        // bloom scales with combat intensity; chromAb scales with engine chromAb state
        const bloom = 0.42;
        const ca = eng.chromAb * 0.8;
        fx.render(canvas, bloom, ca, 0.5);
      }

      // Director watcher — throttled so we don't spam the UI.
      // Pure read against `engine.directorState`; no new computation.
      directorAccRef.current += dt;
      if (directorAccRef.current >= 0.25) {
        directorAccRef.current = 0;
        watchDirector(eng, directorWatchRef.current);
      }

      // throttle snapshot
      snapAcc += dt;
      if (snapAcc >= 0.05) {
        snapAcc = 0;
        setSnap(snapFrom(eng));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [eng, audio]);

  // ---- keyboard ----
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const isArrow = e.code in P1_ARROW_MAP;
      if (eng.twoPlayer && isArrow) {
        e.preventDefault();
        p2KeysRef.current[P1_ARROW_MAP[e.code]] = true;
        return;
      }
      const k = KEY_MAP[e.code];
      if (k) { e.preventDefault(); keysRef.current[k] = true; return; }
      if (!eng.twoPlayer && isArrow) {
        e.preventDefault();
        keysRef.current[P1_ARROW_MAP[e.code]] = true;
        return;
      }
      const k2 = P2_KEY_MAP[e.code];
      if (k2 && !isArrow) { e.preventDefault(); p2KeysRef.current[k2] = true; }
    };
    const up = (e: KeyboardEvent) => {
      const isArrow = e.code in P1_ARROW_MAP;
      if (eng.twoPlayer && isArrow) {
        e.preventDefault();
        p2KeysRef.current[P1_ARROW_MAP[e.code]] = false;
        return;
      }
      const k = KEY_MAP[e.code];
      if (k) { e.preventDefault(); keysRef.current[k] = false; return; }
      if (!eng.twoPlayer && isArrow) {
        e.preventDefault();
        keysRef.current[P1_ARROW_MAP[e.code]] = false;
        return;
      }
      const k2 = P2_KEY_MAP[e.code];
      if (k2 && !isArrow) { e.preventDefault(); p2KeysRef.current[k2] = false; }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    const blur = () => {
      keysRef.current = emptyInput();
      p2KeysRef.current = emptyInput();
    };
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  // ---- touch controls ----
  const setKey = (k: keyof InputState, v: boolean) => {
    keysRef.current[k] = v;
  };

  const beginFightSession = useCallback(
    (opts?: { skipDirector?: boolean }) => {
      setPaused(false);
      setStarted(true);
      setSnap(snapFrom(eng));
      resetDirectorJournal();
      directorWatchRef.current = createDirectorWatcher();
      if (!muted) void audio.start();
      // Classic Director only — Qwen runs after the match, not before/during.
      if (!opts?.skipDirector) applyClassicDirectorForFight();
    },
    [eng, audio, muted, applyClassicDirectorForFight],
  );

  const start = useCallback(() => {
    eng.startMatch();
    try {
      localStorage.setItem(PROGRESS_KEY, JSON.stringify({ unlocked: 0, seals: 0 }));
    } catch { /* ignore */ }
    const o = OPPONENTS[0];
    setStoryCard({
      name: o.name,
      title: o.title,
      story: o.story ?? "The hunt begins.",
      seals: 0,
    });
    beginFightSession();
  }, [eng, beginFightSession]);

  const startSelect = useCallback(() => {
    eng.startMatchWith(selOpp, selScene === "auto" ? null : selScene);
    beginFightSession();
  }, [eng, selOpp, selScene, beginFightSession]);

  const startTwoPlayer = useCallback(() => {
    eng.startTwoPlayer();
    beginFightSession({ skipDirector: true });
  }, [eng, beginFightSession]);

  const startPractice = useCallback(() => {
    eng.startPractice(selOpp, true);
    beginFightSession({ skipDirector: true });
  }, [eng, selOpp, beginFightSession]);

  const backToMenu = useCallback(() => {
    eng.toMenu();
    setStarted(false);
    setView("menu");
    setStoryCard(null);
    setShowTutorial(false);
    setSnap(snapFrom(eng));
    resetDirectorJournal();
    directorWatchRef.current = createDirectorWatcher();
  }, [eng]);

  const nextOpp = useCallback(() => {
    const nextIndex = eng.opponentIndex + 1;
    const seals = Math.min(OPPONENTS.length, nextIndex);
    try {
      localStorage.setItem(
        PROGRESS_KEY,
        JSON.stringify({ unlocked: nextIndex, seals }),
      );
    } catch { /* ignore */ }
    eng.nextOpponent();
    if (eng.phase === "champion") {
      setSnap(snapFrom(eng));
      return;
    }
    const o = OPPONENTS[eng.opponentIndex];
    setStoryCard({
      name: o.name,
      title: o.title,
      story: o.story ?? "",
      seals,
    });
    setSnap(snapFrom(eng));
    resetDirectorJournal();
    directorWatchRef.current = createDirectorWatcher();
    if (!muted) void audio.start();
    applyClassicDirectorForFight();
  }, [eng, audio, muted, applyClassicDirectorForFight]);

  const retry = useCallback(() => {
    eng.retryMatch();
    setSnap(snapFrom(eng));
    resetDirectorJournal();
    directorWatchRef.current = createDirectorWatcher();
    if (!muted) void audio.start();
    applyClassicDirectorForFight();
  }, [eng, audio, muted, applyClassicDirectorForFight]);

  const restart = useCallback(() => {
    eng.startMatch();
    setSnap(snapFrom(eng));
    resetDirectorJournal();
    directorWatchRef.current = createDirectorWatcher();
    if (!muted) void audio.start();
    applyClassicDirectorForFight();
  }, [eng, audio, muted, applyClassicDirectorForFight]);

  // Skip straight to the destruction ending — a debug/convenience shortcut
  // that bypasses the tournament and crowns the shadow immediately.
  const skipToEnding = useCallback(() => {
    eng.skipToChampion();
    setStarted(true);
    setSnap(snapFrom(eng));
    if (!muted) void audio.start();
  }, [eng, audio, muted]);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      const nm = !m;
      if (nm) audio.stop();
      else if (started) void audio.start();
      return nm;
    });
  }, [audio, started]);

  const dismissStoryCard = useCallback(() => setStoryCard(null), []);

  const startTutorial = useCallback(() => {
    setShowTutorial(true);
    setTutorialStep(0);
    eng.startPractice(0, true);
    beginFightSession({ skipDirector: true });
  }, [eng, beginFightSession]);

  // stop audio when the component unmounts
  useEffect(() => {
    return () => audio.dispose();
  }, [audio]);

  const opp = OPPONENTS[snap.oppIndex];
  const phpPct = Math.max(0, (snap.php / snap.pmax) * 100);
  const ehpPct = Math.max(0, (snap.ehp / snap.emax) * 100);
  const showMenu = !started;
  const showMatchEnd = started && snap.phase === "match_end" && !eng.practiceMode;
  const showGameOver = started && snap.phase === "game_over" && !eng.practiceMode;
  const showChampion = started && snap.phase === "champion";
  const hideGameUI = showChampion;
  const canPause =
    started && (snap.phase === "fight" || snap.phase === "intro");

  return (
    <div className="fixed inset-0 bg-black overflow-hidden">
      {/* RHS bottom: pause / mute / settings (vertical) */}
      {!hideGameUI && (
        <div className="absolute bottom-3 right-3 z-40 flex flex-col-reverse items-center gap-2">
          <button
            type="button"
            onClick={() => setShowSettings((s) => !s)}
            aria-label="Settings"
            className="w-9 h-9 rounded-full border border-white/20 bg-black/50 backdrop-blur text-white/80 hover:bg-white/15 active:scale-95 transition flex items-center justify-center text-xs font-bold"
          >
            ⚙
          </button>
          <button
            type="button"
            onClick={toggleMute}
            aria-label={muted ? "Unmute music" : "Mute music"}
            className="w-9 h-9 rounded-full border border-white/20 bg-black/50 backdrop-blur text-white/80 hover:bg-white/15 active:scale-95 transition flex items-center justify-center"
          >
            {muted ? <MuteIcon /> : <SoundIcon />}
          </button>
          {canPause && (
            <button
              type="button"
              onClick={() => setPaused((p) => !p)}
              aria-label={paused ? "Resume" : "Pause"}
              className="w-9 h-9 rounded-full border border-white/20 bg-black/50 backdrop-blur text-white/80 hover:bg-white/15 active:scale-95 transition flex items-center justify-center text-xs"
            >
              {paused ? "▶" : "❚❚"}
            </button>
          )}
        </div>
      )}

      {/* GA toggle — below HP bar, above weather chips */}
      {!hideGameUI && started && snap.phase === "fight" && (
        <div className="absolute top-[4.5rem] sm:top-20 left-3 z-40">
          <button
            type="button"
            disabled={!championLoaded}
            onClick={() => setUseChampion((v) => !v)}
            data-testid="btn-ga-toggle"
            className={
              "h-9 px-3 sm:px-4 rounded-full border text-[10px] sm:text-xs font-bold tracking-wider transition flex items-center gap-1.5 backdrop-blur " +
              (useChampion
                ? "border-amber-300 bg-amber-500/30 text-amber-100 hover:bg-amber-500/40"
                : "border-amber-400/30 bg-amber-950/40 text-amber-200 hover:bg-amber-900/60 hover:text-amber-100") +
              " active:scale-95" +
              (championLoaded ? "" : " opacity-50 cursor-not-allowed")
            }
          >
            <span>GA</span>
            <span>{useChampion ? "ON" : championLoaded ? "off" : "…"}</span>
          </button>
        </div>
      )}

      {/* Settings popover */}
      {showSettings && !hideGameUI && (
        <div className="absolute bottom-14 right-3 z-50 w-64 rounded-xl border border-white/15 bg-zinc-950/95 p-3 text-white shadow-2xl backdrop-blur">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold tracking-[0.25em] text-zinc-400">SETTINGS</span>
            <button type="button" className="text-zinc-500 text-xs" onClick={() => setShowSettings(false)}>✕</button>
          </div>
          <label className="flex items-center justify-between text-xs mb-2 gap-2">
            <span>Volume</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={(e) => {
                const v = Number(e.target.value);
                setVolume(v);
                if (v > 0 && muted) setMuted(false);
              }}
              className="w-28"
            />
          </label>
          <label className="flex items-center justify-between text-xs mb-2">
            <span>Show AI chrome</span>
            <input type="checkbox" checked={showAiChrome} onChange={(e) => setShowAiChrome(e.target.checked)} />
          </label>
          <label className="flex items-center justify-between text-xs mb-1">
            <span>Reduce flash</span>
            <input
              type="checkbox"
              checked={photosensitive}
              onChange={(e) => setPhotosensitive(e.target.checked)}
            />
          </label>
          <p className="text-[9px] text-zinc-500 mt-2 leading-snug">
            Throw: F / T (or P+K). Stand block stops all strikes; throws beat pure turtling.
          </p>
        </div>
      )}

      {/* pause overlay */}
      {paused && canPause && (
        <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="text-center max-w-md">
            <h2 className="text-white text-5xl sm:text-7xl font-black tracking-tight mb-4">PAUSED</h2>
            <div className="hidden md:grid grid-cols-2 gap-1.5 text-[10px] text-zinc-400 mb-6 text-left">
              <Control keys="WASD / ←→" label="Move" />
              <Control keys="J / K / I" label="P / K / RH" />
              <Control keys="F / T or P+K" label="Throw" />
              <Control keys="L / E" label="Block / Roll" />
              <Control keys="Q" label="Super (full rage)" />
            </div>
            <button
              onClick={() => setPaused(false)}
              className="text-white/60 text-sm tracking-[0.3em] hover:text-white transition-colors duration-300"
            >
              RESUME ▶
            </button>
            <button
              onClick={() => { setPaused(false); backToMenu(); }}
              className="block mx-auto mt-4 text-white/20 text-xs tracking-[0.3em] hover:text-white/40 transition-colors duration-300"
            >
              QUIT TO MENU
            </button>
          </div>
        </div>
      )}

      {/* Story interstitial between sealers */}
      {storyCard && started && (
        <div className="absolute inset-0 z-[45] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <button
            type="button"
            onClick={dismissStoryCard}
            className="max-w-lg w-full rounded-2xl border border-rose-900/40 bg-zinc-950/90 p-6 text-center hover:border-rose-500/50 transition"
          >
            <p className="text-[10px] tracking-[0.35em] text-rose-400/70 mb-2">
              SEAL {storyCard.seals} / {OPPONENTS.length}
            </p>
            <h2 className="text-3xl sm:text-4xl font-black text-white mb-1">{storyCard.name}</h2>
            <p className="text-amber-200/80 text-sm mb-4">{storyCard.title}</p>
            <p className="text-zinc-400 text-sm italic leading-relaxed mb-5">{storyCard.story}</p>
            <span className="text-[11px] tracking-[0.3em] text-white/50">TAP TO CONTINUE</span>
          </button>
        </div>
      )}

      {/* Tutorial banner */}
      {showTutorial && started && snap.phase === "fight" && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-40 max-w-sm w-[90%] rounded-xl border border-emerald-400/30 bg-black/80 px-4 py-3 text-center pointer-events-auto">
          <p className="text-[10px] tracking-[0.3em] text-emerald-400 mb-1">TUTORIAL · {tutorialStep + 1}/4</p>
          <p className="text-sm text-white mb-2">
            {tutorialStep === 0 && "Move with WASD or arrows. Feel the spacing."}
            {tutorialStep === 1 && "Press J to punch. Keep pressure."}
            {tutorialStep === 2 && "Hold L to block strikes. Chip damage still sneaks through."}
            {tutorialStep === 3 && "Press E to roll, F to throw pure turtling foes."}
          </p>
          <div className="flex gap-2 justify-center">
            <button
              type="button"
              className="text-[10px] tracking-widest text-emerald-300 border border-emerald-400/30 rounded-full px-3 py-1"
              onClick={() => {
                if (tutorialStep >= 3) setShowTutorial(false);
                else setTutorialStep((s) => s + 1);
              }}
            >
              {tutorialStep >= 3 ? "DONE" : "NEXT"}
            </button>
            <button
              type="button"
              className="text-[10px] tracking-widest text-zinc-500"
              onClick={() => setShowTutorial(false)}
            >
              SKIP
            </button>
          </div>
        </div>
      )}

        {/* HUD top bar */}
        <div className="absolute top-0 left-0 right-0 z-20 p-2 sm:p-3 pointer-events-none">
          <div className="flex items-start gap-2 sm:gap-4">
            {/* player */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] sm:text-xs font-bold tracking-widest text-rose-200/90 truncate">
                  {snap.twoPlayer ? "PLAYER 1" : "THE SHADOW"}
                </span>
                <Pips n={snap.pWins} color="#e2e8f0" />
              </div>
              <HealthBar pct={phpPct} align="left" color="from-rose-600 to-amber-400" />
              <RageBar pct={(snap.pRage / 100) * 100} align="left" />
            </div>
            {/* timer */}
            <div className="flex flex-col items-center px-1">
              <span className="text-xl sm:text-3xl font-black tabular-nums text-white leading-none drop-shadow">
                {Math.ceil(snap.roundTimer)}
              </span>
              <span className="text-[9px] sm:text-[10px] tracking-widest text-white/60">
                ROUND {snap.roundNo}
              </span>
            </div>
            {/* enemy */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <Pips n={snap.eWins} color={opp.rim} />
                <span
                  className="text-[10px] sm:text-xs font-bold tracking-widest truncate text-right"
                  style={{ color: opp.rim }}
                >
                  {snap.twoPlayer ? "PLAYER 2" : opp.name.toUpperCase()}
                </span>
              </div>
              <HealthBar pct={ehpPct} align="right" color="from-rose-700 to-fuchsia-500" />
              <RageBar pct={(snap.eRage / 100) * 100} align="right" />
              <span className="block text-[9px] sm:text-[10px] text-white/50 text-right mt-0.5 truncate">
                {snap.twoPlayer ? "Versus" : opp.title}
              </span>
            </div>
          </div>
        </div>

        {/* Live director chrome — hidden on mobile unless AI chrome enabled */}
        {!hideGameUI && started && snap.phase === "fight" && showAiChrome && !isNarrow && (
          <div className="absolute top-14 sm:top-16 left-0 right-0 z-30 px-3">
            <DirectorNarration engine={eng} visible />
          </div>
        )}

        {!hideGameUI && started && snap.phase === "fight" && showAiChrome && (
          <DirectorChipStrip engine={eng} visible />
        )}

        {!hideGameUI && started && (snap.phase === "intro" || snap.phase === "fight") && showAiChrome && !isNarrow && (
          <LiveAIDirector engine={eng} />
        )}

        {!hideGameUI && started && showAiChrome && (
          <DirectorNotification />
        )}

        {!hideGameUI && started && snap.phase === "fight" && showAiChrome && !isNarrow && (
          <div className="absolute bottom-2 sm:bottom-3 left-2 sm:left-3 z-20 pointer-events-none">
            <AIGenomeHud engine={eng} visible />
          </div>
        )}

        {/* Combo */}
        {snap.combo > 1 && (snap.phase === "fight" || snap.phase === "intro") && (
          <div className="absolute left-3 sm:left-6 top-20 sm:top-24 z-20 pointer-events-none">
            <div
              className="text-2xl sm:text-4xl font-black text-amber-300 drop-shadow-[0_2px_6px_rgba(0,0,0,0.8)]"
              style={{ textShadow: "0 0 12px rgba(245,158,11,0.7)" }}
            >
              {snap.combo} HIT
            </div>
          </div>
        )}

        {/* Announcement */}
        {snap.announce && (
          <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
            <div className="text-center animate-[sfpop_0.3s_ease-out]">
              <div
                className="font-black tracking-tight text-white px-4"
                style={{
                  fontSize: snap.announce.big ? "clamp(2.5rem,9vw,6rem)" : "clamp(1.5rem,5vw,3rem)",
                  textShadow: "0 0 24px rgba(255,120,60,0.8), 0 4px 12px rgba(0,0,0,0.9)",
                }}
              >
                {snap.announce.main}
              </div>
              {snap.announce.sub && (
                <div className="mt-1 text-sm sm:text-base text-amber-200/90 font-semibold tracking-wide">
                  {snap.announce.sub}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Canvas — fills the entire viewport */}
        <div ref={wrapRef} className="absolute inset-0 bg-black">
          <canvas ref={canvasRef} className="block" />
          {/* WebGL post-processing overlay (bloom + chromatic aberration) */}
          <canvas
            ref={fxCanvasRef}
            className="block"
            style={{ pointerEvents: "none" }}
          />
        </div>

        {/* Touch controls (mobile) */}
        <TouchControls
          visible={started && snap.phase === "fight"}
          onKey={setKey}
        />

        {/* Desktop controls hint */}
        {started && snap.phase === "fight" && (
          <div className="hidden md:flex absolute bottom-2 left-1/2 -translate-x-1/2 z-20 gap-2 text-[10px] text-white/40 pointer-events-none flex-wrap justify-center px-2">
            <Key>WASD</Key> Move <Key>J</Key> Punch <Key>K</Key> Kick <Key>I</Key> RH
            <Key>F</Key> Throw <Key>E</Key> Roll <Key>L</Key> Block
          </div>
        )}

        {/* Practice mode badge */}
        {started && eng.practiceMode && snap.phase === "fight" && (
          <div className="absolute top-14 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
            <span className="text-[10px] tracking-[0.3em] text-emerald-300/80 border border-emerald-400/20 rounded-full px-3 py-1 bg-black/50">
              PRACTICE · INFINITE HP
            </span>
          </div>
        )}

      {/* Phase panel overlays */}
      {showMenu && view === "menu" && (
        <MenuPanel
          onStart={start}
          onSelect={() => setView("select")}
          onTwoPlayer={startTwoPlayer}
          onPractice={() => { setView("select"); }}
          onTutorial={startTutorial}
          onSkipToEnding={skipToEnding}
        />
      )}
      {showMenu && view === "select" && (
        <SelectPanel
          selOpp={selOpp}
          selScene={selScene}
          onOpp={setSelOpp}
          onScene={setSelScene}
          onBack={() => setView("menu")}
          onFight={startSelect}
          onPractice={startPractice}
        />
      )}
      {showMatchEnd && (
        <MatchDebriefPanel
          engine={eng}
          title="THE SEALER FALLS"
          subtitle={`${opp.name} is broken. Another seal is yours — the gate groans wider.`}
          accent="#f59e0b"
          info={`Best combo: ${snap.maxCombo} hits · Seals ${Math.min(OPPONENTS.length, snap.oppIndex + 1)}/${OPPONENTS.length}`}
          primary={{ label: "Hunt the Next Sealer", onClick: nextOpp }}
          secondary={{ label: "The Riverbank", onClick: backToMenu }}
          result="win"
        />
      )}
      {showGameOver && (
        <MatchDebriefPanel
          engine={eng}
          title="DRIVEN BACK"
          subtitle={`${opp.name}'s chains bite deep. You are caged once more... for now.`}
          accent="#f87171"
          info={`Best combo: ${snap.maxCombo} hits`}
          primary={{ label: "Break Free", onClick: retry }}
          secondary={{ label: "The Riverbank", onClick: backToMenu }}
          result="loss"
        />
      )}
      {showChampion && (
        <DestructionEnding
          maxCombo={snap.maxCombo}
          onRestart={restart}
          onMenu={backToMenu}
        />
      )}

      {/* AI transparency modal panels — opened from the in-fight toolbar. */}
      {showAIInsights && (
        <AIInsightsPanel onClose={() => setShowAIInsights(false)} />
      )}
      {showDirector && (
        <DirectorPanel engine={eng} onClose={() => setShowDirector(false)} />
      )}
    </div>
  );
}

function HealthBar({
  pct,
  align,
  color,
}: {
  pct: number;
  align: "left" | "right";
  color: string;
}) {
  return (
    <div className="h-3 sm:h-4 w-full bg-black/60 border border-white/20 rounded-sm overflow-hidden relative">
      <div
        className={`h-full bg-gradient-to-r ${color} transition-[width] duration-200 ease-out ${
          align === "right" ? "ml-auto" : ""
        }`}
        style={{ width: `${pct}%` }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-white/25 to-transparent pointer-events-none" />
    </div>
  );
}

function RageBar({ pct, align }: { pct: number; align: "left" | "right" }) {
  const full = pct >= 100;
  return (
    <div
      className={`mt-1 h-1.5 sm:h-2 w-full bg-black/60 border border-amber-900/40 rounded-sm overflow-hidden relative ${
        full ? "animate-pulse" : ""
      }`}
    >
      <div
        className={`h-full transition-[width] duration-150 ease-out ${
          align === "right" ? "ml-auto" : ""
        } ${full ? "bg-gradient-to-r from-amber-300 via-orange-400 to-rose-500" : "bg-gradient-to-r from-amber-700/70 to-amber-500/80"}`}
        style={{
          width: `${pct}%`,
          boxShadow: full ? "0 0 8px rgba(251,191,36,0.9)" : "none",
        }}
      />
      {full && (
        <span
          className={`absolute top-1/2 -translate-y-1/2 text-[8px] sm:text-[9px] font-black tracking-widest text-amber-100 ${
            align === "right" ? "right-1" : "left-1"
          }`}
          style={{ textShadow: "0 0 4px rgba(0,0,0,0.9)" }}
        >
          RAGE
        </span>
      )}
    </div>
  );
}

function Pips({ n, color }: { n: number; color: string }) {
  return (
    <div className="flex gap-1">
      {Array.from({ length: ROUNDS_TO_WIN }).map((_, i) => (
        <span
          key={i}
          className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full border"
          style={{
            background: i < n ? color : "transparent",
            borderColor: color,
            boxShadow: i < n ? `0 0 6px ${color}` : "none",
          }}
        />
      ))}
    </div>
  );
}

function SoundIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 5 6 9H2v6h4l5 4z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18.5 5.5a9 9 0 0 1 0 13" />
    </svg>
  );
}

function MuteIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 5 6 9H2v6h4l5 4z" />
      <line x1="22" y1="9" x2="16" y2="15" />
      <line x1="16" y1="9" x2="22" y2="15" />
    </svg>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="px-1.5 py-0.5 rounded bg-white/10 border border-white/20 text-white/70 font-mono">
      {children}
    </kbd>
  );
}

function TouchControls({
  visible,
  onKey,
}: {
  visible: boolean;
  onKey: (k: keyof InputState, v: boolean) => void;
}) {
  const mk = (k: keyof InputState, label: string, cls: string) => (
    <button
      type="button"
      className={`pointer-events-auto select-none rounded-full border border-white/25 backdrop-blur-sm bg-white/5 active:bg-white/25 text-white font-bold flex items-center justify-center touch-manipulation ${cls}`}
      onPointerDown={(e) => {
        e.preventDefault();
        onKey(k, true);
      }}
      onPointerUp={(e) => {
        e.preventDefault();
        onKey(k, false);
      }}
      onPointerLeave={() => onKey(k, false)}
      onPointerCancel={() => onKey(k, false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {label}
    </button>
  );
  if (!visible) return null;
  return (
    <div className="md:hidden absolute inset-x-0 bottom-0 z-20 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] flex items-end justify-between pointer-events-none gap-2">
      <div className="grid grid-cols-3 gap-2 w-32">
        <div />
        {mk("up", "↑", "h-11 text-base")}
        <div />
        {mk("left", "←", "h-11 text-base")}
        {mk("down", "↓", "h-11 text-base")}
        {mk("right", "→", "h-11 text-base")}
      </div>
      <div className="grid grid-cols-4 gap-1.5 w-48">
        {mk("punch", "P", "h-12 bg-amber-500/25 border-amber-400/40 text-xs")}
        {mk("kick", "K", "h-12 bg-fuchsia-500/25 border-fuchsia-400/40 text-xs")}
        {mk("roundhouse", "RH", "h-12 bg-rose-500/25 border-rose-400/40 text-[10px]")}
        {mk("throw", "THR", "h-12 bg-orange-500/25 border-orange-400/40 text-[10px]")}
        {mk("roll", "ROLL", "h-10 bg-emerald-500/25 border-emerald-400/40 text-[10px]")}
        {mk("block", "BLK", "h-10 bg-sky-500/25 border-sky-400/40 text-[10px]")}
        {mk("super", "SP", "h-10 bg-amber-400/20 border-amber-300/40 text-[10px]")}
        {mk("down", "CR", "h-10 bg-white/10 border-white/20 text-[10px]")}
      </div>
    </div>
  );
}

function MenuPanel({
  onStart,
  onSelect,
  onTwoPlayer,
  onPractice,
  onTutorial,
  onSkipToEnding,
}: {
  onStart: () => void;
  onSelect: () => void;
  onTwoPlayer: () => void;
  onPractice: () => void;
  onTutorial: () => void;
  onSkipToEnding: () => void;
}) {
  return (
    <div className="absolute inset-0 z-30 overflow-y-auto bg-gradient-to-b from-black/80 via-black/60 to-black/85 backdrop-blur-[2px] flex flex-col items-center justify-center p-4 sm:p-8">
      {/* ink-brush divider top */}
      <div className="w-24 h-px bg-gradient-to-r from-transparent via-rose-700/60 to-transparent mb-4" />
      <div className="text-center mb-3">
        <p className="text-rose-400/60 tracking-[0.4em] text-[10px] sm:text-xs mb-2">
          THE SHADOW&apos;S ASCENSION
        </p>
        <h1
          className="text-5xl sm:text-7xl font-black tracking-tight text-white"
          style={{ textShadow: "0 0 30px rgba(200,40,30,0.6), 0 0 60px rgba(200,40,30,0.3)" }}
        >
          YOU ARE THE SHADOW
        </h1>
      </div>
      <p className="text-center text-zinc-400 text-sm sm:text-base max-w-xl mx-auto mb-2 italic leading-relaxed">
        The river runs red. The sealers gather — heroes who once caged your kind.
        They wear the faces of friends. They carry the chains of the old order.
      </p>
      <p className="text-center text-rose-300/70 text-sm max-w-lg mx-auto mb-7">
        Cut them down. Claim their seals. Open the gate.
      </p>

      <div className="text-center flex flex-wrap gap-3 justify-center mb-4">
        <button
          onClick={onStart}
          className="px-8 py-3 rounded-full bg-gradient-to-r from-rose-700 via-red-600 to-rose-800 text-white font-black tracking-widest text-lg hover:scale-105 active:scale-95 transition-transform shadow-lg shadow-rose-900/60 border border-rose-500/30"
        >
          BEGIN THE HUNT
        </button>
        <button
          onClick={onSelect}
          className="px-6 py-3 rounded-full border border-white/20 text-white font-bold tracking-wide hover:bg-white/10 active:scale-95 transition"
        >
          Choose Your Prey
        </button>
        <button
          onClick={onTwoPlayer}
          className="px-6 py-3 rounded-full border border-amber-500/30 bg-amber-950/30 text-amber-300/80 font-bold tracking-wide hover:bg-amber-900/40 hover:text-amber-200 active:scale-95 transition"
        >
          2-Player Versus
        </button>
        <button
          onClick={onPractice}
          className="px-6 py-3 rounded-full border border-emerald-500/30 bg-emerald-950/30 text-emerald-300/80 font-bold tracking-wide hover:bg-emerald-900/40 active:scale-95 transition"
        >
          Practice
        </button>
        <button
          onClick={onTutorial}
          className="px-6 py-3 rounded-full border border-sky-500/30 bg-sky-950/30 text-sky-300/80 font-bold tracking-wide hover:bg-sky-900/40 active:scale-95 transition"
        >
          Tutorial
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-zinc-500 max-w-3xl mx-auto">
        <Control keys="WASD / ←→" label="Move" />
        <Control keys="W / ↑ / Space" label="Flip-Jump" />
        <Control keys="S / ↓" label="Crouch" />
        <Control keys="E / O" label="Roll (dodge)" />
        <Control keys="J / Z" label="Punch" />
        <Control keys="K / X" label="Kick" />
        <Control keys="F / T or P+K" label="Throw" />
        <Control keys="L / C / Shift" label="Block" />
      </div>
      {/* ink-brush divider bottom */}
      <div className="w-24 h-px bg-gradient-to-r from-transparent via-rose-700/60 to-transparent mt-6" />
      {/* skip-to-ending shortcut — lets you jump straight to the apocalypse */}
      <button
        onClick={onSkipToEnding}
        className="mt-4 text-[10px] tracking-[0.3em] text-rose-500/30 hover:text-rose-400/70 transition-colors"
      >
        SKIP TO THE END ▶
      </button>
    </div>
  );
}

const SCENES: { id: BackgroundId; label: string }[] = [
  { id: "sunset", label: "Sunset" },
  { id: "desert", label: "Desert" },
  { id: "temple", label: "Temple" },
  { id: "bamboo", label: "Bamboo" },
  { id: "moon", label: "Moonlit" },
  { id: "volcano", label: "Volcano" },
  { id: "snow", label: "Snow" },
];

function SelectPanel({
  selOpp,
  selScene,
  onOpp,
  onScene,
  onBack,
  onFight,
  onPractice,
}: {
  selOpp: number;
  selScene: BackgroundId | "auto";
  onOpp: (i: number) => void;
  onScene: (s: BackgroundId | "auto") => void;
  onBack: () => void;
  onFight: () => void;
  onPractice: () => void;
}) {
  return (
    <div className="absolute inset-0 z-30 overflow-y-auto bg-black/80 backdrop-blur-sm flex flex-col justify-center p-4 sm:p-7">
      <div className="w-full max-w-2xl mx-auto rounded-2xl border border-rose-900/30 bg-zinc-950/85 backdrop-blur p-5 sm:p-7">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-rose-400/50 tracking-[0.3em] text-[10px] mb-0.5">THE SEALERS</p>
          <h2 className="text-xl sm:text-2xl font-black text-white tracking-wide">
            CHOOSE YOUR PREY
          </h2>
        </div>
        <button
          onClick={onBack}
          className="text-xs sm:text-sm text-zinc-400 hover:text-white border border-white/15 rounded-full px-3 py-1.5"
        >
          ← Back
        </button>
      </div>

      {/* Opponent picker */}
      <div className="mb-5">
        <div className="text-[11px] uppercase tracking-widest text-zinc-500 mb-2">
          The Sealers
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {OPPONENTS.map((o, i) => {
            const active = selOpp === i;
            return (
              <button
                key={o.name}
                onClick={() => onOpp(i)}
                className={`rounded-xl border p-2.5 text-center transition ${
                  active
                    ? "bg-white/10 border-white/60"
                    : "bg-black/40 border-white/10 hover:border-white/30"
                }`}
                style={
                  active
                    ? { boxShadow: `0 0 18px ${o.rim}66, inset 0 0 16px ${o.rim}22` }
                    : undefined
                }
              >
                <div className="flex items-center justify-center gap-1 mb-1">
                  <span className="text-[9px] font-mono text-zinc-600">{i + 1}</span>
                  <div
                    className="w-6 h-6 rounded-full"
                    style={{ background: o.rim, boxShadow: `0 0 10px ${o.rim}` }}
                  />
                  {o.blade && <span className="text-[8px] text-zinc-500">⚔</span>}
                </div>
                <div className="text-xs font-bold text-white">{o.name}</div>
                <div className="text-[10px] text-zinc-500 truncate">{o.title}</div>
              </button>
            );
          })}
        </div>
        {/* Story beat for selected opponent */}
        {OPPONENTS[selOpp].story && (
          <p className="mt-3 text-center text-rose-200/60 text-xs sm:text-sm italic leading-relaxed border-t border-white/5 pt-3">
            {OPPONENTS[selOpp].story}
          </p>
        )}
      </div>

      {/* Scene picker */}
      <div className="mb-6">
        <div className="text-[11px] uppercase tracking-widest text-zinc-500 mb-2">
          Arena
        </div>
        <div className="flex flex-wrap gap-2">
          <SceneChip
            active={selScene === "auto"}
            onClick={() => onScene("auto")}
            label={`Auto (${OPPONENTS[selOpp].bg})`}
          />
          {SCENES.map((s) => (
            <SceneChip
              key={s.id}
              active={selScene === s.id}
              onClick={() => onScene(s.id)}
              label={s.label}
            />
          ))}
        </div>
      </div>

      <div className="text-center flex flex-wrap gap-3 justify-center">
        <button
          onClick={onFight}
          className="px-8 py-3 rounded-full bg-gradient-to-r from-amber-500 to-rose-600 text-white font-black tracking-widest text-lg hover:scale-105 active:scale-95 transition-transform shadow-lg shadow-rose-900/50"
        >
          FIGHT {OPPONENTS[selOpp].name.toUpperCase()}
        </button>
        <button
          onClick={onPractice}
          className="px-6 py-3 rounded-full border border-emerald-400/40 text-emerald-200 font-bold tracking-wide hover:bg-emerald-950/40 active:scale-95 transition"
        >
          PRACTICE
        </button>
      </div>
      </div>
    </div>
  );
}

function SceneChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
        active
          ? "bg-white/15 border-white/60 text-white"
          : "bg-black/40 border-white/10 text-zinc-400 hover:text-white hover:border-white/30"
      }`}
    >
      {label}
    </button>
  );
}

function Control({ keys, label }: { keys: string; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-white/5 px-2 py-1.5 border border-white/10">
      <kbd className="text-[10px] font-mono text-amber-300 whitespace-nowrap">{keys}</kbd>
      <span className="text-zinc-400">{label}</span>
    </div>
  );
}

function EndPanel({
  title,
  subtitle,
  accent,
  info,
  primary,
  secondary,
}: {
  title: string;
  subtitle: string;
  accent: string;
  info?: string;
  primary: { label: string; onClick: () => void };
  secondary?: { label: string; onClick: () => void };
}) {
  return (
    <div className="absolute inset-0 z-30 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 text-center">
      <div className="w-full max-w-xl rounded-2xl border border-rose-900/25 bg-zinc-950/90 backdrop-blur p-6 sm:p-10">
      <div className="w-16 h-px bg-gradient-to-r from-transparent via-rose-700/50 to-transparent mx-auto mb-4" />
      <h2
        className="text-4xl sm:text-6xl font-black tracking-tight"
        style={{ color: accent, textShadow: `0 0 28px ${accent}88` }}
      >
        {title}
      </h2>
      <p className="text-zinc-300 mt-3 italic leading-relaxed max-w-md mx-auto">{subtitle}</p>
      {info && <p className="text-amber-300/60 text-xs mt-3 tracking-wide">{info}</p>}
      <div className="mt-7 flex flex-wrap gap-3 justify-center">
        <button
          onClick={primary.onClick}
          className="px-7 py-3 rounded-full bg-gradient-to-r from-rose-700 via-red-600 to-rose-800 text-white font-bold tracking-wide hover:scale-105 active:scale-95 transition-transform shadow-lg shadow-rose-900/50 border border-rose-500/25"
        >
          {primary.label}
        </button>
        {secondary && (
          <button
            onClick={secondary.onClick}
            className="px-7 py-3 rounded-full border border-white/20 text-white font-bold tracking-wide hover:bg-white/10 active:scale-95 transition"
          >
            {secondary.label}
          </button>
        )}
      </div>
      </div>
    </div>
  );
}
