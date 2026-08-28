'use client';

import { resolveRoleCounts } from '@mafia/shared';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { useGame } from '../GameProvider';
import { ChatPanel } from '../components/ChatPanel';
import { HostSettingsDialog } from '../components/HostSettingsDialog';
import { PlayerTile, TileGrid } from '../components/PlayerTile';

export function LobbyScreen() {
  const { state, startGame, kickPlayer, transferHost, cancelRoom, setReady } = useGame();
  const [starting, setStarting] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showChat, setShowChat] = useState(false);

  const seated = useMemo(
    () => (state?.players ?? []).filter((p) => !p.isSpectator),
    [state?.players],
  );

  if (!state) return null;

  const isHost = state.you.isHost;
  const enough = seated.length >= state.settings.minPlayers;
  const counts = resolveRoleCounts(seated.length, state.settings.roleCountOverride);
  const host = state.players.find((p) => p.isHost);
  const feed = [...state.events].reverse().slice(0, 6);

  return (
    <>
      <div className="grid flex-1 lg:grid-cols-[1fr_420px]">
        {/* --- Roster ------------------------------------------------------- */}
        <section className="flex flex-col border-divider px-6 py-8 sm:px-9 lg:border-r-2">
          <div className="mb-6 flex items-end justify-between gap-4">
            <h1 className="m-0 text-[clamp(2rem,6vw,2.5rem)]">Lobby</h1>
            <div className="text-right">
              <div className="text-[32px] font-black leading-none">
                {seated.length} / {state.settings.maxPlayers}
              </div>
              <div className="lbl mt-1">
                {enough ? 'Ready to start' : `${state.settings.minPlayers} needed`}
              </div>
            </div>
          </div>

          <TileGrid className="gap-4">
            {state.players.map((player) => (
              <PlayerTile
                key={player.id}
                player={player}
                you={player.id === state.you.playerId}
                accent={player.id === state.you.playerId}
                actions={
                  isHost && player.id !== state.you.playerId && !player.isSpectator ? (
                    <>
                      <IconAction title="Make host" onClick={() => void transferHost(player.id)}>
                        ★
                      </IconAction>
                      <IconAction title="Remove" danger onClick={() => void kickPlayer(player.id)}>
                        ✕
                      </IconAction>
                    </>
                  ) : null
                }
              />
            ))}
          </TileGrid>

          <div className="mt-8 flex flex-wrap items-center gap-3 border-t-2 border-divider pt-5 lg:mt-auto">
            {isHost ? (
              <>
                <Button
                  size="lg"
                  disabled={!enough}
                  loading={starting}
                  className="min-w-[260px] text-[17px]"
                  onClick={async () => {
                    setStarting(true);
                    try {
                      await startGame();
                    } finally {
                      setStarting(false);
                    }
                  }}
                >
                  {enough ? 'Start game →' : `Need ${state.settings.minPlayers} players`}
                </Button>
                <Button variant="secondary" onClick={() => setShowSettings(true)}>
                  Settings
                </Button>
                <Button
                  variant="danger"
                  className="ml-auto"
                  onClick={() => {
                    if (confirm('Close this room for everyone?')) void cancelRoom();
                  }}
                >
                  Cancel room
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="lg"
                  variant={state.you.ready ? 'secondary' : 'primary'}
                  className="min-w-[220px]"
                  onClick={() => void setReady(!state.you.ready)}
                >
                  {state.you.ready ? "You're ready" : "I'm ready →"}
                </Button>
                <span className="lbl">
                  Waiting for {host?.name ?? 'the host'} to start
                </span>
              </>
            )}
            <Button
              variant="secondary"
              className="lg:hidden"
              onClick={() => setShowChat((v) => !v)}
            >
              {showChat ? 'Hide chat' : 'Chat'}
            </Button>
          </div>
        </section>

        {/* --- Settings + feed ---------------------------------------------- */}
        <aside className="flex flex-col border-t-2 border-divider bg-surface px-6 py-8 sm:px-[30px] lg:border-t-0">
          <p className="lbl mb-3.5">Room settings</p>
          <div className="border-t border-divider">
            <Row k="Mafia" v={String(counts.MAFIA)} />
            <Row k="Doctor / Detective" v={`${counts.DOCTOR} / ${counts.DETECTIVE}`} />
            <Row k="Night" v={`${state.settings.durations.NIGHT}s`} />
            <Row k="Discussion" v={`${state.settings.durations.DISCUSSION}s`} />
            <Row k="Voting" v={`${state.settings.durations.VOTING}s`} />
            <Row k="Reveal on death" v={state.settings.revealRoleOnDeath ? 'Yes' : 'No'} />
            <Row
              k="Tie"
              v={state.settings.tieRule === 'RANDOM' ? 'Random' : 'No elimination'}
            />
          </div>

          <p className="lbl mb-3 mt-7">Lobby feed</p>
          <div className="grid gap-2.5 text-[13px] text-muted">
            {feed.length === 0 && <span>Nothing yet.</span>}
            {feed.map((event) => (
              <div key={event.id}>
                <span className="mono">
                  {new Date(event.createdAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
                &nbsp;&nbsp;{event.message}
              </div>
            ))}
          </div>

          <div className="mt-auto border border-divider p-3.5">
            <p className="lbl mb-0">Host tip</p>
            <p className="mb-0 mt-1.5 text-[13px]">
              Roles are dealt by the server. The host will not know anyone&apos;s role either.
            </p>
          </div>
        </aside>
      </div>

      {/* Chat is a drawer on small screens and a panel on large ones. */}
      <div className={showChat ? 'block lg:hidden' : 'hidden'}>
        <ChatPanel className="h-[60dvh] border-t-2 border-divider" />
      </div>

      {showSettings && <HostSettingsDialog onClose={() => setShowSettings(false)} />}
    </>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="kv">
      <span className="lbl">{k}</span>
      <span className="kv-v">{v}</span>
    </div>
  );
}

function IconAction({
  children,
  title,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="grid h-7 w-7 place-items-center border border-divider text-[11px] transition-colors hover:border-accent"
      style={danger ? { color: 'var(--color-accent)' } : undefined}
    >
      {children}
    </button>
  );
}
