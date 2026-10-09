import { useEffect, useState } from 'react';
import {
  type BoardRow,
  type HistoryEntry,
  MIN_RANKED_GAMES,
  type ProfileStats,
  fetchHistory,
  fetchLeaderboard,
  fetchProfile,
} from '../auth';
import { avatarColors, initial } from '../format';
import { useStore } from '../store';

/** Pastille de joueur : photo Discord/Google si disponible, sinon initiale sur sa couleur. */
export function Avatar({
  name,
  color,
  url,
  size = 34,
  className = '',
}: {
  name: string;
  color: number;
  url?: string | null;
  size?: number;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const [bg, fg] = avatarColors(color);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.4), background: bg, color: fg };
  if (url && !broken) {
    return (
      <span className={`av ${className}`} style={style}>
        <img src={url} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
      </span>
    );
  }
  return (
    <span className={`av ${className}`} style={style}>
      {initial(name)}
    </span>
  );
}

const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)} %` : '–');

/** Barre du haut de l'application : profil, classement, connexion / déconnexion, règles. */
export function AppBar({ onRules }: { onRules?: () => void }) {
  const { auth, accountsEnabled, page, navigate, signOut, openAuth } = useStore();
  const me = auth.profile;
  return (
    <header className="appbar">
      <button type="button" className="brand" onClick={() => navigate({ name: 'main' })}>
        Durak
      </button>
      <nav className="appbar-nav" aria-label="Navigation">
        {accountsEnabled && me && (
          <button
            aria-label="Profil"
            type="button"
            className="nav-btn"
            aria-current={page.name === 'profile' && page.id === me.id ? 'page' : undefined}
            onClick={() => navigate({ name: 'profile', id: me.id })}
          >
            <Avatar name={me.username} color={me.color} url={me.avatarUrl} size={22} />
            <span className="nav-label">Profil</span>
          </button>
        )}
        {accountsEnabled && (
          <button
            aria-label="Classement"
            type="button"
            className="nav-btn"
            aria-current={page.name === 'leaderboard' ? 'page' : undefined}
            onClick={() => navigate({ name: 'leaderboard' })}
          >
            <span className="nav-icon" aria-hidden="true">
              ♛
            </span>
            <span className="nav-label">Classement</span>
          </button>
        )}
        {onRules && (
          <button
            aria-label="Règles" type="button" className="nav-btn" onClick={onRules}>
            <span className="nav-icon" aria-hidden="true">
              ?
            </span>
            <span className="nav-label">Règles</span>
          </button>
        )}
        {accountsEnabled &&
          (auth.signedIn ? (
            <button
            aria-label="Se déconnecter" type="button" className="nav-btn" onClick={() => signOut()}>
              <span className="nav-icon" aria-hidden="true">
                ⏻
              </span>
              <span className="nav-label">Se déconnecter</span>
            </button>
          ) : (
            <button
            aria-label="Se connecter" type="button" className="nav-btn primary" onClick={() => openAuth(true)}>
              <span className="nav-icon" aria-hidden="true">
                →
              </span>
              <span className="nav-label">Se connecter</span>
            </button>
          ))}
      </nav>
    </header>
  );
}

/** Mise en page commune aux pages (profil, classement) : barre du haut + contenu centré. */
function PageShell({ title, children, onRules }: { title: string; children: React.ReactNode; onRules?: () => void }) {
  const { goBack } = useStore();
  return (
    <div className="app-shell">
      <AppBar onRules={onRules} />
      <main className="page">
        <button type="button" className="back-link" onClick={goBack}>
          ← Retour
        </button>
        <h1 className="page-title">{title}</h1>
        {children}
      </main>
    </div>
  );
}

const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const monthFmt = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });

/** Page profil d'un joueur : chiffres clés, 10 dernières parties, historique. */
export function ProfilePage({ id, onRules }: { id: string; onRules?: () => void }) {
  const { navigate, auth } = useStore();
  const [data, setData] = useState<{ stats: ProfileStats; createdAt: string | null; rank: number | null } | null | 'loading'>(
    'loading',
  );
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    let alive = true;
    setData('loading');
    Promise.all([fetchProfile(id), fetchHistory(id, 20)])
      .then(([p, h]) => {
        if (!alive) return;
        setData(p);
        setHistory(h);
      })
      .catch(() => alive && setData(null));
    return () => {
      alive = false;
    };
  }, [id]);

  if (data === 'loading')
    return (
      <PageShell title="Profil" onRules={onRules}>
        <p className="hint">Chargement du profil…</p>
      </PageShell>
    );
  if (!data)
    return (
      <PageShell title="Profil introuvable" onRules={onRules}>
        <p>Ce joueur n’existe pas ou a supprimé son compte.</p>
      </PageShell>
    );

  const s = data.stats;
  // 10 dernières parties, de la plus ancienne (à gauche) à la plus récente ; cases vides s'il y en a moins.
  const recent = history.slice(0, 10).reverse();
  const streak: (HistoryEntry | null)[] = [...Array<null>(10 - recent.length).fill(null), ...recent];
  return (
    <PageShell title="Profil" onRules={onRules}>
      <div className="phead">
        <Avatar name={s.username} color={s.color} url={s.avatar_url} size={56} />
        <div>
          <h2>
            {s.username}
            {auth.profile?.id === s.id && <span className="hint"> (toi)</span>}
          </h2>
          <span className="hint">
            {data.createdAt ? `Inscrit en ${monthFmt.format(new Date(data.createdAt))}` : ''}
            {data.rank ? ` · ${data.rank}e au classement` : s.games < MIN_RANKED_GAMES ? ` · classé après ${MIN_RANKED_GAMES} parties` : ''}
          </span>
        </div>
      </div>
      <div className="kpis">
        <div className="kpi">
          <div className="k">Parties</div>
          <div className="v">{s.games}</div>
        </div>
        <div className="kpi">
          <div className="k">Korol</div>
          <div className="v gold">{s.korol}</div>
          <div className="s">{pct(s.korol, s.games)} des parties</div>
        </div>
        <div className="kpi">
          <div className="k">Durak</div>
          <div className="v red">{s.durak}</div>
          <div className="s">{pct(s.durak, s.games)} des parties</div>
        </div>
        <div className="kpi">
          <div className="k">10 dernières</div>
          <div className="streak" aria-label="Résultats des 10 dernières parties">
            {streak.map((g, i) => (
              <i key={i} className={!g ? 'none' : g.isKorol ? 'k' : g.isDurak ? 'd' : ''} />
            ))}
          </div>
          <div className="s">or = Korol · rouge = durak</div>
        </div>
      </div>
      <h2 className="section-title">Dernières parties</h2>
      {history.length > 0 ? (
        <div className="hist">
          {history.map((h, i) => (
            <div key={i}>
              <time>{dateFmt.format(new Date(h.endedAt))}</time>
              <span>
                {h.playerCount} joueurs{h.others.length ? ` · avec ${h.others.join(', ')}` : ''}
              </span>
              <span className={`res ${h.isKorol ? 'k' : h.isDurak ? 'd' : 'n'}`}>
                {h.isKorol ? 'Korol' : h.isDurak ? 'Durak' : `${(h.place ?? 0) + 1}e`}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="hint">Aucune partie enregistrée pour l’instant.</p>
      )}
      <div className="buttons left">
        <button type="button" className="btn ghost" onClick={() => navigate({ name: 'leaderboard' })}>
          Voir le classement
        </button>
      </div>
    </PageShell>
  );
}

/** Page classement des comptes ayant assez de parties. */
export function LeaderboardPage({ onRules }: { onRules?: () => void }) {
  const { navigate, auth } = useStore();
  const [order, setOrder] = useState<'korol' | 'durak'>('korol');
  const [month, setMonth] = useState(false);
  const [rows, setRows] = useState<BoardRow[] | null>(null);

  useEffect(() => {
    let alive = true;
    setRows(null);
    fetchLeaderboard(order, month)
      .then((r) => alive && setRows(r))
      .catch(() => alive && setRows([]));
    return () => {
      alive = false;
    };
  }, [order, month]);

  return (
    <PageShell title="Classement" onRules={onRules}>
      <div className="board-filters">
        <div className="tabs" role="tablist" aria-label="Critère">
          <button type="button" role="tab" aria-selected={order === 'korol'} onClick={() => setOrder('korol')}>
            % de Korol
          </button>
          <button type="button" role="tab" aria-selected={order === 'durak'} onClick={() => setOrder('durak')}>
            Moins de durak
          </button>
        </div>
        <div className="tabs" role="tablist" aria-label="Période">
          <button type="button" role="tab" aria-selected={!month} onClick={() => setMonth(false)}>
            Depuis toujours
          </button>
          <button type="button" role="tab" aria-selected={month} onClick={() => setMonth(true)}>
            Ce mois-ci
          </button>
        </div>
      </div>
      <div className="board">
        <div className="row head">
          <span>#</span>
          <span>Joueur</span>
          <span className="num">Parties</span>
          <span className="num">Korol</span>
          <span className="num hide-sm">Durak</span>
        </div>
        {rows === null && <p className="hint">Chargement…</p>}
        {rows?.length === 0 && (
          <p className="hint">Personne n’est encore classé : il faut au moins {MIN_RANKED_GAMES} parties.</p>
        )}
        {rows?.map((r) => (
          <button
            type="button"
            key={r.id}
            className={`row ${r.id === auth.profile?.id ? 'me' : ''}`}
            onClick={() => navigate({ name: 'profile', id: r.id })}
          >
            <span className="pos">{r.rank}</span>
            <span className="who">
              <Avatar name={r.username} color={r.color} url={r.avatar_url} size={26} />
              {r.username}
            </span>
            <span className="num">{r.games}</span>
            <span className="num">{pct(r.korol, r.games)}</span>
            <span className="num hide-sm">{pct(r.durak, r.games)}</span>
          </button>
        ))}
      </div>
      <p className="hint">Classement à partir de {MIN_RANKED_GAMES} parties, sans les parties avec des bots.</p>
    </PageShell>
  );
}
