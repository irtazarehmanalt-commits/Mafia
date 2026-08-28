'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

import { Logo } from '@/components/Logo';
import { Button } from '@/components/ui/Button';
import { CodeInput } from '@/components/ui/CodeInput';
import { Field, Input } from '@/components/ui/Input';
import { getRoomPreview, joinRoom, type RoomPreview } from '@/lib/api';
import { lastDisplayName, loadSession, saveSession } from '@/lib/session';

function JoinForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [roomCode, setRoomCode] = useState(params.get('code')?.toUpperCase() ?? '');
  const [displayName, setDisplayName] = useState('');
  const [preview, setPreview] = useState<RoomPreview | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const remembered = lastDisplayName();
    if (remembered) setDisplayName(remembered);
  }, []);

  // Peek at the room as soon as the code is complete, so the panel on the
  // right fills in before anyone commits to joining.
  useEffect(() => {
    if (roomCode.length !== 6) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    getRoomPreview(roomCode)
      .then((data) => {
        if (!cancelled) {
          setPreview(data);
          setError(null);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setPreview(null);
          setError(err.message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [roomCode]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const existing = loadSession(roomCode);
      const ticket = await joinRoom(roomCode, {
        displayName: displayName.trim(),
        token: existing?.token,
      });
      saveSession(ticket);
      router.push(`/room/${ticket.roomCode}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join that room.');
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="grid flex-1 lg:grid-cols-2">
      {/* --- Code + name -------------------------------------------------- */}
      <div className="flex flex-col border-divider px-6 py-12 sm:px-10 lg:border-r-2">
        <h1 className="m-0 mb-2 text-[clamp(2.25rem,7vw,3.5rem)]">Join a game</h1>
        <p className="lbl mb-9">Enter the six characters your host sent you</p>

        <CodeInput value={roomCode} onChange={setRoomCode} autoFocus={!roomCode} />

        <div className="mt-9 max-w-[420px]">
          <Field label="Your display name" htmlFor="jn">
            <Input
              id="jn"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Sara"
              maxLength={20}
              required
              className="text-base"
            />
          </Field>
        </div>

        <div className="mt-7 flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            size="lg"
            loading={submitting}
            disabled={roomCode.length !== 6 || displayName.trim().length < 2}
            className="min-w-[200px]"
          >
            Join room →
          </Button>
          <span className="lbl">or open the invite link</span>
        </div>

        {error && (
          <div className="mt-auto border-t-2 border-divider pt-5">
            <div
              className="flex items-start gap-3 border px-4 py-3.5"
              style={{
                borderColor: 'var(--color-accent)',
                background: 'var(--color-accent-100)',
              }}
            >
              <span
                className="text-sm font-black"
                style={{ color: 'var(--color-accent-700)' }}
              >
                !
              </span>
              <div>
                <div
                  className="text-sm font-bold"
                  style={{ color: 'var(--color-accent-700)' }}
                >
                  {error}
                </div>
                <div className="mt-0.5 text-[13px]" style={{ color: 'var(--color-accent-800)' }}>
                  Check the code with your host, or pick a different name.
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* --- Room preview --------------------------------------------------- */}
      <aside className="flex flex-col border-t-2 border-divider bg-surface px-6 py-12 sm:px-10 lg:border-t-0">
        <p className="lbl mb-4">You are joining</p>

        {preview ? (
          <>
            <h2 className="m-0 text-[clamp(1.5rem,4vw,2.125rem)]">{preview.roomName}</h2>
            <div className="mono mt-1.5 text-muted">
              {preview.roomCode} · {preview.inProgress ? 'GAME IN PROGRESS' : 'WAITING IN LOBBY'}
            </div>

            <div className="mt-7 border-t border-divider">
              <div className="kv">
                <span className="lbl">Players</span>
                <span className="kv-v">
                  {preview.playerCount} / {preview.maxPlayers}
                </span>
              </div>
              <div className="kv">
                <span className="lbl">Minimum to start</span>
                <span className="kv-v">{preview.minPlayers}</span>
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
          <div className="text-muted">
            <h2 className="m-0 text-[clamp(1.5rem,4vw,2.125rem)] text-neutral-400">
              {roomCode.length === 6 ? 'No room found' : 'Waiting for a code'}
            </h2>
            <p className="mt-2 text-sm">
              {roomCode.length === 6
                ? 'Check the six characters and try again.'
                : 'The room details appear here once the code is complete.'}
            </p>
          </div>
        )}
      </aside>
    </form>
  );
}

export default function JoinPage() {
  return (
    <main className="flex min-h-dvh flex-col">
      <header className="bar">
        <Logo />
        <Link href="/" className="btn btn-ghost">
          ← Back
        </Link>
      </header>
      <Suspense fallback={<div className="p-10 lbl">Loading…</div>}>
        <JoinForm />
      </Suspense>
    </main>
  );
}
