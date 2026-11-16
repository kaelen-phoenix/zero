# Spec Delta

## ADDED Requirements

### Requirement: Transparent symbol SVG for light backgrounds
site/brand/zero-logo.svg MUST draw the favicon's symbol without its background: viewBox 0 0 32 32, a ring (circle cx=16 cy=16 r=8, fill none, stroke #111111, stroke-width 3) and a dot (circle cx=25 cy=7 r=3.5, fill #ff8a5c). It SHALL contain no rect or other filled background, no <text>, no <image> and no reference to another file or origin.

#### Scenario: Dark ring, no background
- **WHEN** site/brand/zero-logo.svg is read
- **THEN** it is an SVG with viewBox "0 0 32 32", has a circle with r="8", stroke="#111111", stroke-width="3" and fill="none", has a circle cx="25" cy="7" r="3.5" fill="#ff8a5c", and contains no <rect, <text, <image, href= or url(

### Requirement: Transparent symbol SVG for dark backgrounds
site/brand/zero-logo-light.svg MUST be the same drawing as zero-logo.svg with the ring's stroke #fbfbf9 instead of #111111, and the same limits: no background, no text, no image, no external reference.

#### Scenario: Light ring, same geometry
- **WHEN** site/brand/zero-logo-light.svg is read and compared with zero-logo.svg
- **THEN** replacing #fbfbf9 with #111111 in it gives exactly the content of zero-logo.svg, and it contains no <rect, <text, <image, href= or url(

### Requirement: Transparent PNG symbols
site/brand/zero-logo-transparent.png and site/brand/zero-logo-transparent-light.png MUST be 512×512 PNG images, 8 bits per channel with alpha (color type 6, RGBA). Each MUST be the rendering of its SVG (zero-logo.svg and zero-logo-light.svg) at 16 pixels per SVG unit: transparent outside the drawing and inside the ring, an opaque ring of that SVG's color and an opaque #ff8a5c dot.

#### Scenario: Size and alpha channel
- **WHEN** the IHDR chunk of each PNG is read
- **THEN** width and height are 512, bit depth is 8 and color type is 6

#### Scenario: Transparent background
- **WHEN** each PNG is decoded (IDAT inflated with zlib and every filter undone) and the pixels at (0,0), (511,511), (0,511) and the ring's center (256,256) are read
- **THEN** each of those pixels has alpha 0

#### Scenario: Ring and dot colors
- **WHEN** the pixel on the ring at (256,128) and the dot's center at (400,112) are read
- **THEN** (256,128) has alpha 255 and RGB #111111 in zero-logo-transparent.png or #fbfbf9 in zero-logo-transparent-light.png, and (400,112) has alpha 255 and RGB #ff8a5c in both

### Requirement: Horizontal transparent logo with the word
site/brand/zero-logo-horizontal.svg (dark: symbol ring and word #111111) and site/brand/zero-logo-horizontal-light.svg (light: ring and word #fbfbf9) MUST show the symbol (ring and #ff8a5c dot, the same geometry as zero-logo.svg) followed on its right by the word "zero" in lowercase, drawn as paths. They MUST have a viewBox wider than it is tall and no background, and SHALL contain no <text>, no font reference, no <image>, no rect fill and no external reference.

#### Scenario: Wide, drawn word, no background
- **WHEN** each horizontal SVG is read
- **THEN** its viewBox width is greater than its height, it contains the #ff8a5c dot, at least one <path, its variant's color (#111111 or #fbfbf9) and no <text, font-family, @font-face, <image, <rect, href= or url(

#### Scenario: Light variant matches dark
- **WHEN** zero-logo-horizontal-light.svg is compared with zero-logo-horizontal.svg
- **THEN** replacing #fbfbf9 with #111111 in the light one gives exactly the content of the dark one

### Requirement: Brand files leave the visible site unchanged
Adding the brand files MUST NOT change what the site shows: site/index.html, site/styles.css, site/main.js and site/favicon.svg SHALL stay as they are, no page SHALL reference the new files, and the existing site/brand/zero-logo.png and site/brand/zero-symbol.png MUST keep their content.

#### Scenario: Existing PNG untouched
- **WHEN** the SHA-256 of site/brand/zero-logo.png and site/brand/zero-symbol.png is computed
- **THEN** each matches the value it had at the base commit, which the test keeps as a constant

#### Scenario: Favicon keeps its background
- **WHEN** site/favicon.svg is read
- **THEN** it still contains its <rect with fill="#111111"

#### Scenario: No page references the brand files
- **WHEN** site/index.html, site/styles.css and site/main.js are searched for "brand/"
- **THEN** there is no match
