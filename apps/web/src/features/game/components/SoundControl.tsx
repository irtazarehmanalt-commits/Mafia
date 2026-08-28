'use client';

import { useEffect, useState } from 'react';
import { sound } from '@/lib/sound';

/** Mute toggle. The first click is also what unlocks the audio context. */
export function SoundControl() {
  const [muted, setMuted] = useState(true);

  useEffect(() => {
    setMuted(sound().isMuted);
  }, []);

  return (
    <button
      type="button"
      className="btn btn-secondary btn-icon"
      title={muted ? 'Unmute' : 'Mute'}
      aria-label={muted ? 'Unmute sound' : 'Mute sound'}
      onClick={() => {
        sound().unlock();
        const next = !muted;
        sound().setMuted(next);
        setMuted(next);
        if (!next) sound().play('tick');
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M11 5 6 9H3v6h3l5 4V5Z" strokeLinejoin="round" />
        {muted ? (
          <path d="m16 9 5 6M21 9l-5 6" strokeLinecap="round" />
        ) : (
          <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" strokeLinecap="round" />
        )}
      </svg>
    </button>
  );
}
