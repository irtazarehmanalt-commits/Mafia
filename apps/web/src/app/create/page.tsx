'use client';

import { DEFAULT_SETTINGS, resolveRoleCounts } from '@mafia/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { Logo } from '@/components/Logo';
import { Button } from '@/components/ui/Button';
import { Field, Input, OnOff, Segment, SettingRow } from '@/components/ui/Input';
import { createRoom } from '@/lib/api';
import { APP_URL } from '@/lib/config';
import { lastDisplayName, saveSession } from '@/lib/session';

const TABLE_SIZES = [6, 8, 9, 12, 15];

export default function CreateRoomPage() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState('');
  const [roomName, setRoomName] = useState('');
  const [maxPlayers, setMaxPlayers] = useState(9);
  const [revealRoleOnDeath, setRevealRoleOnDeath] = useState(DEFAULT_SETTINGS.revealRoleOnDeath);
  const [doctorCanSelfProtect, setDoctorCanSelfProtect] = useState(
    DEFAULT_SETTINGS.doctorCanSelfProtect,
  );
  const [publicVotes, setPublicVotes] = useState(DEFAULT_SETTINGS.publicVotes);
  const [tieRandom, setTieRandom] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const remembered = lastDisplayName();
    if (remembered) setDisplayName(remembered);
  }, []);

  const counts = useMemo(() => resolveRoleCounts(maxPlayers, null), [maxPlayers]);
  const civilians = maxPlayers - counts.MAFIA - counts.DOCTOR - counts.DETECTIVE;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const ticket = await createRoom({
        displayName: displayName.trim(),
        roomName: roomName.trim() || `${displayName.trim()}'s table`,
        settings: {
          maxPlayers,
          minPlayers: Math.min(DEFAULT_SETTINGS.minPlayers, maxPlayers),
          revealRoleOnDeath,
          doctorCanSelfProtect,
          publicVotes,
          tieRule: tieRandom ? 'RANDOM' : 'NO_ELIMINATION',
        },
      });
      saveSession(ticket);
      router.push(`/room/${ticket.roomCode}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the room.');
      setSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-dvh flex-col">
      <header className="bar">
        <Logo />
        <span className="lbl">Step 1 of 2 — Room setup</span>
      </header>

      <form onSubmit={handleSubmit} className="grid flex-1 lg:grid-cols-[1fr_520px]">
        {/* --- Setup -------------------------------------------------------- */}
        <div className="flex flex-col border-divider px-6 py-10 sm:px-10 lg:border-r-2">
          <h1 className="m-0 mb-1.5 text-[clamp(2rem,6vw,3.25rem)]">Create a game</h1>
          <p className="lbl mb-8">You will be the host. Nothing is saved until you start.</p>

          <div className="grid max-w-[620px] gap-5 sm:grid-cols-2 sm:gap-6">
            <Field label="Your display name" htmlFor="cn">
              <Input
                id="cn"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Ahmed"
                maxLength={20}
                required
                autoFocus
                className="text-base"
              />
            </Field>
            <Field label="Room name" htmlFor="rn">
              <Input
                id="rn"
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                placeholder="Thursday night crew"
                maxLength={40}
                className="text-base"
              />
            </Field>
          </div>

          <div className="mt-8 max-w-[620px]">
            <p className="lbl mb-2.5">Maximum players</p>
            <Segment
              value={maxPlayers}
              onChange={setMaxPlayers}
              options={TABLE_SIZES.map((n) => ({ value: n, label: String(n) }))}
            />
            <p className="mb-0 mt-2.5 text-[13px] text-muted">
              At {maxPlayers} players the table is dealt {counts.MAFIA} Mafia,{' '}
              {counts.DOCTOR} Doctor, {counts.DETECTIVE} Detective, {civilians} Civilians.
            </p>
          </div>

          <div className="mt-9 max-w-[620px] border-t-2 border-divider pt-5">
            <p className="lbl mb-3.5">Quick settings</p>
            <SettingRow label="Reveal role on death">
              <OnOff value={revealRoleOnDeath} onChange={setRevealRoleOnDeath} />
            </SettingRow>
            <SettingRow label="Doctor may protect themselves">
              <OnOff value={doctorCanSelfProtect} onChange={setDoctorCanSelfProtect} />
            </SettingRow>
            <SettingRow label="Public vote counts">
              <OnOff value={publicVotes} onChange={setPublicVotes} />
            </SettingRow>
            <SettingRow label="Tie result">
              <Segment
                value={tieRandom ? 'random' : 'none'}
                onChange={(v) => setTieRandom(v === 'random')}
                options={[
                  { value: 'none', label: 'Nobody dies' },
                  { value: 'random', label: 'Random' },
                ]}
              />
            </SettingRow>
          </div>

          {error && (
            <p
              className="mt-6 max-w-[620px] border px-4 py-3 text-sm"
              style={{
                borderColor: 'var(--color-accent)',
                background: 'var(--color-accent-100)',
                color: 'var(--color-accent-700)',
              }}
            >
              {error}
            </p>
          )}

          <div className="mt-8 flex flex-wrap items-center gap-3 lg:mt-auto">
            <Button
              type="submit"
              size="lg"
              loading={submitting}
              disabled={displayName.trim().length < 2}
              className="min-w-[220px]"
            >
              Create room →
            </Button>
            <span className="lbl">More settings once you are in the lobby</span>
          </div>
        </div>

        {/* --- Preview ------------------------------------------------------ */}
        <aside className="flex flex-col bg-surface px-6 py-10 sm:px-10">
          <p className="lbl mb-4">Preview</p>

          <div className="border-2 border-ink p-6">
            <p className="lbl">Room code</p>
            <div
              className="my-1.5 font-mono font-black tracking-[0.08em] text-neutral-400"
              style={{ fontSize: 'clamp(2.25rem,7vw,3.5rem)', lineHeight: 1.05 }}
            >
              ??????
            </div>
            <p className="mb-0 mt-3.5 break-all border-t border-divider pt-3.5 text-[13px] text-muted">
              {APP_URL.replace(/^https?:\/\//, '')}/room/…
            </p>
          </div>

          <p className="mt-6 text-sm text-muted">
            Your code is assigned when the room is created. Anyone with the link can join until
            you start the game — guests only need a display name.
          </p>

          <div className="mt-auto pt-8">
            <p className="lbl mb-3">Role balance at {maxPlayers}</p>
            <div className="flex h-10 border border-divider">
              <Balance flex={counts.MAFIA} label={counts.MAFIA} tone="accent" />
              <Balance flex={counts.DOCTOR} label={counts.DOCTOR} tone="dark" />
              <Balance flex={counts.DETECTIVE} label={counts.DETECTIVE} tone="mid" />
              <Balance flex={civilians} label={civilians} tone="light" />
            </div>
            <div className="mt-2 flex flex-wrap gap-4">
              <span className="lbl">Mafia</span>
              <span className="lbl">Doctor</span>
              <span className="lbl">Detective</span>
              <span className="lbl">Civilians</span>
            </div>
          </div>
        </aside>
      </form>
    </main>
  );
}

function Balance({
  flex,
  label,
  tone,
}: {
  flex: number;
  label: number;
  tone: 'accent' | 'dark' | 'mid' | 'light';
}) {
  if (flex <= 0) return null;
  const styles = {
    accent: { background: 'var(--color-accent)', color: 'var(--color-bg)' },
    dark: { background: 'var(--color-neutral-800)', color: '#f3f2f2' },
    mid: { background: 'var(--color-neutral-600)', color: '#f3f2f2' },
    light: { background: 'var(--color-neutral-300)', color: 'var(--color-text)' },
  }[tone];

  return (
    <div className="grid place-items-center text-xs font-extrabold" style={{ flex, ...styles }}>
      {label}
    </div>
  );
}
