'use client';

import type { ChatChannel } from '@mafia/shared';
import { useEffect, useMemo, useRef, useState } from 'react';

import { cn } from '@/lib/cn';
import { useGame } from '../GameProvider';

const CHANNEL_TITLE: Record<ChatChannel, string> = {
  LOBBY: 'Lobby chat',
  DAY: 'Table chat',
  MAFIA: 'Family channel',
  DEAD: 'The dead',
};

const CHANNEL_TAB: Record<ChatChannel, string> = {
  LOBBY: 'Lobby',
  DAY: 'Table',
  MAFIA: 'Family',
  DEAD: 'Dead',
};

/**
 * Chat is filtered on the server: a channel this viewer may not read never
 * arrives here at all. This component only picks which of the channels they
 * *can* see is in focus.
 */
export function ChatPanel({ className }: { className?: string }) {
  const { state, sendChat } = useGame();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const writable = writableChannel(state);

  const channels = useMemo(() => {
    const present = new Set(state?.chat.map((m) => m.channel) ?? []);
    if (writable) present.add(writable);
    const order: ChatChannel[] = ['DAY', 'MAFIA', 'DEAD', 'LOBBY'];
    return order.filter((c) => present.has(c));
  }, [state?.chat, writable]);

  const [active, setActive] = useState<ChatChannel>('DAY');

  useEffect(() => {
    if (writable && channels.includes(writable)) setActive(writable);
    else if (channels.length > 0 && !channels.includes(active)) setActive(channels[0]!);
  }, [writable, channels, active]);

  const messages = useMemo(
    () => (state?.chat ?? []).filter((m) => m.channel === active),
    [state?.chat, active],
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  if (!state) return null;

  const handleSend = async (event: React.FormEvent) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body || !writable) return;
    setSending(true);
    try {
      await sendChat(writable, body);
      setDraft('');
    } catch {
      /* the provider already surfaced a toast */
    } finally {
      setSending(false);
    }
  };

  const isFamily = active === 'MAFIA';

  return (
    <div className={cn('flex min-h-0 flex-col bg-surface', className)}>
      <div className="flex shrink-0 items-center justify-between gap-3 border-b-2 border-divider px-5 py-4">
        <span className="lbl" style={isFamily ? { color: 'var(--color-accent)' } : undefined}>
          {CHANNEL_TITLE[active]}
        </span>
        {channels.length > 1 ? (
          <div className="seg">
            {channels.map((channel) => (
              <button
                key={channel}
                type="button"
                aria-pressed={active === channel}
                onClick={() => setActive(channel)}
                className="seg-opt !px-2.5 !py-1 !text-[11px]"
              >
                {CHANNEL_TAB[channel]}
              </button>
            ))}
          </div>
        ) : (
          <span className="lbl">{active === 'DAY' ? 'Living players only' : 'Private'}</span>
        )}
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
        {messages.length === 0 && <p className="lbl">Nothing said yet.</p>}
        {messages.map((message) => {
          const mine = message.playerId === state.you.playerId;
          if (message.system) {
            return (
              <div key={message.id} className="border border-dashed border-divider px-3 py-2">
                <p className="mb-0 text-[13px] text-muted">{message.body}</p>
              </div>
            );
          }
          return (
            <div
              key={message.id}
              className={cn(mine && 'border-l-2 pl-3')}
              style={mine ? { borderColor: 'var(--color-accent)' } : undefined}
            >
              <div
                className="lbl mb-0.5"
                style={mine ? { color: 'var(--color-accent)' } : undefined}
              >
                {message.playerName}
                {mine && ' · you'} ·{' '}
                {new Date(message.createdAt).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </div>
              <div className="break-words text-[15px]">{message.body}</div>
            </div>
          );
        })}
      </div>

      <form
        onSubmit={handleSend}
        className="safe-bottom shrink-0 border-t-2 border-divider px-5 py-4"
      >
        {writable ? (
          <>
            <div className="flex gap-2.5">
              <input
                className="input flex-1"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={500}
                placeholder={
                  isFamily ? 'Say something to your family…' : 'Message the table…'
                }
              />
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!draft.trim() || sending}
              >
                Send
              </button>
            </div>
            {isFamily && <p className="lbl mb-0 mt-2.5">Cleared at dawn. Never stored.</p>}
          </>
        ) : (
          <p className="lbl mb-0 text-center">
            {state.you.alive
              ? 'You cannot speak right now'
              : 'The dead cannot talk to the living'}
          </p>
        )}
      </form>
    </div>
  );
}

/** Mirrors the server's write rules so the composer only shows when usable. */
function writableChannel(state: ReturnType<typeof useGame>['state']): ChatChannel | null {
  if (!state) return null;
  if (state.phase === 'LOBBY') return 'LOBBY';
  if (state.you.isSpectator || !state.you.alive) {
    return state.settings.deadChatEnabled ? 'DEAD' : null;
  }
  if (state.phase === 'NIGHT') return state.you.role === 'MAFIA' ? 'MAFIA' : null;
  if (['DAY_ANNOUNCEMENT', 'DISCUSSION', 'VOTING', 'VOTE_RESOLUTION'].includes(state.phase)) {
    return 'DAY';
  }
  return null;
}
