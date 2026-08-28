import Link from 'next/link';
import { ROLE_DEFINITIONS, ROLES } from '@mafia/shared';

import { Logo } from '@/components/Logo';

export default function LandingPage() {
  return (
    <main className="flex min-h-dvh flex-col">
      <header className="bar">
        <Logo href={null} />
        <div className="flex items-center gap-3">
          <span className="lbl hidden md:inline">6–15 players · free · no account</span>
          <Link href="/join" className="btn btn-secondary">
            Join a game
          </Link>
        </div>
      </header>

      <div className="grid flex-1 lg:grid-cols-[1fr_460px]">
        {/* --- The pitch ---------------------------------------------------- */}
        <section className="flex flex-col border-divider px-6 py-12 sm:px-10 sm:py-14 lg:border-r-2">
          <p className="lbl mb-5">A social deduction game for a group of friends</p>

          <h1 className="display text-[clamp(3.5rem,11vw,7.375rem)]">
            FIVE
            <br />
            NIGHTS.
            <br />
            ONE
            <br />
            <span className="text-accent">LIAR.</span>
          </h1>

          <p className="mt-7 max-w-xl text-[17px] leading-relaxed sm:text-lg">
            Create a room, send the link, and play in the browser. Roles are dealt in secret by
            the server — nobody can peek, not even the host.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="/create" className="btn btn-primary btn-lg sm:min-w-[200px]">
              Create game →
            </Link>
            <Link href="/join" className="btn btn-secondary btn-lg sm:min-w-[200px]">
              Join with a code
            </Link>
          </div>

          <div className="mt-auto grid grid-cols-3 border-t-2 border-divider pt-0">
            <div className="stat">
              <div className="stat-n text-[34px]">04</div>
              <div className="lbl mt-1">Roles</div>
            </div>
            <div className="stat">
              <div className="stat-n text-[34px]">45s</div>
              <div className="lbl mt-1">Night phase</div>
            </div>
            <div className="stat">
              <div className="stat-n text-[34px]">~12m</div>
              <div className="lbl mt-1">Average game</div>
            </div>
          </div>
        </section>

        {/* --- The roles ---------------------------------------------------- */}
        <section className="flex flex-col border-t-2 border-divider px-6 py-12 sm:px-10 lg:border-t-0">
          <p className="lbl mb-4">The four roles</p>

          <div className="border-t-2 border-divider">
            {ROLES.map((role) => {
              const definition = ROLE_DEFINITIONS[role];
              const isMafia = definition.team === 'MAFIA';
              return (
                <article
                  key={role}
                  className="border-b border-divider py-[18px] last:border-b-2"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="m-0 text-[22px]">{definition.label}</h3>
                    <span className={isMafia ? 'tag tag-accent' : 'tag tag-outline'}>
                      {isMafia ? 'Mafia' : 'Town'}
                    </span>
                  </div>
                  <p className="mb-0 mt-1.5 text-sm text-muted">{definition.tagline}</p>
                </article>
              );
            })}
          </div>

          <div className="mt-auto pt-6">
            <p className="lbl">Win condition</p>
            <p className="mb-0 mt-2 text-sm">
              Town wins when every Mafia is dead. Mafia wins the moment they equal the rest of
              the table.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
