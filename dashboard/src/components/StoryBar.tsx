import type { Story } from "../lib/story";

interface Props {
  story: Story;
  scene: number;
  onPrev: () => void;
  onNext: () => void;
  onRestart: () => void;
}

/** Scene title, caption and stepping controls for story mode. */
export function StoryBar({ story, scene, onPrev, onNext, onRestart }: Props) {
  const s = story.scenes[scene];
  const last = scene === story.scenes.length - 1;
  return (
    <div className="story-bar" role="region" aria-label="Story controls">
      <button className="btn btn-sm" onClick={onPrev} disabled={scene === 0} title="Previous scene (←)">
        ←
      </button>
      <div className="story-text">
        <div className="story-title">
          <span className="story-step">
            {scene + 1} / {story.scenes.length}
          </span>
          {s.title}
        </div>
        <p className="story-caption">{s.caption}</p>
      </div>
      {last ? (
        <button className="btn btn-sm" onClick={onRestart} title="Back to the first scene">
          Restart
        </button>
      ) : (
        <button className="btn primary btn-sm" onClick={onNext} title="Next scene (→)">
          →
        </button>
      )}
    </div>
  );
}
