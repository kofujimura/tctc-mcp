import { useCallback, useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import type { AgentState } from "./agents";
import {
  manualRevoke,
  replay,
  storyActivity,
  storyStates,
  storyView,
  type Activity,
  type ReplayOptions,
  type Story,
  type StoryOp,
  type StoryView,
} from "./story";

export interface StoryApi {
  story: Story;
  view: StoryView;
  states: Map<string, AgentState>;
  activity: Map<string, Activity>;
  /** the same statuses, with expiry-bound ones following a chain instead of the clock */
  activityFor: (lapsed: ReplayOptions["lapsed"]) => Map<string, Activity>;
  /** index of the scene on screen */
  scene: number;
  next: () => void;
  prev: () => void;
  restart: () => void;
  /** the viewer may burn tokens it issued, exactly as in the live view */
  canRevoke: (holder: Address, key: string) => boolean;
  revoke: (holder: Address, key: string) => void;
}

/** Drives a story: which scenes have been entered and when, plus the viewer's own clicks. */
export function useStory(story: Story | undefined, startScene: number): StoryApi | undefined {
  const [entered, setEntered] = useState<number[]>(() => {
    if (!story) return [];
    const last = Math.min(Math.max(startScene, 0), story.scenes.length - 1);
    const t = Date.now();
    return Array.from({ length: last + 1 }, () => t);
  });
  const [manual, setManual] = useState<StoryOp[]>([]);
  const [now, setNow] = useState(() => Date.now());

  // countdowns and expiry are real time, so the view is recomputed every second
  useEffect(() => {
    if (!story) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [story]);

  const next = useCallback(() => {
    if (!story) return;
    const t = Date.now();
    setNow(t);
    setEntered((e) => (e.length < story.scenes.length ? [...e, t] : e));
    setManual([]);
  }, [story]);

  const prev = useCallback(() => {
    setNow(Date.now());
    setEntered((e) => (e.length > 1 ? e.slice(0, -1) : e));
    setManual([]);
  }, []);

  const restart = useCallback(() => {
    const t = Date.now();
    setNow(t);
    setEntered([t]);
    setManual([]);
  }, []);

  const canRevoke = useCallback(
    (holder: Address, key: string) => Boolean(story && manualRevoke(story, holder, key)),
    [story],
  );

  const revoke = useCallback(
    (holder: Address, key: string) => {
      const op = story && manualRevoke(story, holder, key);
      if (!op) return;
      setNow(Date.now());
      setManual((m) => [...m, op]);
    },
    [story],
  );

  const view = useMemo(() => (story ? storyView(story) : undefined), [story]);
  const state = useMemo(
    () => (story ? replay(story, entered, manual, now) : undefined),
    [story, entered, manual, now],
  );
  const states = useMemo(
    () => (story && state ? storyStates(story, state, now) : new Map<string, AgentState>()),
    [story, state, now],
  );
  const activity = useMemo(
    () => (story && state ? storyActivity(story, state) : new Map<string, Activity>()),
    [story, state],
  );

  const activityFor = useCallback(
    (lapsed: ReplayOptions["lapsed"]) =>
      story ? storyActivity(story, replay(story, entered, manual, now, { lapsed })) : new Map<string, Activity>(),
    [story, entered, manual, now],
  );

  if (!story || !view) return undefined;
  return {
    story,
    view,
    states,
    activity,
    activityFor,
    scene: entered.length - 1,
    next,
    prev,
    restart,
    canRevoke,
    revoke,
  };
}
