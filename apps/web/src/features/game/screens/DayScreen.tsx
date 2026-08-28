'use client';

import { ROLE_DEFINITIONS } from '@mafia/shared';

import { initials } from '@/lib/theme';
import { useGame } from '../GameProvider';
import { ChatPanel } from '../components/ChatPanel';
import { EventLog } from '../components/Overlays';
import { PlayerTile, TileGrid } from '../components/PlayerTile';

export function DayScreen() {
  const { state } = useGame();
  if (!state) return null;
  return state.phase === 'DAY_ANNOUNCEMENT' ? <Announcement /> : <Discussion />;
}

/* ---------------------------------------------------------------------------
 * Morning. One fact, set as large as it will go.
 * ------------------------------------------------------------------------- */
function Announcement() {
  const { state } = useGame();
  if (!state) return null;

  const seated = state.players.filter((p) => !p.isSpectator);
  const alive = seated.filter((p) => p.alive);
  const dead = seated.filter((p) => !p.alive);
  // Whoever fell last night — the vote has not happened yet today.
  const victim = dead.find((p) => p.diedOnDay === state.dayNumber) ?? null;

  return (
    <div className="grid flex-1 lg:grid-cols-[1fr_440px]">
      <section className="flex flex-col border-divider px-6 py-12 sm:px-11 sm:py-13 lg:border-r-2">
        <p className="lbl" style={{ letterSpacing: '0.3em' }}>
          Morning has arrived
        </p>

        <h1 className="display mt-4 text-[clamp(2.5rem,8.5vw,6.5rem)]">
          {victim ? (
            <>
              {victim.name.toUpperCase()} WAS
              <br />
              FOUND DEAD.
            </>
          ) : (
            <>
              EVERYONE
              <br />
              SURVIVED
              <br />
              THE NIGHT.
            </>
          )}
        </h1>

        <div className="my-8 h-0.5 w-full" style={{ background: 'var(--color-text)' }} />

        {victim ? (
          <div className="flex flex-wrap items-center gap-5">
            <div className="grid h-24 w-24 place-items-center bg-neutral-300 text-[30px] font-black">
              {initials(victim.name)}
            </div>
            <div>
              <div className="text-[clamp(1.5rem,4vw,2.125rem)] font-black line-through decoration-[3px]">
                {victim.name}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {victim.revealedRole ? (
                  <span className="tag tag-neutral">
                    {ROLE_DEFINITIONS[victim.revealedRole].label}
                  </span>
                ) : (
                  <span className="tag tag-neutral">Role kept secret</span>
                )}
                <span className="tag tag-outline">Killed night {state.dayNumber}</span>
              </div>
            </div>
          </div>
        ) : (
          <p className="m-0 max-w-[620px] text-[17px]">
            Nobody died. Either the Mafia could not agree, or somebody was standing in the way —
            and you will never be told which.
          </p>
        )}

        <p className="mt-7 max-w-[620px] text-[17px] text-muted">
          {alive.length} players remain. Discussion opens in a moment — say what you know, or
          don&apos;t.
        </p>

        <div className="mt-auto grid grid-cols-3 border-t-2 border-divider pt-0">
          <div className="stat">
            <div className="stat-n">{alive.length}</div>
            <div className="lbl mt-1">Alive</div>
          </div>
          <div className="stat">
            <div className="stat-n">{dead.length}</div>
            <div className="lbl mt-1">Dead</div>
          </div>
          <div className="stat">
            <div className="stat-n">?</div>
            <div className="lbl mt-1">Mafia remaining</div>
          </div>
        </div>
      </section>

      <aside className="flex min-h-0 flex-col border-t-2 border-divider bg-surface px-6 py-12 sm:px-9 lg:border-t-0">
        <EventLog className="flex-1" />
        <div className="mt-8 border border-divider p-4">
          <p className="lbl mb-0">Note</p>
          <p className="mb-0 mt-1.5 text-[13px]">
            The log never shows who acted at night — only outcomes.
          </p>
        </div>
      </aside>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Discussion. The table on the left, the argument on the right.
 * ------------------------------------------------------------------------- */
function Discussion() {
  const { state } = useGame();
  if (!state) return null;

  const seated = state.players.filter((p) => !p.isSpectator);
  const alive = seated.filter((p) => p.alive);
  const dead = seated.filter((p) => !p.alive);

  return (
    <div className="grid flex-1 lg:grid-cols-[1fr_500px]">
      <section className="flex flex-col px-6 py-7 sm:px-8">
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h2 className="m-0 text-[clamp(1.5rem,4vw,1.875rem)]">The table</h2>
          <span className="lbl">
            {alive.length} alive · {dead.length} dead
          </span>
        </div>

        <TileGrid>
          {[...alive, ...dead].map((player) => (
            <PlayerTile
              key={player.id}
              player={player}
              you={player.id === state.you.playerId}
              accent={player.id === state.you.playerId}
            />
          ))}
        </TileGrid>

        <div className="mt-8 flex flex-wrap items-center gap-3.5 border-t-2 border-divider pt-4 lg:mt-auto">
          <span className="lbl">Voting opens automatically when the timer ends</span>
          {!state.you.alive && !state.you.isSpectator && (
            <span className="lbl ml-auto" style={{ color: 'var(--color-accent)' }}>
              You are dead — you cannot vote
            </span>
          )}
        </div>
      </section>

      <ChatPanel className="min-h-[50dvh] border-t-2 border-divider lg:min-h-0 lg:border-l-2 lg:border-t-0" />
    </div>
  );
}
