import { getTickerName, hasTickerName } from '../../data/tickerNames';

interface TickerLabelProps {
  ticker: string;
  /** Mise en page :
   *  - "inline" : ticker en mono + nom à côté en gris (par défaut)
   *  - "stacked" : ticker en haut, nom en dessous (utile dans les listes verticales)
   *  - "code-only" : que le ticker (pas de nom) — utile dans tableaux denses
   *  - "name-only" : que le nom (ou ticker en fallback)
   */
  variant?: 'inline' | 'stacked' | 'code-only' | 'name-only';
  /** Taille du ticker en pixels (le nom est toujours plus petit). */
  size?: number;
  /** Si fourni, masque le suffixe d'exchange (":XETR", ":XPAR", etc.) du ticker affiché. */
  hideExchange?: boolean;
  /** Couleur du ticker. Défaut: couleur normale. */
  color?: string;
  /** Style additionnel sur le container. */
  style?: React.CSSProperties;
  /** Force l'affichage du nom même si pas de mapping (utilisera le ticker brut). */
  alwaysShowName?: boolean;
}

/**
 * Affiche un ticker boursier avec son nom d'entreprise.
 * Conçu pour rendre l'app accessible aux néophytes ("Apple" plutôt que "AAPL").
 *
 * Exemples :
 *   <TickerLabel ticker="AAPL" />            → AAPL  Apple
 *   <TickerLabel ticker="MC:XPAR" variant="stacked" hideExchange />
 *     →  MC
 *        LVMH
 */
export function TickerLabel({
  ticker,
  variant = 'inline',
  size = 13,
  hideExchange = false,
  color,
  style,
  alwaysShowName = false,
}: TickerLabelProps) {
  const name = getTickerName(ticker);
  const showName = alwaysShowName || hasTickerName(ticker);
  const displayedCode = hideExchange && ticker.includes(':') ? ticker.split(':')[0] : ticker;

  if (variant === 'code-only') {
    return (
      <span className="mono" style={{ fontWeight: 600, fontSize: size, color, ...style }}>
        {displayedCode}
      </span>
    );
  }

  if (variant === 'name-only') {
    return (
      <span style={{ fontSize: size, color, ...style }}>
        {showName ? name : displayedCode}
      </span>
    );
  }

  if (variant === 'stacked') {
    return (
      <span style={{ display: 'inline-flex', flexDirection: 'column', lineHeight: 1.15, ...style }}>
        <span className="mono" style={{ fontWeight: 600, fontSize: size, color }}>
          {displayedCode}
        </span>
        {showName && (
          <span style={{ fontSize: Math.max(9, size - 4), color: 'var(--ink-3)', marginTop: 1 }}>
            {name}
          </span>
        )}
      </span>
    );
  }

  // inline (default)
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, ...style }}>
      <span className="mono" style={{ fontWeight: 600, fontSize: size, color }}>
        {displayedCode}
      </span>
      {showName && (
        <span style={{ fontSize: Math.max(10, size - 3), color: 'var(--ink-3)' }}>
          {name}
        </span>
      )}
    </span>
  );
}
