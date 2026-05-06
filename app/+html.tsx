import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="fr">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{
          __html: `
            html, body { margin: 0; padding: 0; height: 100%; background: #0f172a; }

            /* Rendu texte */
            * { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; box-sizing: border-box; }

            /* Scrollbar fine et discrète */
            ::-webkit-scrollbar { width: 5px; height: 5px; }
            ::-webkit-scrollbar-track { background: transparent; }
            ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.14); border-radius: 4px; }
            ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.26); }

            /* Curseur pointer sur tous les éléments cliquables */
            [role="button"], button, a, label, [tabindex="0"] { cursor: pointer !important; }

            /* Sélection de texte */
            ::selection { background: rgba(37,99,235,0.35); color: #fff; }

            /* Transitions sur les éléments interactifs */
            [role="button"] { transition: opacity 0.12s ease, transform 0.12s ease; }

            /* Focus ring accessible */
            :focus-visible { outline: 2px solid #2563eb; outline-offset: 3px; border-radius: 6px; }

            /* Inputs */
            input, textarea { caret-color: #2563eb; }
            input::placeholder, textarea::placeholder { color: rgba(100,116,139,0.8) !important; }
          `
        }} />
        {/* Sur desktop : on simule un viewport 600px pour que le layout mobile
            soit agrandi proportionnellement au lieu d'être microscopique */}
        <script dangerouslySetInnerHTML={{
          __html: `
            (function() {
              var w = window.innerWidth || document.documentElement.clientWidth || 0;
              if (w >= 768) {
                var vp = document.querySelector('meta[name="viewport"]');
                if (vp) vp.setAttribute('content', 'width=600, initial-scale=1');
              }
            })();
          `
        }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
