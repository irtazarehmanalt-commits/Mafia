'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { Logo } from '@/components/Logo';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Input';
import { GameProvider } from '@/features/game/GameProvider';
import { GameRoom } from '@/features/game/GameRoom';
import { getRoomPreview, joinRoom, type RoomPreview } from '@/lib/api';
import { lastDisplayName, loadSession, saveSession, type StoredSession } from '@/lib/session';

/**
 * The room entry point.
 *
 * Anyone arriving with a stored session for this room goes straight in and
 * reclaims their seat — including their role, mid-game. Everyone else meets a
 * short join gate first, so a shared link works for a first-time player too.
 */
export default function RoomPage() {
  const params = useParams<{ code: string }>();
  const roomCode = (params?.code ?? '').toUpperCase();

  const [session, setSession] = useState<StoredSession | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!roomCode) return;
    setSession(loadSession(roomCode));
    setChecked(true);
  }, [roomCode]);

  if (!checked) {
    return (
      <main className="flex min-h-dvh flex-col">
        <header className="bar">
          <Logo href={null} />
        </header>
      </main>
    );
  }

  if (!session) return <JoinGate roomCode={roomCode} onJoined={setSession} />;

  return (
    <GameProvider roomCode={roomCode} session={session}>
      <GameRoom />
    </GameProvider>
  );
}

function JoinGate({
  roomCode,
  onJoined,
}: {
  roomCode: string;
  onJoined: (session: StoredSession) => void;
}) {
  const [preview, setPreview] = useState<RoomPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDisplayName(lastDisplayName());
    getRoomPreview(roomCode)
      .then(setPreview)
      .catch((err: Error) => setLoadError(err.message));
  }, [roomCode]);

  const handleJoin = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setError(null);
      setSubmitting(true);
      try {
        const ticket = await joinRoom(roomCode, { displayName: displayName.trim() });
        saveSession(ticket);
        onJoined(ticket);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not join.');
        setSubmitting(false);
      }
    },
    [roomCode, displayName, onJoined],
  );

  if (loadError) {
    return (
      <main className="flex min-h-dvh flex-col">
        <header className="bar">
          <Logo />
        </header>
        <div className="grid flex-1 place-items-center px-6">
          <div className="max-w-lg">
            <h1 className="display text-[clamp(2.5rem,9vw,4.5rem)]">
              NO ROOM
              <br />
              <span className="text-accent">FOUND.</span>
            </h1>
            <p className="mt-6 text-base">{loadError}</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/join" className="btn btn-primary btn-lg">
                Try another code →
              </Link>
              <Link href="/" className="btn btn-secondary btn-lg">
                Home
              </Link>
            </div>
          </div>
        </div>
      </main>
    );
  }

  const closed = preview?.inProgress === true && preview.allowSpectators === false;

  return (
    <main className="flex min-h-dvh flex-col">
      <header className="bar">
        <Logo />
        <span className="lbl">You have been invited</span>
      </header>

      <form onSubmit={handleJoin} className="grid flex-1 lg:grid-cols-2">
        <div className="flex flex-col border-divider px-6 py-12 sm:px-10 lg:border-r-2">
          <p className="lbl mb-4">Room</p>
          <h1 className="m-0 text-[clamp(2rem,6vw,3.25rem)]">
            {preview ? preview.roomName : 'Loading…'}
          </h1>
          <div className="mono mt-2 text-muted" style={{ fontSize: 15 }}>
            {roomCode}
          </div>

          <div className="mt-9 max-w-[420px]">
            <Field label="Your display name" htmlFor="gn">
              <Input
                id="gn"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Sara"
                maxLength={20}
                required
                autoFocus
                className="text-base"
              />
            </Field>
          </div>

          {error && (
            <p
              className="mt-5 max-w-[420px] border px-4 py-3 text-sm"
              style={{
                borderColor: 'var(--color-accent)',
                background: 'var(--color-accent-100)',
                color: 'var(--color-accent-700)',
              }}
            >
              {error}
            </p>
          )}

          <div className="mt-7">
            <Button
              type="submit"
              size="lg"
              loading={submitting}
              disabled={displayName.trim().length < 2 || closed}
              className="min-w-[220px]"
            >
              {preview?.inProgress ? 'Watch the game →' : 'Take a seat →'}
            </Button>
          </div>
        </div>

        <aside className="flex flex-col border-t-2 border-divider bg-surface px-6 py-12 sm:px-10 lg:border-t-0">
          <p className="lbl mb-4">At the table</p>

          {preview ? (
            <>
              <div className="border-t border-divider">
                <div className="kv">
                  <span className="lbl">Players</span>
                  <span className="kv-v">
                    {preview.playerCount} / {preview.maxPlayers}
                  </span>
                </div>
                <div className="kv">
                  <span className="lbl">Status</span>
                  <span className="kv-v">
                    {preview.inProgress ? 'Game in progress' : 'Waiting in lobby'}
                  </span>
                </div>
                <div className="kv">
                  <span className="lbl">Spectators</span>
                  <span className="kv-v">{preview.allowSpectators ? 'Allowed' : 'No'}</span>
                </div>
              </div>

              {preview.inProgress && (
                <p
                  className="mt-5 border px-4 py-3 text-[13px]"
                  style={{ borderColor: 'var(--color-divider)' }}
                >
                  {preview.allowSpectators
                    ? 'The game has already started — you will join as a spectator and play the next round.'
                    : 'This game has already started and is not accepting anyone new.'}
                </p>
              )}

              {preview.players.length > 0 && (
                <div className="mt-auto pt-8">
                  <p className="lbl mb-3">Already in</p>
                  <div className="flex flex-wrap gap-2">
                    {preview.players.map((p) => (
                      <span key={p.name} className="tag tag-neutral">
                        {p.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="lbl">Loading room…</p>
          )}
        </aside>
      </form>
    </main>
  );
}
