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
