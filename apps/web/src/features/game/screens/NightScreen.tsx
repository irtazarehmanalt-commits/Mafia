'use client';

import { ROLE_DEFINITIONS, type NightActionType, type PublicPlayer } from '@mafia/shared';
import { useMemo } from 'react';

import { Button } from '@/components/ui/Button';
import { useGame } from '../GameProvider';
import { ChatPanel } from '../components/ChatPanel';
import { EventLog } from '../components/Overlays';
import { PlayerTile, TargetCard, TileGrid } from '../components/PlayerTile';
import { LockedBanner } from './VotingScreen';

const PROMPTS: Record<string, { title: string; sub: string }> = {
  MAFIA_KILL: {
    title: 'Who dies tonight?',
    sub: 'The family must land on the same name, or nobody dies',
  },
  DOCTOR_PROTECT: {
    title: 'Who do you protect?',
    sub: 'You will not be told whether it worked',
  },
  DETECTIVE_INVESTIGATE: {
    title: 'Who do you investigate?',
    sub: 'One name per night. The answer is yours alone.',
  },
};

export function NightScreen() {
  const { state, submitNightAction } = useGame();
  if (!state) return null;

  const { you } = state;
  const definition = you.role ? ROLE_DEFINITIONS[you.role] : null;
  const action: NightActionType | null = definition?.nightAction ?? null;
  const resolving = state.phase === 'NIGHT_RESOLUTION';
  const canAct = Boolean(action) && you.alive && !you.isSpectator && !resolving;

  const living = state.players.filter((p) => p.alive && !p.isSpectator);
  const allies = new Set(you.mafiaAllies);

  const targets = useMemo(
    () =>
      living.filter((player) => {
        if (action === 'MAFIA_KILL') return player.id !== you.playerId && !allies.has(player.id);
        if (action === 'DETECTIVE_INVESTIGATE') return player.id !== you.playerId;
        if (action === 'DOCTOR_PROTECT') {
          return state.settings.doctorCanSelfProtect || player.id !== you.playerId;
        }
        return false;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [action, living, you.playerId, state.settings.doctorCanSelfProtect],
  );

  const mafiaCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const targetId of Object.values(you.mafiaTargetVotes)) {
      counts.set(targetId, (counts.get(targetId) ?? 0) + 1);
    }
    return counts;
  }, [you.mafiaTargetVotes]);

  const chosen = targets.find((p) => p.id === you.pendingNightTarget) ?? null;
  const lastResult = you.investigations.at(-1) ?? null;
  const prompt = action ? PROMPTS[action]! : null;

  return (
    <div className="grid flex-1 lg:grid-cols-[1fr_400px]">
      {/* --- Action ---------------------------------------------------------- */}
      <section className="flex flex-col border-divider px-6 py-8 sm:px-9 lg:border-r-2">
        {canAct && prompt ? (
          <>
            <h1 className="m-0 mb-1 text-[clamp(1.75rem,5vw,2.75rem)]">{prompt.title}</h1>
            <p className="lbl mb-6">{prompt.sub}</p>

            {you.role === 'DETECTIVE' && lastResult && (
              <div
                className="mb-5 border-2 p-5"
                style={{ borderColor: 'var(--color-accent)', background: 'var(--tint)' }}
              >
                <p className="lbl mb-2" style={{ color: 'var(--color-accent)' }}>
                  Night {lastResult.day} result · private
                </p>
                <div className="flex flex-wrap items-baseline gap-3.5">
                  <span className="text-[clamp(1.5rem,4vw,2.5rem)] font-black">
                    {lastResult.targetName.toUpperCase()}
                  </span>
                  <span
                    className="text-[clamp(1.5rem,4vw,2.5rem)] font-black"
                    style={{ color: 'var(--color-accent-500)' }}
                  >
                    {lastResult.isMafia ? 'IS MAFIA' : 'IS NOT MAFIA'}
                  </span>
                </div>
              </div>
            )}

            <TileGrid className="gap-4">
              {targets.map((player) => (
                <TargetCard
                  key={player.id}
                  player={player}
                  you={player.id === you.playerId}
                  selected={you.pendingNightTarget === player.id}
                  disabled={player.id === you.blockedTargetId}
                  count={action === 'MAFIA_KILL' ? (mafiaCounts.get(player.id) ?? 0) : undefined}
                  caption={captionFor(player, you.blockedTargetId, you.investigations)}
                  onSelect={() => void submitNightAction(action!, player.id)}
                />
              ))}
            </TileGrid>

            <div className="mt-8 flex flex-wrap items-center gap-3 border-t-2 border-divider pt-5 lg:mt-auto">
              {/* State, not an action — the choice is sent when a card is clicked. */}
              <LockedBanner name={chosen?.name ?? null} verb={confirmVerb(action!)} />
              {chosen && (
                <Button variant="secondary" onClick={() => void submitNightAction(action!, null)}>
                  Clear
                </Button>
              )}
              <span className="lbl ml-auto hidden xl:inline">
                Nobody outside this panel can see your choice
              </span>
            </div>
          </>
        ) : (
          <WaitingState resolving={resolving} />
        )}
      </section>

      {/* --- Rail ------------------------------------------------------------ */}
      <aside className="flex min-h-0 flex-col border-t-2 border-divider bg-surface lg:border-t-0">
        {you.role === 'MAFIA' && you.alive ? (
          <>
            <div className="px-6 pt-8 sm:px-[30px]">
              <p className="lbl mb-3.5" style={{ color: 'var(--color-accent)' }}>
                Your family
              </p>
              <div className="grid gap-3">
                <PlayerTile
                  player={state.players.find((p) => p.id === you.playerId)!}
                  accent
                  caption={
                    you.pendingNightTarget
                      ? `You · voted ${nameOf(state.players, you.pendingNightTarget)}`
                      : 'You · no vote yet'
                  }
                />
                {state.players
                  .filter((p) => allies.has(p.id))
                  .map((ally) => (
                    <PlayerTile
                      key={ally.id}
                      player={ally}
                      caption={
                        you.mafiaTargetVotes[ally.id]
                          ? `Voted ${nameOf(state.players, you.mafiaTargetVotes[ally.id]!)}`
                          : ally.alive
                            ? 'No vote yet'
                            : 'Dead'
                      }
                    />
                  ))}
              </div>
            </div>
            <ChatPanel className="mt-6 min-h-[320px] flex-1 border-t-2 border-divider" />
          </>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col px-6 py-8 sm:px-[30px]">
            {you.investigations.length > 0 && (
              <div className="mb-7">
                <p className="lbl mb-3.5">Your case file</p>
                <div className="border-t border-divider">
                  {you.investigations.map((result) => (
                    <div
                      key={`${result.day}-${result.targetId}`}
                      className="flex items-center justify-between gap-3 border-b border-divider py-2.5"
                    >
                      <span className="text-sm">
                        <span className="mono mr-2 text-muted">N{result.day}</span>
                        {result.targetName}
                      </span>
                      <span
                        className="lbl shrink-0"
                        style={result.isMafia ? { color: 'var(--color-accent)' } : undefined}
                      >
                        {result.isMafia ? 'Mafia' : 'Clear'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <EventLog className="flex-1" />
          </div>
        )}
      </aside>
    </div>
  );
}

function WaitingState({ resolving }: { resolving: boolean }) {
  const { state } = useGame();
  if (!state) return null;
  const { you } = state;

  const copy = resolving
    ? 'The night is resolving. Hold your breath.'
    : you.isSpectator
      ? 'You are watching from outside the game.'
      : !you.alive
        ? 'The dead do not act. You can only watch now.'
        : 'You have no business out at night. Wait for morning and pay attention.';

  return (
    <div className="flex flex-1 flex-col">
      <p className="lbl" style={{ letterSpacing: '0.3em' }}>
        Night {state.dayNumber}
      </p>
      <h1 className="display mt-3.5 text-[clamp(2.5rem,9vw,6rem)]">
        THE TOWN
        <br />
        <span className="text-accent">SLEEPS.</span>
      </h1>
      <p className="mt-8 max-w-[560px] text-[17px]">{copy}</p>

      <div className="mt-10 flex gap-2">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1 w-16 animate-bar-pulse"
            style={{ background: 'var(--color-accent)', animationDelay: `${i * 200}ms` }}
          />
        ))}
      </div>

      <div className="mt-auto grid grid-cols-3 border-t-2 border-divider pt-0">
        <div className="stat">
          <div className="stat-n">
            {state.players.filter((p) => p.alive && !p.isSpectator).length}
          </div>
          <div className="lbl mt-1">Alive</div>
        </div>
        <div className="stat">
          <div className="stat-n">
            {state.players.filter((p) => !p.alive && !p.isSpectator).length}
          </div>
          <div className="lbl mt-1">Dead</div>
        </div>
        <div className="stat">
          <div className="stat-n">?</div>
          <div className="lbl mt-1">Mafia remaining</div>
        </div>
      </div>
    </div>
  );
}

function confirmVerb(action: NightActionType): string {
  if (action === 'MAFIA_KILL') return 'Locked on';
  if (action === 'DOCTOR_PROTECT') return 'Protecting';
  return 'Investigating';
}

function captionFor(
  player: PublicPlayer,
  blockedId: string | null,
  investigations: Array<{ day: number; targetId: string }>,
): string | null {
  if (player.id === blockedId) return 'Guarded too many nights running';
  const seen = investigations.filter((i) => i.targetId === player.id);
  if (seen.length > 0) return `Investigated N${seen.at(-1)!.day}`;
  return null;
}

function nameOf(players: PublicPlayer[], id: string): string {
  return players.find((p) => p.id === id)?.name ?? 'someone';
}
