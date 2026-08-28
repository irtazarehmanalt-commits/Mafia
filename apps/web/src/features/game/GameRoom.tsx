'use client';

import Link from 'next/link';
import { useState } from 'react';

import { Logo } from '@/components/Logo';
import { cn } from '@/lib/cn';
import { inviteLink } from '@/lib/config';
import { isNightPhase } from '@/lib/theme';
import { useGame } from './GameProvider';
import { ConnectionBanner, Toasts } from './components/Overlays';
import { PhaseTimer, phaseLabel } from './components/PhaseTimer';
import { SoundControl } from './components/SoundControl';
import { DayScreen } from './screens/DayScreen';
import { GameOverScreen } from './screens/GameOverScreen';
import { LobbyScreen } from './screens/LobbyScreen';
import { NightScreen } from './screens/NightScreen';
import { RoleRevealScreen } from './screens/RoleRevealScreen';
import { VotingScreen } from './screens/VotingScreen';

/**
 * Routes the authoritative phase to a screen and owns the top bar. The client
 * never decides what phase it is in — it renders whatever the server says.
 */
export function GameRoom() {
  const { state, status, fatalError, leaveRoom } = useGame();
  const [copied, setCopied] = useState(false);

  if (status === 'kicked' || status === 'closed' || status === 'error') {
    return <TerminalState message={fatalError ?? 'This session has ended.'} />;
  }

  if (!state) {
    return (
      <main className="dark flex min-h-dvh flex-col bg-bg text-ink">
        <header className="bar">
          <Logo href={null} />
        </header>
        <div className="grid flex-1 place-items-center">
          <p className="lbl animate-bar-pulse">Entering the room…</p>
        </div>
      </main>
    );
  }

  const night = isNightPhase(state.phase);
  const inLobby = state.phase === 'LOBBY';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink(state.roomCode));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — the code is on screen to copy by hand */
    }
  };

  return (
    <main className={cn('flex min-h-dvh flex-col bg-bg text-ink', night && 'dark')}>
      <ConnectionBanner />
      <Toasts />

      <header className="bar">
        <div className="flex min-w-0 items-baseline gap-3 sm:gap-[18px]">
          <Logo />
          <span
            className="lbl truncate"
            style={night ? { color: 'var(--color-accent)' } : undefined}
          >
            {phaseLabel(state.phase, state.dayNumber)}
          </span>
          <span className="lbl hidden truncate lg:inline">{state.roomName}</span>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3.5">
          {inLobby && (
            <>
              <span className="mono hidden border border-divider px-2.5 py-1.5 sm:inline">
                {state.roomCode}
              </span>
              <button type="button" className="btn btn-secondary" onClick={copy}>
                {copied ? 'Copied' : 'Copy invite'}
              </button>
            </>
          )}
          <PhaseTimer />
          <SoundControl />
          <button
            type="button"
            className="btn btn-ghost hidden sm:inline-flex"
            onClick={() => {
              if (confirm('Leave this room?')) {
                void leaveRoom().finally(() => {
                  window.location.href = '/';
                });
              }
            }}
          >
            Leave
          </button>
        </div>
      </header>

      {renderPhase(state.phase)}
    </main>
  );
}

function renderPhase(phase: string) {
  switch (phase) {
    case 'LOBBY':
      return <LobbyScreen />;
    case 'ROLE_REVEAL':
      return <RoleRevealScreen />;
    case 'NIGHT':
    case 'NIGHT_RESOLUTION':
      return <NightScreen />;
    case 'DAY_ANNOUNCEMENT':
    case 'DISCUSSION':
      return <DayScreen />;
    case 'VOTING':
    case 'VOTE_RESOLUTION':
      return <VotingScreen />;
    case 'GAME_OVER':
      return <GameOverScreen />;
    default:
      return null;
  }
}

function TerminalState({ message }: { message: string }) {
  return (
    <main className="dark flex min-h-dvh flex-col bg-bg text-ink">
      <header className="bar">
        <Logo href={null} />
      </header>
      <div className="grid flex-1 place-items-center px-6">
        <div className="max-w-md text-center">
          <h1 className="display text-[clamp(2.5rem,9vw,4.5rem)]">
            SESSION
            <br />
            <span className="text-accent">ENDED.</span>
          </h1>
          <p className="mt-6 text-base">{message}</p>
          <Link href="/" className="btn btn-primary btn-lg mt-6 inline-flex">
            Back to the front page →
          </Link>
        </div>
      </div>
    </main>
  );
}
