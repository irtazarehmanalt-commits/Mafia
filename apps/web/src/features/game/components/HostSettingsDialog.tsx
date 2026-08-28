'use client';

import { DEFAULT_SETTINGS } from '@mafia/shared';
import { useEffect } from 'react';

import { OnOff, Segment, SettingRow } from '@/components/ui/Input';
import { useGame } from '../GameProvider';

/**
 * The host's control panel. Every change is sent immediately and re-clamped by
 * the server, so the dialog never holds a draft that could drift from truth.
 */
export function HostSettingsDialog({ onClose }: { onClose: () => void }) {
  const { state, updateSettings, endGameEarly } = useGame();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!state) return null;
  const s = state.settings;
  const inGame = state.phase !== 'LOBBY' && state.phase !== 'GAME_OVER';

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Game settings"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b-2 border-divider px-6 py-5 sm:px-[30px]">
          <h2 className="m-0 text-[clamp(1.375rem,4vw,1.75rem)]">Game settings</h2>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="grid md:grid-cols-2">
          <section className="border-divider px-6 py-6 sm:px-[30px] md:border-r">
            <p className="lbl mb-4">Timers</p>
            <div className="border-t border-divider">
              <SettingRow label="Role reveal">
                <Segment
                  value={s.durations.ROLE_REVEAL}
                  onChange={(ROLE_REVEAL) => void updateSettings({ durations: { ROLE_REVEAL } })}
                  options={[10, 15, 20].map((v) => ({ value: v, label: `${v}s` }))}
                />
              </SettingRow>
              <SettingRow label="Night">
                <Segment
                  value={s.durations.NIGHT}
                  onChange={(NIGHT) => void updateSettings({ durations: { NIGHT } })}
                  options={[30, 45, 60].map((v) => ({ value: v, label: `${v}s` }))}
                />
              </SettingRow>
              <SettingRow label="Discussion">
                <Segment
                  value={s.durations.DISCUSSION}
                  onChange={(DISCUSSION) => void updateSettings({ durations: { DISCUSSION } })}
                  options={[90, 120, 180].map((v) => ({ value: v, label: `${v}s` }))}
                />
              </SettingRow>
              <SettingRow label="Voting">
                <Segment
                  value={s.durations.VOTING}
                  onChange={(VOTING) => void updateSettings({ durations: { VOTING } })}
                  options={[45, 60, 90].map((v) => ({ value: v, label: `${v}s` }))}
                />
              </SettingRow>
            </div>
          </section>

          <section className="px-6 py-6 sm:px-[30px]">
            <p className="lbl mb-4">Rules</p>
            <div className="border-t border-divider">
              <SettingRow label="Reveal role on death">
                <OnOff
                  value={s.revealRoleOnDeath}
                  onChange={(revealRoleOnDeath) => void updateSettings({ revealRoleOnDeath })}
                />
              </SettingRow>
              <SettingRow
                label="Doctor self-protection"
                note={`Max ${s.doctorMaxConsecutiveSameTarget} nights on the same player`}
              >
                <OnOff
                  value={s.doctorCanSelfProtect}
                  onChange={(doctorCanSelfProtect) =>
                    void updateSettings({ doctorCanSelfProtect })
                  }
                />
              </SettingRow>
              <SettingRow label="Vote counts">
                <Segment
                  value={s.publicVotes ? 'public' : 'secret'}
                  onChange={(v) => void updateSettings({ publicVotes: v === 'public' })}
                  options={[
                    { value: 'secret', label: 'Secret' },
                    { value: 'public', label: 'Public' },
                  ]}
                />
              </SettingRow>
              <SettingRow label="Tie handling">
                <Segment
                  value={s.tieRule}
                  onChange={(tieRule) => void updateSettings({ tieRule })}
                  options={[
                    { value: 'NO_ELIMINATION', label: 'Nobody dies' },
                    { value: 'RANDOM', label: 'Random' },
                  ]}
                />
              </SettingRow>
              <SettingRow label="Spectators">
                <OnOff
                  value={s.allowSpectators}
                  onChange={(allowSpectators) => void updateSettings({ allowSpectators })}
                />
              </SettingRow>
              <SettingRow
                label="Disconnected players"
                note={`After ${s.reconnectGraceSeconds}s offline`}
              >
                <Segment
                  value={s.disconnectPolicy}
                  onChange={(disconnectPolicy) => void updateSettings({ disconnectPolicy })}
                  options={[
                    { value: 'KEEP_INACTIVE', label: 'Stay in' },
                    { value: 'ELIMINATE', label: 'Eliminate' },
                  ]}
                />
              </SettingRow>
            </div>
          </section>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t-2 border-divider px-6 py-5 sm:px-[30px]">
          <button type="button" className="btn btn-primary min-w-[180px]" onClick={onClose}>
            Done
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void updateSettings(DEFAULT_SETTINGS)}
          >
            Reset to defaults
          </button>
          {inGame && (
            <button
              type="button"
              className="btn btn-danger ml-auto"
              onClick={() => {
                if (confirm('End the game for everyone?')) {
                  void endGameEarly();
                  onClose();
                }
              }}
            >
              End game for everyone
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
