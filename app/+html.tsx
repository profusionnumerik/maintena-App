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
            html, body {
              margin: 0;
              padding: 0;
              height: 100%;
              background: #0f172a;
            }
            /* Scale the app proportionally on desktop screens */
            @media screen and (min-width: 768px) and (max-width: 1199px) {
              body { zoom: 1.4; }
            }
            @media screen and (min-width: 1200px) and (max-width: 1599px) {
              body { zoom: 1.7; }
            }
            @media screen and (min-width: 1600px) {
              body { zoom: 2.0; }
            }
          `
        }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
