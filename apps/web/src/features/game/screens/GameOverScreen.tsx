'use client';

import { ROLE_DEFINITIONS } from '@mafia/shared';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { useGame } from '../GameProvider';

export function GameOverScreen() {
  const { state, voteRematch, leaveRoom } = useGame();
  const [leaving, setLeaving] = useState(false);
  if (!state) return null;

  const result = state.result;
  const mafiaWon = result?.winner === 'MAFIA';
  const youWon = result ? result.winner === state.you.team : false;

  const roster = [...(result?.roster ?? [])].sort((a, b) => {
    if (a.team !== b.team) return a.team === result?.winner ? -1 : 1;
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const publicEvents = state.events
    .filter((e) => e.visibility === 'PUBLIC')
    .slice(-5)
    .reverse();

  const survivors = roster.filter((r) => r.alive).length;
  const fallen = roster.length - survivors;

  return (
    <div className="grid flex-1 lg:grid-cols-[1fr_560px]">
      {/* --- Verdict --------------------------------------------------------- */}
      <section className="flex flex-col border-divider px-6 py-11 sm:px-11 lg:border-r-2">
        <p className="lbl" style={{ letterSpacing: '0.3em' }}>
          Day {state.dayNumber} ·{' '}
          {state.you.role ? (youWon ? 'You win' : 'You lose') : 'Final result'}
        </p>

        <h1
          className="display mt-3.5 text-[clamp(3rem,12vw,8.25rem)]"
          style={mafiaWon ? { color: 'var(--color-accent-500)' } : undefined}
        >
          {mafiaWon ? (
            <>
              MAFIA
              <br />
              WINS
            </>
          ) : (
            <>
              TOWN
              <br />
              WINS
            </>
          )}
        </h1>

        <p className="mt-7 max-w-[540px] text-[clamp(1rem,2.2vw,1.1875rem)] leading-snug">
          {result?.reason}
        </p>

        <div className="mt-9 max-w-[540px] border-t-2 border-divider">
          {publicEvents.map((event) => (
            <div key={event.id} className="border-b border-divider py-3 text-sm">
              <span className="mono mr-2.5 text-muted">
                {event.day > 0 ? `D${event.day}` : '—'}
              </span>
              {event.message}
            </div>
          ))}
        </div>

        <div className="mt-8 flex flex-wrap gap-3 lg:mt-auto lg:pt-8">
          {state.rematch && !state.you.isSpectator && (
            <Button
              size="lg"
              variant={state.rematch.youVoted ? 'secondary' : 'primary'}
              className="min-w-[220px]"
              onClick={() => void voteRematch(!state.rematch!.youVoted)}
            >
              Rematch → {state.rematch.votes} / {state.rematch.required} ready
            </Button>
          )}
          <Button
            variant="secondary"
            loading={leaving}
            onClick={async () => {
              setLeaving(true);
              try {
                await leaveRoom();
                window.location.href = '/';
              } catch {
                setLeaving(false);
              }
            }}
          >
            Leave room
          </Button>
        </div>
      </section>

      {/* --- The reveal ------------------------------------------------------ */}
      <aside className="flex flex-col border-t-2 border-divider bg-surface px-6 py-11 sm:px-9 lg:border-t-0">
        <p className="lbl mb-3.5">Everyone&apos;s role</p>

        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Player</th>
                <th>Role</th>
                <th>Fate</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((entry) => (
                <tr key={entry.playerId}>
                  <td className="font-bold">
                    {entry.name}
                    {entry.playerId === state.you.playerId && (
                      <span className="lbl ml-2 inline">You</span>
                    )}
                  </td>
                  <td
                    style={
                      entry.team === 'MAFIA' ? { color: 'var(--color-accent-400)' } : undefined
                    }
                  >
                    {ROLE_DEFINITIONS[entry.role].label}
                  </td>
                  <td className="text-muted">
                    {entry.alive ? 'Survived' : `Died D${entry.diedOnDay ?? '?'}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-auto grid grid-cols-3 border-t-2 border-divider pt-0">
          <div className="stat">
            <div className="stat-n text-[26px]">{state.dayNumber}</div>
            <div className="lbl mt-1">Nights</div>
          </div>
          <div className="stat">
            <div className="stat-n text-[26px]">{fallen}</div>
            <div className="lbl mt-1">Fallen</div>
          </div>
          <div className="stat">
            <div className="stat-n text-[26px]">{survivors}</div>
            <div className="lbl mt-1">Survivors</div>
          </div>
        </div>
      </aside>
    </div>
  );
}
