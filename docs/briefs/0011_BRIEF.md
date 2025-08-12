# Experiences Section Brief

## 1) Project overview / description
Add a new "EXPERIENCES" section immediately below the existing `StorySection` on the homepage. The section highlights three experience modes offered by the sauna: `SOCIAL`, `MEDITATIVE`, and `GUIDED`. Each mode is presented as a card with a symbol, a title, and concise supporting copy.

## 2) Target audience
- Community seekers and social wellness enthusiasts interested in group experiences
- Individuals looking for quiet, reflective, or tech-free wellness time
- Guests seeking structure and expert-led modalities (e.g., guided sauna, breathwork, yoga)

## 3) Primary benefits / features
- Prominent header: "EXPERIENCES" (match the display scale used in `StorySection` heading)
- Three cards:
  - SOCIAL
    - Copy:
      - 50 person Scandinavian sauna, large hot pool, teas and tonics, lounge seating
      - Cultivating connection
      - Encouraging understanding
      - Enjoying Life
    - Symbol: `public/symbols/connection-symbol.png` (association with connection and community)
  - MEDITATIVE
    - Copy:
      - A 20 person sauna, 20 person cold plunge, space for breathwork + bodywork 
      - Disconnecting from technology
      - Finding meaning
    - Symbol: `public/symbols/harmony-symbol.png` (association with calm and balance)
  - GUIDED
    - Copy:
      - Guided classes that blend the thermic cycle (sauna, cold bathing, and resting) with meditation, breathwork, sound baths and more
      - Prioritizing one’s health
      - Self-care
    - Symbol: `public/symbols/transformation-symbol.png` (association with growth and transformation)
- Visual layout:
  - Desktop: three-up card grid
  - Tablet: two-up grid
  - Mobile: single column stack
- Accessibility: meaningful `alt` text per symbol, headings are semantic, readable contrast, keyboard focus states
- Visual consistency: typography scale and spacing aligned to `StorySection`; symbols sized consistently across cards

## 4) High-level tech / architecture
- Tech stack: Astro site using existing component architecture
- New component: `ExperiencesSection` (Astro component) rendered below `StorySection`
- Assets: symbols sourced from `public/symbols/*.png`
- Styles: follow existing site conventions (match `StorySection` heading size; use established spacing and typography scales)
- Responsive grid using existing CSS approach in the project


