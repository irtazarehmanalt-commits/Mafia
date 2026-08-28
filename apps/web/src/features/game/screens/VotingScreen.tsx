'use client';

import { SKIP_VOTE } from '@mafia/shared';
import { useMemo } from 'react';

import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { useGame } from '../GameProvider';
import { TargetCard, TileGrid } from '../components/PlayerTile';

export function VotingScreen() {
  const { state, castVote } = useGame();
  if (!state) return null;

  const { you } = state;
  const voting = state.phase === 'VOTING';
  const canVote = voting && you.alive && !you.isSpectator;

  const living = state.players.filter((p) => p.alive && !p.isSpectator);
  const tallies = state.voteTallies ?? [];

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const tally of tallies) map.set(String(tally.targetId), tally.votes);
    return map;
  }, [tallies]);

  const voters = useMemo(() => {
    const set = new Set<string>();
    for (const tally of tallies) for (const id of tally.voterIds) set.add(id);
    return set;
  }, [tallies]);

  const pending = living.filter((p) => !voters.has(p.id));
  const chosen =
    you.currentVote === SKIP_VOTE
      ? { name: 'Abstain' }
      : (living.find((p) => p.id === you.currentVote) ?? null);
  const leader = tallies[0]?.votes ?? 0;
  const disconnected = living.filter((p) => !p.connected);

  return (
    <div className="grid flex-1 lg:grid-cols-[1fr_400px]">
      {/* --- Ballot ---------------------------------------------------------- */}
      <section className="flex flex-col border-divider px-6 py-7 sm:px-9 lg:border-r-2">
        {voting ? (
          <>
            <h1 className="m-0 mb-1 text-[clamp(1.875rem,5.5vw,2.875rem)]">Who hangs?</h1>
            <p className="lbl mb-6">
              {canVote
                ? 'You can change your vote until the timer runs out'
                : 'The living are deciding'}
            </p>
          </>
        ) : (
          <>
            <p className="lbl" style={{ letterSpacing: '0.3em' }}>
              The verdict
            </p>
            <h1 className="display mb-6 mt-3 text-[clamp(2rem,6.5vw,4.5rem)]">
              {(state.announcement ?? 'The vote is in.').toUpperCase()}
            </h1>
          </>
        )}

        <TileGrid className="gap-4">
          {living.map((player) => (
            <TargetCard
              key={player.id}
              player={player}
              you={player.id === you.playerId}
              selected={you.currentVote === player.id}
              disabled={!canVote}
              count={state.settings.publicVotes || !voting ? (counts.get(player.id) ?? 0) : null}
              caption={
                !player.connected
                  ? 'Disconnected · vote skipped'
                  : voters.has(player.id)
                    ? 'Has voted'
                    : voting
                      ? 'Yet to vote'
                      : null
              }
              onSelect={canVote ? () => void castVote(player.id) : undefined}
            />
          ))}
        </TileGrid>

        <div className="mt-8 flex flex-wrap items-center gap-3 border-t-2 border-divider pt-5 lg:mt-auto">
          {canVote ? (
            <>
              {/* State, not an action — picking a card already casts the vote. */}
              <LockedBanner name={chosen?.name ?? null} verb="Voting for" />
              {state.settings.allowSkipVote && (
                <Button
                  variant="secondary"
                  onClick={() => void castVote(SKIP_VOTE)}
                  aria-pressed={you.currentVote === SKIP_VOTE}
                >
                  Abstain
                </Button>
              )}
              {you.currentVote && (
                <Button variant="ghost" onClick={() => void castVote(null)}>
                  Retract
                </Button>
              )}
            </>
          ) : (
            <span className="lbl">
              {you.alive ? 'Waiting for the count' : 'The dead do not vote'}
            </span>
          )}
          <span className="lbl ml-auto hidden xl:inline">
            {state.settings.tieRule === 'RANDOM'
              ? 'A tie is broken at random'
              : 'A tie eliminates nobody'}
          </span>
        </div>
      </section>

      {/* --- Tally ------------------------------------------------------------ */}
      <aside className="flex flex-col border-t-2 border-divider bg-surface px-6 py-7 sm:px-8 lg:border-t-0">
        <p className="lbl mb-3.5">Live tally</p>

        {state.settings.publicVotes || !voting ? (
          <div className="grid gap-3.5">
            {tallies.length === 0 && <p className="lbl">No votes cast yet.</p>}
            {tallies.map((tally) => {
              const top = tally.votes === leader && tally.votes > 0;
              return (
                <div key={String(tally.targetId)}>
                  <div className="mb-1.5 flex justify-between text-sm font-bold">
                    <span>{tally.targetName}</span>
                    <span>{tally.votes}</span>
                  </div>
                  <div className="h-3.5" style={{ background: 'rgba(243,242,242,.12)' }}>
                    <div
                      className={cn('h-3.5 transition-[width] duration-300')}
                      style={{
                        width: `${leader > 0 ? (tally.votes / leader) * 100 : 0}%`,
                        background: top ? 'var(--color-accent)' : 'var(--color-text)',
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted">
            Votes are secret in this room. The breakdown is revealed once the vote closes.
          </p>
        )}

        {voting && pending.length > 0 && (
          <>
            <p className="lbl mb-3 mt-7">Not yet voted</p>
            <div className="flex flex-wrap gap-2">
              {pending.map((p) => (
                <span key={p.id} className="tag tag-neutral">
                  {p.name}
                </span>
              ))}
            </div>
          </>
        )}

        {disconnected.length > 0 && (
          <div className="mt-auto border p-3.5" style={{ borderColor: 'var(--color-accent)' }}>
            <p className="lbl mb-0" style={{ color: 'var(--color-accent)' }}>
              Connection lost
            </p>
            <p className="mb-0 mt-1.5 text-[13px]">
              {disconnected.map((p) => p.name).join(', ')} — their votes are skipped if they do
              not return.
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}

/**
 * Reads as a status block, not a button: the choice is already committed the
 * moment a card is clicked, and can be changed until the timer ends.
 */
export function LockedBanner({ name, verb }: { name: string | null; verb: string }) {
  return (
    <div
      className={cn(
        'flex min-w-[240px] items-center px-[22px] py-3.5 text-base font-extrabold',
        !name && 'border border-divider text-muted',
      )}
      style={name ? { background: 'var(--color-accent)', color: 'var(--color-bg)' } : undefined}
    >
      {name ? `${verb} ${name}` : 'Choose a name'}
    </div>
  );
}
