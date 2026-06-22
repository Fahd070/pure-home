import { useEffect, useRef } from "react";
import { Socket } from "socket.io-client";
import { useSettingsStore } from "../store/settingsStore";

export const NOTIFICATION_EVENTS = [
  "customer:created",
  "appointment:created",
  "appointment:updated",
  "appointment:started",
  "appointment:completed",
  "appointment:postponed",
];

export function playChime(volume: number) {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();

    const note = (freq: number, startAt: number, dur: number, vol: number) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.value = freq;
      const t0 = ctx.currentTime + startAt;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(vol, t0 + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    };

    const v = Math.min(1, Math.max(0.02, volume));
    note(523.25, 0,    0.28, v * 0.42); // C5
    note(659.25, 0.14, 0.32, v * 0.36); // E5

    setTimeout(() => ctx.close().catch(() => {}), 1200);
  } catch {}
}

export function useNotificationSound(socket: Socket | null) {
  const settingsRef = useRef(useSettingsStore.getState().settings);
  const lastPlayed  = useRef<Map<string, number>>(new Map());

  useEffect(
    () => useSettingsStore.subscribe((s) => { settingsRef.current = s.settings; }),
    []
  );

  useEffect(() => {
    if (!socket) return;
    const MIN_GAP = 2000;

    const makeHandler = (event: string) => () => {
      const s = settingsRef.current;
      if (!s.soundEnabled) return;
      const now  = Date.now();
      const last = lastPlayed.current.get(event) || 0;
      if (now - last < MIN_GAP) return;
      lastPlayed.current.set(event, now);
      playChime(s.soundVolume / 100);
    };

    const pairs = NOTIFICATION_EVENTS.map((e) => ({ e, fn: makeHandler(e) }));
    pairs.forEach(({ e, fn }) => socket.on(e, fn));
    return () => pairs.forEach(({ e, fn }) => socket.off(e, fn));
  }, [socket]);
}
