# Proposal

## Why

The site will publish zero's logo with a transparent background at https://zerointheloop.com/brand/, so projects like Yalope can show it as a sponsor. You get: - zero-logo.svg: the favicon's ring and orange dot with no square behind them, and a dark ring for light backgrounds. - zero-logo-light.svg: the same drawing with a light ring for dark backgrounds. - zero-logo-transparent.png and zero-logo-transparent-light.png: the same two logos as 512×512 PNG images with real transparency. - zero-logo-horizontal.svg and zero-logo-horizontal-light.svg: the symbol next to the word "zero", like in the panel. The word is drawn as shapes, so it looks the same on any computer even if the font isn't installed. The current zero-logo.png (a different "Z" drawing on a black background) stays as it is, because a link outside the site may point to it. Nothing visible on the site changes: the page, the styles and the favicon stay the same.

## What Changes

- Transparent zero logos in site/brand/ for sponsors
- Supuesto: The request allowed replacing zero-logo.png. It is kept, and the new PNGs are named zero-logo-transparent*.png, because the current file is a different 'Z' drawing that no page in the repo uses but an outside link might, and the request asks that nothing visible change.
- Supuesto: The word in the horizontal logo is drawn by hand as paths in place of the site's system mono font, so it won't match the panel's letters exactly. Its exact look is a design choice the person in charge may want to adjust.
- Supuesto: No image library is available (dependencies must not be added), so the PNGs come from a script with only Node built-ins. That works only because the symbol is made of circles. The pixel checks in the test are what ties the PNGs to the SVGs.
- Supuesto: The files are only public at https://zerointheloop.com/brand/ once the change reaches main and Vercel deploys site/. The factory cannot check the live URL.

## Capabilities

### New Capabilities

### Modified Capabilities
- `project-site`: Transparent zero logos in site/brand/ for sponsors

## Impact

Generado por zero para el trabajo 7d273fdd.
