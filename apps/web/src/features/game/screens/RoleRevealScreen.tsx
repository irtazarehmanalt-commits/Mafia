'use client';

import { ROLE_DEFINITIONS } from '@mafia/shared';

import { initials } from '@/lib/theme';
import { useGame } from '../GameProvider';
import { useCountdown } from '../useCountdown';

export function RoleRevealScreen() {
  const { state, clockOffset } = useGame();
  const countdown = useCountdown(
    state?.phaseEndsAt ?? null,
    clockOffset,
    state?.phaseStartedAt ?? null,
  );

  if (!state) return null;

  const role = state.you.role;
  const definition = role ? ROLE_DEFINITIONS[role] : null;
  const allies = new Set(state.you.mafiaAllies);
  const isMafia = role === 'MAFIA';

  return (
    <div className="grid flex-1 lg:grid-cols-[1fr_480px]">
      {/* --- The role ------------------------------------------------------- */}
      <section className="flex flex-col border-divider px-6 py-12 sm:px-11 sm:py-14 lg:border-r-2">
        <p className="lbl" style={{ letterSpacing: '0.3em' }}>
          {definition ? 'You are' : 'You are watching'}
        </p>

        <h1
          className="display mt-3.5 text-[clamp(3.25rem,13vw,9.375rem)]"
          style={{ color: 'var(--color-accent-500)' }}
        >
          {definition ? definition.label.toUpperCase() : 'SPECTATOR'}
        </h1>

        <div className="my-8 h-0.5 w-[180px]" style={{ background: 'var(--color-accent)' }} />

        <p className="m-0 max-w-[600px] text-[clamp(1rem,2.2vw,1.25rem)] leading-snug">
          {definition
            ? definition.description
            : 'The game has begun without you. You can follow along, but you have no role and no vote until the next round.'}
        </p>

        {isMafia && allies.size > 0 && (
          <div
            className="mt-6 max-w-[600px] border-2 p-5"
            style={{ borderColor: 'var(--color-accent)', background: 'var(--tint)' }}
          >
            <p className="lbl mb-2" style={{ color: 'var(--color-accent)' }}>
              Your family
            </p>
            <p className="m-0 text-[clamp(1.25rem,3vw,1.75rem)] font-black">
              {state.players
                .filter((p) => allies.has(p.id))
                .map((p) => p.name)
                .join(' · ')}
            </p>
          </div>
        )}

        <p className="mt-5 max-w-[600px] text-[15px] text-muted">
          Nobody else can see this screen. The server deals every role — not even the host knows
          who you are.
        </p>

        {definition && (
          <div className="mt-auto flex flex-wrap gap-3 pt-8">
            <span className="tag tag-neutral">Team: {definition.team === 'MAFIA' ? 'Mafia' : 'Town'}</span>
            <span className="tag tag-neutral">
              {definition.nightAction ? 'Acts at night' : 'No night ability'}
            </span>
            <span className="tag tag-neutral">Votes by day</span>
          </div>
        )}
      </section>

      {/* --- The table ------------------------------------------------------ */}
      <aside className="flex flex-col border-t-2 border-divider bg-surface px-6 py-12 sm:px-10 lg:border-t-0">
        <p className="lbl mb-4">At the table</p>

        <div className="border-t border-divider">
          {state.players
            .filter((p) => !p.isSpectator)
            .map((player) => {
              const isYou = player.id === state.you.playerId;
              const isAlly = allies.has(player.id);
              return (
                <div
                  key={player.id}
                  className="flex items-center gap-2.5 border-b border-divider py-3"
                >
                  <div className={`av av-sm${isYou || isAlly ? ' av-accent' : ''}`}>
                    {initials(player.name)}
                  </div>
                  <span className="pname truncate">{player.name}</span>
                  <span
                    className="lbl ml-auto shrink-0"
                    style={isYou || isAlly ? { color: 'var(--color-accent)' } : undefined}
                  >
                    {isYou ? 'You' : isAlly ? 'Family' : player.isHost ? 'Host' : ''}
                  </span>
                </div>
              );
            })}
        </div>

        <div className="mt-auto pt-8">
          <div className="h-1" style={{ background: 'rgba(243,242,242,.16)' }}>
            <div
              className="h-1 transition-[width] duration-300 ease-linear"
              style={{
                width: `${(1 - countdown.progress) * 100}%`,
                background: 'var(--color-accent)',
              }}
            />
          </div>
          <p className="lbl mb-0 mt-2.5">Night 1 begins when the timer ends</p>
        </div>
      </aside>
    </div>
  );
}
